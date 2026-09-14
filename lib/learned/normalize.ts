/**
 * 프레임(33 관절 × x, y, z, visibility) → 카메라 위치·거리에 무관한 66차원 벡터.
 * 1) 신뢰도 minVis 미만 관절은 마스크(0)로 두고 좌표를 0으로 둔다
 * 2) 엉덩이 중점을 원점으로 옮긴다
 * 3) 몸통 길이(어깨 중점~엉덩이 중점)로 나눠 크기를 맞춘다
 * 4) z 는 흔들림이 커 버리고 x, y 만 쓴다
 */
export const JOINTS = 33;
export const VEC_DIM = JOINTS * 2;

const L_SHOULDER = 11, R_SHOULDER = 12, L_HIP = 23, R_HIP = 24;

/** 좌우 대칭 관절 쌍 — 반전 증강 때 서로 바꾼다 */
const MIRROR_PAIRS: [number, number][] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10],
  [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

export interface NormalizedFrame {
  vec: Float32Array; // 66: [x0, y0, x1, y1, ...]
  mask: Uint8Array; // 33: 1 = 보임
}

/** 기준(엉덩이·어깨)이 안 보이면 null */
export function normalizeFrame(frame: number[], minVis = 0.3): NormalizedFrame | null {
  if (frame.length < JOINTS * 4) return null;
  const vis = (j: number) => frame[j * 4 + 3];
  if ([L_SHOULDER, R_SHOULDER, L_HIP, R_HIP].some((j) => vis(j) < minVis)) return null;

  const x = (j: number) => frame[j * 4];
  const y = (j: number) => frame[j * 4 + 1];
  const cx = (x(L_HIP) + x(R_HIP)) / 2;
  const cy = (y(L_HIP) + y(R_HIP)) / 2;
  const sx = (x(L_SHOULDER) + x(R_SHOULDER)) / 2;
  const sy = (y(L_SHOULDER) + y(R_SHOULDER)) / 2;
  const torso = Math.hypot(sx - cx, sy - cy);
  if (torso < 1e-4) return null;

  const vec = new Float32Array(VEC_DIM);
  const mask = new Uint8Array(JOINTS);
  for (let j = 0; j < JOINTS; j++) {
    if (vis(j) < minVis) continue;
    mask[j] = 1;
    vec[j * 2] = (x(j) - cx) / torso;
    vec[j * 2 + 1] = (y(j) - cy) / torso;
  }
  return { vec, mask };
}

/** 좌우 반전 사본 — x 부호를 뒤집고 좌우 관절을 서로 바꾼다 */
export function mirrorFrame(f: NormalizedFrame): NormalizedFrame {
  const vec = new Float32Array(f.vec);
  const mask = new Uint8Array(f.mask);
  for (let j = 0; j < JOINTS; j++) vec[j * 2] = -vec[j * 2];
  for (const [a, b] of MIRROR_PAIRS) {
    for (const d of [0, 1]) {
      const t = vec[a * 2 + d];
      vec[a * 2 + d] = vec[b * 2 + d];
      vec[b * 2 + d] = t;
    }
    const m = mask[a];
    mask[a] = mask[b];
    mask[b] = m;
  }
  return { vec, mask };
}

/** 두 프레임 거리 — 양쪽 다 보이는 관절만, 관절 수로 나눠 정규화. 공통 관절이 없으면 Infinity */
export function frameDistance(a: NormalizedFrame, b: NormalizedFrame): number {
  let sum = 0;
  let n = 0;
  for (let j = 0; j < JOINTS; j++) {
    if (!a.mask[j] || !b.mask[j]) continue;
    const dx = a.vec[j * 2] - b.vec[j * 2];
    const dy = a.vec[j * 2 + 1] - b.vec[j * 2 + 1];
    sum += dx * dx + dy * dy;
    n++;
  }
  return n ? Math.sqrt(sum / n) : Infinity;
}
