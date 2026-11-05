/** 경과 시간 mm:ss (1시간 이상이면 h:mm:ss) */
export function fmtElapsed(sec: number): string {
  const s0 = Math.max(0, Math.round(sec));
  const h = Math.floor(s0 / 3600);
  const m = Math.floor((s0 % 3600) / 60);
  const s = s0 % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** ISO 시각 → 기기 로컬 시계 HH:MM */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 총 운동 시간을 '1시간 5분' / '42분' 으로 */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return '';
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

/** 다음 세트 입력 시작값: 같은 종류(준비/본)의 바로 앞 세트 값 → 없으면 지난 운동 기록 */
export function suggestFor<T extends { set_type: string }>(
  sets: T[], index: number, pick: (s: T) => number | null, last: number | null,
): number | null {
  const type = sets[index].set_type;
  for (let j = index - 1; j >= 0; j--) {
    if (sets[j].set_type !== type) continue;
    const v = pick(sets[j]);
    if (v != null) return v;
  }
  return type === 'working' ? last : null;
}

/** 세트 사이 휴식 시간(초): 종목에 정해 둔 값이 있으면 그것, 없으면 기본값. 0 이하면 휴식 타이머를 쓰지 않는다. */
export function restFor(exerciseSec: number | null | undefined, defaultSec: number): number {
  const v = exerciseSec != null && exerciseSec > 0 ? exerciseSec : defaultSec;
  return Number.isFinite(v) && v > 0 ? Math.min(600, Math.round(v)) : 0;
}
