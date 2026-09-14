import { describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/learned/knn';
import { createDetectorFor, hasEnoughSamples } from './factory';

const ds = buildDataset([]);

describe('createDetectorFor', () => {
  it('샘플이 부족하면 규칙 디텍터', () => {
    const det = createDetectorFor('squat', ds, { squat: 3, none: 5 });
    expect(det.id).toBe('squat');
    expect(det.state().debug.mode).toBeUndefined();
  });
  it('충분하면 학습 디텍터, 규칙 강제면 규칙', () => {
    const counts = { squat: 10, none: 5 };
    expect(hasEnoughSamples(counts, 'squat')).toBe(true);
    expect(createDetectorFor('squat', ds, counts).state().debug.mode).toBe('learned');
    expect(createDetectorFor('squat', ds, counts, true).state().debug.mode).toBeUndefined();
    expect(createDetectorFor('squat', null, counts).state().debug.mode).toBeUndefined();
  });
  it('none 샘플이 부족하면 규칙', () => {
    expect(hasEnoughSamples({ squat: 30, none: 2 }, 'squat')).toBe(false);
  });
});
