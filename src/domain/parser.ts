import type { Intensity } from './types.ts';

export interface ParsedExercise {
  name: string;
  sets: number;
  reps: number | null;
  repsMax: number | null;
  weight: number | null;
  intensity: Intensity | null;
  restSec: number | null;
}

export interface ParsedDay {
  weekday: number | null; // 0=일 … 6=토
  title: string;
  intensity: Intensity | null;
  isRest: boolean;
  /** JSON의 type 값(weights/cardio/rest). 없으면 isRest로 판단 */
  kind?: 'weights' | 'cardio' | 'rest';
  exercises: ParsedExercise[];
}

export interface ParseResult {
  format: 'json' | 'table' | 'text' | 'empty';
  days: ParsedDay[];
  warnings: string[];
  /** JSON에 루틴 이름·방식이 있으면 함께 돌려준다 (사이클 한 개 = 루틴 한 개) */
  routineName?: string;
  mode?: 'cycle' | 'weekday';
}

const DEFAULT_SETS = 3;

const KO_DAY: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const EN_DAY: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

export function parseWeekday(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) {
    if (v >= 0 && v <= 6) return v;
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const ko = /^([일월화수목금토])(?:요일)?$/.exec(s);
  if (ko) return KO_DAY[ko[1]];
  const en = EN_DAY[s.toLowerCase()];
  return en ?? null;
}

export function parseIntensity(v: unknown): Intensity | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/(고중량|high|heavy|강)/.test(s) && !/(중간|중강)/.test(s)) return 'high';
  if (/(중간중량|중강도|중량중|mid|moderate|medium)/.test(s)) return 'mid';
  if (/(저중량|low|light|약)/.test(s)) return 'low';
  if (/(미지정|none|unset)/.test(s)) return 'none';
  return null;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /-?\d+(?:\.\d+)?/.exec(v);
    if (m) return Number(m[0]);
  }
  return null;
}

function parseRestToSec(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = /(\d+(?:\.\d+)?)\s*(초|s|sec|seconds?|분|m|min|minutes?)?/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? '초').toLowerCase();
  return /^(분|m|min|minute)/.test(unit) ? Math.round(n * 60) : Math.round(n);
}

/* ------------------------------ JSON ------------------------------ */

function exerciseFromObj(o: Record<string, unknown>, warnings: string[]): ParsedExercise | null {
  const name = String(o.name ?? o.exercise ?? o.title ?? '').trim();
  if (!name) {
    warnings.push('이름이 없는 종목을 건너뜀');
    return null;
  }
  let reps: number | null = null;
  let repsMax: number | null = null;
  const r = o.reps ?? o.repetitions;
  if (typeof r === 'string') {
    const m = /(\d+)\s*[-~–]\s*(\d+)/.exec(r);
    if (m) {
      reps = Number(m[1]);
      repsMax = Number(m[2]);
    } else reps = toNum(r);
  } else reps = toNum(r);
  if (o.repsMax != null) repsMax = toNum(o.repsMax);
  return {
    name,
    sets: toNum(o.sets) ?? DEFAULT_SETS,
    reps,
    repsMax,
    weight: toNum(o.weight ?? o.weightKg),
    intensity: parseIntensity(o.intensity),
    restSec: o.restSec != null ? toNum(o.restSec) : parseRestToSec(o.rest),
  };
}

