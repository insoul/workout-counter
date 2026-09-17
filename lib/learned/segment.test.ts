import { describe, expect, it } from 'vitest';
import { JOINTS } from './normalize';
import { detectReps, sliceByReps } from './segment';

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
/** 걷는 중 — 다리가 안 보임(발목 신뢰도 0) */
function walking(i: number): number[] {
  const f = pose(0);
  f[27 * 4 + 3] = 0; f[28 * 4 + 3] = 0;
  f[23 * 4] += 0.05 * Math.sin(i / 3); // 좌우로 흔들림
  return f;
}
const CHAIN = [[11, 12, 23, 24, 25, 26, 27, 28]];

/** 30fps: 1초 걷기 → 1.5초 서기 → 스쿼트 5회(각 1.5초) → 1초 서기 → 1초 걷기 */
function clip() {
  const frames: number[][] = [];
  for (let i = 0; i < 30; i++) frames.push(walking(i));
  for (let i = 0; i < 45; i++) frames.push(pose(0));
  for (let r = 0; r < 5; r++) for (let i = 0; i < 45; i++) frames.push(pose(Math.sin((i / 45) * Math.PI)));
  for (let i = 0; i < 30; i++) frames.push(pose(0));
  for (let i = 0; i < 30; i++) frames.push(walking(i));
  return frames;
}

describe('detectReps', () => {
  it('5회를 찾고 바닥은 각 회의 가운데 근처', () => {
    const segs = detectReps(clip(), 30, CHAIN);
    expect(segs.length).toBe(5);
    segs.forEach((s, r) => {
      const expectedBottom = 75 + r * 45 + 22;
      expect(Math.abs(s.bottom! - expectedBottom)).toBeLessThanOrEqual(2);
      expect(s.start).toBeLessThan(s.bottom!);
      expect(s.end).toBeGreaterThan(s.bottom!);
    });
    // 겹치지 않고 순서대로
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThan(segs[i - 1].end);
  });
  it('움직임이 없으면 회가 없다', () => {
    expect(detectReps(Array.from({ length: 90 }, () => pose(0)), 30, CHAIN)).toEqual([]);
  });
});

describe('sliceByReps', () => {
  it('모든 프레임이 정확히 한 샘플에 들어가고 표시값은 슬라이스 기준으로 옮겨진다', () => {
    const frames = clip();
    const segs = [
      { start: 80, end: 115, bottom: 97 },
      { start: 125, end: 160, bottom: 142 },
    ];
    const out = sliceByReps(frames, segs);
    expect(out.length).toBe(2);
    expect(out[0].frames.length + out[1].frames.length).toBe(frames.length);
    expect(out[0].frames[0]).toBe(frames[0]);
    expect(out[0].marks).toEqual({ start: 80, end: 115, bottom: 97 });
    const cut = out[0].frames.length; // 120 = floor((115+125)/2)+1
    expect(cut).toBe(121);
    expect(out[1].marks).toEqual({ start: 125 - cut, end: 160 - cut, bottom: 142 - cut });
    expect(out[1].frames[out[1].frames.length - 1]).toBe(frames[frames.length - 1]);
  });
});
