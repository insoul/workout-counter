import type { ExerciseDetector, PoseFrame } from '@/lib/detectors/types';

/**
 * 구간이 로그에 오르던 순간의 증거. 디버그 모드에서만 만들며 폰 메모리에만 있다가
 * AirDrop 묶음(lib/free/debugBundle.ts)으로 나간다 — 서버·DB 로는 보내지 않는다.
 * lm 은 33개 랜드마크의 [x, y, visibility] 를 이어 붙인 99개 숫자(정규화 좌표, 소수 3자리).
 */
export interface Snapshot {
  /** 세션 시작 기준 ms */
  at: number;
  /** 디텍터의 각도·게이트 값 (DetectorState.debug) */
  det: Record<string, number | string>;
  lm?: number[];
  /** 가로 320px JPEG data URL */
  photo?: string;
}

/** 디버그 모드에서 주기적으로 남기는 디텍터 상태 한 줄 — 아무것도 안 잡힐 때 이유를 보기 위한 것 */
export interface TraceRow {
  /** 세션 시작 기준 ms */
  at: number;
  /** 디텍터별: 필수 관절이 다 보였는지, 현재 rep/hold 상태, 게이트 값 */
  det: Record<string, { visible: boolean; reps: number; holding: boolean } & Record<string, number | string | boolean>>;
}

const PHOTO_WIDTH = 320;
const PHOTO_QUALITY = 0.6;

let photoCanvas: HTMLCanvasElement | null = null;

/** 비디오의 현재 프레임을 JPEG data URL 로. 실패하면 undefined */
function capturePhoto(video: HTMLVideoElement): string | undefined {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return undefined;
  photoCanvas ??= document.createElement('canvas');
  const w = PHOTO_WIDTH;
  const h = Math.round((vh / vw) * w);
  photoCanvas.width = w;
  photoCanvas.height = h;
  const ctx = photoCanvas.getContext('2d');
  if (!ctx) return undefined;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return photoCanvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  } catch {
    return undefined;
  }
}

/** 랜드마크는 원본(미러링 전) 정규화 좌표라 사진 위에 그대로 겹쳐 그릴 수 있다 */
export function captureSnapshot(
  det: ExerciseDetector,
  frame: PoseFrame,
  sessionStartedAt: number,
  video: HTMLVideoElement | null,
): Snapshot {
  const snap: Snapshot = { at: Math.max(0, Date.now() - sessionStartedAt), det: det.state().debug };
  if (frame.lm.length) {
    const lm: number[] = [];
    for (const p of frame.lm) {
      lm.push(
        Math.round(p.x * 1000) / 1000,
        Math.round(p.y * 1000) / 1000,
        Math.round(p.visibility * 1000) / 1000,
      );
    }
    snap.lm = lm;
  }
  if (video) {
    const photo = capturePhoto(video);
    if (photo) snap.photo = photo;
  }
  return snap;
}
