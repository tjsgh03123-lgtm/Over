export const SCHEMA_VERSION = 1;

export const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  weight_mode TEXT NOT NULL DEFAULT 'weighted' CHECK (weight_mode IN ('weighted','bodyweight','assisted')),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);

CREATE TABLE IF NOT EXISTS exercise_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  alias TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  default_intensity TEXT NOT NULL DEFAULT 'none' CHECK (default_intensity IN ('high','mid','low','none')),
  post_cardio_min INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_template_exercises (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps INTEGER,
  target_weight REAL,
  intensity TEXT CHECK (intensity IN ('high','mid','low','none')),
  rest_sec INTEGER,
  note TEXT,
  ss TEXT
);
CREATE INDEX IF NOT EXISTS idx_wte_template ON workout_template_exercises(template_id, position);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  template_id TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  intensity TEXT CHECK (intensity IN ('high','mid','low','none')),
  is_free INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON workout_sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON workout_sessions(status);

CREATE TABLE IF NOT EXISTS workout_session_exercises (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  exercise_name TEXT NOT NULL,
  weight_mode TEXT NOT NULL DEFAULT 'weighted' CHECK (weight_mode IN ('weighted','bodyweight','assisted')),
  position INTEGER NOT NULL,
  intensity TEXT CHECK (intensity IN ('high','mid','low','none')),
  note TEXT,
  ss TEXT
);
CREATE INDEX IF NOT EXISTS idx_wse_session ON workout_session_exercises(session_id, position);
CREATE INDEX IF NOT EXISTS idx_wse_exercise ON workout_session_exercises(exercise_id);

CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT PRIMARY KEY NOT NULL,
  session_exercise_id TEXT NOT NULL REFERENCES workout_session_exercises(id) ON DELETE CASCADE,
  set_no INTEGER NOT NULL,
  weight REAL,
  reps INTEGER,
  done INTEGER NOT NULL DEFAULT 0,
  set_type TEXT NOT NULL DEFAULT 'working' CHECK (set_type IN ('warmup','working')),
  is_rm INTEGER DEFAULT 0,
  intensity TEXT CHECK (intensity IN ('high','mid','low','none')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sets_se ON workout_sets(session_exercise_id, set_no);

CREATE TABLE IF NOT EXISTS body_measurements (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL UNIQUE,
  weight REAL,
  skeletal_muscle REAL,
  body_fat_mass REAL,
  body_fat_pct REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  image_uri TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cardio_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  session_id TEXT REFERENCES workout_sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'standalone',
  intensity TEXT NOT NULL DEFAULT 'mid' CHECK (intensity IN ('low','mid','high')),
  duration_min REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cardio_date ON cardio_sessions(date);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id TEXT PRIMARY KEY NOT NULL,
  weekday INTEGER NOT NULL UNIQUE CHECK (weekday BETWEEN 0 AND 6),
  kind TEXT NOT NULL DEFAULT 'weights' CHECK (kind IN ('weights','cardio','rest')),
  template_id TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
  default_intensity TEXT NOT NULL DEFAULT 'none' CHECK (default_intensity IN ('high','mid','low','none')),
  label TEXT
);

CREATE TABLE IF NOT EXISTS imported_routines (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  format TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0
);
`;

/** 부모 → 자식 순서. 복원 시 삭제는 역순, 삽입은 이 순서. */
export const TABLE_COLUMNS: Record<string, string[]> = {
  app_settings: ['key', 'value'],
  exercises: ['id', 'name', 'category', 'weight_mode', 'archived', 'created_at'],
  exercise_aliases: ['id', 'exercise_id', 'alias'],
  workout_templates: ['id', 'name', 'default_intensity', 'post_cardio_min', 'is_default', 'created_at'],
  workout_template_exercises: [
    'id', 'template_id', 'exercise_id', 'position', 'target_sets', 'target_reps', 'target_weight', 'intensity', 'rest_sec', 'note', 'ss',
  ],
  workout_sessions: [
    'id', 'date', 'template_id', 'title', 'intensity', 'is_free', 'status', 'started_at', 'ended_at', 'duration_sec', 'note',
  ],
  workout_session_exercises: ['id', 'session_id', 'exercise_id', 'exercise_name', 'weight_mode', 'position', 'intensity', 'note', 'ss'],
  workout_sets: ['id', 'session_exercise_id', 'set_no', 'weight', 'reps', 'done', 'set_type', 'is_rm', 'intensity', 'created_at'],
  body_measurements: ['id', 'date', 'weight', 'skeletal_muscle', 'body_fat_mass', 'body_fat_pct', 'source', 'image_uri', 'created_at'],
  cardio_sessions: ['id', 'date', 'session_id', 'kind', 'intensity', 'duration_min', 'note', 'created_at'],
  schedule_rules: ['id', 'weekday', 'kind', 'template_id', 'default_intensity', 'label'],
  imported_routines: ['id', 'created_at', 'raw_text', 'format', 'parsed_json', 'applied'],
};
export const TABLE_ORDER = Object.keys(TABLE_COLUMNS);
