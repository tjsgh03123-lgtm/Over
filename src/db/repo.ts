import { nowIso, uid, type Db, type SqlParam } from './adapter.ts';
import type { FlatSet, Intensity, SetKind, SetType, WeightMode } from '../domain/types.ts';
import {
  addCustomMetric, BUILTIN_METRICS, sanitizeExtra, sanitizeMetrics, type BodyMetric, type ExtraValues,
} from '../domain/bodyMetrics.ts';
import type { ParsedDay } from '../domain/parser.ts';
import { addDays, weekStart } from '../domain/stats.ts';
import { shiftStartForMissed } from '../domain/cycle.ts';
import { moveItem } from '../domain/reorder.ts';
import { adjustForCondition, type Cond } from '../domain/condition.ts';
import { decodeOverride, encodeOverride, parseIds, partSummary } from '../domain/homeCards.ts';
import {
  autoFillSlots, convertMode, dayForDate, DEFAULT_REPEAT, EMPTY_ROUTINES, fitSlots, inferMode, MAX_DAYS, placeDay, resizeCycle, sanitizeRoutines, setSlotAt, swapSlots,
  type DayKind, type Routine, type RoutineDay, type RoutineMode, type RoutinesState,
} from '../domain/routine.ts';

/* ============================== 종목 ============================== */

export interface ExerciseRow {
  id: string;
  name: string;
  category: string | null;
  weight_mode: WeightMode;
  archived: number;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export async function listExercises(db: Db, includeArchived = false): Promise<ExerciseRow[]> {
  return db.all<ExerciseRow>(
    `SELECT id, name, category, weight_mode, archived FROM exercises ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`,
  );
}

export async function findExercise(db: Db, name: string): Promise<ExerciseRow | null> {
  const n = norm(name);
  const all = await listExercises(db, true);
  const hit = all.find((e) => norm(e.name) === n);
  if (hit) return hit;
  const aliases = await db.all<{ exercise_id: string; alias: string }>('SELECT exercise_id, alias FROM exercise_aliases');
  const a = aliases.find((x) => norm(x.alias) === n);
  return a ? all.find((e) => e.id === a.exercise_id) ?? null : null;
}

export async function getOrCreateExercise(
  db: Db, name: string, opts: { mode?: WeightMode; category?: string } = {},
): Promise<ExerciseRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('종목 이름이 비어 있습니다');
  const hit = await findExercise(db, trimmed);
  if (hit) {
    if (hit.archived) await db.run('UPDATE exercises SET archived = 0 WHERE id = ?', [hit.id]);
    return { ...hit, archived: 0 };
  }
  const id = uid('ex');
  const mode = opts.mode ?? 'weighted';
  await db.run('INSERT INTO exercises (id, name, category, weight_mode, archived, created_at) VALUES (?,?,?,?,0,?)', [
    id, trimmed, opts.category ?? null, mode, nowIso(),
  ]);
  return { id, name: trimmed, category: opts.category ?? null, weight_mode: mode, archived: 0 };
}

/** 이름 변경: exercises.name만 바뀌고 과거 세션의 exercise_name 스냅샷과 기록(exercise_id)은 유지 */
export async function renameExercise(db: Db, id: string, newName: string): Promise<void> {
  const old = await db.first<{ name: string }>('SELECT name FROM exercises WHERE id = ?', [id]);
  if (!old) return;
  await db.transaction(async () => {
    await db.run('UPDATE exercises SET name = ? WHERE id = ?', [newName.trim(), id]);
    if (norm(old.name) !== norm(newName)) {
      await db.run('INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias) VALUES (?,?,?)', [uid('al'), id, old.name]);
    }
  });
}

/** 종목의 부위를 바꾼다 (null이면 이름으로 자동 분류). 분석의 부위별 통계에도 반영된다. */
export async function setExerciseCategory(db: Db, id: string, category: string | null): Promise<void> {
  await db.run('UPDATE exercises SET category = ? WHERE id = ?', [category, id]);
}

/** 종목 id → 지정된 부위 (부위별 통계·요약에서 partOf에 넘긴다) */
export async function loadCategoryMap(db: Db): Promise<Map<string, string | null>> {
  const rows = await db.all<{ id: string; category: string | null }>('SELECT id, category FROM exercises');
  return new Map(rows.map((r) => [r.id, r.category]));
}

export async function setExerciseMode(db: Db, id: string, mode: WeightMode): Promise<void> {
  await db.run('UPDATE exercises SET weight_mode = ? WHERE id = ?', [mode, id]);
  await db.run('UPDATE workout_session_exercises SET weight_mode = ? WHERE exercise_id = ?', [mode, id]);
}

/** 이 운동(세션)의 종목 방식을 바꾼다 (중량/체중/보조). 이후 새 세션에도 그 방식이 기본이 된다. */
export async function setSessionExerciseMode(db: Db, sessionExerciseId: string, mode: WeightMode): Promise<void> {
  const se = await db.first<{ exercise_id: string }>('SELECT exercise_id FROM workout_session_exercises WHERE id = ?', [sessionExerciseId]);
  if (!se) return;
  await db.run('UPDATE workout_session_exercises SET weight_mode = ? WHERE id = ?', [mode, sessionExerciseId]);
  await db.run('UPDATE exercises SET weight_mode = ? WHERE id = ?', [mode, se.exercise_id]);
}

/** 기록이 있으면 보관(archived) 처리, 없으면 삭제 */
export async function deleteExercise(db: Db, id: string): Promise<'deleted' | 'archived'> {
  const used = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM workout_session_exercises WHERE exercise_id = ?', [id]);
  if (used && used.n > 0) {
    await db.run('UPDATE exercises SET archived = 1 WHERE id = ?', [id]);
    return 'archived';
  }
  await db.run('DELETE FROM workout_template_exercises WHERE exercise_id = ?', [id]);
  await db.run('DELETE FROM exercises WHERE id = ?', [id]);
  return 'deleted';
}

/* ============================== 루틴(템플릿) ============================== */

export interface TemplateExerciseInput {
  exerciseId: string;
  targetSets?: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  intensity?: Intensity | null;
  restSec?: number | null;
  note?: string | null;
  /** 슈퍼세트 묶음 이름: 같은 값이 연달아 있으면 번갈아 진행 */
  ss?: string | null;
}
export interface TemplateInput {
  id?: string;
  name: string;
  defaultIntensity?: Intensity;
  postCardioMin?: number | null;
  exercises: TemplateExerciseInput[];
}
export interface TemplateRow {
  id: string;
  name: string;
  default_intensity: Intensity;
  post_cardio_min: number | null;
  is_default: number;
}
export interface TemplateExerciseRow {
  id: string;
  exercise_id: string;
  name: string;
  weight_mode: WeightMode;
  position: number;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  intensity: Intensity | null;
  rest_sec: number | null;
  note: string | null;
  ss: string | null;
  category: string | null;
}

export async function listTemplates(db: Db): Promise<TemplateRow[]> {
  return db.all<TemplateRow>('SELECT id, name, default_intensity, post_cardio_min, is_default FROM workout_templates ORDER BY created_at, name');
}

export async function getTemplateExercises(db: Db, templateId: string): Promise<TemplateExerciseRow[]> {
  return db.all<TemplateExerciseRow>(
    `SELECT t.id, t.exercise_id, e.name, e.weight_mode, e.category, t.position, t.target_sets, t.target_reps, t.target_weight, t.intensity, t.rest_sec, t.note, t.ss
       FROM workout_template_exercises t JOIN exercises e ON e.id = t.exercise_id
      WHERE t.template_id = ? ORDER BY t.position`,
    [templateId],
  );
}

