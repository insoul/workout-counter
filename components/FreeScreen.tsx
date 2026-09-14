'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EXERCISES, type ExerciseId } from '@/lib/detectors/registry';
import type { ExerciseDetector, PoseFrame } from '@/lib/detectors/types';
import { startCamera, stopCamera } from '@/lib/camera';
import { addRep, EMPTY_LOG, startedNewSegment, type FreeLog } from '@/lib/free/log';
import { PoseEngine } from '@/lib/pose/engine';
import { drawPose } from '@/lib/pose/draw';
import { ding, primeBeep } from '@/lib/speech/beep';
import { koCount } from '@/lib/speech/phrases.ko';
import { primeVoice, speak } from '@/lib/speech/voice';
import { releaseWakeLock, requestWakeLock } from '@/lib/wakeLock';

/** 동시에 돌리는 디텍터. 서로 자세 게이트가 있어 섞이지 않는 rep 운동만 */
const FREE_EXERCISES: ExerciseId[] = ['squat', 'pushup', 'pullup'];

/**
 * 스쿼트 바닥 진입 후 이 시간이 지나 올라온 rep 은 무시한다.
 * 푸시업 하러 바닥에 내려갔다 일어서는 동작이 스쿼트 1회로 잡히는 것을 막는다.
 * 실제 스쿼트는 바닥에 2초 이상 머물지 않는다.
 */
const SQUAT_MAX_BOTTOM_MS = 4000;

export default function FreeScreen() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const detectorsRef = useRef<{ id: ExerciseId; det: ExerciseDetector }[]>([]);
  const bottomAtRef = useRef<Partial<Record<ExerciseId, number>>>({});
  const freeLogRef = useRef<FreeLog>(EMPTY_LOG);
  const pausedRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [freeLog, setFreeLog] = useState<FreeLog>(EMPTY_LOG);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const onFrame = useCallback((frame: PoseFrame) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (canvas && video) drawPose(canvas, video, frame, frame.lm.length ? 'good' : 'idle');
    if (pausedRef.current) return;

    for (const { id, det } of detectorsRef.current) {
      for (const e of det.update(frame)) {
        if (e.type === 'phase' && e.phase === 'bottom') {
          bottomAtRef.current[id] = frame.t;
          ding();
        } else if (e.type === 'rep') {
          const bottomAt = bottomAtRef.current[id];
          if (id === 'squat' && bottomAt != null && frame.t - bottomAt > SQUAT_MAX_BOTTOM_MS) {
            continue;
          }
          const before = freeLogRef.current;
          const after = addRep(before, id);
          freeLogRef.current = after;
          setFreeLog(after);
          const count = after.segments[after.segments.length - 1].count;
          const name = startedNewSegment(before, after) ? `${EXERCISES[id].nameKo}, ` : '';
          speak(`${name}${koCount(count)}`, 'count');
        }
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
    speak('자유 운동 시작. 스쿼트, 푸시업, 풀업을 인식합니다');
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
            루틴 없이 하고 싶은 대로 움직이세요. 스쿼트·푸시업·풀업을 알아서 구분해 셉니다.
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
          {/* 상단 고정 합계 */}
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center gap-5 bg-gradient-to-b from-black/80 to-transparent px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6">
            {FREE_EXERCISES.map((id) => (
              <div key={id} className="text-center">
                <div className="text-sm text-neutral-300">
                  {EXERCISES[id].cameraIcon} {EXERCISES[id].nameKo}
                </div>
                <div className="text-5xl font-black tabular-nums text-green-400 drop-shadow">
                  {freeLog.totals[id] ?? 0}
                </div>
              </div>
            ))}
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
                    <span>{seg.count}</span>
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
                onClick={() => router.push('/')}
                className="rounded-xl bg-red-500/20 px-4 py-2.5 text-sm font-semibold text-red-300 backdrop-blur active:bg-red-500/40"
              >
                종료
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
