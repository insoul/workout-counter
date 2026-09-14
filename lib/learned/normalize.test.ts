import { describe, expect, it } from 'vitest';
import { frameDistance, mirrorFrame, normalizeFrame, JOINTS } from './normalize';

/** 서 있는 사람 비슷한 합성 프레임: 어깨 y=0.3, 엉덩이 y=0.5, 무릎 0.7, 발목 0.9 */
function standing(vis = 1): number[] {
  const f = new Array(JOINTS * 4).fill(0);
  const set = (j: number, x: number, y: number, v = vis) => {
    f[j * 4] = x; f[j * 4 + 1] = y; f[j * 4 + 2] = 0; f[j * 4 + 3] = v;
  };
  set(0, 0.5, 0.15);
  set(11, 0.6, 0.3); set(12, 0.4, 0.3);
  set(13, 0.62, 0.42); set(14, 0.38, 0.42);
  set(15, 0.63, 0.54); set(16, 0.37, 0.54);
  set(23, 0.56, 0.5); set(24, 0.44, 0.5);
  set(25, 0.57, 0.7); set(26, 0.43, 0.7);
  set(27, 0.58, 0.9); set(28, 0.42, 0.9);
  return f;
}

function shifted(f: number[], dx: number, dy: number, scale = 1): number[] {
  const g = [...f];
  for (let j = 0; j < JOINTS; j++) { g[j * 4] = f[j * 4] * scale + dx; g[j * 4 + 1] = f[j * 4 + 1] * scale + dy; }
  return g;
}

describe('normalizeFrame', () => {
  it('이동·크기에 불변이다', () => {
    const a = normalizeFrame(standing())!;
    const b = normalizeFrame(shifted(standing(), 0.3, -0.1))!;
    const c = normalizeFrame(shifted(standing(), 0, 0, 2))!;
    expect(frameDistance(a, b)).toBeLessThan(1e-5);
    expect(frameDistance(a, c)).toBeLessThan(1e-5);
  });
  it('신뢰도 낮은 관절은 마스크가 0 이고, 기준 관절이 안 보이면 null', () => {
    const f = standing();
    f[13 * 4 + 3] = 0.2; // 왼 팔꿈치
    const n = normalizeFrame(f)!;
    expect(n.mask[13]).toBe(0);
    expect(n.mask[11]).toBe(1);
    f[23 * 4 + 3] = 0.1; // 왼 엉덩이
    expect(normalizeFrame(f)).toBeNull();
  });
  it('엉덩이 중점이 원점, 몸통 길이가 1', () => {
    const n = normalizeFrame(standing())!;
    const hipX = (n.vec[23 * 2] + n.vec[24 * 2]) / 2;
    const hipY = (n.vec[23 * 2 + 1] + n.vec[24 * 2 + 1]) / 2;
    expect(Math.abs(hipX)).toBeLessThan(1e-6);
    expect(Math.abs(hipY)).toBeLessThan(1e-6);
    const shY = (n.vec[11 * 2 + 1] + n.vec[12 * 2 + 1]) / 2;
    expect(Math.abs(shY + 1)).toBeLessThan(1e-6); // 어깨는 엉덩이보다 위(y 음수) 로 몸통 길이 1
  });
});

describe('mirrorFrame', () => {
  it('x 부호를 뒤집고 좌우 관절을 교환한다', () => {
    const n = normalizeFrame(standing())!;
    const m = mirrorFrame(n);
    expect(m.vec[11 * 2]).toBeCloseTo(-n.vec[12 * 2], 6);
    expect(m.vec[11 * 2 + 1]).toBeCloseTo(n.vec[12 * 2 + 1], 6);
    expect(m.vec[0]).toBeCloseTo(-n.vec[0], 6); // 코는 자기 자리에서 부호만
    expect(frameDistance(n, mirrorFrame(m))).toBeLessThan(1e-6); // 두 번 뒤집으면 원상
  });
});

describe('frameDistance', () => {
  it('자기 자신과는 0, 공통 관절이 없으면 Infinity', () => {
    const n = normalizeFrame(standing())!;
    expect(frameDistance(n, n)).toBe(0);
    const empty = { vec: n.vec, mask: new Uint8Array(JOINTS) };
    expect(frameDistance(n, empty)).toBe(Infinity);
  });
});
