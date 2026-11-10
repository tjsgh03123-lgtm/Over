/**
 * 카메라 관절(33점)로 "지금 하는 동작이 어떤 유형인지" 추정한다. 운동 이름이 아니라 움직임 유형(스쿼트형·힙힌지형·컬형 …)만 구분한다.
 * 바벨/덤벨/머신 같은 도구는 관절만으로 알 수 없으므로 구분하지 않는다. 규칙·점수 방식이고 학습 모델이 아니다.
 * 임계값은 합성 자세로만 검증했고 실제 사람 영상으로는 아직 검증되지 않았다.
 */
import { COARSE_LABEL, type CoarsePattern } from './exerciseTable.ts';
import { JOINTS, jointAngle, MIN_VIS } from './liveCount.ts';

export type CamView = 'front' | 'side' | 'diag';
export const VIEW_LABEL: Record<CamView, string> = { front: '정면', side: '옆면', diag: '비스듬' };

export interface PoseFeatures {
  frames: number;
  view: CamView;
  /** 각도 변화 폭(도): 팔꿈치·무릎·고관절·어깨 */
  elbow: number; knee: number; hip: number; shoulder: number;
  /** 몸통 기울기(수직 기준, 도) 중앙값과 변화 폭 */
  tiltMed: number; tiltRange: number;
  /** 아래는 모두 몸통 길이(L) 대비 비율 */
  shoulderY: number; hipY: number; heel: number; shrug: number;
  wristY: number; wristX: number;
  /** 손목이 어깨보다 위(0.3L 이상)에 있던 프레임 비율, 손목의 가장 높은/낮은 위치(어깨 기준, 아래가 +) */
  wristAbove: number; wristTop: number; wristLow: number;
  /** 두 발목 사이 거리(L 대비)의 큰 값 — 런지는 앞뒤로 벌어짐 */
  ankleSep: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** lo 이하 0, hi 이상 1 */
const ramp = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo));
const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
/** 이상치를 피하려고 5%~95% 폭을 쓴다 */
function spread(a: number[]): number {
  if (a.length < 2) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const lo = s[Math.floor((s.length - 1) * 0.05)], hi = s[Math.ceil((s.length - 1) * 0.95)];
  return hi - lo;
}
const pct = (a: number[], q: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))] : 0; };

interface Pt { x: number; y: number }
function pair(lm: ArrayLike<number>, i: number, j: number, w: number, h: number): Pt | null {
  const ps: Pt[] = [];
  for (const k of [i, j]) if (lm[k * 3 + 2] >= MIN_VIS) ps.push({ x: lm[k * 3] * w, y: lm[k * 3 + 1] * h });
  if (!ps.length) return null;
  return { x: ps.reduce((n, p) => n + p.x, 0) / ps.length, y: ps.reduce((n, p) => n + p.y, 0) / ps.length };
}
function one(lm: ArrayLike<number>, i: number, w: number, h: number): Pt | null {
  return lm[i * 3 + 2] >= MIN_VIS ? { x: lm[i * 3] * w, y: lm[i * 3 + 1] * h } : null;
}
function ang(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  return n === 0 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180) / Math.PI;
}

/** 어깨 폭 ÷ 몸통 길이로 카메라 방향을 추정: 크면 정면, 작으면 옆면 */
export function viewOf(frames: ArrayLike<number>[], w: number, h: number): CamView {
  const r: number[] = [];
  for (const lm of frames) {
    const a = one(lm, 11, w, h), b = one(lm, 12, w, h), s = pair(lm, 11, 12, w, h), hp = pair(lm, 23, 24, w, h);
    if (!a || !b || !s || !hp) continue;
    const L = Math.hypot(s.x - hp.x, s.y - hp.y);
    if (L > 1e-6) r.push(Math.abs(a.x - b.x) / L);
  }
  if (r.length < 3) return 'diag';
  const m = med(r);
  return m >= 0.65 ? 'front' : m <= 0.3 ? 'side' : 'diag';
}

