import { NextResponse } from 'next/server';
import { getSession } from '@/auth';
import { dbAvailable } from '@/lib/db';
import { buildCompact } from '@/lib/learned/compact';
import { createSample, listSamples, loadAllSamples } from '@/lib/learned/db';
import { sanitizeSampleInput } from '@/lib/learned/validate';

export async function GET(req: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('compact') === '1') {
      return NextResponse.json(buildCompact(await loadAllSamples(userId)));
    }
    const exercise = url.searchParams.get('exercise') ?? undefined;
    const [samples, all] = await Promise.all([
      listSamples(userId, exercise),
      exercise ? listSamples(userId) : null,
    ]);
    const counts: Record<string, number> = {};
    for (const s of all ?? samples) counts[s.exerciseId] = (counts[s.exerciseId] ?? 0) + 1;
    return NextResponse.json({ samples, counts });
  } catch (e) {
    console.error('[api/samples] list failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!dbAvailable()) return NextResponse.json({ error: 'db_not_configured' }, { status: 503 });
  const input = sanitizeSampleInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const id = await createSample(userId, input);
    return NextResponse.json({ id });
  } catch (e) {
    console.error('[api/samples] create failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
