'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EXERCISES, type ExerciseId } from '@/lib/detectors/registry';
import type { ExerciseDetector, PoseFrame } from '@/lib/detectors/types';
import { startCamera, stopCamera } from '@/lib/camera';
import {
  addHoldMs,
  addRep,
  EMPTY_LOG,
  formatValue,
  startedNewSegment,
  type FreeLog,
} from '@/lib/free/log';
import { PoseEngine } from '@/lib/pose/engine';
import { drawPose } from '@/lib/pose/draw';
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

/** 이보다 짧은 hold 는 로그에 올리지 않는다 — 자세 전환 중 스치는 시간을 걸러낸다 */
const HOLD_MIN_MS = 3000;

/** 프레임 루프에서 화면 갱신 최소 간격 */
const UI_INTERVAL_MS = 250;

interface HoldTrack {
  /** 이번 hold 에서 쌓인 ms (로그 반영 전 포함) */
  ms: number;
  /** HOLD_MIN_MS 를 넘겨 로그에 올라갔는지 */
  committed: boolean;
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
    if (pausedRef.current) {
      lastFrameTRef.current = null;
      return;
    }
    // 탭 전환/일시정지 후 큰 시간 점프는 100ms로 캡
    const dt = lastFrameTRef.current == null ? 0 : Math.min(frame.t - lastFrameTRef.current, 100);
    lastFrameTRef.current = frame.t;

    let log = freeLogRef.current;
    let segmentsChanged = false;

    const commit = (next: FreeLog) => {
      if (startedNewSegment(log, next)) segmentsChanged = true;
      log = next;
    };

    for (const { id, det } of detectorsRef.current) {
      const events = det.update(frame);
      if (det.kind === 'rep') {
        for (const e of events) {
          if (e.type === 'phase' && e.phase === 'bottom') {
            bottomAtRef.current[id] = frame.t;
            lastMotionTRef.current = frame.t;
            ding();
          } else if (e.type === 'rep') {
            lastMotionTRef.current = frame.t;
            const bottomAt = bottomAtRef.current[id];
            if (id === 'squat' && bottomAt != null && frame.t - bottomAt > SQUAT_MAX_BOTTOM_MS) {
              continue;
            }
            const before = log;
            commit(addRep(before, id));
            const count = log.segments[log.segments.length - 1].value;
            const name = startedNewSegment(before, log) ? `${EXERCISES[id].nameKo}, ` : '';
            speak(`${name}${koCount(count)}`, 'count');
          }
        }
        continue;
      }

      // hold 운동: 자세 유지 중이고 rep 움직임이 잠잠할 때만 시간을 쌓는다
      const track = (holdRef.current[id] ??= { ms: 0, committed: false });
      const quiet = frame.t - lastMotionTRef.current > HOLD_QUIET_MS;
      if (det.state().holding && quiet) {
        track.ms += dt;
        if (!track.committed && track.ms >= HOLD_MIN_MS) {
          track.committed = true;
          commit(addHoldMs(log, id, track.ms));
          speak(`${EXERCISES[id].nameKo} 시작`);
        } else if (track.committed && dt > 0) {
          commit(addHoldMs(log, id, dt));
        }
      } else if (track.ms > 0) {
        if (track.committed) {
          speak(`${EXERCISES[id].nameKo} ${Math.floor(track.ms / 1000)}초`);
        }
        holdRef.current[id] = { ms: 0, committed: false };
      }
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

          {paused && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
              <div className="text-4xl font-black">⏸ 일시정지</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
