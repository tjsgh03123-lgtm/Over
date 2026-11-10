import type { Db, SqlParam } from './adapter.ts';
import { DDL } from './schema.ts';
import { seedDefaults } from './seed.ts';
import { seedDemo } from './demoData.ts';

/**
 * 웹 미리보기 전용 저장소: 브라우저 메모리 안의 SQLite(sql.js). 새로고침하면 처음 상태(샘플 기록)로 돌아간다.
 * sql.js는 번들에 넣지 않고 미리보기 파일 옆의 sql-wasm.js / sql-wasm.wasm 을 불러온다.
 * 앱(안드로이드)에서는 쓰이지 않는다.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const d = (globalThis as any).document;
    const s = d.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('sql-wasm.js를 불러오지 못했습니다'));
    d.head.appendChild(s);
  });
}

export async function openWebDb(): Promise<Db> {
  const g = globalThis as any;
  if (!g.initSqlJs) await loadScript('sql-wasm.js');
  const SQL = await g.initSqlJs({ locateFile: (f: string) => f });
  const raw = new SQL.Database();
  raw.run('PRAGMA foreign_keys = ON;');
  let depth = 0;
  const norm = (p?: SqlParam[]) => (p ?? []).map((v) => (v === undefined ? null : v));
  const db: Db = {
    exec: async (sql) => { raw.exec(sql); },
    run: async (sql, params) => { raw.run(sql, norm(params)); return { changes: raw.getRowsModified() }; },
    all: async (sql, params) => {
      const st = raw.prepare(sql);
      try {
        st.bind(norm(params));
        const out: any[] = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
      } finally { st.free(); }
    },
    first: async (sql, params) => {
      const rows = await db.all(sql, params);
      return (rows[0] as any) ?? null;
    },
    transaction: async (fn) => {
      if (depth > 0) return fn();
      depth++;
      raw.run('BEGIN');
      try {
        const r = await fn();
        raw.run('COMMIT');
        return r;
      } catch (e) {
        try { raw.run('ROLLBACK'); } catch { /* 이미 끝남 */ }
        throw e;
      } finally { depth--; }
    },
  };
  await db.exec(DDL);
  await seedDefaults(db);
  await seedDemo(db);
  return db;
}