/** 관절 떨림을 줄이려고 앞뒤 k프레임을 평균낸 복사본을 만든다(보이는 값만, 안 보이는 점은 그대로 둔다) */
export function smoothFrames(frames: ArrayLike<number>[], k = 5): Float32Array[] {
  const h = Math.floor(k / 2);
  return frames.map((f, i) => {
    const out = new Float32Array(99);
    for (let j = 0; j < 33; j++) {
      let sx = 0, sy = 0, n = 0;
      for (let q = Math.max(0, i - h); q <= Math.min(frames.length - 1, i + h); q++) {
        const g = frames[q];
        if (g[j * 3 + 2] >= MIN_VIS) { sx += g[j * 3]; sy += g[j * 3 + 1]; n++; }
      }
      out[j * 3 + 2] = f[j * 3 + 2];
      if (n && f[j * 3 + 2] >= MIN_VIS) { out[j * 3] = sx / n; out[j * 3 + 1] = sy / n; } else { out[j * 3] = f[j * 3]; out[j * 3 + 1] = f[j * 3 + 1]; }
    }
    return out;
  });
}

/** 최근 프레임들(각 33×3: x,y,신뢰도)에서 특징을 뽑는다. w,h = 화면 가로·세로 픽셀(비율 보정). 쓸 만한 프레임이 너무 적으면 null */
export function extractFeatures(raw: ArrayLike<number>[], w: number, h: number): PoseFeatures | null {
  const frames = smoothFrames(raw);
  const elbow: number[] = [], knee: number[] = [], hip: number[] = [], shoulder: number[] = [];
  const tilt: number[] = [], shY: number[] = [], hipY: number[] = [], heel: number[] = [], shr: number[] = [];
  const wY: number[] = [], wX: number[] = [], wRel: number[] = [], sep: number[] = [];
  let used = 0;
  // 몸통 길이는 프레임마다 달라지므로(기울면 짧아 보임) 중앙값 하나로 통일해 비율을 계산한다
  const Ls: number[] = [];
  for (const lm of frames) {
    const S0 = pair(lm, 11, 12, w, h), H0 = pair(lm, 23, 24, w, h);
    if (S0 && H0) { const l = Math.hypot(S0.x - H0.x, S0.y - H0.y); if (l > 1e-6) Ls.push(l); }
  }
  const L = med(Ls);
  if (Ls.length < 15 || L < 1e-6) return null;
  for (const lm of frames) {
    const S = pair(lm, 11, 12, w, h), H = pair(lm, 23, 24, w, h);
    if (!S || !H) continue;
    if (Math.hypot(S.x - H.x, S.y - H.y) < 1e-6) continue;
    used++;
    tilt.push((Math.atan2(Math.abs(S.x - H.x), Math.abs(S.y - H.y)) * 180) / Math.PI);
    shY.push(S.y / L); hipY.push(H.y / L);
    for (const [arr, jid] of [[elbow, 0], [knee, 1], [hip, 2], [shoulder, 3]] as [number[], number][]) {
      const a = jointAngle(lm, JOINTS[jid], w, h);
      if (a !== null) arr.push(a);
    }
    const wr = pair(lm, 15, 16, w, h);
    if (wr) { wY.push(wr.y / L); wX.push(wr.x / L); wRel.push((wr.y - S.y) / L); }
    const he = pair(lm, 29, 30, w, h);
    if (he) heel.push(he.y / L);
    const ear = pair(lm, 7, 8, w, h);
    if (ear) shr.push((S.y - ear.y) / L);
    const al = one(lm, 27, w, h), ar = one(lm, 28, w, h);
    if (al && ar) sep.push(Math.hypot(al.x - ar.x, al.y - ar.y) / L);
  }
  if (used < 15) return null;
  return {
    frames: used,
    view: viewOf(frames, w, h),
    elbow: spread(elbow), knee: spread(knee), hip: spread(hip), shoulder: spread(shoulder),
    tiltMed: med(tilt), tiltRange: spread(tilt),
    shoulderY: spread(shY), hipY: spread(hipY), heel: spread(heel), shrug: spread(shr),
    wristY: spread(wY), wristX: spread(wX),
    wristAbove: wRel.length ? wRel.filter((v) => v < -0.3).length / wRel.length : 0,
    wristTop: wRel.length ? pct(wRel, 0.05) : 0, wristLow: wRel.length ? pct(wRel, 0.95) : 0,
    ankleSep: pct(sep, 0.9),
  };
}

