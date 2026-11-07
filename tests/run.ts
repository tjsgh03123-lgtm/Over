import assert from 'node:assert/strict';
import { flattenSessions, resolveIntensity } from '../src/domain/intensity.ts';
import {
  change, dailyPoints, estimate1RM, filterSets, rangeFor, repChoices, sameRepsTrend, seriesByIntensity, summarize, weekStart,
} from '../src/domain/stats.ts';
import {
  addCustomMetric, BUILTIN_METRICS, MAX_CUSTOM_METRICS, sanitizeExtra, sanitizeMetrics, visibleMetrics,
} from '../src/domain/bodyMetrics.ts';
import { parseRoutine } from '../src/domain/parser.ts';
import { cycleIndex, daysBetween, shiftStartForMissed, startForDayNumber } from '../src/domain/cycle.ts';
import { cycleDayNumber, dayForDate, inferMode, MAX_DAYS, sanitizeRoutines, type Routine } from '../src/domain/routine.ts';
import { AI_IMPORT_PROMPT, AI_PROMPT_DIVIDER } from '../src/domain/importSchema.ts';
import { fmtDuration, fmtElapsed, restFor, suggestFor } from '../src/domain/format.ts';
import { clampDrag, moveItem, targetIndex } from '../src/domain/reorder.ts';
import { DEFAULT_GRAPH_COLORS, GRAPH_KEYS, sanitizeGraphColors, sanitizeMode } from '../src/domain/themeModel.ts';
import { SetFlow } from '../src/domain/setFlow.ts';
import { adjustForCondition, sanitizeRunMode } from '../src/domain/condition.ts';
import { buildPickGroups, equipOf } from '../src/domain/exerciseList.ts';
import { decodeOverride, encodeOverride, fmtDaysAgo, parseIds, partSummary, weekDays } from '../src/domain/homeCards.ts';
import { CATALOG, matchProfile, partOf } from '../src/domain/exerciseCatalog.ts';
import { barbellTotal, bestE1rm, estimateMinutes, monthDays, monthWeeks, partTotals, recommendNext, streakWeeks, volumeOf } from '../src/domain/workoutStats.ts';
import { blocksOf, currentOf, restAfter, type GEx } from '../src/domain/guided.ts';
import { AutoRepCounter, countWord, JOINTS, jointAngle } from '../src/domain/liveCount.ts';
import type { SessionRecord, SetRecord } from '../src/domain/types.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

let n = 0;
const set = (weight: number | null, reps: number | null, extra: Partial<SetRecord> = {}): SetRecord => ({
  id: `s${n++}`, setNo: 1, weight, reps, done: true, setType: 'working', intensity: null, ...extra,
});
const session = (
  id: string, date: string, sessionI: SessionRecord['intensity'],
  exI: SessionRecord['intensity'], sets: SetRecord[], exerciseId = 'bench', name = '벤치프레스',
): SessionRecord => ({
  id, date, intensity: sessionI,
  exercises: [{ id: `${id}-e`, exerciseId, exerciseName: name, weightMode: 'weighted', intensity: exI,
    sets: sets.map((s, i) => ({ ...s, setNo: i + 1 })) }],
});

// 테스트용 가상 기록 (실제 사용자 기록 아님)
const sessions: SessionRecord[] = [
  session('a', '2026-11-01', 'high', null, [set(60, 10, { setType: 'warmup' }), set(100, 5), set(97.5, 5)]),
  session('b', '2026-11-03', 'mid', null, [set(80, 8), set(80, 8, { done: false }), set(82.5, 6)]),
  session('c', '2026-11-05', null, null, [set(50, 12), set(null, 10), set(60, 10, { intensity: 'low' })]),
  session('d', '2026-11-08', 'high', 'mid', [set(102.5, 5, { intensity: 'high' }), set(85, 8)]),
];
const flat = flattenSessions(sessions);

console.log('강도 상속');
test('세트 → 종목 → 운동일 → 미지정 우선순위', () => {
  assert.equal(resolveIntensity('low', 'mid', 'high'), 'low');
  assert.equal(resolveIntensity(null, 'mid', 'high'), 'mid');
  assert.equal(resolveIntensity(null, null, 'high'), 'high');
  assert.equal(resolveIntensity(null, null, null), 'none');
  assert.equal(resolveIntensity('none', null, 'high'), 'high');
});
test('flatten이 상속 결과를 적용', () => {
  const d = flat.filter((s) => s.date === '2026-11-08');
  assert.deepEqual(d.map((s) => s.intensity), ['high', 'mid']);
});

console.log('1·2 종목별 중량 기록 및 그래프 반영');
test('날짜별 최고/평균/볼륨/반복수 (준비·미완료·미입력 제외)', () => {
  const pts = dailyPoints(filterSets(flat, { exerciseId: 'bench' }));
  assert.equal(pts.length, 4);
  const a = pts[0];
  assert.equal(a.best, 100);
  assert.equal(a.bestReps, 5);
  assert.equal(a.avg, 98.75); // 준비 세트(60) 제외
  assert.equal(a.volume, 100 * 5 + 97.5 * 5);
  const b = pts[1];
  assert.equal(b.setCount, 2); // 미완료 세트 제외
  const c = pts[2];
  assert.equal(c.setCount, 2); // 중량 미입력 제외
});
test('준비 세트는 별도 필터로 조회', () => {
  const w = filterSets(flat, { exerciseId: 'bench', onlyWarmup: true });
  assert.equal(w.length, 1);
  assert.equal(w[0].weight, 60);
});

console.log('3~6 강도 필터');
test('고중량', () => {
  const pts = dailyPoints(filterSets(flat, { exerciseId: 'bench', intensity: 'high' }));
  assert.deepEqual(pts.map((p) => [p.date, p.best]), [['2026-11-01', 100], ['2026-11-08', 102.5]]);
});
test('중간중량', () => {
  const pts = dailyPoints(filterSets(flat, { exerciseId: 'bench', intensity: 'mid' }));
  assert.deepEqual(pts.map((p) => [p.date, p.best]), [['2026-11-03', 82.5], ['2026-11-08', 85]]);
});
test('저중량', () => {
  const pts = dailyPoints(filterSets(flat, { exerciseId: 'bench', intensity: 'low' }));
  assert.deepEqual(pts.map((p) => [p.date, p.best]), [['2026-11-05', 60]]);
});
test('미지정', () => {
  const pts = dailyPoints(filterSets(flat, { exerciseId: 'bench', intensity: 'none' }));
  assert.deepEqual(pts.map((p) => [p.date, p.best]), [['2026-11-05', 50]]);
});

console.log('7·8 통합/비교');
test('전체 통합: 날짜별 최고', () => {
  const pts = dailyPoints(filterSets(flat, { exerciseId: 'bench', intensity: 'all' }));
  assert.deepEqual(pts.map((p) => p.best), [100, 82.5, 60, 102.5]);
});
test('강도별 비교 시리즈', () => {
  const s = seriesByIntensity(flat, 'bench', 'weighted');
  assert.equal(s.high.length, 2);
  assert.equal(s.mid.length, 2);
  assert.equal(s.low.length, 1);
  assert.equal(s.none.length, 0);
});
test('필터는 원본 기록을 변경하지 않음', () => {
  const before = JSON.stringify(sessions);
  filterSets(flat, { exerciseId: 'bench', intensity: 'high' });
  seriesByIntensity(flat, 'bench', 'weighted');
  assert.equal(JSON.stringify(sessions), before);
});

