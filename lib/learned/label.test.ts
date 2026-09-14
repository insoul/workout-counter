import { describe, expect, it } from 'vitest';
import { defaultMarks, labelSample, thinDataset } from './label';
import { JOINTS } from './normalize';
import type { LabeledVector } from './types';

/** 스쿼트 깊이 d(0=서기, 1=완전히 앉기)에 따른 합성 프레임 */
function pose(d: number): number[] {
  const f = new Array(JOINTS * 4).fill(0);
  const set = (j: number, x: number, y: number) => { f[j * 4] = x; f[j * 4 + 1] = y; f[j * 4 + 3] = 1; };
  set(0, 0.5, 0.15 + 0.2 * d);
  set(11, 0.6, 0.3 + 0.2 * d); set(12, 0.4, 0.3 + 0.2 * d);
  set(13, 0.62, 0.42 + 0.1 * d); set(14, 0.38, 0.42 + 0.1 * d);
  set(15, 0.63, 0.54); set(16, 0.37, 0.54);
  set(23, 0.56, 0.5 + 0.2 * d); set(24, 0.44, 0.5 + 0.2 * d);
  set(25, 0.6 + 0.1 * d, 0.7); set(26, 0.4 - 0.1 * d, 0.7);
  set(27, 0.58, 0.9); set(28, 0.42, 0.9);
  return f;
}

/** 30fps: 1초 서기 → 1초 앉기(반 내려감) → 1초 서기 = 90프레임, 가장 깊은 곳은 45번 */
function squatClip(): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < 90; i++) {
    const d = i < 30 ? 0 : i < 60 ? Math.sin(((i - 30) / 30) * Math.PI) : 0;
    frames.push(pose(d));
  }
  return frames;
}

describe('defaultMarks', () => {
  it('rep 은 전체 구간 + 가장 깊은 프레임', () => {
    const m = defaultMarks(squatClip(), 'rep');
    expect(m.start).toBe(0);
    expect(m.end).toBe(89);
    expect(Math.abs(m.bottom! - 45)).toBeLessThanOrEqual(1);
  });
  it('hold 는 앞뒤 20% 를 뺀다, none 은 전체', () => {
    const frames = squatClip();
    expect(defaultMarks(frames, 'hold')).toEqual({ start: 18, end: 71 });
    expect(defaultMarks(frames, 'none')).toEqual({ start: 0, end: 89 });
  });
});

describe('labelSample', () => {
  const base = { id: 's1', exerciseId: 'squat' as const, kind: 'rep' as const, fps: 30, frames: squatClip() };
  it('rep 전체 구간이면 top·bottom 이 나오고 none 은 없다', () => {
    const v = labelSample({ ...base, marks: defaultMarks(base.frames, 'rep') });
    const count = (s: string) => v.filter((x) => x.state === s).length;
    expect(count('top')).toBeGreaterThan(0);
    expect(count('bottom')).toBeGreaterThan(0);
    expect(count('none')).toBe(0);
    expect(v.every((x) => x.vec.length === 66 && x.sampleId === 's1')).toBe(true);
  });
  it('구간을 좁히면 밖은 none 이 된다', () => {
    const v = labelSample({ ...base, marks: { start: 30, end: 60, bottom: 45 } });
    expect(v.filter((x) => x.state === 'none').length).toBeGreaterThan(0);
    expect(v.filter((x) => x.state === 'none').every((x) => x.frame < 30 || x.frame > 60)).toBe(true);
  });
  it('0.1초 간격이라 30fps 1초 서기에서 top 은 3프레임 간격, 상태별 상한을 지킨다', () => {
    const v = labelSample({ ...base, marks: defaultMarks(base.frames, 'rep') });
    const tops = v.filter((x) => x.state === 'top').map((x) => x.frame);
    expect(tops[1] - tops[0]).toBe(3);
    const capped = labelSample({ ...base, marks: defaultMarks(base.frames, 'rep') }, { perStateCap: 4 });
    expect(capped.filter((x) => x.state === 'top').length).toBe(4);
  });
  it('hold 는 구간 전체가 hold, none 항목은 전체 none', () => {
    const h = labelSample({ ...base, exerciseId: 'plank', kind: 'hold', marks: { start: 18, end: 71 } });
    expect(new Set(h.map((x) => x.state))).toEqual(new Set(['hold', 'none'])); // 구간 밖은 none
    expect(h.filter((x) => x.state === 'hold').every((x) => x.frame >= 18 && x.frame <= 71)).toBe(true);
    const n = labelSample({ ...base, exerciseId: 'none', kind: 'none', marks: { start: 0, end: 89 } });
    expect(new Set(n.map((x) => x.state))).toEqual(new Set(['none']));
  });
});

describe('thinDataset', () => {
  it('(운동, 상태)별 상한으로 균등 솎기', () => {
    const mk = (i: number, state: 'top' | 'none'): LabeledVector => ({
      exerciseId: 'squat', state, vec: new Float32Array(66), mask: new Uint8Array(33), sampleId: 's', frame: i,
    });
    const many = [...Array.from({ length: 50 }, (_, i) => mk(i, 'top')), ...Array.from({ length: 5 }, (_, i) => mk(i, 'none'))];
    const out = thinDataset(many, 10);
    expect(out.filter((x) => x.state === 'top').length).toBe(10);
    expect(out.filter((x) => x.state === 'none').length).toBe(5);
    expect(out.filter((x) => x.state === 'top')[9].frame).toBe(45);
  });
});
