import { Ema, classify, type Dataset } from '@/lib/learned/knn';
import { normalizeFrame, JOINTS } from '@/lib/learned/normalize';
import { fullBodyCheck } from '@/lib/pose/fullBodyCheck';
import { HoldDetector } from './holdEngine';
import type { Inspection } from './inspect';
import type { DetectorEvent, DetectorState, ExerciseDetector, PoseFrame } from './types';

/** 상태 전이 판단에 필요한 확률 */
const STATE_PROB = 0.6;
/** none 이 이 확률로 이 시간 지속되면 저신뢰 */
const NONE_PROB = 0.9;
const LOW_CONF_MS = 500;
const MIN_REP_MS = 700;
const EMA_ALPHA = 0.3;

/** PoseFrame → 샘플과 같은 33×4 배열 (x, y 는 화면 정규화 좌표, z 는 월드, vis) */
export function frameToRow(f: PoseFrame): number[] {
  const row = new Array(JOINTS * 4).fill(0);
  for (let j = 0; j < JOINTS && j < f.lm.length; j++) {
    row[j * 4] = f.lm[j].x;
    row[j * 4 + 1] = f.lm[j].y;
    row[j * 4 + 2] = f.world[j]?.z ?? 0;
    row[j * 4 + 3] = f.lm[j].visibility;
  }
  return row;
}

function round2(p: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (v > 0) out[k] = Math.round(v * 100) / 100;
  return out;
}

/** 프레임 분류 공통부 — rep/hold 디텍터가 함께 쓴다 */
class Classifier {
  private ema = new Ema(EMA_ALPHA);
  probs: Record<string, number> = { none: 1 };
  nearest: { sampleId: string; frame: number; dist: number } | null = null;

  constructor(
    private ds: Dataset,
    private requiredChains: number[][],
  ) {}

  update(f: PoseFrame): Record<string, number> {
    const visible = f.lm.length > 0 && fullBodyCheck(f, this.requiredChains);
    const n = visible ? normalizeFrame(frameToRow(f)) : null;
    if (!n) {
      this.nearest = null;
      this.probs = this.ema.update({ none: 1 });
      return this.probs;
    }
    const c = classify(this.ds, n);
    this.nearest = c.nearest;
    this.probs = this.ema.update(c.probs);
    return this.probs;
  }

  inspect(): Inspection {
    const out: Inspection = { mode: 'learned', ...round2(this.probs) };
    if (this.nearest) {
      out.near = `${this.nearest.sampleId.slice(0, 6)}#${this.nearest.frame}`;
      out.dist = Math.round(this.nearest.dist * 1000) / 1000;
    }
    return out;
  }

  reset() {
    this.ema.reset();
    this.probs = { none: 1 };
    this.nearest = null;
  }
}

/** rep: kNN 상태 확률로 top → bottom → top 전이를 센다 */
class LearnedRepDetector implements ExerciseDetector {
  readonly kind = 'rep' as const;
  private phase: 'top' | 'bottom' = 'top';
  private reps = 0;
  private lastRepT = 0;
  private confident = true;
  private noneSince: number | null = null;
  private cls: Classifier;

  constructor(
    readonly id: string,
    ds: Dataset,
    requiredChains: number[][],
  ) {
    this.cls = new Classifier(ds, requiredChains);
  }

  update(frame: PoseFrame): DetectorEvent[] {
    const events: DetectorEvent[] = [];
    const p = this.cls.update(frame);

    if ((p.none ?? 0) >= NONE_PROB) {
      this.noneSince ??= frame.t;
      if (this.confident && frame.t - this.noneSince > LOW_CONF_MS) {
        this.confident = false;
        events.push({ type: 'lowConfidence' });
      }
    } else {
      this.noneSince = null;
      if (!this.confident) {
        this.confident = true;
        events.push({ type: 'confidenceRestored' });
      }
    }

    const top = p[`${this.id}:top`] ?? 0;
    const bottom = p[`${this.id}:bottom`] ?? 0;
    if (this.phase === 'top' && bottom >= STATE_PROB) {
      this.phase = 'bottom';
      events.push({ type: 'phase', phase: 'bottom' });
    } else if (this.phase === 'bottom' && top >= STATE_PROB) {
      this.phase = 'top';
      if (frame.t - this.lastRepT >= MIN_REP_MS) {
        this.reps++;
        this.lastRepT = frame.t;
        events.push({ type: 'rep', count: this.reps });
      }
    }
    return events;
  }

  state(): DetectorState {
    return {
      kind: 'rep',
      reps: this.reps,
      holdMs: 0,
      holding: false,
      confident: this.confident,
      debug: { phase: this.phase, ...this.cls.inspect() },
    };
  }

  adjust(delta: number) {
    this.reps = Math.max(0, this.reps + delta);
  }

  reset() {
    this.phase = 'top';
    this.reps = 0;
    this.lastRepT = 0;
    this.confident = true;
    this.noneSince = null;
    this.cls.reset();
  }
}

/** hold: kNN 의 hold 확률을 기존 HoldDetector 의 isHolding 으로 넘긴다 */
function createLearnedHoldDetector(id: string, ds: Dataset, requiredChains: number[][]): ExerciseDetector {
  const cls = new Classifier(ds, requiredChains);
  const inner = new HoldDetector(id, {
    isHolding: (f) => {
      const p = cls.update(f);
      if ((p[`${id}:hold`] ?? 0) >= STATE_PROB) return true;
      if ((p.none ?? 0) >= NONE_PROB) return null;
      return false;
    },
    inspect: () => cls.inspect(),
    startSustainMs: 500,
    graceMs: 1000,
  });
  return {
    id,
    kind: 'hold',
    update: (f) => inner.update(f),
    state: () => inner.state(),
    adjust: (d) => inner.adjust(d),
    reset: () => {
      inner.reset();
      cls.reset();
    },
  };
}

export function createLearnedDetector(
  id: string,
  kind: 'rep' | 'hold',
  ds: Dataset,
  requiredChains: number[][],
): ExerciseDetector {
  return kind === 'rep'
    ? new LearnedRepDetector(id, ds, requiredChains)
    : createLearnedHoldDetector(id, ds, requiredChains);
}