export async function saveTemplate(db: Db, input: TemplateInput): Promise<string> {
  const id = input.id ?? uid('tpl');
  await db.transaction(async () => {
    if (input.id) {
      await db.run('UPDATE workout_templates SET name=?, default_intensity=?, post_cardio_min=? WHERE id=?', [
        input.name, input.defaultIntensity ?? 'none', input.postCardioMin ?? null, id,
      ]);
      await db.run('DELETE FROM workout_template_exercises WHERE template_id = ?', [id]);
    } else {
      await db.run(
        'INSERT INTO workout_templates (id, name, default_intensity, post_cardio_min, is_default, created_at) VALUES (?,?,?,?,0,?)',
        [id, input.name, input.defaultIntensity ?? 'none', input.postCardioMin ?? null, nowIso()],
      );
    }
    let pos = 0;
    for (const e of input.exercises) {
      await db.run(
        `INSERT INTO workout_template_exercises
          (id, template_id, exercise_id, position, target_sets, target_reps, target_weight, intensity, rest_sec, note, ss)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [uid('twe'), id, e.exerciseId, pos++, e.targetSets ?? 3, e.targetReps ?? null, e.targetWeight ?? null,
          e.intensity ?? null, e.restSec ?? null, e.note ?? null, e.ss ?? null],
      );
    }
  });
  return id;
}

/** 루틴을 삭제해도 완료된 운동 기록은 유지됨 (sessions.template_id → NULL) */
export async function deleteTemplate(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM workout_templates WHERE id = ?', [id]);
}

/* ============================== 루틴 (= 사이클 한 개 전체) ============================== */
/*
 * 루틴 메타데이터(이름·방식·시작일·날 목록)는 app_settings의 'routines_v2' JSON에 저장된다 (백업에 함께 포함).
 * 각 '날'의 종목은 workout_templates / workout_template_exercises에 저장된다.
 */

export async function getRoutines(db: Db, today: string): Promise<RoutinesState> {
  const raw = await getSetting(db, 'routines_v2');
  return raw ? sanitizeRoutines(raw, today) : { ...EMPTY_ROUTINES };
}
export async function saveRoutines(db: Db, state: RoutinesState): Promise<void> {
  await setSetting(db, 'routines_v2', JSON.stringify(state));
}
export async function getActiveRoutine(db: Db, today: string): Promise<Routine | null> {
  const st = await getRoutines(db, today);
  return st.routines.find((r) => r.id === st.activeId) ?? null;
}

async function mutateRoutine(db: Db, today: string, id: string, fn: (r: Routine) => Routine): Promise<void> {
  const st = await getRoutines(db, today);
  await saveRoutines(db, { ...st, routines: st.routines.map((r) => (r.id === id ? fn(r) : r)) });
}

/** 새 루틴을 만든다. 첫 루틴이면 자동으로 사용 중이 된다. */
export async function createRoutine(
  db: Db, today: string, v: { name: string; mode?: RoutineMode; startDate?: string; repeat?: number },
): Promise<string> {
  const st = await getRoutines(db, today);
  const id = uid('rt');
  const mode = v.mode ?? 'cycle';
  const routine: Routine = { id, name: v.name.trim() || '새 루틴', mode, startDate: v.startDate ?? today, days: [], slots: fitSlots(mode, Array(mode === 'weekday' ? 7 : v.repeat ?? DEFAULT_REPEAT).fill(null)) };
  await saveRoutines(db, { activeId: st.activeId ?? id, routines: [...st.routines, routine] });
  return id;
}
export const renameRoutine = (db: Db, today: string, id: string, name: string) =>
  mutateRoutine(db, today, id, (r) => ({ ...r, name: name.trim() || r.name }));
/** 방식을 바꾼다. 칸은 월~일 ↔ Day 1~7로 옮기고, 7칸을 넘는 Day는 빠진다(날 자체는 남는다). 빠지는 날의 수를 돌려준다. */
export async function setRoutineMode(db: Db, today: string, id: string, mode: RoutineMode): Promise<number> {
  let lost = 0;
  await mutateRoutine(db, today, id, (r) => {
    const c = convertMode(r, mode);
    lost = c.lost;
    return { ...r, mode, slots: c.slots };
  });
  return lost;
}
/** cycle: 반복 일수(칸 수) 바꾸기 */
export const setRepeatDays = (db: Db, today: string, id: string, n: number) =>
  mutateRoutine(db, today, id, (r) => ({ ...r, slots: resizeCycle(r, n) }));
/** 칸에 날 놓기 / 비우기(null) */
export const setSlot = (db: Db, today: string, id: string, index: number, dayId: string | null) =>
  mutateRoutine(db, today, id, (r) => ({ ...r, slots: setSlotAt(r, index, dayId) }));
/** 칸 배치를 통째로 저장 (끌어서 옮긴 결과). 칸 수는 그대로 유지하고, 없는 날은 빈 칸으로 정리한다. */
export const setRoutineSlots = (db: Db, today: string, id: string, slots: (string | null)[]) =>
  mutateRoutine(db, today, id, (r) => ({
    ...r, slots: fitSlots(r.mode, r.slots.map((_, i) => { const v = slots[i] ?? null; return v && r.days.some((d) => d.id === v) ? v : null; })),
  }));
/** 두 칸의 내용 맞바꾸기 */
export const swapRoutineSlots = (db: Db, today: string, id: string, a: number, b: number) =>
  mutateRoutine(db, today, id, (r) => ({ ...r, slots: swapSlots(r, a, b) }));
/** 놓이지 않은 날을 빈 칸에 차례로 채우기 */
export const autoFillRoutine = (db: Db, today: string, id: string) =>
  mutateRoutine(db, today, id, (r) => ({ ...r, slots: autoFillSlots(r) }));
export const setRoutineStart = (db: Db, today: string, id: string, startDate: string) =>
  mutateRoutine(db, today, id, (r) => ({ ...r, startDate }));
export async function setActiveRoutine(db: Db, today: string, id: string | null): Promise<void> {
  const st = await getRoutines(db, today);
  await saveRoutines(db, { ...st, activeId: id && st.routines.some((r) => r.id === id) ? id : null });
}

/** 만들기 도중 나가서 남은 빈 루틴(기본 이름 그대로, 날 없음)을 정리한다. 지운 개수를 돌려준다. */
export async function pruneEmptyRoutines(db: Db, today: string): Promise<number> {
  const st = await getRoutines(db, today);
  const empty = st.routines.filter((r) => r.days.length === 0 && r.name === '새 루틴');
  for (const r of empty) await deleteRoutine(db, today, r.id);
  return empty.length;
}

/** 루틴을 지우면 그 루틴 날들의 종목도 함께 지운다. 완료한 운동 기록과 성장 그래프는 그대로 유지된다. */
export async function deleteRoutine(db: Db, today: string, id: string): Promise<void> {
  const st = await getRoutines(db, today);
  const r = st.routines.find((x) => x.id === id);
  if (!r) return;
  await db.transaction(async () => {
    for (const d of r.days) if (d.templateId) await deleteTemplate(db, d.templateId);
    const routines = st.routines.filter((x) => x.id !== id);
    await saveRoutines(db, { activeId: st.activeId === id ? routines[0]?.id ?? null : st.activeId, routines });
  });
}

export interface DayInput {
  id?: string;
  name: string;
  kind: DayKind;
  /** 새 날을 놓을 칸 번호 (비우면 첫 빈 칸). 요일 방식의 칸 번호는 요일(0=일 … 6=토) */
  slot?: number | null;
  /** 예전 방식: 요일 방식 루틴에서 새 날을 놓을 요일 */
  weekday?: number | null;
  exercises?: TemplateExerciseInput[];
  postCardioMin?: number | null;
}

/** 날 추가/수정. weights면 종목을 workout_templates에 저장하고, 다른 종류로 바뀌면 종목을 지운다. */
export async function upsertDay(db: Db, today: string, routineId: string, input: DayInput): Promise<string> {
  const st = await getRoutines(db, today);
  const r = st.routines.find((x) => x.id === routineId);
  if (!r) throw new Error('루틴을 찾을 수 없습니다');
  const existing = input.id ? r.days.find((d) => d.id === input.id) : undefined;
  if (!existing && r.days.length >= MAX_DAYS) throw new Error(`한 루틴은 최대 ${MAX_DAYS}일까지 만들 수 있습니다`);
  const dayId = existing?.id ?? uid('rd');
  const name = input.name.trim() || (input.kind === 'rest' ? '휴식' : input.kind === 'cardio' ? '유산소' : '운동');
  await db.transaction(async () => {
    let templateId: string | null = existing?.templateId ?? null;
    if (input.kind === 'weights') {
      templateId = await saveTemplate(db, {
        id: templateId ?? undefined, name, postCardioMin: input.postCardioMin ?? null, exercises: input.exercises ?? [],
      });
    } else if (templateId) {
      await deleteTemplate(db, templateId);
      templateId = null;
    }
    const day: RoutineDay = { id: dayId, name, kind: input.kind, templateId, weekday: null };
    await mutateRoutine(db, today, routineId, (x) => {
      const withDay = { ...x, days: existing ? x.days.map((d) => (d.id === dayId ? day : d)) : [...x.days, day] };
      // 새 날은 빈 칸에 자동으로 놓는다 (요일을 지정해 만들면 그 요일에). 칸은 나중에 자유롭게 옮길 수 있다.
      if (existing) return withDay;
      const at = input.slot ?? null;
      return { ...withDay, slots: at != null && at >= 0 && at < withDay.slots.length ? setSlotAt(withDay, at, dayId) : placeDay(withDay, dayId, input.weekday) };
    });
  });
  return dayId;
}

export async function deleteDay(db: Db, today: string, routineId: string, dayId: string): Promise<void> {
  const st = await getRoutines(db, today);
  const d = st.routines.find((x) => x.id === routineId)?.days.find((x) => x.id === dayId);
  if (!d) return;
  await db.transaction(async () => {
    if (d.templateId) await deleteTemplate(db, d.templateId);
    await mutateRoutine(db, today, routineId, (x) => ({
      ...x, days: x.days.filter((y) => y.id !== dayId), slots: x.slots.map((s) => (s === dayId ? null : s)),
    }));
  });
}

export async function moveDay(db: Db, today: string, routineId: string, dayId: string, dir: -1 | 1): Promise<void> {
  await mutateRoutine(db, today, routineId, (x) => {
    const i = x.days.findIndex((d) => d.id === dayId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= x.days.length) return x;
    const days = [...x.days];
    [days[i], days[j]] = [days[j], days[i]];
    return { ...x, days };
  });
}

/** 끌어서 옮기기: 날을 toIndex 위치로 */
export async function moveDayTo(db: Db, today: string, routineId: string, dayId: string, toIndex: number): Promise<void> {
  await mutateRoutine(db, today, routineId, (x) => {
    const i = x.days.findIndex((d) => d.id === dayId);
    if (i < 0) return x;
    return { ...x, days: moveItem(x.days, i, toIndex) };
  });
}

/** 날 편집 화면용: 날 + 종목 */
export async function getDayDetail(db: Db, today: string, routineId: string, dayId: string) {
  const st = await getRoutines(db, today);
  const r = st.routines.find((x) => x.id === routineId);
  const day = r?.days.find((d) => d.id === dayId);
  if (!r || !day) return null;
  const exercises = day.templateId ? await getTemplateExercises(db, day.templateId) : [];
  const tpl = day.templateId ? await db.first<{ post_cardio_min: number | null }>('SELECT post_cardio_min FROM workout_templates WHERE id = ?', [day.templateId]) : null;
  return { routine: r, day, exercises, postCardioMin: tpl?.post_cardio_min ?? null };
}

/* -------- 오늘 해당하는 날 -------- */

export interface DaySlot {
  kind: DayKind;
  template_id: string | null;
  /** 날 이름 (예: 가슴·삼두) */
  label: string | null;
  routineName: string;
  /** cycle 모드일 때만: 몇 일차 / 전체 일수 */
  cycleDay?: number;
  cycleLength?: number;
}

async function templateExists(db: Db, id: string | null): Promise<string | null> {
  if (!id) return null;
  const t = await db.first<{ id: string }>('SELECT id FROM workout_templates WHERE id = ?', [id]);
  return t ? id : null;
}

/**
 * 사용 중인 루틴에서 그 날짜에 해당하는 날. 사용 중인 루틴이 없거나 날이 하나도 없으면 null.
 * 요일 방식에서 해당 요일에 지정된 날이 없으면 휴식으로 본다. 삭제된 종목 정보는 연결 없음(null)으로 취급한다.
 */
export async function slotForDate(db: Db, date: string): Promise<DaySlot | null> {
  const r = await getActiveRoutine(db, date);
  if (!r || !r.slots.some(Boolean)) return null;
  const hit = dayForDate(r, date);
  if (!hit.day) return { kind: 'rest', template_id: null, label: '휴식', routineName: r.name, cycleDay: hit.cycleDay, cycleLength: hit.cycleLength };
  return {
    kind: hit.day.kind,
    template_id: hit.day.kind === 'weights' ? await templateExists(db, hit.day.templateId) : null,
    label: hit.day.name,
    routineName: r.name,
    cycleDay: hit.cycleDay,
    cycleLength: hit.cycleLength,
  };
}

export interface TemplateBrief { id: string; name: string; count: number; names: string[]; post_cardio_min: number | null }
export async function getTemplateBrief(db: Db, id: string): Promise<TemplateBrief | null> {
  const t = await db.first<TemplateRow>('SELECT * FROM workout_templates WHERE id = ?', [id]);
  if (!t) return null;
  const ex = await getTemplateExercises(db, id);
  return { id, name: t.name, count: ex.length, names: ex.slice(0, 3).map((e) => e.name), post_cardio_min: t.post_cardio_min };
}

/* -------- 앱을 켰을 때: 완료하지 못한 지난 루틴 확인 -------- */

export interface MissedRoutine { date: string; templateId: string; templateName: string }
export type MissedChoice = 'skip' | 'follow' | 'free';

const MISSED_LOOKBACK_DAYS = 7;

/**
 * 오늘 이전에 예정돼 있었는데 완료한 운동이 없는 가장 최근 웨이트 날을 찾는다.
 * - 처음 실행할 때는 기준일만 저장하고 묻지 않는다.
 * - 오늘 이미 물었거나, 진행 중인 운동이 있으면 묻지 않는다.
 * - 오늘의 (아직 안 한) 운동은 대상이 아니다.
 */
export async function findMissedRoutine(db: Db, today: string): Promise<MissedRoutine | null> {
  const handled = await getSetting(db, 'missed_handled_through');
  if (!handled) {
    await setSetting(db, 'missed_handled_through', addDays(today, -1));
    return null;
  }
  if ((await getSetting(db, 'missed_prompt_date')) === today) return null;
  if (await getActiveSession(db)) return null;
  const earliest = addDays(today, -MISSED_LOOKBACK_DAYS);
  let d = addDays(today, -1);
  while (d > handled && d >= earliest) {
    const slot = await slotForDate(db, d);
    if (slot && slot.kind === 'weights' && slot.template_id) {
      const done = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM workout_sessions WHERE date = ? AND status = 'done'", [d]);
      if (!done || done.n === 0) {
        const t = await db.first<{ name: string }>('SELECT name FROM workout_templates WHERE id = ?', [slot.template_id]);
        if (t) return { date: d, templateId: slot.template_id, templateName: slot.routineName ? `${slot.routineName} · ${t.name}` : t.name };
      }
    }
    d = addDays(d, -1);
  }
  return null;
}

/**
 * 선택 결과를 적용한다. 같은 날 다시 묻지 않고, 지난 날짜는 다시 묻지 않는다.
 * skip: 일정 그대로 · follow: 놓친 날의 운동을 오늘 시작 (사이클 방식이면 이후 일정을 밀어 이어감) · free: 오늘만 자유 운동
 * 운동을 시작한 경우 세션 id를 돌려준다.
 */
export async function resolveMissed(db: Db, today: string, missed: MissedRoutine, choice: MissedChoice): Promise<string | null> {
  await setSetting(db, 'missed_handled_through', addDays(today, -1));
  await setSetting(db, 'missed_prompt_date', today);
  if (choice === 'skip') return null;
  if (choice === 'free') return startFreeSession(db, today);
  const r = await getActiveRoutine(db, today);
  if (r && r.mode === 'cycle' && r.slots.some(Boolean)) {
    await setRoutineStart(db, today, r.id, shiftStartForMissed(r.startDate, missed.date, today));
  }
  return startSessionFromTemplate(db, missed.templateId, today);
}

/** 세트 입력의 ± 버튼 단위 (kg) */
/** 세트 사이 기본 휴식(초). 0이면 휴식 타이머 끔. 설정하지 않았으면 90초 */
export async function getRestDefault(db: Db): Promise<number> {
  const raw = await getSetting(db, 'rest_default_sec');
  if (raw == null) return 90;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(600, Math.round(v)) : 90;
}

/** 종목과 종목 사이 휴식(초). 설정하지 않았으면 180초. 운동 중 30초 단위로 바꾸면 그 값이 새 기본값이 된다 */
export async function getExerciseRest(db: Db): Promise<number> {
  const raw = await getSetting(db, 'exercise_rest_sec');
  const v = raw == null ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(900, Math.round(v)) : 180;
}
export async function setExerciseRest(db: Db, sec: number): Promise<void> {
  await setSetting(db, 'exercise_rest_sec', String(Math.max(0, Math.min(900, Math.round(sec)))));
}

/** 운동(세션)의 종목별로, 루틴에 정해 둔 세트 간 휴식(초). 정해 둔 값이 없으면 null */
export async function getSessionRests(db: Db, sessionId: string): Promise<Record<string, number | null>> {
  const rows = await db.all<{ id: string; rest: number | null; ex: string }>(
    `SELECT se.id AS id, se.exercise_id AS ex, t.rest_sec AS rest
       FROM workout_session_exercises se
       JOIN workout_sessions s ON s.id = se.session_id
       LEFT JOIN workout_template_exercises t ON t.template_id = s.template_id AND t.exercise_id = se.exercise_id
      WHERE se.session_id = ?
      ORDER BY t.position`, [sessionId]);
  const out: Record<string, number | null> = {};
  for (const r of rows) if (!(r.id in out) || (out[r.id] == null && r.rest != null)) out[r.id] = r.rest;
  // 운동 중 '이 종목만' 저장한 휴식이 있으면 루틴에 정한 값보다 우선한다
  for (const r of rows) {
    const o = await getSetting(db, `ex_rest_${r.ex}`);
    if (o != null && Number.isFinite(Number(o))) out[r.id] = Number(o);
  }
  return out;
}

/** 이 종목만 세트 간 휴식(초) 저장 */
export async function setExerciseRestFor(db: Db, exerciseId: string, sec: number): Promise<void> {
  await setSetting(db, `ex_rest_${exerciseId}`, String(Math.max(0, Math.min(900, Math.round(sec)))));
}
/** 모든 종목의 기본 세트 간 휴식(초) 저장. 종목별로 따로 저장한 값은 지운다 */
export async function setRestDefault(db: Db, sec: number): Promise<void> {
  await setSetting(db, 'rest_default_sec', String(Math.max(0, Math.min(600, Math.round(sec)))));
  await db.run("DELETE FROM app_settings WHERE key LIKE 'ex_rest_%'");
}

/** 이 종목을 마지막으로 완료한 운동(현재 운동 제외)의 완료 세트들: 불러오기·지난번 대비 볼륨에 사용 */
export async function getLastSets(db: Db, exerciseId: string, excludeSessionId: string): Promise<{ weight: number | null; reps: number | null }[]> {
  const prev = await db.first<{ sid: string }>(
    `SELECT s.id AS sid FROM workout_sessions s
       JOIN workout_session_exercises se ON se.session_id = s.id
       JOIN workout_sets st ON st.session_exercise_id = se.id
      WHERE se.exercise_id = ? AND s.status = 'done' AND s.id <> ? AND st.done = 1 AND st.set_type = 'working'
      ORDER BY s.date DESC, s.started_at DESC LIMIT 1`, [exerciseId, excludeSessionId]);
  if (!prev) return [];
  return db.all(
    `SELECT st.weight AS weight, st.reps AS reps FROM workout_sets st
       JOIN workout_session_exercises se ON se.id = st.session_exercise_id
      WHERE se.session_id = ? AND se.exercise_id = ? AND st.done = 1 AND st.set_type = 'working'
      ORDER BY st.set_no`, [prev.sid, exerciseId]);
}

/** 운동을 완료한 날짜 목록(중복 제거, 오름차순): 주 연속 기록·월 목표 계산용 */
export async function listDoneDates(db: Db): Promise<string[]> {
  const rows = await db.all<{ date: string }>("SELECT DISTINCT date FROM workout_sessions WHERE status = 'done' ORDER BY date");
  return rows.map((r) => r.date);
}

export async function getWeightStep(db: Db): Promise<number> {
  const v = Number(await getSetting(db, 'weight_step'));
  return Number.isFinite(v) && v > 0 ? v : 2.5;
}

/* ============================== 운동 세션 ============================== */

export interface SessionMeta {
  id: string;
  date: string;
  template_id: string | null;
  title: string;
  intensity: Intensity | null;
  is_free: number;
  status: 'active' | 'done';
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  note: string | null;
}
export interface SetRow {
  id: string;
  session_exercise_id: string;
  set_no: number;
  weight: number | null;
  reps: number | null;
  done: number;
  set_type: SetType;
  is_rm: number | null; // 1이면 1RM 측정 세트 (평소 운동 기록·볼륨과 분리)
  intensity: Intensity | null;
}
export interface SessionExRow {
  id: string;
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  weight_mode: WeightMode;
  position: number;
  intensity: Intensity | null;
  note: string | null;
  ss: string | null;
  sets: SetRow[];
}
export interface SessionFull extends SessionMeta {
  exercises: SessionExRow[];
}

async function newSet(db: Db, seId: string, setNo: number, type: SetType, weight: number | null, reps: number | null) {
  await db.run(
    'INSERT INTO workout_sets (id, session_exercise_id, set_no, weight, reps, done, set_type, intensity, created_at) VALUES (?,?,?,?,?,0,?,NULL,?)',
    [uid('set'), seId, setNo, weight, reps, type, nowIso()],
  );
}

/** 마지막으로 완료한 같은 종목의 본 세트 중량/횟수 (입력 편의용 힌트) */
export async function lastPerformance(db: Db, exerciseId: string): Promise<{ weight: number | null; reps: number | null } | null> {
  return db.first(
    `SELECT st.weight AS weight, st.reps AS reps FROM workout_sets st
       JOIN workout_session_exercises se ON se.id = st.session_exercise_id
       JOIN workout_sessions s ON s.id = se.session_id
      WHERE se.exercise_id = ? AND s.status = 'done' AND st.done = 1 AND st.set_type = 'working' AND COALESCE(st.is_rm,0) = 0 AND st.weight IS NOT NULL
      ORDER BY s.date DESC, s.started_at DESC, st.set_no DESC LIMIT 1`,
    [exerciseId],
  );
}

export async function getActiveSession(db: Db): Promise<SessionMeta | null> {
  return db.first<SessionMeta>("SELECT * FROM workout_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
}

/**
 * 루틴으로 운동 시작. opts.order는 이번 운동의 종목 순서(루틴 종목 행 id 순서), opts.cond는 컨디션(%)이며
 * 둘 다 이번 운동에만 적용되고 루틴 자체는 바뀌지 않는다.
 */
export async function startSessionFromTemplate(
  db: Db, templateId: string, date: string, opts: { order?: string[]; cond?: Cond } = {},
): Promise<string> {
  const tpl = await db.first<TemplateRow>('SELECT * FROM workout_templates WHERE id = ?', [templateId]);
  if (!tpl) throw new Error('루틴을 찾을 수 없습니다');
  let exs = await getTemplateExercises(db, templateId);
  if (opts.order?.length) {
    const rank = new Map(opts.order.map((id, i) => [id, i]));
    exs = [...exs].sort((a, b) => (rank.get(a.id) ?? 1e9 + a.position) - (rank.get(b.id) ?? 1e9 + b.position));
  }
  const cond: Cond = opts.cond ?? 100;
  const step = await getWeightStep(db);
  const sid = uid('ses');
  await db.transaction(async () => {
    await db.run(
      "INSERT INTO workout_sessions (id, date, template_id, title, intensity, is_free, status, started_at) VALUES (?,?,?,?,?,0,'active',?)",
      [sid, date, templateId, tpl.name, tpl.default_intensity === 'none' ? null : tpl.default_intensity, nowIso()],
    );
    let pos = 0;
    for (const e of exs) {
      const seId = uid('se');
      await db.run(
        'INSERT INTO workout_session_exercises (id, session_id, exercise_id, exercise_name, weight_mode, position, intensity, ss) VALUES (?,?,?,?,?,?,?,?)',
        [seId, sid, e.exercise_id, e.name, e.weight_mode, pos++, e.intensity, e.ss],
      );
      const adj = adjustForCondition(e.target_sets, e.target_weight, cond, step);
      for (let i = 1; i <= adj.sets; i++) await newSet(db, seId, i, 'working', adj.weight, e.target_reps);
    }
  });
  return sid;
}

export async function startFreeSession(db: Db, date: string, title = '자유 운동'): Promise<string> {
  const sid = uid('ses');
  await db.run(
    "INSERT INTO workout_sessions (id, date, template_id, title, intensity, is_free, status, started_at) VALUES (?,?,NULL,?,NULL,1,'active',?)",
    [sid, date, title, nowIso()],
  );
  return sid;
}

export async function loadSession(db: Db, id: string): Promise<SessionFull | null> {
  const meta = await db.first<SessionMeta>('SELECT * FROM workout_sessions WHERE id = ?', [id]);
  if (!meta) return null;
  const exs = await db.all<Omit<SessionExRow, 'sets'>>(
    'SELECT * FROM workout_session_exercises WHERE session_id = ? ORDER BY position', [id],
  );
  const sets = await db.all<SetRow>(
    `SELECT st.* FROM workout_sets st JOIN workout_session_exercises se ON se.id = st.session_exercise_id
      WHERE se.session_id = ? ORDER BY st.set_no`, [id],
  );
  return { ...meta, exercises: exs.map((e) => ({ ...e, sets: sets.filter((s) => s.session_exercise_id === e.id) })) };
}

export async function addSessionExercise(db: Db, sessionId: string, exerciseId: string, sets = 3): Promise<string> {
  const ex = await db.first<ExerciseRow>('SELECT * FROM exercises WHERE id = ?', [exerciseId]);
  if (!ex) throw new Error('종목을 찾을 수 없습니다');
  const pos = await db.first<{ p: number | null }>('SELECT MAX(position) AS p FROM workout_session_exercises WHERE session_id = ?', [sessionId]);
  const seId = uid('se');
  // 자유 운동은 첫 종목을 고른 순간부터 시간을 센다 (종목 고르기 전 시간은 운동 시간이 아님)
  const free = await db.first<{ is_free: number; n: number }>(
    'SELECT s.is_free AS is_free, (SELECT COUNT(*) FROM workout_session_exercises WHERE session_id = s.id) AS n FROM workout_sessions s WHERE s.id = ?', [sessionId]);
  await db.transaction(async () => {
    if (free && free.is_free && free.n === 0) await db.run('UPDATE workout_sessions SET started_at = ? WHERE id = ?', [nowIso(), sessionId]);
    await db.run(
      'INSERT INTO workout_session_exercises (id, session_id, exercise_id, exercise_name, weight_mode, position, intensity) VALUES (?,?,?,?,?,?,NULL)',
      [seId, sessionId, exerciseId, ex.name, ex.weight_mode, (pos?.p ?? -1) + 1],
    );
    // 중량·횟수는 비워 둔다. 입력 칸을 누르면 앞 세트(첫 세트는 지난 기록) 값에서 시작한다.
    for (let i = 1; i <= sets; i++) await newSet(db, seId, i, 'working', null, null);
  });
  return seId;
}

/**
 * 대체 운동: 아직 완료한 세트가 없는 종목을 다른 종목으로 바꾼다 (세트 수·순서·슈퍼세트·메모는 그대로,
 * 입력만 해 두고 완료하지 않은 중량·횟수는 비운다). 완료한 세트가 있으면 false를 돌려주고 바꾸지 않는다.
 */
export async function replaceSessionExercise(db: Db, seId: string, newExerciseId: string): Promise<boolean> {
  const ex = await db.first<ExerciseRow>('SELECT * FROM exercises WHERE id = ?', [newExerciseId]);
  const done = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM workout_sets WHERE session_exercise_id = ? AND done = 1', [seId]);
  if (!ex || !done || done.n > 0) return false;
  await db.transaction(async () => {
    await db.run('UPDATE workout_session_exercises SET exercise_id = ?, exercise_name = ?, weight_mode = ? WHERE id = ?', [ex.id, ex.name, ex.weight_mode, seId]);
    await db.run('UPDATE workout_sets SET weight = NULL, reps = NULL WHERE session_exercise_id = ? AND done = 0', [seId]);
  });
  return true;
}

export async function removeSessionExercise(db: Db, seId: string): Promise<void> {
  await db.run('DELETE FROM workout_session_exercises WHERE id = ?', [seId]);
}

export async function addSet(db: Db, seId: string, type: SetType = 'working'): Promise<void> {
  const prev = await db.first<{ n: number | null }>('SELECT MAX(set_no) AS n FROM workout_sets WHERE session_exercise_id = ?', [seId]);
  await newSet(db, seId, (prev?.n ?? 0) + 1, type, null, null);
}

/** 연습 세트를 정해진 무게·횟수로 추가한다(완료 표시는 하지 않음) */
export async function addWarmupSets(db: Db, seId: string, plan: { weight: number; reps: number }[]): Promise<void> {
  await db.transaction(async () => {
    for (const w of plan) {
      const prev = await db.first<{ n: number | null }>('SELECT MAX(set_no) AS n FROM workout_sets WHERE session_exercise_id = ?', [seId]);
      await newSet(db, seId, (prev?.n ?? 0) + 1, 'warmup', w.weight, w.reps);
    }
  });
}

export async function deleteSet(db: Db, setId: string): Promise<void> {
  await db.run('DELETE FROM workout_sets WHERE id = ?', [setId]);
}

/** 변경 즉시 저장(자동 저장) — 필드별 부분 업데이트 */
export async function updateSet(
  db: Db, setId: string,
  patch: Partial<{ weight: number | null; reps: number | null; done: boolean; setType: SetType; kind: SetKind; intensity: Intensity | null }>,
): Promise<void> {
  const cols: string[] = [];
  const vals: SqlParam[] = [];
  if ('weight' in patch) { cols.push('weight = ?'); vals.push(patch.weight ?? null); }
  if ('reps' in patch) { cols.push('reps = ?'); vals.push(patch.reps ?? null); }
  if ('done' in patch) { cols.push('done = ?'); vals.push(patch.done ? 1 : 0); }
  if ('setType' in patch) { cols.push('set_type = ?'); vals.push(patch.setType ?? 'working'); }
  if ('kind' in patch) {
    // 준비 / 본 / 1RM — 1RM은 본 세트이면서 is_rm 표시가 붙은 세트
    cols.push('set_type = ?', 'is_rm = ?');
    vals.push(patch.kind === 'warmup' ? 'warmup' : 'working', patch.kind === 'rm' ? 1 : 0);
  }
  if ('intensity' in patch) { cols.push('intensity = ?'); vals.push(patch.intensity ?? null); }
  if (!cols.length) return;
  await db.run(`UPDATE workout_sets SET ${cols.join(', ')} WHERE id = ?`, [...vals, setId]);
}

export async function setExerciseIntensity(db: Db, seId: string, intensity: Intensity | null): Promise<void> {
  await db.run('UPDATE workout_session_exercises SET intensity = ? WHERE id = ?', [intensity, seId]);
}
export async function setSessionIntensity(db: Db, sessionId: string, intensity: Intensity | null): Promise<void> {
  await db.run('UPDATE workout_sessions SET intensity = ? WHERE id = ?', [intensity, sessionId]);
}
export async function setSessionNote(db: Db, sessionId: string, note: string): Promise<void> {
  await db.run('UPDATE workout_sessions SET note = ? WHERE id = ?', [note, sessionId]);
}
export async function setExerciseNote(db: Db, seId: string, note: string): Promise<void> {
  await db.run('UPDATE workout_session_exercises SET note = ? WHERE id = ?', [note, seId]);
}

export async function finishSession(db: Db, id: string): Promise<void> {
  const s = await db.first<{ started_at: string }>('SELECT started_at FROM workout_sessions WHERE id = ?', [id]);
  if (!s) return;
  const end = new Date();
  const dur = Math.max(0, Math.round((end.getTime() - new Date(s.started_at).getTime()) / 1000));
  await db.run("UPDATE workout_sessions SET status='done', ended_at=?, duration_sec=? WHERE id=?", [end.toISOString(), dur, id]);
}

/** 완료된 기록 다시 수정하기 */
export async function reopenSession(db: Db, id: string): Promise<void> {
  // 다시 열면 타이머가 '종료 이후 공백'을 세지 않도록, 기존 운동 시간을 이어서 흐르게 시작 시각을 맞춘다
  const s = await db.first<{ duration_sec: number | null }>('SELECT duration_sec FROM workout_sessions WHERE id = ?', [id]);
  const startedAt = s?.duration_sec != null ? new Date(Date.now() - s.duration_sec * 1000).toISOString() : null;
  await db.run(
    "UPDATE workout_sessions SET status='active', ended_at=NULL, started_at=COALESCE(?, started_at) WHERE id=?",
    [startedAt, id],
  );
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM workout_sessions WHERE id = ?', [id]);
}

/** 자유 운동(또는 완료된 운동)을 새 루틴으로 저장 */
export async function saveSessionAsTemplate(db: Db, sessionId: string, name: string): Promise<string> {
  const s = await loadSession(db, sessionId);
  if (!s) throw new Error('세션을 찾을 수 없습니다');
  return saveTemplate(db, {
    name,
    defaultIntensity: s.intensity ?? 'none',
    exercises: s.exercises.map((e) => {
      const working = e.sets.filter((x) => x.set_type === 'working' && !x.is_rm);
      const top = [...working].reverse().find((x) => x.weight != null);
      return {
        exerciseId: e.exercise_id,
        targetSets: Math.max(1, working.length),
        targetReps: top?.reps ?? null,
        targetWeight: top?.weight ?? null,
        intensity: e.intensity,
      };
    }),
  });
}

/* ============================== 통계용 조회 ============================== */

/** 완료(done)된 세션의 모든 세트를 강도 상속 결과와 함께 평탄화. 그래프는 항상 이 원본 기록에서 계산한다. */
export async function loadFlatSets(db: Db, exerciseId?: string): Promise<FlatSet[]> {
  const rows = await db.all<any>(
    `SELECT s.date AS date, s.id AS sessionId, se.exercise_id AS exerciseId, se.exercise_name AS exerciseName,
            st.set_no AS setNo, st.weight AS weight, st.reps AS reps, st.done AS done, st.set_type AS setType, COALESCE(st.is_rm,0) AS isRm,
            se.weight_mode AS weightMode,
            COALESCE(NULLIF(st.intensity,'none'), NULLIF(se.intensity,'none'), NULLIF(s.intensity,'none'), 'none') AS intensity
       FROM workout_sets st
       JOIN workout_session_exercises se ON se.id = st.session_exercise_id
       JOIN workout_sessions s ON s.id = se.session_id
      WHERE s.status = 'done' ${exerciseId ? 'AND se.exercise_id = ?' : ''}
      ORDER BY s.date, s.started_at, se.position, st.set_no`,
    exerciseId ? [exerciseId] : [],
  );
  return rows.map((r) => ({ ...r, done: !!r.done, isRm: !!r.isRm }));
}

/** 기록이 있는 종목 목록 (성장 분석 종목 선택용) */
export async function listTrackedExercises(db: Db): Promise<{ id: string; name: string; weight_mode: WeightMode; sessions: number; last_date: string }[]> {
  return db.all(
    `SELECT e.id AS id, e.name AS name, e.weight_mode AS weight_mode, COUNT(DISTINCT s.id) AS sessions, MAX(s.date) AS last_date
       FROM exercises e
       JOIN workout_session_exercises se ON se.exercise_id = e.id
       JOIN workout_sessions s ON s.id = se.session_id AND s.status = 'done'
       JOIN workout_sets st ON st.session_exercise_id = se.id AND st.done = 1
      GROUP BY e.id ORDER BY last_date DESC, e.name`,
  );
}

/* ---------- 성장 분석에서 볼 운동 (내 루틴에서 고른 것만) ---------- */

export async function getTrackedIds(db: Db): Promise<string[]> {
  const raw = await getSetting(db, 'tracked_exercises');
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];
  } catch { return []; }
}
export async function setTrackedIds(db: Db, ids: string[]): Promise<void> {
  await setSetting(db, 'tracked_exercises', JSON.stringify([...new Set(ids)]));
}
export async function toggleTracked(db: Db, id: string): Promise<boolean> {
  const ids = await getTrackedIds(db);
  const on = !ids.includes(id);
  await setTrackedIds(db, on ? [...ids, id] : ids.filter((x) => x !== id));
  return on;
}

export interface RoutineExercise { id: string; name: string; weight_mode: WeightMode; routines: string[] }

/** 내 루틴(모든 루틴·모든 날)에 들어 있는 운동 목록. 같은 운동은 한 번만, 어느 루틴에 있는지만 덧붙인다. */
export async function listRoutineExercises(db: Db, today: string): Promise<RoutineExercise[]> {
  const state = await getRoutines(db, today);
  const rows = await db.all<{ template_id: string; id: string; name: string; weight_mode: WeightMode }>(
    `SELECT w.template_id AS template_id, e.id AS id, e.name AS name, e.weight_mode AS weight_mode
       FROM workout_template_exercises w JOIN exercises e ON e.id = w.exercise_id
      ORDER BY w.position`);
  const byTpl = new Map<string, typeof rows>();
  for (const r of rows) byTpl.set(r.template_id, [...(byTpl.get(r.template_id) ?? []), r]);
  // 루틴 → 날 → 종목 순서로 훑어서, 같은 종목은 한 번만 담고 어느 루틴에 있는지만 덧붙인다 (항상 같은 순서)
  const out = new Map<string, RoutineExercise>();
  for (const r of state.routines) {
    for (const d of r.days) {
      for (const e of d.templateId ? byTpl.get(d.templateId) ?? [] : []) {
        const cur = out.get(e.id) ?? { id: e.id, name: e.name, weight_mode: e.weight_mode, routines: [] };
        if (!cur.routines.includes(r.name)) cur.routines.push(r.name);
        out.set(e.id, cur);
      }
    }
  }
  return [...out.values()];
}

export interface TrackedExercise { id: string; name: string; weight_mode: WeightMode }

/** 보기로 고른 운동 (고른 순서). 지워졌거나 보관된 종목은 제외 */
export async function listWatchedExercises(db: Db): Promise<TrackedExercise[]> {
  const ids = await getTrackedIds(db);
  if (!ids.length) return [];
  const rows = await db.all<TrackedExercise & { archived: number }>(
    `SELECT id, name, weight_mode, archived FROM exercises WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    return r && !r.archived ? [{ id: r.id, name: r.name, weight_mode: r.weight_mode }] : [];
  });
}

/* ============================== 캘린더 / 주간 통계 ============================== */

export async function sessionsOnDate(db: Db, date: string): Promise<SessionMeta[]> {
  return db.all<SessionMeta>('SELECT * FROM workout_sessions WHERE date = ? ORDER BY started_at', [date]);
}

export async function monthMarks(db: Db, ym: string): Promise<Record<string, { done: number; active: number; cardio: number }>> {
  const out: Record<string, { done: number; active: number; cardio: number }> = {};
  const get = (d: string) => (out[d] ??= { done: 0, active: 0, cardio: 0 });
  const s = await db.all<{ date: string; status: string; n: number }>(
    "SELECT date, status, COUNT(*) AS n FROM workout_sessions WHERE date LIKE ? GROUP BY date, status", [`${ym}-%`]);
  for (const r of s) {
    if (r.status === 'done') get(r.date).done += r.n;
    else get(r.date).active += r.n;
  }
  const c = await db.all<{ date: string; n: number }>('SELECT date, COUNT(*) AS n FROM cardio_sessions WHERE date LIKE ? GROUP BY date', [`${ym}-%`]);
  for (const r of c) get(r.date).cardio += r.n;
  return out;
}

export interface WeekStats { workouts: number; sets: number; volume: number; cardioMin: number; days: number }

export async function weekStats(db: Db, today: string): Promise<WeekStats> {
  const from = weekStart(today);
  const to = addDays(from, 6);
  const w = await db.first<{ workouts: number; days: number }>(
    "SELECT COUNT(*) AS workouts, COUNT(DISTINCT date) AS days FROM workout_sessions WHERE status='done' AND date BETWEEN ? AND ?", [from, to]);
  const v = await db.first<{ sets: number; volume: number }>(
    `SELECT COUNT(*) AS sets, COALESCE(SUM(CASE WHEN st.weight IS NOT NULL AND st.reps IS NOT NULL THEN st.weight * st.reps ELSE 0 END),0) AS volume
       FROM workout_sets st JOIN workout_session_exercises se ON se.id = st.session_exercise_id
       JOIN workout_sessions s ON s.id = se.session_id
      WHERE s.status='done' AND st.done=1 AND st.set_type='working' AND COALESCE(st.is_rm,0)=0 AND s.date BETWEEN ? AND ?`, [from, to]);
  const c = await db.first<{ m: number }>('SELECT COALESCE(SUM(duration_min),0) AS m FROM cardio_sessions WHERE date BETWEEN ? AND ?', [from, to]);
  return { workouts: w?.workouts ?? 0, days: w?.days ?? 0, sets: v?.sets ?? 0, volume: v?.volume ?? 0, cardioMin: c?.m ?? 0 };
}

/* ============================== 유산소 ============================== */

export async function addCardio(
  db: Db, v: { date: string; durationMin: number; intensity?: 'low' | 'mid' | 'high'; kind?: string; sessionId?: string | null; note?: string },
): Promise<string> {
  const id = uid('car');
  await db.run('INSERT INTO cardio_sessions (id, date, session_id, kind, intensity, duration_min, note, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    id, v.date, v.sessionId ?? null, v.kind ?? 'standalone', v.intensity ?? 'mid', v.durationMin, v.note ?? null, nowIso(),
  ]);
  return id;
}
export async function listCardio(db: Db, date: string) {
  return db.all<{ id: string; date: string; kind: string; intensity: string; duration_min: number; note: string | null }>(
    'SELECT * FROM cardio_sessions WHERE date = ? ORDER BY created_at', [date]);
}
export async function deleteCardio(db: Db, id: string) {
  await db.run('DELETE FROM cardio_sessions WHERE id = ?', [id]);
}

/* ============================== 신체 기록 ============================== */

export interface Measurement {
  id: string;
  date: string;
  weight: number | null;
  skeletal_muscle: number | null;
  body_fat_mass: number | null;
  body_fat_pct: number | null;
  source: string;
  image_uri: string | null;
}
export type MeasurementPatch = Partial<Pick<Measurement, 'weight' | 'skeletal_muscle' | 'body_fat_mass' | 'body_fat_pct' | 'image_uri'>> & { source?: string };

/** 날짜당 1건. 전달되지 않은 항목은 기존 값을 유지하고, 처음 저장하는 날의 누락 항목은 NULL */
export async function upsertMeasurement(db: Db, date: string, patch: MeasurementPatch): Promise<void> {
  const ex = await db.first<Measurement>('SELECT * FROM body_measurements WHERE date = ?', [date]);
  const pick = (k: keyof MeasurementPatch, cur: number | null | undefined) =>
    k in patch ? ((patch[k] as number | null | undefined) ?? null) : cur ?? null;
  if (ex) {
    await db.run(
      'UPDATE body_measurements SET weight=?, skeletal_muscle=?, body_fat_mass=?, body_fat_pct=?, source=?, image_uri=? WHERE id=?',
      [pick('weight', ex.weight), pick('skeletal_muscle', ex.skeletal_muscle), pick('body_fat_mass', ex.body_fat_mass),
        pick('body_fat_pct', ex.body_fat_pct), patch.source ?? ex.source, 'image_uri' in patch ? patch.image_uri ?? null : ex.image_uri, ex.id],
    );
  } else {
    await db.run(
      'INSERT INTO body_measurements (id, date, weight, skeletal_muscle, body_fat_mass, body_fat_pct, source, image_uri, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid('bm'), date, pick('weight', null), pick('skeletal_muscle', null), pick('body_fat_mass', null), pick('body_fat_pct', null),
        patch.source ?? 'manual', patch.image_uri ?? null, nowIso()],
    );
  }
}
export async function listMeasurements(db: Db): Promise<Measurement[]> {
  return db.all<Measurement>('SELECT * FROM body_measurements ORDER BY date');
}
export async function deleteMeasurement(db: Db, id: string) {
  const row = await db.first<{ date: string }>('SELECT date FROM body_measurements WHERE id = ?', [id]);
  await db.run('DELETE FROM body_measurements WHERE id = ?', [id]);
  if (row) {
    const extra = await getBodyExtra(db);
    let changed = false;
    for (const k of Object.keys(extra)) if (row.date in extra[k]) { delete extra[k][row.date]; changed = true; }
    if (changed) await setSetting(db, 'body_extra', JSON.stringify(extra));
  }
}

