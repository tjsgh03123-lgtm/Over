import type { FlatSet, Intensity, WeightMode } from './types.ts';

export type IntensityFilter = Intensity | 'all';
export type RangeKey = '7d' | '30d' | '3m' | '6m' | '1y' | 'all' | 'custom';

export interface DateRange {
  from: string | null;
  to: string | null;
}

export interface SetFilter {
  exerciseId?: string;
  intensity?: IntensityFilter;
  includeWarmup?: boolean; // 준비 세트를 포함(별도 조회용)
  onlyWarmup?: boolean;
  onlyRm?: boolean; // 1RM 측정 세트만
  range?: DateRange;
}

/** 기본 성장 통계에 포함되는 세트: 완료 + 본 세트 + 중량 입력됨 */
export function isStatEligible(s: FlatSet, opts: { includeWarmup?: boolean; onlyWarmup?: boolean; onlyRm?: boolean } = {}): boolean {
  if (!s.done) return false;
  if (s.weight == null || Number.isNaN(s.weight)) return false;
  if (opts.onlyRm) return !!s.isRm; // 1RM 탭
  if (s.isRm) return false; // 1RM 측정 세트는 평소 운동 기록과 섞지 않는다
  if (opts.onlyWarmup) return s.setType === 'warmup';
  if (!opts.includeWarmup && s.setType === 'warmup') return false;
  return true;
}

export function filterSets(all: FlatSet[], f: SetFilter = {}): FlatSet[] {
  return all.filter((s) => {
    if (f.exerciseId && s.exerciseId !== f.exerciseId) return false;
    if (!isStatEligible(s, f)) return false;
    if (f.intensity && f.intensity !== 'all' && s.intensity !== f.intensity) return false;
    if (f.range?.from && s.date < f.range.from) return false;
    if (f.range?.to && s.date > f.range.to) return false;
    return true;
  });
}

/** 보조(어시스트) 운동은 중량이 낮을수록 더 좋은 기록 */
export function isBetter(a: number, b: number, mode: WeightMode): boolean {
  return mode === 'assisted' ? a < b : a > b;
}

export interface DayPoint {
  date: string;
  best: number;
  bestReps: number | null;
  bestSetNo: number;
  bestIntensity: Intensity;
  bestSetType: 'warmup' | 'working';
  avg: number;
  volume: number;
  setCount: number;
}

