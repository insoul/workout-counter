import { LM } from '@/lib/pose/landmarks';
import { avgVisibility, jointAngle, lineAngleToHorizontal, mid } from '@/lib/geometry/angles';
import { HoldDetector } from './holdEngine';
import { deg, ratio, yn, type Inspection } from './inspect';
import type { ExerciseDetector, PoseFrame } from './types';

const CORE = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_HIP, LM.RIGHT_HIP];

/** 매달림 판정: 양 손목이 어깨 위 + 팔꿈치 편 상태 + 몸통 수직 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { holding: null };
  const vis = avgVisibility(f.lm, CORE);
  if (vis < 0.4) return { holding: null, vis };

  const wristsAbove =
    f.lm[LM.LEFT_WRIST].y < f.lm[LM.LEFT_SHOULDER].y - 0.05 &&
    f.lm[LM.RIGHT_WRIST].y < f.lm[LM.RIGHT_SHOULDER].y - 0.05;

  // 팔꿈치가 보이면 팔을 편 상태인지도 확인
  const elbowsVisible =
    f.lm[LM.LEFT_ELBOW].visibility >= 0.4 && f.lm[LM.RIGHT_ELBOW].visibility >= 0.4;
  const elbowL = elbowsVisible
    ? jointAngle(f.world[LM.LEFT_SHOULDER], f.world[LM.LEFT_ELBOW], f.world[LM.LEFT_WRIST])
    : null;
  const elbowR = elbowsVisible
    ? jointAngle(f.world[LM.RIGHT_SHOULDER], f.world[LM.RIGHT_ELBOW], f.world[LM.RIGHT_WRIST])
    : null;
  const elbowsOk = !elbowsVisible || (elbowL! > 150 && elbowR! > 150);

  const torso = lineAngleToHorizontal(
    mid(f.lm[LM.LEFT_SHOULDER], f.lm[LM.RIGHT_SHOULDER]),
    mid(f.lm[LM.LEFT_HIP], f.lm[LM.RIGHT_HIP]),
  );
  const holding = wristsAbove && elbowsOk && torso > 65;
  return { holding, vis, wristsAbove, elbowL, elbowR, torso };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    wristsUp: yn(a.wristsAbove),
    elbowL: deg(a.elbowL),
    elbowR: deg(a.elbowR),
    torso: deg(a.torso),
    vis: ratio(a.vis),
  };
}

export function createDeadhangDetector(): ExerciseDetector {
  return new HoldDetector('deadhang', {
    isHolding: (f) => analyze(f).holding,
    inspect,
    startSustainMs: 500,
    graceMs: 1500,
  });
}
