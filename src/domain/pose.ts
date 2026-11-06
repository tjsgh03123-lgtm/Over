/**
 * 영상 자세 분석의 순수 계산. 네이티브(MediaPipe)가 돌려주는 관절 좌표 배열을 받아
 * 각도·횟수·렙당 시간·가동 범위·신뢰도 구간을 계산하고, 저장용으로 압축/복원한다.
 *
 * track = Float32Array, 프레임마다 33개 관절 × (x, y, visibility). x,y는 0..1(영상 비율 기준).
 * 사람이 감지되지 않은 프레임은 전부 0 (visibility 0).
 */

export const LM_COUNT = 33;
export const LM_STRIDE = 3;
export const FRAME_STRIDE = LM_COUNT * LM_STRIDE;

/** MediaPipe 관절 번호 */
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
} as const;

/** 모델에 없는 가상의 점 (양쪽 점의 중간) */
export const VIRTUAL = { MID_SHOULDER: 100, MID_HIP: 101, MID_KNEE: 102 } as const;

export const POINT_LABEL: Record<number, string> = {
  [LM.NOSE]: '코',
  [LM.L_SHOULDER]: '왼쪽 어깨', [LM.R_SHOULDER]: '오른쪽 어깨',
  [LM.L_ELBOW]: '왼쪽 팔꿈치', [LM.R_ELBOW]: '오른쪽 팔꿈치',
  [LM.L_WRIST]: '왼쪽 손목', [LM.R_WRIST]: '오른쪽 손목',
  [LM.L_HIP]: '왼쪽 고관절', [LM.R_HIP]: '오른쪽 고관절',
  [LM.L_KNEE]: '왼쪽 무릎', [LM.R_KNEE]: '오른쪽 무릎',
  [LM.L_ANKLE]: '왼쪽 발목', [LM.R_ANKLE]: '오른쪽 발목',
  [VIRTUAL.MID_SHOULDER]: '어깨 중앙', [VIRTUAL.MID_HIP]: '골반 중앙', [VIRTUAL.MID_KNEE]: '무릎 중앙',
};

/** 화면에 그릴 뼈대 연결선 */
export const SKELETON: [number, number][] = [
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

/** 각도 정의: b가 꼭짓점인 a-b-c 세 점의 사이각 */
export interface AngleDef { id: string; label: string; a: number; b: number; c: number }

export const PRESET_ANGLES: AngleDef[] = [
  { id: 'elbow_l', label: '왼쪽 팔꿈치', a: LM.L_SHOULDER, b: LM.L_ELBOW, c: LM.L_WRIST },
  { id: 'elbow_r', label: '오른쪽 팔꿈치', a: LM.R_SHOULDER, b: LM.R_ELBOW, c: LM.R_WRIST },
  { id: 'knee_l', label: '왼쪽 무릎', a: LM.L_HIP, b: LM.L_KNEE, c: LM.L_ANKLE },
  { id: 'knee_r', label: '오른쪽 무릎', a: LM.R_HIP, b: LM.R_KNEE, c: LM.R_ANKLE },
  { id: 'hip_l', label: '왼쪽 고관절', a: LM.L_SHOULDER, b: LM.L_HIP, c: LM.L_KNEE },
  { id: 'hip_r', label: '오른쪽 고관절', a: LM.R_SHOULDER, b: LM.R_HIP, c: LM.R_KNEE },
  { id: 'shoulder_l', label: '왼쪽 어깨', a: LM.L_ELBOW, b: LM.L_SHOULDER, c: LM.L_HIP },
  { id: 'shoulder_r', label: '오른쪽 어깨', a: LM.R_ELBOW, b: LM.R_SHOULDER, c: LM.R_HIP },
  { id: 'trunk', label: '몸통 (어깨-골반-무릎)', a: VIRTUAL.MID_SHOULDER, b: VIRTUAL.MID_HIP, c: VIRTUAL.MID_KNEE },
];

export const MIN_VISIBILITY = 0.5;

export interface Pt { x: number; y: number; v: number }

/** 한 프레임의 점. x,y는 픽셀 비율(가로 W, 세로 H)로 환산해 각도가 왜곡되지 않게 한다. */
export function pointAt(track: ArrayLike<number>, frame: number, id: number, W = 1, H = 1): Pt {
  const base = frame * FRAME_STRIDE;
  const get = (i: number): Pt => ({
    x: track[base + i * LM_STRIDE] * W,
    y: track[base + i * LM_STRIDE + 1] * H,
    v: track[base + i * LM_STRIDE + 2],
  });
  if (id === VIRTUAL.MID_SHOULDER) return mid(get(LM.L_SHOULDER), get(LM.R_SHOULDER));
  if (id === VIRTUAL.MID_HIP) return mid(get(LM.L_HIP), get(LM.R_HIP));
  if (id === VIRTUAL.MID_KNEE) return mid(get(LM.L_KNEE), get(LM.R_KNEE));
  return get(id);
}

function mid(p: Pt, q: Pt): Pt {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, v: Math.min(p.v, q.v) };
}

