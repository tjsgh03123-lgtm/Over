import { nowIso, uid, type Db, type SqlParam } from './adapter.ts';
import type { FlatSet, Intensity, SetType, WeightMode } from '../domain/types.ts';
import type { ParsedDay } from '../domain/parser.ts';
import { addDays, weekStart } from '../domain/stats.ts';

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

export async function setExerciseMode(db: Db, id: string, mode: WeightMode): Promise<void> {
  await db.run('UPDATE exercises SET weight_mode = ? WHERE id = ?', [mode, id]);
  await db.run('UPDATE workout_session_exercises SET weight_mode = ? WHERE exercise_id = ?', [mode, id]);
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
}

export async function listTemplates(db: Db): Promise<TemplateRow[]> {
  return db.all<TemplateRow>('SELECT id, name, default_intensity, post_cardio_min, is_default FROM workout_templates ORDER BY created_at, name');
}

export async function getTemplateExercises(db: Db, templateId: string): Promise<TemplateExerciseRow[]> {
  return db.all<TemplateExerciseRow>(
    `SELECT t.id, t.exercise_id, e.name, e.weight_mode, t.position, t.target_sets, t.target_reps, t.target_weight, t.intensity, t.rest_sec, t.note
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
          (id, template_id, exercise_id, position, target_sets, target_reps, target_weight, intensity, rest_sec, note)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [uid('twe'), id, e.exerciseId, pos++, e.targetSets ?? 3, e.targetReps ?? null, e.targetWeight ?? null,
          e.intensity ?? null, e.restSec ?? null, e.note ?? null],
      );
    }
  });
  return id;
}

/** 루틴을 삭제해도 완료된 운동 기록은 유지됨 (sessions.template_id → NULL) */
export async function deleteTemplate(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM workout_templates WHERE id = ?', [id]);
}

/* ============================== 요일 규칙 ============================== */

export interface ScheduleRule {
  id: string;
  weekday: number;
  kind: 'weights' | 'cardio' | 'rest';
  template_id: string | null;
  default_intensity: Intensity;
  label: string | null;
}

export async function getSchedule(db: Db): Promise<ScheduleRule[]> {
  return db.all<ScheduleRule>('SELECT * FROM schedule_rules ORDER BY (weekday + 6) % 7');
}
export async function getRuleForWeekday(db: Db, weekday: number): Promise<ScheduleRule | null> {
  return db.first<ScheduleRule>('SELECT * FROM schedule_rules WHERE weekday = ?', [weekday]);
}
export async function setScheduleRule(
  db: Db, weekday: number,
  v: { kind: ScheduleRule['kind']; templateId?: string | null; intensity?: Intensity; label?: string | null },
): Promise<void> {
  await db.run(
    `INSERT INTO schedule_rules (id, weekday, kind, template_id, default_intensity, label) VALUES (?,?,?,?,?,?)
     ON CONFLICT(weekday) DO UPDATE SET kind=excluded.kind, template_id=excluded.template_id,
       default_intensity=excluded.default_intensity, label=excluded.label`,
    [uid('sch'), weekday, v.kind, v.templateId ?? null, v.intensity ?? 'none', v.label ?? null],
  );
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
      WHERE se.exercise_id = ? AND s.status = 'done' AND st.done = 1 AND st.set_type = 'working' AND st.weight IS NOT NULL
      ORDER BY s.date DESC, s.started_at DESC, st.set_no DESC LIMIT 1`,
    [exerciseId],
  );
}

export async function getActiveSession(db: Db): Promise<SessionMeta | null> {
  return db.first<SessionMeta>("SELECT * FROM workout_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
}

export async function startSessionFromTemplate(db: Db, templateId: string, date: string): Promise<string> {
  const tpl = await db.first<TemplateRow>('SELECT * FROM workout_templates WHERE id = ?', [templateId]);
  if (!tpl) throw new Error('루틴을 찾을 수 없습니다');
  const exs = await getTemplateExercises(db, templateId);
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
        'INSERT INTO workout_session_exercises (id, session_id, exercise_id, exercise_name, weight_mode, position, intensity) VALUES (?,?,?,?,?,?,?)',
        [seId, sid, e.exercise_id, e.name, e.weight_mode, pos++, e.intensity],
      );
      for (let i = 1; i <= e.target_sets; i++) await newSet(db, seId, i, 'working', e.target_weight, e.target_reps);
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
  const last = await lastPerformance(db, exerciseId);
  await db.transaction(async () => {
    await db.run(
      'INSERT INTO workout_session_exercises (id, session_id, exercise_id, exercise_name, weight_mode, position, intensity) VALUES (?,?,?,?,?,?,NULL)',
      [seId, sessionId, exerciseId, ex.name, ex.weight_mode, (pos?.p ?? -1) + 1],
    );
    for (let i = 1; i <= sets; i++) await newSet(db, seId, i, 'working', last?.weight ?? null, last?.reps ?? null);
  });
  return seId;
}

