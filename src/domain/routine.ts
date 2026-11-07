import { cycleIndex } from './cycle.ts';
import { weekdayOf } from './stats.ts';

/**
 * 루틴 = '날'(Day 1, Day 2 …)들과, 그 날을 놓는 '칸'(slots)의 배치.
 *  - cycle:   칸 N개(반복 일수 1~28)를 시작일부터 차례로 돌며 반복. 빈 칸 = 휴식
 *  - weekday: 칸 7개(요일마다 하나). 같은 날을 여러 요일에 놓을 수 있고 빈 칸 = 휴식
 * 칸에는 날의 id를 넣고(같은 날을 여러 칸에 놓아도 됨), 비어 있으면 null.
 * weekday 모드의 칸 번호는 요일(0=일 … 6=토)이다.
 */
export type DayKind = 'weights' | 'cardio' | 'rest';
export type RoutineMode = 'cycle' | 'weekday';

export interface RoutineDay {
  id: string;
  name: string;
  kind: DayKind;
  /** weights일 때 날의 종목이 들어 있는 workout_templates id */
  templateId: string | null;
  /** 예전 버전에서 넘어온 값(칸 배치로 옮기는 데만 쓴다) */
  weekday: number | null;
}
export interface Routine {
  id: string;
  name: string;
  mode: RoutineMode;
  /** cycle 모드의 1일차 날짜 */
  startDate: string;
  /** 만들어 둔 날들 */
  days: RoutineDay[];
  /** 칸 배치: 날 id 또는 null(휴식). cycle은 길이 = 반복 일수, weekday는 길이 7 */
  slots: (string | null)[];
}
export interface RoutinesState {
  activeId: string | null;
  routines: Routine[];
}

export const MAX_DAYS = 28;
export const MAX_REPEAT = 28;
export const DEFAULT_REPEAT = 7;
/** 요일 칸을 월요일부터 보여 주는 순서 (칸 번호 = 요일) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WD_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
export const EMPTY_ROUTINES: RoutinesState = { activeId: null, routines: [] };

const KINDS: DayKind[] = ['weights', 'cardio', 'rest'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 저장된 JSON을 검증해서 항상 유효한 상태로 돌려준다 (깨져도 앱이 죽지 않음) */
export function sanitizeRoutines(raw: unknown, today: string): RoutinesState {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const o = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
  const routines: Routine[] = [];
  if (Array.isArray(o.routines)) {
    for (const r of o.routines) {
      if (!r || typeof r !== 'object') continue;
      const x = r as Record<string, unknown>;
      if (typeof x.id !== 'string' || !x.id) continue;
      const days: RoutineDay[] = [];
      if (Array.isArray(x.days)) {
        for (const d of x.days.slice(0, MAX_DAYS)) {
          if (!d || typeof d !== 'object') continue;
          const y = d as Record<string, unknown>;
          if (typeof y.id !== 'string' || !y.id) continue;
          const kind = KINDS.includes(y.kind as DayKind) ? (y.kind as DayKind) : 'rest';
          const wd = typeof y.weekday === 'number' && Number.isInteger(y.weekday) && y.weekday >= 0 && y.weekday <= 6 ? y.weekday : null;
          days.push({
            id: y.id,
            name: typeof y.name === 'string' ? y.name : '',
            kind,
            templateId: kind === 'weights' && typeof y.templateId === 'string' ? y.templateId : null,
            weekday: wd,
          });
        }
      }
      const mode: RoutineMode = x.mode === 'weekday' ? 'weekday' : 'cycle';
      const ids = new Set(days.map((d) => d.id));
      const slots = fitSlots(
        mode,
        Array.isArray(x.slots) ? x.slots.map((v) => (typeof v === 'string' && ids.has(v) ? v : null)) : legacySlots(mode, days),
      );
      routines.push({
        id: x.id,
        name: typeof x.name === 'string' && x.name.trim() ? x.name : '루틴',
        mode,
        startDate: typeof x.startDate === 'string' && DATE.test(x.startDate) ? x.startDate : today,
        days,
        slots,
      });
    }
  }
  const activeId = typeof o.activeId === 'string' && routines.some((r) => r.id === o.activeId) ? o.activeId : null;
  return { activeId, routines };
}

/** 칸 개수를 방식에 맞춘다: weekday는 7칸, cycle은 1~28칸(비면 기본 7칸) */
export function fitSlots(mode: RoutineMode, slots: (string | null)[]): (string | null)[] {
  const n = mode === 'weekday' ? 7 : Math.max(1, Math.min(MAX_REPEAT, slots.length || DEFAULT_REPEAT));
  return Array.from({ length: n }, (_, i) => slots[i] ?? null);
}

/** 예전 저장 형식(칸 없음)에서 칸 배치를 만든다: cycle은 날 순서 그대로, weekday는 날의 요일 칸에 */
function legacySlots(mode: RoutineMode, days: RoutineDay[]): (string | null)[] {
  if (mode === 'cycle') return days.map((d) => d.id);
  const out: (string | null)[] = Array(7).fill(null);
  for (const d of days) if (d.weekday != null && out[d.weekday] == null) out[d.weekday] = d.id;
  return out;
}

