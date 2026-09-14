import type { Dataset } from '@/lib/learned/knn';
import { EXERCISES, type ExerciseId } from './registry';
import { createLearnedDetector } from './learned';
import type { ExerciseDetector } from './types';

/** 학습 디텍터로 바꾸는 최소 샘플 수 */
export const MIN_SAMPLES = 10;
export const MIN_NONE = 5;

export type SampleCounts = Partial<Record<string, number>>;

export function hasEnoughSamples(counts: SampleCounts, id: ExerciseId): boolean {
  return (counts[id] ?? 0) >= MIN_SAMPLES && (counts.none ?? 0) >= MIN_NONE;
}

/**
 * 운동별로 학습 디텍터 또는 규칙 디텍터를 고른다.
 * 샘플이 부족하거나, 데이터셋이 없거나(오프라인·미로그인), 규칙 강제가 켜져 있으면 규칙.
 */
export function createDetectorFor(
  id: ExerciseId,
  ds: Dataset | null,
  counts: SampleCounts,
  forceRules = false,
): ExerciseDetector {
  const meta = EXERCISES[id];
  if (!forceRules && ds && hasEnoughSamples(counts, id)) {
    return createLearnedDetector(id, meta.kind, ds, meta.requiredChains);
  }
  return meta.create();
}
