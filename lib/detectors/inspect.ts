/** 디버그 패널·스냅샷에 넣을 값. 각도는 정수, 비율은 소수 둘째 자리까지 */
export type Inspection = Record<string, number | string>;

export const deg = (v: number | null | undefined): number => (v == null ? -1 : Math.round(v));
export const ratio = (v: number | null | undefined): number =>
  v == null ? -1 : Math.round(v * 100) / 100;
export const yn = (v: boolean | null | undefined): string => (v == null ? '?' : v ? 'Y' : 'n');
