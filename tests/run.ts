import assert from 'node:assert/strict';
import { flattenSessions, resolveIntensity } from '../src/domain/intensity.ts';
import {
  change, dailyPoints, estimate1RM, filterSets, rangeFor, sameRepsTrend, seriesByIntensity, summarize, weekStart,
} from '../src/domain/stats.ts';
import { parseRoutine } from '../src/domain/parser.ts';
import { parseInBodyText } from '../src/domain/inbody.ts';
import {
  cycleIndex, dayNumberOf, daysBetween, resizeSlots, sanitizePlan, shiftStartForMissed, startForDayNumber, MAX_CYCLE,
} from '../src/domain/cycle.ts';
import { fmtDuration, fmtElapsed, suggestFor } from '../src/domain/format.ts';
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

console.log('12 인바디 OCR 텍스트 해석');
test('한글 인바디 결과지 텍스트', () => {
  const t = `InBody 결과지\n체수분 (L) 40.1\n체중 (kg) 72.4\n골격근량 (kg) 33.1\n체지방량 (kg) 12.3\n체지방률 (%) 17.0`;
  assert.deepEqual(parseInBodyText(t), { weight: 72.4, skeletal_muscle: 33.1, body_fat_mass: 12.3, body_fat_pct: 17 });
});
test('숫자가 다음 줄에 있어도 인식, 못 찾은 항목은 null', () => {
  const t = `체중\n70.5\n골격근량\n32.0`;
  assert.deepEqual(parseInBodyText(t), { weight: 70.5, skeletal_muscle: 32, body_fat_mass: null, body_fat_pct: null });
});
test('범위를 벗어난 값은 버림', () => {
  assert.equal(parseInBodyText('체중 999').weight, null);
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

console.log('루틴 일정 (요일별 / N일 주기)');
test('주기 순환: 시작일 기준으로 N일마다 반복, 시작일 이전 날짜도 정상', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-05'), 4);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => cycleIndex('2026-11-01', `2026-11-0${i + 1}`, 3)), [0, 1, 2, 0, 1, 2, 0]);
  assert.equal(cycleIndex('2026-11-05', '2026-11-04', 3), 2); // 하루 전 = 마지막 칸
  assert.equal(cycleIndex('2026-11-05', '2026-10-31', 4), 3); // 월을 넘겨도 정상
});
test('오늘이 N일차가 되도록 시작일 계산', () => {
  const start = startForDayNumber('2026-11-05', 3, 4);
  assert.equal(start, '2026-11-03');
  const plan = sanitizePlan({ mode: 'cycle', startDate: start, slots: resizeSlots([], 4) }, '2026-11-05');
  assert.equal(dayNumberOf(plan, '2026-11-05'), 3);
  assert.equal(dayNumberOf(plan, '2026-11-06'), 4);
  assert.equal(dayNumberOf(plan, '2026-11-07'), 1);
});
test('주기 길이 변경: 늘리면 휴식 칸 추가, 줄이면 뒤쪽이 잘림, 1~28 범위', () => {
  const a = resizeSlots([{ kind: 'weights', templateId: 't1', label: 'A' }], 3);
  assert.deepEqual(a.map((x) => x.kind), ['weights', 'rest', 'rest']);
  assert.equal(resizeSlots(a, 1).length, 1);
  assert.equal(resizeSlots(a, 0).length, 1);
  assert.equal(resizeSlots(a, 99).length, MAX_CYCLE);
});
test('저장값이 깨져도 안전한 기본 계획(요일별)으로 복구', () => {
  assert.deepEqual(sanitizePlan(null, '2026-11-05'), { mode: 'weekday', startDate: '2026-11-05', slots: [] });
  assert.equal(sanitizePlan('{bad', '2026-11-05').mode, 'weekday');
  const p = sanitizePlan({ mode: 'cycle', startDate: 'x', slots: [{ kind: 'weights', templateId: 7 }, { kind: 'zzz' }, null] }, '2026-11-05');
  assert.equal(p.mode, 'cycle');
  assert.equal(p.startDate, '2026-11-05');
  assert.deepEqual(p.slots.map((s) => [s.kind, s.templateId]), [['weights', null], ['rest', null], ['rest', null]]);
});
test('루틴대로 하기: 놓친 날만큼 시작일이 밀려 오늘이 그 칸이 됨', () => {
  const plan = sanitizePlan({ mode: 'cycle', startDate: '2026-11-01', slots: resizeSlots([], 3) }, '2026-11-05');
  // 11/03(1일 칸 아님: idx 2)을 놓쳤고 오늘 11/05
  const missedIdx = cycleIndex(plan.startDate, '2026-11-03', 3);
  const start2 = shiftStartForMissed(plan, '2026-11-03', '2026-11-05');
  assert.equal(cycleIndex(start2, '2026-11-05', 3), missedIdx);
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