export interface DayLookup {
  day: RoutineDay | null;
  /** cycle 모드: 몇 일차 / 반복 일수 */
  cycleDay?: number;
  cycleLength?: number;
}

/** 그 날짜의 칸에 놓인 '날'. 빈 칸(휴식)이면 day=null. 아무 칸에도 날이 없으면 일정 없음(day=null) */
export function dayForDate(routine: Routine, date: string): DayLookup {
  if (!routine.slots.some(Boolean)) return { day: null };
  const pick = (id: string | null) => (id ? routine.days.find((d) => d.id === id) ?? null : null);
  if (routine.mode === 'cycle') {
    const idx = cycleIndex(routine.startDate, date, routine.slots.length);
    return { day: pick(routine.slots[idx]), cycleDay: idx + 1, cycleLength: routine.slots.length };
  }
  return { day: pick(routine.slots[weekdayOf(date)] ?? null) };
}

/** 오늘이 반복의 몇 일차인지 (1부터) */
export function cycleDayNumber(routine: Routine, date: string): number {
  return routine.slots.length ? cycleIndex(routine.startDate, date, routine.slots.length) + 1 : 1;
}

/** 칸 번호의 이름: cycle은 'Day n', weekday는 요일 */
export function slotName(mode: RoutineMode, i: number): string {
  return mode === 'cycle' ? `Day ${i + 1}` : `${WD_LABEL[i]}`;
}

/** 칸을 화면에 보여 주는 순서 (weekday는 월요일부터) */
export function slotOrder(r: Pick<Routine, 'mode' | 'slots'>): number[] {
  return r.mode === 'weekday' ? WEEK_ORDER : r.slots.map((_, i) => i);
}

/** 어느 칸에도 놓이지 않은 날 */
export function unplacedDays(r: Routine): RoutineDay[] {
  return r.days.filter((d) => !r.slots.includes(d.id));
}

export function setSlotAt(r: Routine, index: number, dayId: string | null): (string | null)[] {
  if (index < 0 || index >= r.slots.length) return r.slots;
  return r.slots.map((s, i) => (i === index ? dayId : s));
}

/** 두 칸의 내용을 맞바꾼다 (칸을 옮길 때) */
export function swapSlots(r: Routine, a: number, b: number): (string | null)[] {
  if (a === b || a < 0 || b < 0 || a >= r.slots.length || b >= r.slots.length) return r.slots;
  const out = [...r.slots];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/** cycle의 반복 일수를 바꾼다 (늘리면 빈 칸이 뒤에 붙고, 줄이면 뒤쪽 칸이 사라진다) */
export function resizeCycle(r: Routine, n: number): (string | null)[] {
  if (r.mode !== 'cycle') return r.slots;
  return fitSlots('cycle', Array.from({ length: Math.max(1, Math.min(MAX_REPEAT, Math.round(n))) }, (_, i) => r.slots[i] ?? null));
}

/**
 * 날을 빈 칸 하나에 놓는다. weekday면 원하는 요일이 비어 있을 때 그곳에, 아니면 월요일부터 첫 빈 칸에.
 * 빈 칸이 없으면 그대로 둔다.
 */
export function placeDay(r: Routine, dayId: string, weekday?: number | null): (string | null)[] {
  if (r.slots.includes(dayId)) return r.slots;
  let idx = -1;
  if (r.mode === 'weekday' && weekday != null && r.slots[weekday] == null) idx = weekday;
  if (idx < 0) idx = slotOrder(r).find((i) => r.slots[i] == null) ?? -1;
  return idx < 0 ? r.slots : setSlotAt(r, idx, dayId);
}

/** 놓이지 않은 날을 만든 순서대로 빈 칸에 채운다 */
export function autoFillSlots(r: Routine): (string | null)[] {
  let cur: Routine = r;
  for (const d of unplacedDays(r)) cur = { ...cur, slots: placeDay(cur, d.id) };
  return cur.slots;
}

/**
 * 방식을 바꿀 때 칸을 옮긴다. cycle→weekday: Day 1~7이 월~일이 된다(8일차부터는 빠짐).
 * weekday→cycle: 월~일이 Day 1~7이 된다. lost는 빠지는 칸에 들어 있던 날의 수.
 */
export function convertMode(r: Routine, mode: RoutineMode): { slots: (string | null)[]; lost: number } {
  if (mode === r.mode) return { slots: r.slots, lost: 0 };
  if (mode === 'weekday') {
    const slots: (string | null)[] = Array(7).fill(null);
    WEEK_ORDER.forEach((wd, k) => { slots[wd] = r.slots[k] ?? null; });
    return { slots, lost: r.slots.slice(7).filter(Boolean).length };
  }
  return { slots: WEEK_ORDER.map((wd) => r.slots[wd] ?? null), lost: 0 };
}

/** 파싱된 날 목록에서 방식 추정: 휴식이 아닌 날이 모두 요일을 갖고 있으면 weekday, 아니면 cycle */
export function inferMode(days: { weekday: number | null; isRest: boolean }[]): RoutineMode {
  const work = days.filter((d) => !d.isRest);
  return work.length > 0 && work.every((d) => d.weekday != null) ? 'weekday' : 'cycle';
}
