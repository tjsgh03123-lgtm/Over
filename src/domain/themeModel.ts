export type ThemeMode = 'dark' | 'light';

/** 색을 쓰는 곳은 그래프뿐. 그래프 선마다 색을 고를 수 있다. */
export const GRAPH_KEYS = [
  'all', 'weight', 'skeletal_muscle', 'body_fat_mass', 'body_fat_pct',
] as const;
export type GraphKey = (typeof GRAPH_KEYS)[number];

export const GRAPH_LABEL: Record<GraphKey, string> = {
  all: '중량 그래프',
  weight: '몸무게',
  skeletal_muscle: '골격근량',
  body_fat_mass: '체지방량',
  body_fat_pct: '체지방률',
};

export const GRAPH_PRESETS: { name: string; hex: string }[] = [
  { name: '빨강', hex: '#E53935' },
  { name: '주황', hex: '#FB8C00' },
  { name: '노랑', hex: '#FDD835' },
  { name: '초록', hex: '#43A047' },
  { name: '청록', hex: '#00ACC1' },
  { name: '파랑', hex: '#1E88E5' },
  { name: '보라', hex: '#8E24AA' },
  { name: '분홍', hex: '#EC407A' },
];

export const DEFAULT_GRAPH_COLORS: Record<GraphKey, string> = {
  all: '#1E88E5',
  weight: '#1E88E5',
  skeletal_muscle: '#43A047',
  body_fat_mass: '#FB8C00',
  body_fat_pct: '#E53935',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** 저장된 JSON(문자열 또는 객체)을 검증해서 항상 완전한 색상 표로 돌려준다 */
export function sanitizeGraphColors(raw: unknown): Record<GraphKey, string> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const out = { ...DEFAULT_GRAPH_COLORS };
  if (obj && typeof obj === 'object') {
    for (const k of GRAPH_KEYS) {
      const v = (obj as Record<string, unknown>)[k];
      if (typeof v === 'string' && HEX.test(v)) out[k] = v.toUpperCase();
    }
  }
  return out;
}

export function sanitizeMode(raw: unknown): ThemeMode {
  return raw === 'light' ? 'light' : 'dark';
}
