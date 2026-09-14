import { db, dbAvailable } from '@/lib/db';
import type { PoseSample, SampleInput, SampleMarks, SampleMeta } from './types';

let schemaReady: Promise<unknown> | null = null;

async function ensureSchema() {
  schemaReady ??= (async () => {
    const q = db();
    await q`CREATE TABLE IF NOT EXISTS pose_samples (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      view TEXT NOT NULL,
      height TEXT NOT NULL,
      fps REAL NOT NULL,
      frames JSONB NOT NULL,
      marks JSONB NOT NULL,
      created_at BIGINT NOT NULL
    )`;
    await q`CREATE INDEX IF NOT EXISTS idx_pose_samples_user
      ON pose_samples(user_id, created_at DESC)`;
  })();
  await schemaReady;
}

const parse = <T,>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

function toMeta(r: Record<string, unknown>): SampleMeta {
  return {
    id: String(r.id),
    exerciseId: r.exercise_id as SampleMeta['exerciseId'],
    view: r.view as SampleMeta['view'],
    height: r.height as SampleMeta['height'],
    fps: Number(r.fps),
    frameCount: Number(r.frame_count),
    marks: parse<SampleMarks>(r.marks),
    createdAt: Number(r.created_at),
  };
}

function toSample(r: Record<string, unknown>): PoseSample {
  const frames = parse<number[][]>(r.frames);
  return { ...toMeta({ ...r, frame_count: frames.length }), frames };
}

export async function createSample(userId: string, input: SampleInput): Promise<string> {
  await ensureSchema();
  const id = input.id ?? crypto.randomUUID();
  await db()`
    INSERT INTO pose_samples (id, user_id, exercise_id, view, height, fps, frames, marks, created_at)
    VALUES (${id}, ${userId}, ${input.exerciseId}, ${input.view}, ${input.height}, ${input.fps},
            ${JSON.stringify(input.frames)}::jsonb, ${JSON.stringify(input.marks)}::jsonb, ${Date.now()})
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

/** 프레임 본문 없이 — 목록과 개수 집계용. 오래된 것부터 */
export async function listSamples(userId: string, exerciseId?: string): Promise<SampleMeta[]> {
  if (!dbAvailable()) return [];
  await ensureSchema();
  const rows = exerciseId
    ? await db()`SELECT id, exercise_id, view, height, fps, marks, created_at,
                        jsonb_array_length(frames) AS frame_count
                 FROM pose_samples WHERE user_id = ${userId} AND exercise_id = ${exerciseId}
                 ORDER BY created_at ASC`
    : await db()`SELECT id, exercise_id, view, height, fps, marks, created_at,
                        jsonb_array_length(frames) AS frame_count
                 FROM pose_samples WHERE user_id = ${userId} ORDER BY created_at ASC`;
  return rows.map((r) => toMeta(r as Record<string, unknown>));
}

export async function getSample(userId: string, id: string): Promise<PoseSample | null> {
  if (!dbAvailable()) return null;
  await ensureSchema();
  const rows = await db()`
    SELECT id, exercise_id, view, height, fps, frames, marks, created_at
    FROM pose_samples WHERE user_id = ${userId} AND id = ${id}`;
  return rows[0] ? toSample(rows[0] as Record<string, unknown>) : null;
}

/** compact 데이터셋용 — 원본 프레임 전부. 오래된 것부터(솎기가 오래된 쪽을 먼저 버리도록) */
export async function loadAllSamples(userId: string): Promise<PoseSample[]> {
  if (!dbAvailable()) return [];
  await ensureSchema();
  const rows = await db()`
    SELECT id, exercise_id, view, height, fps, frames, marks, created_at
    FROM pose_samples WHERE user_id = ${userId} ORDER BY created_at ASC`;
  return rows.map((r) => toSample(r as Record<string, unknown>));
}

export async function updateMarks(userId: string, id: string, marks: SampleMarks): Promise<boolean> {
  await ensureSchema();
  const rows = await db()`
    UPDATE pose_samples SET marks = ${JSON.stringify(marks)}::jsonb
    WHERE user_id = ${userId} AND id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function deleteSample(userId: string, id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM pose_samples WHERE user_id = ${userId} AND id = ${id}`;
}
