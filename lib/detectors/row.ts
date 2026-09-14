import { LM } from '@/lib/pose/landmarks';
import { jointAngle, lineAngleToHorizontal, pickBetterSide } from '@/lib/geometry/angles';
import { deg, ratio, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

// 로우는 오클루전이 심해 베스트 에포트: visibility 기준을 낮추고 수동 보정 버튼과 병행
const CONFIG = { top: 150, bottom: 90, bottomExit: 110, minRepMs: 900, minVis: 0.35 };

const LEFT = [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST] as const;
const RIGHT = [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST] as const;

/**
 * 팔꿈치 각도: 팔을 뻗으면(150+) → 당기면(<90) → 다시 뻗으면 1회.
 * 자세 게이트: 엉덩이·무릎이 보이면 "허리 숙이고 다리는 선" 자세일 때만 측정한다 —
 * 몸통은 수평에서 20~70도, 허벅지는 60도 이상 세워져 있어야 한다.
 * 엎드린 푸시업(허벅지 수평)과 선 자세에서 팔 흔들기(몸통 수직)를 걸러낸다.
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { metric: null };
  const side = pickBetterSide(f.lm, LEFT, RIGHT);
  const [sh, el, wr] = side === 'left' ? LEFT : RIGHT;
  const vis = Math.min(f.lm[sh].visibility, f.lm[el].visibility, f.lm[wr].visibility);
  const hip = side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP;
  const knee = side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE;
  const legVisible = f.lm[hip].visibility >= 0.4 && f.lm[knee].visibility >= 0.4;
  const torso = legVisible ? lineAngleToHorizontal(f.lm[sh], f.lm[hip]) : null;
  const thigh = legVisible ? lineAngleToHorizontal(f.lm[hip], f.lm[knee]) : null;
  const elbow = jointAngle(f.world[sh], f.world[el], f.world[wr]);
  const postureOk = torso == null || thigh == null || (torso >= 20 && torso <= 70 && thigh >= 60);
  const gated = vis < CONFIG.minVis || !postureOk;
  return { metric: gated ? null : elbow, side, vis, torso, thigh, elbow };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    side: a.side ?? '?',
    elbow: deg(a.elbow),
    torso: deg(a.torso),
    thigh: deg(a.thigh),
    vis: ratio(a.vis),
  };
}

export function createRowDetector(): ExerciseDetector {
  return new RepDetector('row', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
