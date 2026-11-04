import { addDays } from './stats.ts';

/** 날짜 계산 도우미: 사이클(N일 반복)에서 날짜가 몇 번째 칸인지 */

function dayNum(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** b - a (일) */
export function daysBetween(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

/** date가 사이클의 몇 번째 칸(0부터)인지. 시작일 이전 날짜도 순환 계산한다. */
export function cycleIndex(startDate: string, date: string, length: number): number {
  if (length <= 0) return 0;
  const diff = daysBetween(startDate, date);
  return ((diff % length) + length) % length;
}

/** '오늘이 N일차'가 되도록 시작일을 계산 (N은 1부터) */
export function startForDayNumber(today: string, dayNumber: number, length: number): string {
  const n = Math.max(1, Math.min(Math.max(1, length), Math.round(dayNumber)));
  return addDays(today, -(n - 1));
}

/** 지난 날을 '루틴대로' 하기로 했을 때: 사이클을 (오늘 - 놓친 날)일 뒤로 밀어 오늘이 그 칸이 되게 한다 */
export function shiftStartForMissed(startDate: string, missedDate: string, today: string): string {
  return addDays(startDate, Math.max(0, daysBetween(missedDate, today)));
}