export function dailyPoints(sets: FlatSet[], mode: WeightMode = 'weighted'): DayPoint[] {
  const byDate = new Map<string, FlatSet[]>();
  for (const s of sets) {
    if (s.weight == null) continue;
    const arr = byDate.get(s.date);
    if (arr) arr.push(s);
    else byDate.set(s.date, [s]);
  }
  const points: DayPoint[] = [];
  for (const [date, arr] of byDate) {
    let top = arr[0];
    for (const s of arr) {
      const w = s.weight as number;
      const tw = top.weight as number;
      if (isBetter(w, tw, mode) || (w === tw && (s.reps ?? 0) > (top.reps ?? 0))) top = s;
    }
    const weights = arr.map((s) => s.weight as number);
    const volume = arr.reduce((sum, s) => sum + (s.reps != null ? (s.weight as number) * s.reps : 0), 0);
    points.push({
      date,
      best: top.weight as number,
      bestReps: top.reps,
      bestSetNo: top.setNo,
      bestIntensity: top.intensity,
      bestSetType: top.setType,
      avg: weights.reduce((a, b) => a + b, 0) / weights.length,
      volume,
      setCount: arr.length,
    });
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 강도별 비교 그래프용: 고/중/저(+미지정) 각각의 날짜별 최고 중량 */
export function seriesByIntensity(
  all: FlatSet[],
  exerciseId: string,
  mode: WeightMode,
  range?: DateRange,
  includeNone = false,
): Record<Intensity, DayPoint[]> {
  const res = {} as Record<Intensity, DayPoint[]>;
  const list: Intensity[] = includeNone ? ['high', 'mid', 'low', 'none'] : ['high', 'mid', 'low'];
  for (const i of ['high', 'mid', 'low', 'none'] as Intensity[]) res[i] = [];
  for (const i of list) {
    res[i] = dailyPoints(filterSets(all, { exerciseId, intensity: i, range }), mode);
  }
  return res;
}

export interface Change {
  kg: number;
  pct: number | null; // 이전 값이 없거나 0이면 null
}

export function change(current: number | null | undefined, previous: number | null | undefined): Change | null {
  if (current == null || previous == null) return null;
  const kg = round2(current - previous);
  const pct = previous === 0 ? null : round2(((current - previous) / previous) * 100);
  return { kg, pct };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ExerciseSummary {
  currentBest: DayPoint | null; // 가장 최근 운동일의 최고
  allTimeBest: DayPoint | null;
  vsPrevious: Change | null;
  vsFirst: Change | null;
  rangeBest: number | null;
  rangeAvg: number | null;
  bestByIntensity: Record<Intensity, number | null>;
  sessionCount: number;
}

export function summarize(
  all: FlatSet[],
  exerciseId: string,
  mode: WeightMode,
  filter: { intensity?: IntensityFilter; range?: DateRange } = {},
): ExerciseSummary {
  const everything = dailyPoints(filterSets(all, { exerciseId, intensity: filter.intensity }), mode);
  const inRange = dailyPoints(filterSets(all, { exerciseId, intensity: filter.intensity, range: filter.range }), mode);

  let allTime: DayPoint | null = null;
  for (const p of everything) if (!allTime || isBetter(p.best, allTime.best, mode)) allTime = p;

  const last = everything.length ? everything[everything.length - 1] : null;
  const prev = everything.length > 1 ? everything[everything.length - 2] : null;
  const first = everything.length ? everything[0] : null;

  const rangeSets = filterSets(all, { exerciseId, intensity: filter.intensity, range: filter.range });
  const rangeWeights = rangeSets.map((s) => s.weight as number);
  let rangeBest: number | null = null;
  for (const w of rangeWeights) if (rangeBest == null || isBetter(w, rangeBest, mode)) rangeBest = w;
  void inRange;

  const bestByIntensity = {} as Record<Intensity, number | null>;
  for (const i of ['high', 'mid', 'low', 'none'] as Intensity[]) {
    let b: number | null = null;
    for (const s of filterSets(all, { exerciseId, intensity: i })) {
      const w = s.weight as number;
      if (b == null || isBetter(w, b, mode)) b = w;
    }
    bestByIntensity[i] = b;
  }

  return {
    currentBest: last,
    allTimeBest: allTime,
    vsPrevious: last && prev ? change(last.best, prev.best) : null,
    vsFirst: last && first && everything.length > 1 ? change(last.best, first.best) : null,
    rangeBest,
    rangeAvg: rangeWeights.length ? round2(rangeWeights.reduce((a, b) => a + b, 0) / rangeWeights.length) : null,
    bestByIntensity,
    sessionCount: everything.length,
  };
}

/** 동일 반복 횟수에서의 중량 변화: 날짜별로 해당 reps 이상을 수행한 최고 중량 */
export function sameRepsTrend(
  all: FlatSet[],
  exerciseId: string,
  reps: number,
  mode: WeightMode,
  intensity: IntensityFilter = 'all',
): { date: string; weight: number }[] {
  const byDate = new Map<string, number>();
  for (const s of filterSets(all, { exerciseId, intensity })) {
    if (s.reps == null || s.reps < reps) continue;
    const w = s.weight as number;
    const cur = byDate.get(s.date);
    if (cur == null || isBetter(w, cur, mode)) byDate.set(s.date, w);
  }
  return [...byDate.entries()].map(([date, weight]) => ({ date, weight })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * 평소 운동에서 횟수별로 보기 위한 선택지: 이 종목에서 실제로 한 횟수 중 많이 한 순으로 최대 limit개(작은 횟수부터 표시).
 * mostUsed는 가장 많이 한 횟수(기본 선택값).
 */
export function repChoices(all: FlatSet[], exerciseId: string, limit = 6): { options: number[]; mostUsed: number | null } {
  const count = new Map<number, number>();
  for (const s of filterSets(all, { exerciseId })) {
    if (s.reps == null || s.reps < 1) continue;
    count.set(s.reps, (count.get(s.reps) ?? 0) + 1);
  }
  const byUse = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return { options: byUse.slice(0, limit).map(([r]) => r).sort((a, b) => a - b), mostUsed: byUse.length ? byUse[0][0] : null };
}

/** 추정 1RM (Epley). 실측 1RM이 아니며 12회 초과·보조/체중 운동에는 제공하지 않음. */
export function estimate1RM(weight: number | null, reps: number | null, mode: WeightMode = 'weighted'): number | null {
  if (mode !== 'weighted' || weight == null || reps == null || weight <= 0 || reps < 1 || reps > 12) return null;
  if (reps === 1) return weight;
  return round2(weight * (1 + reps / 30));
}
export const EST_1RM_NOTE =
  '추정 1RM은 Epley 공식(중량 × (1 + 반복수/30))으로 계산한 값이며 실제 측정한 1RM과 다릅니다. 12회 초과, 체중·보조 운동은 계산하지 않습니다.';

/* ---------- 기간 ---------- */

export function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseDate(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toDateStr(d);
}

export function rangeFor(key: RangeKey, today: string, custom?: DateRange): DateRange {
  switch (key) {
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case '3m': return { from: addMonths(today, -3), to: today };
    case '6m': return { from: addMonths(today, -6), to: today };
    case '1y': return { from: addMonths(today, -12), to: today };
    case 'custom': return { from: custom?.from ?? null, to: custom?.to ?? null };
    default: return { from: null, to: null };
  }
}

/** 요일 인덱스: 0=일 … 6=토 */
export function weekdayOf(s: string): number {
  return parseDate(s).getUTCDay();
}

/** 월요일 시작 주의 시작일 */
export function weekStart(s: string): string {
  const wd = weekdayOf(s);
  return addDays(s, -((wd + 6) % 7));
}
