import { cycleIndex } from './cycle.ts';
import { weekdayOf } from './stats.ts';

/**
 * 루틴 = 사이클 한 개 전체. 루틴 안에 '날'(1일차, 2일차 …)이 있고, 날마다 이름·종류·종목을 가진다.
 * 요일·시작일은 루틴의 세부 설정이다.
 *  - cycle:   날을 순서대로 N일마다 반복 (시작일 기준)
 *  - weekday: 날마다 요일을 지정 (지정한 요일에만 운동, 나머지는 휴식)
 */
export type DayKind = 'weights' | 'cardio' | 'rest';
export type RoutineMode = 'cycle' | 'weekday';

export interface RoutineDay {
  id: string;
  name: string;
  kind: DayKind;
  /** weights일 때 날의 종목이 들어 있는 workout_templates id */
  templateId: string | null;
  /** weekday 모드에서만 사용 (0=일 … 6=토) */
  weekday: number | null;
}
export interface Routine {
  id: string;
  name: string;
  mode: RoutineMode;
  /** cycle 모드의 1일차 날짜 */
  startDate: string;
  days: RoutineDay[];
}
export interface RoutinesState {
  activeId: string | null;
  routines: Routine[];
}

export const MAX_DAYS = 28;
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
      routines.push({
        id: x.id,
        name: typeof x.name === 'string' && x.name.trim() ? x.name : '루틴',
        mode: x.mode === 'weekday' ? 'weekday' : 'cycle',
        startDate: typeof x.startDate === 'string' && DATE.test(x.startDate) ? x.startDate : today,
        days,
      });
    }
  }
  const activeId = typeof o.activeId === 'string' && routines.some((r) => r.id === o.activeId) ? o.activeId : null;
  return { activeId, routines };
}

export interface DayLookup {
  day: RoutineDay | null;
  /** cycle 모드: 몇 일차 / 전체 일수 */
  cycleDay?: number;
  cycleLength?: number;
}

/** 그 날짜에 해당하는 루틴의 '날'. cycle: 순환, weekday: 요일이 같은 첫 번째 날(없으면 null=휴식) */
export function dayForDate(routine: Routine, date: string): DayLookup {
  if (!routine.days.length) return { day: null };
  if (routine.mode === 'cycle') {
    const idx = cycleIndex(routine.startDate, date, routine.days.length);
    return { day: routine.days[idx], cycleDay: idx + 1, cycleLength: routine.days.length };
  }
  const wd = weekdayOf(date);
  return { day: routine.days.find((d) => d.weekday === wd) ?? null };
}

/** 오늘이 사이클의 몇 일차인지 (1부터). 날이 없으면 1 */
export function cycleDayNumber(routine: Routine, date: string): number {
  return routine.days.length ? cycleIndex(routine.startDate, date, routine.days.length) + 1 : 1;
}

/** 파싱된 날 목록에서 방식 추정: 휴식이 아닌 날이 모두 요일을 갖고 있으면 weekday, 아니면 cycle */
export function inferMode(days: { weekday: number | null; isRest: boolean }[]): RoutineMode {
  const work = days.filter((d) => !d.isRest);
  return work.length > 0 && work.every((d) => d.weekday != null) ? 'weekday' : 'cycle';
}
