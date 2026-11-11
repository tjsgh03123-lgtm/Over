/**
 * 루틴 설정 마법사: 질문 몇 개(목표·주 몇 일·장비·시간)에 답하면 규칙으로 루틴 초안을 만든다.
 * AI나 서버를 쓰지 않는다. 운동 표(EXERCISE_TABLE)에서 부위·움직임 유형·장비·인기 등급으로 골라 채운다.
 * 결과는 초안이고, 저장 전에 사람이 확인·수정한다.
 */
import { EXERCISE_TABLE, type Row } from './exerciseTable.ts';
import type { ParsedDay, ParsedExercise } from './parser.ts';

export type Goal = 'size' | 'strength' | 'general';
export type Gear = 'gym' | 'dumbbell' | 'bodyweight';
export interface WizardAnswers { goal: Goal; days: number; gear: Gear; minutes: number }

export const GOAL_LABEL: Record<Goal, string> = { size: '근육 키우기', strength: '힘 세지기', general: '전반적인 건강' };
export const GEAR_LABEL: Record<Gear, string> = { gym: '헬스장 (기구 다 있음)', dumbbell: '덤벨만', bodyweight: '맨몸 (기구 없음)' };

/** 한 칸의 요구: 이 부위(없으면 아무 부위)의 이 움직임 유형 중 하나 */
interface Need { part?: string; pats: string[]; compound?: boolean; label: string }
const N: Record<string, Need> = {
  chestPress: { part: '가슴', pats: ['수평 밀기', '경사 밀기', '푸시업'], compound: true, label: '가슴 프레스' },
  chestIncline: { part: '가슴', pats: ['경사 밀기', '수평 밀기', '푸시업'], compound: true, label: '가슴 경사' },
  chestFly: { part: '가슴', pats: ['가슴 모으기'], label: '가슴 모으기' },
  shoulderPress: { part: '어깨', pats: ['수직 밀기'], compound: true, label: '어깨 프레스' },
  lateral: { part: '어깨', pats: ['측면 들기'], label: '측면 어깨' },
  rearDelt: { part: '어깨', pats: ['후면 들기', '후면 당기기'], label: '후면 어깨' },
  triceps: { part: '삼두', pats: ['팔꿈치 펴기', '수직 밀기(딥)'], label: '삼두' },
  pullV: { part: '등', pats: ['수직 당기기'], compound: true, label: '등 당기기(위)' },
  pullH: { part: '등', pats: ['수평 당기기'], compound: true, label: '등 당기기(앞)' },
  biceps: { part: '이두', pats: ['팔꿈치 굽히기'], label: '이두' },
  squat: { part: '하체', pats: ['스쿼트'], compound: true, label: '스쿼트' },
  hinge: { part: '하체', pats: ['힙힌지'], compound: true, label: '엉덩이 힌지' },
  lunge: { part: '하체', pats: ['런지'], compound: true, label: '런지' },
  legCurl: { part: '하체', pats: ['무릎 굽히기'], label: '햄스트링' },
  legExt: { part: '하체', pats: ['무릎 펴기'], label: '대퇴사두' },
  glute: { part: '하체', pats: ['힙쓰러스트'], compound: true, label: '엉덩이' },
  calf: { part: '하체', pats: ['발끝 들기'], label: '종아리' },
  core: { part: '복근', pats: ['상체 굽히기', '다리 들기'], label: '복근' },
  backExt: { pats: ['힙힌지'], label: '허리·엉덩이' },
};

interface DayPlan { title: string; needs: (keyof typeof N)[] }
const full = (a: boolean): DayPlan => a
  ? { title: '전신 A', needs: ['squat', 'chestPress', 'pullH', 'shoulderPress', 'hinge', 'core', 'biceps', 'triceps'] }
  : { title: '전신 B', needs: ['hinge', 'pullV', 'chestIncline', 'lunge', 'lateral', 'core', 'triceps', 'biceps'] };
