import { DatabaseSync } from 'node:sqlite';
import type { Db, SqlParam } from '../src/db/adapter.ts';

/** 테스트 전용: node:sqlite로 실제 SQLite 엔진에서 앱과 동일한 저장소 코드를 실행 */
export function openTestDb(): Db {
  const raw = new DatabaseSync(':memory:');
  let depth = 0;
  const db: Db = {
    exec: async (sql) => { raw.exec(sql); },
    run: async (sql, params: SqlParam[] = []) => {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    all: async (sql, params: SqlParam[] = []) => raw.prepare(sql).all(...params) as any[],
    first: async (sql, params: SqlParam[] = []) => (raw.prepare(sql).get(...params) as any) ?? null,
    transaction: async (fn) => {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
      try {
        const r = await fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return db;
}
