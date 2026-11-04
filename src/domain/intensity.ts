import type { FlatSet, Intensity, SessionRecord } from './types.ts';

/** 세트 강도 → 종목 강도 → 운동일 강도 → 미지정 */
export function resolveIntensity(
  setI: Intensity | null | undefined,
  exI: Intensity | null | undefined,
  sessionI: Intensity | null | undefined,
): Intensity {
  const pick = (v: Intensity | null | undefined) => (v && v !== 'none' ? v : null);
  // 'none'을 명시적으로 고른 경우도 "미지정"으로 취급하여 상위로 상속
  return pick(setI) ?? pick(exI) ?? pick(sessionI) ?? 'none';
}

export function flattenSessions(sessions: SessionRecord[]): FlatSet[] {
  const out: FlatSet[] = [];
  for (const s of sessions) {
    for (const ex of s.exercises) {
      for (const st of ex.sets) {
        out.push({
          date: s.date,
          sessionId: s.id,
          exerciseId: ex.exerciseId,
          exerciseName: ex.exerciseName,
          setNo: st.setNo,
          weight: st.weight,
          reps: st.reps,
          done: st.done,
          setType: st.setType,
          weightMode: ex.weightMode,
          intensity: resolveIntensity(st.intensity, ex.intensity, s.intensity),
        });
      }
    }
  }
  return out;
}
