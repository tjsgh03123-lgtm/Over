/**
 * 실시간 횟수 세기의 순수 계산. 운동 종류를 몰라도 되도록, 카메라가 돌려주는 33개 관절에서
 * (1) 팔꿈치·무릎·고관절·어깨 각도와 (2) 손목·몸·뒤꿈치 같은 점의 위치 변화를 동시에 지켜보다가
 * '크게 반복해서 움직이는 것'을 찾아 그 반복 횟수를 센다.
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

/** 어떤 운동인지 직접 고르면 그 동작만 본다. auto는 모든 동작을 지켜본다. */
export type Focus = 'auto' | 'arm' | 'leg' | 'hinge' | 'raise' | 'shrug' | 'body' | 'calf';
export const FOCUS_LABEL: Record<Focus, string> = {
  auto: '자동', arm: '팔 굽히기·프레스·로우', leg: '스쿼트·런지', hinge: '데드·힙쓰러스트', shrug: '슈러그', raise: '사레레·팔 들기', body: '맨몸(푸시업·풀업)', calf: '종아리',
};
const FOCUS_IDS: Record<Exclude<Focus, 'auto'>, string[]> = {
  arm: ['elbow', 'wristLy', 'wristRy'],
  leg: ['knee', 'hip', 'bodyY', 'hipY'],
  hinge: ['hip', 'hipY', 'bodyY'],
  shrug: ['shrug'],
  raise: ['shoulder', 'wristLy', 'wristRy', 'wristLx', 'wristRx', 'shrug'],
  body: ['elbow', 'bodyY', 'hipY', 'wristLy', 'wristRy'],
  calf: ['heelL', 'heelR'],
};

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

export interface RepEvent { n: number; timeMs: number; minAngle: number; joint: string }

/** 한 신호(각도 또는 위치)의 오르내림 추적. 단위는 신호마다 다르다(도 또는 어깨너비 배수). */
class SignalTracker {
  count = 0;
  reps: RepEvent[] = [];
  value: number | null = null;
  hi = 0;
  lo = 0;
  phase: 'unknown' | 'up' | 'down' = 'unknown';
  lastRepT = -1e9;
  /** 이 추적기가 선택된 뒤부터 센 횟수의 기준 */
  base = 0;
  private smooth: number | null = null;
  private lastT = 0;
  private lastHiT = 0;
  private minVal = 1e9;
  private lostSince: number | null = null;
  readonly id: string;
  readonly label: string;
  readonly baseMin: number;
  /** 움직임이 멈추면 '위/아래 끝' 기억이 초당 이만큼 좁혀진다 */
  readonly decay: number;

  constructor(id: string, label: string, baseMin: number, decay: number) {
    this.id = id; this.label = label; this.baseMin = baseMin; this.decay = decay;
  }

  get amp() { return this.hi - this.lo; }

  reset() {
    this.count = 0; this.reps = []; this.value = null; this.smooth = null; this.phase = 'unknown'; this.hi = 0; this.lo = 0;
    this.lostSince = null; this.minVal = 1e9; this.base = 0; this.lastRepT = -1e9;
  }

  /** minAmp: 한 번으로 인정할 최소 오르내림 크기 */
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
    this.value = a;
    if (first) { this.hi = a; this.lo = a; this.lastT = tMs; }
    const dt = Math.max(0, Math.min(1, (tMs - this.lastT) / 1000));
    this.lastT = tMs;
    this.hi = Math.max(a, this.hi - this.decay * dt);
    this.lo = Math.min(a, this.lo + this.decay * dt);
    const amp = this.amp;
    const hiT = this.lo + amp * 0.7;
    const loT = this.lo + amp * 0.3;

    if (a >= hiT) {
      let ev: RepEvent | null = null;
      if (this.phase === 'down') {
        const timeMs = tMs - this.lastHiT;
        if (amp >= minAmp && timeMs >= MIN_REP_MS) {
          this.count++;
          this.lastRepT = tMs;
          ev = { n: this.count, timeMs, minAngle: this.minVal, joint: this.label };
          this.reps.push(ev);
        }
        this.minVal = 1e9;
      }
      this.phase = 'up';
      this.lastHiT = tMs;
      return ev;
    }
    if (a <= loT && this.phase !== 'down') { this.phase = 'down'; this.minVal = a; }
    else if (this.phase === 'down' && a < this.minVal) this.minVal = a;
    return null;
  }
}

