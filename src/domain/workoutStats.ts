/** 운동 화면·프로필·요약에서 쓰는 순수 계산 함수 */
import { addDays, parseDate, weekStart } from './stats.ts';

export interface SimpleSet { weight: number | null; reps: number | null; done: number | boolean; set_type: string }

/** 완료한 본 세트의 볼륨(kg×회). 맨몸(무게 없음)은 0 */
export function volumeOf(sets: SimpleSet[]): number {
  return sets.reduce((n, s) => (s.done && s.set_type !== 'warmup' && s.weight && s.reps ? n + s.weight * s.reps : n), 0);
}

export function doneWorkingCount(sets: SimpleSet[]): number {
  return sets.filter((s) => s.done && s.set_type !== 'warmup').length;
}

/** 예상 1RM (Epley). 1회면 그 무게 */
export function e1rm(weight: number | null | undefined, reps: number | null | undefined): number | null {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  const v = reps === 1 ? weight : weight * (1 + reps / 30);
  return Math.round(v * 10) / 10;
}

/** 세트들 중 가장 높은 예상 1RM */
export function bestE1rm(sets: SimpleSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!s.done || s.set_type === 'warmup') continue;
    const v = e1rm(s.weight, s.reps);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/** 다음 목표 추천: 12회 미만이면 같은 무게로 1회 더, 12회 이상이면 무게를 한 단계 올리고 8회 */
export function recommendNext(last: { weight: number | null; reps: number | null } | null, step: number): { weight: number; reps: number } | null {
  if (!last || !last.weight || !last.reps) return null;
  if (last.reps >= 12) return { weight: Math.round((last.weight + step) * 100) / 100, reps: 8 };
  return { weight: last.weight, reps: last.reps + 1 };
}

/** 바벨 총 무게 = 바 + 양쪽 원판 (원판은 한쪽 기준 목록) */
export function barbellTotal(bar: number, perSide: number[]): number {
  return Math.round((bar + 2 * perSide.reduce((a, b) => a + b, 0)) * 100) / 100;
}

/** 예상 운동 시간(분): 세트마다 수행 40초 + 휴식 */
export function estimateMinutes(items: { sets: number; restSec: number }[]): number {
  const sec = items.reduce((n, i) => n + i.sets * (40 + i.restSec), 0);
  return Math.max(1, Math.round(sec / 60));
}

/** 이번 주(월~일) 부위별 완료 세트·볼륨 */
export function partTotals<T extends { date: string; done: boolean; setType: string; weight: number | null; reps: number | null; isRm?: boolean }>(
  flat: T[], from: string, to: string, partOf: (s: T) => string,
): { part: string; sets: number; volume: number }[] {
  const m = new Map<string, { sets: number; volume: number }>();
  for (const s of flat) {
    if (!s.done || s.setType === 'warmup' || s.isRm || s.date < from || s.date > to) continue;
    const p = partOf(s);
    const cur = m.get(p) ?? { sets: 0, volume: 0 };
    cur.sets += 1;
    cur.volume += s.weight && s.reps ? s.weight * s.reps : 0;
    m.set(p, cur);
  }
  return [...m.entries()].map(([part, v]) => ({ part, ...v })).sort((a, b) => b.sets - a.sets);
}

/** 운동한 날짜들로 '주 연속 기록'을 센다. 이번 주에 아직 운동이 없으면 지난주까지 이어진 기록을 센다 */
export function streakWeeks(dates: string[], today: string): number {
  const weeks = new Set(dates.map(weekStart));
  let w = weekStart(today);
  if (!weeks.has(w)) w = addDays(w, -7);
  let n = 0;
  while (weeks.has(w)) { n++; w = addDays(w, -7); }
  return n;
}

/** 이번 달의 주차별 운동 횟수 (월요일 시작, 달에 걸친 주 포함) */
export function monthWeeks(dates: string[], today: string): { label: string; count: number; current: boolean }[] {
  const d = parseDate(today);
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const lastStr = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  const out: { label: string; count: number; current: boolean }[] = [];
  let w = weekStart(first);
  let i = 1;
  while (w <= lastStr) {
    const end = addDays(w, 6);
    out.push({ label: `${i}주`, count: dates.filter((x) => x >= w && x <= end).length, current: today >= w && today <= end });
    w = addDays(w, 7); i++;
  }
  return out;
}

/** 이번 달 운동한 날 수 */
export function monthDays(dates: string[], today: string): number {
  const ym = today.slice(0, 7);
  return new Set(dates.filter((x) => x.startsWith(ym))).size;
}
