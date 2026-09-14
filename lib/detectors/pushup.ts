import { LM } from '@/lib/pose/landmarks';
import { jointAngle, lineAngleToHorizontal, pickBetterSide } from '@/lib/geometry/angles';
import { deg, ratio, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

const CONFIG = { top: 140, bottom: 105, bottomExit: 115, minRepMs: 700, minVis: 0.4 };

const LEFT = [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST] as const;
const RIGHT = [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST] as const;

/**
 * 팔꿈치 각도 (측면 뷰). 몸이 수평이 아니면(서있음/무릎 자세) null → 카운트 안 함.
 * 자세 게이트는 엉덩이가 보일 때만 적용 — 바닥 근접 촬영에서 hip 미검출로
 * 모든 프레임이 무효화되는 것을 막는다. 기준도 55도로 완화 (폰이 기울면 몸 라인 각도가 커짐)
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { metric: null };
  const side = pickBetterSide(f.lm, LEFT, RIGHT);
  const [sh, el, wr] = side === 'left' ? LEFT : RIGHT;
  const hip = side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP;
  const vis = Math.min(f.lm[sh].visibility, f.lm[el].visibility, f.lm[wr].visibility);
  const hipVis = f.lm[hip].visibility;
  const torso = hipVis >= 0.4 ? lineAngleToHorizontal(f.lm[sh], f.lm[hip]) : null;
  const elbow = jointAngle(f.world[sh], f.world[el], f.world[wr]);
  const gated = vis < CONFIG.minVis || (torso != null && torso > 55);
  return { metric: gated ? null : elbow, side, vis, hipVis, torso, elbow };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    side: a.side ?? '?',
    elbow: deg(a.elbow),
    torso: deg(a.torso),
    vis: ratio(a.vis),
    hipVis: ratio(a.hipVis),
  };
}

export function createPushupDetector(): ExerciseDetector {
  return new RepDetector('pushup', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
