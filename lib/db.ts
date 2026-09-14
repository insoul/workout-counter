import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { RoutineItem } from '@/lib/routine/custom';

export interface RoutineRecord {
  id: string;
  name: string;
  items: RoutineItem[];
  updatedAt: number;
}

// Neon HTTP 드라이버 — 커넥션 풀 없이 요청마다 HTTP로 질의한다 (서버리스 함수에 맞춤).
// DATABASE_URL 은 Vercel의 Neon 마켓플레이스 연동이 주입한다.
let sql: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<unknown> | null = null;

export function dbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}

function db(): NeonQueryFunction<false, false> {
  sql ??= neon(process.env.DATABASE_URL!);
  return sql;
}

async function ensureSchema() {
  schemaReady ??= (async () => {
    const q = db();
    await q`CREATE TABLE IF NOT EXISTS user_routines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      items JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`;
    await q`CREATE INDEX IF NOT EXISTS idx_user_routines_user
      ON user_routines(user_id, updated_at DESC)`;
  })();
  await schemaReady;
}

function toRecord(row: Record<string, unknown>): RoutineRecord | null {
  try {
    const raw = row.items;
    const items = (typeof raw === 'string' ? JSON.parse(raw) : raw) as RoutineItem[];
    return {
      id: String(row.id),
      name: String(row.name),
      items,
      updatedAt: Number(row.updated_at),
    };
  } catch {
    return null;
  }
}

/** 최신순 목록 */
export async function listRoutines(userId: string): Promise<RoutineRecord[]> {
  if (!dbAvailable()) return [];
  await ensureSchema();
  const rows = await db()`
    SELECT id, name, items, updated_at FROM user_routines
    WHERE user_id = ${userId} ORDER BY updated_at DESC`;
  return rows
    .map((r) => toRecord(r as Record<string, unknown>))
    .filter((r): r is RoutineRecord => r !== null);
}

export async function getRoutine(userId: string, id: string): Promise<RoutineRecord | null> {
  if (!dbAvailable()) return null;
  await ensureSchema();
  const rows = await db()`
    SELECT id, name, items, updated_at FROM user_routines
    WHERE user_id = ${userId} AND id = ${id}`;
  const row = rows[0];
  return row ? toRecord(row as Record<string, unknown>) : null;
}

export async function createRoutine(
  userId: string,
  name: string,
  items: RoutineItem[],
): Promise<string> {
  await ensureSchema();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db()`
    INSERT INTO user_routines (id, user_id, name, items, created_at, updated_at)
    VALUES (${id}, ${userId}, ${name}, ${JSON.stringify(items)}::jsonb, ${now}, ${now})`;
  return id;
}

export async function updateRoutine(
  userId: string,
  id: string,
  name: string,
  items: RoutineItem[],
): Promise<boolean> {
  await ensureSchema();
  const rows = await db()`
    UPDATE user_routines
    SET name = ${name}, items = ${JSON.stringify(items)}::jsonb, updated_at = ${Date.now()}
    WHERE user_id = ${userId} AND id = ${id}
    RETURNING id`;
  return rows.length > 0;
}

export async function deleteRoutine(userId: string, id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM user_routines WHERE user_id = ${userId} AND id = ${id}`;
}
