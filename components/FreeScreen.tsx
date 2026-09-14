'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EXERCISES, type ExerciseId } from '@/lib/detectors/registry';
import type { DetectorState, ExerciseDetector, PoseFrame } from '@/lib/detectors/types';
import { startCamera, stopCamera } from '@/lib/camera';
import { isDebugEnabled } from '@/lib/debug';
import {
  addHoldMs,
  addRep,
  EMPTY_LOG,
  formatValue,
  isHoldSuppressed,
  startedNewSegment,
  type FreeLog,
} from '@/lib/free/log';
import { buildDebugBundle, shareDebugBundle } from '@/lib/free/debugBundle';
import { captureSnapshot, type Snapshot, type TraceRow } from '@/lib/free/snapshot';
import { PoseEngine } from '@/lib/pose/engine';
import { drawPose } from '@/lib/pose/draw';
import { fullBodyCheck } from '@/lib/pose/fullBodyCheck';
import { beaconSession, saveSession } from '@/lib/sessions/client';
import type { SessionInput } from '@/lib/sessions/types';
import { ding, primeBeep } from '@/lib/speech/beep';
import { koCount } from '@/lib/speech/phrases.ko';
import { primeVoice, speak } from '@/lib/speech/voice';
import { releaseWakeLock, requestWakeLock } from '@/lib/wakeLock';

/** 동시에 돌리는 디텍터 — 합계 표시 순서이기도 하다 */
const FREE_EXERCISES: ExerciseId[] = [
  'squat',
  'pushup',
  'pullup',
  'row',
  'plank',
  'sideplank',
  'singleleg',
  'deadhang',
];

/**
 * 스쿼트 바닥 진입 후 이 시간이 지나 올라온 rep 은 무시한다.
 * 푸시업 하러 바닥에 내려갔다 일어서는 동작이 스쿼트 1회로 잡히는 것을 막는다.
 * 실제 스쿼트는 바닥에 2초 이상 머물지 않는다.
 */
const SQUAT_MAX_BOTTOM_MS = 4000;

/**
 * rep 운동이 움직인 직후에는 hold 시간을 쌓지 않는다.
 * 푸시업 위 자세는 플랭크와, 풀업 사이 매달림은 데드행과 포즈만으로 구분되지 않아
 * "움직임이 있으면 rep, 멈춰 있으면 hold" 로 나눈다.
 */
const HOLD_QUIET_MS = 3000;

/**
 * 유지 동작은 이 시간을 넘겨야 로그에 오른다. 오르는 순간 값은 0이 아니라 여기서부터 시작한다
 * (10초를 버텼으면 "10초"). 자세 전환 중 스치는 시간과 매달리기 준비 같은 짧은 정지를 걸러낸다.
 */
const HOLD_MIN_MS = 10000;

/** 프레임 루프에서 화면 갱신 최소 간격 */
const UI_INTERVAL_MS = 250;

/** 디버그 모드 추적 기록 간격 — 1분에 120줄, 묶음에 수십 KB */
const TRACE_INTERVAL_MS = 500;

interface HoldTrack {
  /** 이번 hold 에서 쌓인 ms (로그 반영 전 포함) */
  ms: number;
  /**
   * pending: 아직 HOLD_MIN_MS 미만 · logged: 로그에 올라 시간을 계속 더하는 중 ·
   * dropped: 직전 구간(예: 풀업)에 흡수돼 이번 hold 는 로그에 올리지 않음
   */
  state: 'pending' | 'logged' | 'dropped';
}

