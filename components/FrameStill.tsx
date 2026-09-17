'use client';

import { useEffect, useRef, useState } from 'react';
import PoseFigure from './PoseFigure';

/**
 * 손잡이 하나의 정지화면 — 영상 프레임 위에 관절을 겹친다.
 * 영상이 없으면 관절만 검은 배경에. 라이브 화면과 같이 좌우를 뒤집어 보여준다.
 */
export default function FrameStill({
  label,
  time,
  row,
  aspect,
  active,
  draw,
  onClick,
}: {
  label: string;
  /** 영상 안의 시각(초). null 이면 영상 없음 */
  time: number | null;
  row: number[] | null;
  aspect: number;
  active: boolean;
  draw: ((time: number, canvas: HTMLCanvasElement) => Promise<boolean>) | null;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wantRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const drawnRef = useRef<number | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  // 손잡이가 빠르게 움직여도 마지막 시각만 그린다 (앞선 요청은 건너뛴다)
  useEffect(() => {
    wantRef.current = time;
    if (!draw || time == null || busyRef.current) return;
    const run = async () => {
      busyRef.current = true;
      try {
        while (wantRef.current != null && wantRef.current !== drawnRef.current) {
          const t = wantRef.current;
          const canvas = canvasRef.current;
          if (!canvas) break;
          const ok = await draw(t, canvas);
          drawnRef.current = t;
          setHasFrame(ok);
        }
      } finally {
        busyRef.current = false;
      }
    };
    void run();
  }, [time, draw]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 rounded-xl p-1 text-xs ${
        active ? 'bg-green-500/20 text-white ring-2 ring-green-500' : 'text-neutral-400'
      }`}
    >
      <span className="font-semibold">{label}</span>
      <div className="relative w-full overflow-hidden rounded-lg bg-black -scale-x-100" style={{ aspectRatio: `1 / ${aspect}` }}>
        <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${hasFrame ? '' : 'hidden'}`} />
        <PoseFigure row={row} aspect={aspect} overlay />
      </div>
      <span className="font-mono">{time != null ? `${Math.max(0, time).toFixed(1)}s` : '—'}</span>
    </button>
  );
}