console.log('9 기록 수정 후 갱신');
test('수정/삭제 후 재계산에 반영', () => {
  const edited = JSON.parse(JSON.stringify(sessions)) as SessionRecord[];
  edited[3].exercises[0].sets[0].weight = 110;
  let pts = dailyPoints(filterSets(flattenSessions(edited), { exerciseId: 'bench', intensity: 'high' }));
  assert.equal(pts[pts.length - 1].best, 110);
  edited.pop();
  pts = dailyPoints(filterSets(flattenSessions(edited), { exerciseId: 'bench' }));
  assert.equal(pts.length, 3);
});

console.log('5.6 성장 분석');
test('요약: 직전/최초 대비 변화량 kg와 %', () => {
  const s = summarize(flat, 'bench', 'weighted', { intensity: 'high' });
  assert.equal(s.allTimeBest?.best, 102.5);
  assert.deepEqual(s.vsPrevious, { kg: 2.5, pct: 2.5 });
  assert.deepEqual(s.vsFirst, { kg: 2.5, pct: 2.5 });
  assert.equal(s.bestByIntensity.high, 102.5);
  assert.equal(s.bestByIntensity.low, 60);
});
test('이전 값이 0/없음이면 백분율 계산 안 함', () => {
  assert.deepEqual(change(10, 0), { kg: 10, pct: null });
  assert.equal(change(10, null), null);
});
test('기간 필터와 기간 평균', () => {
  const range = rangeFor('7d', '2026-11-08');
  const s = summarize(flat, 'bench', 'weighted', { range });
  assert.equal(s.rangeBest, 102.5);
  assert.ok(s.rangeAvg != null && s.rangeAvg > 0);
});
test('동일 반복 횟수 중량 추이', () => {
  const t = sameRepsTrend(flat, 'bench', 8);
  // 11/05: 50kg×12, 60kg×10 모두 8회 이상 → 최고 60
  assert.deepEqual(t, [
    { date: '2026-11-03', weight: 80 },
    { date: '2026-11-05', weight: 60 },
    { date: '2026-11-08', weight: 85 },
  ]);
});
test('추정 1RM: Epley, 12회 초과·체중운동은 null', () => {
  assert.equal(estimate1RM(100, 5), 116.67);
  assert.equal(estimate1RM(100, 15), null);
  assert.equal(estimate1RM(100, 5, 'assisted'), null);
});
test('보조 운동(어시스트)은 낮을수록 좋은 기록', () => {
  const ss: SessionRecord[] = [
    { ...session('x', '2026-10-01', null, null, [set(40, 8)], 'pu', '어시스트 풀업') },
    { ...session('y', '2026-10-08', null, null, [set(35, 8)], 'pu', '어시스트 풀업') },
  ];
  ss.forEach((s) => (s.exercises[0].weightMode = 'assisted'));
  const sum = summarize(flattenSessions(ss), 'pu', 'assisted');
  assert.equal(sum.allTimeBest?.best, 35);
});
test('종목 이름 변경 후에도 exerciseId로 통합 (자유 운동 포함)', () => {
  const ss = [
    session('p', '2026-10-01', null, null, [set(70, 8)], 'bench', '벤치프레스'),
    session('q', '2026-10-02', null, null, [set(72.5, 8)], 'bench', '플랫 벤치(이름변경)'),
  ];
  const pts = dailyPoints(filterSets(flattenSessions(ss), { exerciseId: 'bench' }));
  assert.equal(pts.length, 2);
});
test('같은 날 같은 종목 여러 번도 모두 집계', () => {
  const ss = [
    session('m', '2026-10-01', null, null, [set(70, 8)]),
    session('n', '2026-10-01', null, null, [set(75, 5)]),
  ];
  const pts = dailyPoints(filterSets(flattenSessions(ss), { exerciseId: 'bench' }));
  assert.equal(pts.length, 1);
  assert.equal(pts[0].best, 75);
  assert.equal(pts[0].setCount, 2);
});

console.log('날짜 유틸');
test('기간/주 시작', () => {
  assert.deepEqual(rangeFor('30d', '2026-11-05'), { from: '2026-10-07', to: '2026-11-05' });
  assert.deepEqual(rangeFor('3m', '2026-05-31'), { from: '2026-02-28', to: '2026-05-31' });
  assert.deepEqual(rangeFor('all', '2026-11-05'), { from: null, to: null });
  assert.equal(weekStart('2026-11-05'), '2026-11-02'); // 목 → 월
  assert.equal(weekStart('2026-11-08'), '2026-11-02'); // 일 → 월
});

console.log('11 AI 루틴 가져오기 파서');
test('JSON', () => {
  const r = parseRoutine('```json\n{"version":1,"routines":[{"name":"월요일 머신","weekday":"월","intensity":"mid","exercises":[{"name":"렛풀다운","sets":4,"reps":"8-12","weight":45,"restSec":90},{"name":"시티드 로우"}]},{"name":"휴식","weekday":2,"rest":true,"exercises":[]}]}\n```');
  assert.equal(r.format, 'json');
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].weekday, 1);
  assert.equal(r.days[0].intensity, 'mid');
  assert.deepEqual(r.days[0].exercises[0], { name: '렛풀다운', sets: 4, reps: 8, repsMax: 12, weight: 45, intensity: null, restSec: 90 });
  assert.equal(r.days[0].exercises[1].sets, 3);
  assert.equal(r.days[1].isRest, true);
});
test('Markdown 표', () => {
  const md = `| 요일 | 운동 | 세트 | 반복 | 중량 | 강도 | 휴식 |
|---|---|---|---|---|---|---|
| 월 | 렛풀다운 | 3 | 10-12 | 40kg | 중간중량 | 90초 |
| | 시티드 로우 | 3 | 10 | | | 2분 |
| 수 | 벤치프레스 | 5 | 5 | 80 | 고중량 | 180s |`;
  const r = parseRoutine(md);
  assert.equal(r.format, 'table');
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].exercises.length, 2);
  assert.equal(r.days[0].exercises[0].repsMax, 12);
  assert.equal(r.days[0].exercises[0].intensity, 'mid');
  assert.equal(r.days[0].exercises[1].restSec, 120);
  assert.equal(r.days[1].exercises[0].weight, 80);
  assert.equal(r.days[1].exercises[0].intensity, 'high');
});
test('Markdown 목록 / 일반 텍스트', () => {
  const txt = `## 월요일 - 가슴/삼두
1. 벤치프레스 4x8 @ 60kg 휴식 120초
2. 인클라인 덤벨 프레스 3 x 10
- 케이블 푸시다운 3세트 12회

화요일: 휴식

수요일 (고중량)
- 데드리프트 5x3 100kg`;
  const r = parseRoutine(txt);
  assert.equal(r.days.length, 3);
  assert.equal(r.days[0].weekday, 1);
  assert.deepEqual(r.days[0].exercises.map((e) => e.name), ['벤치프레스', '인클라인 덤벨 프레스', '케이블 푸시다운']);
  assert.equal(r.days[0].exercises[0].sets, 4);
  assert.equal(r.days[0].exercises[0].weight, 60);
  assert.equal(r.days[0].exercises[0].restSec, 120);
  assert.equal(r.days[0].exercises[2].reps, 12);
  assert.equal(r.days[1].isRest, true);
  assert.equal(r.days[2].intensity, 'high');
  assert.equal(r.days[2].exercises[0].weight, 100);
});
test('영문 요일', () => {
  const r = parseRoutine('Monday\n- Bench Press 3x8 60kg\nWednesday\n- Squat 5x5');
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].weekday, 1);
  assert.equal(r.days[1].weekday, 3);
});
test('빈 입력 / 인식 불가 입력은 경고', () => {
  assert.equal(parseRoutine('').format, 'empty');
  assert.ok(parseRoutine('안녕하세요 오늘도 화이팅').warnings.length > 0);
});

