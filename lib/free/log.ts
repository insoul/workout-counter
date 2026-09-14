import type { ExerciseId } from '@/lib/detectors/registry';
import type { Snapshot } from './snapshot';

/**
 * 같은 운동이 연속된 구간 하나. 운동이 바뀌면 새 구간이 시작된다.
 * value 는 rep 운동이면 횟수, hold 운동이면 누적 ms.
 */
export interface Segment {
  exerciseId: ExerciseId;
  kind: 'rep' | 'hold';
  value: number;
  /** 구간이 처음 만들어진 순간의 증거 — 이후 rep/시간이 합쳐져도 그대로 둔다 */
  debug?: Snapshot;
}

export interface FreeLog {
  segments: Segment[];
  /** 운동별 합계 — 단위는 Segment.value 와 같다 */
  totals: Partial<Record<ExerciseId, number>>;
}

export const EMPTY_LOG: FreeLog = { segments: [], totals: {} };

function add(
  log: FreeLog,
  exerciseId: ExerciseId,
  kind: Segment['kind'],
  delta: number,
  debug?: Snapshot,
): FreeLog {
  const last = log.segments[log.segments.length - 1];
  const segments =
    last && last.exerciseId === exerciseId
      ? [...log.segments.slice(0, -1), { ...last, value: last.value + delta }]
      : [...log.segments, { exerciseId, kind, value: delta, ...(debug ? { debug } : {}) }];
  return {
    segments,
    totals: { ...log.totals, [exerciseId]: (log.totals[exerciseId] ?? 0) + delta },
  };
}

/**
 * rep 1회 반영. 마지막 구간과 같은 운동이면 그 구간을 늘리고, 아니면 구간을 추가한다.
 * debug 는 새 구간이 만들어질 때만 붙는다.
 */
export function addRep(log: FreeLog, exerciseId: ExerciseId, debug?: Snapshot): FreeLog {
  return add(log, exerciseId, 'rep', 1, debug);
}

/** hold 시간 누적. 병합 규칙은 addRep 과 같다 */
export function addHoldMs(
  log: FreeLog,
  exerciseId: ExerciseId,
  ms: number,
  debug?: Snapshot,
): FreeLog {
  return add(log, exerciseId, 'hold', ms, debug);
}

/** 이번 반영으로 새 구간이 시작됐는지 — 음성에 운동 이름을 붙일지 판단용 */
export function startedNewSegment(before: FreeLog, after: FreeLog): boolean {
  return after.segments.length > before.segments.length;
}

/** 표시용: rep 은 횟수 그대로, hold 는 초 */
export function formatValue(kind: Segment['kind'], value: number): string {
  return kind === 'rep' ? String(value) : `${Math.floor(value / 1000)}초`;
}
