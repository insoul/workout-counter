import type { ExerciseId } from '@/lib/detectors/registry';

/** 녹화 한 번. 영상은 없고 관절 좌표(33×4: x, y, z, visibility)만 있다 */
export type SampleExercise = ExerciseId | 'none';
/** 카메라가 사람의 왼쪽·정면·오른쪽 중 어디에 있는지 */
export type SampleSide = 'left' | 'center' | 'right';
/** 카메라가 사람의 앞(얼굴 쪽)인지 뒤(등 쪽)인지 */
export type SampleFacing = 'front' | 'back';
/** "앞뒤-좌우" 로 합쳐 저장한다. 뒤의 넷은 초기 버전 값 — 읽기만 허용 */
export type SampleView = `${SampleFacing}-${SampleSide}` | 'front' | 'left' | 'right' | 'diagonal';
/** 폰 높이 — 저장값은 그대로 두고 화면에서는 위·허리·아래로 부른다 */
export type SampleHeight = 'floor' | 'waist' | 'eye';

export function splitView(view: SampleView): { facing: SampleFacing; side: SampleSide } {
  if (view.includes('-')) {
    const [facing, side] = view.split('-') as [SampleFacing, SampleSide];
    return { facing, side };
  }
  return { facing: 'front', side: view === 'left' ? 'left' : view === 'right' ? 'right' : 'center' };
}
export type SampleKind = 'rep' | 'hold' | 'none';

/** 사용자가 타임라인에서 표시한 구간(프레임 번호, end 포함). 구간 밖은 none 으로 쓴다 */
export interface SampleMarks {
  start: number;
  end: number;
  /** rep 운동만 — 가장 깊이 굽힌 프레임 */
  bottom?: number;
}

export interface SampleInput {
  id?: string;
  exerciseId: SampleExercise;
  view: SampleView;
  height: SampleHeight;
  fps: number;
  frames: number[][];
  marks: SampleMarks;
}

export interface PoseSample extends SampleInput {
  id: string;
  createdAt: number;
}

/** 목록용 — 프레임 본문은 뺀다 */
export interface SampleMeta {
  id: string;
  exerciseId: SampleExercise;
  view: SampleView;
  height: SampleHeight;
  fps: number;
  frameCount: number;
  marks: SampleMarks;
  createdAt: number;
}

export type SampleState = 'top' | 'bottom' | 'hold' | 'none';

/** kNN 데이터셋의 점 하나 */
export interface LabeledVector {
  exerciseId: SampleExercise;
  state: SampleState;
  vec: Float32Array;
  mask: Uint8Array;
  sampleId: string;
  frame: number;
}

/** 클래스 키: rep 은 "squat:top"/"squat:bottom", hold 는 "plank:hold", 부정은 "none" */
export function classKey(exerciseId: SampleExercise, state: SampleState): string {
  return state === 'none' ? 'none' : `${exerciseId}:${state}`;
}