function parseJson(src: string): ParseResult | null {
  let data: unknown;
  try {
    data = JSON.parse(src);
  } catch {
    return null;
  }
  const warnings: string[] = [];
  let list: unknown[] = [];
  let routineName: string | undefined;
  let mode: 'cycle' | 'weekday' | undefined;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    // 새 형식: { routine: { name, mode, days: [...] } }
    const root = d.routine && typeof d.routine === 'object' && !Array.isArray(d.routine) ? (d.routine as Record<string, unknown>) : d;
    if (typeof root.name === 'string' && root.name.trim() && (Array.isArray(root.days) || root !== d)) routineName = root.name.trim();
    if (root.mode === 'cycle' || root.mode === 'weekday') mode = root.mode;
    const cand = root.days ?? root.routines ?? root.workouts ?? root.schedule ?? d.routines;
    if (Array.isArray(cand)) list = cand;
    else if (Array.isArray(d.exercises)) list = [d];
  }
  const days: ParsedDay[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const exs = Array.isArray(o.exercises) ? o.exercises : [];
    const exercises: ParsedExercise[] = [];
    for (const e of exs) {
      if (e && typeof e === 'object') {
        const pe = exerciseFromObj(e as Record<string, unknown>, warnings);
        if (pe) exercises.push(pe);
      }
    }
    const weekday = parseWeekday(o.weekday ?? o.day);
    const title = String(o.name ?? o.title ?? (weekday != null ? '' : '루틴')).trim();
    const t = String(o.type ?? o.kind ?? '').toLowerCase();
    const kind: ParsedDay['kind'] = t === 'cardio' || t === '유산소' ? 'cardio' : t === 'rest' || t === '휴식' ? 'rest' : t === 'weights' || t === '웨이트' ? 'weights' : undefined;
    days.push({
      weekday,
      title: title || weekdayLabel(weekday),
      intensity: parseIntensity(o.intensity),
      isRest: kind === 'rest' || o.rest === true || o.isRest === true || (exercises.length === 0 && kind !== 'cardio' && /휴식|rest/i.test(title)),
      kind,
      exercises,
    });
  }
  if (!days.length) warnings.push('JSON에서 루틴을 찾지 못했습니다 (routine.days 배열 필요)');
  return { format: 'json', days, warnings, routineName, mode };
}

export function weekdayLabel(w: number | null): string {
  return w == null ? '루틴' : ['일', '월', '화', '수', '목', '금', '토'][w] + '요일';
}

/* ------------------------------ 텍스트 ------------------------------ */

const DAY_HEADER =
  /^\s*(?:#{1,6}\s*|[-*•]\s+|\*\*|__)?\s*(?:day\s*\d+\s*[:.\-–—]?\s*)?(?:(월|화|수|목|금|토|일)(?:요일|(?![가-힣]))|(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?(?![a-z]))/i;

function stripDecor(line: string): string {
  return line
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:#{1,6}\s*)/, '')
    .replace(/^\s*(?:[-*•▪◦]\s+|\d+\s*[.)]\s+|\(\d+\)\s*)/, '')
    .trim();
}

interface LineFields {
  name: string;
  sets: number | null;
  reps: number | null;
  repsMax: number | null;
  weight: number | null;
  intensity: Intensity | null;
  restSec: number | null;
  hasPattern: boolean;
}

