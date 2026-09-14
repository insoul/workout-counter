import { buildDataset, type Dataset } from './knn';
import { inflateCompact, type CompactVector } from './compact';
import type { SampleInput, SampleMarks, SampleMeta } from './types';

const URL = '/api/samples';

export async function saveSample(input: SampleInput): Promise<string | null> {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id: string }).id;
  } catch {
    return null;
  }
}

export async function listSamples(exerciseId?: string): Promise<{ samples: SampleMeta[]; counts: Record<string, number> } | null> {
  try {
    const res = await fetch(exerciseId ? `${URL}?exercise=${encodeURIComponent(exerciseId)}` : URL);
    if (!res.ok) return null;
    return (await res.json()) as { samples: SampleMeta[]; counts: Record<string, number> };
  } catch {
    return null;
  }
}

export async function deleteSample(id: string): Promise<boolean> {
  try {
    return (await fetch(`${URL}/${id}`, { method: 'DELETE' })).ok;
  } catch {
    return false;
  }
}

export async function updateSampleMarks(id: string, marks: SampleMarks): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marks }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 운동 시작 시 한 번 — 실패(오프라인·미로그인)면 null → 규칙 디텍터로 */
export async function loadDataset(): Promise<{ ds: Dataset; counts: Record<string, number> } | null> {
  try {
    const res = await fetch(`${URL}?compact=1`);
    if (!res.ok) return null;
    const body = (await res.json()) as { dataset: CompactVector[]; counts: Record<string, number> };
    return { ds: buildDataset(inflateCompact(body.dataset)), counts: body.counts };
  } catch {
    return null;
  }
}
