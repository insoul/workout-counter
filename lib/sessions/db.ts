import { db, dbAvailable } from '@/lib/db';
import type { SessionEntry, SessionInput, SessionMode, WorkoutSession } from './types';

let schemaReady: Promise<unknown> | null = null;

async function ensureSchema() {
  schemaReady ??= (async () => {
    const q = db();
    await q`CREATE TABLE IF NOT EXISTS workout_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at BIGINT NOT NULL,
      ended_at BIGINT NOT NULL,
      entries JSONB NOT NULL,
      created_at BIGINT NOT NULL
    )`;
    await q`CREATE INDEX IF NOT EXISTS idx_workout_sessions_user
      ON workout_sessions(user_id, started_at DESC)`;
  })();
  await schemaReady;
}

function toSession(row: Record<string, unknown>): WorkoutSession {
  const raw = row.entries;
  return {
    id: String(row.id),
    mode: row.mode as SessionMode,
    startedAt: Number(row.started_at),
    endedAt: Number(row.ended_at),
    entries: (typeof raw === 'string' ? JSON.parse(raw) : raw) as SessionEntry[],
  };
}

/** 저장. 같은 id 가 이미 있으면(재전송) 아무것도 하지 않고 그 id 를 돌려준다 */
export async function createSession(userId: string, input: SessionInput): Promise<string> {
  await ensureSchema();
  const id = input.id ?? crypto.randomUUID();
  await db()`
    INSERT INTO workout_sessions (id, user_id, mode, started_at, ended_at, entries, created_at)
    VALUES (${id}, ${userId}, ${input.mode}, ${input.startedAt}, ${input.endedAt},
            ${JSON.stringify(input.entries)}::jsonb, ${Date.now()})
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

/** 최신순 목록 */
export async function listSessions(userId: string, limit = 50): Promise<WorkoutSession[]> {
  if (!dbAvailable()) return [];
  await ensureSchema();
  const rows = await db()`
    SELECT id, mode, started_at, ended_at, entries FROM workout_sessions
    WHERE user_id = ${userId} ORDER BY started_at DESC LIMIT ${limit}`;
  return rows.map((r) => toSession(r as Record<string, unknown>));
}

export async function deleteSession(userId: string, id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM workout_sessions WHERE user_id = ${userId} AND id = ${id}`;
}
