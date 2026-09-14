import { describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/learned/knn';
import { JOINTS } from '@/lib/learned/normalize';
import type { LabeledVector } from '@/lib/learned/types';
import { normalizeFrame } from '@/lib/learned/normalize';
import { createLearnedDetector, frameToRow } from './learned';
import type { PoseFrame } from './types';

/** 스쿼트 깊이 d 의 합성 PoseFrame */
function poseFrame(d: number, t: number): PoseFrame {
  const lm = Array.from({ length: JOINTS }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const set = (j: number, x: number, y: number) => { lm[j] = { x, y, z: 0, visibility: 1 }; };
  set(0, 0.5, 0.15 + 0.2 * d);
  set(11, 0.6, 0.3 + 0.2 * d); set(12, 0.4, 0.3 + 0.2 * d);
  set(13, 0.62, 0.42 + 0.1 * d); set(14, 0.38, 0.42 + 0.1 * d);
  set(15, 0.63, 0.54); set(16, 0.37, 0.54);
  set(23, 0.56, 0.5 + 0.2 * d); set(24, 0.44, 0.5 + 0.2 * d);
  set(25, 0.6 + 0.1 * d, 0.7); set(26, 0.4 - 0.1 * d, 0.7);
  set(27, 0.58, 0.9); set(28, 0.42, 0.9);
  return { t, lm, world: lm.map((p) => ({ ...p })), fps: 30 };
}

const CHAIN = [[11, 12, 23, 24, 25, 26, 27, 28]];

function dataset(kind: 'rep' | 'hold') {
  const vecs: LabeledVector[] = [];
  const add = (d: number, state: LabeledVector['state'], i: number) => {
    const n = normalizeFrame(frameToRow(poseFrame(d, 0)))!;
    vecs.push({ exerciseId: kind === 'rep' ? 'squat' : 'plank', state, vec: n.vec, mask: n.mask, sampleId: `s${i}`, frame: i });
  };
  for (let i = 0; i < 8; i++) {
    if (kind === 'rep') { add(0.02 * i, 'top', i); add(1 - 0.02 * i, 'bottom', 100 + i); }
    else add(1 - 0.02 * i, 'hold', i);
    add(0.5 + 0.01 * i, 'none', 200 + i); // 중간 자세는 none
  }
  return buildDataset(vecs);
}

describe('learned rep detector', () => {
  it('top → bottom → top 이면 rep 1회와 bottom phase 이벤트', () => {
    const det = createLearnedDetector('squat', 'rep', dataset('rep'), CHAIN);
    const events = [];
    let t = 0;
    for (const d of [...Array(10).fill(0), ...Array(10).fill(1), ...Array(15).fill(0)]) {
      t += 100;
      events.push(...det.update(poseFrame(d, t)));
    }
    expect(events.filter((e) => e.type === 'phase' && e.phase === 'bottom').length).toBe(1);
    expect(events.filter((e) => e.type === 'rep').length).toBe(1);
    expect(det.state().reps).toBe(1);
    expect(det.state().debug.mode).toBe('learned');
  });
  it('서 있기만 하면 0회, 사람이 없으면 lowConfidence', () => {
    const det = createLearnedDetector('squat', 'rep', dataset('rep'), CHAIN);
    let t = 0;
    const ev = [];
    for (let i = 0; i < 20; i++) ev.push(...det.update(poseFrame(0, (t += 100))));
    expect(det.state().reps).toBe(0);
    // EMA 가 none 을 0.9 까지 올리는 데 7프레임, 거기에 0.5초 지속 → 약 1.3초
    for (let i = 0; i < 20; i++) ev.push(...det.update({ t: (t += 100), lm: [], world: [], fps: 30 }));
    expect(ev.some((e) => e.type === 'lowConfidence')).toBe(true);
    expect(det.state().confident).toBe(false);
  });
});

describe('learned hold detector', () => {
  it('hold 자세가 이어지면 시간이 쌓이고, 아니면 안 쌓인다', () => {
    const det = createLearnedDetector('plank', 'hold', dataset('hold'), CHAIN);
    let t = 0;
    for (let i = 0; i < 30; i++) det.update(poseFrame(1, (t += 100)));
    expect(det.state().holding).toBe(true);
    expect(det.state().holdMs).toBeGreaterThan(1500);
    const before = det.state().holdMs;
    for (let i = 0; i < 30; i++) det.update(poseFrame(0, (t += 100)));
    expect(det.state().holding).toBe(false);
    expect(det.state().holdMs).toBeLessThanOrEqual(before + 1300); // EMA 지연 + 유예 1초 안에서만 더 쌓임
  });
});
