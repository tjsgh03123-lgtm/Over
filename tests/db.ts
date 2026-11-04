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
await test('기본 루틴: 월 10종목, 수·금·일 8종목, 요일 규칙 7개, 기본 3세트, 강도 없음', async () => {
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
  assert.equal(fri.t.default_intensity, 'none');
  assert.ok(!(await repo.getSchedule(db)).some((r) => r.default_intensity !== 'none' && r.kind === 'weights'), '웨이트 요일에 강도 지정이 없어야 함');
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

console.log('루틴 일정 · 앱 시작 팝업 · 타이머 · 세트 입력');
await test('요일별 일정: 날짜 → 요일 규칙, 삭제된 루틴은 연결 없음으로 취급', async () => {
  const db = await freshDb();
  // 2026-11-02 = 월요일
  const mon = (await repo.slotForDate(db, '2026-11-02'))!;
  assert.equal(mon.kind, 'weights');
  assert.ok(mon.template_id);
  assert.equal((await repo.slotForDate(db, '2026-11-03'))!.kind, 'rest');
  assert.equal(mon.cycleDay, undefined);
  await repo.deleteTemplate(db, mon.template_id!);
  assert.equal((await repo.slotForDate(db, '2026-11-02'))!.template_id, null);
});
await test('N일 주기: 3일 주기(A·B·휴식)가 시작일 기준으로 순환, 몇 일차인지 표시', async () => {
  const db = await freshDb();
  const [a, b] = await repo.listTemplates(db);
  await repo.savePlan(db, {
    mode: 'cycle', startDate: '2026-11-01',
    slots: [
      { kind: 'weights', templateId: a.id, label: a.name },
      { kind: 'weights', templateId: b.id, label: b.name },
      { kind: 'rest', templateId: null, label: '휴식' },
    ],
  });
  const kinds: string[] = [];
  const ids: (string | null)[] = [];
  for (let d = 1; d <= 6; d++) {
    const s = (await repo.slotForDate(db, `2026-11-0${d}`))!;
    kinds.push(s.kind); ids.push(s.template_id);
    assert.equal(s.cycleDay, ((d - 1) % 3) + 1);
    assert.equal(s.cycleLength, 3);
  }
  assert.deepEqual(kinds, ['weights', 'weights', 'rest', 'weights', 'weights', 'rest']);
  assert.deepEqual(ids, [a.id, b.id, null, a.id, b.id, null]);
  // 저장 후 다시 읽어도 동일 (백업 복원 시 app_settings로 함께 보존)
  const backup = await exportBackup(db);
  const db2 = await freshDb();
  await restoreBackup(db2, backup);
  assert.equal((await repo.slotForDate(db2, '2026-11-02'))!.template_id, b.id);
});
await test('앱 시작 팝업: 처음에는 묻지 않고, 놓친 지난 루틴이 있을 때만 묻고, 같은 날 다시 묻지 않음', async () => {
  const db = await freshDb();
  // 처음 실행: 기준만 저장하고 묻지 않음 (기본 시드에 월요일 루틴이 있어도)
  assert.equal(await repo.findMissedRoutine(db, '2026-11-03'), null);
  // 이틀 뒤(수 11/04): 월요일(11/02) 루틴은 기준일 이전이라 대상 아님, 화요일은 휴식
  assert.equal(await repo.findMissedRoutine(db, '2026-11-04'), null);
  // 다음 주 화요일(11/10)에 열었는데 월요일(11/09) 루틴을 안 했다면 묻는다
  const m = await repo.findMissedRoutine(db, '2026-11-10');
  assert.equal(m?.date, '2026-11-09');
  assert.ok(m!.templateName.includes('월요일'));
  // 선택하면(넘어가기) 같은 날 다시 묻지 않고, 다음 날에도 같은 날짜를 다시 묻지 않음
  assert.equal(await repo.resolveMissed(db, '2026-11-10', m!, 'skip'), null);
  assert.equal(await repo.findMissedRoutine(db, '2026-11-10'), null);
  assert.equal(await repo.findMissedRoutine(db, '2026-11-11'), null);
});
await test('앱 시작 팝업: 그날 다른 운동이라도 완료한 기록이 있으면 묻지 않음, 오늘의 루틴·진행 중 운동도 대상 아님', async () => {
  const db = await freshDb();
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
await test('앱 시작 팝업 선택: 루틴대로 하기(주기 모드는 일정이 밀림), 오늘만 자유 운동(일정 그대로)', async () => {
  const db = await freshDb();
  const [a, b] = await repo.listTemplates(db);
  await repo.savePlan(db, {
    mode: 'cycle', startDate: '2026-11-01',
    slots: [
      { kind: 'weights', templateId: a.id, label: a.name }, // 11/01, 11/04, 11/07
      { kind: 'weights', templateId: b.id, label: b.name }, // 11/02, 11/05
      { kind: 'rest', templateId: null, label: '휴식' }, // 11/03, 11/06
    ],
  });
  assert.equal(await repo.findMissedRoutine(db, '2026-11-02'), null); // 기준일 저장 (11/01)
  // 11/02: 어제(11/01)의 A를 못 했고 오늘은 B 예정
  const m = (await repo.findMissedRoutine(db, '2026-11-03'))!; // 11/02의 B를 못 함 (11/01은 기준일 이전)
  assert.equal(m.date, '2026-11-02');
  assert.equal(m.templateId, b.id);
  const sid = (await repo.resolveMissed(db, '2026-11-03', m, 'follow'))!;
  const ses = (await repo.loadSession(db, sid))!;
  assert.equal(ses.template_id, b.id);
  assert.equal(ses.date, '2026-11-03');
  assert.equal((await repo.slotForDate(db, '2026-11-03'))!.template_id, b.id); // 오늘이 그 칸이 됨
  assert.equal((await repo.slotForDate(db, '2026-11-04'))!.kind, 'rest'); // 이후 일정이 하루 밀림

  // 오늘만 자유 운동: 일정은 그대로
  const db2 = await freshDb();
  await repo.savePlan(db2, { mode: 'cycle', startDate: '2026-11-01', slots: [
    { kind: 'weights', templateId: a.id, label: null }, { kind: 'weights', templateId: b.id, label: null }, { kind: 'rest', templateId: null, label: null }] });
  await repo.findMissedRoutine(db2, '2026-11-02');
  const m2 = (await repo.findMissedRoutine(db2, '2026-11-03'))!;
  const fsid = (await repo.resolveMissed(db2, '2026-11-03', m2, 'free'))!;
  const fs = (await repo.loadSession(db2, fsid))!;
  assert.equal(fs.is_free, 1);
  assert.equal((await repo.slotForDate(db2, '2026-11-03'))!.kind, 'rest'); // 변화 없음
  assert.equal((await repo.getPlan(db2, '2026-11-03')).startDate, '2026-11-01');
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
