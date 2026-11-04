import assert from 'node:assert/strict';
import { openTestDb } from './nodeAdapter.ts';
import { DDL, TABLE_ORDER } from '../src/db/schema.ts';
import { seedDefaults } from '../src/db/seed.ts';
import * as repo from '../src/db/repo.ts';
import { exportBackup, exportBodyCsv, exportWorkoutCsv, restoreBackup } from '../src/db/backup.ts';
import { dailyPoints, filterSets, seriesByIntensity } from '../src/domain/stats.ts';
import { flattenSessions } from '../src/domain/intensity.ts';
import { parseRoutine } from '../src/domain/parser.ts';
import type { Db } from '../src/db/adapter.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

async function freshDb(): Promise<Db> {
  const db = openTestDb();
  await db.exec(DDL);
  await seedDefaults(db);
  return db;
}

/** 세션 하나를 기록하고 완료 처리 (테스트용 가상 데이터) */
async function logSession(
  db: Db, date: string, exId: string,
  sets: { w: number | null; r: number | null; done?: boolean; type?: 'warmup' | 'working'; i?: any }[],
  opts: { sessionI?: any; exI?: any; free?: boolean } = {},
) {
  const sid = opts.free ? await repo.startFreeSession(db, date) : await repo.startFreeSession(db, date);
  if (opts.sessionI) await repo.setSessionIntensity(db, sid, opts.sessionI);
  const seId = await repo.addSessionExercise(db, sid, exId, 0);
  if (opts.exI) await repo.setExerciseIntensity(db, seId, opts.exI);
  for (const s of sets) {
    await repo.addSet(db, seId, s.type ?? 'working');
    const full = await repo.loadSession(db, sid);
    const row = full!.exercises.find((e) => e.id === seId)!.sets.at(-1)!;
    await repo.updateSet(db, row.id, { weight: s.w, reps: s.r, done: s.done ?? true, intensity: s.i ?? null });
  }
  await repo.finishSession(db, sid);
  return { sid, seId };
}

console.log('스키마 / 시드');
await test('12개 테이블 생성', async () => {
  const db = await freshDb();
  const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const names = rows.map((r) => r.name).sort();
  assert.deepEqual(names, [...TABLE_ORDER].sort());
  assert.equal(TABLE_ORDER.length, 12);
});
await test('기본 루틴: 월 10종목, 수·금·일 8종목, 요일 규칙 7개, 기본 3세트, 금요일 고중량', async () => {
  const db = await freshDb();
  const tpls = await repo.listTemplates(db);
  assert.equal(tpls.length, 4);
  const count = async (needle: string) => {
    const t = tpls.find((x) => x.name.includes(needle))!;
    const ex = await repo.getTemplateExercises(db, t.id);
    assert.ok(ex.every((e) => e.target_sets === 3));
    return { t, n: ex.length };
  };
  assert.equal((await count('월요일')).n, 10);
  assert.equal((await count('수요일')).n, 8);
  const fri = await count('금요일');
  assert.equal(fri.n, 8);
  assert.equal(fri.t.default_intensity, 'high');
  assert.equal((await count('일요일')).n, 8);
  const rules = await repo.getSchedule(db);
  assert.equal(rules.length, 7);
  assert.equal(rules.find((r) => r.weekday === 2)!.kind, 'rest');
  assert.equal(rules.find((r) => r.weekday === 4)!.kind, 'cardio');
  assert.equal(rules.find((r) => r.weekday === 6)!.kind, 'cardio');
});
await test('시드는 한 번만 실행(재실행해도 중복 없음), 같은 종목은 하나로 공유', async () => {
  const db = await freshDb();
  assert.equal(await seedDefaults(db), false);
  const bench = (await repo.listExercises(db)).filter((e) => e.name === '벤치프레스');
  assert.equal(bench.length, 1);
});
await test('기본 시드에는 기록(그래프 예시 숫자)이 저장되지 않음', async () => {
  const db = await freshDb();
  assert.equal((await repo.loadFlatSets(db)).length, 0);
  assert.equal((await repo.listMeasurements(db)).length, 0);
});