export default function FreeScreen() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const detectorsRef = useRef<{ id: ExerciseId; det: ExerciseDetector }[]>([]);
  const bottomAtRef = useRef<Partial<Record<ExerciseId, number>>>({});
  const holdRef = useRef<Partial<Record<ExerciseId, HoldTrack>>>({});
  /** rep 디텍터별 "굽힘" 시점 증거 — 같은 rep 이 완성되면 구간에 붙이고 비운다 */
  const pendingBottomRef = useRef<Partial<Record<ExerciseId, Snapshot>>>({});
  const traceRef = useRef<TraceRow[]>([]);
  const lastTraceTRef = useRef(0);
  const lastMotionTRef = useRef(-Infinity);
  const lastFrameTRef = useRef<number | null>(null);
  const lastUiTRef = useRef(0);
  const freeLogRef = useRef<FreeLog>(EMPTY_LOG);
  const pausedRef = useRef(false);
  const sessionIdRef = useRef('');
  const startedAtRef = useRef(0);
  const savedRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [freeLog, setFreeLog] = useState<FreeLog>(EMPTY_LOG);
  const [saving, setSaving] = useState(false);
  const [bundle, setBundle] = useState<{ file: File; traceRows: number } | null>(null);
  // SSR 이 꺼진 컴포넌트라 첫 렌더에서 바로 읽어도 된다
  const [debug] = useState(() => isDebugEnabled());
  const [debugStates, setDebugStates] = useState<{ id: ExerciseId; st: DetectorState }[]>([]);
  const [fps, setFps] = useState(0);
  const debugRef = useRef(debug);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /** 저장 본문. 기록이 없거나 이미 저장했으면 null */
  const buildSession = useCallback((): SessionInput | null => {
    const { segments } = freeLogRef.current;
    if (!segments.length || savedRef.current) return null;
    return {
      id: sessionIdRef.current,
      mode: 'free',
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      entries: segments.map((s) => ({ exerciseId: s.exerciseId, kind: s.kind, value: s.value })),
    };
  }, []);

  const finish = async () => {
    const input = buildSession();
    if (input) {
      setSaving(true);
      const ok = await saveSession(input);
      savedRef.current = ok;
      setSaving(false);
    }
    // 디버그 모드면 나가기 전에 AirDrop 묶음을 제안한다 (메모리에만 있어 나가면 사라진다).
    // 구간이 하나도 없어도 추적 기록이 있으면 제안한다 — "왜 아무것도 안 잡혔나"가 핵심 질문이다.
    const { segments } = freeLogRef.current;
    const trace = traceRef.current;
    if (debugRef.current && (segments.some((s) => s.debug) || trace.length)) {
      setBundle({
        file: buildDebugBundle({ startedAt: startedAtRef.current, endedAt: Date.now(), segments, trace }),
        traceRows: trace.length,
      });
      return;
    }
    router.push('/');
  };

  const shareBundle = async () => {
    if (!bundle) return;
    const ok = await shareDebugBundle(bundle.file);
    if (!ok) {
      alert('이 브라우저는 파일 공유를 지원하지 않습니다. iOS Safari에서 열어 주세요.');
      return;
    }
    router.push('/');
  };

  // 탭을 그냥 닫아도 기록이 남도록 — 같은 id 라 종료 버튼 저장과 겹쳐도 중복되지 않는다
  useEffect(() => {
    const onHide = () => {
      const input = buildSession();
      if (input) beaconSession(input);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [buildSession]);

  const onFrame = useCallback((frame: PoseFrame) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (canvas && video) drawPose(canvas, video, frame, frame.lm.length ? 'good' : 'idle');
    if (debugRef.current && frame.t - lastUiTRef.current > UI_INTERVAL_MS) {
      setFps(frame.fps);
      setDebugStates(detectorsRef.current.map(({ id, det }) => ({ id, st: det.state() })));
    }
    if (pausedRef.current) {
      lastFrameTRef.current = null;
      return;
    }
    // 탭 전환/일시정지 후 큰 시간 점프는 100ms로 캡
    const dt = lastFrameTRef.current == null ? 0 : Math.min(frame.t - lastFrameTRef.current, 100);
    lastFrameTRef.current = frame.t;

    let log = freeLogRef.current;
    let segmentsChanged = false;
    const traceDue = debugRef.current && frame.t - lastTraceTRef.current >= TRACE_INTERVAL_MS;
    const traceRow: TraceRow | null = traceDue
      ? { at: Math.max(0, Date.now() - startedAtRef.current), det: {} }
      : null;

    const commit = (next: FreeLog) => {
      if (startedNewSegment(log, next)) segmentsChanged = true;
      log = next;
    };

    for (const { id, det } of detectorsRef.current) {
      // 그 운동에 필요한 관절(registry.requiredChains)이 하나라도 안 보이면 "사람 없음" 프레임으로 넘긴다.
      // rep 은 저신뢰로, hold 는 유예 후 이탈로 처리되어 관절이 다 보일 때만 인식한다.
      const visible = fullBodyCheck(frame, EXERCISES[id].requiredChains);
      const events = det.update(visible ? frame : { ...frame, lm: [], world: [] });
      if (traceRow) {
        const st = det.state();
        traceRow.det[id] = { ...st.debug, visible, reps: st.reps, holding: st.holding };
      }
      if (det.kind === 'rep') {
        for (const e of events) {
          if (e.type === 'phase' && e.phase === 'bottom') {
            bottomAtRef.current[id] = frame.t;
            lastMotionTRef.current = frame.t;
            if (debugRef.current) {
              pendingBottomRef.current[id] = captureSnapshot(det, frame, startedAtRef.current, videoRef.current);
            }
            ding();
          } else if (e.type === 'rep') {
            lastMotionTRef.current = frame.t;
            const bottomAt = bottomAtRef.current[id];
            if (id === 'squat' && bottomAt != null && frame.t - bottomAt > SQUAT_MAX_BOTTOM_MS) {
              continue;
            }
            const before = log;
            const last = before.segments[before.segments.length - 1];
            const bottom = pendingBottomRef.current[id];
            pendingBottomRef.current[id] = undefined;
            const snap =
              debugRef.current && last?.exerciseId !== id
                ? captureSnapshot(det, frame, startedAtRef.current, videoRef.current)
                : undefined;
            commit(addRep(before, id, snap, snap ? bottom : undefined));
            const count = log.segments[log.segments.length - 1].value;
            const name = startedNewSegment(before, log) ? `${EXERCISES[id].nameKo}, ` : '';
            speak(`${name}${koCount(count)}`, 'count');
          }
        }
        continue;
      }

      // hold 운동: 자세 유지 중이고 rep 움직임이 잠잠할 때만 시간을 쌓는다
      const track = (holdRef.current[id] ??= { ms: 0, state: 'pending' });
      const quiet = frame.t - lastMotionTRef.current > HOLD_QUIET_MS;
      const holding = det.state().holding;
      if (holding && !quiet) {
        // 다른 디텍터의 굽힘 이벤트 직후 — 누적만 멈춘다. 리셋하면 오인식 한 번에 유지 시간이 날아간다
      } else if (holding) {
        track.ms += dt;
        if (track.state === 'pending' && track.ms >= HOLD_MIN_MS) {
          if (isHoldSuppressed(log, id)) {
            track.state = 'dropped';
          } else {
            track.state = 'logged';
            const snap = debugRef.current
              ? captureSnapshot(det, frame, startedAtRef.current, videoRef.current)
              : undefined;
            commit(addHoldMs(log, id, track.ms, snap));
            speak(`${EXERCISES[id].nameKo} ${Math.floor(track.ms / 1000)}초`);
          }
        } else if (track.state === 'logged' && dt > 0) {
          // 자기 구간이 마지막일 때만 이어 쌓는다. 다른 구간이 끼어들었거나(동시에 유지된 다른 hold,
          // 풀업이 데드행을 지운 경우) 하면 이번 hold 는 끝난 것으로 보고 새 구간을 만들지 않는다.
          const last = log.segments[log.segments.length - 1];
          if (last?.exerciseId === id) commit(addHoldMs(log, id, dt));
          else track.state = 'dropped';
        }
      } else if (track.ms > 0) {
        if (track.state === 'logged') {
          speak(`${EXERCISES[id].nameKo} ${Math.floor(track.ms / 1000)}초`);
        }
        holdRef.current[id] = { ms: 0, state: 'pending' };
      }
    }

    if (traceRow) {
      lastTraceTRef.current = frame.t;
      traceRef.current.push(traceRow);
    }

    if (log !== freeLogRef.current) {
      freeLogRef.current = log;
      if (segmentsChanged || frame.t - lastUiTRef.current > UI_INTERVAL_MS) {
        lastUiTRef.current = frame.t;
        setFreeLog(log);
      }
    }
  }, []);

  // 시작 버튼 — iOS 제스처 요구사항 때문에 카메라/음성 모두 여기서 시작
  const handleStart = async () => {
    setLoading(true);
    setCamError(null);
    primeVoice();
    primeBeep();
    try {
      await startCamera(videoRef.current!);
    } catch {
      setCamError('카메라를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.');
      setLoading(false);
      return;
    }
    try {
      const engine = new PoseEngine();
      await engine.init(videoRef.current!);
      engineRef.current = engine;
      detectorsRef.current = FREE_EXERCISES.map((id) => ({ id, det: EXERCISES[id].create() }));
      engine.start(onFrame);
    } catch (e) {
      console.error(e);
      setCamError('포즈 인식 모델을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
      setLoading(false);
      return;
    }
    requestWakeLock();
    setStarted(true);
    setLoading(false);
    sessionIdRef.current = crypto.randomUUID();
    startedAtRef.current = Date.now();
    speak('자유 운동 시작. 동작을 알아서 구분해 셉니다');
  };

  // 새 구간이 추가되면 로그를 맨 아래로
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [freeLog.segments.length]);

  // 언마운트 정리
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      engineRef.current?.destroy();
      stopCamera(video);
      releaseWakeLock();
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    };
  }, []);

  const activeTotals = FREE_EXERCISES.filter((id) => (freeLog.totals[id] ?? 0) > 0);

  return (
    <div className="fixed inset-0 overflow-hidden bg-neutral-950 text-neutral-100">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100" />

      {!started && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-neutral-950/90 p-6 text-center">
          <div className="mb-4 text-6xl">🏃</div>
          <h1 className="mb-2 text-3xl font-black">자유 운동</h1>
          <p className="mb-8 max-w-sm text-neutral-400">
            루틴 없이 하고 싶은 대로 움직이세요. 스쿼트·푸시업·풀업·로우는 횟수로, 플랭크·사이드
            플랭크·한발 서기·데드행은 초로 알아서 셉니다.
          </p>
          {camError && <p className="mb-4 font-semibold text-red-400">{camError}</p>}
          <button
            onClick={handleStart}
            disabled={loading}
            className="rounded-3xl bg-green-500 px-12 py-5 text-2xl font-black text-black active:bg-green-400 disabled:opacity-50"
          >
            {loading ? '모델 로딩 중…' : '시작'}
          </button>
        </div>
      )}

      {debug && (
        <div className="absolute left-2 top-2 z-40 max-h-[60vh] overflow-y-auto rounded-lg bg-black/70 p-2 font-mono text-[10px] leading-tight text-green-300">
          <div>fps {fps}</div>
          {debugStates.map(({ id, st }) => (
            <div key={id} className={st.holding || st.reps > 0 ? 'text-yellow-300' : ''}>
              {id} {st.kind === 'rep' ? `reps=${st.reps}` : `hold=${st.holding ? 'Y' : 'n'}`}
              {!st.confident ? ' lowconf' : ''}{' '}
              {Object.entries(st.debug)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')}
            </div>
          ))}
        </div>
      )}

      {started && (
        <>
          {/* 상단 고정 합계 — 한 번이라도 잡힌 운동만 */}
          <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap justify-center gap-x-5 gap-y-1 bg-gradient-to-b from-black/80 to-transparent px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6">
            {activeTotals.length === 0 ? (
              <p className="text-neutral-300">움직이면 합계가 표시됩니다</p>
            ) : (
              activeTotals.map((id) => (
                <div key={id} className="text-center">
                  <div className="text-sm text-neutral-300">
                    {EXERCISES[id].cameraIcon} {EXERCISES[id].nameKo}
                  </div>
                  <div className="text-4xl font-black tabular-nums text-green-400 drop-shadow">
                    {formatValue(EXERCISES[id].kind, freeLog.totals[id] ?? 0)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 하단 구간 로그 — 새 구간마다 자동 스크롤 */}
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-8">
            <div ref={logRef} className="max-h-[32vh] overflow-y-auto px-6">
              {freeLog.segments.length === 0 ? (
                <p className="py-3 text-center text-neutral-400">움직이면 여기에 기록됩니다</p>
              ) : (
                freeLog.segments.map((seg, i) => (
                  <div
                    key={i}
                    className={`flex items-baseline justify-between py-1.5 text-2xl font-bold tabular-nums ${
                      i === freeLog.segments.length - 1 ? 'text-white' : 'text-neutral-400'
                    }`}
                  >
                    <span>
                      {EXERCISES[seg.exerciseId].cameraIcon} {EXERCISES[seg.exerciseId].nameKo}
                    </span>
                    <span>{formatValue(seg.kind, seg.value)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                onClick={() => setPaused((p) => !p)}
                className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold backdrop-blur active:bg-white/25"
              >
                {paused ? '▶ 재개' : '⏸ 일시정지'}
              </button>
              <button
                onClick={finish}
                disabled={saving}
                className="rounded-xl bg-red-500/20 px-4 py-2.5 text-sm font-semibold text-red-300 backdrop-blur active:bg-red-500/40 disabled:opacity-50"
              >
                {saving ? '저장 중…' : '종료'}
              </button>
            </div>
          </div>

          {paused && !bundle && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
              <div className="text-4xl font-black">⏸ 일시정지</div>
            </div>
          )}

          {bundle && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-neutral-950/95 p-6 text-center">
              <div className="text-4xl">🧪</div>
              <h2 className="text-2xl font-black">디버그 묶음</h2>
              <p className="max-w-sm text-neutral-400">
                사진 {freeLog.segments.filter((s) => s.debug?.photo).length}장, 디텍터 추적{' '}
                {bundle.traceRows}줄, 세션 데이터, 뷰어 HTML을 한 폴더로 묶었습니다 (
                {Math.round(bundle.file.size / 1024)}KB). 서버로는 보내지 않으며, 나가면 사라집니다.
              </p>
              <button
                onClick={shareBundle}
                className="rounded-2xl bg-green-500 px-8 py-4 text-lg font-bold text-black active:bg-green-400"
              >
                AirDrop으로 보내기
              </button>
              <button onClick={() => router.push('/')} className="text-sm text-neutral-500 underline">
                그냥 나가기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