const fullC: DayPlan = { title: '전신 C', needs: ['squat', 'chestIncline', 'pullH', 'glute', 'shoulderPress', 'core', 'lateral', 'legCurl'] };
const upper = (a: boolean): DayPlan => a
  ? { title: '상체 A', needs: ['chestPress', 'pullH', 'shoulderPress', 'pullV', 'triceps', 'biceps', 'lateral', 'chestFly'] }
  : { title: '상체 B', needs: ['pullV', 'chestIncline', 'pullH', 'lateral', 'chestFly', 'biceps', 'triceps', 'rearDelt'] };
const lower = (a: boolean): DayPlan => a
  ? { title: '하체 A', needs: ['squat', 'hinge', 'legExt', 'legCurl', 'calf', 'core', 'glute', 'lunge'] }
  : { title: '하체 B', needs: ['hinge', 'lunge', 'glute', 'legCurl', 'legExt', 'calf', 'core', 'squat'] };
const push = (a: boolean): DayPlan => ({ title: a ? '푸시 A' : '푸시 B', needs: a
  ? ['chestPress', 'shoulderPress', 'chestIncline', 'lateral', 'triceps', 'chestFly', 'triceps', 'core']
  : ['chestIncline', 'shoulderPress', 'chestPress', 'lateral', 'triceps', 'chestFly', 'lateral', 'core'] });
const pull = (a: boolean): DayPlan => ({ title: a ? '풀 A' : '풀 B', needs: a
  ? ['pullV', 'pullH', 'rearDelt', 'biceps', 'pullH', 'biceps', 'core', 'backExt']
  : ['pullH', 'pullV', 'rearDelt', 'biceps', 'pullV', 'biceps', 'core', 'backExt'] });
const legs = (a: boolean): DayPlan => lower(a);

/** 주 N일 분할과 요일(0=일 … 6=토) */
export function splitFor(days: number): { plans: DayPlan[]; weekdays: number[] } {
  switch (days) {
    case 2: return { plans: [full(true), full(false)], weekdays: [1, 4] };
    case 3: return { plans: [full(true), full(false), fullC], weekdays: [1, 3, 5] };
    case 4: return { plans: [upper(true), lower(true), upper(false), lower(false)], weekdays: [1, 2, 4, 5] };
    case 5: return {
      plans: [push(true), pull(true), legs(true), upper(false), lower(false)].map((p, i) => (i === 3 ? { title: '상체 보강', needs: p.needs } : i === 4 ? { title: '하체 보강', needs: p.needs } : p)),
      weekdays: [1, 2, 3, 5, 6],
    };
    default: return { plans: [push(true), pull(true), legs(true), push(false), pull(false), legs(false)], weekdays: [1, 2, 3, 4, 5, 6] };
  }
}

const ALLOWED_EQUIP: Record<Gear, string[]> = {
  gym: ['바벨', '덤벨', '머신', '케이블', '스미스', '맨몸', '케틀벨', '원판'],
  dumbbell: ['덤벨', '맨몸'],
  bodyweight: ['맨몸'],
};
/** 처음 하는 사람에게 권하기 어렵거나 카메라로도 못 세는 운동은 초안에서 뺀다 */
const SKIP = /머슬업|핸드스탠드|파이크|피스톨|노르딕|제퍼슨|터키시|클린|스내치|스미스|슬레드|딥스 머신|굿모닝|랙풀|트랩바|불가리안/;
const TIER = { A: 0, B: 1, C: 2 } as const;

function usable(r: Row, gear: Gear): boolean {
  const [ko, , , equip, pattern, posture] = r;
  if (!ALLOWED_EQUIP[gear].includes(equip)) return false;
  if (SKIP.test(ko)) return false;
  if (pattern === '정적 버티기' || pattern === '운반' || pattern === '전신 폭발' || pattern === '전신 복합' || pattern === '점프' || pattern === '전신 반복(유산소형)') return false;
  if (gear === 'bodyweight' && (posture === '매달림' || posture === '누운 매달림')) return false; // 철봉이 있다고 가정하지 않는다
  return true;
}

const PER_DAY: Record<number, number> = { 30: 4, 45: 5, 60: 6, 75: 7, 90: 8 };
export function exercisesPerDay(minutes: number): number {
  const keys = Object.keys(PER_DAY).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - minutes) < Math.abs(best - minutes)) best = k;
  return PER_DAY[best];
}

