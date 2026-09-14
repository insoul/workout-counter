import { LM } from '@/lib/pose/landmarks';
import { avgVisibility, dist2, mid } from '@/lib/geometry/angles';
import { HoldDetector } from './holdEngine';
import { ratio, yn, type Inspection } from './inspect';
import type { ExerciseDetector, PoseFrame } from './types';

const LOWER = [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];

/**
 * 한발 서기 판정: 한쪽 발목이 정강이 길이의 35% 이상 들려 있고, 그쪽 무릎도 함께 올라와 있으며,
 * 서 있는 자세(엉덩이가 무릎 위)이고 손이 어깨 위에 있지 않다.
 * 무릎 조건은 발을 앞뒤로 벌리고 선 자세(원근 때문에 앞발 발목이 화면에서 더 아래)를,
 * 손 조건은 철봉에 매달려 다리가 흔들리는 상태를 걸러낸다.
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length) return { holding: null };
  const vis = avgVisibility(f.lm, LOWER);
  if (vis < 0.5) return { holding: null, vis };

  const aL = f.lm[LM.LEFT_ANKLE];
  const aR = f.lm[LM.RIGHT_ANKLE];
  // 화면에서 더 아래(y가 큰)에 있는 발이 지지 발
  const standingKnee = aL.y > aR.y ? LM.LEFT_KNEE : LM.RIGHT_KNEE;
  const standingAnkle = aL.y > aR.y ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE;
  const shin = dist2(f.lm[standingKnee], f.lm[standingAnkle]);
  if (shin < 0.01) return { holding: null, vis, shin };

  const liftRatio = Math.abs(aL.y - aR.y) / shin;
  const lifted = liftRatio > 0.35;
  // 든 쪽(발목이 더 위) 무릎이 지지 쪽 무릎보다 정강이의 15% 이상 위에 있어야 한다
  const liftedKnee = aL.y > aR.y ? LM.RIGHT_KNEE : LM.LEFT_KNEE;
  const kneeRatio = (f.lm[standingKnee].y - f.lm[liftedKnee].y) / shin;
  const kneeUp = kneeRatio > 0.15;
  const upright =
    mid(f.lm[LM.LEFT_HIP], f.lm[LM.RIGHT_HIP]).y < mid(f.lm[LM.LEFT_KNEE], f.lm[LM.RIGHT_KNEE]).y;
  const handsDown =
    f.lm[LM.LEFT_WRIST].y > f.lm[LM.LEFT_SHOULDER].y && f.lm[LM.RIGHT_WRIST].y > f.lm[LM.RIGHT_SHOULDER].y;
  return { holding: lifted && kneeUp && upright && handsDown, vis, shin, liftRatio, kneeRatio, upright, handsDown };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    lift: ratio(a.liftRatio),
    kneeUp: ratio(a.kneeRatio),
    upright: yn(a.upright),
    handsDown: yn(a.handsDown),
    vis: ratio(a.vis),
  };
}

export function createSingleLegStandDetector(): ExerciseDetector {
  return new HoldDetector('singleleg', {
    isHolding: (f) => analyze(f).holding,
    inspect,
    startSustainMs: 500,
    graceMs: 1000, // 잠깐 발끝이 닿아도 용서
  });
}
