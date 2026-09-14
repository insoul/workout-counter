import { EXERCISES } from '@/lib/detectors/registry';
import { JOINTS } from './normalize';
import type { SampleExercise, SampleHeight, SampleInput, SampleMarks, SampleView } from './types';

export const MIN_FRAMES = 30; // 1초(30fps) — 이보다 짧으면 동작이 아니다
export const MAX_FRAMES = 600; // 20초
const VIEWS: SampleView[] = ['front', 'left', 'right', 'diagonal'];
const HEIGHTS: SampleHeight[] = ['floor', 'waist', 'eye'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSampleExercise(v: unknown): v is SampleExercise {
  return v === 'none' || (typeof v === 'string' && v in EXERCISES);
}

export function sanitizeMarks(raw: unknown, frameCount: number): SampleMarks | null {
  if (!raw || typeof raw !== 'object') return null;
  const { start, end, bottom } = raw as Record<string, unknown>;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e >= frameCount || s > e) return null;
  const marks: SampleMarks = { start: s, end: e };
  if (bottom !== undefined) {
    const b = Number(bottom);
    if (!Number.isInteger(b) || b < s || b > e) return null;
    marks.bottom = b;
  }
  return marks;
}

export function sanitizeSampleInput(raw: unknown): SampleInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isSampleExercise(r.exerciseId)) return null;
  if (!VIEWS.includes(r.view as SampleView) || !HEIGHTS.includes(r.height as SampleHeight)) return null;
  if (r.id !== undefined && (typeof r.id !== 'string' || !UUID_RE.test(r.id))) return null;
  const fps = Number(r.fps);
  if (!Number.isFinite(fps) || fps < 5 || fps > 120) return null;
  if (!Array.isArray(r.frames) || r.frames.length < MIN_FRAMES || r.frames.length > MAX_FRAMES) return null;
  const frames: number[][] = [];
  for (const f of r.frames as unknown[]) {
    if (!Array.isArray(f) || f.length !== JOINTS * 4) return null;
    if (!f.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    frames.push((f as number[]).map((n) => Math.round(n * 10000) / 10000));
  }
  const marks = sanitizeMarks(r.marks, frames.length);
  if (!marks) return null;
  return {
    id: r.id as string | undefined,
    exerciseId: r.exerciseId,
    view: r.view as SampleView,
    height: r.height as SampleHeight,
    fps,
    frames,
    marks,
  };
}