console.log('신체 항목 (기본 + 직접 추가)');
test('저장값이 없거나 깨져도 기본 4개 항목으로 복구', () => {
  for (const raw of [null, '{broken', 123, []]) {
    const l = sanitizeMetrics(raw);
    assert.deepEqual(l.map((m) => m.key), ['weight', 'skeletal_muscle', 'body_fat_mass', 'body_fat_pct']);
    assert.ok(l.every((m) => !m.hidden));
  }
});
test('직접 항목 추가: 이름·단위 저장, 키는 x1부터, 이름 중복·빈 이름·초과는 거부', () => {
  const base = sanitizeMetrics(null);
  const a = addCustomMetric(base, { label: ' 허리둘레 ', unit: 'cm' });
  assert.equal(a.metric.key, 'x1');
  assert.equal(a.metric.label, '허리둘레');
  assert.equal(a.metric.unit, 'cm');
  assert.ok(!a.metric.builtin && /^#[0-9A-F]{6}$/.test(a.metric.color!));
  assert.throws(() => addCustomMetric(a.list, { label: '허리둘레', unit: 'cm' }));
  assert.throws(() => addCustomMetric(a.list, { label: '몸무게', unit: 'kg' }));
  assert.throws(() => addCustomMetric(a.list, { label: '  ', unit: '' }));
  let l = base;
  for (let i = 0; i < MAX_CUSTOM_METRICS; i++) l = addCustomMetric(l, { label: `항목${i}`, unit: '' }).list;
  assert.throws(() => addCustomMetric(l, { label: '하나더', unit: '' }));
});
test('저장했다 읽어도 숨김·직접 항목·색이 유지되고 잘못된 값은 버림', () => {
  const l0 = addCustomMetric(sanitizeMetrics(null), { label: '혈압', unit: 'mmHg' }).list;
  l0[0].hidden = true;
  const l1 = sanitizeMetrics(JSON.stringify(l0));
  assert.equal(l1[0].hidden, true);
  assert.equal(l1.at(-1)!.label, '혈압');
  assert.deepEqual(visibleMetrics(l1).map((m) => m.key), ['skeletal_muscle', 'body_fat_mass', 'body_fat_pct', 'x1']);
  const l2 = sanitizeMetrics(JSON.stringify([{ key: 'x9', label: '', unit: 'cm' }, { key: 'evil', label: 'a', unit: 'b' }, { key: 'x2', label: 'ok', unit: 'cm', color: 'red' }]));
  assert.deepEqual(l2.map((m) => m.key), [...BUILTIN_METRICS.map((m) => m.key), 'x2']);
  assert.equal(l2.at(-1)!.color, null);
});
test('직접 항목 값 저장 형식 검증: 날짜·숫자만', () => {
  const e = sanitizeExtra(JSON.stringify({ x1: { '2026-11-05': 80.5, '2026-13': 1, '2026-11-06': 'abc' }, weight: { '2026-11-05': 70 }, x2: 'zzz' }));
  assert.deepEqual(e, { x1: { '2026-11-05': 80.5 } });
  assert.deepEqual(sanitizeExtra(null), {});
});

console.log('1RM 분리 / 횟수별 보기');
const fs = (date: string, weight: number, reps: number, extra: Record<string, unknown> = {}) => ({
  date, sessionId: date, exerciseId: 'e1', exerciseName: '벤치', setNo: 1, weight, reps, done: true, setType: 'working' as const,
  weightMode: 'weighted' as const, intensity: 'none' as const, ...extra,
});
test('1RM 세트는 평소 통계에서 빠지고, 1RM 필터에서만 나온다', () => {
  const all = [fs('2026-11-01', 60, 8), fs('2026-11-02', 100, 1, { isRm: true }), fs('2026-11-03', 62.5, 8)];
  assert.deepEqual(filterSets(all, { exerciseId: 'e1' }).map((x) => x.weight), [60, 62.5]);
  assert.deepEqual(filterSets(all, { exerciseId: 'e1', onlyRm: true }).map((x) => x.weight), [100]);
  assert.equal(summarize(all, 'e1', 'weighted').allTimeBest!.best, 62.5);
  assert.deepEqual(dailyPoints(filterSets(all, { exerciseId: 'e1', onlyRm: true })).map((p) => p.best), [100]);
});
test('미완료 1RM 세트는 1RM 기록에도 들어가지 않는다', () => {
  const all = [fs('2026-11-02', 100, 1, { isRm: true, done: false })];
  assert.equal(filterSets(all, { exerciseId: 'e1', onlyRm: true }).length, 0);
});
test('횟수 선택지: 많이 한 횟수 순으로 고르고 작은 횟수부터 정렬, 기본값은 가장 많이 한 횟수', () => {
  const all = [
    fs('2026-11-01', 60, 8), fs('2026-11-02', 60, 8), fs('2026-11-03', 62, 8), fs('2026-11-03', 50, 12), fs('2026-11-04', 70, 5),
    fs('2026-11-04', 100, 1, { isRm: true }), fs('2026-11-04', 20, 15, { setType: 'warmup' }),
  ];
  const c = repChoices(all, 'e1');
  assert.deepEqual(c.options, [5, 8, 12]); // 1RM 세트의 1회·준비 세트의 15회는 포함하지 않음
  assert.equal(c.mostUsed, 8);
  assert.deepEqual(repChoices([], 'e1'), { options: [], mostUsed: null });
  assert.equal(repChoices(all, 'e1', 2).options.length, 2);
});
test('횟수별 추이: 그 횟수 이상 한 날의 최고 중량 (1RM 세트 제외)', () => {
  const all = [fs('2026-11-01', 60, 8), fs('2026-11-02', 70, 5), fs('2026-11-02', 100, 8, { isRm: true }), fs('2026-11-03', 65, 10)];
  assert.deepEqual(sameRepsTrend(all, 'e1', 8, 'weighted'), [{ date: '2026-11-01', weight: 60 }, { date: '2026-11-03', weight: 65 }]);
});

console.log('끌어서 순서 바꾸기 / 휴식 시간');
test('moveItem: 앞으로·뒤로 옮기기, 범위를 벗어나면 가장자리, 원본은 그대로', () => {
  const a = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(a, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(a, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(a, 1, 1), a);
  assert.deepEqual(moveItem(a, 1, 99), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveItem(a, 2, -5), ['c', 'a', 'b', 'd']);
  assert.deepEqual(moveItem(a, 9, 0), a);
  assert.deepEqual(a, ['a', 'b', 'c', 'd']);
});
test('targetIndex: 같은 높이 — 절반쯤 겹치면 자리가 바뀜', () => {
  const h = [100, 100, 100, 100];
  assert.equal(targetIndex(h, 1, 0), 1);
  assert.equal(targetIndex(h, 1, 40), 1); // 아직 절반 못 넘음
  assert.equal(targetIndex(h, 1, 60), 2);
  assert.equal(targetIndex(h, 1, 140), 2);
  assert.equal(targetIndex(h, 1, 170), 3);
  assert.equal(targetIndex(h, 1, 999), 3); // 아래로 아무리 끌어도 맨 끝
  assert.equal(targetIndex(h, 2, -40), 2);
  assert.equal(targetIndex(h, 2, -60), 1);
  assert.equal(targetIndex(h, 2, -999), 0);
  assert.equal(targetIndex(h, 0, -30), 0);
  assert.equal(targetIndex(h, 3, 30), 3);
});
test('targetIndex: 높이가 다른 항목들, 잘못된 from은 그대로', () => {
  const h = [60, 200, 80]; // 중심선: 30, 160, 300
  assert.equal(targetIndex(h, 0, 90), 0); // 아래 가장자리 150 < 160
  assert.equal(targetIndex(h, 0, 110), 1);
  assert.equal(targetIndex(h, 0, 230), 1);
  assert.equal(targetIndex(h, 0, 250), 2);
  assert.equal(targetIndex(h, 2, -90), 2); // 위 가장자리 170 > 160
  assert.equal(targetIndex(h, 2, -120), 1);
  assert.equal(targetIndex(h, 2, -250), 0);
  assert.equal(targetIndex(h, 5, 10), 5);
  assert.equal(targetIndex([], 0, 10), 0);
});
test('clampDrag: 목록 위·아래 끝을 넘지 않음', () => {
  const h = [100, 100, 100];
  assert.equal(clampDrag(h, 1, -500), -100);
  assert.equal(clampDrag(h, 1, 500), 100);
  assert.equal(clampDrag(h, 1, 30), 30);
  assert.equal(clampDrag(h, 0, -50), 0);
});
test('휴식 시간: 종목 값 우선, 없으면 기본값, 0 이하는 끔, 상한 10분', () => {
  assert.equal(restFor(120, 90), 120);
  assert.equal(restFor(null, 90), 90);
  assert.equal(restFor(0, 90), 90);
  assert.equal(restFor(undefined, 0), 0);
  assert.equal(restFor(60, 0), 60); // 기본이 꺼져 있어도 종목에 정해 둔 값은 사용
  assert.equal(restFor(9999, 90), 600);
  assert.equal(restFor(-5, -5), 0);
});

console.log('테마 / 그래프 색상');
test('저장값이 없거나 깨져도 기본 색으로 복구', () => {
  assert.deepEqual(sanitizeGraphColors(null), DEFAULT_GRAPH_COLORS);
  assert.deepEqual(sanitizeGraphColors('{not json'), DEFAULT_GRAPH_COLORS);
});
test('유효한 #RRGGBB만 반영하고 나머지 키는 기본값 유지', () => {
  const c = sanitizeGraphColors(JSON.stringify({ weight: '#8e24aa', skeletal_muscle: 'red', high: '#000000' }));
  assert.equal(c.weight, '#8E24AA');
  assert.equal(c.skeletal_muscle, DEFAULT_GRAPH_COLORS.skeletal_muscle);
  assert.equal(Object.keys(c).length, GRAPH_KEYS.length);
  assert.ok(!('high' in c), '강도별 그래프 색상은 더 이상 없음');
});
test('화면 모드: light만 라이트, 그 외는 다크(기본)', () => {
  assert.equal(sanitizeMode('light'), 'light');
  assert.equal(sanitizeMode('dark'), 'dark');
  assert.equal(sanitizeMode(null), 'dark');
});

console.log('루틴(사이클) 모델');
const R = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', name: '테스트', mode: 'cycle', startDate: '2026-11-01',
  days: [
    { id: 'a', name: 'A', kind: 'weights', templateId: 't1', weekday: 1 },
    { id: 'b', name: 'B', kind: 'weights', templateId: 't2', weekday: 3 },
    { id: 'c', name: '휴식', kind: 'rest', templateId: null, weekday: null },
  ],
  ...over,
});
test('사이클 순환: 시작일 기준으로 N일마다 반복, 시작일 이전 날짜도 정상', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-05'), 4);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => cycleIndex('2026-11-01', `2026-11-0${i + 1}`, 3)), [0, 1, 2, 0, 1, 2, 0]);
  assert.equal(cycleIndex('2026-11-05', '2026-11-04', 3), 2); // 하루 전 = 마지막 칸
  assert.equal(cycleIndex('2026-11-05', '2026-10-31', 4), 3); // 월을 넘겨도 정상
});
test('오늘이 N일차가 되도록 시작일 계산', () => {
  const start = startForDayNumber('2026-11-05', 3, 4);
  assert.equal(start, '2026-11-03');
  const r = R({ startDate: start });
  assert.equal(cycleDayNumber(r, '2026-11-05'), 3);
  assert.equal(cycleDayNumber(r, '2026-11-06'), 1); // 3일 사이클이라 4일차 없음 → 1일차
  assert.equal(cycleDayNumber(R({ days: [] }), '2026-11-05'), 1);
});
test('dayForDate: 사이클은 순환, 요일 지정은 같은 요일의 날(없으면 휴식=null), 날이 없으면 null', () => {
  const c = R();
  assert.deepEqual([1, 2, 3, 4].map((d) => dayForDate(c, `2026-11-0${d}`).day!.name), ['A', 'B', '휴식', 'A']);
  assert.equal(dayForDate(c, '2026-11-02').cycleDay, 2);
  assert.equal(dayForDate(c, '2026-11-02').cycleLength, 3);
  const w = R({ mode: 'weekday' });
  assert.equal(dayForDate(w, '2026-11-02').day!.name, 'A'); // 11/02 = 월
  assert.equal(dayForDate(w, '2026-11-04').day!.name, 'B'); // 수
  assert.equal(dayForDate(w, '2026-11-03').day, null); // 화: 지정 없음
  assert.equal(dayForDate(R({ days: [] }), '2026-11-03').day, null);
});
test('저장값이 깨져도 안전한 빈 상태로 복구, 잘못된 필드는 기본값', () => {
  assert.deepEqual(sanitizeRoutines(null, '2026-11-05'), { activeId: null, routines: [] });
  assert.deepEqual(sanitizeRoutines('{bad', '2026-11-05'), { activeId: null, routines: [] });
  const st = sanitizeRoutines({
    activeId: 'missing',
    routines: [
      { id: 'r', name: ' ', mode: 'zzz', startDate: 'x', days: [{ id: 'd1', name: 'x', kind: 'weights', templateId: 7, weekday: 9 }, { id: 'd2', kind: 'nope' }, null, { name: 'no id' }] },
      { name: 'id 없음' },
    ],
  }, '2026-11-05');
  assert.equal(st.routines.length, 1);
  assert.equal(st.activeId, null); // 없는 루틴을 가리키면 해제
  const r = st.routines[0];
  assert.deepEqual([r.name, r.mode, r.startDate], ['루틴', 'cycle', '2026-11-05']);
  assert.deepEqual(r.days.map((d) => [d.kind, d.templateId, d.weekday]), [['weights', null, null], ['rest', null, null]]);
  assert.equal(sanitizeRoutines({ activeId: 'r', routines: [{ id: 'r', days: [] }] }, '2026-11-05').activeId, 'r');
});
test('길이 제한: 한 루틴의 날은 최대 28개', () => {
  const days = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, name: 'x', kind: 'rest' }));
  assert.equal(sanitizeRoutines({ routines: [{ id: 'r', days }] }, '2026-11-05').routines[0].days.length, MAX_DAYS);
});
test('루틴대로 하기: 놓친 날만큼 시작일이 밀려 오늘이 그 칸이 됨', () => {
  const start2 = shiftStartForMissed('2026-11-01', '2026-11-03', '2026-11-05');
  assert.equal(cycleIndex(start2, '2026-11-05', 3), cycleIndex('2026-11-01', '2026-11-03', 3));
});
test('방식 추정: 운동일이 모두 요일을 가지면 요일 지정, 아니면 N일 반복', () => {
  assert.equal(inferMode([{ weekday: 1, isRest: false }, { weekday: null, isRest: true }]), 'weekday');
  assert.equal(inferMode([{ weekday: 1, isRest: false }, { weekday: null, isRest: false }]), 'cycle');
  assert.equal(inferMode([]), 'cycle');
});
test('AI 프롬프트: 사용자 입력 자리는 맨 아래 구분선 밑 (중간에 입력칸 없음)', () => {
  assert.ok(AI_IMPORT_PROMPT.trimEnd().endsWith(AI_PROMPT_DIVIDER));
  assert.equal(AI_IMPORT_PROMPT.split(AI_PROMPT_DIVIDER).length, 2);
  assert.ok(!AI_IMPORT_PROMPT.includes('[내 조건]'));
  assert.ok(AI_IMPORT_PROMPT.indexOf('JSON Schema') < AI_IMPORT_PROMPT.indexOf(AI_PROMPT_DIVIDER));
});

