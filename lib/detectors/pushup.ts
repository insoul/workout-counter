import { LM } from '@/lib/pose/landmarks';
import { jointAngle, lineAngleToHorizontal, pickBetterSide } from '@/lib/geometry/angles';
import { deg, ratio, yn, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

const CONFIG = { top: 140, bottom: 105, bottomExit: 115, minRepMs: 700, minVis: 0.5 };

const LEFT = [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_HIP] as const;
const RIGHT = [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_HIP] as const;

/**
 * 팔꿈치 각도 (측면 뷰). 다음 셋을 모두 만족할 때만 측정한다.
 * - 어깨·팔꿈치·손목·엉덩이 네 관절이 모두 보인다 (하나라도 흐리면 세지 않는다)
 * - 몸이 수평에 가깝다 (어깨-엉덩이 선 55도 이내 — 폰이 기울면 각도가 커져 여유를 둔다)
 * - 손목이 어깨보다 아래에 있다 (손이 바닥에 있다). 팔을 머리 위로 뻗어 철봉을 잡는
 *   동작에서 팔꿈치가 접혔다 펴지는 것을 걸러낸다.
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { metric: null };
  const side = pickBetterSide(f.lm, LEFT, RIGHT);
  const [sh, el, wr, hip] = side === 'left' ? LEFT : RIGHT;
  const vis = Math.min(...[sh, el, wr, hip].map((i) => f.lm[i].visibility));
  const torso = lineAngleToHorizontal(f.lm[sh], f.lm[hip]);
  const wristBelow = f.lm[wr].y > f.lm[sh].y;
  const elbow = jointAngle(f.world[sh], f.world[el], f.world[wr]);
  const gated = vis < CONFIG.minVis || torso > 55 || !wristBelow;
  return { metric: gated ? null : elbow, side, vis, torso, wristBelow, elbow };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    side: a.side ?? '?',
    elbow: deg(a.elbow),
    torso: deg(a.torso),
    wristBelow: yn(a.wristBelow),
    vis: ratio(a.vis),
  };
}

export function createPushupDetector(): ExerciseDetector {
  return new RepDetector('pushup', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
