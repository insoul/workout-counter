'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startCamera, stopCamera } from '@/lib/camera';
import { frameToRow } from '@/lib/detectors/learned';
import { EXERCISES, type ExerciseId } from '@/lib/detectors/registry';
import type { PoseFrame } from '@/lib/detectors/types';
import { deleteSample, listSamples, saveSample } from '@/lib/learned/client';
import { kindOf } from '@/lib/learned/compact';
import { defaultMarks, labelSample } from '@/lib/learned/label';
import { detectReps, sliceByReps } from '@/lib/learned/segment';
import type { SampleExercise, SampleHeight, SampleMarks, SampleMeta, SampleView } from '@/lib/learned/types';
import { MAX_FRAMES, MIN_FRAMES } from '@/lib/learned/validate';
import { createFrameDrawer, startClip, waitForClip, type Clip, type ClipRecorder } from '@/lib/learned/clipRecorder';
import { drawPose } from '@/lib/pose/draw';
import { PoseEngine } from '@/lib/pose/engine';
import { primeBeep } from '@/lib/speech/beep';
import { primeVoice, speak } from '@/lib/speech/voice';
import { releaseWakeLock, requestWakeLock } from '@/lib/wakeLock';
import FrameStill from './FrameStill';
import LearnGuide from './LearnGuide';

const EXERCISE_IDS = Object.keys(EXERCISES) as ExerciseId[];
const VIEWS: { id: SampleView; ko: string }[] = [
  { id: 'front', ko: '정면' },
  { id: 'left', ko: '왼쪽 측면' },
  { id: 'right', ko: '오른쪽 측면' },
  { id: 'diagonal', ko: '대각' },
];
const HEIGHTS: { id: SampleHeight; ko: string }[] = [
  { id: 'floor', ko: '바닥' },
  { id: 'waist', ko: '허리' },
  { id: 'eye', ko: '눈높이' },
];
const PREF_KEY = 'learn-pref';

function readPref(): { view?: SampleView; height?: SampleHeight } {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as { view?: SampleView; height?: SampleHeight };
  } catch {
    return {};
  }
}

function nameOf(id: SampleExercise): string {
  return id === 'none' ? '아무것도 아님' : `${EXERCISES[id].cameraIcon} ${EXERCISES[id].nameKo}`;
}

interface Recording {
  frames: number[][];
  /** 프레임별 performance.now() — 영상 시각과 맞추는 데만 쓰고 저장하지 않는다 */
  ts: number[];
  fps: number;
  aspect: number;
  /** 녹화 구간 영상(메모리). 지원 안 되거나 실패하면 null */
  clip: Clip | null;
}

const MARK_LABEL = { start: '시작', bottom: '바닥', end: '끝' } as const;