/* ---------- 신체 항목(기본 + 직접 추가) ---------- */

export async function getBodyMetrics(db: Db): Promise<BodyMetric[]> {
  return sanitizeMetrics(await getSetting(db, 'body_metrics'));
}
async function saveBodyMetrics(db: Db, list: BodyMetric[]): Promise<void> {
  await setSetting(db, 'body_metrics', JSON.stringify(list));
}
export async function addBodyMetric(db: Db, v: { label: string; unit: string }): Promise<BodyMetric> {
  const r = addCustomMetric(await getBodyMetrics(db), v);
  await saveBodyMetrics(db, r.list);
  return r.metric;
}
/** 직접 만든 항목의 이름·단위·색 변경 (기본 항목은 이름·단위를 바꾸지 않는다) */
export async function updateBodyMetric(db: Db, key: string, patch: { label?: string; unit?: string; color?: string }): Promise<void> {
  const list = await getBodyMetrics(db);
  const m = list.find((x) => x.key === key);
  if (!m || m.builtin) return;
  if (patch.label != null) {
    const label = patch.label.trim();
    if (!label) throw new Error('항목 이름을 입력하세요');
    if (list.some((x) => x.key !== key && x.label === label)) throw new Error('같은 이름의 항목이 이미 있습니다');
    m.label = label.slice(0, 20);
  }
  if (patch.unit != null) m.unit = patch.unit.trim().slice(0, 8);
  if (patch.color != null && /^#[0-9a-fA-F]{6}$/.test(patch.color)) m.color = patch.color.toUpperCase();
  await saveBodyMetrics(db, list);
}
/** 입력칸·그래프에서 숨기거나 다시 보인다 (기록은 지우지 않는다) */
export async function setBodyMetricHidden(db: Db, key: string, hidden: boolean): Promise<void> {
  const list = await getBodyMetrics(db);
  const m = list.find((x) => x.key === key);
  if (!m) return;
  m.hidden = hidden;
  await saveBodyMetrics(db, list);
}
/** 직접 만든 항목은 값까지 삭제, 기본 항목은 숨김만 한다 */
export async function removeBodyMetric(db: Db, key: string): Promise<void> {
  const list = await getBodyMetrics(db);
  const m = list.find((x) => x.key === key);
  if (!m) return;
  if (m.builtin) return setBodyMetricHidden(db, key, true);
  await saveBodyMetrics(db, list.filter((x) => x.key !== key));
  const extra = await getBodyExtra(db);
  if (key in extra) {
    delete extra[key];
    await setSetting(db, 'body_extra', JSON.stringify(extra));
  }
}
export async function getBodyExtra(db: Db): Promise<ExtraValues> {
  return sanitizeExtra(await getSetting(db, 'body_extra'));
}
/** 직접 만든 항목의 날짜별 값 저장 (value가 null이면 그 날의 값을 지움). 그날의 신체 기록 행도 만들어 둔다. */
export async function setBodyExtra(db: Db, key: string, date: string, value: number | null): Promise<void> {
  const list = await getBodyMetrics(db);
  if (!list.some((m) => m.key === key && !m.builtin)) throw new Error('없는 항목입니다');
  const extra = await getBodyExtra(db);
  if (value == null) {
    if (extra[key]) delete extra[key][date];
  } else {
    if (!Number.isFinite(value)) throw new Error('숫자를 입력하세요');
    (extra[key] ??= {})[date] = value;
    await upsertMeasurement(db, date, {});
  }
  await setSetting(db, 'body_extra', JSON.stringify(extra));
}

/** 내장 기본 항목 목록 (테스트·화면 공용) */
export const BUILTIN_BODY_KEYS = BUILTIN_METRICS.map((m) => m.key);


/* ============================== 설정 / 가져오기 ============================== */

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const r = await db.first<{ value: string | null }>('SELECT value FROM app_settings WHERE key = ?', [key]);
  return r?.value ?? null;
}
export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO app_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

