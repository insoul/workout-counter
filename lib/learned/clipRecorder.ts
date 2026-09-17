/**
 * 녹화 구간의 영상을 폰 메모리에만 담아 두는 MediaRecorder 래퍼.
 * 검토 화면에서 손잡이 시각의 정지화면을 보여주는 용도이며, 저장·전송하지 않는다 —
 * 검토가 끝나면 revoke 로 버린다.
 */

export interface Clip {
  url: string;
  /** 녹화가 실제로 시작된 performance.now() — 프레임 t 와 영상 시각을 맞추는 기준 */
  t0: number;
}

export interface ClipRecorder {
  stop(): Promise<Clip | null>;
}

const MIME_CANDIDATES = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];

/** 지원하지 않거나 실패하면 null — 그때는 관절 막대 인형만 보여준다 */
export function startClip(stream: MediaStream): ClipRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_200_000 });
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  let t0 = performance.now();
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstart = () => {
    t0 = performance.now();
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () =>
      new Promise((resolve) => {
        const done = () => {
          if (!chunks.length) return resolve(null);
          const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/mp4' });
          resolve({ url: URL.createObjectURL(blob), t0 });
        };
        rec.onstop = done;
        rec.onerror = () => resolve(null);
        if (rec.state === 'inactive') done();
        else rec.stop();
      }),
  };
}

/** 영상 메타데이터가 준비될 때까지 */
export function waitForClip(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    if (video.readyState >= 1) return resolve(true);
    const ok = () => {
      cleanup();
      resolve(true);
    };
    const fail = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', ok);
      video.removeEventListener('error', fail);
    };
    video.addEventListener('loadedmetadata', ok);
    video.addEventListener('error', fail);
    video.load();
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, time);
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.015) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    video.currentTime = target;
    setTimeout(finish, 800); // 일부 브라우저는 범위 밖 시각에 seeked 를 내지 않는다
  });
}

/** 같은 <video> 를 여러 정지화면이 나눠 쓰므로 seek 는 한 번에 하나만 — 호출 순서대로 직렬화한다 */
export function createFrameDrawer(video: HTMLVideoElement) {
  let queue: Promise<unknown> = Promise.resolve();
  return (time: number, canvas: HTMLCanvasElement): Promise<boolean> => {
    const job = queue.then(async () => {
      await seekTo(video, time);
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, w, h);
      return true;
    });
    queue = job.catch(() => undefined);
    return job;
  };
}
