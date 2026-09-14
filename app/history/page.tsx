import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/auth';
import DeleteSessionButton from '@/components/DeleteSessionButton';
import { EXERCISES } from '@/lib/detectors/registry';
import { listSessions } from '@/lib/sessions/db';
import { formatEntryValue, sessionTotals, type WorkoutSession } from '@/lib/sessions/types';
import { koSide } from '@/lib/speech/phrases.ko';

export const dynamic = 'force-dynamic';

function durationLabel(s: WorkoutSession): string {
  const min = Math.round((s.endedAt - s.startedAt) / 60000);
  return min < 1 ? '1분 미만' : `${min}분`;
}

function SessionCard({ s }: { s: WorkoutSession }) {
  const totals = sessionTotals(s.entries);
  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="font-bold">
            {new Date(s.startedAt).toLocaleString('ko-KR', {
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </div>
          <div className="text-sm text-neutral-400">
            {s.mode === 'free' ? '자유 운동' : '루틴'} · {durationLabel(s)}
          </div>
        </div>
        <DeleteSessionButton id={s.id} />
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {totals.map((t) => (
          <div key={t.exerciseId} className="font-semibold tabular-nums">
            {EXERCISES[t.exerciseId].cameraIcon} {EXERCISES[t.exerciseId].nameKo}{' '}
            <span className="text-green-400">{formatEntryValue(t.kind, t.value)}</span>
          </div>
        ))}
      </div>

      <div className="space-y-0.5 text-xs text-neutral-500">
        {s.entries.map((e, i) => (
          <div key={i} className="flex justify-between tabular-nums">
            <span>
              {koSide(e.side)}
              {EXERCISES[e.exerciseId].nameKo}
              {e.setIdx !== undefined ? ` ${e.setIdx + 1}세트` : ''}
            </span>
            <span>{formatEntryValue(e.kind, e.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function HistoryPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/login?next=/history');

  const sessions = await listSessions(userId).catch(() => [] as WorkoutSession[]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-black">운동 기록</h1>
        <Link href="/" className="text-sm text-neutral-400 underline">
          홈으로
        </Link>
      </div>
      {sessions.length ? (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <p className="text-neutral-400">아직 기록이 없습니다. 운동을 마치면 여기에 쌓입니다.</p>
      )}
    </main>
  );
}