/**
 * 미리보기에서 사용자가 수정을 마친 결과를 '루틴(사이클) 한 개'로 저장한다.
 * 파싱된 각 항목이 루틴의 날이 된다. 휴식/유산소 날은 종목 없이 저장.
 */
export async function applyImportedRoutine(
  db: Db, today: string, days: ParsedDay[], raw: string, format: string,
  opts: { name: string; mode?: RoutineMode; activate?: boolean },
): Promise<{ routineId: string; days: number }> {
  const mode = opts.mode ?? inferMode(days);
  let routineId = '';
  let count = 0;
  const placed: { id: string; weekday: number | null; rest: boolean }[] = [];
  await db.transaction(async () => {
    routineId = await createRoutine(db, today, { name: opts.name || '가져온 루틴', mode });
    for (const d of days) {
      const kind: DayKind = d.kind ?? (d.isRest && !d.exercises.length ? 'rest' : 'weights');
      if (kind === 'weights' && !d.exercises.length) continue;
      const exs: TemplateExerciseInput[] = [];
      if (kind === 'weights') {
        for (const e of d.exercises) {
          const ex = await getOrCreateExercise(db, e.name, e.category ? { category: e.category } : {});
          exs.push({ exerciseId: ex.id, targetSets: e.sets, targetReps: e.reps, targetWeight: e.weight, restSec: e.restSec });
        }
      }
      const dayId = await upsertDay(db, today, routineId, { name: d.title, kind, exercises: exs });
      placed.push({ id: dayId, weekday: d.weekday, rest: kind === 'rest' });
      count++;
    }
    // 칸 배치: 사이클은 가져온 순서대로 N칸(반복 일수 = 날 수), 요일 방식은 각 날의 요일 칸에 (휴식은 빈 칸)
    await mutateRoutine(db, today, routineId, (x) => {
      if (mode === 'cycle') return { ...x, slots: fitSlots('cycle', placed.map((p) => p.id)) };
      const slots: (string | null)[] = Array(7).fill(null);
      for (const p of placed) if (!p.rest && p.weekday != null && slots[p.weekday] == null) slots[p.weekday] = p.id;
      return { ...x, slots };
    });
    if (opts.activate) await setActiveRoutine(db, today, routineId);
    await db.run('INSERT INTO imported_routines (id, created_at, raw_text, format, parsed_json, applied) VALUES (?,?,?,?,?,1)', [
      uid('imp'), nowIso(), raw, format, JSON.stringify(days),
    ]);
  });
  return { routineId, days: count };
}

