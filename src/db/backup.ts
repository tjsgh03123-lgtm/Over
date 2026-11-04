import { nowIso, type Db, type SqlParam } from './adapter.ts';
import { SCHEMA_VERSION, TABLE_COLUMNS, TABLE_ORDER } from './schema.ts';

export interface BackupFile {
  app: 'overdrive';
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, SqlParam>[]>;
}

export async function exportBackup(db: Db): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const t of TABLE_ORDER) {
    tables[t] = await db.all<Record<string, SqlParam>>(`SELECT ${TABLE_COLUMNS[t].join(', ')} FROM ${t}`);
  }
  return { app: 'overdrive', schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), tables };
}

export function validateBackup(data: unknown): asserts data is BackupFile {
  const d = data as Partial<BackupFile> | null;
  if (!d || d.app !== 'overdrive') throw new Error('OVERDRIVE 백업 파일이 아닙니다');
  if (typeof d.schemaVersion !== 'number' || d.schemaVersion > SCHEMA_VERSION) {
    throw new Error('이 앱보다 새로운 버전에서 만든 백업입니다. 앱을 업데이트해 주세요');
  }
  if (!d.tables || typeof d.tables !== 'object') throw new Error('백업에 tables가 없습니다');
  for (const t of TABLE_ORDER) {
    if (!Array.isArray(d.tables[t])) throw new Error(`백업에 ${t} 테이블이 없습니다`);
  }
}

/** 전체 복원: 검증 후 하나의 트랜잭션에서 교체. 실패하면 기존 데이터는 그대로 유지(롤백). */
export async function restoreBackup(db: Db, data: unknown): Promise<{ rows: number }> {
  validateBackup(data);
  const backup = data as BackupFile;
  let rows = 0;
  await db.transaction(async () => {
    for (const t of [...TABLE_ORDER].reverse()) await db.run(`DELETE FROM ${t}`);
    for (const t of TABLE_ORDER) {
      const cols = TABLE_COLUMNS[t];
      const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      for (const row of backup.tables[t]) {
        await db.run(sql, cols.map((c) => (row[c] === undefined ? null : row[c])));
        rows++;
      }
    }
  });
  return { rows };
}

/* ------------------------------ CSV ------------------------------ */

export function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM: 엑셀에서 한글이 깨지지 않도록
  return '﻿' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

const INT_KO: Record<string, string> = { high: '고중량', mid: '중간중량', low: '저중량', none: '미지정' };

export async function exportWorkoutCsv(db: Db): Promise<string> {
  const rows = await db.all<any>(
    `SELECT s.date, s.title, se.exercise_name, st.set_no, st.set_type, st.weight, st.reps, st.done,
            COALESCE(NULLIF(st.intensity,'none'), NULLIF(se.intensity,'none'), NULLIF(s.intensity,'none'), 'none') AS intensity,
            s.status, s.duration_sec, s.note
       FROM workout_sets st
       JOIN workout_session_exercises se ON se.id = st.session_exercise_id
       JOIN workout_sessions s ON s.id = se.session_id
      ORDER BY s.date, s.started_at, se.position, st.set_no`);
  return toCsv(
    ['날짜', '운동', '종목', '세트', '세트유형', '중량(kg)', '횟수', '완료', '강도', '상태', '운동시간(초)', '메모'],
    rows.map((r) => [r.date, r.title, r.exercise_name, r.set_no, r.set_type === 'warmup' ? '준비' : '본', r.weight, r.reps,
      r.done ? 'Y' : 'N', INT_KO[r.intensity] ?? r.intensity, r.status === 'done' ? '완료' : '진행중', r.duration_sec, r.note]),
  );
}

export async function exportBodyCsv(db: Db): Promise<string> {
  const rows = await db.all<any>('SELECT date, weight, skeletal_muscle, body_fat_mass, body_fat_pct, source FROM body_measurements ORDER BY date');
  return toCsv(['날짜', '몸무게(kg)', '골격근량(kg)', '체지방량(kg)', '체지방률(%)', '입력방식'],
    rows.map((r) => [r.date, r.weight, r.skeletal_muscle, r.body_fat_mass, r.body_fat_pct, r.source]));
}
