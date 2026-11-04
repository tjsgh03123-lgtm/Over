/** DB 추상화: expo-sqlite(앱)와 node:sqlite(테스트) 양쪽에서 같은 저장소 코드를 사용 */
export type SqlParam = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 기기 로컬 시간 기준 YYYY-MM-DD */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