console.log('1·2 기록 저장 → 그래프 자동 반영');
await test('루틴으로 시작 → 입력 즉시 저장 → 완료 후 통계 반영, 앱 재시작 후 진행중 세션 복원', async () => {
  const db = await freshDb();
  const fri = (await repo.listTemplates(db)).find((t) => t.name.includes('금요일'))!;
  const sid = await repo.startSessionFromTemplate(db, fri.id, '2026-11-06');
  let s = (await repo.loadSession(db, sid))!;
  assert.equal(s.exercises.length, 8);
  assert.equal(s.intensity, 'high');
  const bench = s.exercises.find((e) => e.exercise_name === '벤치프레스')!;
  assert.equal(bench.sets.length, 3);
  await repo.updateSet(db, bench.sets[0].id, { weight: 100, reps: 5, done: true });
  // 앱 종료 시뮬레이션: 같은 DB에서 활성 세션 복원
  const active = await repo.getActiveSession(db);
  assert.equal(active?.id, sid);
  s = (await repo.loadSession(db, sid))!;
  assert.equal(s.exercises.find((e) => e.exercise_name === '벤치프레스')!.sets[0].weight, 100);
  // 완료 전에는 통계에 포함되지 않음
  assert.equal((await repo.loadFlatSets(db)).length, 0);
  await repo.finishSession(db, sid);
  const flat = await repo.loadFlatSets(db);
  assert.equal(flat.length, 24);
  const benchPts = dailyPoints(filterSets(flat, { exerciseId: bench.exercise_id }));
  assert.equal(benchPts.length, 1);
  assert.equal(benchPts[0].best, 100);
  assert.equal(benchPts[0].bestIntensity, 'high'); // 금요일 운동일 강도 상속
});
await test('SQL 상속 결과 == 도메인 flatten 결과 (세트→종목→운동일)', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-01', ex.id, [{ w: 100, r: 5 }, { w: 60, r: 10, i: 'low' }], { sessionI: 'high' });
  await logSession(db, '2026-11-03', ex.id, [{ w: 80, r: 8 }, { w: 85, r: 6, i: 'high' }], { sessionI: 'low', exI: 'mid' });
  const sql = await repo.loadFlatSets(db, ex.id);
  const sessions = [];
  for (const m of ['2026-11-01', '2026-11-03']) {
    const [meta] = await repo.sessionsOnDate(db, m);
    const full = (await repo.loadSession(db, meta.id))!;
    sessions.push({
      id: full.id, date: full.date, intensity: full.intensity,
      exercises: full.exercises.map((e) => ({
        id: e.id, exerciseId: e.exercise_id, exerciseName: e.exercise_name, weightMode: e.weight_mode, intensity: e.intensity,
        sets: e.sets.map((x) => ({ id: x.id, setNo: x.set_no, weight: x.weight, reps: x.reps, done: !!x.done, setType: x.set_type, intensity: x.intensity })),
      })),
    });
  }
  const dom = flattenSessions(sessions);
  assert.deepEqual(sql.map((s) => s.intensity), dom.map((s) => s.intensity));
  assert.deepEqual(sql.map((s) => s.intensity), ['high', 'low', 'mid', 'high']);
});

