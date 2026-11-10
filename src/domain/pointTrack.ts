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
  /** 비슷함이 이 값 이상일 때만 템플릿을 새 모습으로 갱신 */ refreshScore?: number;
}
export const DEFAULT_TRACK: Required<TrackOptions> = { radius: 8, search: 18, minScore: 0.6, refreshScore: 0.85 };

function px(g: Gray, x: number, y: number): number {
  const xi = x < 0 ? 0 : x >= g.w ? g.w - 1 : x;
  const yi = y < 0 ? 0 : y >= g.h ? g.h - 1 : y;
  return g.data[yi * g.w + xi];
}

/** (cx,cy) 중심의 (2r+1)² 조각을 평평한 배열로 */
export function extractPatch(g: Gray, cx: number, cy: number, r: number): Float32Array {
  const n = 2 * r + 1;
  const out = new Float32Array(n * n);
  let k = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out[k++] = px(g, cx + dx, cy + dy);
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

/** 한 프레임에서 템플릿과 가장 비슷한 위치를 prev 근처에서 찾는다 */
export function trackStep(tpl: Float32Array, frame: Gray, prev: { x: number; y: number }, o: Required<TrackOptions>): TrackPoint {
  const px0 = Math.round(prev.x), py0 = Math.round(prev.y);
  let best = -2, bx = px0, by = py0;
  for (let dy = -o.search; dy <= o.search; dy++) {
    for (let dx = -o.search; dx <= o.search; dx++) {
      const cx = px0 + dx, cy = py0 + dy;
      if (cx < 0 || cy < 0 || cx >= frame.w || cy >= frame.h) continue;
      const s = zncc(tpl, extractPatch(frame, cx, cy, o.radius));
      // 같은 점수면 이전 위치에 가까운 쪽을 택해 떨림을 줄인다
      if (s > best + 1e-9 || (Math.abs(s - best) <= 1e-9 && dx * dx + dy * dy < (bx - px0) ** 2 + (by - py0) ** 2)) { best = s; bx = cx; by = cy; }
    }
  }
  return { x: bx, y: by, score: best };
}

export interface TrackResult {
  /** 프레임마다의 위치. 놓친 프레임은 null */
  points: (TrackPoint | null)[];
  /** 처음으로 놓친 프레임 번호(없으면 -1) */
  lostAt: number;
}

/** 프레임 목록 전체를 따라간다. 첫 프레임의 start 위치(px)에서 시작. 놓치면 그 뒤는 모두 null */
export function trackSequence(frames: Gray[], start: { x: number; y: number }, opts: TrackOptions = {}): TrackResult {
  const o = { ...DEFAULT_TRACK, ...opts };
  const points: (TrackPoint | null)[] = [];
  if (!frames.length) return { points, lostAt: -1 };
  let tpl = extractPatch(frames[0], Math.round(start.x), Math.round(start.y), o.radius);
  points.push({ x: start.x, y: start.y, score: 1 });
  let cur = { x: start.x, y: start.y };
  let lostAt = -1;
  for (let i = 1; i < frames.length; i++) {
    if (lostAt >= 0) { points.push(null); continue; }
    const r = trackStep(tpl, frames[i], cur, o);
    if (r.score < o.minScore) { lostAt = i; points.push(null); continue; }
    points.push(r);
    cur = { x: r.x, y: r.y };
    if (r.score >= o.refreshScore) tpl = extractPatch(frames[i], r.x, r.y, o.radius);
  }
  return { points, lostAt };
}
