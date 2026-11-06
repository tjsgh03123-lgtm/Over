/**
 * 실시간 횟수 세기의 순수 계산. 카메라가 돌려주는 33개 관절(x,y,신뢰도)에서
 * 운동별로 정한 관절 각도를 구하고, '펴짐 → 굽힘 → 펴짐'을 한 번으로 센다.
 */

export const LM_COUNT = 33;
export const MIN_VIS = 0.5;

type Joint = 'knee' | 'elbow' | 'hip';

/** 왼쪽·오른쪽 관절 번호 (MediaPipe): [앞점, 꼭짓점, 뒷점] */
const CHAIN: Record<Joint, { l: [number, number, number]; r: [number, number, number] }> = {
  knee: { l: [23, 25, 27], r: [24, 26, 28] },
  elbow: { l: [11, 13, 15], r: [12, 14, 16] },
  hip: { l: [11, 23, 25], r: [12, 24, 26] },
};

export interface LiveExercise {
  id: string;
  label: string;
  joint: Joint;
  /** 이 각도 이상이면 '펴진' 상태 */
  hi: number;
  /** 이 각도 이하로 내려가야 '굽힌' 상태 (여기까지 가야 1회로 센다) */
  lo: number;
  /** 촬영 안내 */
  tip: string;
}

export const LIVE_EXERCISES: LiveExercise[] = [
  { id: 'squat', label: '스쿼트', joint: 'knee', hi: 160, lo: 110, tip: '옆에서 전신이 보이게' },
  { id: 'lunge', label: '런지', joint: 'knee', hi: 160, lo: 115, tip: '옆에서 전신이 보이게' },
  { id: 'pushup', label: '푸쉬업', joint: 'elbow', hi: 155, lo: 95, tip: '옆에서 전신이 보이게' },
  { id: 'curl', label: '컬', joint: 'elbow', hi: 150, lo: 80, tip: '앞이나 옆에서 팔이 보이게' },
  { id: 'bench', label: '벤치프레스', joint: 'elbow', hi: 155, lo: 100, tip: '옆에서 팔이 보이게' },
  { id: 'press', label: '숄더프레스', joint: 'elbow', hi: 155, lo: 100, tip: '앞이나 옆에서 팔이 보이게' },
  { id: 'pullup', label: '풀업', joint: 'elbow', hi: 150, lo: 95, tip: '앞이나 뒤에서 팔이 보이게' },
  { id: 'deadlift', label: '데드리프트', joint: 'hip', hi: 160, lo: 125, tip: '옆에서 전신이 보이게' },
];

/** 운동 이름에서 알맞은 종류를 짐작한다 (못 찾으면 null) */
export function guessExercise(name: string): LiveExercise | null {
  const n = name.replace(/\s/g, '').toLowerCase();
  const find = (id: string) => LIVE_EXERCISES.find((e) => e.id === id) ?? null;
  if (/스쿼트|squat/.test(n)) return find('squat');
  if (/런지|lunge/.test(n)) return find('lunge');
  if (/푸쉬업|푸시업|팔굽|pushup/.test(n)) return find('pushup');
  if (/풀업|턱걸이|pullup|친업|chinup/.test(n)) return find('pullup');
  if (/데드|deadlift/.test(n)) return find('deadlift');
  if (/숄더|밀리터리|오버헤드|shoulder|ohp/.test(n)) return find('press');
  if (/벤치|bench|체스트프레스|딥/.test(n)) return find('bench');
  if (/컬|curl/.test(n)) return find('curl');
  return null;
}

export type Strictness = 'easy' | 'normal' | 'strict';
export const STRICT_LABEL: Record<Strictness, string> = { easy: '쉬움', normal: '보통', strict: '엄격' };

function thresholds(ex: LiveExercise, s: Strictness): { hi: number; lo: number } {
  if (s === 'easy') return { hi: ex.hi - 10, lo: ex.lo + 15 };
  if (s === 'strict') return { hi: ex.hi + 5, lo: ex.lo - 10 };
  return { hi: ex.hi, lo: ex.lo };
}

export function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180) / Math.PI;
}

