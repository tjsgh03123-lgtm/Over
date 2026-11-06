import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { Rep } from '../domain/pose.ts';
import { C } from './theme.ts';

const H = 170;
const PAD = { l: 34, r: 8, t: 10, b: 20 };

/** 시간(프레임)에 따른 각도 그래프. 누르면 그 지점으로 이동, 빨간 띠는 관절이 잘 안 보인 구간, 세로 점선은 반복 구분. */
export function AngleChart({
  series, stepMs, reps, low, cursorFrame, onSeek, color,
}: {
  series: (number | null)[]; stepMs: number; reps: Rep[]; low: [number, number][]; cursorFrame: number; onSeek: (frame: number) => void; color: string;
}) {
  const [w, setW] = useState(0);
  const n = series.length;
  const plotW = Math.max(1, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;

  const { lo, hi, segs } = useMemo(() => {
    const vals = series.filter((v): v is number => v != null);
    let mn = vals.length ? Math.min(...vals) : 0, mx = vals.length ? Math.max(...vals) : 180;
    if (mx - mn < 20) { mn -= 10; mx += 10; }
    mn = Math.floor((mn - 5) / 10) * 10; mx = Math.ceil((mx + 5) / 10) * 10;
    const out: number[][][] = [];
    let cur: number[][] = [];
    series.forEach((v, i) => {
      if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push([i, v]);
    });
    if (cur.length) out.push(cur);
    return { lo: mn, hi: mx, segs: out };
  }, [series]);

  const xOf = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const yOf = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const totalSec = ((n - 1) * stepMs) / 1000;

  return (
    <Pressable
      onPress={(e) => {
        const x = e.nativeEvent.locationX;
        onSeek(Math.round(Math.max(0, Math.min(1, (x - PAD.l) / plotW)) * (n - 1)));
      }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: H }}
    >
      {w > 0 && (
        <Svg width={w} height={H}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <React.Fragment key={v}>
              <Line x1={PAD.l} x2={w - PAD.r} y1={yOf(v)} y2={yOf(v)} stroke={C.line} strokeWidth={1} />
              <SvgText x={PAD.l - 4} y={yOf(v) + 4} fontSize={10} fill={C.muted} textAnchor="end">{Math.round(v)}°</SvgText>
            </React.Fragment>
          ))}
          {low.map(([a, b], i) => (
            <Rect key={i} x={xOf(a)} y={PAD.t} width={Math.max(2, xOf(b) - xOf(a))} height={plotH} fill="#E53935" fillOpacity={0.22} />
          ))}
          {reps.map((r, i) => (
            <Line key={i} x1={xOf(r.endFrame)} x2={xOf(r.endFrame)} y1={PAD.t} y2={PAD.t + plotH} stroke={C.muted} strokeDasharray="3,3" strokeWidth={1} />
          ))}
          {segs.map((s, i) => (
            <Polyline key={i} points={s.map(([f, v]) => `${xOf(f).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2.5} />
          ))}
          <Line x1={xOf(cursorFrame)} x2={xOf(cursorFrame)} y1={PAD.t} y2={PAD.t + plotH} stroke={C.text} strokeWidth={1.5} />
          <SvgText x={PAD.l} y={H - 4} fontSize={10} fill={C.muted}>0초</SvgText>
          <SvgText x={w - PAD.r} y={H - 4} fontSize={10} fill={C.muted} textAnchor="end">{totalSec.toFixed(1)}초</SvgText>
        </Svg>
      )}
      {w === 0 && <View />}
    </Pressable>
  );
}