console.log('시간 표시 / 세트 입력 시작값');
test('경과 시간·총 시간 표시', () => {
  assert.equal(fmtElapsed(65), '01:05');
  assert.equal(fmtElapsed(3725), '1:02:05');
  assert.equal(fmtDuration(2520), '42분');
  assert.equal(fmtDuration(3900), '1시간 5분');
  assert.equal(fmtDuration(null), '');
});
test('다음 세트는 앞 세트 값에서 시작, 첫 세트는 지난 기록, 준비/본 세트는 서로 섞이지 않음', () => {
  const sets = [
    { set_type: 'warmup', weight: 20 }, { set_type: 'working', weight: null }, { set_type: 'working', weight: 45 }, { set_type: 'working', weight: null },
  ];
  const w = (i: number, last: number | null) => suggestFor(sets, i, (x) => x.weight, last);
  assert.equal(w(1, 40), 40); // 첫 본 세트: 준비 세트(20)가 아니라 지난 기록
  assert.equal(w(1, null), null); // 지난 기록 없음 → 빈 칸
  assert.equal(w(3, 40), 45); // 앞 세트를 45로 바꿨다면 거기서 시작
  assert.equal(w(0, 40), null); // 첫 준비 세트는 제안 없음
});

// ---- 실시간 횟수 세기 (운동 종류 자동) ----
function lmFrame(pts: Record<number, [number, number, number]>): Float32Array {
  const a = new Float32Array(99);
  for (const k of Object.keys(pts)) { const i = Number(k); a[i * 3] = pts[i][0]; a[i * 3 + 1] = pts[i][1]; a[i * 3 + 2] = pts[i][2]; }
  return a;
}
const wave = (n: number, perRep: number, lo: number, hi: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (1 + Math.cos((2 * Math.PI * (i + offset)) / perRep))) / 2);
/** 관절별 각도 배열을 15fps로 흘려 넣고 센 횟수를 돌려준다 */
function runAuto(c: AutoRepCounter, series: Partial<Record<'elbow' | 'knee' | 'hip' | 'shoulder', (number | null)[]>>, fps = 15) {
  const n = Math.max(...Object.values(series).map((s) => s!.length));
  for (let i = 0; i < n; i++) {
    c.pushAngles({
      elbow: series.elbow?.[i] ?? null, knee: series.knee?.[i] ?? null, hip: series.hip?.[i] ?? null, shoulder: series.shoulder?.[i] ?? null,
    }, (i * 1000) / fps);
  }
}

