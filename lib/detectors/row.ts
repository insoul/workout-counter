import { LM } from '@/lib/pose/landmarks';
import { jointAngle, lineAngleToHorizontal, pickBetterSide } from '@/lib/geometry/angles';
import { deg, ratio, yn, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

// 로우는 오클루전이 심해 루틴 모드에서는 수동 보정 버튼과 병행한다
const CONFIG = { top: 150, bottom: 90, bottomExit: 110, minRepMs: 900, minVis: 0.5 };

const LEFT = [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_HIP, LM.LEFT_KNEE] as const;
const RIGHT = [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_HIP, LM.RIGHT_KNEE] as const;

/**
 * 팔꿈치 각도: 팔을 뻗으면(150+) → 당기면(<90) → 다시 뻗으면 1회.
 * 어깨·팔꿈치·손목·엉덩이·무릎 다섯 관절이 모두 보여야 하고(하나라도 흐리면 세지 않는다),
 * "허리 숙이고 다리는 선" 자세여야 한다 — 몸통은 수평에서 20~70도, 허벅지는 60도 이상.
 * 손목은 어깨보다 아래에 있어야 한다 — 로우는 팔을 늘어뜨린 채 당기므로 손이 어깨 위로 가지 않는다.
 * 엎드린 푸시업(허벅지 수평), 선 자세에서 팔 흔들기(몸통 수직), 폰을 놓으며 손이
 * 카메라 앞을 지나는 동작(몸이 안 보임), 철봉을 잡으러 팔을 올리는 동작(손이 머리 위)을 걸러낸다.
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { metric: null };
  const side = pickBetterSide(f.lm, LEFT, RIGHT);
  const [sh, el, wr, hip, knee] = side === 'left' ? LEFT : RIGHT;
  const vis = Math.min(...[sh, el, wr, hip, knee].map((i) => f.lm[i].visibility));
  const torso = lineAngleToHorizontal(f.lm[sh], f.lm[hip]);
  const thigh = lineAngleToHorizontal(f.lm[hip], f.lm[knee]);
  const elbow = jointAngle(f.world[sh], f.world[el], f.world[wr]);
  const wristBelow = f.lm[wr].y > f.lm[sh].y;
  const postureOk = torso >= 20 && torso <= 70 && thigh >= 60 && wristBelow;
  const gated = vis < CONFIG.minVis || !postureOk;
  return { metric: gated ? null : elbow, side, vis, torso, thigh, wristBelow, elbow };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    side: a.side ?? '?',
    elbow: deg(a.elbow),
    torso: deg(a.torso),
    thigh: deg(a.thigh),
    wristBelow: yn(a.wristBelow),
    vis: ratio(a.vis),
  };
}

export function createRowDetector(): ExerciseDetector {
  return new RepDetector('row', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
