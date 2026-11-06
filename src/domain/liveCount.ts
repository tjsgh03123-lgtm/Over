/**
 * 실시간 횟수 세기의 순수 계산. 운동 종류를 몰라도 되도록, 카메라가 돌려주는 33개 관절에서
 * 팔꿈치·무릎·고관절·어깨 각도를 동시에 지켜보다가 '크게 반복해서 움직이는 관절'을 찾아 그 반복 횟수를 센다.
 */

export const LM_COUNT = 33;
export const MIN_VIS = 0.5;

export type JointId = 'elbow' | 'knee' | 'hip' | 'shoulder';

interface JointDef { id: JointId; label: string; l: [number, number, number]; r: [number, number, number] }

/** MediaPipe 관절 번호: [앞점, 꼭짓점, 뒷점] */
export const JOINTS: JointDef[] = [
  { id: 'elbow', label: '팔꿈치', l: [11, 13, 15], r: [12, 14, 16] },
  { id: 'knee', label: '무릎', l: [23, 25, 27], r: [24, 26, 28] },
  { id: 'hip', label: '고관절', l: [11, 23, 25], r: [12, 24, 26] },
  { id: 'shoulder', label: '어깨', l: [13, 11, 23], r: [14, 12, 24] },
];

export type Strictness = 'easy' | 'normal' | 'strict';
export const STRICT_LABEL: Record<Strictness, string> = { easy: '쉬움', normal: '보통', strict: '엄격' };
/** 한 번으로 세려면 각도가 이만큼(도) 이상 오르내려야 한다 */
const MIN_AMP: Record<Strictness, number> = { easy: 20, normal: 35, strict: 50 };

export function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180) / Math.PI;
}

/**
 * 프레임의 관절 배열(33×3: x,y,신뢰도 / x,y는 0~1)에서 관절 각도를 구한다.
 * 왼쪽·오른쪽 중 더 잘 보이는 쪽을 쓴다. 둘 다 안 보이면 null.
 * w,h는 화면 비율(가로·세로 픽셀) — 비율을 곱해야 각도가 왜곡되지 않는다.
 */
export function jointAngle(lm: ArrayLike<number>, def: JointDef, w: number, h: number): number | null {
  let best: { vis: number; ang: number } | null = null;
  for (const side of [def.l, def.r]) {
    const p = side.map((i) => ({ x: lm[i * 3] * w, y: lm[i * 3 + 1] * h, v: lm[i * 3 + 2] }));
    const vis = Math.min(p[0].v, p[1].v, p[2].v);
    if (vis < MIN_VIS) continue;
    if (!best || vis > best.vis) best = { vis, ang: angleDeg(p[0], p[1], p[2]) };
  }
  return best ? best.ang : null;
}

export interface RepEvent { n: number; timeMs: number; minAngle: number; joint: JointId }

const DECAY_DEG_PER_SEC = 3; // 움직임이 멈추면 '위/아래 끝' 기억이 이 속도로 좁혀진다
const MIN_REP_MS = 400;

/** 관절 하나의 오르내림 추적 */
class JointTracker {
  count = 0;
  reps: RepEvent[] = [];
  angle: number | null = null;
  hi = 0;
  lo = 0;
  phase: 'unknown' | 'up' | 'down' = 'unknown';
  private smooth: number | null = null;
  private lastT = 0;
  private lastHiT = 0;
  private minAngle = 999;
  private lostSince: number | null = null;

  readonly id: JointId;
  constructor(id: JointId) { this.id = id; }

  get amp() { return this.hi - this.lo; }

  reset() {
    this.count = 0; this.reps = []; this.angle = null; this.smooth = null; this.phase = 'unknown'; this.hi = 0; this.lo = 0;
    this.lostSince = null; this.minAngle = 999;
  }

