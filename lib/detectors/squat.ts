import { LM } from '@/lib/pose/landmarks';
import { jointAngle } from '@/lib/geometry/angles';
import { deg, ratio, type Inspection } from './inspect';
import { RepDetector } from './repStateMachine';
import type { ExerciseDetector, PoseFrame } from './types';

// bottom 120: 하프 스쿼트 깊이도 1회로 인정 (100은 풀 스쿼트 수준이라 너무 빡셈)
const CONFIG = { top: 160, bottom: 120, bottomExit: 130, minRepMs: 700, minVis: 0.5 };

const LEGS: [number, number, number][] = [
  [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

/** 무릎 각도 (보이는 다리들의 평균). 서 있으면 ~175도, 스쿼트 바닥에서 <100도 */
function analyze(f: PoseFrame) {
  const legs: { angle: number | null; vis: number }[] = [];
  if (!f.lm.length || !f.world.length) return { metric: null, legs };
  for (const [hip, knee, ankle] of LEGS) {
    const vis = Math.min(f.lm[hip].visibility, f.lm[knee].visibility, f.lm[ankle].visibility);
    const angle = vis < CONFIG.minVis ? null : jointAngle(f.world[hip], f.world[knee], f.world[ankle]);
    legs.push({ angle, vis });
  }
  const angles = legs.map((l) => l.angle).filter((a): a is number => a != null);
  const metric = angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : null;
  return { metric, legs };
}

function inspect(f: PoseFrame): Inspection {
  const { legs } = analyze(f);
  return {
    kneeL: deg(legs[0]?.angle),
    kneeR: deg(legs[1]?.angle),
    visL: ratio(legs[0]?.vis),
    visR: ratio(legs[1]?.vis),
  };
}

export function createSquatDetector(): ExerciseDetector {
  return new RepDetector('squat', { metric: (f) => analyze(f).metric, inspect, ...CONFIG });
}
