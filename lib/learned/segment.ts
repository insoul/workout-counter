import { frameDistance, normalizeFrame, type NormalizedFrame } from './normalize';
import type { SampleMarks } from './types';

/**
 * 한 녹화에서 반복 동작의 회를 자동으로 찾는다 — 타임라인 손잡이의 기본 위치용.
 * 1) 필수 관절이 다 보이면서 움직임이 가장 오래 멈춘 구간의 가운데 프레임을 "위 자세" 기준 T 로 잡는다
 * 2) 프레임마다 T 와의 거리 s 를 구하고, s 가 솟았다가 양쪽 모두 다시 낮아지는 봉우리를 회로 본다
 *    (걸어 들어오고 나가는 동작은 다시 낮아지지 않아 제외된다)
 */

const STILL_MOTION = 0.06; // 정지 판정 — 정규화 단위(몸통 길이=1)
const MIN_PEAK = 0.15; // 이보다 낮은 봉우리는 회가 아니다
const LOW_RATIO = 0.3; // 봉우리의 이 비율 아래로 내려오면 회의 시작/끝
const MIN_REP_SEC = 0.4;
const MAX_REP_SEC = 8;
const REL_PEAK_KEEP = 0.4; // 유효 봉우리 중앙값의 이 비율 미만은 흔들림으로 보고 버린다

function rowVisible(row: number[], chains: number[][]): boolean {
  return chains.some((c) => c.every((j) => (row[j * 4 + 3] ?? 0) >= 0.5));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function detectReps(frames: number[][], fps: number, requiredChains: number[][]): SampleMarks[] {
  const n = frames.length;
  if (n < 2) return [];
  const norm: (NormalizedFrame | null)[] = frames.map((f) =>
    rowVisible(f, requiredChains) ? normalizeFrame(f) : null,
  );
  const k = Math.max(1, Math.round(fps * 0.1));

  // 1) 기준 자세 T — 가장 긴 정지 구간의 가운데
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const still =
      i < n && norm[i] && norm[i - k] ? frameDistance(norm[i]!, norm[i - k]!) < STILL_MOTION : false;
    if (still && runStart < 0) runStart = i;
    if (!still && runStart >= 0) {
      if (i - runStart > bestLen) {
        bestLen = i - runStart;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  const refIdx = bestStart >= 0 ? bestStart + Math.floor(bestLen / 2) : norm.findIndex((x) => x);
  if (refIdx < 0) return [];
  const T = norm[refIdx]!;

  // 2) T 와의 거리, 3프레임 중앙값으로 매끈하게
  const raw = norm.map((x) => (x ? frameDistance(x, T) : NaN));
  const s = raw.map((_, i) => {
    const w = [raw[i - 1], raw[i], raw[i + 1]].filter((v) => Number.isFinite(v));
    return w.length ? median(w) : NaN;
  });

  // 3) 봉우리 후보 → 양쪽으로 LOW 까지 내려오는지
  const maxLen = Math.round(MAX_REP_SEC * fps);
  const cands: { peak: number; start: number; end: number; bottom: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(s[i] >= MIN_PEAK) || !(s[i] >= s[i - 1]) || !(s[i] > s[i + 1])) continue;
    const low = s[i] * LOW_RATIO;
    let a = i;
    while (a > 0 && i - a < maxLen && !(s[a] < low)) a--;
    if (!(s[a] < low)) continue;
    let b = i;
    while (b < n - 1 && b - i < maxLen && !(s[b] < low)) b++;
    if (!(s[b] < low)) continue;
    // 봉우리 안에서 가장 먼 프레임을 바닥으로
    let bottom = i;
    for (let j = a; j <= b; j++) if (s[j] > s[bottom]) bottom = j;
    if (cands.length && a <= cands[cands.length - 1].end) {
      // 같은 회 안의 두 번째 봉우리 — 더 높은 쪽만 남긴다
      const last = cands[cands.length - 1];
      if (s[bottom] > last.peak) cands[cands.length - 1] = { peak: s[bottom], start: a, end: b, bottom };
      continue;
    }
    cands.push({ peak: s[bottom], start: a, end: b, bottom });
  }

  const minLen = Math.round(MIN_REP_SEC * fps);
  const valid = cands.filter((c) => c.end - c.start >= minLen);
  const keep = median(valid.map((c) => c.peak)) * REL_PEAK_KEEP;
  return valid.filter((c) => c.peak >= keep).map((c) => ({ start: c.start, end: c.end, bottom: c.bottom }));
}

/**
 * 여러 회를 담은 녹화를 회마다 샘플 하나로 나눈다. 모든 프레임이 정확히 한 샘플에 들어가도록
 * 회와 회 사이는 중간에서 자르고, 첫 회 앞·마지막 회 뒤는 그대로 붙인다 — 걸어 들어오고
 * 나가는 동작이 그 샘플의 "구간 밖"이 되어 부정 샘플로 쓰인다.
 */
export function sliceByReps(
  frames: number[][],
  segments: SampleMarks[],
): { frames: number[][]; marks: SampleMarks }[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  return sorted.map((seg, i) => {
    // 회가 겹치면 잘린 자리가 구간 안으로 들어올 수 있으므로 구간을 온전히 품도록 넓힌다
    const from = i === 0 ? 0 : Math.min(seg.start, Math.floor((sorted[i - 1].end + seg.start) / 2) + 1);
    const to =
      i === sorted.length - 1 ? frames.length - 1 : Math.max(seg.end, Math.floor((seg.end + sorted[i + 1].start) / 2));
    return {
      frames: frames.slice(from, to + 1),
      marks: {
        start: seg.start - from,
        end: seg.end - from,
        ...(seg.bottom !== undefined ? { bottom: seg.bottom - from } : {}),
      },
    };
  });
}
