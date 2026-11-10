/** 테스트용 합성 자세: 간단한 2D 뼈대로 여러 운동 동작의 33점 관절 프레임을 만든다 (실제 사람 영상 아님) */
const D = Math.PI / 180;
type V = [number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const dir = (deg: number, len: number): V => [Math.sin(deg * D) * len, Math.cos(deg * D) * len]; // 0 = 아래, 양수 = +x(앞)
const up = (deg: number, len: number): V => [Math.sin(deg * D) * len, -Math.cos(deg * D) * len]; // 0 = 위
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 두 마디 팔/다리의 관절 위치: p0에서 p1을 향하는 길이 l1,l2 사슬, side=±1로 꺾이는 쪽을 고른다 */
export function ik(p0: V, p1: V, l1: number, l2: number, side: 1 | -1): V {
  let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  let d = Math.hypot(dx, dy);
  const dmax = l1 + l2 - 1e-4, dmin = Math.abs(l1 - l2) + 1e-4;
  d = Math.max(dmin, Math.min(dmax, d));
  const base = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const th = base + side * a;
  return [p0[0] + Math.cos(th) * l1, p0[1] + Math.sin(th) * l1];
}

export type Pts = Partial<Record<number, V>>;
/** 33×3 배열. 지정한 점만 보이게(신뢰도 1) */
export function frameOf(pts: Pts): Float32Array {
  const a = new Float32Array(99);
  for (const [k, v] of Object.entries(pts)) { const i = Number(k); a[i * 3] = v![0]; a[i * 3 + 1] = v![1]; a[i * 3 + 2] = 1; }
  return a;
}
/** 좌우가 같은 위치에 겹친 옆면 뼈대(왼쪽·오른쪽 번호 모두 같은 점) */
function both(o: Pts, l: number, r: number, v: V) { o[l] = v; o[r] = v; }

export interface Side {
  ankle?: V; shank?: number; thigh?: number; torso?: number; shLift?: number;
  upper?: number; fore?: number; heelLift?: number;
  T?: number; ua?: number; fa?: number;
}
/** 발목을 땅에 고정하고 위로 쌓는 옆면 자세 (서서 하는 운동용) */
export function standing(p: Side): Pts {
  const A = p.ankle ?? [0.5, 0.9];
  const T = p.T ?? 0.3, ua = p.ua ?? 0.17, fa = p.fa ?? 0.17;
  const K = add(A, up(p.shank ?? 0, 0.25));
  const H = add(K, up(p.thigh ?? 0, 0.25));
  let S = add(H, up(p.torso ?? 0, T));
  S = [S[0], S[1] - (p.shLift ?? 0)];
  const ear = add(add(H, up(p.torso ?? 0, T + 0.12)), [0, 0]);
  const E = add(S, dir(p.upper ?? 0, ua));
  const W = add(E, dir(p.fore ?? 0, fa));
  const o: Pts = {};
  both(o, 23, 24, H); both(o, 25, 26, K); both(o, 27, 28, A);
  both(o, 11, 12, S); both(o, 13, 14, E); both(o, 15, 16, W); both(o, 7, 8, ear);
  both(o, 29, 30, [A[0] - 0.02, A[1] + 0.02 - (p.heelLift ?? 0)]);
  return o;
}
/** 정면 뼈대(왼쪽·오른쪽이 좌우로 벌어짐). 팔은 옆으로 벌리는 각도 abd(0=내림, 90=수평) */
export function frontal(p: { abd?: number; shLift?: number; hipDrop?: number }): Pts {
  const cx = 0.5, o: Pts = {};
  const H: V = [cx, 0.55 + (p.hipDrop ?? 0)], S: V = [cx, 0.55 + (p.hipDrop ?? 0) - 0.3 - (p.shLift ?? 0)];
  const A: V = [cx, 0.9];
  const kneeY = 0.9 - 0.25 + (p.hipDrop ?? 0) * 0.5;
  o[23] = [cx - 0.07, H[1]]; o[24] = [cx + 0.07, H[1]];
  o[25] = [cx - 0.08, kneeY]; o[26] = [cx + 0.08, kneeY];
  o[27] = [cx - 0.08, A[1]]; o[28] = [cx + 0.08, A[1]];
  o[29] = [cx - 0.08, A[1] + 0.02]; o[30] = [cx + 0.08, A[1] + 0.02];
  const sl: V = [cx - 0.11, S[1]], sr: V = [cx + 0.11, S[1]];
  o[11] = sl; o[12] = sr;
  const a = p.abd ?? 0;
  o[13] = add(sl, dir(-a, 0.17)); o[14] = add(sr, dir(a, 0.17));
  o[15] = add(o[13]!, dir(-a, 0.17)); o[16] = add(o[14]!, dir(a, 0.17));
  const earY = 0.55 + (p.hipDrop ?? 0) - 0.3 - 0.12; // 귀는 어깨를 으쓱해도 그대로
  o[7] = [cx - 0.03, earY]; o[8] = [cx + 0.03, earY];
  return o;
}

/** n프레임, reps번 반복하는 부드러운 위상 0→1→0 */
export function series(n: number, reps: number, make: (t: number) => Pts): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) out.push(frameOf(make((1 - Math.cos((2 * Math.PI * reps * i) / n)) / 2)));
  return out;
}