test('자동: 스쿼트처럼 무릎·고관절이 같이 움직여도 5회', () => {
  const c = new AutoRepCounter();
  runAuto(c, { knee: wave(151, 30, 80, 175), hip: wave(151, 30, 70, 172) });
  assert.equal(c.count, 5);
  assert.ok(['무릎', '고관절'].includes(c.jointLabel!));
  assert.ok(c.avgRepMs! > 1000 && c.avgRepMs! < 2200);
});
test('운동 종류를 고르면 그 동작만 센다 (하체 선택 시 팔 움직임 무시)', () => {
  const c = new AutoRepCounter(); c.setFocus('leg');
  runAuto(c, { elbow: wave(151, 30, 45, 160) });
  assert.equal(c.count, 0);
  const d = new AutoRepCounter(); d.setFocus('arm');
  runAuto(d, { elbow: wave(151, 30, 45, 160) });
  assert.equal(d.count, 5);
});
test('기본 종목: 20개 이상, 부위별, 이름으로 동작 매칭', () => {
  assert.ok(CATALOG.length >= 20);
  assert.equal(new Set(CATALOG.map((c) => c.name)).size, CATALOG.length);
  assert.ok(CATALOG.every((c) => c.equip === '바벨' || c.equip === '덤벨'));
  assert.equal(matchProfile('사레레')?.name, '덤벨 사이드 레터럴 레이즈');
  assert.equal(matchProfile('인클라인 덤벨 프레스')?.name, '인클라인 덤벨 프레스');
  assert.equal(matchProfile('벤치프레스')?.focus, 'arm');
  assert.equal(matchProfile('스쿼트')?.focus, 'leg');
  assert.equal(matchProfile('루마니안 데드리프트')?.focus, 'hinge');
  assert.equal(matchProfile('정체불명운동'), null);
  assert.equal(matchProfile('렛풀다운')?.equip, '케이블');
  assert.equal(matchProfile('케이블 컬')?.name, '케이블 컬');
  assert.equal(matchProfile('핵스쿼트')?.name, '핵 스쿼트');
  assert.equal(partOf('행잉 레그 레이즈'), '복근');
  assert.equal(partOf('내 맘대로 운동', '등'), '등');
  assert.equal(partOf('내 맘대로 운동'), '기타');
});
const gx = (id: string, ss: string | null, done: number, total: number): GEx => ({
  id, name: id, ss, sets: Array.from({ length: total }, (_, i) => ({ id: `${id}${i}`, done: i < done ? 1 : 0, set_type: 'working' })),
});
test('한 종목씩: 지금 종목·다음 종목·진행 번호', () => {
  const exs = [gx('A', null, 3, 3), gx('B', null, 1, 3), gx('C', null, 0, 3)];
  const c = currentOf(exs)!;
  assert.equal(c.exId, 'B'); assert.equal(c.setId, 'B1'); assert.equal(c.index, 2); assert.equal(c.total, 3);
  assert.equal(c.next![0].id, 'C');
  assert.equal(currentOf([gx('A', null, 3, 3)]), null);
});
test('한 종목씩: 나중에 하기는 뒤로, 건너뜀은 끝난 것으로', () => {
  const exs = [gx('A', null, 0, 2), gx('B', null, 0, 2)];
  assert.equal(currentOf(exs, ['A'])!.exId, 'B');
  assert.equal(currentOf(exs, ['A'], ['B'])!.exId, 'A'); // B 건너뜀, A는 남은 유일한 것
  assert.equal(currentOf(exs, [], ['A', 'B']), null);
});
test('슈퍼세트: 번갈아 진행하고 한 바퀴 끝날 때만 휴식', () => {
  const exs = [gx('A', 's1', 0, 2), gx('B', 's1', 0, 2), gx('C', null, 0, 2)];
  assert.equal(blocksOf(exs).length, 2);
  assert.equal(currentOf(exs)!.exId, 'A');
  const a1 = [gx('A', 's1', 1, 2), gx('B', 's1', 0, 2), gx('C', null, 0, 2)];
  assert.equal(currentOf(a1)!.exId, 'B');
  assert.equal(restAfter(a1, 'A'), 'none');
  const b1 = [gx('A', 's1', 1, 2), gx('B', 's1', 1, 2), gx('C', null, 0, 2)];
  assert.equal(currentOf(b1)!.exId, 'A');
  assert.equal(restAfter(b1, 'B'), 'set');
  const end = [gx('A', 's1', 2, 2), gx('B', 's1', 2, 2), gx('C', null, 0, 2)];
  assert.equal(restAfter(end, 'B'), 'exercise');
  assert.equal(currentOf(end)!.exId, 'C');
});
test('휴식 종류: 단일 종목 세트 간 / 마지막 세트 후 종목 간 / 전부 끝나면 없음', () => {
  assert.equal(restAfter([gx('A', null, 1, 3), gx('B', null, 0, 2)], 'A'), 'set');
  assert.equal(restAfter([gx('A', null, 3, 3), gx('B', null, 0, 2)], 'A'), 'exercise');
  assert.equal(restAfter([gx('A', null, 3, 3), gx('B', null, 2, 2)], 'B'), 'none');
  assert.equal(restAfter([gx('A', 's', 1, 2), gx('B', 's', 1, 1)], 'B'), 'set'); // B 끝, A 남음, 세트 수가 달라도 남은 종목끼리 같은 바퀴
});
test('횟수 손으로 고치기: +1/−1, 0 아래로는 안 내려감', () => {
  const c = new AutoRepCounter();
  runAuto(c, { elbow: wave(76, 30, 45, 160) });
  const n = c.count;
  c.adjust(1); assert.equal(c.count, n + 1);
  c.adjust(-3); assert.equal(c.count, Math.max(0, n - 2));
  c.adjust(-100); assert.equal(c.count, 0);
});
test('운동 통계: 볼륨·e1RM·추천·원판·예상 시간', () => {
  const sets = [
    { weight: 50, reps: 10, done: 1, set_type: 'working' }, { weight: 60, reps: 5, done: 1, set_type: 'working' },
    { weight: 20, reps: 10, done: 1, set_type: 'warmup' }, { weight: 80, reps: 5, done: 0, set_type: 'working' },
  ];
  assert.equal(volumeOf(sets), 800);
  assert.equal(bestE1rm(sets), 70);
});
test('운동 통계 2', () => {
  assert.equal(bestE1rm([{ weight: 60, reps: 5, done: 1, set_type: 'working' }, { weight: 50, reps: 10, done: 1, set_type: 'working' }]), 70);
  assert.deepEqual(recommendNext({ weight: 50, reps: 10 }, 2.5), { weight: 50, reps: 11 });
  assert.deepEqual(recommendNext({ weight: 50, reps: 12 }, 2.5), { weight: 52.5, reps: 8 });
  assert.equal(recommendNext(null, 2.5), null);
  assert.equal(barbellTotal(20, [20, 10, 2.5]), 85);
  assert.equal(estimateMinutes([{ sets: 3, restSec: 80 }, { sets: 4, restSec: 140 }]), 18);
});
test('주 연속 기록·월 주차 체크·부위별 합계', () => {
  const today = '2026-11-07'; // 토요일, 이번 주 월요일은 11-02
  assert.equal(streakWeeks(['2026-11-03', '2026-10-28', '2026-10-21'], today), 3);
  assert.equal(streakWeeks(['2026-10-28', '2026-10-21'], today), 2); // 이번 주 아직 없음 → 지난주부터
  assert.equal(streakWeeks(['2026-10-14'], today), 0);
  const w = monthWeeks(['2026-11-03', '2026-11-05'], today);
  assert.equal(w.length, 6); assert.equal(w[0].count, 0); assert.equal(w[1].count, 2); assert.ok(w[1].current);
  assert.equal(monthDays(['2026-11-03', '2026-11-03', '2026-10-30'], today), 1);
  const flat = [
    { date: '2026-11-03', done: true, setType: 'working', weight: 50, reps: 10, n: '벤치프레스' },
    { date: '2026-11-03', done: true, setType: 'working', weight: 50, reps: 10, n: '벤치프레스' },
    { date: '2026-11-03', done: true, setType: 'warmup', weight: 20, reps: 10, n: '벤치프레스' },
    { date: '2026-11-04', done: true, setType: 'working', weight: 100, reps: 5, n: '스쿼트' },
  ];
  const t = partTotals(flat, '2026-11-02', '2026-11-08', (s) => partOf(s.n));
  assert.deepEqual(t.map((x) => [x.part, x.sets, x.volume]), [['가슴', 2, 1000], ['하체', 1, 500]]);
});
test('자동: 컬처럼 팔꿈치만 움직여도 5회 (운동 종류를 알려 주지 않음)', () => {
  const c = new AutoRepCounter();
  runAuto(c, { elbow: wave(121, 24, 45, 160), knee: Array(121).fill(172), hip: Array(121).fill(170) });
  assert.equal(c.count, 5);
  assert.equal(c.jointLabel, '팔꿈치');
});
test('자동: 가만히 서 있거나 작게 흔들리면 0회', () => {
  const c = new AutoRepCounter();
  runAuto(c, { knee: Array.from({ length: 200 }, (_, i) => 170 + Math.sin(i) * 4), elbow: wave(200, 20, 150, 170) });
  assert.equal(c.count, 0);
  assert.equal(c.jointLabel, null);
});
test('자동: 움직임이 작은 반복(진폭 약 30도)은 보통에서 0회, 쉬움에서는 센다', () => {
  const small = { elbow: wave(150, 20, 118, 150) };
  const a = new AutoRepCounter(); runAuto(a, small);
  assert.equal(a.count, 0);
  const b = new AutoRepCounter(); b.setStrictness('easy'); runAuto(b, small);
  assert.ok(b.count >= 6, `count ${b.count}`);
});
test('자동: 쉬었다가 시작하고, 중간에 잠깐 안 보여도 이어서 센다', () => {
  const c = new AutoRepCounter();
  const rest = Array(40).fill(170);
  const mv = wave(60, 20, 50, 165);
  const gap = Array(8).fill(null);
  runAuto(c, { elbow: [...rest, ...mv, ...gap, ...wave(60, 20, 50, 165, 0)] });
  assert.ok(c.count >= 5 && c.count <= 7, `count ${c.count}`);
});
test('자동: 세트가 끝나고 가만히 있어도 횟수가 늘지 않는다', () => {
  const c = new AutoRepCounter();
  runAuto(c, { knee: [...wave(91, 30, 80, 175), ...Array(300).fill(172)] });
  assert.equal(c.count, 3);
});
test('자동: 1회가 완성되는 프레임에서만 이벤트를 준다', () => {
  const c = new AutoRepCounter();
  let evs = 0;
  const s = wave(121, 24, 45, 160);
  s.forEach((a, i) => { if (c.pushAngles({ elbow: a }, (i * 1000) / 15)) evs++; });
  assert.equal(evs, c.count);
});
test('자동: 관절 각도는 더 잘 보이는 쪽을 쓰고 화면 비율을 반영', () => {
  const knee = JOINTS.find((j) => j.id === 'knee')!;
  const f = lmFrame({ 24: [0.5, 0.2, 0.9], 26: [0.5, 0.5, 0.9], 28: [0.8, 0.5, 0.9], 23: [0.1, 0.1, 0.1], 25: [0.1, 0.2, 0.1], 27: [0.1, 0.3, 0.1] });
  assert.ok(Math.abs(jointAngle(f, knee, 1, 1)! - 90) < 1e-6);
  assert.equal(jointAngle(new Float32Array(99), knee, 1, 1), null);
  const g = lmFrame({ 24: [0.2, 0.0, 0.9], 26: [0.5, 0.5, 0.9], 28: [0.8, 0.5, 0.9] });
  assert.ok(Math.abs(jointAngle(g, knee, 1, 1)! - jointAngle(g, knee, 1000, 500)!) > 1);
});

