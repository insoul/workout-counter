import { NextResponse } from 'next/server';
import { getSession } from '@/auth';
import { deleteSession } from '@/lib/sessions/db';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    await deleteSession(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/sessions/:id] delete failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
