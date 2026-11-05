import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Text, Vibration, View, useWindowDimensions, type ScrollView } from 'react-native';
import { clampDrag, targetIndex } from '../domain/reorder.ts';
import { C } from './theme.ts';

/** 목록이 들어 있는 ScrollView와 연결하면, 끌면서 화면 가장자리로 가면 자동으로 스크롤된다 */
export interface ScrollLink {
  ref: React.RefObject<ScrollView | null>;
  /** ScrollView의 onScroll에서 현재 y를 이 값에 기록해 둔다 */
  offset: React.MutableRefObject<number>;
}

interface DragApi {
  start(index: number): void;
  move(dy: number, moveY: number): void;
  drop(): void;
}

const HOLD_MS = 220; // 이만큼 누르고 있으면 끌기 시작
const EDGE_TOP = 150; // 화면 위쪽 이 안으로 가면 위로 스크롤
const EDGE_BOTTOM = 130;

/** 줄 오른쪽 끝의 ≡ 손잡이. 길게 누른 채로 위아래로 끌면 순서가 바뀐다. */
function DragHandle({ index, api, lifted }: { index: number; api: React.MutableRefObject<DragApi>; lifted: boolean }) {
  const idx = useRef(index);
  idx.current = index;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const end = () => {
    clear();
    if (active.current) { active.current = false; api.current.drop(); }
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // 끄는 동안 스크롤뷰가 터치를 가져가지 못하게
      onPanResponderGrant: () => {
        active.current = false;
        clear();
        timer.current = setTimeout(() => { active.current = true; api.current.start(idx.current); }, HOLD_MS);
      },
      onPanResponderMove: (_e, g) => {
        if (!active.current) {
          if (Math.abs(g.dy) > 12 || Math.abs(g.dx) > 12) clear(); // 길게 누르기 전에 움직이면 취소
          return;
        }
        api.current.move(g.dy, g.moveY);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      accessibilityLabel="길게 눌러 순서 바꾸기"
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
    >
      <Text style={{ fontSize: 22, color: lifted ? C.text : C.muted }}>≡</Text>
    </View>
  );
}

/**
 * 끌어서 순서를 바꾸는 목록. 줄마다 renderItem이 돌려주는 handle(≡)을 줄 오른쪽 끝에 놓으면 된다.
 * 손잡이를 길게 누르면 줄이 떠올라 손가락을 따라 움직이고, 놓으면 onReorder(from, to)가 불린다.
 */
export function ReorderList<T>({
  items, keyOf, renderItem, onReorder, onDragChange, scroll,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number, handle: React.ReactNode) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  /** 끄는 동안 true — 화면의 ScrollView를 잠글 때 사용 */
  onDragChange?: (dragging: boolean) => void;
  scroll?: ScrollLink;
}) {
  const heights = useRef<Record<string, number>>({});
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const st = useRef<{ from: number; gdy: number; moveY: number; startOffset: number; timer: ReturnType<typeof setInterval> | null }>({
    from: -1, gdy: 0, moveY: 0, startOffset: 0, timer: null,
  });
  const { height: winH } = useWindowDimensions();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  const hs = () => itemsRef.current.map((it) => heights.current[keyRef.current(it)] ?? 0);
  const effDy = () => st.current.gdy + (scroll ? scroll.offset.current - st.current.startOffset : 0);
  const refresh = () => setDrag({ from: st.current.from, dy: effDy() });
  const stopTimer = () => { if (st.current.timer) { clearInterval(st.current.timer); st.current.timer = null; } };
  useEffect(() => stopTimer, []);

  const api = useRef<DragApi>({ start() {}, move() {}, drop() {} });
  api.current = {
    start(index) {
      st.current.from = index;
      st.current.gdy = 0;
      st.current.moveY = 0;
      st.current.startOffset = scroll?.offset.current ?? 0;
      Vibration.vibrate(12);
      onDragChange?.(true);
      refresh();
      if (scroll) {
        st.current.timer = setInterval(() => {
          const y = st.current.moveY;
          const cur = scroll.offset.current;
          if (y > 0 && y < EDGE_TOP) { scroll.ref.current?.scrollTo({ y: Math.max(0, cur - 14), animated: false }); refresh(); }
          else if (y > winH - EDGE_BOTTOM) { scroll.ref.current?.scrollTo({ y: cur + 14, animated: false }); refresh(); }
        }, 16);
      }
    },
    move(dy, moveY) {
      st.current.gdy = dy;
      st.current.moveY = moveY;
      refresh();
    },
    drop() {
      stopTimer();
      const from = st.current.from;
      const h = hs();
      const to = targetIndex(h, from, clampDrag(h, from, effDy()));
      st.current.from = -1;
      setDrag(null);
      onDragChange?.(false);
      if (to !== from) onReorder(from, to);
    },
  };

  const h = hs();
  const dy = drag ? clampDrag(h, drag.from, drag.dy) : 0;
  const target = drag ? targetIndex(h, drag.from, dy) : -1;

  return (
    <View>
      {items.map((it, i) => {
        const k = keyOf(it);
        let ty = 0;
        const lifted = !!drag && i === drag.from;
        if (drag) {
          if (lifted) ty = dy;
          else if (drag.from < target && i > drag.from && i <= target) ty = -h[drag.from];
          else if (drag.from > target && i >= target && i < drag.from) ty = h[drag.from];
        }
        return (
          <View
            key={k}
            onLayout={(e) => { heights.current[k] = e.nativeEvent.layout.height; }}
            style={{ transform: [{ translateY: ty }], zIndex: lifted ? 10 : 0, elevation: lifted ? 8 : 0, opacity: lifted ? 0.95 : 1 }}
          >
            {renderItem(it, i, <DragHandle index={i} api={api} lifted={lifted} />)}
          </View>
        );
      })}
    </View>
  );
}