/** 서 있는 사람 한 프레임: 어깨(0.4/0.6, sy), 팔 길이만큼 아래의 손목. showHip=false면 골반 안 보임 */
function standing(opts: { sy?: number; wristDy?: number; wristDx?: number; hip?: boolean }): Float32Array {
  const sy = opts.sy ?? 0.3;
  const pts: Record<number, [number, number, number]> = {
    0: [0.5, sy - 0.1, 0.9], 11: [0.6, sy, 0.9], 12: [0.4, sy, 0.9],
    15: [0.6 + (opts.wristDx ?? 0), sy + (opts.wristDy ?? 0.4), 0.9], 16: [0.4 - (opts.wristDx ?? 0), sy + (opts.wristDy ?? 0.4), 0.9],
    13: [0.6, sy + 0.2, 0.9], 14: [0.4, sy + 0.2, 0.9],
  };
  if (opts.hip !== false) { pts[23] = [0.58, sy + 0.4, 0.9]; pts[24] = [0.42, sy + 0.4, 0.9]; }
  return lmFrame(pts);
}
function runFrames(c: AutoRepCounter, frames: Float32Array[], fps = 15) {
  frames.forEach((f, i) => c.push(f, 1000, 1000, (i * 1000) / fps));
}

test('자동(위치): 사이드 레터럴 레이즈 — 팔꿈치는 펴진 채, 골반이 안 보여도 손목 움직임으로 5회', () => {
  const c = new AutoRepCounter();
  const dys = wave(121, 24, -0.05, 0.4); // 손목이 어깨 아래 0.4 ↔ 어깨 높이 근처
  runFrames(c, dys.map((d) => standing({ wristDy: d, wristDx: 0.2 + (0.4 - d) * 0.5, hip: false })));
  assert.equal(c.count, 5);
  assert.ok(c.jointLabel!.includes('손목'), String(c.jointLabel));
});
test('자동(위치): 어깨만 보여도 몸이 위아래로 오르내리면(정면 스쿼트) 센다', () => {
  const c = new AutoRepCounter();
  runFrames(c, wave(151, 30, 0.3, 0.55).map((sy) => standing({ sy, hip: false, wristDy: 0.4 })));
  assert.equal(c.count, 5);
  assert.ok(c.jointLabel!.includes('몸'), String(c.jointLabel));
});
test('자동(위치): 가만히 서 있거나 숨만 쉬면 0회', () => {
  const c = new AutoRepCounter();
  runFrames(c, Array.from({ length: 200 }, (_, i) => standing({ sy: 0.3 + Math.sin(i / 3) * 0.004, wristDy: 0.4 + Math.sin(i / 2) * 0.005 })));
  assert.equal(c.count, 0);
});
test('자동: 한 동작을 여러 신호가 중복해서 세지 않는다 (같은 레이즈를 두 팔이 해도 5회)', () => {
  const c = new AutoRepCounter();
  runFrames(c, wave(121, 24, -0.05, 0.4).map((d) => standing({ wristDy: d })));
  assert.equal(c.count, 5);
});
test('자동: 동작이 바뀌면(4초 이상 쉰 뒤) 이어서 쌓인다', () => {
  const c = new AutoRepCounter();
  const first = wave(61, 24, -0.05, 0.4).map((d) => standing({ wristDy: d })); // 약 2~3회
  const rest = Array.from({ length: 80 }, () => standing({ wristDy: 0.4 }));
  const second = wave(61, 24, 0.3, 0.55).map((sy) => standing({ sy, hip: false, wristDy: 0.4 }));
  runFrames(c, [...first, ...rest, ...second]);
  assert.ok(c.count >= 4, `count ${c.count}`);
});
test('횟수를 소리로 읽는 말', () => {
  assert.equal(countWord(1), '하나');
  assert.equal(countWord(2), '둘');
  assert.equal(countWord(10), '열');
  assert.equal(countWord(11), '열하나');
  assert.equal(countWord(20), '스물');
  assert.equal(countWord(37), '서른일곱');
  assert.equal(countWord(100), '100');
  assert.equal(countWord(0), '');
});

