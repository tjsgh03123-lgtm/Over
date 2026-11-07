/** 카메라에서 관절이 지나간 길(궤적)을 화면에 그리기 위한 계산. 좌표는 0~1(화면 비율) */
export type TrailJoint = 'off' | 'wrist' | 'elbow' | 'hip' | 'knee';
export const TRAIL_LABEL: Record<TrailJoint, string> = { off: '경로 끔', wrist: '손목(바벨)', elbow: '팔꿈치', hip: '엉덩이', knee: '무릎' };
/** 좌·우 랜드마크 번호 (MediaPipe Pose) */
const IDX: Record<Exclude<TrailJoint, 'off'>, [number, number]> = { wrist: [15, 16], elbow: [13, 14], hip: [23, 24], knee: [25, 26] };

export interface TrailPoint { x: number; y: number }

/** lm = [x,y,visibility]가 33개 이어진 배열. 보이는 쪽(둘 다 보이면 평균)의 위치를 돌려준다. 안 보이면 null */
export function jointPoint(lm: ArrayLike<number>, joint: TrailJoint, minVis = 0.5): TrailPoint | null {
  if (joint === 'off') return null;
  const pts = IDX[joint].filter((i) => lm[i * 3 + 2] > minVis).map((i) => ({ x: lm[i * 3], y: lm[i * 3 + 1] }));
  if (!pts.length) return null;
  return { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length };
}

/** 최근 max개의 위치만 기억하는 궤적 */
export class PathTrail {
  private pts: TrailPoint[] = [];
  private max: number;
  constructor(max = 90) { this.max = max; }
  push(p: TrailPoint | null): void {
    if (!p) return;
    const last = this.pts[this.pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.002 && Math.abs(last.y - p.y) < 0.002) return; // 거의 안 움직이면 쌓지 않음
    this.pts.push(p);
    if (this.pts.length > this.max) this.pts.shift();
  }
  get points(): readonly TrailPoint[] { return this.pts; }
  reset(): void { this.pts = []; }
  /** 위아래로 움직인 폭(화면 높이 대비 %) — 운동 범위 확인용 */
  get verticalRangePct(): number {
    if (this.pts.length < 2) return 0;
    const ys = this.pts.map((p) => p.y);
    return Math.round((Math.max(...ys) - Math.min(...ys)) * 100);
  }
}