function extractFields(raw: string): LineFields {
  let s = raw;
  let sets: number | null = null;
  let reps: number | null = null;
  let repsMax: number | null = null;
  let weight: number | null = null;
  let restSec: number | null = null;
  let hasPattern = false;

  // 휴식
  const rest = /(?:휴식|rest)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(초|분|s|sec|min|m)?/i.exec(s);
  if (rest) {
    restSec = parseRestToSec(`${rest[1]}${rest[2] ?? '초'}`);
    s = s.replace(rest[0], ' ');
  }
  // 중량
  const w = /(\d+(?:\.\d+)?)\s*kg/i.exec(s);
  if (w) {
    weight = Number(w[1]);
    hasPattern = true;
    s = s.replace(w[0], ' ');
  }
  // 3x10, 3×8-12, 3 x 10회
  const sx = /(\d+)\s*(?:x|×|\*)\s*(\d+)(?:\s*[-~–]\s*(\d+))?/i.exec(s);
  if (sx) {
    sets = Number(sx[1]);
    reps = Number(sx[2]);
    repsMax = sx[3] ? Number(sx[3]) : null;
    hasPattern = true;
    s = s.replace(sx[0], ' ');
  } else {
    const st = /(\d+)\s*(?:세트|sets?)/i.exec(s);
    if (st) {
      sets = Number(st[1]);
      hasPattern = true;
      s = s.replace(st[0], ' ');
    }
    const rp = /(\d+)(?:\s*[-~–]\s*(\d+))?\s*(?:회|reps?|repetitions?)/i.exec(s);
    if (rp) {
      reps = Number(rp[1]);
      repsMax = rp[2] ? Number(rp[2]) : null;
      hasPattern = true;
      s = s.replace(rp[0], ' ');
    }
  }
  const intensity = parseIntensity(
    /(고중량|중간중량|저중량|heavy|moderate|medium|light)/i.exec(s)?.[1] ?? '',
  );
  s = s.replace(/(고중량|중간중량|저중량|heavy|moderate|medium|light)/gi, ' ');
  if (intensity) hasPattern = true;

  const name = s
    .replace(/[@:：—–\-,;()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, sets, reps, repsMax, weight, intensity, restSec, hasPattern };
}

function dayFromHeader(line: string): ParsedDay | null {
  const m = DAY_HEADER.exec(line);
  if (!m) return null;
  const rest = line.slice(m[0].length);
  // 같은 줄에 세트×횟수 패턴이 있으면 헤더가 아니라 종목 줄
  if (/\d+\s*(?:x|×)\s*\d+/i.test(rest) || /\d+\s*kg/i.test(rest)) return null;
  const weekday = m[1] ? KO_DAY[m[1]] : EN_DAY[m[2].toLowerCase()];
  const title = stripDecor(rest).replace(/^[:：\-–—\s]+/, '').replace(/[:：*#\s]+$/, '').trim();
  const intensity = parseIntensity(/(고중량|중간중량|저중량|heavy|moderate|light)/i.exec(title)?.[1] ?? '');
  return {
    weekday,
    title: title || weekdayLabel(weekday),
    intensity,
    isRest: /휴식|rest|off/i.test(title) || /^\s*$/.test(title) && false,
    exercises: [],
  };
}

function parseText(src: string): ParseResult {
  const warnings: string[] = [];
  const days: ParsedDay[] = [];
  let cur: ParsedDay | null = null;
  const ensure = () => {
    if (!cur) {
      cur = { weekday: null, title: '가져온 루틴', intensity: null, isRest: false, exercises: [] };
      days.push(cur);
    }
    return cur;
  };

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-=_*]{3,}$/.test(line)) continue;

    const header = dayFromHeader(line);
    if (header) {
      cur = header;
      days.push(cur);
      continue;
    }
    const isBullet = /^\s*(?:[-*•▪◦]\s+|\d+\s*[.)]\s+|\(\d+\)\s*)/.test(line);
    const cleaned = stripDecor(line);
    if (!cleaned) continue;

    // 단순 "Day 2: 하체" 류 제목
    const dayN = /^(?:day\s*\d+|\d+\s*일차)\s*[:.\-–—]?\s*(.*)$/i.exec(cleaned);
    if (dayN && !/\d+\s*(?:x|×)\s*\d+/i.test(cleaned)) {
      cur = { weekday: null, title: dayN[1].trim() || cleaned, intensity: null, isRest: /휴식|rest/i.test(cleaned), exercises: [] };
      days.push(cur);
      continue;
    }

    const f = extractFields(cleaned);
    if (!f.name) continue;
    if (!isBullet && !f.hasPattern) {
      // 글머리표도 패턴도 없는 줄: 제목(콜론 종료) 또는 설명문으로 간주
      if (/[:：]$/.test(line) || /^#{1,6}\s/.test(line)) {
        cur = { weekday: null, title: f.name, intensity: null, isRest: /휴식|rest/i.test(f.name), exercises: [] };
        days.push(cur);
      }
      continue;
    }
    if (/^(휴식일?|rest(?:\s*day)?)$/i.test(f.name) && !f.hasPattern) {
      ensure().isRest = true;
      continue;
    }
    ensure().exercises.push({
      name: f.name,
      sets: f.sets ?? DEFAULT_SETS,
      reps: f.reps,
      repsMax: f.repsMax,
      weight: f.weight,
      intensity: f.intensity,
      restSec: f.restSec,
    });
  }
  return { format: 'text', days: days.filter((d) => d.exercises.length || d.isRest || d.weekday != null), warnings };
}

