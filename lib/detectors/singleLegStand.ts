import { LM } from '@/lib/pose/landmarks';
import { avgVisibility, dist2, mid } from '@/lib/geometry/angles';
import { HoldDetector } from './holdEngine';
import { ratio, yn, type Inspection } from './inspect';
import type { ExerciseDetector, PoseFrame } from './types';

const LOWER = [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];

/** 한발 서기 판정: 한쪽 발목이 정강이 길이의 35% 이상 들려 있고 서 있는 자세 */
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
  const upright =
    mid(f.lm[LM.LEFT_HIP], f.lm[LM.RIGHT_HIP]).y < mid(f.lm[LM.LEFT_KNEE], f.lm[LM.RIGHT_KNEE]).y;
  return { holding: lifted && upright, vis, shin, liftRatio, upright };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    lift: ratio(a.liftRatio),
    shin: ratio(a.shin),
    upright: yn(a.upright),
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