console.log('3~8 강도 필터 / 전체 / 비교 (실제 DB 기록 기준)');
await test('고/중/저/미지정/전체/강도별 비교', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-01', ex.id, [{ w: 100, r: 5 }], { sessionI: 'high' });
  await logSession(db, '2026-11-02', ex.id, [{ w: 80, r: 8 }], { sessionI: 'mid' });
  await logSession(db, '2026-11-03', ex.id, [{ w: 60, r: 12 }], { sessionI: 'low' });
  await logSession(db, '2026-11-04', ex.id, [{ w: 50, r: 12 }]);
  await logSession(db, '2026-11-08', ex.id, [{ w: 102.5, r: 5 }], { sessionI: 'high' });
  const flat = await repo.loadFlatSets(db, ex.id);
  const best = (i: any) => dailyPoints(filterSets(flat, { exerciseId: ex.id, intensity: i })).map((p) => p.best);
  assert.deepEqual(best('high'), [100, 102.5]);
  assert.deepEqual(best('mid'), [80]);
  assert.deepEqual(best('low'), [60]);
  assert.deepEqual(best('none'), [50]);
  assert.deepEqual(best('all'), [100, 80, 60, 50, 102.5]);
  const cmp = seriesByIntensity(flat, ex.id, 'weighted');
  assert.equal(cmp.high.length, 2);
  assert.equal(cmp.mid.length, 1);
  assert.equal(cmp.low.length, 1);
  // 필터는 DB 원본을 바꾸지 않음
  const again = await repo.loadFlatSets(db, ex.id);
  assert.deepEqual(again, flat);
});

console.log('9 기록 수정/삭제 후 갱신');
await test('세트 수정·삭제·세션 삭제가 그래프에 반영', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '데드리프트');
  const a = await logSession(db, '2026-11-01', ex.id, [{ w: 120, r: 5 }]);
  const b = await logSession(db, '2026-11-08', ex.id, [{ w: 130, r: 3 }]);
  const best = async () => dailyPoints(filterSets(await repo.loadFlatSets(db, ex.id), { exerciseId: ex.id })).map((p) => p.best);
  assert.deepEqual(await best(), [120, 130]);
  const full = (await repo.loadSession(db, b.sid))!;
  await repo.updateSet(db, full.exercises[0].sets[0].id, { weight: 140 });
  assert.deepEqual(await best(), [120, 140]);
  await repo.deleteSet(db, full.exercises[0].sets[0].id);
  assert.deepEqual(await best(), [120]);
  await repo.deleteSession(db, a.sid);
  assert.deepEqual(await best(), []);
  // 완료 기록 다시 열기 → 통계에서 일시 제외, 완료하면 복귀
  const c = await logSession(db, '2026-11-09', ex.id, [{ w: 125, r: 5 }]);
  await repo.reopenSession(db, c.sid);
  assert.deepEqual(await best(), []);
  await repo.finishSession(db, c.sid);
  assert.deepEqual(await best(), [125]);
});