/* ------------------------------ 표 ------------------------------ */

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.replace(/\*\*|`/g, '').trim());
}

type Col = 'day' | 'name' | 'sets' | 'reps' | 'weight' | 'intensity' | 'rest' | 'setsreps' | 'unknown';

function classifyHeader(h: string): Col {
  const s = h.toLowerCase().replace(/\s+/g, '');
  if (/(세트.*(횟수|반복|렙|rep)|sets?.*reps?|세트x)/.test(s)) return 'setsreps';
  if (/(요일|^day|weekday)/.test(s)) return 'day';
  if (/(운동|종목|exercise|name|동작)/.test(s)) return 'name';
  if (/(휴식|rest)/.test(s)) return 'rest';
  if (/(강도|intensity)/.test(s)) return 'intensity';
  if (/(중량|무게|weight|kg)/.test(s)) return 'weight';
  if (/(세트|sets?)/.test(s)) return 'sets';
  if (/(횟수|반복|렙|reps?)/.test(s)) return 'reps';
  return 'unknown';
}

function parseTable(src: string): ParseResult | null {
  const lines = src.split(/\r?\n/).map((l) => l.trim());
  const tableLines = lines.filter((l) => l.startsWith('|') && l.split('|').length >= 3);
  if (tableLines.length < 2) return null;
  const warnings: string[] = [];
  const days: ParsedDay[] = [];
  let cols: Col[] | null = null;
  let curDay: ParsedDay | null = null;
  let lastWeekday: number | null = null;

  for (const line of tableLines) {
    const cells = splitRow(line);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
    if (!cols) {
      const guess = cells.map(classifyHeader);
      if (guess.includes('name')) {
        cols = guess;
        continue;
      }
      continue;
    }
    const get = (k: Col) => {
      const i = cols!.indexOf(k);
      return i >= 0 ? cells[i] ?? '' : '';
    };
    const name = get('name');
    if (!name) continue;
    const dayCell = get('day');
    let wd: number | null = lastWeekday;
    if (dayCell) {
      const direct = parseWeekday(dayCell.replace(/요일$/, ''));
      const viaHeader: number | null = direct == null && DAY_HEADER.test(dayCell) ? dayFromHeader(dayCell)?.weekday ?? null : null;
      wd = direct ?? viaHeader;
      lastWeekday = wd;
    }
    if (!curDay || curDay.weekday !== wd) {
      curDay = { weekday: wd, title: weekdayLabel(wd), intensity: null, isRest: false, exercises: [] };
      days.push(curDay);
    }
    let sets: number | null = toNum(get('sets'));
    let reps: number | null = toNum(get('reps'));
    let repsMax: number | null = null;
    const repsCell = get('reps');
    const rr = /(\d+)\s*[-~–]\s*(\d+)/.exec(repsCell);
    if (rr) {
      reps = Number(rr[1]);
      repsMax = Number(rr[2]);
    }
    const combo = get('setsreps');
    if (combo) {
      const f = extractFields(combo);
      sets = f.sets ?? sets;
      reps = f.reps ?? reps;
      repsMax = f.repsMax ?? repsMax;
    } else if (sets == null && reps == null) {
      const f = extractFields(name);
      sets = f.sets;
    }
    curDay.exercises.push({
      name: extractFields(name).name || name,
      sets: sets ?? DEFAULT_SETS,
      reps,
      repsMax,
      weight: toNum(get('weight')),
      intensity: parseIntensity(get('intensity')),
      restSec: get('rest') ? parseRestToSec(get('rest')) : null,
    });
  }
  if (!cols) warnings.push('표 머리글에서 "운동/종목" 열을 찾지 못했습니다');
  if (!days.length) return null;
  return { format: 'table', days, warnings };
}

/* ------------------------------ 진입점 ------------------------------ */

export function parseRoutine(input: string): ParseResult {
  // 코드 펜스 제거 (```json ... ```)
  let src = input.trim();
  const fence = /```(?:json|markdown|md|text)?\s*\n([\s\S]*?)```/i.exec(src);
  if (fence) src = fence[1].trim();
  if (!src) return { format: 'empty', days: [], warnings: ['내용이 비어 있습니다'] };

  if (/^[\[{]/.test(src)) {
    const j = parseJson(src);
    if (j) return j;
  }
  const t = parseTable(src);
  if (t && t.days.some((d) => d.exercises.length)) return t;
  const r = parseText(src);
  if (!r.days.length) r.warnings.push('인식된 운동이 없습니다. JSON 형식 프롬프트를 사용해 보세요.');
  return r;
}
