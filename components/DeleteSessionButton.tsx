'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DeleteSessionButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm('이 운동 기록을 삭제할까요?')) return;
    setBusy(true);
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else alert('삭제에 실패했습니다.');
  };

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="text-xs text-neutral-500 underline disabled:opacity-50"
    >
      {busy ? '삭제 중…' : '삭제'}
    </button>
  );
}