const MIN_REP_MS = 400;
const ANGLE_DECAY = 3; // 도/초
const POS_DECAY = 0.04; // 어깨너비/초
/** 위치 신호의 최소 크기(어깨너비 배수): 손목·몸·골반·으쓱·뒤꿈치 */
const POS_MIN = { wrist: 0.5, body: 0.35, shrug: 0.12, heel: 0.1 };
const POS_MULT: Record<Strictness, number> = { easy: 0.6, normal: 1, strict: 1.5 };
/** 한 동작이 이 시간(ms) 넘게 멈추면 다른 동작으로 넘어갈 수 있다 */
const IDLE_SWITCH_MS = 4000;

export type SignalKey = 'elbow' | 'knee' | 'hip' | 'shoulder';

/** 프레임에서 위치 신호를 꺼낸다. 어깨너비로 나눠 카메라 거리와 상관없게 만든다. */
function positionSignals(lm: ArrayLike<number>, w: number, h: number, scaleRef: { v: number }): Record<string, number | null> {
  const P = (i: number) => ({ x: lm[i * 3] * w, y: lm[i * 3 + 1] * h, v: lm[i * 3 + 2] });
  const ok = (i: number) => lm[i * 3 + 2] >= MIN_VIS;
  const out: Record<string, number | null> = {
    wristLy: null, wristRy: null, wristLx: null, wristRx: null, bodyY: null, hipY: null, shrug: null, heelL: null, heelR: null,
  };
  const sL = P(11), sR = P(12);
  if (ok(11) && ok(12)) {
    const sw = Math.hypot(sL.x - sR.x, sL.y - sR.y);
    // 옆으로 서면 어깨너비가 줄어들므로 몸통 길이도 같이 본다
    let ref = sw;
    if (ok(23) && ok(24)) {
      const mx = (sL.x + sR.x) / 2, my = (sL.y + sR.y) / 2;
      const hx = (P(23).x + P(24).x) / 2, hy = (P(23).y + P(24).y) / 2;
      ref = Math.max(sw, 0.6 * Math.hypot(mx - hx, my - hy));
    }
    scaleRef.v = Math.max(ref, 0.04 * h);
  }
  const sc = scaleRef.v;
  if (sc <= 0) return out;
  for (const [side, sh, wr] of [['L', 11, 15], ['R', 12, 16]] as const) {
    if (ok(sh) && ok(wr)) {
      out[`wrist${side}y`] = (P(wr).y - P(sh).y) / sc;
      out[`wrist${side}x`] = (P(wr).x - P(sh).x) / sc;
    }
  }
  if (ok(11) && ok(12)) {
    out.bodyY = ((sL.y + sR.y) / 2) / sc;
    if (ok(0)) out.shrug = (((sL.y + sR.y) / 2) - P(0).y) / sc;
  }
  if (ok(23) && ok(24)) out.hipY = ((P(23).y + P(24).y) / 2) / sc;
  for (const [side, heel, toe] of [['L', 29, 31], ['R', 30, 32]] as const) {
    if (ok(heel) && ok(toe)) out[`heel${side}`] = (P(heel).y - P(toe).y) / sc;
  }
  return out;
}

/**
 * 운동 종류와 상관없이 횟수를 센다. 각도(팔꿈치·무릎·고관절·어깨)와 위치(손목·몸·골반·어깨 으쓱·뒤꿈치)를
 * 모두 지켜보다가, 처음으로 크게 반복된 동작을 골라 그 횟수를 보여 준다. 같은 동작을 여러 신호가 중복해서 세지 않는다.
 * 그 동작이 4초 넘게 멈춘 뒤 다른 동작이 시작되면 그쪽으로 넘어가며, 횟수는 이어서 쌓인다.
 */
export class AutoRepCounter {
  private angleT = JOINTS.map((j) => new SignalTracker(j.id, j.label, 0, ANGLE_DECAY));
  private posT: SignalTracker[] = [
    new SignalTracker('wristLy', '손목 위아래', POS_MIN.wrist, POS_DECAY),
    new SignalTracker('wristRy', '손목 위아래', POS_MIN.wrist, POS_DECAY),
    new SignalTracker('wristLx', '손목 좌우', POS_MIN.wrist, POS_DECAY),
    new SignalTracker('wristRx', '손목 좌우', POS_MIN.wrist, POS_DECAY),
    new SignalTracker('bodyY', '몸 위아래', POS_MIN.body, POS_DECAY),
    new SignalTracker('hipY', '골반 위아래', POS_MIN.body, POS_DECAY),
    new SignalTracker('shrug', '어깨 으쓱', POS_MIN.shrug, POS_DECAY),
    new SignalTracker('heelL', '뒤꿈치 들기', POS_MIN.heel, POS_DECAY),
    new SignalTracker('heelR', '뒤꿈치 들기', POS_MIN.heel, POS_DECAY),
  ];
  private minAmp = MIN_AMP.normal;
  private mult = POS_MULT.normal;
  private active: SignalTracker | null = null;
  private offset = 0; // 이전 동작들에서 쌓인 횟수
  private all: RepEvent[] = [];
  private scale = { v: 0 };