export default function LearnScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const recordingRef = useRef<{ frames: number[][]; ts: number[]; t0: number; lastT: number; clip: ClipRecorder | null } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clipVideoRef = useRef<HTMLVideoElement>(null);
  /** seek 준비가 끝난 영상과 그 프레임 그리기 함수 — 현재 검토 영상과 같을 때만 쓴다 */
  const [ready, setReady] = useState<{ url: string; draw: (time: number, canvas: HTMLCanvasElement) => Promise<boolean> } | null>(null);
  /** 프레임 루프(useCallback)에서 최신 finishRecording 을 부르기 위한 우회 */
  const finishRef = useRef<() => void>(() => {});

  const [camOn, setCamOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [exercise, setExercise] = useState<SampleExercise>('squat');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [review, setReview] = useState<Recording | null>(null);
  /** 한 녹화 안의 회들. hold·none 은 항상 하나 */
  const [segments, setSegments] = useState<SampleMarks[]>([]);
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<'start' | 'end' | 'bottom'>('start');
  const [view, setView] = useState<SampleView>(() => readPref().view ?? 'front');
  const [height, setHeight] = useState<SampleHeight>(() => readPref().height ?? 'waist');
  const [saving, setSaving] = useState(false);
  const [samples, setSamples] = useState<SampleMeta[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);

  const kind = kindOf(exercise);

  const refresh = useCallback(async (ex: SampleExercise) => {
    const r = await listSamples(ex);
    if (r) {
      setSamples(r.samples);
      setCounts(r.counts);
    }
  }, []);

  // 운동을 바꾸면 목록을 다시 받는다 (응답이 늦게 와도 이미 다른 운동으로 바뀌었으면 버린다)
  useEffect(() => {
    let alive = true;
    listSamples(exercise).then((r) => {
      if (!alive || !r) return;
      setSamples(r.samples);
      setCounts(r.counts);
    });
    return () => {
      alive = false;
    };
  }, [exercise]);

  const onFrame = useCallback((frame: PoseFrame) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const rec = recordingRef.current;
    if (canvas && video) drawPose(canvas, video, frame, rec ? 'good' : frame.lm.length ? 'idle' : 'warn');
    if (!rec) return;
    rec.frames.push(frameToRow(frame));
    rec.ts.push(frame.t);
    rec.lastT = frame.t;
    if (rec.frames.length % 5 === 0) setElapsed(Math.round((frame.t - rec.t0) / 100) / 10);
    if (rec.frames.length >= MAX_FRAMES) finishRef.current(); // 60초 상한
  }, []);

  const startCam = async () => {
    setLoading(true);
    setCamError(null);
    primeVoice();
    primeBeep();
    try {
      streamRef.current = await startCamera(videoRef.current!);
      const engine = new PoseEngine();
      await engine.init(videoRef.current!);
      engineRef.current = engine;
      engine.start(onFrame);
    } catch (e) {
      console.error(e);
      setCamError('카메라 또는 포즈 모델을 시작하지 못했습니다.');
      setLoading(false);
      return;
    }
    requestWakeLock();
    setCamOn(true);
    setLoading(false);
  };

  const startRecording = () => {
    const clip = streamRef.current ? startClip(streamRef.current) : null;
    recordingRef.current = { frames: [], ts: [], t0: performance.now(), lastT: performance.now(), clip };
    setElapsed(0);
    setRecording(true);
    speak('녹화 시작', 'count');
  };

  function finishRecording() {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;
    if (rec.frames.length < MIN_FRAMES) {
      void rec.clip?.stop().then((c) => c && URL.revokeObjectURL(c.url));
      setNotice('너무 짧습니다. 1초 이상 녹화해 주세요.');
      return;
    }
    const sec = (rec.lastT - rec.t0) / 1000;
    const fps = sec > 0 ? rec.frames.length / sec : 30;
    const video = videoRef.current;
    const aspect = video && video.videoWidth ? video.videoHeight / video.videoWidth : 4 / 3;
    const r: Recording = { frames: rec.frames, ts: rec.ts, fps: Math.round(fps * 10) / 10, aspect, clip: null };
    setReview(r);
    // 영상은 인코더가 끝나야 나온다 — 그동안은 관절만 보이고, 오면 정지화면이 채워진다
    void rec.clip?.stop().then((clip) => {
      if (!clip) return;
      setReview((cur) => {
        if (cur !== r) {
          URL.revokeObjectURL(clip.url); // 이미 버리거나 저장한 뒤
          return cur;
        }
        return { ...cur, clip };
      });
    });
    const reps = kind === 'rep' && exercise !== 'none' ? detectReps(r.frames, r.fps, EXERCISES[exercise].requiredChains) : [];
    setSegments(reps.length ? reps : [defaultMarks(r.frames, kind)]);
    setSelected(0);
    setActive(kind === 'rep' ? 'bottom' : 'start');
    speak(reps.length > 1 ? `녹화 끝. ${reps.length}회를 찾았습니다. 구간을 확인해 주세요` : '녹화 끝. 구간을 표시해 주세요');
  }

  useEffect(() => {
    finishRef.current = finishRecording;
  });

  // 검토 영상이 오면 seek 준비, 검토가 끝나면 메모리에서 버린다
  const clipUrl = review?.clip?.url ?? null;
  useEffect(() => {
    if (!clipUrl) return;
    let alive = true;
    const video = clipVideoRef.current;
    if (video) {
      video.src = clipUrl;
      void waitForClip(video).then((ok) => {
        if (alive && ok) setReady({ url: clipUrl, draw: createFrameDrawer(video) });
      });
    }
    return () => {
      alive = false;
      URL.revokeObjectURL(clipUrl);
    };
  }, [clipUrl]);
  const drawer = clipUrl && ready?.url === clipUrl ? ready.draw : null;

  /** 손잡이 프레임 → 영상 시각(초). 영상이 없으면 null */
  const clipTime = (frame: number): number | null => {
    if (!review?.clip) return null;
    const t = review.ts[frame];
    return t == null ? null : Math.max(0, (t - review.clip.t0) / 1000);
  };

  const marks: SampleMarks = segments[selected] ?? { start: 0, end: 0 };
  /** 저장될 샘플들(회마다 하나) — 미리보기 라벨 수와 저장이 같은 슬라이스를 쓴다 */
  const slices = review ? (kind === 'rep' ? sliceByReps(review.frames, segments) : [{ frames: review.frames, marks }]) : [];
  const labelCounts = review
    ? slices
        .flatMap((sl, i) => labelSample({ id: `p${i}`, exerciseId: exercise, kind, fps: review.fps, frames: sl.frames, marks: sl.marks }))
        .reduce((acc, v) => ({ ...acc, [v.state]: (acc[v.state] ?? 0) + 1 }), {} as Record<string, number>)
    : null;

  const save = async () => {
    if (!review || !slices.length) return;
    setSaving(true);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ view, height }));
    } catch {
      // 무시
    }
    let ok = 0;
    for (const sl of slices) {
      const id = await saveSample({ exerciseId: exercise, view, height, fps: review.fps, frames: sl.frames, marks: sl.marks });
      if (id) ok++;
    }
    setSaving(false);
    if (!ok) {
      setNotice('저장에 실패했습니다. 로그인 상태를 확인해 주세요.');
      return;
    }
    setReview(null);
    setNotice(
      ok < slices.length
        ? `${ok}/${slices.length}개만 저장됐습니다`
        : `${nameOf(exercise)} 샘플 ${ok}개 저장 — 이제 ${(counts[exercise] ?? 0) + ok}개`,
    );
    void refresh(exercise);
  };

  const remove = async (s: SampleMeta) => {
    if (!confirm('이 샘플을 삭제할까요?')) return;
    if (await deleteSample(s.id)) void refresh(exercise);
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      engineRef.current?.destroy();
      stopCamera(video);
      releaseWakeLock();
    };
  }, []);

  const lastFrame = review ? review.frames.length - 1 : 0;
  const fpsNow = review?.fps ?? 30;
  /** 슬라이더가 다루는 창 — 앞 회의 끝 ~ 뒤 회의 시작, 그 안에서 선택한 회 앞뒤 2초 */
  const window = (() => {
    const pad = Math.round(2 * fpsNow);
    const prev = segments[selected - 1];
    const next = segments[selected + 1];
    const lo = Math.max(prev ? prev.end + 1 : 0, marks.start - pad);
    const hi = Math.min(next ? next.start - 1 : lastFrame, marks.end + pad);
    return { lo, hi: Math.max(lo, hi) };
  })();

  const setMark = (key: 'start' | 'end' | 'bottom', v: number) => {
    setSegments((segs) =>
      segs.map((m, i) => {
        if (i !== selected) return m;
        const n = { ...m, [key]: Math.min(window.hi, Math.max(window.lo, v)) };
        if (n.start > n.end) {
          if (key === 'start') n.end = n.start;
          else n.start = n.end;
        }
        if (n.bottom !== undefined) n.bottom = Math.min(Math.max(n.bottom, n.start), n.end);
        return n;
      }),
    );
  };
  const nudge = (key: 'start' | 'end' | 'bottom', d: number) => {
    setActive(key);
    setMark(key, (marks[key] ?? marks.start) + d);
  };

  /** 선택한 회 뒤에 비슷한 길이의 회를 놓는다. 자리가 없으면 안내 */
  const addSegment = () => {
    const lens = segments.map((m) => m.end - m.start);
    const len = lens.length ? lens.sort((a, b) => a - b)[Math.floor(lens.length / 2)] : Math.round(1.5 * fpsNow);
    const gap = Math.round(0.5 * fpsNow);
    const after = segments[selected];
    const next = segments[selected + 1];
    const start = after ? after.end + gap : 0;
    const limit = next ? next.start - 1 : lastFrame;
    const end = Math.min(start + len, limit);
    if (end - start < Math.round(0.3 * fpsNow)) {
      setNotice('이 회 뒤에 자리가 없습니다. 마지막 회를 고른 뒤 추가하세요.');
      return;
    }
    const seg: SampleMarks = { start, end, bottom: Math.round((start + end) / 2) };
    setSegments((segs) => [...segs.slice(0, selected + 1), seg, ...segs.slice(selected + 1)]);
    setSelected(selected + 1);
    setActive('bottom');
  };
  const removeSegment = () => {
    setSegments((segs) => segs.filter((_, i) => i !== selected));
    setSelected((i) => Math.max(0, i - 1));
  };
  const markKeys = (['start', 'bottom', 'end'] as const).filter((k) => k !== 'bottom' || kind === 'rep');

  return (
    <div className="fixed inset-0 overflow-hidden bg-neutral-950 text-neutral-100">
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100" />

      {/* 상단: 운동 선택 */}
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/90 to-transparent px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-lg font-black">🎓 학습 모드</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => setGuide(true)} className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              ? 현황·안내
            </button>
            <Link href="/" className="text-xs text-neutral-400 underline">홈으로</Link>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[...EXERCISE_IDS, 'none' as const].map((id) => (
            <button
              key={id}
              onClick={() => !recording && !review && setExercise(id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${
                exercise === id ? 'bg-green-500 text-black' : 'bg-white/10 text-white'
              }`}
            >
              {nameOf(id)} <span className="opacity-70">{counts[id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="absolute inset-x-4 top-28 z-30 rounded-xl bg-yellow-500/90 px-4 py-2 text-center text-sm font-semibold text-black">
          {notice}
        </div>
      )}

      {/* 하단: 녹화 컨트롤 또는 목록 */}
      {!review && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10">
          {!camOn ? (
            <>
              <p className="text-center text-sm text-neutral-300">
                {kind === 'rep'
                  ? '시작을 누르고 자리를 잡은 뒤 5~8회를 연속으로 하고 완료를 누르세요. 회마다 샘플이 됩니다.'
                  : kind === 'hold'
                    ? '자세를 잡고 시작을 누른 뒤 몇 초 버티고 완료를 누르세요.'
                    : '걷기, 자리 잡기, 철봉 잡으러 가기 같은 동작을 녹화하세요.'}
              </p>
              {camError && <p className="text-center text-sm text-red-400">{camError}</p>}
              <button onClick={startCam} disabled={loading} className="rounded-2xl bg-white py-4 text-lg font-bold text-black disabled:opacity-50">
                {loading ? '모델 로딩 중…' : '카메라 켜기'}
              </button>
            </>
          ) : recording ? (
            <button onClick={finishRecording} className="rounded-3xl bg-red-500 py-5 text-2xl font-black text-white active:bg-red-400">
              ● 완료 ({elapsed.toFixed(1)}초)
            </button>
          ) : (
            <button onClick={startRecording} className="rounded-3xl bg-green-500 py-5 text-2xl font-black text-black active:bg-green-400">
              시작 — {nameOf(exercise)}
            </button>
          )}
          {samples.length > 0 && (
            <div className="max-h-[22vh] overflow-y-auto rounded-xl bg-black/50 p-2 text-xs">
              <div className="mb-1 flex flex-wrap gap-x-3 text-neutral-400">
                <span className="font-semibold text-neutral-200">{nameOf(exercise)} {samples.length}개</span>
                {VIEWS.map((v) => {
                  const n = samples.filter((s) => s.view === v.id).length;
                  return n ? <span key={v.id}>{v.ko} {n}</span> : null;
                })}
                {HEIGHTS.map((h) => {
                  const n = samples.filter((s) => s.height === h.id).length;
                  return n ? <span key={h.id}>{h.ko} {n}</span> : null;
                })}
              </div>
              {samples
                .slice()
                .reverse()
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-1 text-neutral-300">
                    <span>
                      {new Date(s.createdAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} ·{' '}
                      {VIEWS.find((v) => v.id === s.view)?.ko} · {HEIGHTS.find((h) => h.id === s.height)?.ko} · {s.frameCount}f
                    </span>
                    <button onClick={() => remove(s)} className="text-red-300 underline">삭제</button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {guide && <LearnGuide counts={counts} onClose={() => setGuide(false)} />}

      {/* 검토: 구간 표시 + 저장 */}
      {review && (
        <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-neutral-950/95 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <h2 className="mb-2 text-xl font-black">
            {nameOf(exercise)} · {(review.frames.length / review.fps).toFixed(1)}초
            {kind === 'rep' && ` · ${segments.length}회`}
          </h2>
          <video ref={clipVideoRef} playsInline muted preload="auto" className="absolute h-px w-px opacity-0" />

          {kind === 'rep' && (
            <>
              {/* 회 선택 칩 */}
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                {segments.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelected(i);
                      setActive('bottom');
                    }}
                    className={`flex shrink-0 flex-col items-center rounded-lg px-3 py-1 text-xs leading-tight ${
                      i === selected ? 'bg-green-500 text-black' : 'bg-white/10 text-neutral-300'
                    }`}
                  >
                    <span className="font-bold">{i + 1}회</span>
                    <span className="font-mono opacity-80">{(m.start / review.fps).toFixed(1)}s</span>
                  </button>
                ))}
                <button onClick={addSegment} className="shrink-0 rounded-lg border border-dashed border-white/30 px-3 py-1 text-xs text-neutral-300">
                  + 추가
                </button>
              </div>
              {/* 전체 타임라인 — 선택용 */}
              <div
                className="relative mb-3 h-4 w-full overflow-hidden rounded bg-white/10"
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const f = ((e.clientX - rect.left) / rect.width) * lastFrame;
                  let best = 0;
                  let bestD = Infinity;
                  segments.forEach((m, i) => {
                    const d = f < m.start ? m.start - f : f > m.end ? f - m.end : 0;
                    if (d < bestD) {
                      bestD = d;
                      best = i;
                    }
                  });
                  setSelected(best);
                }}
              >
                {segments.map((m, i) => (
                  <div
                    key={i}
                    className={`absolute inset-y-0 rounded-sm ${i === selected ? 'bg-green-500' : 'bg-neutral-500'}`}
                    style={{ left: `${(m.start / lastFrame) * 100}%`, width: `${Math.max(0.5, ((m.end - m.start) / lastFrame) * 100)}%` }}
                  />
                ))}
                {segments[selected]?.bottom !== undefined && (
                  <div className="absolute inset-y-0 w-0.5 bg-black" style={{ left: `${(segments[selected].bottom! / lastFrame) * 100}%` }} />
                )}
              </div>
            </>
          )}

          {/* 손잡이별 정지화면 — 영상 프레임 위에 관절. 누르면 그 손잡이가 활성 */}
          <div className="mb-2 flex gap-2">
            {markKeys.map((k) => (
              <FrameStill
                key={k}
                label={MARK_LABEL[k]}
                time={clipTime(marks[k] ?? marks.start)}
                row={review.frames[marks[k] ?? marks.start] ?? null}
                aspect={review.aspect}
                active={active === k}
                draw={drawer}
                onClick={() => setActive(k)}
              />
            ))}
          </div>
          <div className="mb-3">
            <div className="text-sm text-neutral-300">
              <div className="mb-1">
                손잡이를 움직여 구간을 잡으세요. 구간 밖에서 운동과 다른 자세는 <b>아무것도 아님</b>으로 저장됩니다.
                {review.clip === null && ' (영상 준비 중이거나 이 브라우저는 영상 미리보기를 지원하지 않습니다)'}
              </div>
              {labelCounts && (
                <div className="font-mono text-xs text-green-300">
                  {Object.entries(labelCounts).map(([k, v]) => `${k}=${v}`).join(' ')}
                  {kind === 'rep' && !labelCounts.bottom && (
                    <div className="text-red-300">bottom 이 없습니다 — 바닥 손잡이를 확인하세요</div>
                  )}
                </div>
              )}
            </div>
          </div>
          {markKeys.map((k) => (
              <label key={k} className={`mb-2 block text-sm ${active === k ? 'text-white' : 'text-neutral-400'}`}>
                <div className="flex items-center justify-between">
                  <span>{k === 'bottom' ? '바닥(가장 깊이 굽힌 순간)' : MARK_LABEL[k]}</span>
                  <span className="flex items-center gap-1 font-mono">
                    <button type="button" onClick={() => nudge(k, -1)} className="rounded bg-white/10 px-2 py-0.5">◀</button>
                    {((marks[k] ?? 0) / review.fps).toFixed(2)}s
                    <button type="button" onClick={() => nudge(k, 1)} className="rounded bg-white/10 px-2 py-0.5">▶</button>
                  </span>
                </div>
                <input
                  type="range"
                  min={window.lo}
                  max={window.hi}
                  value={Math.min(window.hi, Math.max(window.lo, marks[k] ?? 0))}
                  onPointerDown={() => setActive(k)}
                  onChange={(e) => {
                    setActive(k);
                    setMark(k, Number(e.target.value));
                  }}
                  className="w-full accent-green-500"
                />
              </label>
            ))}
          {kind === 'rep' && (
            <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
              <span>슬라이더 범위 {(window.lo / review.fps).toFixed(1)}~{(window.hi / review.fps).toFixed(1)}s (선택한 회 주변만)</span>
              {segments.length > 0 && (
                <button onClick={removeSegment} className="text-red-300 underline">
                  {selected + 1}회 삭제
                </button>
              )}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="mb-1 text-neutral-400">카메라 각도</div>
              <div className="flex flex-wrap gap-1">
                {VIEWS.map((v) => (
                  <button key={v.id} onClick={() => setView(v.id)} className={`rounded-lg px-2.5 py-1.5 ${view === v.id ? 'bg-green-500 text-black' : 'bg-white/10'}`}>
                    {v.ko}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-neutral-400">폰 높이</div>
              <div className="flex flex-wrap gap-1">
                {HEIGHTS.map((h) => (
                  <button key={h.id} onClick={() => setHeight(h.id)} className={`rounded-lg px-2.5 py-1.5 ${height === h.id ? 'bg-green-500 text-black' : 'bg-white/10'}`}>
                    {h.ko}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-auto flex gap-2 pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button onClick={() => setReview(null)} className="flex-1 rounded-2xl bg-white/10 py-4 font-bold">버리기</button>
            <button
              onClick={save}
              disabled={saving || !slices.length}
              className="flex-[2] rounded-2xl bg-green-500 py-4 text-lg font-bold text-black disabled:opacity-50"
            >
              {saving ? '저장 중…' : kind === 'rep' ? `저장 (${slices.length}개)` : '저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
