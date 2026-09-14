'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { isDebugEnabled, setDebugEnabled } from '@/lib/debug';

const TAPS = 5;
const WINDOW_MS = 2000;

// useSyncExternalStore 용 구독 — 이 컴포넌트가 토글할 때만 바뀌므로 리스너 집합 하나로 충분하다
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const emit = () => listeners.forEach((cb) => cb());

/** 제목 이모지 — 2초 안에 5번 누르면 디버그 모드가 토글된다 */
export default function DebugToggle({ children }: { children: React.ReactNode }) {
  // 서버 렌더에서는 항상 꺼짐 — localStorage 는 클라이언트에서만 읽어 hydration 불일치를 피한다
  const on = useSyncExternalStore(subscribe, isDebugEnabled, () => false);
  const [toast, setToast] = useState<string | null>(null);
  const tapsRef = useRef<number[]>([]);

  const tap = () => {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < WINDOW_MS), now];
    if (tapsRef.current.length < TAPS) return;
    tapsRef.current = [];
    const next = !on;
    setDebugEnabled(next);
    emit();
    setToast(next ? '디버그 모드 켜짐' : '디버그 모드 꺼짐');
    setTimeout(() => setToast(null), 1500);
  };

  return (
    <span className="relative">
      <span onClick={tap} className="cursor-default select-none">
        {children}
      </span>
      {on && (
        <span className="ml-2 align-middle rounded bg-green-500/20 px-1.5 py-0.5 font-mono text-[10px] font-normal text-green-300">
          debug
        </span>
      )}
      {toast && (
        <span className="absolute left-0 top-full mt-1 whitespace-nowrap rounded bg-black/80 px-2 py-1 text-xs font-normal text-white">
          {toast}
        </span>
      )}
    </span>
  );
}
