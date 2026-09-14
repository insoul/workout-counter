import type { SessionInput } from './types';

const URL = '/api/sessions';

/** 운동 기록 저장. 로그인 안 됨(401)·DB 미설정(503)은 조용히 넘어간다 */
export async function saveSession(input: SessionInput): Promise<boolean> {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 페이지가 닫힐 때의 마지막 전송. 응답을 기다릴 수 없으므로 sendBeacon 을 쓴다.
 * 같은 id 로 보내면 서버가 중복 저장하지 않으니 saveSession 과 겹쳐도 안전하다.
 */
export function beaconSession(input: SessionInput): void {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  navigator.sendBeacon(URL, new Blob([JSON.stringify(input)], { type: 'application/json' }));
}