test('세트 자동 진행: 목표 횟수 → 쉬는 시간 → 다음 세트 → … → 종료', () => {
  const f = new SetFlow({ targetReps: 10, totalSets: 3, restSec: 60 });
  assert.equal(f.onCount(9, 0), null);
  const e1 = f.onCount(10, 1000);
  assert.deepEqual(e1, { kind: 'setDone', setNo: 1, count: 10, last: false });
  assert.equal(f.phase, 'resting');
  assert.equal(f.onCount(11, 1500), null); // 쉬는 중에는 세지 않음
  assert.equal(f.secLeft(1000), 60);
  assert.equal(f.tick(30000), null);
  assert.deepEqual(f.tick(58500), { kind: 'restTick', secLeft: 3 }); // 61000-58500 = 2.5초 → 3
  assert.equal(f.tick(58600), null); // 같은 초는 한 번만
  assert.deepEqual(f.tick(59600), { kind: 'restTick', secLeft: 2 });
  assert.deepEqual(f.tick(61000), { kind: 'start', setNo: 2 });
  assert.equal(f.phase, 'counting');
  f.onCount(10, 70000);
  assert.deepEqual(f.skipRest(), { kind: 'start', setNo: 3 });
  const last = f.onCount(12, 90000);
  assert.deepEqual(last, { kind: 'setDone', setNo: 3, count: 12, last: true });
  assert.equal(f.phase, 'done');
  assert.deepEqual(f.counts, [10, 10, 12]);
  assert.equal(f.tick(999999), null);
});
test('세트 자동 진행: 중간에 끝내면 센 만큼만 돌려준다', () => {
  const f = new SetFlow({ targetReps: 10, totalSets: 3, restSec: 30 });
  f.onCount(10, 0);
  f.tick(31000);
  assert.deepEqual(f.finish(6), [10, 6]);
  const g = new SetFlow({ targetReps: 5, totalSets: 2, restSec: 10 });
  assert.deepEqual(g.finish(0), []);
});

test('세트 자동 진행: 준비 시간이 있으면 첫 세트 전과 쉬고 난 뒤에 준비(3·2·1) 후 시작', () => {
  const f = new SetFlow({ targetReps: 5, totalSets: 2, restSec: 10, prepSec: 10 });
  assert.deepEqual(f.beginPrep(0), { kind: 'prep', setNo: 1 });
  assert.equal(f.phase, 'preparing');
  assert.equal(f.onCount(5, 100), null); // 준비 중에는 세지 않음
  assert.equal(f.secLeft(0), 10);
  assert.equal(f.tick(5000), null);
  assert.deepEqual(f.tick(7500), { kind: 'prepTick', secLeft: 3 });
  assert.equal(f.tick(7600), null);
  assert.deepEqual(f.tick(10000), { kind: 'start', setNo: 1 });
  assert.equal(f.phase, 'counting');
  assert.deepEqual(f.onCount(5, 20000), { kind: 'setDone', setNo: 1, count: 5, last: false });
  assert.equal(f.tick(27500), null); // 준비가 있으면 쉬는 시간 끝의 카운트는 따로 알리지 않음
  assert.deepEqual(f.tick(30000), { kind: 'prep', setNo: 2 });
  assert.equal(f.phase, 'preparing');
  assert.deepEqual(f.skipPrep(), { kind: 'start', setNo: 2 });
  assert.deepEqual(f.onCount(6, 40000), { kind: 'setDone', setNo: 2, count: 6, last: true });
  assert.deepEqual(f.counts, [5, 6]);
});
test('세트 자동 진행: 준비 시간이 없으면 beginPrep은 아무것도 안 하고 쉬고 나면 바로 시작', () => {
  const f = new SetFlow({ targetReps: 5, totalSets: 2, restSec: 10 });
  assert.equal(f.beginPrep(0), null);
  assert.equal(f.phase, 'counting');
  f.onCount(5, 0);
  assert.deepEqual(f.tick(7500), { kind: 'restTick', secLeft: 3 });
  assert.deepEqual(f.skipRest(5000), { kind: 'start', setNo: 2 });
  const g = new SetFlow({ targetReps: 5, totalSets: 2, restSec: 10, prepSec: 5 });
  g.beginPrep(0);
  assert.deepEqual(g.finish(3), [3]); // 준비 중에 끝내면 센 게 없으면 빈 목록
  assert.deepEqual(new SetFlow({ targetReps: 5, totalSets: 2, restSec: 10, prepSec: 5 }).finish(0), []);
});

