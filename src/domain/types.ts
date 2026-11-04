export type Intensity = 'high' | 'mid' | 'low' | 'none';
export type SetType = 'warmup' | 'working';
export type WeightMode = 'weighted' | 'bodyweight' | 'assisted';

export const INTENSITY_LABEL: Record<Intensity, string> = {
  high: '고중량',
  mid: '중간중량',
  low: '저중량',
  none: '미지정',
};

export const INTENSITIES: Intensity[] = ['high', 'mid', 'low', 'none'];

/** 저장된 세트 1개 (강도는 세트에 직접 지정된 값만 가짐: null = 상속) */
export interface SetRecord {
  id: string;
  setNo: number;
  weight: number | null; // kg, 미입력이면 null
  reps: number | null;
  done: boolean;
  setType: SetType;
  intensity: Intensity | null; // null이면 종목→운동일 순으로 상속
}

export interface SessionExerciseRecord {
  id: string;
  exerciseId: string;
  exerciseName: string; // 기록 시점 이름 (이름 변경 후에도 과거 기록 유지)
  weightMode: WeightMode;
  intensity: Intensity | null;
  sets: SetRecord[];
}

export interface SessionRecord {
  id: string;
  date: string; // YYYY-MM-DD
  intensity: Intensity | null;
  exercises: SessionExerciseRecord[];
}

/** 통계 계산용 평탄화된 세트 */
export interface FlatSet {
  date: string;
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  setNo: number;
  weight: number | null;
  reps: number | null;
  done: boolean;
  setType: SetType;
  weightMode: WeightMode;
  intensity: Intensity; // 상속 결과
}
