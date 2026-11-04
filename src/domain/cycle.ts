import { addDays } from './stats.ts';

/** 루틴 일정: 요일별(weekday) 또는 N일 주기(cycle). 주기 모드에서는 시작일 기준으로 칸이 순환한다. */
export type SlotKind = 'weights' | 'cardio' | 'rest';
export type PlanMode = 'weekday' | 'cycle';

export interface PlanSlot {
  kind: SlotKind;
  templateId: string | null;
  label: string | null;
}
export interface CyclePlan {
  mode: PlanMode;
  /** 주기의 1일차 날짜 (YYYY-MM-DD) */
  startDate: string;
  slots: PlanSlot[];
}

export const MAX_CYCLE = 28;

function dayNum(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** b - a (일) */
export function daysBetween(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

/** date가 주기의 몇 번째 칸(0부터)인지. 시작일 이전 날짜도 순환 계산한다. */
export function cycleIndex(startDate: string, date: string, length: number): number {
  if (length <= 0) return 0;
  const diff = daysBetween(startDate, date);
  return ((diff % length) + length) % length;
}

const KINDS: SlotKind[] = ['weights', 'cardio', 'rest'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 저장된 JSON을 검증해서 항상 유효한 계획으로 돌려준다 */
export function sanitizePlan(raw: unknown, today: string): CyclePlan {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const o = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
  const mode: PlanMode = o.mode === 'cycle' ? 'cycle' : 'weekday';
  const startDate = typeof o.startDate === 'string' && DATE.test(o.startDate) ? o.startDate : today;
  const slots: PlanSlot[] = [];
  if (Array.isArray(o.slots)) {
    for (const s of o.slots.slice(0, MAX_CYCLE)) {
      const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const kind = KINDS.includes(r.kind as SlotKind) ? (r.kind as SlotKind) : 'rest';
      slots.push({
        kind,
        templateId: kind === 'weights' && typeof r.templateId === 'string' ? r.templateId : null,
        label: typeof r.label === 'string' ? r.label : null,
      });
    }
  }
  return { mode, startDate, slots };
}

/** 주기 길이를 바꾼다. 늘리면 휴식 칸이 추가되고, 줄이면 뒤쪽이 잘린다. */
export function resizeSlots(slots: PlanSlot[], length: number): PlanSlot[] {
  const n = Math.max(1, Math.min(MAX_CYCLE, Math.round(length)));
  const out = slots.slice(0, n);
  while (out.length < n) out.push({ kind: 'rest', templateId: null, label: null });
  return out;
}

/** '오늘이 N일차'가 되도록 시작일을 계산 (N은 1부터) */
export function startForDayNumber(today: string, dayNumber: number, length: number): string {
  const n = Math.max(1, Math.min(length, Math.round(dayNumber)));
  return addDays(today, -(n - 1));
}

/** 오늘이 주기의 몇 일차인지 (1부터) */
export function dayNumberOf(plan: CyclePlan, date: string): number {
  return plan.slots.length ? cycleIndex(plan.startDate, date, plan.slots.length) + 1 : 1;
}

/** 지난 루틴을 '루틴대로' 하기로 했을 때: 주기를 (오늘 - 놓친 날)일 뒤로 밀어 오늘이 그 칸이 되게 한다 */
export function shiftStartForMissed(plan: CyclePlan, missedDate: string, today: string): string {
  return addDays(plan.startDate, Math.max(0, daysBetween(missedDate, today)));
}