export interface Candidate { pattern: CoarsePattern; label: string; score: number; conf: number }
export interface Guess { top: Candidate[]; view: CamView; moving: boolean; note: string | null }

/** 여러 조건을 하나의 0~1 점수로: 가장 약한 조건을 크게 반영하되 나머지도 평균에 반영 */
function fit(...c: number[]): number {
  const mn = Math.min(...c), avg = c.reduce((a, b) => a + b, 0) / c.length;
  return 0.6 * mn + 0.4 * avg;
}

export function scorePatterns(f: PoseFeatures): Record<CoarsePattern, number> {
  const stillBody = 1 - ramp(f.shoulderY, 0.12, 0.25);
  const upright = 1 - ramp(f.tiltMed, 45, 70);
  const lying = ramp(f.tiltMed, 50, 80);
  const armsStill = 1 - ramp(f.elbow, 25, 50);
  const topUp = ramp(-f.wristTop, 0.3, 0.7);
  const front = f.view === 'front';

  let squat = fit(ramp(f.knee, 25, 70), ramp(f.hip, 25, 65), ramp(f.hipY, 0.15, 0.4), upright);
  if (!front) squat *= 1 - 0.5 * ramp(f.ankleSep, 0.7, 1.1);
  if (front) squat = Math.max(squat, 0.85 * fit(ramp(f.hipY, 0.2, 0.45), upright, armsStill));
  let hinge = fit(ramp(f.hip, 30, 70), 1 - ramp(f.knee, 30, 60), ramp(f.tiltRange, 15, 45), ramp(f.wristY, 0.35, 0.8));
  if (front) hinge *= 0.5;
  const lunge = fit(ramp(f.knee, 25, 60), ramp(f.ankleSep, 0.6, 1.0), ramp(f.hipY, 0.1, 0.3));
  const pushH = fit(lying, ramp(f.elbow, 40, 80), stillBody);
  const pushUp = fit(ramp(f.elbow, 40, 80), ramp(f.shoulderY, 0.15, 0.35), 1 - ramp(f.wristY, 0.1, 0.3), 1 - ramp(f.wristAbove, 0.3, 0.7));
  // 머리 위로 밀기 vs 수직 당기기는 관절 움직임이 서로 거울상이라 카메라로 확실히 가르기 어렵다 → 손목이 어깨 아래까지 내려오는 정도로만 약하게 가른다
  const lowDip = ramp(f.wristLow, 0.1, 0.35);
  const pushV = fit(ramp(f.elbow, 40, 80), topUp, upright, stillBody, ramp(f.wristY, 0.4, 0.8)) * (0.8 + 0.2 * (1 - lowDip));
  const pullDown = fit(ramp(f.elbow, 40, 80), topUp, ramp(f.wristY, 0.4, 0.8), stillBody, upright) * (0.8 + 0.2 * lowDip);
  const pullUp = fit(ramp(f.elbow, 40, 80), ramp(f.wristAbove, 0.5, 0.9), ramp(f.shoulderY, 0.2, 0.5), 1 - ramp(f.wristY, 0.1, 0.3), upright);
  const pullV = Math.max(pullDown, pullUp);
  const pullH = fit(ramp(f.elbow, 40, 80), ramp(f.wristX, 0.3, 0.7), 1 - ramp(f.wristY, 0.35, 0.7), 1 - ramp(-f.wristTop, 0.3, 0.6));
  const curlExt = fit(ramp(f.elbow, 50, 100), 1 - ramp(f.shoulder, 20, 40), stillBody);
  const lift = fit(ramp(f.shoulder, 35, 80), armsStill, stillBody);
  const shrug = fit(ramp(f.shrug, 0.06, 0.15), 1 - ramp(f.elbow, 20, 40), 1 - ramp(f.shoulder, 15, 30));
  const legExt = fit(ramp(f.knee, 35, 70), 1 - ramp(f.hipY, 0.1, 0.25), 1 - ramp(f.hip, 25, 45));
  const calf = fit(ramp(f.heel, 0.05, 0.12), 1 - ramp(f.knee, 20, 40), 1 - ramp(f.hip, 20, 40));
  const bridge = fit(ramp(f.hipY, 0.1, 0.3), armsStill, ramp(f.tiltMed, 30, 75), ramp(f.hip, 30, 70));
  const core = fit(Math.max(ramp(f.hip, 35, 80), ramp(f.tiltRange, 30, 60)), 1 - ramp(f.knee, 50, 80), 1 - ramp(f.elbow, 35, 60), ramp(f.tiltMed, 35, 70));
  return { squat, hinge, lunge, pushH, pushUp, pushV, pullV, pullH, curlExt, lift, shrug, legExt, calf, bridge, core };
}

