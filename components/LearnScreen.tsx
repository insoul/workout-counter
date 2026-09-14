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
import type { SampleExercise, SampleHeight, SampleMarks, SampleMeta, SampleView } from '@/lib/learned/types';
import { MAX_FRAMES, MIN_FRAMES } from '@/lib/learned/validate';
import { drawPose } from '@/lib/pose/draw';
import { PoseEngine } from '@/lib/pose/engine';
import { primeBeep } from '@/lib/speech/beep';
import { primeVoice, speak } from '@/lib/speech/voice';
import { releaseWakeLock, requestWakeLock } from '@/lib/wakeLock';
import LearnGuide from './LearnGuide';
import PoseFigure from './PoseFigure';

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
  fps: number;
  aspect: number;
}

export default function LearnScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const recordingRef = useRef<{ frames: number[][]; t0: number; lastT: number } | null>(null);
  /** 프레임 루프(useCallback)에서 최신 finishRecording 을 부르기 위한 우회 */
  const finishRef = useRef<() => void>(() => {});

  const [camOn, setCamOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [exercise, setExercise] = useState<SampleExercise>('squat');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [review, setReview] = useState<Recording | null>(null);
  const [marks, setMarks] = useState<SampleMarks>({ start: 0, end: 0 });
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
    rec.lastT = frame.t;
    if (rec.frames.length % 5 === 0) setElapsed(Math.round((frame.t - rec.t0) / 100) / 10);
    if (rec.frames.length >= MAX_FRAMES) finishRef.current();
  }, []);

  const startCam = async () => {
    setLoading(true);
    setCamError(null);
    primeVoice();
    primeBeep();
    try {
      await startCamera(videoRef.current!);
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
    recordingRef.current = { frames: [], t0: performance.now(), lastT: performance.now() };
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
      setNotice('너무 짧습니다. 1초 이상 녹화해 주세요.');
      return;
    }
    const sec = (rec.lastT - rec.t0) / 1000;
    const fps = sec > 0 ? rec.frames.length / sec : 30;
    const video = videoRef.current;
    const aspect = video && video.videoWidth ? video.videoHeight / video.videoWidth : 4 / 3;
    const r = { frames: rec.frames, fps: Math.round(fps * 10) / 10, aspect };
    setReview(r);
    setMarks(defaultMarks(r.frames, kind));
    setActive(kind === 'rep' ? 'bottom' : 'start');
    speak('녹화 끝. 구간을 표시해 주세요');
  }

  useEffect(() => {
    finishRef.current = finishRecording;
  });

  const labelCounts = review
    ? labelSample({ id: 'preview', exerciseId: exercise, kind, fps: review.fps, frames: review.frames, marks }).reduce(
        (acc, v) => ({ ...acc, [v.state]: (acc[v.state] ?? 0) + 1 }),
        {} as Record<string, number>,
      )
    : null;

  const save = async () => {
    if (!review) return;
    setSaving(true);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ view, height }));
    } catch {
      // 무시
    }
    const id = await saveSample({ exerciseId: exercise, view, height, fps: review.fps, frames: review.frames, marks });
    setSaving(false);
    if (!id) {
      setNotice('저장에 실패했습니다. 로그인 상태를 확인해 주세요.');
      return;
    }
    setReview(null);
    setNotice(`${nameOf(exercise)} 샘플 저장 — 이제 ${(counts[exercise] ?? 0) + 1}개`);
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

  const setMark = (key: 'start' | 'end' | 'bottom', v: number) => {
    setMarks((m) => {
      const n = { ...m, [key]: v };
      if (n.start > n.end) {
        if (key === 'start') n.end = n.start;
        else n.start = n.end;
      }
      if (n.bottom !== undefined) n.bottom = Math.min(Math.max(n.bottom, n.start), n.end);
      return n;
    });
  };
  const activeFrame = review ? (marks[active] ?? marks.start) : 0;

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
                  ? '위 자세(선 자세·매달린 자세)에서 시작을 누르고 1회 한 뒤 완료를 누르세요.'
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
          <h2 className="mb-2 text-xl font-black">{nameOf(exercise)} · {review.frames.length}프레임 · {review.fps}fps</h2>
          <div className="mb-3 flex items-start gap-3">
            <PoseFigure row={review.frames[activeFrame] ?? null} width={150} aspect={review.aspect} />
            <div className="text-sm text-neutral-300">
              <div className="mb-1">
                손잡이를 움직여 구간을 잡으세요. 구간 밖은 <b>아무것도 아님</b>으로 저장됩니다.
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
          {(['start', 'bottom', 'end'] as const)
            .filter((k) => k !== 'bottom' || kind === 'rep')
            .map((k) => (
              <label key={k} className={`mb-2 block text-sm ${active === k ? 'text-white' : 'text-neutral-400'}`}>
                <div className="flex justify-between">
                  <span>{k === 'start' ? '시작' : k === 'end' ? '끝' : '바닥(가장 깊이 굽힌 순간)'}</span>
                  <span className="font-mono">{((marks[k] ?? 0) / review.fps).toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={review.frames.length - 1}
                  value={marks[k] ?? 0}
                  onPointerDown={() => setActive(k)}
                  onChange={(e) => {
                    setActive(k);
                    setMark(k, Number(e.target.value));
                  }}
                  className="w-full accent-green-500"
                />
              </label>
            ))}
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
            <button onClick={save} disabled={saving} className="flex-[2] rounded-2xl bg-green-500 py-4 text-lg font-bold text-black disabled:opacity-50">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
