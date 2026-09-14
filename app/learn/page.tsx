import { redirect } from 'next/navigation';
import { getSession } from '@/auth';
import LearnClient from './client';

export const dynamic = 'force-dynamic';

export default async function LearnPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect('/login?next=/learn');
  return <LearnClient />;
}
