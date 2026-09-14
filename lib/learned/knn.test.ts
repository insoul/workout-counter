import { describe, expect, it } from 'vitest';
import { buildDataset, classify, Ema } from './knn';
import { JOINTS, VEC_DIM } from './normalize';
import type { LabeledVector } from './types';

function vecAround(center: number, jitter: number, seed: number): Float32Array {
  const v = new Float32Array(VEC_DIM);
  for (let i = 0; i < VEC_DIM; i++) v[i] = center + jitter * Math.sin(seed * 7.1 + i * 1.3);
  return v;
}
const fullMask = () => new Uint8Array(JOINTS).fill(1);
const point = (state: 'top' | 'bottom', center: number, seed: number): LabeledVector => ({
  exerciseId: 'squat', state, vec: vecAround(center, 0.05, seed), mask: fullMask(), sampleId: `s${seed}`, frame: seed,
});

describe('classify', () => {
  const ds = buildDataset([
    ...Array.from({ length: 10 }, (_, i) => point('top', 0, i)),
    ...Array.from({ length: 10 }, (_, i) => point('bottom', 2, 100 + i)),
  ]);
  it('반전 증강으로 점이 두 배, 클래스에 none 포함', () => {
    expect(ds.vectors.length).toBe(40);
    expect(ds.classes).toEqual(expect.arrayContaining(['squat:top', 'squat:bottom', 'none']));
  });
  it('top 군집 근처 질의는 top, bottom 근처는 bottom', () => {
    const q1 = classify(ds, { vec: vecAround(0.02, 0.01, 999), mask: fullMask() });
    expect(q1.probs['squat:top']).toBeGreaterThanOrEqual(0.8);
    expect(q1.nearest?.sampleId.startsWith('s')).toBe(true);
    const q2 = classify(ds, { vec: vecAround(2.01, 0.01, 998), mask: fullMask() });
    expect(q2.probs['squat:bottom']).toBeGreaterThanOrEqual(0.8);
    expect(q2.probs.none).toBe(0);
  });
  it('빈 데이터셋이면 none 1', () => {
    const q = classify(buildDataset([]), { vec: vecAround(0, 0, 1), mask: fullMask() });
    expect(q.probs).toEqual({ none: 1 });
    expect(q.nearest).toBeNull();
  });
});

describe('Ema', () => {
  it('첫 값은 그대로, 튀는 프레임은 alpha 만큼만 반영', () => {
    const e = new Ema(0.3);
    expect(e.update({ a: 1, b: 0 })).toEqual({ a: 1, b: 0 });
    const r = e.update({ a: 0, b: 1 });
    expect(r.a).toBeCloseTo(0.7, 6);
    expect(r.b).toBeCloseTo(0.3, 6);
    e.reset();
    expect(e.update({ a: 0, b: 1 })).toEqual({ a: 0, b: 1 });
  });
});
