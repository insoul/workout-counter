import { LM } from '@/lib/pose/landmarks';
import { avgVisibility, jointAngle, lineAngleToHorizontal, mid } from '@/lib/geometry/angles';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

// top 150: 팔을 편 매달림. bottom 75: 턱이 철봉 위로 올라온 상태
const CONFIG = { top: 150, bottom: 75, bottomExit: 90, minRepMs: 1000, minVis: 0.4 };

const ARMS: [number, number, number][] = [
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
];
const TORSO = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];

/**
 * 양팔 팔꿈치 각도 평균 (정면 뷰). 매달림 자세가 아니면 null → 카운트 안 함.
 * 매달림 판정: 양 손목이 어깨보다 아래로 내려가지 않음 + 몸통 수직.
 * 서서 팔을 내리면(스쿼트) 손목이 어깨 아래라 걸러지고, 엎드리면(푸시업) 몸통이 수평이라 걸러진다.
 */
function elbowAngle(f: PoseFrame): number | null {
  if (!f.lm.length || !f.world.length) return null;
  if (avgVisibility(f.lm, TORSO) < CONFIG.minVis) return null;

  const wristsUp =
    f.lm[LM.LEFT_WRIST].y < f.lm[LM.LEFT_SHOULDER].y + 0.02 &&
    f.lm[LM.RIGHT_WRIST].y < f.lm[LM.RIGHT_SHOULDER].y + 0.02;
  if (!wristsUp) return null;

  const torsoVertical =
    lineAngleToHorizontal(
      mid(f.lm[LM.LEFT_SHOULDER], f.lm[LM.RIGHT_SHOULDER]),
      mid(f.lm[LM.LEFT_HIP], f.lm[LM.RIGHT_HIP]),
    ) > 65;
  if (!torsoVertical) return null;

  const angles: number[] = [];
  for (const [sh, el, wr] of ARMS) {
    const vis = Math.min(f.lm[sh].visibility, f.lm[el].visibility, f.lm[wr].visibility);
    if (vis < CONFIG.minVis) continue;
    angles.push(jointAngle(f.world[sh], f.world[el], f.world[wr]));
  }
  if (!angles.length) return null;
  return angles.reduce((a, b) => a + b, 0) / angles.length;
}

export function createPullupDetector(): ExerciseDetector {
  return new RepDetector('pullup', { metric: elbowAngle, ...CONFIG });
}
