import React, { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { C } from './theme.ts';

/**
 * 가로 슬라이더. values가 1개면 재생 위치 막대, 2개면 구간(시작·끝) 선택.
 * 막대 아무 곳이나 누르거나 끌 수 있고, 2개일 때는 가까운 손잡이가 움직인다.
 */
export function MultiSlider({
  values, max, onChange, onEnd, color, minGap = 0,
}: {
  values: number[];
  max: number;
  onChange: (v: number[], active: number) => void;
  onEnd?: () => void;
  color?: string;
  /** 구간 선택일 때 시작과 끝 사이 최소 간격 */
  minGap?: number;
}) {
  const [w, setW] = useState(0);
  const live = useRef({ values, max, w, minGap, onChange, onEnd });
  live.current = { values, max, w, minGap, onChange, onEnd };
  const g = useRef({ active: -1, x0: 0, undecided: false });

  const toValue = (x: number) => {
    const { w: W, max: M } = live.current;
    return W > 0 ? Math.max(0, Math.min(M, (x / W) * M)) : 0;
  };
  const apply = (idx: number, val: number) => {
    const { values: vs, minGap: gap } = live.current;
    const next = vs.slice();
    if (vs.length === 2) {
      next[idx] = idx === 0 ? Math.min(val, vs[1] - gap) : Math.max(val, vs[0] + gap);
      next[idx] = Math.max(0, Math.min(live.current.max, next[idx]));
    } else next[0] = val;
    live.current.onChange(next, idx);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { values: vs, w: W, max: M } = live.current;
        const x = e.nativeEvent.locationX;
        g.current.x0 = x;
        if (vs.length === 1) {
          g.current.active = 0; g.current.undecided = false;
          apply(0, toValue(x));
          return;
        }
        const px = vs.map((v) => (M > 0 ? (v / M) * W : 0));
        const d0 = Math.abs(x - px[0]), d1 = Math.abs(x - px[1]);
        if (Math.abs(d0 - d1) < 3) { g.current.undecided = true; g.current.active = -1; }
        else { g.current.undecided = false; g.current.active = d0 < d1 ? 0 : 1; }
      },
      onPanResponderMove: (_e, gs) => {
        const x = g.current.x0 + gs.dx;
        if (g.current.undecided) {
          if (Math.abs(gs.dx) < 4) return;
          g.current.active = gs.dx > 0 ? 1 : 0;
          g.current.undecided = false;
        }
        if (g.current.active >= 0) apply(g.current.active, toValue(x));
      },
      onPanResponderRelease: () => live.current.onEnd?.(),
      onPanResponderTerminate: () => live.current.onEnd?.(),
    }),
  ).current;

  const col = color ?? C.accent;
  const px = values.map((v) => (max > 0 ? (v / max) * w : 0));
  const left = values.length === 2 ? px[0] : 0;
  const right = values.length === 2 ? px[1] : px[0];
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers} style={{ height: 44, justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: C.card2 }} />
      <View pointerEvents="none" style={{ position: 'absolute', left, width: Math.max(0, right - left), height: 6, borderRadius: 3, backgroundColor: col }} />
      {px.map((x, i) => (
        <View
          key={i} pointerEvents="none"
          style={{ position: 'absolute', left: x - 11, width: 22, height: 22, borderRadius: 11, backgroundColor: C.text, borderWidth: 3, borderColor: col }}
        />
      ))}
    </View>
  );
}
