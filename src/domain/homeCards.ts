import { daysBetween } from './cycle.ts';
import { partOf } from './exerciseCatalog.ts';
import { addDays, weekStart } from './stats.ts';

/** 루틴(날) 안의 종목들로 부위별 세트 수를 센다 (많은 순, 같으면 이름순) */
export function partSummary(rows: { name: string; category?: string | null; target_sets: number }[]): { part: string; sets: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(partOf(r.name, r.category), (m.get(partOf(r.name, r.category)) ?? 0) + r.target_sets);
  return [...m.entries()].map(([part, sets]) => ({ part, sets })).sort((a, b) => b.sets - a.sets || a.part.localeCompare(b.part, 'ko'));
}

/** 마지막으로 한 날을 '오늘 / 어제 / N일 전 / 아직 안 함'으로 */
export function fmtDaysAgo(lastDate: string | null, today: string): string {
  if (!lastDate) return '아직 안 함';
  const d = daysBetween(lastDate, today);
  if (d <= 0) return '오늘';
  if (d === 1) return '어제';
  return `${d}일 전`;
}

/** 이번 주 월~일 날짜 7개 */
export function weekDays(today: string): string[] {
  const s = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** 설정에 저장하는 '오늘 다른 날로 하기' 값: '날짜|루틴id' — 오늘 날짜일 때만 유효 */
export function encodeOverride(today: string, templateId: string | null): string {
  return templateId ? `${today}|${templateId}` : '';
}
export function decodeOverride(v: string | null | undefined, today: string): string | null {
  if (!v) return null;
  const i = v.indexOf('|');
  return i > 0 && v.slice(0, i) === today ? v.slice(i + 1) || null : null;
}

/** 보관한 루틴 id 목록(JSON)을 안전하게 읽기 */
export function parseIds(v: string | null | undefined): string[] {
  try {
    const a = JSON.parse(v ?? '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