/** b를 꼭짓점으로 하는 a-b-c 사이각 (0~180도) */
export function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function frameCountOf(track: ArrayLike<number>): number {
  return Math.floor(track.length / FRAME_STRIDE);
}

/** 프레임마다 각도. 세 점 중 하나라도 신뢰도가 낮으면 null */
export function angleSeries(
  track: ArrayLike<number>, def: { a: number; b: number; c: number }, W: number, H: number, minVis = MIN_VISIBILITY,
): (number | null)[] {
  const n = frameCountOf(track);
  const out: (number | null)[] = new Array(n).fill(null);
  for (let f = 0; f < n; f++) {
    const a = pointAt(track, f, def.a, W, H), b = pointAt(track, f, def.b, W, H), c = pointAt(track, f, def.c, W, H);
    if (a.v < minVis || b.v < minVis || c.v < minVis) continue;
    out[f] = angleDeg(a, b, c);
  }
  return out;
}

/** 프레임별 가장 낮은 신뢰도 (지정한 점들 기준) */
export function confidenceSeries(track: ArrayLike<number>, ids: number[]): number[] {
  const n = frameCountOf(track);
  const out: number[] = new Array(n).fill(0);
  for (let f = 0; f < n; f++) {
    let m = 1;
    for (const id of ids) m = Math.min(m, pointAt(track, f, id).v);
    out[f] = m;
  }
  return out;
}

/** 신뢰도가 기준보다 낮은 연속 구간 [시작프레임, 끝프레임] (끝 포함) */
export function lowRanges(conf: number[], thr = MIN_VISIBILITY): [number, number][] {
  const res: [number, number][] = [];
  let s = -1;
  for (let i = 0; i < conf.length; i++) {
    if (conf[i] < thr) { if (s < 0) s = i; }
    else if (s >= 0) { res.push([s, i - 1]); s = -1; }
  }
  if (s >= 0) res.push([s, conf.length - 1]);
  return res;
}

