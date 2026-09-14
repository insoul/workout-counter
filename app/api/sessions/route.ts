import { NextResponse } from 'next/server';
import { getSession } from '@/auth';
import { dbAvailable } from '@/lib/db';
import { createSession, listSessions } from '@/lib/sessions/db';
import { sanitizeSessionInput } from '@/lib/sessions/types';

export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const sessions = await listSessions(userId);
    return NextResponse.json({ sessions });
  } catch (e) {
    console.error('[api/sessions] list failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!dbAvailable()) return NextResponse.json({ error: 'db_not_configured' }, { status: 503 });

  const input = sanitizeSessionInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  try {
    const id = await createSession(userId, input);
    return NextResponse.json({ id });
  } catch (e) {
    console.error('[api/sessions] create failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