export const SCENES: Record<string, () => Float32Array[]> = {
  squat: () => series(90, 3, (t) => standing({ shank: lerp(2, 28, t), thigh: lerp(-2, -82, t), torso: lerp(0, 38, t), upper: 20, fore: 90 })),
  hinge: () => series(90, 3, (t) => standing({ shank: lerp(0, 8, t), thigh: lerp(0, -25, t), torso: lerp(0, 75, t), upper: 0, fore: 0 })),
  curl: () => series(90, 3, (t) => standing({ upper: 5, fore: lerp(5, 140, t) })),
  lateralRaise: () => series(90, 3, (t) => frontal({ abd: lerp(5, 90, t) })),
  shrug: () => series(90, 3, (t) => frontal({ shLift: lerp(0, 0.045, t) })),
  calf: () => series(90, 3, (t) => standing({ heelLift: lerp(0, 0.045, t), upper: 3, fore: 3 })),
  overheadPress: () => series(90, 3, (t) => standing({ upper: lerp(20, 170, t), fore: lerp(180, 170, t) })),
  pulldown: () => series(90, 3, (t) => standing({ upper: lerp(-20, 170, t), fore: lerp(120, 170, t) })),
  frontSquat: () => series(90, 3, (t) => frontal({ hipDrop: lerp(0, 0.2, t) })),
  pushUp: () => series(90, 3, (t) => {
    const A: V = [0.1, 0.72], W: V = [0.72, 0.72], S: V = [0.7, lerp(0.4, 0.56, t)];
    const H = add(A, [(S[0] - A[0]) * 0.55, (S[1] - A[1]) * 0.55]), K = add(A, [(S[0] - A[0]) * 0.27, (S[1] - A[1]) * 0.27]);
    const E = ik(S, W, 0.17, 0.17, -1);
    const o: Pts = {};
    both(o, 11, 12, S); both(o, 13, 14, E); both(o, 15, 16, W); both(o, 23, 24, H); both(o, 25, 26, K); both(o, 27, 28, A);
    both(o, 7, 8, [S[0] + 0.1, S[1] - 0.03]); both(o, 29, 30, [A[0] - 0.02, A[1] + 0.02]);
    return o;
  }),
  bench: () => series(90, 3, (t) => {
    const H: V = [0.3, 0.7], S: V = [0.6, 0.7];
    const upper = lerp(-66, 180, t), fore = 180;
    const E = add(S, dir(upper, 0.17)), W = add(E, dir(fore, 0.17));
    const o: Pts = {};
    both(o, 11, 12, S); both(o, 13, 14, E); both(o, 15, 16, W); both(o, 23, 24, H); both(o, 25, 26, [0.12, 0.58]); both(o, 27, 28, [0.0, 0.7]);
    both(o, 7, 8, [0.72, 0.7]); both(o, 29, 30, [-0.02, 0.72]);
    return o;
  }),
  lunge: () => series(90, 3, (t) => {
    const Hh: V = [0.35, lerp(0.5, 0.68, t)], AF: V = [0.55, 0.9], AR: V = [0.15, 0.9];
    const KF = ik(Hh, AF, 0.25, 0.25, -1), KR = ik(Hh, AR, 0.25, 0.25, 1);
    const S: V = [Hh[0], Hh[1] - 0.3];
    const o: Pts = {};
    o[23] = Hh; o[24] = Hh; o[25] = KF; o[26] = KR; o[27] = AF; o[28] = AR; o[29] = [AF[0] - 0.02, 0.92]; o[30] = [AR[0] - 0.02, 0.92];
    both(o, 11, 12, S); both(o, 13, 14, add(S, dir(0, 0.17))); both(o, 15, 16, add(S, dir(0, 0.34))); both(o, 7, 8, [S[0], S[1] - 0.12]);
    return o;
  }),
  still: () => series(90, 1, () => standing({ upper: 3, fore: 3 })).map((f) => f),
};