/** 자유 운동을 사용 중인 루틴의 새 날로 저장 (루틴이 없으면 '내 루틴'을 만든다) */
export async function saveSessionAsDay(db: Db, today: string, sessionId: string, name: string): Promise<{ routineId: string; dayId: string }> {
  const s = await loadSession(db, sessionId);
  if (!s) throw new Error('세션을 찾을 수 없습니다');
  let routineId = (await getRoutines(db, today)).activeId;
  if (!routineId) routineId = await createRoutine(db, today, { name: '내 루틴' });
  const exercises: TemplateExerciseInput[] = s.exercises.map((e) => {
    const working = e.sets.filter((x) => x.set_type === 'working' && !x.is_rm);
    const top = [...working].reverse().find((x) => x.weight != null);
    return { exerciseId: e.exercise_id, targetSets: Math.max(1, working.length), targetReps: top?.reps ?? null, targetWeight: top?.weight ?? null, ss: e.ss };
  });
  const dayId = await upsertDay(db, today, routineId, { name, kind: 'weights', exercises });
  return { routineId, dayId };
}


/* ============================== 홈: 루틴 카드 · 오늘 변경 · 보관 ============================== */

export interface TemplateCard {
  id: string;
  name: string;
  count: number;
  parts: { part: string; sets: number }[];
  /** 마지막으로 완료한 날짜 (없으면 null) */
  lastDate: string | null;
}

