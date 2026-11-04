import * as SQLite from 'expo-sqlite';
import type { Db, SqlParam } from './adapter.ts';
import { DDL } from './schema.ts';
import { seedDefaults } from './seed.ts';

const DB_NAME = 'overdrive.db';

/** 앱 내부 저장소(documentDirectory/SQLite)에 저장되므로 브라우저 데이터 삭제와 무관 */
export async function openAppDb(): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(DB_NAME);
  await raw.execAsync('PRAGMA journal_mode = WAL;');
  // SQLite는 트랜잭션 중첩을 허용하지 않으므로, 이미 트랜잭션 안이면 바깥 트랜잭션에 합류시킨다
  let depth = 0;
  const db: Db = {
    exec: (sql) => raw.execAsync(sql),
    run: async (sql, params: SqlParam[] = []) => {
      const r = await raw.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: (sql, params: SqlParam[] = []) => raw.getAllAsync(sql, params) as Promise<any[]>,
    first: async (sql, params: SqlParam[] = []) => ((await raw.getFirstAsync(sql, params)) as any) ?? null,
    transaction: async (fn) => {
      if (depth > 0) return fn();
      let result!: Awaited<ReturnType<typeof fn>>;
      depth++;
      try {
        await raw.withTransactionAsync(async () => {
          result = await fn();
        });
      } finally {
        depth--;
      }
      return result;
    },
  };
  await db.exec(DDL);
  await seedDefaults(db);
  return db;
}