test('컨디션: 100%는 그대로, 75%는 무게 −10%·4세트 이상이면 1세트 감소, 50%는 무게 −20%·세트 2/3(최소 2)', () => {
  assert.deepEqual(adjustForCondition(4, 100, 100, 2.5), { sets: 4, weight: 100 });
  assert.deepEqual(adjustForCondition(4, 100, 75, 2.5), { sets: 3, weight: 90 });
  assert.deepEqual(adjustForCondition(3, 60, 75, 2.5), { sets: 3, weight: 55 }); // 54 → 55(2.5 단위)
  assert.deepEqual(adjustForCondition(3, 60, 50, 2.5), { sets: 2, weight: 47.5 }); // 48 → 47.5
  assert.deepEqual(adjustForCondition(5, 100, 50, 2.5), { sets: 3, weight: 80 });
  assert.deepEqual(adjustForCondition(1, 40, 50, 2.5), { sets: 1, weight: 32.5 }); // 32 → 32.5
  assert.deepEqual(adjustForCondition(3, null, 50, 2.5), { sets: 2, weight: null });
  assert.equal(adjustForCondition(3, 2.5, 50, 2.5).weight, 2.5); // 0kg가 되지 않음
  assert.equal(sanitizeRunMode('tempo'), 'tempo');
  assert.equal(sanitizeRunMode('camera'), 'camera');
  assert.equal(sanitizeRunMode('x'), 'manual');
  assert.equal(sanitizeRunMode(null), 'manual');
});

test('종목 목록: 부위별로 묶고 직접 추가한 종목은 각 부위 맨 위, 기본 종목과 중복 없음', () => {
  const rows = [
    { id: 'a', name: '내 가슴 운동', category: '가슴', weight_mode: 'weighted' },
    { id: 'b', name: '바벨 벤치프레스', category: '가슴', weight_mode: 'weighted' }, // 기본 종목으로 이미 만든 것
    { id: 'c', name: '이상한 운동', category: null, weight_mode: 'weighted' },
    { id: 'd', name: '벤치프레스', category: null, weight_mode: 'weighted' }, // 이름이 기본 종목 별칭과 맞음 → 가슴
    { id: 'e', name: '내 푸시업', category: null, weight_mode: 'bodyweight' },
  ];
  const g = buildPickGroups(rows, {});
  const chest = g.find((x) => x.part === '가슴')!;
  assert.deepEqual(chest.items.slice(0, 3).map((i) => i.name), ['내 가슴 운동', '내 푸시업', '벤치프레스']); // 직접 추가가 위(가나다순), 이름이 기본 종목과 맞으면 그 부위
  assert.equal(chest.items.filter((i) => i.name === '바벨 벤치프레스').length, 1);
  assert.equal(chest.items.find((i) => i.name === '바벨 벤치프레스')!.row!.id, 'b');
  assert.equal(chest.items.find((i) => i.name === '덤벨 벤치프레스')!.row, null);
  assert.equal(g[g.length - 1].part, '기타');
  assert.deepEqual(g[g.length - 1].items.map((i) => i.name), ['이상한 운동']);
  assert.deepEqual(g.map((x) => x.part).slice(0, 2), ['가슴', '등']);
  // 장비 필터: 직접 만든 체중 종목은 맨몸으로 잡힘
  const bw = buildPickGroups(rows, { equip: '맨몸' }).flatMap((x) => x.items.map((i) => i.name));
  assert.ok(bw.includes('내 푸시업') && bw.includes('푸시업') && !bw.includes('내 가슴 운동'));
  // 검색: 별칭도 맞고, 이미 만든 종목만 보기
  assert.ok(buildPickGroups(rows, { q: '사레레' }).flatMap((x) => x.items).some((i) => i.name === '덤벨 사이드 레터럴 레이즈'));
  const made = buildPickGroups(rows, { includeCatalog: false }).flatMap((x) => x.items.map((i) => i.name));
  assert.deepEqual(made.sort(), ['내 가슴 운동', '내 푸시업', '바벨 벤치프레스', '벤치프레스', '이상한 운동']);
  assert.equal(equipOf('이상한 운동'), null);
  assert.equal(equipOf('덤벨 컬'), '덤벨');
});
test('부위: 내가 지정한 부위가 기본 종목 부위보다 우선', () => {
  assert.equal(partOf('벤치프레스', '어깨'), '어깨');
  assert.equal(partOf('벤치프레스'), '가슴');
  assert.equal(partOf('벤치프레스', '이상한값'), '가슴');
});

test('홈 카드: 부위별 세트 요약·마지막으로 한 날·이번 주 7일', () => {
  assert.deepEqual(
    partSummary([
      { name: '바벨 벤치프레스', target_sets: 4 }, { name: '덤벨 컬', target_sets: 3 }, { name: '인클라인 덤벨 프레스', target_sets: 3 },
      { name: '내 운동', category: '어깨', target_sets: 2 }, { name: '이상한 운동', target_sets: 1 },
    ]),
    [{ part: '가슴', sets: 7 }, { part: '팔', sets: 3 }, { part: '어깨', sets: 2 }, { part: '기타', sets: 1 }],
  );
  assert.equal(fmtDaysAgo(null, '2026-11-07'), '아직 안 함');
  assert.equal(fmtDaysAgo('2026-11-07', '2026-11-07'), '오늘');
  assert.equal(fmtDaysAgo('2026-11-06', '2026-11-07'), '어제');
  assert.equal(fmtDaysAgo('2026-10-28', '2026-11-07'), '10일 전');
  assert.deepEqual(weekDays('2026-11-07'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(weekDays('2026-11-02')[0], '2026-11-02');
  assert.equal(weekDays('2026-11-08')[6], '2026-11-08');
});
test('홈 카드: 오늘 변경은 오늘 날짜일 때만 유효, 보관 목록은 깨진 값도 안전', () => {
  assert.equal(decodeOverride(encodeOverride('2026-11-07', 'tpl_1'), '2026-11-07'), 'tpl_1');
  assert.equal(decodeOverride(encodeOverride('2026-11-07', 'tpl_1'), '2026-11-08'), null);
  assert.equal(decodeOverride(encodeOverride('2026-11-07', null), '2026-11-07'), null);
  assert.equal(decodeOverride(null, '2026-11-07'), null);
  assert.deepEqual(parseIds('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseIds('깨진'), []);
  assert.deepEqual(parseIds(null), []);
  assert.deepEqual(parseIds('{"a":1}'), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