const BASE = 0.3;
const MIN_BEST = 0.2; // 보정된 점수가 이보다 낮으면 "잘 모르겠다"
const MIN_MOVE = { angle: 20, body: 0.1 };

/** 특징 → 후보(점수 높은 순, 최대 3개). 거의 안 움직이면 moving=false */
export function classifyFeatures(f: PoseFeatures): Guess {
  const moving = Math.max(f.elbow, f.knee, f.hip, f.shoulder) >= MIN_MOVE.angle || Math.max(f.shoulderY, f.hipY, f.heel, f.shrug * 2) >= MIN_MOVE.body;
  const sc = scorePatterns(f);
  const arr = (Object.keys(sc) as CoarsePattern[]).map((p) => ({ pattern: p, score: sc[p] })).sort((a, b) => b.score - a.score);
  // 관계없는 유형도 0.3 안팎의 바닥 점수가 나오므로 0.3을 0으로 맞춰 늘린다. 확신도 = 후보들 사이에서 차지하는 몫
  const adj = arr.map((c) => ({ pattern: c.pattern, a: ramp(c.score, BASE, 1) }));
  const sum = adj.reduce((n, c) => n + c.a, 0);
  const top: Candidate[] = adj.slice(0, 3).filter((c, i) => i === 0 || c.a >= 0.15)
    .map((c) => ({ pattern: c.pattern, label: COARSE_LABEL[c.pattern], score: Math.round(c.a * 100) / 100, conf: Math.round((c.a / (sum + 0.15)) * 100) / 100 }));
  let note: string | null = null;
  if (f.view === 'front' && (top[0]?.pattern === 'squat' || top[0]?.pattern === 'hinge')) note = '정면에서는 무릎·고관절 각도를 못 봐서 덜 정확해요. 옆에서 찍으면 더 잘 맞아요';
  if (top.length >= 2 && (top[0].pattern === 'pushV' || top[0].pattern === 'pullV') && (top[1].pattern === 'pushV' || top[1].pattern === 'pullV')) note = '머리 위로 밀기와 당기기는 관절 움직임이 거의 같아 카메라로는 구분이 어려워요';
  if (!moving || !top.length || top[0].score < MIN_BEST) return { top: [], view: f.view, moving, note: null };
  return { top, view: f.view, moving, note };
}

export function classifyPose(frames: ArrayLike<number>[], w: number, h: number): Guess | null {
  const f = extractFeatures(frames, w, h);
  return f ? classifyFeatures(f) : null;
}

export type Verdict = { status: 'match' | 'close' | 'differ' | 'unknown'; text: string };
/** 루틴에 적힌 운동의 유형(expected)과 카메라 추정을 비교 */
export function verifyAgainst(expected: CoarsePattern | null, g: Guess | null): Verdict {
  if (!expected) return { status: 'unknown', text: '' };
  if (!g || !g.top.length) return { status: 'unknown', text: '' };
  if (g.top[0].pattern === expected) return { status: 'match', text: '루틴의 운동과 비슷한 동작이에요' };
  if (g.top.some((c) => c.pattern === expected)) return { status: 'close', text: `루틴은 ${COARSE_LABEL[expected]} — 비슷해 보이지만 확실하진 않아요` };
  return { status: 'differ', text: `루틴은 ${COARSE_LABEL[expected]}인데 다른 동작처럼 보여요` };
}
