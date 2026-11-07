import * as SQLite from 'expo-sqlite';
import type { Db, SqlParam } from './adapter.ts';
import { DDL } from './schema.ts';
import { seedDefaults } from './seed.ts';

const DB_NAME = 'overdrive.db';

/** 앱 내부 저장소(documentDirectory/SQLite)에 저장되므로 브라우저 데이터 삭제와 무관 */
export async function openAppDb(): Promise<Db> {
  // 파일을 여는 순간 폰 쪽 SQLite가 일시적으로 실패하는 경우(NullPointerException 등)가 있어 잠깐 쉬고 다시 시도한다
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await openOnce();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last;
}

async function openOnce(): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(DB_NAME);
  try {
    await raw.execAsync('PRAGMA journal_mode = WAL;');
  } catch {
    // 속도를 위한 설정일 뿐이라 실패해도 기록에는 문제가 없다 — 그대로 진행
  }
  try {
    return await initDb(raw);
  } catch (e) {
    try { await raw.closeAsync(); } catch { /* 이미 닫힘 */ }
    throw e;
  }
}

async function initDb(raw: SQLite.SQLiteDatabase): Promise<Db> {
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
