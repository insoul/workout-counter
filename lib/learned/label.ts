import { frameDistance, normalizeFrame, type NormalizedFrame } from './normalize';
import type { LabeledVector, SampleExercise, SampleKind, SampleMarks, SampleState } from './types';

/** 프레임 선택 간격 — 원본은 30fps 전부 저장돼 있으니 여기만 바꾸면 된다 */
export const PICK_INTERVAL_MS = 100;
/** 샘플당 상태별 상한 — 느린 동작이 빠른 동작보다 과대표되지 않게 */
export const PER_STATE_CAP = 20;
/** 전체 데이터셋의 (운동, 상태)별 상한 — kNN 거리 계산량의 천장 */
export const CLASS_CAP = 300;

/**
 * rep: top 기준 프레임과의 거리가 D(top~bottom 거리)의 25% 이하면 top,
 * bottom 기준 프레임과의 거리가 D 의 30% 이하면 bottom. 사이는 이동 중이라 버린다.
 * 구간 밖 프레임은 둘 다와 먼 자세(둘 다 50% 초과)일 때만 none — 스쿼트 전에 서 있던 프레임은
 * top 과 같은 자세라 none 으로 두면 kNN 에서 top 과 충돌한다.
 */
const TOP_RATIO = 0.25;
const BOTTOM_NEAR_RATIO = 0.3;
const OUTSIDE_NONE_RATIO = 0.5;
/** hold: 구간 밖 프레임이 유지 자세와 이 거리(정규화 단위) 안이면 none 으로 두지 않는다 */
const HOLD_NEAR_DIST = 0.25;

export interface SampleForLabel {
  id: string;
  exerciseId: SampleExercise;
  kind: SampleKind;
  fps: number;
  frames: number[][];
  marks: SampleMarks;
}

function normalizeAll(frames: number[][]): (NormalizedFrame | null)[] {
  return frames.map((f) => normalizeFrame(f));
}

/** 구간 안에서 기준 프레임과 가장 먼 프레임 번호. 정규화 불가 프레임은 건너뛴다 */
function farthestFrom(norm: (NormalizedFrame | null)[], ref: number, start: number, end: number): number {
  const base = norm[ref];
  if (!base) return Math.round((start + end) / 2);
  let best = ref;
  let bestD = -1;
  for (let i = start; i <= end; i++) {
    const n = norm[i];
    if (!n) continue;
    const d = frameDistance(base, n);
    if (Number.isFinite(d) && d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 첫 정규화 가능 프레임 */
function firstValid(norm: (NormalizedFrame | null)[], from: number, to: number): number {
  for (let i = from; i <= to; i++) if (norm[i]) return i;
  return from;
}

/**
 * 타임라인 손잡이의 기본 위치. 최종 라벨은 사용자가 옮긴 표시를 따른다.
 * rep: 전체 구간, bottom 은 시작 자세와 가장 먼 프레임 · hold: 앞뒤 20% 제외 · none: 전체
 */
export function defaultMarks(frames: number[][], kind: SampleKind): SampleMarks {
  const last = Math.max(0, frames.length - 1);
  if (kind === 'hold') {
    const trim = Math.floor(frames.length * 0.2);
    return { start: trim, end: Math.max(trim, last - trim) };
  }
  if (kind === 'none') return { start: 0, end: last };
  const norm = normalizeAll(frames);
  const ref = firstValid(norm, 0, last);
  return { start: 0, end: last, bottom: farthestFrom(norm, ref, 0, last) };
}

/** 구간 [a, b] 에서 fps 기준 intervalMs 간격으로 프레임 번호를 뽑고, cap 을 넘으면 균등 솎기 */
function pickFrames(indices: number[], fps: number, intervalMs: number, cap: number): number[] {
  if (!indices.length) return [];
  const step = Math.max(1, Math.round((fps * intervalMs) / 1000));
  let picked = indices.filter((_, i) => i % step === 0);
  if (picked.length > cap) picked = evenly(picked, cap);
  return picked;
}

function evenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor((i * arr.length) / n)]);
  return out;
}

/**
 * 샘플 하나 → 라벨 붙은 벡터들.
 * - 표시 구간 밖은 none
 * - rep: start·bottom 거리를 기준으로 top(≤25%) / bottom(≥70%), 사이는 버림
 * - hold: 구간 전체 hold · none 항목: 구간 전체 none
 */
export function labelSample(
  s: SampleForLabel,
  opts: { intervalMs?: number; perStateCap?: number } = {},
): LabeledVector[] {
  const intervalMs = opts.intervalMs ?? PICK_INTERVAL_MS;
  const cap = opts.perStateCap ?? PER_STATE_CAP;
  const norm = normalizeAll(s.frames);
  const last = s.frames.length - 1;
  const start = Math.max(0, Math.min(s.marks.start, last));
  const end = Math.max(start, Math.min(s.marks.end, last));

  const byState: Record<SampleState, number[]> = { top: [], bottom: [], hold: [], none: [] };
  const inside = (i: number) => i >= start && i <= end;

  if (s.kind === 'none') {
    for (let i = 0; i < s.frames.length; i++) if (norm[i]) byState.none.push(i);
  } else if (s.kind === 'hold') {
    const mid = norm[Math.floor((start + end) / 2)] ?? norm[firstValid(norm, start, end)];
    for (let i = 0; i < s.frames.length; i++) {
      const n = norm[i];
      if (!n) continue;
      if (inside(i)) byState.hold.push(i);
      else if (!mid || frameDistance(mid, n) > HOLD_NEAR_DIST) byState.none.push(i);
    }
  } else {
    const ref = firstValid(norm, start, end);
    const bottomIdx = s.marks.bottom ?? farthestFrom(norm, ref, start, end);
    const base = norm[ref];
    const bottomN = norm[bottomIdx];
    const D = base && bottomN ? frameDistance(base, bottomN) : 0;
    if (base && bottomN && D > 0) {
      for (let i = 0; i < s.frames.length; i++) {
        const n = norm[i];
        if (!n) continue;
        const dTop = frameDistance(base, n) / D;
        const dBot = frameDistance(bottomN, n) / D;
        if (inside(i)) {
          if (dTop <= TOP_RATIO) byState.top.push(i);
          else if (dBot <= BOTTOM_NEAR_RATIO) byState.bottom.push(i);
        } else if (dTop > OUTSIDE_NONE_RATIO && dBot > OUTSIDE_NONE_RATIO) {
          byState.none.push(i);
        }
      }
    }
  }

  const out: LabeledVector[] = [];
  for (const state of Object.keys(byState) as SampleState[]) {
    for (const i of pickFrames(byState[state], s.fps, intervalMs, cap)) {
      const n = norm[i]!;
      out.push({ exerciseId: s.exerciseId, state, vec: n.vec, mask: n.mask, sampleId: s.id, frame: i });
    }
  }
  return out;
}

/** (운동, 상태)별 상한. 입력이 시간순이라고 보고 넘치면 균등 솎기 */
export function thinDataset(vectors: LabeledVector[], capPerClass = CLASS_CAP): LabeledVector[] {
  const groups = new Map<string, LabeledVector[]>();
  for (const v of vectors) {
    const key = v.state === 'none' ? 'none' : `${v.exerciseId}:${v.state}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(v);
  }
  const out: LabeledVector[] = [];
  for (const g of groups.values()) out.push(...evenly(g, capPerClass));
  return out;
}
