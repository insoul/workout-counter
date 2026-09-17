'use client';

import { POSE_EDGES } from '@/lib/pose/landmarks';

const MIN_VIS = 0.5;

/** 샘플 프레임(33×4, 화면 정규화 좌표) 하나를 막대 인형으로. 신뢰도 낮은 점은 빨강 */
export default function PoseFigure({
  row,
  width = 200,
  aspect = 4 / 3,
  className = '',
  overlay = false,
}: {
  row: number[] | null;
  width?: number;
  /** 세로/가로 비율 — 비디오 실제 비율을 넘기면 왜곡이 없다 */
  aspect?: number;
  className?: string;
  /** true 면 배경 없이 부모를 꽉 채우는 겹침용 — 영상 프레임 위에 얹는다 */
  overlay?: boolean;
}) {
  const h = Math.round(width * aspect);
  const pt = (j: number) => (row ? { x: row[j * 4] * width, y: row[j * 4 + 1] * h, v: row[j * 4 + 3] } : null);
  return (
    <svg
      viewBox={`0 0 ${width} ${h}`}
      {...(overlay ? {} : { width, height: h })}
      className={overlay ? `absolute inset-0 h-full w-full ${className}` : `rounded-lg bg-black ${className}`}
    >
      {row &&
        POSE_EDGES.map(([a, b]) => {
          const pa = pt(a)!;
          const pb = pt(b)!;
          if (pa.v < MIN_VIS || pb.v < MIN_VIS) return null;
          return (
            <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="rgb(74 222 128)" strokeWidth={2} strokeLinecap="round" />
          );
        })}
      {row &&
        Array.from({ length: 33 }, (_, j) => j)
          .filter((j) => j === 0 || j >= 11)
          .map((j) => {
            const p = pt(j)!;
            const low = p.v < MIN_VIS;
            return <circle key={j} cx={p.x} cy={p.y} r={2.5} fill={low ? 'rgb(248 113 113)' : 'rgb(74 222 128)'} opacity={low ? 0.6 : 1} />;
          })}
    </svg>
  );
}
