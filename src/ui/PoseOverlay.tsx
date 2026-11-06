import React from 'react';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { FRAME_STRIDE, LM_COUNT, MIN_VISIBILITY, pointAt, SKELETON, type AngleDef } from '../domain/pose.ts';

/** 영상 위에 겹치는 관절·뼈대·각도·궤적. 좌표는 0..1이라 화면 크기(w,h)만 맞으면 된다. */
export function PoseOverlay({
  track, frame, w, h, def, color, showTrail = true,
}: {
  track: Float32Array; frame: number; w: number; h: number; def: AngleDef; color: string; showTrail?: boolean;
}) {
  const n = Math.floor(track.length / FRAME_STRIDE);
  if (n === 0) return null;
  const f = Math.max(0, Math.min(n - 1, frame));
  const P = (id: number, ff = f) => pointAt(track, ff, id, w, h);
  const ok = (p: { v: number }) => p.v >= MIN_VISIBILITY;

  const lines = SKELETON.map(([a, b], i) => {
    const p = P(a), q = P(b);
    return ok(p) && ok(q) ? <Line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={2} /> : null;
  });
  const dots = [] as React.ReactNode[];
  for (let i = 11; i < LM_COUNT; i++) {
    if (i > 28) break;
    const p = P(i);
    if (ok(p)) dots.push(<Circle key={i} cx={p.x} cy={p.y} r={3} fill="#FFFFFF" fillOpacity={0.8} />);
  }
  const A = P(def.a), B = P(def.b), Cc = P(def.c);
  const chainOk = ok(A) && ok(B) && ok(Cc);

  let trail: React.ReactNode = null;
  if (showTrail) {
    const pts: string[] = [];
    for (let k = 0; k <= f; k++) {
      const p = P(def.b, k);
      if (ok(p)) pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    if (pts.length > 1) trail = <Polyline points={pts.join(' ')} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={2} />;
  }

  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {lines}
      {dots}
      {trail}
      {chainOk && (
        <>
          <Line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
          <Line x1={Cc.x} y1={Cc.y} x2={B.x} y2={B.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
          <Circle cx={A.x} cy={A.y} r={5} fill={color} />
          <Circle cx={Cc.x} cy={Cc.y} r={5} fill={color} />
          <Circle cx={B.x} cy={B.y} r={8} fill={color} stroke="#FFFFFF" strokeWidth={2} />
        </>
      )}
    </Svg>
  );
}
