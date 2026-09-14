import { NextResponse } from 'next/server';
import { getSession } from '@/auth';
import { deleteSample, getSample, updateMarks } from '@/lib/learned/db';
import { sanitizeMarks } from '@/lib/learned/validate';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    const sample = await getSample(userId, id);
    if (!sample) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ sample });
  } catch (e) {
    console.error('[api/samples/:id] get failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    const sample = await getSample(userId, id);
    if (!sample) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { marks?: unknown } | null;
    const marks = sanitizeMarks(body?.marks, sample.frames.length);
    if (!marks) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    await updateMarks(userId, id, marks);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/samples/:id] patch failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    await deleteSample(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/samples/:id] delete failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
