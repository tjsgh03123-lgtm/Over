/**
 * 영상에서 사용자가 찍은 "한 점"만 따라가는 추적. (사람 전체 분석이 아님)
 * 흑백 프레임에서 점 주변 작은 조각(템플릿)을 만들고, 다음 프레임의 근처에서 가장 비슷한 곳을 찾는다(ZNCC).
 * 안드로이드 쪽(Kotlin)도 같은 방식이며, 이 파일이 기준 구현이자 테스트 대상이다.
 */
export interface Gray { w: number; h: number; data: ArrayLike<number> }
export interface TrackPoint { x: number; y: number; score: number }
export interface TrackOptions {
  /** 템플릿 반지름(px) */ radius?: number;
  /** 프레임마다 찾아볼 범위 반지름(px) */ search?: number;
  /** 이 값보다 비슷함이 낮으면 "놓쳤다" */ minScore?: number;
  /** 비슷함이 이 값 이상일 때만 템플릿에 새 모습을 조금 섞는다 */ refreshScore?: number;
  /** 새 모습을 섞는 비율(0이면 처음 모습 그대로). 매번 통째로 갈면 조금씩 미끄러진다 */ blend?: number;
  /** 화면 가장자리에서 이 px 안쪽으로 들어가면 화면 밖으로 나간 것으로 본다 */ margin?: number;
}
export const DEFAULT_TRACK: Required<TrackOptions> = { radius: 12, search: 26, minScore: 0.5, refreshScore: 0.8, blend: 0.5, margin: 3 };
/** 거친 탐색에서 조각을 몇 칸 건너뛰며 비교할지 (빠르게 대략 위치 → 촘촘히 정밀) */
const COARSE = 2;

function px(g: Gray, x: number, y: number): number {
  const xi = x < 0 ? 0 : x >= g.w ? g.w - 1 : x;
  const yi = y < 0 ? 0 : y >= g.h ? g.h - 1 : y;
  return g.data[yi * g.w + xi];
}

/** (cx,cy) 중심의 (2r+1)² 조각을 평평한 배열로. step>1이면 그만큼 건너뛰며 뽑는다 */
export function extractPatch(g: Gray, cx: number, cy: number, r: number, step = 1): Float32Array {
  const m = Math.floor((2 * r) / step) + 1;
  const out = new Float32Array(m * m);
  let k = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) out[k++] = px(g, cx - r + i * step, cy - r + j * step);
  return out;
}

/** 두 조각의 정규화 상관(-1~1). 밝기가 변해도 모양이 같으면 1에 가깝다. 무늬가 없으면(분산 0) 0 */
export function zncc(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  if (da < 1e-6 || db < 1e-6) return 0;
  return num / Math.sqrt(da * db);
}