  push(raw: number | null, tMs: number, minAmp: number): RepEvent | null {
    if (raw == null) {
      if (this.lostSince == null) this.lostSince = tMs;
      if (tMs - this.lostSince > 3000) { this.smooth = null; this.phase = 'unknown'; this.hi = 0; this.lo = 0; }
      return null;
    }
    this.lostSince = null;
    const first = this.smooth == null;
    this.smooth = first ? raw : (this.smooth as number) * 0.5 + raw * 0.5;
    const a = this.smooth;
    this.angle = a;
    if (first) { this.hi = a; this.lo = a; this.lastT = tMs; }
    const dt = Math.max(0, Math.min(1, (tMs - this.lastT) / 1000));
    this.lastT = tMs;
    this.hi = Math.max(a, this.hi - DECAY_DEG_PER_SEC * dt);
    this.lo = Math.min(a, this.lo + DECAY_DEG_PER_SEC * dt);
    const amp = this.amp;
    const hiT = this.lo + amp * 0.7;
    const loT = this.lo + amp * 0.3;

    if (a >= hiT) {
      let ev: RepEvent | null = null;
      if (this.phase === 'down') {
        const timeMs = tMs - this.lastHiT;
        if (amp >= minAmp && timeMs >= MIN_REP_MS) {
          this.count++;
          ev = { n: this.count, timeMs, minAngle: this.minAngle, joint: this.id };
          this.reps.push(ev);
        }
        this.minAngle = 999;
      }
      this.phase = 'up';
      this.lastHiT = tMs;
      return ev;
    }
    if (a <= loT && this.phase !== 'down') { this.phase = 'down'; this.minAngle = a; }
    else if (this.phase === 'down' && a < this.minAngle) this.minAngle = a;
    return null;
  }
}

/**
 * 운동 종류와 상관없이 횟수를 센다. 팔꿈치·무릎·고관절·어깨를 모두 지켜보고,
 * 가장 많이 반복된 관절(같으면 더 크게 움직인 관절)의 횟수를 보여 준다.
 */
export class AutoRepCounter {
  private trackers = JOINTS.map((j) => new JointTracker(j.id));
  private minAmp = MIN_AMP.normal;

  setStrictness(s: Strictness) { this.minAmp = MIN_AMP[s]; }

  reset() { this.trackers.forEach((t) => t.reset()); }

  /** 지금 가장 유력한 관절 */
  private get primary(): JointTracker {
    return this.trackers.reduce((b, t) => (t.count > b.count || (t.count === b.count && t.amp > b.amp) ? t : b));
  }

  get count() { return this.primary.count; }
  get reps() { return this.primary.reps; }
  get angle() { return this.primary.angle; }
  get phase() { return this.primary.phase; }
  /** 반복이 감지된 관절 이름 (아직 없으면 null) */
  get jointLabel(): string | null {
    const p = this.primary;
    return p.count > 0 ? JOINTS.find((j) => j.id === p.id)!.label : null;
  }
  get avgRepMs(): number | null {
    const r = this.reps;
    return r.length ? r.reduce((s, x) => s + x.timeMs, 0) / r.length : null;
  }

  /** 관절별 각도를 직접 넣는다 (테스트·재사용용). 이번 프레임에 1회가 완성되면 그 기록을 돌려준다. */
  pushAngles(angles: Partial<Record<JointId, number | null>>, tMs: number): RepEvent | null {
    const before = this.primary.count;
    const beforeId = this.primary.id;
    let completed: RepEvent | null = null;
    for (const t of this.trackers) {
      const ev = t.push(angles[t.id] ?? null, tMs, this.minAmp);
      if (ev) completed = ev;
    }
    const p = this.primary;
    if (p.count > before || (p.id !== beforeId && p.count > 0 && completed)) {
      return p.reps[p.reps.length - 1] ?? null;
    }
    return null;
  }

  push(lm: ArrayLike<number>, w: number, h: number, tMs: number): RepEvent | null {
    const a: Partial<Record<JointId, number | null>> = {};
    for (const j of JOINTS) a[j.id] = jointAngle(lm, j, w, h);
    return this.pushAngles(a, tMs);
  }
}