/** 짧은 빈칸(maxGap 프레임 이하)은 앞뒤 값으로 이어 채우고, 이동 평균으로 떨림을 줄인다. 긴 빈칸은 null 유지. */
export function smoothSeries(series: (number | null)[], window = 5, maxGap = 6): (number | null)[] {
  const n = series.length;
  const filled = series.slice();
  let i = 0;
  while (i < n) {
    if (filled[i] != null) { i++; continue; }
    let j = i;
    while (j < n && filled[j] == null) j++;
    const gap = j - i;
    if (i > 0 && j < n && gap <= maxGap) {
      const a = filled[i - 1] as number, b = filled[j] as number;
      for (let k = 0; k < gap; k++) filled[i + k] = a + ((b - a) * (k + 1)) / (gap + 1);
    }
    i = j;
  }
  const half = Math.floor(window / 2);
  return filled.map((v, k) => {
    if (v == null) return null;
    let sum = 0, cnt = 0;
    for (let d = -half; d <= half; d++) {
      const x = filled[k + d];
      if (x != null) { sum += x; cnt++; }
    }
    return cnt ? sum / cnt : v;
  });
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** 값의 5~95퍼센타일 범위 (튀는 값 무시) */
export function robustRange(series: (number | null)[]): { lo: number; hi: number; range: number; valid: number } {
  const vals = series.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (!vals.length) return { lo: 0, hi: 0, range: 0, valid: 0 };
  const lo = percentile(vals, 0.05), hi = percentile(vals, 0.95);
  return { lo, hi, range: hi - lo, valid: vals.length };
}

export interface Rep {
  startFrame: number; // 직전 꼭대기(가장 펴진) 프레임
  minFrame: number; // 각도가 가장 작은 프레임
  endFrame: number; // 다음 꼭대기 프레임
  timeMs: number;
  downMs: number;
  upMs: number;
  minAngle: number;
  maxAngle: number;
  romDeg: number;
}

export const MIN_REP_RANGE_DEG = 30;

/**
 * 각도 변화에서 반복 횟수를 센다. 위쪽 문턱(범위의 70%)과 아래쪽 문턱(30%)을 번갈아 지나야 1회.
 * 도중에 끝난 불완전한 동작은 세지 않는다.
 */
export function detectReps(series: (number | null)[], stepMs: number): Rep[] {
  const { lo, range } = robustRange(series);
  if (range < MIN_REP_RANGE_DEG) return [];
  const hiT = lo + range * 0.7;
  const loT = lo + range * 0.3;
  // 위쪽 구간(high)의 꼭대기 프레임과 아래쪽 구간(low)의 바닥 프레임을 번갈아 모은다.
  const highs: number[] = []; // 각 high 구간에서 각도가 가장 큰 프레임
  const lows: number[] = []; // 각 low 구간에서 각도가 가장 작은 프레임
  let state: 'none' | 'high' | 'low' = 'none';
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null) continue;
    if (v >= hiT) {
      if (state !== 'high') { highs.push(i); state = 'high'; }
      else if (v > (series[highs[highs.length - 1]] as number)) highs[highs.length - 1] = i;
    } else if (v <= loT && state === 'high') {
      lows.push(i);
      state = 'low';
    } else if (state === 'low' && v < (series[lows[lows.length - 1]] as number)) {
      lows[lows.length - 1] = i;
    }
  }
  // 한 번 = 꼭대기 → 바닥 → 다음 꼭대기. 도중에 끝난 동작은 세지 않는다.
  const reps: Rep[] = [];
  for (let k = 0; k < lows.length && k + 1 < highs.length; k++) {
    const startFrame = highs[k], minFrame = lows[k], endFrame = highs[k + 1];
    const maxAngle = Math.max(series[startFrame] as number, series[endFrame] as number);
    const minAngle = series[minFrame] as number;
    reps.push({
      startFrame, minFrame, endFrame,
      timeMs: (endFrame - startFrame) * stepMs, downMs: (minFrame - startFrame) * stepMs, upMs: (endFrame - minFrame) * stepMs,
      minAngle, maxAngle, romDeg: maxAngle - minAngle,
    });
  }
  return reps;
}

export interface Summary {
  count: number;
  avgRepMs: number | null;
  romDeg: number | null; // 렙들의 평균 가동 범위
  minAngle: number | null;
  maxAngle: number | null;
}

export function summarizeReps(reps: Rep[]): Summary {
  if (!reps.length) return { count: 0, avgRepMs: null, romDeg: null, minAngle: null, maxAngle: null };
  const avg = (f: (r: Rep) => number) => reps.reduce((s, r) => s + f(r), 0) / reps.length;
  return {
    count: reps.length,
    avgRepMs: avg((r) => r.timeMs),
    romDeg: avg((r) => r.romDeg),
    minAngle: Math.min(...reps.map((r) => r.minAngle)),
    maxAngle: Math.max(...reps.map((r) => r.maxAngle)),
  };
}