console.log('10 자유 운동 통합 / 이름 변경 / 루틴 삭제');
await test('자유 운동과 루틴 운동의 같은 종목은 하나로 통합, 새 루틴으로 저장 가능', async () => {
  const db = await freshDb();
  const tpl = (await repo.listTemplates(db)).find((t) => t.name.includes('수요일'))!;
  const sid = await repo.startSessionFromTemplate(db, tpl.id, '2026-11-04');
  const full = (await repo.loadSession(db, sid))!;
  const bench = full.exercises.find((e) => e.exercise_name === '벤치프레스')!;
  await repo.updateSet(db, bench.sets[0].id, { weight: 90, reps: 8, done: true });
  await repo.finishSession(db, sid);
  // 자유 운동에서 '벤치프레스' 이름을 직접 입력 → 기존 종목에 매칭 (공백/대소문자 무시)
  const same = await repo.getOrCreateExercise(db, '  벤치 프레스 ');
  assert.equal(same.id, bench.exercise_id);
  const free = await logSession(db, '2026-11-05', same.id, [{ w: 92.5, r: 6 }], { free: true });
  const pts = dailyPoints(filterSets(await repo.loadFlatSets(db, same.id), { exerciseId: same.id }));
  assert.deepEqual(pts.map((p) => p.best), [90, 92.5]);
  // 자유 운동 → 새 루틴 저장
  const newTpl = await repo.saveSessionAsTemplate(db, free.sid, '내 벤치 루틴');
  const exs = await repo.getTemplateExercises(db, newTpl);
  assert.equal(exs.length, 1);
  assert.equal(exs[0].target_weight, 92.5);
});
await test('종목 이름을 바꿔도 과거 기록 유지, 루틴 삭제 후에도 완료 기록 유지', async () => {
  const db = await freshDb();
  const tpl = (await repo.listTemplates(db)).find((t) => t.name.includes('금요일'))!;
  const sid = await repo.startSessionFromTemplate(db, tpl.id, '2026-11-06');
  const full = (await repo.loadSession(db, sid))!;
  const sq = full.exercises.find((e) => e.exercise_name === '프론트 스쿼트')!;
  await repo.updateSet(db, sq.sets[0].id, { weight: 80, reps: 5, done: true });
  await repo.finishSession(db, sid);
  await repo.renameExercise(db, sq.exercise_id, '프런트 스쿼트');
  assert.equal((await repo.findExercise(db, '프론트 스쿼트'))?.id, sq.exercise_id); // 옛 이름은 별칭
  let flat = await repo.loadFlatSets(db, sq.exercise_id);
  assert.equal(flat.filter((s) => s.weight === 80).length, 1);
  assert.equal(flat[0].exerciseName, '프론트 스쿼트'); // 기록 시점 이름 보존
  await repo.deleteTemplate(db, tpl.id);
  flat = await repo.loadFlatSets(db, sq.exercise_id);
  assert.equal(flat.filter((s) => s.weight === 80).length, 1);
  assert.equal((await repo.loadSession(db, sid))!.template_id, null);
  // 기록이 있는 종목은 삭제 대신 보관
  assert.equal(await repo.deleteExercise(db, sq.exercise_id), 'archived');
  const unused = await repo.getOrCreateExercise(db, '미사용 종목');
  assert.equal(await repo.deleteExercise(db, unused.id), 'deleted');
});

console.log('11 기본 루틴 및 AI 가져오기');
await test('AI 텍스트 → 파싱 → 루틴/요일 규칙 저장 → 종목 중복 없이 재사용', async () => {
  const db = await freshDb();
  const parsed = parseRoutine('## 월요일 - 가슴\n1. 벤치프레스 4x8 @ 60kg\n2. 새로운 머신 프레스 3x12\n\n화요일: 휴식');
  const r = await repo.applyImportedRoutine(db, parsed.days, 'raw', parsed.format, { linkWeekdays: true });
  assert.equal(r.templates, 1);
  const rule = await repo.getRuleForWeekday(db, 1);
  const tplEx = await repo.getTemplateExercises(db, rule!.template_id!);
  assert.deepEqual(tplEx.map((e) => [e.name, e.target_sets, e.target_weight]), [['벤치프레스', 4, 60], ['새로운 머신 프레스', 3, null]]);
  assert.equal((await repo.listExercises(db)).filter((e) => e.name === '벤치프레스').length, 1);
  assert.equal((await repo.getRuleForWeekday(db, 2))!.kind, 'rest');
  assert.equal((await db.all('SELECT * FROM imported_routines')).length, 1);
});

console.log('12 신체 기록');
await test('누락 항목 NULL, 날짜별 1건, 부분 갱신, 임의 데이터 생성 없음', async () => {
  const db = await freshDb();
  await repo.upsertMeasurement(db, '2026-11-01', { weight: 78.5 });
  await repo.upsertMeasurement(db, '2026-11-08', { weight: 79, skeletal_muscle: 35.2, body_fat_pct: 15.1 });
  await repo.upsertMeasurement(db, '2026-11-08', { body_fat_mass: 11.9 });
  const m = await repo.listMeasurements(db);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].weight, m[0].skeletal_muscle, m[0].body_fat_mass, m[0].body_fat_pct], [78.5, null, null, null]);
  assert.deepEqual([m[1].weight, m[1].skeletal_muscle, m[1].body_fat_mass, m[1].body_fat_pct], [79, 35.2, 11.9, 15.1]);
});

