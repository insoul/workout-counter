import { LM } from '@/lib/pose/landmarks';
import { jointAngle, lineAngleToHorizontal } from '@/lib/geometry/angles';
import { deg, ratio, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

// bottom 120: 하프 스쿼트 깊이도 1회로 인정 (100은 풀 스쿼트 수준이라 너무 빡셈)
const CONFIG = { top: 160, bottom: 120, bottomExit: 130, minRepMs: 700, minVis: 0.5 };

/**
 * 허벅지가 이 각도보다 세워져 있으면(수평 기준) 스쿼트 바닥이 아니다.
 * 무릎 각도는 3D 월드 좌표라 허리를 숙이거나 걸을 때 깊이 오차가 커서, 화면상 허벅지 기울기로
 * 한 번 더 확인한다. 하프 스쿼트(무릎 120도)만 돼도 허벅지는 60도 아래로 눕는다.
 */
const THIGH_UPRIGHT_DEG = 70;
const STANDING_METRIC = 170;

const LEGS: [number, number, number][] = [
  [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

/**
 * 무릎 각도 (양다리 평균). 서 있으면 ~175도, 스쿼트 바닥에서 <100도.
 * 양다리 여섯 관절이 모두 보여야 판정한다 — 화면 가장자리에서 한쪽 다리만으로 세지 않는다.
 */
function analyze(f: PoseFrame) {
  if (!f.lm.length || !f.world.length) return { metric: null };
  const vis = Math.min(...LEGS.flat().map((i) => f.lm[i].visibility));
  if (vis < CONFIG.minVis) return { metric: null, vis };
  const knees = LEGS.map(([hip, knee, ankle]) => jointAngle(f.world[hip], f.world[knee], f.world[ankle]));
  const thighs = LEGS.map(([hip, knee]) => lineAngleToHorizontal(f.lm[hip], f.lm[knee]));
  const knee = (knees[0] + knees[1]) / 2;
  const thigh = (thighs[0] + thighs[1]) / 2;
  const thighUpright = thigh > THIGH_UPRIGHT_DEG;
  return { metric: thighUpright ? Math.max(knee, STANDING_METRIC) : knee, vis, knees, thigh, thighUpright };
}

function inspect(f: PoseFrame): Inspection {
  const a = analyze(f);
  return {
    kneeL: deg(a.knees?.[0]),
    kneeR: deg(a.knees?.[1]),
    thigh: deg(a.thigh),
    vis: ratio(a.vis),
  };
}

export function createSquatDetector(): ExerciseDetector {
  return new RepDetector('squat', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
