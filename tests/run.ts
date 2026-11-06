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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
