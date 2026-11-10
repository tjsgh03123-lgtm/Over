/** 영상 점 추적 결과를 보기 좋게 다듬고 재는 계산. 좌표는 0~1(영상 가로·세로 비율) */
export interface P { x: number; y: number }
export interface TimedP extends P { t: number } // t = 초

/** 두 점을 이은 선의 길이. aspect = 영상 가로/세로(좌표가 비율이라 보정) */
export function lineLength(a: P, b: P, aspect = 1): number {
  return Math.hypot((b.x - a.x) * aspect, b.y - a.y);
}
/** 두 점을 이은 선이 수직(위아래)에서 얼마나 기울었는지(도, 0~90). 바벨 막대 기울기 확인용 */
export function tiltFromVertical(a: P, b: P, aspect = 1): number {
  const dx = Math.abs(b.x - a.x) * aspect, dy = Math.abs(b.y - a.y);
  if (dx === 0 && dy === 0) return 0;
  return Math.round((Math.atan2(dx, dy) * 180 / Math.PI) * 10) / 10;
}
/** 세 점이 만드는 각도(도, 0~180). b가 꼭짓점 */
export function angleAt(a: P, b: P, c: P, aspect = 1): number {
  const v1x = (a.x - b.x) * aspect, v1y = a.y - b.y, v2x = (c.x - b.x) * aspect, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m));
  return Math.round((Math.acos(cos) * 180 / Math.PI) * 10) / 10;
}

/** 이동 평균으로 떨림 줄이기(양 끝은 있는 만큼만 평균). null(놓침)은 건너뛰고 그대로 null */
export function smoothPath(pts: (P | null)[], win = 5): (P | null)[] {
  const h = Math.floor(win / 2);
  return pts.map((p, i) => {
    if (!p) return null;
    let sx = 0, sy = 0, n = 0;
    for (let j = i - h; j <= i + h; j++) { const q = pts[j]; if (q) { sx += q.x; sy += q.y; n++; } }
    return { x: sx / n, y: sy / n };
  });
}

/** Ramer–Douglas–Peucker. 모양을 거의 지키면서 점 수를 줄인다(그리기 가볍게) */
export function simplifyPath(pts: P[], eps = 0.004): P[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let dmax = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSeg(pts[i], pts[s], pts[e]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (idx >= 0 && dmax > eps) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function distToSeg(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export interface PathStats {
  /** 위아래로 움직인 폭(영상 높이 대비 %) */ verticalPct: number;
  /** 좌우로 흔들린 폭(영상 높이 대비 %, 가로세로 비 보정) */ horizontalPct: number;
  /** 가장 높은 곳·낮은 곳의 시간(초) */ topT: number; bottomT: number;
  /** 점 개수 */ points: number;
}
/** 궤적 요약. 좌표 y는 아래로 갈수록 커진다 */
export function pathStats(pts: TimedP[], aspect = 1): PathStats | null {
  if (pts.length < 2) return null;
  let top = pts[0], bot = pts[0], minX = pts[0].x, maxX = pts[0].x;
  for (const p of pts) {
    if (p.y < top.y) top = p;
    if (p.y > bot.y) bot = p;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return {
    verticalPct: Math.round((bot.y - top.y) * 1000) / 10,
    horizontalPct: Math.round((maxX - minX) * aspect * 1000) / 10,
    topT: top.t, bottomT: bot.t, points: pts.length,
  };
}

/** 위아래 왕복(반복) 횟수 대략 세기. 방향이 바뀐 곳이 minSwing 이상 움직인 뒤에만 인정 → 떨림은 무시 */
export function countSwings(ys: number[], minSwing = 0.05): number {
  let dir = 0, ext = ys[0] ?? 0, turns = 0;
  for (const y of ys) {
    if (dir === 0) {
      if (y > ext + minSwing) { dir = 1; ext = y; } else if (y < ext - minSwing) { dir = -1; ext = y; }
    } else if (dir === 1) {
      if (y > ext) ext = y; else if (y < ext - minSwing) { turns++; dir = -1; ext = y; }
    } else {
      if (y < ext) ext = y; else if (y > ext + minSwing) { turns++; dir = 1; ext = y; }
    }
  }
  return Math.ceil(turns / 2);
}

// ---- 화면 좌표 ↔ 영상 좌표 ----
export interface Rect { x: number; y: number; w: number; h: number }
/** 컨테이너(cw×ch) 안에 영상(vw×vh)을 비율 유지로 꽉 채워(contain) 넣었을 때 영상이 차지하는 영역 */
export function fitRect(cw: number, ch: number, vw: number, vh: number): Rect {
  if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, w: Math.max(0, cw), h: Math.max(0, ch) };
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}
/** 화면 위 누른 곳 → 영상 비율 좌표(0~1). 영상 밖(검은 여백)이면 null */
export function toNorm(px: number, py: number, r: Rect): P | null {
  if (r.w <= 0 || r.h <= 0) return null;
  const x = (px - r.x) / r.w, y = (py - r.y) / r.h;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}
export function toScreen(p: P, r: Rect): P { return { x: r.x + p.x * r.w, y: r.y + p.y * r.h }; }

// ---- 추적 결과 보관·이어붙이기 ----
export interface Track { times: number[]; pts: (P | null)[] }
/** 네이티브가 준 배열(놓친 곳은 x<0)을 Track으로 */
export function trackFromNative(times: number[], xs: number[], ys: number[]): Track {
  return { times: times.slice(), pts: times.map((_, i) => (xs[i] >= 0 && ys[i] >= 0 ? { x: xs[i], y: ys[i] } : null)) };
}
/** old 중 fresh 시작 시각 이전 것은 남기고, 그 뒤는 fresh로 바꾼다(다시 눌러 고친 지점부터 새로 추적) */
export function mergeTrack(old: Track | null, fresh: Track): Track {
  if (!old || !fresh.times.length) return fresh;
  const t0 = fresh.times[0];
  const keep = old.times.filter((t) => t < t0).length;
  return { times: [...old.times.slice(0, keep), ...fresh.times], pts: [...old.pts.slice(0, keep), ...fresh.pts] };
}
/** 시각 t에 가장 가까운 샘플의 위치. maxGapMs보다 멀면 null */
export function pointAt(tr: Track | null, t: number, maxGapMs = 150): P | null {
  if (!tr || !tr.times.length) return null;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < tr.times.length; i++) { const d = Math.abs(tr.times[i] - t); if (d < bd) { bd = d; bi = i; } }
  return bd <= maxGapMs ? tr.pts[bi] : null;
}
/** 놓친 구간을 뺀 (시각, 위치) 목록 */
export function validPoints(tr: Track | null): TimedP[] {
  if (!tr) return [];
  const out: TimedP[] = [];
  tr.pts.forEach((p, i) => { if (p) out.push({ x: p.x, y: p.y, t: tr.times[i] / 1000 }); });
  return out;
}
/** 마지막으로 잡힌 시각(ms). 없으면 -1 */
export function lastSeenMs(tr: Track | null): number {
  if (!tr) return -1;
  for (let i = tr.pts.length - 1; i >= 0; i--) if (tr.pts[i]) return tr.times[i];
  return -1;
}
