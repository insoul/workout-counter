'use client';

import { MIN_NONE, MIN_SAMPLES, hasEnoughSamples } from '@/lib/detectors/factory';
import { EXERCISES, type ExerciseId } from '@/lib/detectors/registry';

const EXERCISE_IDS = Object.keys(EXERCISES) as ExerciseId[];

/** 학습 현황과 "몇 번 찍어야 하나" 안내를 한 장에 */
export default function LearnGuide({ counts, onClose }: { counts: Record<string, number>; onClose: () => void }) {
  const none = counts.none ?? 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const learned = EXERCISE_IDS.filter((id) => hasEnoughSamples(counts, id));

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-y-auto bg-neutral-950/95 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] text-sm text-neutral-200">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-black">학습 현황과 안내</h2>
        <button onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1.5 font-semibold">닫기</button>
      </div>

      <section className="mb-5">
        <h3 className="mb-2 font-bold text-white">누적 샘플 {total}개 · 학습 적용 {learned.length}/{EXERCISE_IDS.length}개 운동</h3>
        <div className="overflow-hidden rounded-xl bg-white/5">
          {EXERCISE_IDS.map((id) => {
            const n = counts[id] ?? 0;
            const ok = hasEnoughSamples(counts, id);
            const need = Math.max(0, MIN_SAMPLES - n);
            return (
              <div key={id} className="flex items-center justify-between border-b border-white/5 px-3 py-2 last:border-0">
                <span>
                  {EXERCISES[id].cameraIcon} {EXERCISES[id].nameKo}
                </span>
                <span className="tabular-nums">
                  <b className={ok ? 'text-green-400' : 'text-white'}>{n}</b>
                  <span className="ml-2 text-xs text-neutral-400">
                    {ok ? '학습 디텍터 사용 중' : need > 0 ? `${need}개 더 필요` : `아무것도 아님 ${Math.max(0, MIN_NONE - none)}개 더 필요`}
                  </span>
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2">
            <span>🚶 아무것도 아님</span>
            <span className="tabular-nums">
              <b className={none >= MIN_NONE ? 'text-green-400' : 'text-white'}>{none}</b>
              <span className="ml-2 text-xs text-neutral-400">{none >= MIN_NONE ? '충분' : `${MIN_NONE - none}개 더 필요`}</span>
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          운동 {MIN_SAMPLES}개 + 아무것도 아님 {MIN_NONE}개가 되면 그 운동은 규칙 대신 학습 디텍터로 바뀝니다. 별도 학습 단계는 없고 저장 즉시 반영됩니다.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-white">몇 번 찍어야 정확해지나</h3>
        <p>
          <b>운동당 10회</b>는 전환 최소치입니다. 같은 자리·각도라면 그 조건에서는 바로 규칙보다 낫습니다.
        </p>
        <p>
          <b>운동당 20~30회</b>면 실사용에서 안정됩니다. 핵심은 횟수보다 <b>다양성</b>입니다. 폰 위치 2~3곳, 각도 2가지(정면·측면), 빠르게·느리게, 옷 다르게를 섞으세요. 같은 조건 30회는 다른 조건 3회×10보다 못합니다.
        </p>
        <p>
          <b>아무것도 아님 20회 이상.</b> 오인식은 대부분 여기서 갈립니다. 걷기, 자리 잡기, 철봉 잡으러 가기, 폰 놓기, 허리 숙이기, 바닥에 엎드리기·일어나기를 몇 번씩 찍어 두세요. 운동 녹화의 구간 밖 프레임도 자동으로 여기에 쌓입니다.
        </p>
        <h3 className="pt-2 font-bold text-white">녹화 요령</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>반복 동작은 <b>위 자세</b>(선 자세·매달린 자세)에서 시작을 누르고 1회 한 뒤 완료를 누릅니다.</li>
          <li>완료 후 타임라인에서 시작·끝, 그리고 <b>바닥(가장 깊이 굽힌 순간)</b>을 정확히 잡을수록 좋습니다. 구간 밖은 자동으로 "아무것도 아님"이 됩니다.</li>
          <li>유지 동작은 자세를 잡고 시작을 누른 뒤 몇 초 버팁니다. 앞뒤 손 움직임은 구간 밖으로 빼세요.</li>
          <li>새 장소에 폰을 전혀 다른 각도로 두면 거기서 몇 회 더 찍어야 합니다. 거리·좌우 차이는 자동으로 흡수합니다.</li>
        </ul>
        <h3 className="pt-2 font-bold text-white">오인식이 남으면</h3>
        <p>
          디버그 묶음의 추적에 상태별 확률과 최근접 샘플이 남습니다. 오인식 순간에 none 확률이 낮고 운동 확률이 높으면 그 자세의 "아무것도 아님" 샘플이 부족한 것이고, 실제 운동인데 확률이 낮으면 그 각도의 운동 샘플이 부족한 것입니다.
        </p>
        <p className="text-neutral-400">첫 목표: 스쿼트·풀업 각 15회 + 아무것도 아님 20회. 30분이면 됩니다.</p>
      </section>
      <div className="h-6" />
    </div>
  );
}
