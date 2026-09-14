import { frameDistance, mirrorFrame, type NormalizedFrame } from './normalize';
import { classKey, type LabeledVector } from './types';

export interface Dataset {
  vectors: LabeledVector[];
  /** 등장하는 클래스 키 전부 — 확률 객체의 키 집합을 고정하기 위해 */
  classes: string[];
}

export const DEFAULT_K = 5;

/** 데이터셋 구성. 좌우 반전 사본을 더해 카메라 좌우 배치에 무관하게 만든다 */
export function buildDataset(vectors: LabeledVector[]): Dataset {
  const out: LabeledVector[] = [];
  const classes = new Set<string>(['none']);
  for (const v of vectors) {
    classes.add(classKey(v.exerciseId, v.state));
    out.push(v);
    const m = mirrorFrame({ vec: v.vec, mask: v.mask });
    out.push({ ...v, vec: m.vec, mask: m.mask });
  }
  return { vectors: out, classes: [...classes] };
}

export interface Classification {
  /** 클래스별 확률(k 표 중 비율). 데이터셋이 비면 { none: 1 } */
  probs: Record<string, number>;
  nearest: { sampleId: string; frame: number; dist: number } | null;
}

/** k 최근접 표결 */
export function classify(ds: Dataset, f: NormalizedFrame, k = DEFAULT_K): Classification {
  const probs: Record<string, number> = {};
  for (const c of ds.classes) probs[c] = 0;
  if (!ds.vectors.length) return { probs: { ...probs, none: 1 }, nearest: null };

  // 상위 k 개만 유지하는 삽입 정렬 — 데이터셋 수천 개에 프레임마다 돌려도 가볍다
  const top: { d: number; v: LabeledVector }[] = [];
  for (const v of ds.vectors) {
    const d = frameDistance(f, { vec: v.vec, mask: v.mask });
    if (!Number.isFinite(d)) continue;
    if (top.length < k || d < top[top.length - 1].d) {
      let i = top.length;
      top.push({ d, v });
      while (i > 0 && top[i - 1].d > d) {
        top[i] = top[i - 1];
        i--;
      }
      top[i] = { d, v };
      if (top.length > k) top.pop();
    }
  }
  if (!top.length) return { probs: { ...probs, none: 1 }, nearest: null };
  for (const { v } of top) probs[classKey(v.exerciseId, v.state)] += 1 / top.length;
  const n = top[0];
  return { probs, nearest: { sampleId: n.v.sampleId, frame: n.v.frame, dist: n.d } };
}

/** 확률 지수 이동 평균 — 한 프레임 튐을 눌러 상태 전이를 안정시킨다 */
export class Ema {
  private cur: Record<string, number> | null = null;
  constructor(private alpha = 0.3) {}

  update(p: Record<string, number>): Record<string, number> {
    if (!this.cur) {
      this.cur = { ...p };
      return { ...this.cur };
    }
    const keys = new Set([...Object.keys(this.cur), ...Object.keys(p)]);
    for (const k of keys) {
      this.cur[k] = (1 - this.alpha) * (this.cur[k] ?? 0) + this.alpha * (p[k] ?? 0);
    }
    return { ...this.cur };
  }

  reset() {
    this.cur = null;
  }
}
