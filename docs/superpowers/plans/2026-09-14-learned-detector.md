# 학습 디텍터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 녹화하고 구간을 표시한 관절 좌표 샘플을 kNN 모델로 써서, 규칙 디텍터 대신 자세 상태를 분류해 횟수·유지 시간을 센다.

**Architecture:** 순수 모듈(정규화 → 라벨 → kNN 데이터셋 → 학습 디텍터)을 먼저 만들고 테스트한다. 샘플은 Neon `pose_samples` 에 원본 프레임과 표시값으로 저장하고, 서버가 compact 벡터로 내려준다. 학습 디텍터는 기존 `ExerciseDetector` 인터페이스를 구현해 `createDetectorFor(id, dataset)` 팩토리로 규칙 디텍터와 교체된다.

**Tech Stack:** Next.js 16, React 19, TypeScript, @neondatabase/serverless, MediaPipe Pose(기존), vitest(신규, 순수 모듈 테스트)

**Spec:** `docs/superpowers/specs/2026-09-14-learned-detector-design.md`

## Global Constraints

- 영상은 저장·전송하지 않는다. 샘플은 관절 좌표(33×4)와 메타데이터만.
- 샘플 없거나 부족하면(운동 10개 미만 또는 none 5개 미만) 규칙 디텍터 유지.
- 정규화·라벨·솎기는 읽는 쪽(서버 compact 응답)에서 한다. 원본 프레임은 그대로 보관.
- 기존 lint 에러(WorkoutScreen ref 패턴, useRoutine)는 건드리지 않는다.
- 커밋 메시지 한글, Co-Authored-By 꼬리 유지.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/learned/types.ts` | `PoseSample`, `SampleMarks`, `LabeledVector`, `Dataset`, `SampleState` 타입 |
| `lib/learned/normalize.ts` | 프레임(33×4) → 66차원 벡터 + 마스크. 좌우 반전 증강 |
| `lib/learned/label.ts` | 기본 손잡이 추정, 표시값 → 상태 라벨, 0.1초 간격 선택, 상한 솎기 |
| `lib/learned/knn.ts` | 데이터셋 구성(`buildDataset`), 분류(`classify`), EMA |
| `lib/detectors/learned.ts` | `createLearnedDetector(id, kind, dataset)` — rep 상태 머신 / hold 는 HoldDetector 재사용 |
| `lib/detectors/factory.ts` | `createDetectorFor(id, dataset, forceRules)` 교체 규칙 |
| `lib/learned/db.ts` | `pose_samples` CRUD |
| `lib/learned/client.ts` | 브라우저: 샘플 저장/목록/삭제, compact 데이터셋 로드 |
| `app/api/samples/route.ts`, `app/api/samples/[id]/route.ts` | API |
| `components/LearnScreen.tsx` | 녹화·타임라인 표시·저장·목록 |
| `components/PoseFigure.tsx` | 프레임 하나를 막대 인형 SVG 로 |
| `app/learn/page.tsx` | 페이지(로그인 필요) |
| `components/FreeScreen.tsx`, `components/WorkoutScreen.tsx` | 팩토리 사용, 데이터셋 로드 |
| `lib/debug.ts`, `components/DebugToggle.tsx` | "규칙 강제" 토글 |
| `app/page.tsx` | 학습 모드 링크 |

---

### Task 1: vitest 도입 + 정규화

**Files:** Create `lib/learned/types.ts`, `lib/learned/normalize.ts`, `lib/learned/normalize.test.ts`. Modify `package.json`(scripts.test, devDeps vitest).

**Interfaces (Produces):**
```ts
export const VEC_DIM = 66;
export interface NormalizedFrame { vec: Float32Array /* 66 */; mask: Uint8Array /* 33, 1=보임 */ }
export function normalizeFrame(frame: number[] /* 33*4 x,y,z,vis */, minVis = 0.3): NormalizedFrame | null
export function mirrorFrame(f: NormalizedFrame): NormalizedFrame
export function frameDistance(a: NormalizedFrame, b: NormalizedFrame): number  // 마스크 공통 관절만, 관절 수로 나눠 정규화
```
- null 은 엉덩이·어깨 중 하나라도 안 보여 기준을 못 잡는 경우.
- 좌우 인덱스 쌍: (11,12)(13,14)(15,16)(17,18)(19,20)(21,22)(23,24)(25,26)(27,28)(29,30)(31,32), (1,4)(2,5)(3,6)(7,8)(9,10).

- [ ] `npm i -D vitest`, `"test": "vitest run"` 추가
- [ ] 테스트: 이동 불변(모든 점에 +0.3 해도 같은 벡터), 크기 불변(×2 해도 같음), 마스크(vis 0.2 관절은 mask 0), mirror 는 x 부호 반전 + 좌우 교환, frameDistance(a,a)=0
- [ ] 구현, `npm test` 통과, 커밋

### Task 2: 라벨과 프레임 선택

**Files:** Create `lib/learned/label.ts`, `lib/learned/label.test.ts`.

**Interfaces (Consumes):** `normalizeFrame`, `frameDistance`.
**Produces:**
```ts
export type SampleState = 'top' | 'bottom' | 'hold' | 'none';
export interface SampleMarks { start: number; end: number; bottom?: number }
export function defaultMarks(frames: number[][], kind: 'rep' | 'hold' | 'none'): SampleMarks
export interface LabeledVector { exerciseId: string; state: SampleState; vec: Float32Array; mask: Uint8Array; sampleId: string; frame: number }
export function labelSample(sample: { id: string; exerciseId: string; kind: 'rep'|'hold'|'none'; fps: number; frames: number[][]; marks: SampleMarks }, opts?: { intervalMs?: number; perStateCap?: number }): LabeledVector[]
export function thinDataset(vectors: LabeledVector[], capPerClass = 300): LabeledVector[]
```
- `defaultMarks`: rep → start=0, end=last, bottom=argmax distance from frame 0; hold → 앞뒤 20% 제외; none → 전체.
- `labelSample`: 구간 밖 → `none`(exerciseId 는 그대로 두되 state none). rep 은 bottom 거리 기준 25%/70%. 0.1초 간격(fps 로 프레임 수 환산), 상태별 상한 20.
- `thinDataset`: (exerciseId,state) 별 300 초과 시 균등 솎기(오래된 것부터: 입력 순서가 시간순이라고 가정).

- [ ] 테스트: 합성 30fps 시퀀스(1초 서기 → 1초 앉기(엉덩이 y 증가) → 1초 서기)에서 defaultMarks.bottom 이 가운데 근처, labelSample 결과에 top·bottom 모두 ≥1, none 0; marks 를 가운데 1초로 좁히면 none ≥1; hold 는 hold 만; 상한 20 적용; thinDataset 로 300 상한
- [ ] 구현, 테스트 통과, 커밋

### Task 3: kNN

**Files:** Create `lib/learned/knn.ts`, `lib/learned/knn.test.ts`.

**Produces:**
```ts
export interface Dataset { vectors: LabeledVector[]; classes: string[] /* `${exerciseId}:${state}` 와 'none' */ }
export function buildDataset(vectors: LabeledVector[]): Dataset   // mirror 증강 포함
export interface Classification { probs: Record<string, number>; nearest: { sampleId: string; frame: number; dist: number } | null }
export function classify(ds: Dataset, f: NormalizedFrame, k = 5): Classification
export class Ema { constructor(alpha = 0.3); update(p: Record<string, number>): Record<string, number>; reset(): void }
```
- 클래스 키: rep 은 `squat:top`/`squat:bottom`, hold 는 `plank:hold`, none 은 `none`.
- probs 는 k 개 중 표 수 / k. 데이터셋이 비면 `{ none: 1 }`.

- [ ] 테스트: 두 군집(벡터 A 근처 10개 = squat:top, B 근처 10개 = squat:bottom)에서 A 근처 질의 → squat:top ≥ 0.8; Ema 가 한 프레임 튐을 0.3 으로 줄임
- [ ] 구현, 테스트 통과, 커밋

### Task 4: 학습 디텍터

**Files:** Create `lib/detectors/learned.ts`, `lib/detectors/learned.test.ts`.

**Consumes:** `Dataset`, `classify`, `Ema`, `normalizeFrame`, `HoldDetector`, `ExerciseDetector`, `DetectorEvent`.
**Produces:**
```ts
export function createLearnedDetector(id: ExerciseId, kind: 'rep' | 'hold', ds: Dataset, requiredChains: number[][]): ExerciseDetector
```
- `PoseFrame` → `number[]`(33×4: lm x,y,z? → x,y 는 lm, z 는 world.z, vis) 변환은 여기서.
- 필수 관절(requiredChains, fullBodyCheck) 없으면 probs {none:1} 취급.
- rep: `top` 확률 ≥ 0.6 → top, `bottom` ≥ 0.6 → bottom, 그 외 유지. top→bottom 진입 시 `{type:'phase',phase:'bottom'}`; bottom→top 복귀 시 minRepMs(700) 디바운스 후 `{type:'rep'}`. lowConfidence/confidenceRestored 는 none 확률 ≥ 0.9 가 500ms 지속 시.
- hold: `HoldDetector(id, { isHolding: f => hold 확률 ≥ 0.6 ? true : none ≥ 0.9 ? null : false, inspect })`.
- `state().debug`: `mode:'learned'`, 상태별 확률(소수 2자리), `nearest`(sampleId 앞 6자 + 거리), rep 은 `phase`.
- `adjust`, `reset` 구현.

- [ ] 테스트: 가짜 데이터셋(A=top, B=bottom 벡터)으로 프레임 시퀀스 A×10 → B×10 → A×10 넣으면 rep 1회 + bottom phase 이벤트 1회; A×10 만 넣으면 0회
- [ ] 구현, 테스트 통과, 커밋

### Task 5: 팩토리와 교체 규칙

**Files:** Create `lib/detectors/factory.ts`, `lib/detectors/factory.test.ts`. Modify `lib/debug.ts`(forceRules 저장), `components/DebugToggle.tsx`(배지 옆 "규칙" 토글).

**Produces:**
```ts
export const MIN_SAMPLES = 10, MIN_NONE = 5;
export function hasEnoughSamples(counts: Record<string, number>, id: ExerciseId): boolean  // counts[id] ≥ 10 && counts.none ≥ 5
export function createDetectorFor(id: ExerciseId, ds: Dataset | null, counts: Record<string, number>, forceRules: boolean): ExerciseDetector
export function isRulesForced(): boolean; export function setRulesForced(on: boolean): void  // lib/debug.ts
```

- [ ] 테스트: counts 부족 → 규칙 디텍터(id 같고 debug.mode 없음), 충분 → learned(debug.mode==='learned'), forceRules → 규칙
- [ ] 구현, DebugToggle 에 디버그 켜졌을 때만 보이는 "규칙 강제" 체크 추가, 커밋

### Task 6: DB·API

**Files:** Create `lib/learned/db.ts`, `lib/learned/validate.ts`, `lib/learned/validate.test.ts`, `app/api/samples/route.ts`, `app/api/samples/[id]/route.ts`.

**Produces:**
```ts
// db.ts
export async function createSample(userId, input: SampleInput): Promise<string>
export async function listSamples(userId, exerciseId?): Promise<SampleMeta[]>   // frames 제외 + frameCount
export async function getSample(userId, id): Promise<PoseSample | null>
export async function updateMarks(userId, id, marks): Promise<boolean>
export async function deleteSample(userId, id): Promise<void>
export async function loadAllSamples(userId): Promise<PoseSample[]>  // compact 용
// validate.ts
export function sanitizeSampleInput(raw: unknown): SampleInput | null  // frames 30~600, 각 132 유한수, marks 범위, view/height enum
```
- 테이블: `pose_samples(id TEXT PK, user_id TEXT, exercise_id TEXT, view TEXT, height TEXT, fps REAL, frames JSONB, marks JSONB, created_at BIGINT)` + 인덱스(user_id, created_at DESC).
- `GET /api/samples` → `{ samples: SampleMeta[], counts }`; `?compact=1` → `{ dataset: LabeledVector[](vec 는 number[]), counts }` (labelSample+thinDataset 서버에서).
- `POST` 저장, `GET/[id]` 원본, `PATCH/[id]` marks, `DELETE/[id]`.

- [ ] validate 테스트(정상/프레임 수 초과/marks 범위 밖/enum 오류)
- [ ] 구현, `.env.local` 로 스모크(생성·목록·compact·삭제), 커밋

### Task 7: 학습 화면

**Files:** Create `app/learn/page.tsx`, `components/LearnScreen.tsx`, `components/PoseFigure.tsx`, `lib/learned/client.ts`. Modify `app/page.tsx`(링크).

- 녹화: 카메라·PoseEngine 시작(FreeScreen 과 같은 코드). "시작" 누르면 프레임 누적(33×4), "완료"로 종료. 2초 미만 경고, 15초 초과 자동 완료.
- 타임라인: `<input type=range>` 3개(start, end, rep 이면 bottom) + 현재 손잡이 프레임의 `PoseFigure`. 기본값은 `defaultMarks`. 라벨 결과 개수 표시(`labelSample` 클라이언트에서 실행).
- 저장 시트: view 4택·height 3택(localStorage 에 직전 값), 저장 → POST, 목록 갱신.
- 목록: 운동별 샘플 수 칩, 현재 운동 샘플(시각·각도·높이·프레임 수) + 삭제.

- [ ] 구현, 빌드, 폰 폭 목업 확인, 커밋

### Task 8: 자유 운동·루틴 연동

**Files:** Modify `components/FreeScreen.tsx`, `components/WorkoutScreen.tsx`, `lib/learned/client.ts`(`loadDataset(): Promise<{ds, counts} | null>`).

- 시작 버튼에서 `loadDataset()` 후 `createDetectorFor` 사용. 실패·미로그인 → null → 규칙.
- 디버그 패널·추적에 `mode` 와 확률이 inspect 로 자동 포함되는지 확인.
- 자유 운동 시작 음성에 "학습 디텍터 N개" 안내.

- [ ] 구현, 빌드, 커밋, 푸시·배포 후 폰에서 스쿼트 10개 녹화 → 자유 운동 확인