  private focus: Focus = 'auto';
  setFocus(f: Focus) { this.focus = f; }
  private allowed(id: string) { return this.focus === 'auto' || FOCUS_IDS[this.focus].includes(id); }

  setStrictness(s: Strictness) { this.minAmp = MIN_AMP[s]; this.mult = POS_MULT[s]; }

  reset() {
    [...this.angleT, ...this.posT].forEach((t) => t.reset());
    this.active = null; this.offset = 0; this.all = []; this.scale = { v: 0 };
  }

  /** 잘못 센 횟수를 손으로 고친다 (0 아래로는 내려가지 않음) */
  adjust(delta: number) { this.offset = Math.max(-(this.active ? this.active.count - this.active.base : 0), this.offset + delta); }

  get count() { return this.active ? this.offset + (this.active.count - this.active.base) : this.offset; }
  get reps() { return this.all; }
  get angle() { return this.active ? this.active.value : null; }
  /** 반복이 감지된 동작 이름 (아직 없으면 null) */
  get jointLabel(): string | null { return this.active ? this.active.label : null; }
  get avgRepMs(): number | null {
    const r = this.all;
    return r.length ? r.reduce((s, x) => s + x.timeMs, 0) / r.length : null;
  }

  private step(angles: Partial<Record<SignalKey, number | null>>, pos: Record<string, number | null>, tMs: number): RepEvent | null {
    const done: { t: SignalTracker; ev: RepEvent; ratio: number }[] = [];
    const run = (t: SignalTracker, v: number | null, min: number) => {
      const ev = t.push(v, tMs, min);
      if (ev) done.push({ t, ev, ratio: t.amp / min });
    };
    for (const t of this.angleT) if (this.allowed(t.id)) run(t, angles[t.id as SignalKey] ?? null, this.minAmp);
    for (const t of this.posT) if (this.allowed(t.id)) run(t, pos[t.id] ?? null, t.baseMin * this.mult);
    if (!done.length) return null;

    const act = this.active;
    if (act) {
      const mine = done.find((d) => d.t === act);
      if (mine) { this.all.push(mine.ev); return { ...mine.ev, n: this.count }; }
      // 지금 동작이 한동안 멈췄고 다른 동작이 시작됐다면 그쪽으로 넘어간다
      if (tMs - act.lastRepT > IDLE_SWITCH_MS) {
        const best = done.reduce((b, d) => (d.ratio > b.ratio ? d : b));
        this.offset = this.count;
        best.t.base = best.t.count - 1;
        this.active = best.t;
        this.all.push(best.ev);
        return { ...best.ev, n: this.count };
      }
      return null;
    }
    // 처음 반복이 완성된 동작을 고른다 (동시에 여럿이면 가장 크게 움직인 것)
    const best = done.reduce((b, d) => (d.ratio > b.ratio ? d : b));
    this.active = best.t;
    best.t.base = best.t.count - 1;
    this.all.push(best.ev);
    return { ...best.ev, n: this.count };
  }

  /** 관절별 각도를 직접 넣는다 (테스트·재사용용). 이번 프레임에 1회가 완성되면 그 기록을 돌려준다. */
  pushAngles(angles: Partial<Record<SignalKey, number | null>>, tMs: number): RepEvent | null {
    return this.step(angles, {}, tMs);
  }

  /** 관절 33개(x,y,신뢰도) 한 프레임을 넣는다. w,h는 영상 가로·세로 픽셀. */
  push(lm: ArrayLike<number>, w: number, h: number, tMs: number): RepEvent | null {
    const a: Partial<Record<SignalKey, number | null>> = {};
    for (const j of JOINTS) a[j.id] = jointAngle(lm, j, w, h);
    return this.step(a, positionSignals(lm, w, h, this.scale), tMs);
  }
}

const NATIVE = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
const TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
/** 소리로 읽어 줄 횟수: 1→하나, 2→둘 … 11→열하나, 20→스물 (99 넘으면 숫자 그대로) */
export function countWord(n: number): string {
  if (!Number.isInteger(n) || n < 1) return '';
  if (n > 99) return String(n);
  return `${TENS[Math.floor(n / 10)]}${NATIVE[n % 10]}`;
}