function setsReps(goal: Goal, compound: boolean): { sets: number; reps: number; restSec: number } {
  if (goal === 'strength') return compound ? { sets: 4, reps: 5, restSec: 180 } : { sets: 3, reps: 10, restSec: 90 };
  if (goal === 'general') return compound ? { sets: 3, reps: 10, restSec: 75 } : { sets: 2, reps: 12, restSec: 60 };
  return compound ? { sets: 3, reps: 8, restSec: 120 } : { sets: 3, reps: 12, restSec: 75 };
}

/** 이 칸에 맞는 운동 후보: 인기 등급 → 표 순서. 이미 쓴 운동은 뒤로 미룬다 */
function pick(need: Need, gear: Gear, used: Map<string, number>, prefer: 'first' | 'second'): Row | null {
  const cands: { r: Row; pri: number; idx: number }[] = [];
  EXERCISE_TABLE.forEach((r, idx) => {
    if (!usable(r, gear)) return;
    if (need.part && r[2] !== need.part) return;
    const pi = need.pats.indexOf(r[4]);
    if (pi < 0) return;
    cands.push({ r, pri: pi * 10 + TIER[r[6]] * 3 + (used.get(r[0]) ?? 0) * 100, idx });
  });
  cands.sort((a, b) => a.pri - b.pri || a.idx - b.idx);
  if (!cands.length) return null;
  return (prefer === 'second' && cands.length > 1 && (used.get(cands[0].r[0]) ?? 0) === 0 ? cands[1] : cands[0]).r;
}

/** 표의 부위를 앱의 부위(가슴·등·어깨·하체·팔·복근)로 */
export function appPart(tablePart: string): string | null {
  if (tablePart === '이두' || tablePart === '삼두' || tablePart === '전완근') return '팔';
  if (tablePart === '전신') return null;
  return tablePart;
}

export interface WizardPlan {
  name: string;
  mode: 'weekday';
  days: ParsedDay[];
  /** 초안에 대한 한 줄 설명 */
  summary: string;
  warnings: string[];
}

export function buildPlan(a: WizardAnswers): WizardPlan {
  const { plans, weekdays } = splitFor(Math.max(2, Math.min(6, Math.round(a.days))));
  const per = exercisesPerDay(a.minutes);
  const used = new Map<string, number>();
  const warnings: string[] = [];
  const days: ParsedDay[] = plans.map((plan, di) => {
    const exercises: ParsedExercise[] = [];
    const today = new Set<string>();
    for (const key of plan.needs) {
      if (exercises.length >= per) break;
      const need = N[key];
      const row = pick(need, a.gear, used, /B|보강/.test(plan.title) || di >= plans.length / 2 ? 'second' : 'first');
      if (!row || today.has(row[0])) continue;
      today.add(row[0]);
      used.set(row[0], (used.get(row[0]) ?? 0) + 1);
      const sr = setsReps(a.goal, !!need.compound);
      exercises.push({ name: row[0], sets: sr.sets, reps: sr.reps, repsMax: null, weight: null, intensity: null, restSec: sr.restSec, category: appPart(row[2]) ?? undefined });
    }
    if (exercises.length < Math.min(3, per)) warnings.push(`${plan.title}: 고른 장비로는 운동이 ${exercises.length}개밖에 안 나왔어요. 직접 추가해 주세요.`);
    return { weekday: weekdays[di], title: plan.title, intensity: null, isRest: false, kind: 'weights' as const, exercises };
  });
  if (a.gear === 'bodyweight') warnings.push('철봉이 없다고 보고 짰어요. 등 운동이 적어요. 철봉이나 밴드가 있으면 풀업·로우를 직접 추가하세요.');
  return {
    name: `${GOAL_LABEL[a.goal]} 주 ${plans.length}일`,
    mode: 'weekday',
    days,
    summary: `주 ${plans.length}일, 하루 ${per}개 안팎. 큰 운동(스쿼트·프레스·로우 등) ${a.goal === 'strength' ? '4세트×5회' : a.goal === 'general' ? '3세트×10회' : '3세트×8회'}, 보조 운동은 ${a.goal === 'general' ? '2×12' : '3×12'}회로 잡았어요. 무게는 직접 정하세요.`,
    warnings,
  };
}