export async function removeSessionExercise(db: Db, seId: string): Promise<void> {
  await db.run('DELETE FROM workout_session_exercises WHERE id = ?', [seId]);
}

export async function addSet(db: Db, seId: string, type: SetType = 'working'): Promise<void> {
  const prev = await db.first<{ n: number | null; w: number | null; r: number | null }>(
    `SELECT MAX(set_no) AS n,
       (SELECT weight FROM workout_sets WHERE session_exercise_id = ? ORDER BY set_no DESC LIMIT 1) AS w,
       (SELECT reps FROM workout_sets WHERE session_exercise_id = ? ORDER BY set_no DESC LIMIT 1) AS r
     FROM workout_sets WHERE session_exercise_id = ?`, [seId, seId, seId],
  );
  await newSet(db, seId, (prev?.n ?? 0) + 1, type, prev?.w ?? null, prev?.r ?? null);
}

export async function deleteSet(db: Db, setId: string): Promise<void> {
  await db.run('DELETE FROM workout_sets WHERE id = ?', [setId]);
}

/** 변경 즉시 저장(자동 저장) — 필드별 부분 업데이트 */
export async function updateSet(
  db: Db, setId: string,
  patch: Partial<{ weight: number | null; reps: number | null; done: boolean; setType: SetType; intensity: Intensity | null }>,
): Promise<void> {
  const cols: string[] = [];
  const vals: SqlParam[] = [];
  if ('weight' in patch) { cols.push('weight = ?'); vals.push(patch.weight ?? null); }
  if ('reps' in patch) { cols.push('reps = ?'); vals.push(patch.reps ?? null); }
  if ('done' in patch) { cols.push('done = ?'); vals.push(patch.done ? 1 : 0); }
  if ('setType' in patch) { cols.push('set_type = ?'); vals.push(patch.setType ?? 'working'); }
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
  await db.run("UPDATE workout_sessions SET status='active', ended_at=NULL WHERE id=?", [id]);
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
      const working = e.sets.filter((x) => x.set_type === 'working');
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
            st.set_no AS setNo, st.weight AS weight, st.reps AS reps, st.done AS done, st.set_type AS setType,
            se.weight_mode AS weightMode,
            COALESCE(NULLIF(st.intensity,'none'), NULLIF(se.intensity,'none'), NULLIF(s.intensity,'none'), 'none') AS intensity
       FROM workout_sets st
       JOIN workout_session_exercises se ON se.id = st.session_exercise_id
       JOIN workout_sessions s ON s.id = se.session_id
      WHERE s.status = 'done' ${exerciseId ? 'AND se.exercise_id = ?' : ''}
      ORDER BY s.date, s.started_at, se.position, st.set_no`,
    exerciseId ? [exerciseId] : [],
  );
  return rows.map((r) => ({ ...r, done: !!r.done }));
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
      WHERE s.status='done' AND st.done=1 AND st.set_type='working' AND s.date BETWEEN ? AND ?`, [from, to]);
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
  await db.run('DELETE FROM body_measurements WHERE id = ?', [id]);
}

/* ============================== 설정 / 가져오기 ============================== */

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const r = await db.first<{ value: string | null }>('SELECT value FROM app_settings WHERE key = ?', [key]);
  return r?.value ?? null;
}
export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO app_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

/** 미리보기에서 사용자가 수정을 마친 결과를 루틴으로 저장. 요일이 있으면 요일 규칙에 연결(옵션). */
export async function applyImportedRoutine(
  db: Db, days: ParsedDay[], raw: string, format: string, opts: { linkWeekdays: boolean },
): Promise<{ templates: number }> {
  let count = 0;
  await db.transaction(async () => {
    for (const d of days) {
      if (d.isRest && !d.exercises.length) {
        if (opts.linkWeekdays && d.weekday != null) await setScheduleRule(db, d.weekday, { kind: 'rest', label: '휴식' });
        continue;
      }
      if (!d.exercises.length) continue;
      const exs: TemplateExerciseInput[] = [];
      for (const e of d.exercises) {
        const ex = await getOrCreateExercise(db, e.name);
        exs.push({
          exerciseId: ex.id, targetSets: e.sets, targetReps: e.reps, targetWeight: e.weight,
          intensity: e.intensity, restSec: e.restSec,
        });
      }
      const tid = await saveTemplate(db, { name: d.title, defaultIntensity: d.intensity ?? 'none', exercises: exs });
      count++;
      if (opts.linkWeekdays && d.weekday != null) {
        await setScheduleRule(db, d.weekday, { kind: 'weights', templateId: tid, intensity: d.intensity ?? 'none', label: d.title });
      }
    }
    await db.run('INSERT INTO imported_routines (id, created_at, raw_text, format, parsed_json, applied) VALUES (?,?,?,?,?,1)', [
      uid('imp'), nowIso(), raw, format, JSON.stringify(days),
    ]);
  });
  return { templates: count };
}