/**
 * 프레임의 관절 배열(33×3: x,y,신뢰도 / x,y는 0~1)에서 운동 관절의 각도를 구한다.
 * 왼쪽·오른쪽 중 더 잘 보이는 쪽을 쓴다. 둘 다 안 보이면 null.
 * w,h는 화면 비율(가로·세로 픽셀) — 비율을 곱해야 각도가 왜곡되지 않는다.
 */
export function jointAngle(lm: ArrayLike<number>, joint: Joint, w: number, h: number): number | null {
  let best: { vis: number; ang: number } | null = null;
  for (const side of [CHAIN[joint].l, CHAIN[joint].r]) {
    const p = side.map((i) => ({ x: lm[i * 3] * w, y: lm[i * 3 + 1] * h, v: lm[i * 3 + 2] }));
    const vis = Math.min(p[0].v, p[1].v, p[2].v);
    if (vis < MIN_VIS) continue;
    if (!best || vis > best.vis) best = { vis, ang: angleDeg(p[0], p[1], p[2]) };
  }
  return best ? best.ang : null;
}

export interface RepEvent { n: number; timeMs: number; minAngle: number }

/**
 * 한 세트의 횟수 세기. 프레임이 들어올 때마다 pushAngle을 부른다.
 * 펴짐(≥hi) → 굽힘(≤lo) → 다시 펴짐(≥hi)이면 1회. 너무 빠른 흔들림(0.4초 미만)은 세지 않는다.
 */
export class RepCounter {
  count = 0;
  reps: RepEvent[] = [];
  /** 지금 상태: 펴짐(up) / 굽힘(down) / 아직 모름 */
  phase: 'unknown' | 'up' | 'down' = 'unknown';
  angle: number | null = null;
  private smooth: number | null = null;
  private lastHiT = 0;
  private minAngle = 999;
  private lostSince: number | null = null;
  private th: { hi: number; lo: number };
  ex: LiveExercise;

  constructor(ex: LiveExercise, strict: Strictness = 'normal') {
    this.ex = ex;
    this.th = thresholds(ex, strict);
  }

  setStrictness(s: Strictness) { this.th = thresholds(this.ex, s); }

  reset() {
    this.count = 0; this.reps = []; this.phase = 'unknown'; this.angle = null; this.smooth = null; this.lostSince = null; this.minAngle = 999;
  }

  /** 반환: 이번 프레임에 1회가 완성되면 그 기록 */
  pushAngle(raw: number | null, tMs: number): RepEvent | null {
    if (raw == null) {
      if (this.lostSince == null) this.lostSince = tMs;
      if (tMs - this.lostSince > 3000) { this.phase = 'unknown'; this.smooth = null; } // 오래 안 보이면 처음부터
      return null;
    }
    this.lostSince = null;
    this.smooth = this.smooth == null ? raw : this.smooth * 0.5 + raw * 0.5;
    const a = this.smooth;
    this.angle = a;
    if (a >= this.th.hi) {
      if (this.phase === 'down') {
        const timeMs = tMs - this.lastHiT;
        if (timeMs >= 400) {
          this.count++;
          const ev = { n: this.count, timeMs, minAngle: this.minAngle };
          this.reps.push(ev);
          this.phase = 'up'; this.lastHiT = tMs; this.minAngle = 999;
          return ev;
        }
        this.phase = 'up'; this.lastHiT = tMs; this.minAngle = 999; // 너무 빠르면 무시하고 다시 시작
        return null;
      }
      this.phase = 'up';
      this.lastHiT = tMs;
    } else if (a <= this.th.lo && this.phase === 'up') {
      this.phase = 'down';
      this.minAngle = a;
    } else if (this.phase === 'down' && a < this.minAngle) {
      this.minAngle = a;
    }
    return null;
  }

  push(lm: ArrayLike<number>, w: number, h: number, tMs: number): RepEvent | null {
    return this.pushAngle(jointAngle(lm, this.ex.joint, w, h), tMs);
  }

  get avgRepMs(): number | null {
    return this.reps.length ? this.reps.reduce((s, r) => s + r.timeMs, 0) / this.reps.length : null;
  }
}
