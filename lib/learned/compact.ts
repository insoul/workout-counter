import { EXERCISES } from '@/lib/detectors/registry';
import { labelSample, thinDataset } from './label';
import type { LabeledVector, PoseSample, SampleKind } from './types';

/** 전송용 벡터 — TypedArray 대신 number[] */
export interface CompactVector {
  exerciseId: LabeledVector['exerciseId'];
  state: LabeledVector['state'];
  vec: number[];
  mask: number[];
  sampleId: string;
  frame: number;
}

export function kindOf(exerciseId: PoseSample['exerciseId']): SampleKind {
  return exerciseId === 'none' ? 'none' : EXERCISES[exerciseId].kind;
}

/** 서버에서: 원본 샘플들 → 라벨·솎기까지 끝난 벡터 목록 + 운동별 샘플 수 */
export function buildCompact(samples: PoseSample[]): { dataset: CompactVector[]; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const all: LabeledVector[] = [];
  for (const s of samples) {
    counts[s.exerciseId] = (counts[s.exerciseId] ?? 0) + 1;
    all.push(...labelSample({ ...s, kind: kindOf(s.exerciseId) }));
  }
  const dataset = thinDataset(all).map((v) => ({
    exerciseId: v.exerciseId,
    state: v.state,
    vec: Array.from(v.vec, (n) => Math.round(n * 1000) / 1000),
    mask: Array.from(v.mask),
    sampleId: v.sampleId,
    frame: v.frame,
  }));
  return { dataset, counts };
}

/** 브라우저에서: 전송용 → kNN 용 TypedArray */
export function inflateCompact(dataset: CompactVector[]): LabeledVector[] {
  return dataset.map((v) => ({ ...v, vec: Float32Array.from(v.vec), mask: Uint8Array.from(v.mask) }));
}