/** 움직임(각도 변화)이 가장 큰 기본 각도를 자동 선택. 아무것도 쓸 만하지 않으면 null */
export function autoPickPreset(track: ArrayLike<number>, W: number, H: number): AngleDef | null {
  const n = frameCountOf(track);
  if (n < 5) return null;
  let best: AngleDef | null = null;
  let bestRange = 0;
  for (const def of PRESET_ANGLES) {
    const r = robustRange(smoothSeries(angleSeries(track, def, W, H)));
    if (r.valid < n * 0.5) continue; // 절반 이상 보이지 않으면 제외
    if (r.range > bestRange) { bestRange = r.range; best = def; }
  }
  return bestRange >= MIN_REP_RANGE_DEG ? best : null;
}

// ---------- 분석 구간·시간 추정 ----------

export function frameCountFor(startMs: number, endMs: number, fps: number): number {
  return Math.max(0, Math.floor(((endMs - startMs) / 1000) * fps) + 1);
}

export function stepMsFor(fps: number): number {
  return 1000 / fps;
}

/** 프레임당 평균 처리 시간(ms)으로 남은/예상 시간(초)을 구한다 */
export function estimateSeconds(frames: number, msPerFrame: number): number {
  return Math.ceil((frames * msPerFrame) / 1000);
}

// ---------- 저장용 압축 (좌표 uint16, 신뢰도 uint8, base64 문자열) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REV: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_REV[B64[i]] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    parts.push(
      B64[b0 >> 2], B64[((b0 & 3) << 4) | (b1 >> 4)],
      i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=',
      i + 2 < bytes.length ? B64[b2 & 63] : '=',
    );
  }
  return parts.join('');
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  let pad = 0;
  if (clean.endsWith('==')) pad = 2; else if (clean.endsWith('=')) pad = 1;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_REV[clean[i]], c1 = B64_REV[clean[i + 1]];
    const c2 = clean[i + 2] === '=' ? 0 : B64_REV[clean[i + 2]];
    const c3 = clean[i + 3] === '=' ? 0 : B64_REV[clean[i + 3]];
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const BYTES_PER_LM = 5;

export function encodeTrack(track: ArrayLike<number>): string {
  const n = frameCountOf(track);
  const bytes = new Uint8Array(n * LM_COUNT * BYTES_PER_LM);
  let o = 0;
  for (let f = 0; f < n; f++) {
    for (let i = 0; i < LM_COUNT; i++) {
      const base = f * FRAME_STRIDE + i * LM_STRIDE;
      // x,y는 -0.5..1.5 범위를 uint16에 담는다 (화면 밖으로 약간 벗어난 점 허용)
      const qx = Math.round((Math.max(-0.5, Math.min(1.5, track[base])) + 0.5) * 32767.5);
      const qy = Math.round((Math.max(-0.5, Math.min(1.5, track[base + 1])) + 0.5) * 32767.5);
      const qv = Math.round(Math.max(0, Math.min(1, track[base + 2])) * 255);
      bytes[o++] = qx >> 8; bytes[o++] = qx & 255;
      bytes[o++] = qy >> 8; bytes[o++] = qy & 255;
      bytes[o++] = qv;
    }
  }
  return bytesToBase64(bytes);
}

export function decodeTrack(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const n = Math.floor(bytes.length / (LM_COUNT * BYTES_PER_LM));
  const out = new Float32Array(n * FRAME_STRIDE);
  let o = 0;
  for (let f = 0; f < n; f++) {
    for (let i = 0; i < LM_COUNT; i++) {
      const base = f * FRAME_STRIDE + i * LM_STRIDE;
      const qx = (bytes[o] << 8) | bytes[o + 1];
      const qy = (bytes[o + 2] << 8) | bytes[o + 3];
      out[base] = qx / 32767.5 - 0.5;
      out[base + 1] = qy / 32767.5 - 0.5;
      out[base + 2] = bytes[o + 4] / 255;
      o += BYTES_PER_LM;
    }
  }
  return out;
}

// ---------- 표시용 ----------

export function fmtSec(ms: number): string {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)}초`;
}

export function fmtClockMs(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100) / 10);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
