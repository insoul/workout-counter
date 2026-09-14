import { EXERCISES, type ExerciseId } from '@/lib/detectors/registry';

export type SessionMode = 'routine' | 'free';

/** 루틴의 세트 하나 또는 자유 운동의 구간 하나 — 두 모드를 한 형식으로 맞춘다 */
export interface SessionEntry {
  exerciseId: ExerciseId;
  kind: 'rep' | 'hold';
  /** rep 이면 횟수, hold 면 ms */
  value: number;
  /** 루틴 모드에서만 — 0부터 */
  setIdx?: number;
  side?: 'left' | 'right';
}

export interface WorkoutSession {
  id: string;
  mode: SessionMode;
  startedAt: number;
  endedAt: number;
  entries: SessionEntry[];
}

/** 저장 요청 본문. id 는 클라이언트가 만들어 재전송(sendBeacon)해도 중복 저장되지 않게 한다 */
export type SessionInput = Omit<WorkoutSession, 'id'> & { id?: string };

const MAX_ENTRIES = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeSessionInput(raw: unknown): SessionInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== 'routine' && r.mode !== 'free') return null;
  const startedAt = Number(r.startedAt);
  const endedAt = Number(r.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  if (r.id !== undefined && (typeof r.id !== 'string' || !UUID_RE.test(r.id))) return null;
  if (!Array.isArray(r.entries) || r.entries.length === 0 || r.entries.length > MAX_ENTRIES) {
    return null;
  }

  const entries: SessionEntry[] = [];
  for (const e of r.entries as unknown[]) {
    if (!e || typeof e !== 'object') return null;
    const { exerciseId, kind, value, setIdx, side } = e as Record<string, unknown>;
    if (typeof exerciseId !== 'string' || !(exerciseId in EXERCISES)) return null;
    if (kind !== 'rep' && kind !== 'hold') return null;
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) return null;
    const entry: SessionEntry = { exerciseId: exerciseId as ExerciseId, kind, value: Math.round(v) };
    if (setIdx !== undefined) {
      const s = Number(setIdx);
      if (!Number.isInteger(s) || s < 0) return null;
      entry.setIdx = s;
    }
    if (side !== undefined) {
      if (side !== 'left' && side !== 'right') return null;
      entry.side = side;
    }
    entries.push(entry);
  }
  return { id: r.id as string | undefined, mode: r.mode, startedAt, endedAt, entries };
}

/** 운동별 합계 — 등록 순서대로, 값이 있는 운동만 */
export function sessionTotals(entries: SessionEntry[]): { exerciseId: ExerciseId; kind: 'rep' | 'hold'; value: number }[] {
  const sum: Partial<Record<ExerciseId, number>> = {};
  for (const e of entries) sum[e.exerciseId] = (sum[e.exerciseId] ?? 0) + e.value;
  return (Object.keys(EXERCISES) as ExerciseId[])
    .filter((id) => (sum[id] ?? 0) > 0)
    .map((id) => ({ exerciseId: id, kind: EXERCISES[id].kind, value: sum[id]! }));
}

export function formatEntryValue(kind: 'rep' | 'hold', value: number): string {
  return kind === 'rep' ? `${value}회` : `${Math.floor(value / 1000)}초`;
}

/** "스쿼트 12회 · 푸시업 8회 · 플랭크 45초" */
export function summarizeSession(entries: SessionEntry[]): string {
  return sessionTotals(entries)
    .map((t) => `${EXERCISES[t.exerciseId].nameKo} ${formatEntryValue(t.kind, t.value)}`)
    .join(' · ');
}