/** 홈의 '내 루틴' 카드 데이터: 종목 수, 부위별 세트 수, 마지막으로 한 날 */
export async function getTemplateCards(db: Db): Promise<TemplateCard[]> {
  const tpls = await listTemplates(db);
  const last = await db.all<{ template_id: string; d: string }>(
    "SELECT template_id, MAX(date) AS d FROM workout_sessions WHERE status = 'done' AND template_id IS NOT NULL GROUP BY template_id",
  );
  const lastBy = new Map(last.map((r) => [r.template_id, r.d]));
  const out: TemplateCard[] = [];
  for (const t of tpls) {
    const rows = await getTemplateExercises(db, t.id);
    out.push({ id: t.id, name: t.name, count: rows.length, parts: partSummary(rows), lastDate: lastBy.get(t.id) ?? null });
  }
  return out;
}

/** 오늘만 다른 날 루틴으로 하기 (일정은 그대로) */
export async function getTodayOverride(db: Db, today: string): Promise<string | null> {
  return decodeOverride(await getSetting(db, 'today_override'), today);
}
export async function setTodayOverride(db: Db, today: string, templateId: string | null): Promise<void> {
  await setSetting(db, 'today_override', encodeOverride(today, templateId));
}

/** 홈에서 숨긴(보관한) 루틴 */
export async function getArchivedTemplates(db: Db): Promise<string[]> {
  return parseIds(await getSetting(db, 'home_archived'));
}
export async function setArchivedTemplates(db: Db, ids: string[]): Promise<void> {
  await setSetting(db, 'home_archived', JSON.stringify([...new Set(ids)]));
}
