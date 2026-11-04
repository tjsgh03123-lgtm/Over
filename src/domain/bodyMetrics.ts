import { GRAPH_PRESETS } from './themeModel.ts';

/** 신체 기록 항목. 기본 4개(인바디) + 사용자가 이름·단위를 정해 추가하는 항목(숫자만). */
export type BuiltinKey = 'weight' | 'skeletal_muscle' | 'body_fat_mass' | 'body_fat_pct';

export interface BodyMetric {
  key: string; // 기본 항목은 DB 컬럼명, 직접 만든 항목은 x1, x2 …
  label: string;
  unit: string;
  builtin: boolean;
  hidden: boolean; // 입력칸·그래프에서 숨김 (기록은 그대로 남는다)
  color: string | null; // 직접 만든 항목의 그래프 색 (기본 항목은 테마의 그래프 색을 사용)
}

export const BUILTIN_METRICS: BodyMetric[] = [
  { key: 'weight', label: '몸무게', unit: 'kg', builtin: true, hidden: false, color: null },
  { key: 'skeletal_muscle', label: '골격근량', unit: 'kg', builtin: true, hidden: false, color: null },
  { key: 'body_fat_mass', label: '체지방량', unit: 'kg', builtin: true, hidden: false, color: null },
  { key: 'body_fat_pct', label: '체지방률', unit: '%', builtin: true, hidden: false, color: null },
];

export const MAX_CUSTOM_METRICS = 12;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** 저장된 JSON(문자열/객체)을 검증해 항상 완전한 목록(기본 4개 + 유효한 직접 항목)으로 돌려준다 */
export function sanitizeMetrics(raw: unknown): BodyMetric[] {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const arr: unknown[] = Array.isArray(obj) ? obj : [];
  const saved = new Map<string, Record<string, unknown>>();
  for (const x of arr) {
    if (x && typeof x === 'object' && typeof (x as any).key === 'string') saved.set((x as any).key, x as Record<string, unknown>);
  }
  const out: BodyMetric[] = BUILTIN_METRICS.map((b) => ({ ...b, hidden: saved.get(b.key)?.hidden === true }));
  for (const [key, v] of saved) {
    if (!/^x\d+$/.test(key)) continue;
    const label = typeof v.label === 'string' ? v.label.trim() : '';
    if (!label || out.length - BUILTIN_METRICS.length >= MAX_CUSTOM_METRICS) continue;
    out.push({
      key, label: label.slice(0, 20), unit: typeof v.unit === 'string' ? v.unit.trim().slice(0, 8) : '',
      builtin: false, hidden: v.hidden === true,
      color: typeof v.color === 'string' && HEX.test(v.color) ? v.color.toUpperCase() : null,
    });
  }
  return out;
}

export function visibleMetrics(list: BodyMetric[]): BodyMetric[] {
  return list.filter((m) => !m.hidden);
}

function nextKey(list: BodyMetric[]): string {
  let n = 1;
  while (list.some((m) => m.key === `x${n}`)) n++;
  return `x${n}`;
}

/** 직접 만든 항목 추가. 이름이 비었거나 겹치거나 너무 많으면 에러 */
export function addCustomMetric(list: BodyMetric[], v: { label: string; unit: string }): { list: BodyMetric[]; metric: BodyMetric } {
  const label = v.label.trim();
  if (!label) throw new Error('항목 이름을 입력하세요');
  if (list.some((m) => m.label === label)) throw new Error('같은 이름의 항목이 이미 있습니다');
  if (list.filter((m) => !m.builtin).length >= MAX_CUSTOM_METRICS) throw new Error(`직접 만든 항목은 ${MAX_CUSTOM_METRICS}개까지입니다`);
  const customCount = list.filter((m) => !m.builtin).length;
  const metric: BodyMetric = {
    key: nextKey(list), label: label.slice(0, 20), unit: v.unit.trim().slice(0, 8), builtin: false, hidden: false,
    color: GRAPH_PRESETS[(customCount + 4) % GRAPH_PRESETS.length].hex,
  };
  return { list: [...list, metric], metric };
}

/** 직접 만든 항목의 값: 항목 키 → 날짜 → 숫자 */
export type ExtraValues = Record<string, Record<string, number>>;

export function sanitizeExtra(raw: unknown): ExtraValues {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const out: ExtraValues = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, byDate] of Object.entries(obj as Record<string, unknown>)) {
    if (!/^x\d+$/.test(k) || !byDate || typeof byDate !== 'object') continue;
    for (const [d, v] of Object.entries(byDate as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof v === 'number' && Number.isFinite(v)) (out[k] ??= {})[d] = v;
    }
  }
  return out;
}