console.log('캘린더 / 주간 통계');
await test('월 표시, 주간 통계(본 세트 볼륨, 유산소)', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-03', ex.id, [{ w: 100, r: 5 }, { w: 60, r: 10, type: 'warmup' }, { w: 90, r: 5, done: false }]);
  await repo.addCardio(db, { date: '2026-11-05', durationMin: 30 });
  const marks = await repo.monthMarks(db, '2026-11');
  assert.equal(marks['2026-11-03'].done, 1);
  assert.equal(marks['2026-11-05'].cardio, 1);
  const w = await repo.weekStats(db, '2026-11-05');
  assert.deepEqual([w.workouts, w.sets, w.volume, w.cardioMin], [1, 1, 500, 30]);
});

console.log('13 백업 / 복원 / CSV');
await test('JSON 백업 → 초기화 → 복원 후 모든 테이블 동일', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-01', ex.id, [{ w: 100, r: 5 }], { sessionI: 'high' });
  await repo.upsertMeasurement(db, '2026-11-01', { weight: 78.5, body_fat_pct: 15 });
  await repo.addCardio(db, { date: '2026-11-02', durationMin: 20, kind: 'post_weights', intensity: 'low' });
  const json = JSON.stringify(await exportBackup(db));

  const other = await freshDb();
  await repo.getOrCreateExercise(other, '복원 전 임시 데이터');
  const res = await restoreBackup(other, JSON.parse(json));
  assert.ok(res.rows > 0);
  const a = await exportBackup(db);
  const b = await exportBackup(other);
  assert.deepEqual(b.tables, a.tables);
  const flat = await repo.loadFlatSets(other, ex.id);
  assert.equal(flat[0].intensity, 'high');
  assert.equal((await repo.findExercise(other, '복원 전 임시 데이터')), null);
});
await test('잘못된 백업 파일은 거부하고 기존 데이터를 건드리지 않음', async () => {
  const db = await freshDb();
  const before = JSON.stringify((await exportBackup(db)).tables);
  await assert.rejects(() => restoreBackup(db, { app: 'other' }), /OVERDRIVE/);
  await assert.rejects(() => restoreBackup(db, { app: 'overdrive', schemaVersion: 99, tables: {} }), /새로운 버전/);
  await assert.rejects(() => restoreBackup(db, { app: 'overdrive', schemaVersion: 1, tables: {} }), /테이블/);
  assert.equal(JSON.stringify((await exportBackup(db)).tables), before);
});
await test('복원 중 오류가 나면 롤백되어 기존 데이터 유지', async () => {
  const db = await freshDb();
  const good = await exportBackup(db);
  const bad = JSON.parse(JSON.stringify(good));
  bad.tables.exercises.push({ ...bad.tables.exercises[0] }); // PK 중복 → INSERT 실패
  const before = JSON.stringify(good.tables);
  await assert.rejects(() => restoreBackup(db, bad));
  assert.equal(JSON.stringify((await exportBackup(db)).tables), before);
});
await test('CSV 내보내기: BOM, 따옴표/쉼표 이스케이프, 강도 한글', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '케이블, "푸시다운"');
  await logSession(db, '2026-11-01', ex.id, [{ w: 30, r: 12 }], { sessionI: 'mid' });
  await repo.upsertMeasurement(db, '2026-11-01', { weight: 78.5 });
  const csv = await exportWorkoutCsv(db);
  assert.ok(csv.startsWith('﻿날짜,'));
  assert.ok(csv.includes('"케이블, ""푸시다운"""'));
  assert.ok(csv.includes('중간중량'));
  const body = await exportBodyCsv(db);
  assert.ok(body.includes('2026-11-01,78.5,,,,manual'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
