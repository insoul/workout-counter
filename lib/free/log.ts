import type { ExerciseId } from '@/lib/detectors/registry';

/** 같은 운동이 연속된 구간 하나. 운동이 바뀌면 새 구간이 시작된다 */
export interface Segment {
  exerciseId: ExerciseId;
  count: number;
}

export interface FreeLog {
  segments: Segment[];
  totals: Partial<Record<ExerciseId, number>>;
}

export const EMPTY_LOG: FreeLog = { segments: [], totals: {} };

/** rep 1회를 반영한 새 로그. 마지막 구간과 같은 운동이면 그 구간을 늘리고, 아니면 구간을 추가한다 */
export function addRep(log: FreeLog, exerciseId: ExerciseId): FreeLog {
  const last = log.segments[log.segments.length - 1];
  const segments =
    last && last.exerciseId === exerciseId
      ? [...log.segments.slice(0, -1), { exerciseId, count: last.count + 1 }]
      : [...log.segments, { exerciseId, count: 1 }];
  return {
    segments,
    totals: { ...log.totals, [exerciseId]: (log.totals[exerciseId] ?? 0) + 1 },
  };
}

/** 이번 rep 으로 새 구간이 시작됐는지 — 음성에 운동 이름을 붙일지 판단용 */
export function startedNewSegment(before: FreeLog, after: FreeLog): boolean {
  return after.segments.length > before.segments.length;
}
