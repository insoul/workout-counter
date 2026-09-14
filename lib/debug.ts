/**
 * 디버그 모드 스위치. URL 로 ?debug 를 붙이거나, 홈 화면 앱처럼 URL 을 만질 수 없을 때는
 * 홈의 제목 이모지를 5번 연타해 localStorage 에 저장한다.
 */
const KEY = 'debug';

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has(KEY)) return true;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // 프라이빗 모드 등 — 이번 세션엔 못 켠다
  }
}
