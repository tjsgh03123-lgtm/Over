import React, { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { C } from './theme.ts';

export interface ChartPoint<M = unknown> {
  date: string; // YYYY-MM-DD
  value: number;
  meta?: M;
}
export interface ChartSeries<M = unknown> {
  key: string;
  label: string;
  color: string;
  points: ChartPoint<M>[];
}

const H = 220;
const PAD = { l: 44, r: 14, t: 14, b: 28 };

function dayNum(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * 날짜(시간 비례) × 값 라인 차트. 측정하지 않은 날짜는 보간하지 않고 실제 기록 지점만 선으로 연결한다.
 * 점을 누르면 onSelect로 해당 지점(+ 시리즈)을 전달한다.
 */
export function LineChart<M>({
  series, selected, onSelect, unit = 'kg', invert,
}: {
  series: ChartSeries<M>[];
  selected?: { seriesKey: string; date: string } | null;
  onSelect?: (seriesKey: string, p: ChartPoint<M>) => void;
  unit?: string;
  invert?: boolean; // (어시스트 운동 등) 낮을수록 좋은 경우 y축 반전 표시 안내용
}) {
  const { width: screenW } = useWindowDimensions();
  const W = screenW - 32 - 34; // 화면 패딩 + 카드 패딩
  const [, force] = useState(0);

  const layout = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (!all.length) return null;
    const xs = all.map((p) => dayNum(p.date));
    const ys = all.map((p) => p.value);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    const padY = (y1 - y0) * 0.15 || Math.max(1, y1 * 0.05);
    y0 -= padY; y1 += padY;
    const px = (d: string) => PAD.l + ((dayNum(d) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const py = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
    const ticks = [0, 1, 2, 3].map((i) => y0 + ((y1 - y0) * i) / 3);
    const firstDate = all.reduce((a, p) => (p.date < a ? p.date : a), all[0].date);
    const lastDate = all.reduce((a, p) => (p.date > a ? p.date : a), all[0].date);
    return { px, py, ticks, firstDate, lastDate };
  }, [series, W]);

  if (!layout) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.muted }}>표시할 기록이 없습니다</Text>
      </View>
    );
  }
  const { px, py, ticks, firstDate, lastDate } = layout;
  const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  return (
    <View>
      <Svg width={W} height={H}>
        {ticks.map((t, i) => (
          <G key={i}>
            <Line x1={PAD.l} x2={W - PAD.r} y1={py(t)} y2={py(t)} stroke={C.line} strokeWidth={1} />
            <SvgText x={PAD.l - 6} y={py(t) + 4} fill={C.muted} fontSize={10} textAnchor="end">{fmt(t)}</SvgText>
          </G>
        ))}
        <SvgText x={PAD.l} y={H - 8} fill={C.muted} fontSize={10} textAnchor="start">{md(firstDate)}</SvgText>
        <SvgText x={W - PAD.r} y={H - 8} fill={C.muted} fontSize={10} textAnchor="end">{md(lastDate)}</SvgText>
        {series.map((s) => (
          <G key={s.key}>
            {s.points.length > 1 && (
              <Polyline
                points={s.points.map((p) => `${px(p.date)},${py(p.value)}`).join(' ')}
                fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round"
              />
            )}
            {s.points.map((p) => {
              const sel = selected?.seriesKey === s.key && selected.date === p.date;
              return (
                <G key={p.date}>
                  {/* 터치 영역을 넓히기 위한 투명 원 */}
                  <Circle cx={px(p.date)} cy={py(p.value)} r={16} fill="transparent" onPress={() => { onSelect?.(s.key, p); force((n) => n + 1); }} />
                  <Circle cx={px(p.date)} cy={py(p.value)} r={sel ? 6.5 : 4} fill={sel ? C.card : s.color} stroke={s.color} strokeWidth={sel ? 3 : 0} />
                </G>
              );
            })}
          </G>
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
        {series.map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
            <Text style={{ color: C.muted, fontSize: 12 }}>{s.label}</Text>
          </View>
        ))}
        <Text style={{ color: C.muted, fontSize: 12, marginLeft: 'auto' }}>{unit}{invert ? ' · 낮을수록 좋음' : ''}</Text>
      </View>
    </View>
  );
}

export function PressableRow({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return <Pressable onPress={onPress}>{children}</Pressable>;
}
