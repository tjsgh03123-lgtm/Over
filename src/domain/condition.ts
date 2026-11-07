/** 오늘 컨디션에 맞춰 시작 전에 무게·세트를 줄이는 계산 (이번 운동에만 쓰고 루틴은 바뀌지 않는다) */

export type Cond = 100 | 75 | 50;
export const CONDS: Cond[] = [100, 75, 50];
export const COND_LABEL: Record<Cond, string> = {
  100: '평소와 같아요 · 루틴 그대로',
  75: '조금 피곤해요 · 무게 −10%, 세트가 4개 이상이면 1세트 줄임',
  50: '많이 피곤해요 · 무게 −20%, 세트 2/3로 줄임(최소 2세트)',
};

const toStep = (w: number, step: number) => {
  const s = step > 0 ? step : 2.5;
  return Math.round((Math.round(w / s) * s) * 100) / 100;
};

/** 종목 하나의 목표 세트 수·무게를 컨디션에 맞게 바꾼다 (무게는 증량 단위에 맞춰 반올림) */
export function adjustForCondition(sets: number, weight: number | null, cond: Cond, step: number): { sets: number; weight: number | null } {
  if (cond === 100) return { sets, weight };
  const factor = cond === 75 ? 0.9 : 0.8;
  let w = weight;
  if (weight != null && weight > 0) {
    w = toStep(weight * factor, step);
    if (w <= 0) w = step > 0 ? step : 2.5; // 0kg로 떨어지지는 않게
  }
  let s = sets;
  if (cond === 75) s = sets >= 4 ? sets - 1 : sets;
  else s = sets <= 1 ? sets : Math.max(2, Math.round((sets * 2) / 3));
  return { sets: s, weight: w };
}

/** 진행 방식: 직접 기록 / 카메라로 횟수 세기 / 박자에 맞춰 센 횟수를 따라가기 */
export type RunMode = 'manual' | 'camera' | 'tempo';
export const RUN_LABEL: Record<RunMode, string> = { manual: '직접 기록', camera: '카메라', tempo: '박자' };
export function sanitizeRunMode(v: string | null | undefined): RunMode {
  return v === 'camera' || v === 'tempo' ? v : 'manual';
}
