import { LM } from '@/lib/pose/landmarks';
import { avgVisibility, jointAngle, lineAngleToHorizontal, mid } from '@/lib/geometry/angles';
import { deg, ratio, yn, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

// top 150: 팔을 편 매달림. bottom 95: 턱이 철봉 근처 — 정면 카메라의 3D 팔꿈치 각도는 실제보다
// 크게 나와(턱이 철봉 위여도 평균 90도 안팎) 75 로는 잡히지 않았다
const CONFIG = { top: 150, bottom: 95, bottomExit: 110, minRepMs: 1000, minVis: 0.4 };

/** 코가 양 손목보다 위(턱이 철봉 위)면 각도와 무관하게 바닥으로 본다 — 이때 metric 으로 쓰는 값 */
const CHIN_OVER_METRIC = 60;

const ARMS: [number, number, number][] = [
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
];
const TORSO = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];

/**
 * 양팔 팔꿈치 각도 평균 (정면 뷰). 매달림 자세가 아니면 null → 카운트 안 함.
 * 매달림 판정: 양 손목이 어깨보다 아래로 내려가지 않음 + 몸통 수직.
 * 서서 팔을 내리면(스쿼트) 손목이 어깨 아래라 걸러지고, 엎드리면(푸시업) 몸통이 수평이라 걸러진다.
 * 코가 양 손목보다 위로 올라오면(턱이 철봉 위) 각도가 흔들려도 바닥으로 인정한다.
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { metric: null };
  const torsoVis = avgVisibility(f.lm, TORSO);
  const wristsUp =
    f.lm[LM.LEFT_WRIST].y < f.lm[LM.LEFT_SHOULDER].y + 0.02 &&
    f.lm[LM.RIGHT_WRIST].y < f.lm[LM.RIGHT_SHOULDER].y + 0.02;
  const torso = lineAngleToHorizontal(
    mid(f.lm[LM.LEFT_SHOULDER], f.lm[LM.RIGHT_SHOULDER]),
    mid(f.lm[LM.LEFT_HIP], f.lm[LM.RIGHT_HIP]),
  );
  const arms = ARMS.map(([sh, el, wr]) => {
    const vis = Math.min(f.lm[sh].visibility, f.lm[el].visibility, f.lm[wr].visibility);
    return vis < CONFIG.minVis ? null : jointAngle(f.world[sh], f.world[el], f.world[wr]);
  });
  const angles = arms.filter((a): a is number => a != null);
  const elbow = angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : null;
  const chinOver =
    f.lm[LM.NOSE].visibility >= 0.5 &&
    f.lm[LM.NOSE].y < f.lm[LM.LEFT_WRIST].y &&
    f.lm[LM.NOSE].y < f.lm[LM.RIGHT_WRIST].y;
  const gated = torsoVis < CONFIG.minVis || !wristsUp || torso <= 65;
  const metric = gated ? null : chinOver ? Math.min(elbow ?? CHIN_OVER_METRIC, CHIN_OVER_METRIC) : elbow;
  return { metric, torsoVis, wristsUp, torso, arms, elbow, chinOver };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    elbowL: deg(a.arms?.[0]),
    elbowR: deg(a.arms?.[1]),
    wristsUp: yn(a.wristsUp),
    chinOver: yn(a.chinOver),
    torso: deg(a.torso),
    torsoVis: ratio(a.torsoVis),
  };
}

export function createPullupDetector(): ExerciseDetector {
  return new RepDetector('pullup', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