/** 조각의 밝기 표준편차. 낮으면 무늬가 약해서(벽·매끈한 면) 점이 미끄러지기 쉽다 */
export function textureStd(p: ArrayLike<number>): number {
  const n = p.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += p[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (p[i] - m) * (p[i] - m);
  return Math.sqrt(v / n);
}
/** 이보다 낮으면 "무늬가 약하다"고 알린다 */
export const WEAK_TEXTURE = 12;

/** 세 점(왼·가운데·오른쪽 점수)에서 포물선 꼭짓점의 어긋남(-0.5~0.5). 뾰족하지 않으면 0 */
function parabola(l: number, c: number, r: number): number {
  const d = l - 2 * c + r;
  if (d >= -1e-9) return 0;
  const o = (l - r) / (2 * d);
  return o > 0.5 ? 0.5 : o < -0.5 ? -0.5 : o;
}

/**
 * 한 프레임에서 템플릿과 가장 비슷한 위치를 prev 근처에서 찾는다.
 * 1) 조각을 건너뛰며 넓게 훑어 대략 위치를 잡고 2) 그 주변을 촘촘히 보고 3) 점수 분포로 소수점 위치까지 보정한다.
 */
export function trackStep(tpl: Float32Array, frame: Gray, prev: { x: number; y: number }, o: Required<TrackOptions>): TrackPoint {
  const r = o.radius;
  const px0 = Math.round(prev.x), py0 = Math.round(prev.y);
  const tplC = subsample(tpl, r, COARSE);
  let bx = px0, by = py0, best = -2;
  for (let dy = -o.search; dy <= o.search; dy += COARSE) {
    for (let dx = -o.search; dx <= o.search; dx += COARSE) {
      const cx = px0 + dx, cy = py0 + dy;
      if (cx < 0 || cy < 0 || cx >= frame.w || cy >= frame.h) continue;
      const s = zncc(tplC, extractPatch(frame, cx, cy, r, COARSE));
      if (s > best + 1e-9 || (Math.abs(s - best) <= 1e-9 && dx * dx + dy * dy < (bx - px0) ** 2 + (by - py0) ** 2)) { best = s; bx = cx; by = cy; }
    }
  }
  // 정밀: 거친 최고점 주변 ±(COARSE) 칸
  const fx = bx, fy = by;
  best = -2;
  const sc = new Map<number, number>();
  const at = (cx: number, cy: number) => {
    const key = cy * 100000 + cx;
    let v = sc.get(key);
    if (v === undefined) { v = (cx < 0 || cy < 0 || cx >= frame.w || cy >= frame.h) ? -2 : zncc(tpl, extractPatch(frame, cx, cy, r)); sc.set(key, v); }
    return v;
  };
  for (let dy = -COARSE; dy <= COARSE; dy++) {
    for (let dx = -COARSE; dx <= COARSE; dx++) {
      const cx = fx + dx, cy = fy + dy;
      const s = at(cx, cy);
      if (s > best + 1e-9 || (Math.abs(s - best) <= 1e-9 && (cx - prev.x) ** 2 + (cy - prev.y) ** 2 < (bx - prev.x) ** 2 + (by - prev.y) ** 2)) { best = s; bx = cx; by = cy; }
    }
  }
  const ox = parabola(at(bx - 1, by), best, at(bx + 1, by));
  const oy = parabola(at(bx, by - 1), best, at(bx, by + 1));
  return { x: bx + ox, y: by + oy, score: best };
}

function subsample(tpl: Float32Array, r: number, step: number): Float32Array {
  const n = 2 * r + 1, m = Math.floor((2 * r) / step) + 1;
  const out = new Float32Array(m * m);
  let k = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) out[k++] = tpl[j * step * n + i * step];
  return out;
}

export interface TrackResult {
  /** 프레임마다의 위치. 놓친 프레임은 null */
  points: (TrackPoint | null)[];
  /** 처음으로 놓친 프레임 번호(없으면 -1) */
  lostAt: number;
  /** 시작 점 주변 무늬가 약한가 */
  weak: boolean;
}

/** 화면 가장자리(margin) 안쪽이면 화면 밖으로 나간 것 */
function outside(p: { x: number; y: number }, g: Gray, margin: number): boolean {
  return p.x < margin || p.y < margin || p.x > g.w - 1 - margin || p.y > g.h - 1 - margin;
}

function blendInto(tpl: Float32Array, fresh: Float32Array, b: number) {
  for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * (1 - b) + fresh[i] * b;
}

/** 한 방향으로 따라간다. order는 프레임 번호 순서(앞으로 또는 뒤로) */
function run(frames: Gray[], order: number[], start: { x: number; y: number }, o: Required<TrackOptions>): (TrackPoint | null)[] {
  const out: (TrackPoint | null)[] = new Array(frames.length).fill(null);
  const first = order[0];
  const tpl = extractPatch(frames[first], Math.round(start.x), Math.round(start.y), o.radius);
  out[first] = { x: start.x, y: start.y, score: 1 };
  let cur = { x: start.x, y: start.y };
  for (let k = 1; k < order.length; k++) {
    const i = order[k];
    const r = trackStep(tpl, frames[i], cur, o);
    if (r.score < o.minScore || outside(r, frames[i], o.margin)) break; // 한 번 놓치면 이후는 잘못 이어붙이지 않는다
    out[i] = r;
    cur = { x: r.x, y: r.y };
    if (o.blend > 0 && r.score >= o.refreshScore) blendInto(tpl, extractPatch(frames[i], Math.round(r.x), Math.round(r.y), o.radius), o.blend);
  }
  return out;
}

/** 프레임 목록 전체를 따라간다. 첫 프레임의 start 위치(px)에서 시작. 놓치면 그 뒤는 모두 null */
export function trackSequence(frames: Gray[], start: { x: number; y: number }, opts: TrackOptions = {}): TrackResult {
  const o = { ...DEFAULT_TRACK, ...opts };
  if (!frames.length) return { points: [], lostAt: -1, weak: false };
  const order = frames.map((_, i) => i);
  const points = run(frames, order, start, o);
  const lostAt = points.findIndex((p) => p === null);
  const weak = textureStd(extractPatch(frames[0], Math.round(start.x), Math.round(start.y), o.radius)) < WEAK_TEXTURE;
  return { points, lostAt, weak };
}
