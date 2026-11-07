import assert from 'node:assert/strict';
import { openTestDb } from './nodeAdapter.ts';
import { DDL, TABLE_ORDER } from '../src/db/schema.ts';
import { seedDefaults } from '../src/db/seed.ts';
import { seedLegacy } from './legacySeed.ts';
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
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split("\n").slice(0, 12).join('\n    ')}`);
  }
}

/** 예시 데이터가 들어 있는 DB(예전 버전이 만들던 기본 루틴 4개 + 요일 일정). 저장소 기능 테스트용 픽스처. */
async function freshDb(): Promise<Db> {
  const db = openTestDb();
  await db.exec(DDL);
  await seedLegacy(db);
  return db;
}
async function emptyDb(): Promise<Db> {
  const db = openTestDb();
  await db.exec(DDL);
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
await test('새로 설치하면 기본 루틴·종목이 하나도 없음 (직접 만들거나 AI에서 가져옴)', async () => {
  const db = await emptyDb();
  assert.equal(await seedDefaults(db), true);
  assert.equal((await repo.listTemplates(db)).length, 0);
  assert.equal((await repo.listExercises(db)).length, 0);
  assert.equal((await repo.getRoutines(db, '2026-11-05')).routines.length, 0);
  assert.equal(await repo.slotForDate(db, '2026-11-05'), null);
  assert.equal(await repo.getSetting(db, 'default_sets'), '3');
  assert.equal(await seedDefaults(db), false); // 한 번만 실행
});
await test('예전 버전에서 업데이트: 기본 루틴·요일 일정·미사용 기본 종목 삭제, 기록은 유지', async () => {
  const db = await freshDb(); // 예전 기본 루틴이 들어 있는 상태
  assert.equal((await repo.listTemplates(db)).length, 4);
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-01', bench.id, [{ w: 60, r: 8 }]); // 기록이 있는 기본 종목
  await repo.getOrCreateExercise(db, '내가 만든 종목'); // 사용자가 직접 만든 종목
  assert.equal(await seedDefaults(db), false); // 신규 설치가 아님
  assert.equal((await repo.listTemplates(db)).length, 0);
  assert.equal((await db.all('SELECT * FROM schedule_rules')).length, 0);
  assert.equal((await db.all('SELECT * FROM workout_template_exercises')).length, 0);
  assert.deepEqual((await repo.listExercises(db, true)).map((e) => e.name).sort(), ['내가 만든 종목', '벤치프레스'].sort());
  assert.equal((await repo.loadFlatSets(db, bench.id)).length, 1); // 완료한 기록·그래프 유지
  assert.equal((await repo.loadSession(db, (await repo.sessionsOnDate(db, '2026-11-01'))[0].id))!.template_id, null);
  assert.equal(await seedDefaults(db), false); // 두 번째 실행은 아무 일도 하지 않음
});
await test('픽스처 확인: 예시 루틴은 월 10종목, 수·금·일 8종목, 기본 3세트', async () => {
  const db = await freshDb();
  const tpls = await repo.listTemplates(db);
  const n = async (needle: string) => {
    const t = tpls.find((x) => x.name.includes(needle))!;
    const ex = await repo.getTemplateExercises(db, t.id);
    assert.ok(ex.every((e) => e.target_sets === 3));
    return ex.length;
  };
  assert.deepEqual([await n('월요일'), await n('수요일'), await n('금요일'), await n('일요일')], [10, 8, 8, 8]);
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
  assert.equal(s.intensity, null);
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
await test('AI 텍스트 → 파싱 → 루틴(사이클) 한 개로 저장 → 종목 중복 없이 재사용', async () => {
  const db = await freshDb();
  const parsed = parseRoutine('## 월요일 - 가슴\n1. 벤치프레스 4x8 @ 60kg\n2. 새로운 머신 프레스 3x12\n\n화요일: 휴식');
  const r = await repo.applyImportedRoutine(db, '2026-11-05', parsed.days, 'raw', parsed.format, { name: '내 AI 루틴', activate: true });
  assert.equal(r.days, 2);
  const st = await repo.getRoutines(db, '2026-11-05');
  assert.equal(st.routines.length, 1);
  assert.equal(st.activeId, r.routineId);
  const rt = st.routines[0];
  assert.equal(rt.name, '내 AI 루틴');
  assert.equal(rt.mode, 'weekday'); // 운동일에 모두 요일이 있으면 요일 지정 방식으로 추정
  assert.deepEqual(rt.days.map((d) => d.kind), ['weights', 'rest']);
  assert.deepEqual(rt.slots, [null, rt.days[0].id, null, null, null, null, null]); // 월요일 칸에만 (화 휴식은 빈 칸)
  const tplEx = await repo.getTemplateExercises(db, rt.days[0].templateId!);
  assert.deepEqual(tplEx.map((e) => [e.name, e.target_sets, e.target_weight]), [['벤치프레스', 4, 60], ['새로운 머신 프레스', 3, null]]);
  assert.equal((await repo.listExercises(db)).filter((e) => e.name === '벤치프레스').length, 1);
  assert.equal((await db.all('SELECT * FROM imported_routines')).length, 1);
});
await test('AI 새 JSON 형식(routine.days, type)을 그대로 읽어 사이클 루틴으로 저장', async () => {
  const db = await emptyDb();
  const json = JSON.stringify({ version: 2, routine: { name: '3분할', mode: 'cycle', days: [
    { name: '가슴·삼두', type: 'weights', exercises: [{ name: '벤치프레스', sets: 4, reps: '6-8' }] },
    { name: '유산소', type: 'cardio', exercises: [] },
    { name: '휴식', type: 'rest', exercises: [] },
  ] } });
  const parsed = parseRoutine(json);
  assert.equal(parsed.routineName, '3분할');
  assert.equal(parsed.mode, 'cycle');
  const r = await repo.applyImportedRoutine(db, '2026-11-05', parsed.days, json, parsed.format, { name: parsed.routineName!, mode: parsed.mode, activate: true });
  assert.equal(r.days, 3);
  const rt = (await repo.getRoutines(db, '2026-11-05')).routines[0];
  assert.deepEqual(rt.days.map((d) => d.kind), ['weights', 'cardio', 'rest']);
  assert.equal(rt.days[1].templateId, null);
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

console.log('루틴 일정 · 앱 시작 팝업 · 타이머 · 세트 입력');
/** 월요일이 오는 해 11월: 2026-11-02 = 월요일. 테스트용 루틴 헬퍼 */
async function weightDay(db: Db, routineId: string, name: string, exName: string, weekday: number | null = null) {
  const ex = await repo.getOrCreateExercise(db, exName);
  return repo.upsertDay(db, '2026-11-05', routineId, { name, kind: 'weights', weekday, exercises: [{ exerciseId: ex.id, targetSets: 3 }] });
}
await test('루틴 만들기: 첫 루틴은 자동으로 사용 중, 날 추가·순서 변경·삭제, 날의 종목은 날 안에 저장', async () => {
  const db = await emptyDb();
  const id = await repo.createRoutine(db, '2026-11-05', { name: '  3분할  ' });
  const id2 = await repo.createRoutine(db, '2026-11-05', { name: '두 번째' });
  let st = await repo.getRoutines(db, '2026-11-05');
  assert.equal(st.activeId, id);
  assert.deepEqual(st.routines.map((r) => r.name), ['3분할', '두 번째']);
  const d1 = await weightDay(db, id, '가슴', '벤치프레스');
  const d2 = await weightDay(db, id, '등', '렛풀다운');
  await repo.upsertDay(db, '2026-11-05', id, { name: '', kind: 'rest' });
  st = await repo.getRoutines(db, '2026-11-05');
  assert.deepEqual(st.routines[0].days.map((d) => d.name), ['가슴', '등', '휴식']);
  await repo.moveDay(db, '2026-11-05', id, d2, -1);
  assert.deepEqual((await repo.getRoutines(db, '2026-11-05')).routines[0].days.map((d) => d.name), ['등', '가슴', '휴식']);
  const detail = (await repo.getDayDetail(db, '2026-11-05', id, d1))!;
  assert.deepEqual(detail.exercises.map((e) => e.name), ['벤치프레스']);
  // 웨이트 → 휴식으로 바꾸면 종목이 지워짐
  await repo.upsertDay(db, '2026-11-05', id, { id: d1, name: '가슴', kind: 'rest' });
  assert.equal((await repo.getDayDetail(db, '2026-11-05', id, d1))!.exercises.length, 0);
  await repo.setActiveRoutine(db, '2026-11-05', id2);
  assert.equal((await repo.getRoutines(db, '2026-11-05')).activeId, id2);
  // 루틴 삭제: 날의 종목도 삭제, 사용 중이던 루틴이면 다른 루틴으로
  await repo.deleteRoutine(db, '2026-11-05', id2);
  assert.equal((await repo.getRoutines(db, '2026-11-05')).activeId, id);
  await repo.deleteRoutine(db, '2026-11-05', id);
  assert.equal((await repo.getRoutines(db, '2026-11-05')).activeId, null);
  assert.equal((await repo.listTemplates(db)).length, 0);
});
await test('요일 지정 방식: 지정한 요일에만 운동하고 나머지는 휴식, 삭제된 종목 연결은 없음 처리', async () => {
  const db = await emptyDb();
  const id = await repo.createRoutine(db, '2026-11-05', { name: '주 3회', mode: 'weekday' });
  await weightDay(db, id, '가슴', '벤치프레스', 1); // 월
  const fri = await weightDay(db, id, '하체', '스쿼트', 5); // 금
  const mon = (await repo.slotForDate(db, '2026-11-02'))!; // 2026-11-02 = 월
  assert.equal(mon.kind, 'weights');
  assert.equal(mon.label, '가슴');
  assert.equal(mon.cycleDay, undefined);
  assert.equal((await repo.slotForDate(db, '2026-11-03'))!.kind, 'rest'); // 화: 지정 없음 = 휴식
  assert.equal((await repo.slotForDate(db, '2026-11-06'))!.label, '하체'); // 금
  await repo.deleteDay(db, '2026-11-05', id, fri);
  assert.equal((await repo.slotForDate(db, '2026-11-06'))!.kind, 'rest');
  // 템플릿이 외부에서 지워져도(깨진 연결) 앱이 죽지 않고 연결 없음
  await db.run('DELETE FROM workout_templates');
  assert.equal((await repo.slotForDate(db, '2026-11-02'))!.template_id, null);
});
await test('N일 반복 방식: 시작일 기준으로 순환, 몇 일차인지, 사용 중인 루틴이 없으면 일정 없음', async () => {
  const db = await emptyDb();
  const id = await repo.createRoutine(db, '2026-11-01', { name: '3일 주기', mode: 'cycle', startDate: '2026-11-01' });
  assert.equal(await repo.slotForDate(db, '2026-11-01'), null); // 날이 없으면 일정 없음
  const a = await weightDay(db, id, 'A', '벤치프레스');
  const b = await weightDay(db, id, 'B', '렛풀다운');
  await repo.upsertDay(db, '2026-11-05', id, { name: '휴식', kind: 'rest' });
  await repo.setRepeatDays(db, '2026-11-05', id, 3); // 3일 반복
  const labels: (string | null)[] = [];
  for (let d = 1; d <= 6; d++) {
    const s = (await repo.slotForDate(db, `2026-11-0${d}`))!;
    labels.push(s.label);
    assert.equal(s.cycleDay, ((d - 1) % 3) + 1);
    assert.equal(s.cycleLength, 3);
    assert.equal(s.routineName, '3일 주기');
  }
  assert.deepEqual(labels, ['A', 'B', '휴식', 'A', 'B', '휴식']);
  assert.ok(a && b);
  await repo.setActiveRoutine(db, '2026-11-05', null);
  assert.equal(await repo.slotForDate(db, '2026-11-02'), null);
  // 루틴은 app_settings에 저장되어 백업·복원으로 함께 보존된다
  await repo.setActiveRoutine(db, '2026-11-05', id);
  const backup = await exportBackup(db);
  const db2 = await emptyDb();
  await restoreBackup(db2, backup);
  assert.equal((await repo.slotForDate(db2, '2026-11-02'))!.label, 'B');
});
await test('칸 배치: 같은 날을 여러 요일에, 반복 일수, 칸 옮기기·비우기, 방식 바꾸기, 날 삭제 시 칸 비움', async () => {
  const db = await emptyDb();
  const id = await repo.createRoutine(db, '2026-11-01', { name: '주 3회', mode: 'weekday' });
  const a = await weightDay(db, id, 'A', '벤치프레스', 1); // 월에 자동 배치
  await repo.setSlot(db, '2026-11-01', id, 3, a); // 수에도
  await repo.setSlot(db, '2026-11-01', id, 5, a); // 금에도
  assert.deepEqual([2, 4, 6].map((d) => `2026-11-0${d}`), ['2026-11-02', '2026-11-04', '2026-11-06']);
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-06']) assert.equal((await repo.slotForDate(db, d))!.label, 'A');
  assert.equal((await repo.slotForDate(db, '2026-11-03'))!.kind, 'rest');
  // 월 칸을 화로 옮기기
  await repo.swapRoutineSlots(db, '2026-11-01', id, 1, 2);
  assert.equal((await repo.slotForDate(db, '2026-11-02'))!.kind, 'rest');
  assert.equal((await repo.slotForDate(db, '2026-11-03'))!.label, 'A');
  // 요일 → N일 반복: 월~일이 Day 1~7
  assert.equal(await repo.setRoutineMode(db, '2026-11-01', id, 'cycle'), 0);
  let r = (await repo.getRoutines(db, '2026-11-01')).routines[0];
  assert.equal(r.mode, 'cycle');
  assert.deepEqual(r.slots, [null, a, a, null, a, null, null]);
  // 반복 일수 4일로 줄이면 5일차 이후 칸이 사라짐
  await repo.setRepeatDays(db, '2026-11-01', id, 4);
  r = (await repo.getRoutines(db, '2026-11-01')).routines[0];
  assert.deepEqual(r.slots, [null, a, a, null]);
  const s = (await repo.slotForDate(db, '2026-11-02'))!; // 시작일 11/01이 Day 1 → 11/02는 Day 2
  assert.deepEqual([s.label, s.cycleDay, s.cycleLength], ['A', 2, 4]);
  const rest = (await repo.slotForDate(db, '2026-11-04'))!; // Day 4 = 빈 칸 = 휴식, 며칠째인지는 표시
  assert.deepEqual([rest.kind, rest.cycleDay, rest.cycleLength], ['rest', 4, 4]);
  // 날을 지우면 그 날이 놓인 모든 칸이 비워짐
  await repo.deleteDay(db, '2026-11-01', id, a);
  r = (await repo.getRoutines(db, '2026-11-01')).routines[0];
  assert.deepEqual(r.slots, [null, null, null, null]);
  assert.equal(await repo.slotForDate(db, '2026-11-02'), null); // 놓인 날이 하나도 없으면 일정 없음
});
await test('방식 바꾸기: 8일째 이후 Day는 요일에서 빠지지만 날 자체는 남고, 다시 배치할 수 있음', async () => {
  const db = await emptyDb();
  const id = await repo.createRoutine(db, '2026-11-01', { name: '10일', mode: 'cycle', repeat: 10 });
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(await repo.upsertDay(db, '2026-11-01', id, { name: `D${i + 1}`, kind: 'rest' }));
  let r = (await repo.getRoutines(db, '2026-11-01')).routines[0];
  assert.deepEqual(r.slots, ids); // 새 날은 빈 칸에 차례로 자동 배치
  assert.equal(await repo.setRoutineMode(db, '2026-11-01', id, 'weekday'), 3);
  r = (await repo.getRoutines(db, '2026-11-01')).routines[0];
  assert.equal(r.slots.length, 7);
  assert.equal(r.days.length, 10);
  await repo.autoFillRoutine(db, '2026-11-01', id); // 빈 칸이 없으니 그대로
  assert.equal((await repo.getRoutines(db, '2026-11-01')).routines[0].slots.filter(Boolean).length, 7);
});
await test('가져온 루틴: 사이클은 반복 일수 = 날 수, 요일 방식은 각 요일 칸에(휴식은 빈 칸), 같은 요일 여러 개 지정 가능', async () => {
  const db = await emptyDb();
  const p1 = parseRoutine('## 월요일 - 가슴\n1. 벤치프레스 4x8\n\n화요일: 휴식\n\n## 금요일 - 등\n1. 렛풀다운 3x10');
  const r1 = await repo.applyImportedRoutine(db, '2026-11-05', p1.days, 'raw', p1.format, { name: '요일', mode: 'weekday' });
  const a = (await repo.getRoutines(db, '2026-11-05')).routines.find((x) => x.id === r1.routineId)!;
  assert.equal(a.slots.length, 7);
  assert.deepEqual(a.slots.map((s) => (s ? a.days.find((d) => d.id === s)!.name : null)), [null, '가슴', null, null, null, '등', null]);
  const p2 = parseRoutine('## 1일차 - 가슴\n1. 벤치프레스 4x8\n\n## 2일차 - 등\n1. 렛풀다운 3x10');
  const r2 = await repo.applyImportedRoutine(db, '2026-11-05', p2.days, 'raw', p2.format, { name: '사이클', mode: 'cycle' });
  const b = (await repo.getRoutines(db, '2026-11-05')).routines.find((x) => x.id === r2.routineId)!;
  assert.equal(b.slots.length, 2);
  assert.deepEqual(b.slots, b.days.map((d) => d.id));
});
await test('자유 운동을 루틴의 새 날로 저장 (루틴이 없으면 ‘내 루틴’ 생성)', async () => {
  const db = await emptyDb();
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  const { sid } = await logSession(db, '2026-11-05', ex.id, [{ w: 92.5, r: 6 }], { free: true });
  const r = await repo.saveSessionAsDay(db, '2026-11-05', sid, '내 벤치 날');
  const st = await repo.getRoutines(db, '2026-11-05');
  assert.equal(st.routines[0].name, '내 루틴');
  assert.equal(st.activeId, r.routineId);
  const d = (await repo.getDayDetail(db, '2026-11-05', r.routineId, r.dayId))!;
  assert.equal(d.exercises[0].target_weight, 92.5);
  // 이미 사용 중인 루틴이 있으면 거기에 추가
  const r2 = await repo.saveSessionAsDay(db, '2026-11-05', sid, '두 번째 날');
  assert.equal(r2.routineId, r.routineId);
  assert.equal((await repo.getRoutines(db, '2026-11-05')).routines[0].days.length, 2);
});
/** 월·수·금·일에 운동하는 요일 지정 루틴 (나머지 요일은 휴식) */
async function weekdayRoutine(db: Db) {
  const id = await repo.createRoutine(db, '2026-11-01', { name: '주 4회', mode: 'weekday' });
  await weightDay(db, id, '가슴', '벤치프레스', 1);
  await weightDay(db, id, '하체', '스쿼트', 3);
  await weightDay(db, id, '등', '렛풀다운', 5);
  await weightDay(db, id, '어깨', '숄더프레스', 0);
  return id;
}
await test('앱 시작 팝업: 처음에는 묻지 않고, 놓친 지난 루틴이 있을 때만 묻고, 같은 날 다시 묻지 않음', async () => {
  const db = await emptyDb();
  await weekdayRoutine(db);
  // 처음 실행: 기준만 저장하고 묻지 않음 (월요일 운동이 있어도)
  assert.equal(await repo.findMissedRoutine(db, '2026-11-03'), null);
  // 이틀 뒤(수 11/04): 월요일(11/02) 루틴은 기준일 이전이라 대상 아님, 화요일은 휴식
  assert.equal(await repo.findMissedRoutine(db, '2026-11-04'), null);
  // 다음 주 화요일(11/10)에 열었는데 월요일(11/09) 루틴을 안 했다면 묻는다
  const m = await repo.findMissedRoutine(db, '2026-11-10');
  assert.equal(m?.date, '2026-11-09');
  assert.ok(m!.templateName.includes('가슴'));
  // 선택하면(넘어가기) 같은 날 다시 묻지 않고, 다음 날에도 같은 날짜를 다시 묻지 않음
  assert.equal(await repo.resolveMissed(db, '2026-11-10', m!, 'skip'), null);
  assert.equal(await repo.findMissedRoutine(db, '2026-11-10'), null);
  assert.equal(await repo.findMissedRoutine(db, '2026-11-11'), null);
});
await test('앱 시작 팝업: 그날 다른 운동이라도 완료한 기록이 있으면 묻지 않음, 오늘의 루틴·진행 중 운동도 대상 아님', async () => {
  const db = await emptyDb();
  await weekdayRoutine(db);
  assert.equal(await repo.findMissedRoutine(db, '2026-11-09'), null); // 기준일 저장 (11/08까지는 묻지 않음)
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-09', ex.id, [{ w: 50, r: 10 }]); // 월요일에 (자유 운동이라도) 운동함
  assert.equal(await repo.findMissedRoutine(db, '2026-11-10'), null);
  // 수요일(오늘)의 루틴은 아직 안 했어도 묻지 않는다 (지난 날짜만 대상: 화=휴식, 월=완료)
  assert.equal(await repo.findMissedRoutine(db, '2026-11-11'), null);
  // 월요일(오늘) 열었을 때 어제(일) 루틴을 못 했으면 묻는다. 단, 진행 중인 운동이 있으면 묻지 않는다.
  assert.equal((await repo.findMissedRoutine(db, '2026-11-16'))?.date, '2026-11-15');
  await repo.startFreeSession(db, '2026-11-16');
  assert.equal(await repo.findMissedRoutine(db, '2026-11-16'), null);
});
await test('앱 시작 팝업 선택: 루틴대로 하기(사이클은 일정이 밀림), 오늘만 자유 운동(일정 그대로)', async () => {
  const build = async () => {
    const db = await emptyDb();
    const id = await repo.createRoutine(db, '2026-11-01', { name: '3일 주기', mode: 'cycle', startDate: '2026-11-01' });
    await weightDay(db, id, 'A', '벤치프레스'); // 11/01, 11/04, 11/07
    await weightDay(db, id, 'B', '렛풀다운'); // 11/02, 11/05
    await repo.upsertDay(db, '2026-11-01', id, { name: '휴식', kind: 'rest' }); // 11/03, 11/06
    await repo.setRepeatDays(db, '2026-11-01', id, 3);
    return { db, id };
  };
  const { db, id } = await build();
  assert.equal(await repo.findMissedRoutine(db, '2026-11-02'), null); // 기준일 저장 (11/01)
  const m = (await repo.findMissedRoutine(db, '2026-11-03'))!; // 11/02의 B를 못 함 (11/01은 기준일 이전)
  assert.equal(m.date, '2026-11-02');
  assert.ok(m.templateName.includes('B'));
  const sid = (await repo.resolveMissed(db, '2026-11-03', m, 'follow'))!;
  const ses = (await repo.loadSession(db, sid))!;
  assert.equal(ses.title, 'B');
  assert.equal(ses.date, '2026-11-03');
  assert.equal((await repo.slotForDate(db, '2026-11-03'))!.label, 'B'); // 오늘이 그 칸이 됨
  assert.equal((await repo.slotForDate(db, '2026-11-04'))!.kind, 'rest'); // 이후 일정이 하루 밀림
  assert.equal((await repo.slotForDate(db, '2026-11-05'))!.label, 'A');
  assert.ok(id);

  // 오늘만 자유 운동: 일정은 그대로
  const { db: db2, id: id2 } = await build();
  await repo.findMissedRoutine(db2, '2026-11-02');
  const m2 = (await repo.findMissedRoutine(db2, '2026-11-03'))!;
  const fsid = (await repo.resolveMissed(db2, '2026-11-03', m2, 'free'))!;
  assert.equal((await repo.loadSession(db2, fsid))!.is_free, 1);
  assert.equal((await repo.slotForDate(db2, '2026-11-03'))!.kind, 'rest'); // 변화 없음
  assert.equal((await repo.getRoutines(db2, '2026-11-03')).routines.find((r) => r.id === id2)!.startDate, '2026-11-01');

  // 요일 지정 루틴은 '루틴대로 하기'를 해도 일정(요일)이 바뀌지 않음
  const db3 = await emptyDb();
  await weekdayRoutine(db3);
  await repo.findMissedRoutine(db3, '2026-11-09');
  const m3 = (await repo.findMissedRoutine(db3, '2026-11-17'))!; // 월 11/16 가슴을 못 함 (일 11/15 어깨도 못 했지만 가장 최근 것)
  assert.equal(m3.date, '2026-11-16');
  await repo.resolveMissed(db3, '2026-11-17', m3, 'follow');
  assert.equal((await repo.slotForDate(db3, '2026-11-18'))!.label, '하체'); // 수요일은 그대로 하체
});
await test('세트 입력: 새 종목/세트는 비어 있고(앞 세트 값에서 시작), 지난 기록은 완료한 본 세트에서 가져옴', async () => {
  const db = await freshDb();
  const ex = await repo.getOrCreateExercise(db, '벤치프레스');
  assert.equal(await repo.lastPerformance(db, ex.id), null);
  await logSession(db, '2026-11-01', ex.id, [{ w: 40, r: 10 }, { w: 45, r: 8 }]);
  const last = await repo.lastPerformance(db, ex.id);
  assert.deepEqual([last!.weight, last!.reps], [45, 8]);
  const sid = await repo.startFreeSession(db, '2026-11-05');
  const seId = await repo.addSessionExercise(db, sid, ex.id, 3);
  await repo.addSet(db, seId, 'working');
  const sets = (await repo.loadSession(db, sid))!.exercises[0].sets;
  assert.equal(sets.length, 4);
  assert.ok(sets.every((x) => x.weight == null && x.reps == null && x.done === 0));
});
await test('중량 단위(±) 설정: 기본 2.5kg, 저장한 값을 읽음, 잘못된 값은 기본값', async () => {
  const db = await freshDb();
  assert.equal(await repo.getWeightStep(db), 2.5);
  await repo.setSetting(db, 'weight_step', '5');
  assert.equal(await repo.getWeightStep(db), 5);
  await repo.setSetting(db, 'weight_step', 'abc');
  assert.equal(await repo.getWeightStep(db), 2.5);
});
await test('타이머: 시작 시각·종료 시각·총 시간이 기록되고, 다시 열면 시간이 이어짐', async () => {
  const db = await freshDb();
  const sid = await repo.startFreeSession(db, '2026-11-05');
  // 20분 전에 시작한 것으로 맞춘 뒤 종료
  await db.run('UPDATE workout_sessions SET started_at = ? WHERE id = ?', [new Date(Date.now() - 20 * 60000).toISOString(), sid]);
  await repo.finishSession(db, sid);
  let s = (await repo.loadSession(db, sid))!;
  assert.equal(s.status, 'done');
  assert.ok(s.ended_at);
  assert.ok(s.duration_sec! >= 1199 && s.duration_sec! <= 1202);
  // 완료 후 한참 뒤에 수정하러 다시 열어도, 타이머는 종료 이후 공백을 세지 않고 20분부터 이어짐
  await repo.reopenSession(db, sid);
  s = (await repo.loadSession(db, sid))!;
  assert.equal(s.status, 'active');
  assert.equal(s.ended_at, null);
  const elapsed = (Date.now() - new Date(s.started_at).getTime()) / 1000;
  assert.ok(elapsed >= 1199 && elapsed <= 1203, `elapsed ${elapsed}`);
});
await test('루틴 브리프: 홈 카드용 이름·종목 수·앞 3개 종목', async () => {
  const db = await freshDb();
  const mon = (await repo.listTemplates(db)).find((t) => t.name.includes('월요일'))!;
  const b = (await repo.getTemplateBrief(db, mon.id))!;
  assert.equal(b.count, 10);
  assert.deepEqual(b.names, ['렛풀다운', '시티드로우', '숄더프레스 머신']);
  assert.equal(await repo.getTemplateBrief(db, 'nope'), null);
});

console.log('신체 항목 / 1RM / 보는 운동 / 첫 실행');
await test('직접 만든 항목: 추가·값 저장·그래프용 조회·삭제하면 값도 삭제', async () => {
  const db = await emptyDb();
  const m = await repo.addBodyMetric(db, { label: '허리둘레', unit: 'cm' });
  assert.equal(m.key, 'x1');
  await repo.setBodyExtra(db, 'x1', '2026-11-01', 80);
  await repo.setBodyExtra(db, 'x1', '2026-11-05', 79.5);
  assert.deepEqual((await repo.getBodyExtra(db)).x1, { '2026-11-01': 80, '2026-11-05': 79.5 });
  // 값만 있는 날도 신체 기록 행이 만들어져 목록·그래프에 나온다
  assert.deepEqual((await repo.listMeasurements(db)).map((r) => r.date), ['2026-11-01', '2026-11-05']);
  await repo.setBodyExtra(db, 'x1', '2026-11-05', null);
  assert.deepEqual(Object.keys((await repo.getBodyExtra(db)).x1), ['2026-11-01']);
  await assert.rejects(() => repo.setBodyExtra(db, 'weight', '2026-11-01', 70)); // 기본 항목은 이 경로로 저장하지 않음
  await assert.rejects(() => repo.addBodyMetric(db, { label: '허리둘레', unit: '' }));
  await repo.removeBodyMetric(db, 'x1');
  assert.equal((await repo.getBodyMetrics(db)).some((x) => x.key === 'x1'), false);
  assert.deepEqual(await repo.getBodyExtra(db), {});
});
await test('기본 항목은 지우면 숨김만 되고 기록은 남으며, 다시 보이게 할 수 있음', async () => {
  const db = await emptyDb();
  await repo.upsertMeasurement(db, '2026-11-01', { weight: 70, body_fat_pct: 18 });
  await repo.removeBodyMetric(db, 'body_fat_pct');
  const l = await repo.getBodyMetrics(db);
  assert.equal(l.find((x) => x.key === 'body_fat_pct')!.hidden, true);
  assert.equal((await repo.listMeasurements(db))[0].body_fat_pct, 18);
  await repo.setBodyMetricHidden(db, 'body_fat_pct', false);
  assert.equal((await repo.getBodyMetrics(db)).find((x) => x.key === 'body_fat_pct')!.hidden, false);
});
await test('직접 항목 이름·단위·색 변경, 기본 항목은 이름을 바꾸지 않음, 신체 기록을 지우면 그날 값도 삭제', async () => {
  const db = await emptyDb();
  await repo.addBodyMetric(db, { label: '허리', unit: 'cm' });
  await repo.updateBodyMetric(db, 'x1', { label: '허리둘레', unit: 'inch', color: '#1e88e5' });
  await repo.updateBodyMetric(db, 'weight', { label: '체중' });
  const l = await repo.getBodyMetrics(db);
  assert.deepEqual([l.find((x) => x.key === 'x1')!.label, l.find((x) => x.key === 'x1')!.unit, l.find((x) => x.key === 'x1')!.color], ['허리둘레', 'inch', '#1E88E5']);
  assert.equal(l.find((x) => x.key === 'weight')!.label, '몸무게');
  await repo.setBodyExtra(db, 'x1', '2026-11-01', 80);
  await repo.deleteMeasurement(db, (await repo.listMeasurements(db))[0].id);
  assert.deepEqual((await repo.getBodyExtra(db)).x1 ?? {}, {});
});
await test('백업 복원에 직접 항목 정의와 값이 함께 들어가고, 신체 CSV는 그대로 동작', async () => {
  const db = await emptyDb();
  await repo.addBodyMetric(db, { label: '허리둘레', unit: 'cm' });
  await repo.setBodyExtra(db, 'x1', '2026-11-01', 80);
  const bak = await exportBackup(db);
  const db2 = await emptyDb();
  await restoreBackup(db2, JSON.parse(JSON.stringify(bak)));
  assert.equal((await repo.getBodyMetrics(db2)).at(-1)!.label, '허리둘레');
  assert.deepEqual((await repo.getBodyExtra(db2)).x1, { '2026-11-01': 80 });
  assert.ok((await exportBodyCsv(db2)).includes('2026-11-01'));
});

await test('1RM 세트: 준비/본/1RM 전환, 평소 통계·볼륨·지난 기록 힌트에서 제외, 1RM 필터에서만 조회', async () => {
  const db = await emptyDb();
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  const { sid, seId } = await logSession(db, '2026-11-02', bench.id, [{ w: 60, r: 8 }, { w: 100, r: 1 }]);
  let s = (await repo.loadSession(db, sid))!;
  const rmSet = s.exercises[0].sets[1];
  await repo.updateSet(db, rmSet.id, { kind: 'rm' });
  s = (await repo.loadSession(db, sid))!;
  assert.equal(s.exercises[0].sets[1].is_rm, 1);
  assert.equal(s.exercises[0].sets[1].set_type, 'working');
  const flat = await repo.loadFlatSets(db);
  assert.deepEqual(filterSets(flat, { exerciseId: bench.id }).map((x) => x.weight), [60]);
  assert.deepEqual(filterSets(flat, { exerciseId: bench.id, onlyRm: true }).map((x) => x.weight), [100]);
  const lp = await repo.lastPerformance(db, bench.id);
  assert.deepEqual([lp?.weight, lp?.reps], [60, 8]);
  const wk = await repo.weekStats(db, '2026-11-02');
  assert.equal(wk.sets, 1);
  assert.equal(wk.volume, 480);
  // 다시 본 세트로 되돌리면 평소 기록에 들어옴, 준비 세트로 바꾸면 1RM 표시가 사라짐
  await repo.updateSet(db, rmSet.id, { kind: 'working' });
  assert.equal(filterSets(await repo.loadFlatSets(db), { exerciseId: bench.id }).length, 2);
  await repo.updateSet(db, rmSet.id, { kind: 'rm' });
  await repo.updateSet(db, rmSet.id, { kind: 'warmup' });
  s = (await repo.loadSession(db, sid))!;
  assert.deepEqual([s.exercises[0].sets[1].set_type, s.exercises[0].sets[1].is_rm], ['warmup', 0]);
  void seId;
});
await test('1RM 세트는 루틴으로 저장할 때 목표 세트·중량에 반영되지 않고 CSV에 1RM으로 표시', async () => {
  const db = await emptyDb();
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  const { sid } = await logSession(db, '2026-11-02', bench.id, [{ w: 60, r: 8 }, { w: 100, r: 1 }]);
  const rm = (await repo.loadSession(db, sid))!.exercises[0].sets[1];
  await repo.updateSet(db, rm.id, { kind: 'rm' });
  const r = await repo.saveSessionAsDay(db, '2026-11-05', sid, '상체');
  const day = (await repo.getDayDetail(db, '2026-11-05', r.routineId, r.dayId))!;
  assert.equal(day.exercises[0].target_sets, 1);
  assert.equal(day.exercises[0].target_weight, 60);
  assert.ok((await exportWorkoutCsv(db)).includes('1RM'));
});
await test('이전 버전 DB(is_rm 열 없음)도 열 때 자동으로 열이 추가되고 기존 세트는 평소 기록으로 남음', async () => {
  const db = openTestDb();
  await db.exec(DDL.replace('  is_rm INTEGER DEFAULT 0,\n', ''));
  const before = await db.all<{ name: string }>('PRAGMA table_info(workout_sets)');
  assert.equal(before.some((c) => c.name === 'is_rm'), false);
  await seedDefaults(db);
  const after = await db.all<{ name: string }>('PRAGMA table_info(workout_sets)');
  assert.equal(after.some((c) => c.name === 'is_rm'), true);
  await seedDefaults(db); // 한 번 더 실행해도 오류 없음
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-02', bench.id, [{ w: 60, r: 8 }]);
  assert.equal(filterSets(await repo.loadFlatSets(db), { exerciseId: bench.id }).length, 1);
});
await test('이전 버전 백업(is_rm 없음)을 복원해도 오류 없이 평소 기록으로 복원', async () => {
  const db = await emptyDb();
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  await logSession(db, '2026-11-02', bench.id, [{ w: 60, r: 8 }]);
  const bak = JSON.parse(JSON.stringify(await exportBackup(db)));
  for (const r of bak.tables.workout_sets) delete r.is_rm;
  const db2 = await emptyDb();
  await restoreBackup(db2, bak);
  const flat = await repo.loadFlatSets(db2);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].isRm, false);
});

await test('보는 운동: 루틴의 운동은 여러 날·여러 루틴에 있어도 한 번만, 고른 것만 목록에 나옴', async () => {
  const db = await emptyDb();
  const today = '2026-11-05';
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  const row = await repo.getOrCreateExercise(db, '바벨로우');
  const sq = await repo.getOrCreateExercise(db, '스쿼트');
  const r1 = await repo.createRoutine(db, today, { name: '3분할' });
  await repo.upsertDay(db, today, r1, { name: '푸쉬', kind: 'weights', exercises: [{ exerciseId: bench.id, targetSets: 3, targetReps: 8, targetWeight: null }] });
  await repo.upsertDay(db, today, r1, { name: '푸쉬2', kind: 'weights', exercises: [
    { exerciseId: bench.id, targetSets: 3, targetReps: 8, targetWeight: null }, { exerciseId: row.id, targetSets: 3, targetReps: 8, targetWeight: null }] });
  const r2 = await repo.createRoutine(db, today, { name: '하체 특화' });
  await repo.upsertDay(db, today, r2, { name: '하체', kind: 'weights', exercises: [
    { exerciseId: sq.id, targetSets: 5, targetReps: 5, targetWeight: null }, { exerciseId: bench.id, targetSets: 2, targetReps: 10, targetWeight: null }] });
  await repo.upsertDay(db, today, r2, { name: '휴식', kind: 'rest', exercises: [] });
  const list = await repo.listRoutineExercises(db, today);
  assert.deepEqual(list.map((x) => x.name).sort(), ['바벨로우', '벤치프레스', '스쿼트']);
  assert.deepEqual(list.find((x) => x.name === '벤치프레스')!.routines, ['3분할', '하체 특화']);

  assert.deepEqual(await repo.listWatchedExercises(db), []); // 처음에는 아무것도 고르지 않은 상태
  assert.equal(await repo.toggleTracked(db, row.id), true);
  assert.equal(await repo.toggleTracked(db, bench.id), true);
  assert.deepEqual((await repo.listWatchedExercises(db)).map((x) => x.name), ['바벨로우', '벤치프레스']); // 고른 순서
  assert.equal(await repo.toggleTracked(db, row.id), false);
  assert.deepEqual((await repo.listWatchedExercises(db)).map((x) => x.name), ['벤치프레스']);
  // 루틴에 없는 종목도 직접 추가 가능, 깨진 저장값은 빈 목록
  const free = await repo.getOrCreateExercise(db, '풀업');
  await repo.setTrackedIds(db, [free.id, free.id, 'ghost']);
  assert.deepEqual((await repo.listWatchedExercises(db)).map((x) => x.name), ['풀업']);
  await repo.setSetting(db, 'tracked_exercises', '{oops');
  assert.deepEqual(await repo.getTrackedIds(db), []);
});

await test('첫 실행 설정: 새로 설치할 때만 표시 대기 상태가 되고, 업데이트한 기존 앱에는 뜨지 않음', async () => {
  const fresh = await emptyDb();
  assert.equal(await seedDefaults(fresh), true);
  assert.equal(await repo.getSetting(fresh, 'setup_pending'), '1');
  const old = await freshDb(); // 예전 버전이 이미 만들어 둔 앱
  await seedDefaults(old);
  assert.equal(await repo.getSetting(old, 'setup_pending'), null);
});

console.log('날 끌어서 옮기기 / 휴식 설정');
await test('날을 원하는 위치로 옮기기(moveDayTo): 앞·뒤·같은 자리·범위 밖, 사이클 일차가 순서를 따름', async () => {
  const db = await emptyDb();
  const today = '2026-11-05';
  const rid = await repo.createRoutine(db, today, { name: '4분할' });
  const ids: string[] = [];
  for (const n of ['가슴', '등', '하체', '어깨']) ids.push(await repo.upsertDay(db, today, rid, { name: n, kind: 'weights', exercises: [] }));
  const names = async () => (await repo.getRoutines(db, today)).routines[0].days.map((d) => d.name);
  assert.deepEqual(await names(), ['가슴', '등', '하체', '어깨']);
  await repo.moveDayTo(db, today, rid, ids[0], 2);
  assert.deepEqual(await names(), ['등', '하체', '가슴', '어깨']);
  await repo.moveDayTo(db, today, rid, ids[3], 0);
  assert.deepEqual(await names(), ['어깨', '등', '하체', '가슴']);
  await repo.moveDayTo(db, today, rid, ids[1], 1); // 같은 자리
  await repo.moveDayTo(db, today, rid, ids[1], 99);
  assert.deepEqual(await names(), ['어깨', '하체', '가슴', '등']);
  await repo.moveDayTo(db, today, rid, 'nope', 0); // 없는 날은 무시
  assert.equal((await names()).length, 4);
});
await test('세트 사이 휴식: 기본값(90초)·설정값·잘못된 값, 루틴에 정한 종목별 휴식을 운동에서 읽음', async () => {
  const db = await emptyDb();
  assert.equal(await repo.getRestDefault(db), 90);
  await repo.setSetting(db, 'rest_default_sec', '0');
  assert.equal(await repo.getRestDefault(db), 0);
  await repo.setSetting(db, 'rest_default_sec', '120');
  assert.equal(await repo.getRestDefault(db), 120);
  await repo.setSetting(db, 'rest_default_sec', 'abc');
  assert.equal(await repo.getRestDefault(db), 90);

  const today = '2026-11-05';
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  const fly = await repo.getOrCreateExercise(db, '플라이');
  const rid = await repo.createRoutine(db, today, { name: '상체' });
  const did = await repo.upsertDay(db, today, rid, { name: '가슴', kind: 'weights', exercises: [
    { exerciseId: bench.id, targetSets: 3, targetReps: 8, targetWeight: null, restSec: 150 },
    { exerciseId: fly.id, targetSets: 3, targetReps: 12, targetWeight: null } ] });
  const day = (await repo.getDayDetail(db, today, rid, did))!;
  const sid = await repo.startSessionFromTemplate(db, day.day.templateId!, today);
  const full = (await repo.loadSession(db, sid))!;
  const rests = await repo.getSessionRests(db, sid);
  assert.equal(rests[full.exercises.find((e) => e.exercise_name === '벤치프레스')!.id], 150);
  assert.equal(rests[full.exercises.find((e) => e.exercise_name === '플라이')!.id], null);
  // 자유 운동에서 추가한 종목에는 정해 둔 휴식이 없음
  const free = await repo.startFreeSession(db, today);
  const seId = await repo.addSessionExercise(db, free, bench.id);
  assert.equal((await repo.getSessionRests(db, free))[seId], null);
});

await test('자유 운동: 첫 종목을 고른 때부터 시간 시작, 종목 방식은 운동 중에 바꿈', async () => {
  const db = await emptyDb();
  const sid = await repo.startFreeSession(db, '2026-11-07');
  await db.run("UPDATE workout_sessions SET started_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [sid]);
  const ex = await repo.getOrCreateExercise(db, '푸시업');
  const se = await repo.addSessionExercise(db, sid, ex.id);
  const m = (await db.first<{ started_at: string }>('SELECT started_at FROM workout_sessions WHERE id = ?', [sid]))!;
  assert.ok(new Date(m.started_at).getFullYear() >= 2026);
  const ex2 = await repo.getOrCreateExercise(db, '풀업');
  await db.run("UPDATE workout_sessions SET started_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [sid]);
  await repo.addSessionExercise(db, sid, ex2.id); // 두 번째 종목은 시작 시각을 바꾸지 않음
  assert.equal((await db.first<{ started_at: string }>('SELECT started_at FROM workout_sessions WHERE id = ?', [sid]))!.started_at, '2020-01-01T00:00:00.000Z');
  await repo.setSessionExerciseMode(db, se, 'bodyweight');
  assert.equal((await repo.loadSession(db, sid))!.exercises[0].weight_mode, 'bodyweight');
  assert.equal((await repo.listExercises(db)).find((e) => e.id === ex.id)!.weight_mode, 'bodyweight');
});

await test('슈퍼세트 묶음이 루틴 저장·세션 시작·백업에 이어지고 종목 간 휴식 기본값은 180초', async () => {
  const db = await emptyDb();
  const a = await repo.getOrCreateExercise(db, '덤벨 컬');
  const b = await repo.getOrCreateExercise(db, '라잉 트라이셉스 익스텐션');
  const c = await repo.getOrCreateExercise(db, '벤치프레스');
  const tid = await repo.saveTemplate(db, { name: '팔', exercises: [
    { exerciseId: a.id, ss: 'g1' }, { exerciseId: b.id, ss: 'g1' }, { exerciseId: c.id },
  ] });
  assert.deepEqual((await repo.getTemplateExercises(db, tid)).map((e) => e.ss), ['g1', 'g1', null]);
  const sid = await repo.startSessionFromTemplate(db, tid, '2026-11-07');
  assert.deepEqual((await repo.loadSession(db, sid))!.exercises.map((e) => e.ss), ['g1', 'g1', null]);
  const bk = await exportBackup(db);
  assert.ok(bk.tables.workout_session_exercises.some((r) => r.ss === 'g1'));
  assert.equal(await repo.getExerciseRest(db), 180);
  await repo.setExerciseRest(db, 210);
  assert.equal(await repo.getExerciseRest(db), 210);
});

await test('지난 기록 불러오기·이 종목만 휴식·완료한 날짜 목록', async () => {
  const db = await emptyDb();
  const ex = await repo.getOrCreateExercise(db, '덤벨 컬');
  const s1 = await repo.startFreeSession(db, '2026-11-01');
  const se1 = await repo.addSessionExercise(db, s1, ex.id, 2);
  const a = (await repo.loadSession(db, s1))!.exercises[0].sets;
  await repo.updateSet(db, a[0].id, { weight: 12, reps: 10, done: true });
  await repo.updateSet(db, a[1].id, { weight: 12, reps: 9, done: true });
  await repo.finishSession(db, s1);
  const s2 = await repo.startFreeSession(db, '2026-11-03');
  const se2 = await repo.addSessionExercise(db, s2, ex.id, 2);
  assert.equal(JSON.stringify(await repo.getLastSets(db, ex.id, s2)), JSON.stringify([{ weight: 12, reps: 10 }, { weight: 12, reps: 9 }]));
  assert.deepEqual(await repo.getLastSets(db, ex.id, s1), []);
  assert.deepEqual(await repo.listDoneDates(db), ['2026-11-01']);
  assert.equal((await repo.getSessionRests(db, s2))[se2], null);
  await repo.setExerciseRestFor(db, ex.id, 75);
  assert.equal((await repo.getSessionRests(db, s2))[se2], 75);
  await repo.setRestDefault(db, 120);
  assert.equal((await repo.getSessionRests(db, s2))[se2], null); // 모든 종목에 저장하면 종목별 값은 지워짐
  assert.equal(await repo.getRestDefault(db), 120);
  void se1;
});

await test('루틴 시작: 순서 변경·컨디션은 이번 운동에만 적용되고 루틴은 그대로, 부위 변경은 저장됨', async () => {
  const db = await emptyDb();
  const a = await repo.getOrCreateExercise(db, '덤벨 컬');
  const b = await repo.getOrCreateExercise(db, '바벨 벤치프레스');
  const tid = await repo.saveTemplate(db, { name: '혼합', exercises: [
    { exerciseId: a.id, targetSets: 4, targetReps: 10, targetWeight: 20 }, { exerciseId: b.id, targetSets: 3, targetReps: 8, targetWeight: 60 },
  ] });
  const rows = await repo.getTemplateExercises(db, tid);
  // 순서만 바꾸기 (벤치프레스 먼저)
  const s1 = await repo.startSessionFromTemplate(db, tid, '2026-11-07', { order: [rows[1].id, rows[0].id] });
  const f1 = (await repo.loadSession(db, s1))!;
  assert.deepEqual(f1.exercises.map((e) => e.exercise_name), ['바벨 벤치프레스', '덤벨 컬']);
  assert.equal(f1.exercises[1].sets.length, 4);
  // 컨디션 75%: 무게 −10%(2.5 단위), 4세트 이상이면 1세트 감소
  const s2 = await repo.startSessionFromTemplate(db, tid, '2026-11-08', { cond: 75 });
  const f2 = (await repo.loadSession(db, s2))!;
  assert.deepEqual(f2.exercises.map((e) => [e.sets.length, e.sets[0].weight]), [[3, 17.5], [3, 55]]);
  // 컨디션 50%
  const s3 = await repo.startSessionFromTemplate(db, tid, '2026-11-09', { cond: 50 });
  const f3 = (await repo.loadSession(db, s3))!;
  assert.deepEqual(f3.exercises.map((e) => [e.sets.length, e.sets[0].weight]), [[3, 15], [2, 47.5]]);
  // 루틴은 바뀌지 않음
  assert.deepEqual((await repo.getTemplateExercises(db, tid)).map((e) => [e.target_sets, e.target_weight]), [[4, 20], [3, 60]]);
  // 옵션 없이 시작하면 그대로
  const s4 = await repo.startSessionFromTemplate(db, tid, '2026-11-10');
  assert.deepEqual((await repo.loadSession(db, s4))!.exercises.map((e) => [e.sets.length, e.sets[0].weight]), [[4, 20], [3, 60]]);
  // 부위 변경
  await repo.setExerciseCategory(db, a.id, '어깨');
  assert.equal((await repo.loadCategoryMap(db)).get(a.id), '어깨');
  await repo.setExerciseCategory(db, a.id, null);
  assert.equal((await repo.loadCategoryMap(db)).get(a.id), null);
});

await test('홈 카드: 루틴별 종목 수·부위 요약·마지막으로 한 날, 오늘 변경·보관 저장', async () => {
  const db = await emptyDb();
  const a = await repo.getOrCreateExercise(db, '바벨 벤치프레스');
  const b = await repo.getOrCreateExercise(db, '덤벨 컬');
  const t1 = await repo.saveTemplate(db, { name: '가슴 팔', exercises: [
    { exerciseId: a.id, targetSets: 4 }, { exerciseId: b.id, targetSets: 3 },
  ] });
  const t2 = await repo.saveTemplate(db, { name: '팔만', exercises: [{ exerciseId: b.id, targetSets: 2 }] });
  let cards = await repo.getTemplateCards(db);
  assert.deepEqual(cards.map((c) => [c.name, c.count, c.lastDate]), [['가슴 팔', 2, null], ['팔만', 1, null]]);
  assert.deepEqual(cards[0].parts, [{ part: '가슴', sets: 4 }, { part: '팔', sets: 3 }]);
  // 완료한 운동만 '마지막으로 한 날'에 잡힘 (진행 중·루틴 없는 자유 운동은 제외)
  const s1 = await repo.startSessionFromTemplate(db, t1, '2026-11-01');
  await repo.finishSession(db, s1);
  const s2 = await repo.startSessionFromTemplate(db, t1, '2026-11-05');
  await repo.finishSession(db, s2);
  await repo.startSessionFromTemplate(db, t2, '2026-11-06'); // 진행 중
  cards = await repo.getTemplateCards(db);
  assert.deepEqual(cards.map((c) => c.lastDate), ['2026-11-05', null]);
  // 부위를 바꾸면 카드 요약에도 반영
  await repo.setExerciseCategory(db, b.id, '어깨');
  assert.deepEqual((await repo.getTemplateCards(db))[0].parts, [{ part: '가슴', sets: 4 }, { part: '어깨', sets: 3 }]);
  // 오늘 변경
  assert.equal(await repo.getTodayOverride(db, '2026-11-07'), null);
  await repo.setTodayOverride(db, '2026-11-07', t2);
  assert.equal(await repo.getTodayOverride(db, '2026-11-07'), t2);
  assert.equal(await repo.getTodayOverride(db, '2026-11-08'), null);
  await repo.setTodayOverride(db, '2026-11-07', null);
  assert.equal(await repo.getTodayOverride(db, '2026-11-07'), null);
  // 보관
  assert.deepEqual(await repo.getArchivedTemplates(db), []);
  await repo.setArchivedTemplates(db, [t2, t2]);
  assert.deepEqual(await repo.getArchivedTemplates(db), [t2]);
});

console.log('빈 루틴 정리 · 대체 운동 · 연습 세트');
await test('빈 루틴 정리: 기본 이름 그대로 날이 없는 루틴만 지우고, 사용 중이던 루틴이면 다른 루틴으로 넘김', async () => {
  const db = await emptyDb();
  const keep = await repo.createRoutine(db, '2026-11-05', { name: '내 루틴' }); // 날 없음이지만 이름을 정함 → 유지
  const junk = await repo.createRoutine(db, '2026-11-05', { name: '' }); // '새 루틴'
  const filled = await repo.createRoutine(db, '2026-11-05', { name: '새 루틴' });
  await weightDay(db, filled, '가슴', '벤치프레스');
  assert.equal(await repo.pruneEmptyRoutines(db, '2026-11-05'), 1);
  const st = await repo.getRoutines(db, '2026-11-05');
  assert.deepEqual(st.routines.map((r) => r.id), [keep, filled]);
  assert.ok(!st.routines.some((r) => r.id === junk));
  assert.equal(await repo.pruneEmptyRoutines(db, '2026-11-05'), 0);
  // 첫 루틴(자동으로 사용 중)이 빈 새 루틴이면 지운 뒤 다른 루틴이 사용 중
  const db2 = await emptyDb();
  const first = await repo.createRoutine(db2, '2026-11-05', { name: '' });
  const other = await repo.createRoutine(db2, '2026-11-05', { name: '다른 루틴' });
  assert.equal((await repo.getRoutines(db2, '2026-11-05')).activeId, first);
  await repo.pruneEmptyRoutines(db2, '2026-11-05');
  assert.equal((await repo.getRoutines(db2, '2026-11-05')).activeId, other);
});
await test('대체 운동: 완료한 세트가 없을 때만 바꾸고 세트 수·순서는 그대로, 입력만 한 값은 비움', async () => {
  const db = await emptyDb();
  const bench = await repo.getOrCreateExercise(db, '벤치프레스');
  const dumb = await repo.getOrCreateExercise(db, '덤벨 벤치프레스');
  const sid = await repo.startFreeSession(db, '2026-11-05');
  const se = await repo.addSessionExercise(db, sid, bench.id, 3);
  let ses = (await repo.loadSession(db, sid))!;
  await repo.updateSet(db, ses.exercises[0].sets[0].id, { weight: 60, reps: 8 }); // 입력만, 완료 아님
  assert.equal(await repo.replaceSessionExercise(db, se, dumb.id), true);
  ses = (await repo.loadSession(db, sid))!;
  assert.equal(ses.exercises[0].exercise_name, '덤벨 벤치프레스');
  assert.equal(ses.exercises[0].exercise_id, dumb.id);
  assert.equal(ses.exercises[0].sets.length, 3);
  assert.equal(ses.exercises[0].sets[0].weight, null);
  // 완료한 세트가 있으면 바꾸지 않음
  await repo.updateSet(db, ses.exercises[0].sets[0].id, { weight: 20, reps: 10, done: true });
  assert.equal(await repo.replaceSessionExercise(db, se, bench.id), false);
  assert.equal((await repo.loadSession(db, sid))!.exercises[0].exercise_name, '덤벨 벤치프레스');
  assert.equal(await repo.replaceSessionExercise(db, se, 'nope'), false); // 없는 종목
});
await test('연습 세트 추가: 정해진 무게·횟수의 준비 세트가 완료 표시 없이 붙고, 통계에는 들어가지 않음', async () => {
  const db = await emptyDb();
  const ex = await repo.getOrCreateExercise(db, '스쿼트');
  const sid = await repo.startFreeSession(db, '2026-11-05');
  const se = await repo.addSessionExercise(db, sid, ex.id, 3);
  await repo.addWarmupSets(db, se, [{ weight: 40, reps: 8 }, { weight: 60, reps: 5 }]);
  const sets = (await repo.loadSession(db, sid))!.exercises[0].sets;
  const warm = sets.filter((x) => x.set_type === 'warmup');
  assert.deepEqual(warm.map((x) => [x.weight, x.reps, x.done]), [[40, 8, 0], [60, 5, 0]]);
  assert.equal(sets.filter((x) => x.set_type === 'working').length, 3);
});
await test('칸 배치 통째로 저장(끌어서 옮긴 결과): 칸 수는 그대로, 없는 날은 빈 칸', async () => {
  const db = await emptyDb();
  const id = await repo.createRoutine(db, '2026-11-01', { name: '3일', mode: 'cycle', repeat: 3 });
  const a = await weightDay(db, id, 'A', '벤치프레스');
  const b = await weightDay(db, id, 'B', '렛풀다운');
  await repo.setRoutineSlots(db, '2026-11-01', id, [b, null, a]);
  assert.deepEqual((await repo.getRoutines(db, '2026-11-01')).routines[0].slots, [b, null, a]);
  await repo.setRoutineSlots(db, '2026-11-01', id, ['없는날', a, b, a, b]); // 칸 수(3)를 넘는 값은 버리고 없는 날은 비움
  assert.deepEqual((await repo.getRoutines(db, '2026-11-01')).routines[0].slots, [null, a, b]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
