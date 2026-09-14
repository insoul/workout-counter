import { describe, expect, it } from 'vitest';
import { JOINTS } from './normalize';
import { sanitizeMarks, sanitizeSampleInput } from './validate';

const frame = (): number[] => Array.from({ length: JOINTS * 4 }, (_, i) => (i % 4 === 3 ? 1 : 0.5));
const good = () => ({
  exerciseId: 'squat', view: 'front', height: 'waist', fps: 30,
  frames: Array.from({ length: 60 }, frame), marks: { start: 0, end: 59, bottom: 30 },
});

describe('sanitizeSampleInput', () => {
  it('정상 입력을 통과시키고 좌표를 소수 4자리로 줄인다', () => {
    const g = good(); g.frames[0][0] = 0.123456;
    const s = sanitizeSampleInput(g)!;
    expect(s.exerciseId).toBe('squat');
    expect(s.frames[0][0]).toBe(0.1235);
    expect(s.marks).toEqual({ start: 0, end: 59, bottom: 30 });
  });
  it('프레임 수·길이·값이 틀리면 거부', () => {
    expect(sanitizeSampleInput({ ...good(), frames: Array.from({ length: 10 }, frame) })).toBeNull();
    expect(sanitizeSampleInput({ ...good(), frames: [...good().frames, frame().slice(1)] })).toBeNull();
    const g = good(); g.frames[3][5] = NaN;
    expect(sanitizeSampleInput(g)).toBeNull();
  });
  it('운동·각도·높이 enum 과 id 형식을 검사한다', () => {
    expect(sanitizeSampleInput({ ...good(), exerciseId: 'yoga' })).toBeNull();
    expect(sanitizeSampleInput({ ...good(), exerciseId: 'none' })).not.toBeNull();
    expect(sanitizeSampleInput({ ...good(), view: 'top' })).toBeNull();
    expect(sanitizeSampleInput({ ...good(), height: 'sky' })).toBeNull();
    expect(sanitizeSampleInput({ ...good(), id: 'nope' })).toBeNull();
  });
});

describe('sanitizeMarks', () => {
  it('범위 밖·역순·bottom 이탈을 거부', () => {
    expect(sanitizeMarks({ start: 0, end: 60 }, 60)).toBeNull();
    expect(sanitizeMarks({ start: 10, end: 5 }, 60)).toBeNull();
    expect(sanitizeMarks({ start: 10, end: 20, bottom: 25 }, 60)).toBeNull();
    expect(sanitizeMarks({ start: 10, end: 20, bottom: 15 }, 60)).toEqual({ start: 10, end: 20, bottom: 15 });
  });
});
