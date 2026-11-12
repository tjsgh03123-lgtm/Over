import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './components.tsx';
import { C, S } from './theme.ts';

/** 운동 진행 화면 공통 틀: 위(뒤로·경과 시간·음성 가이드) / 가운데(내용) / 아래(이전·일시정지·다음). 흑백 톤. */
export type FlowIcon = 'prev' | 'next' | 'pause' | 'play';

export function FlowGlyph({ kind, color, size = 26 }: { kind: FlowIcon | 'back'; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'back' && <Path d="M15 5 L8 12 L15 19" stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === 'pause' && (<><Rect x={6} y={4} width={4.2} height={16} rx={1.2} fill={color} /><Rect x={13.8} y={4} width={4.2} height={16} rx={1.2} fill={color} /></>)}
      {kind === 'play' && <Path d="M7 4 L19 12 L7 20 Z" fill={color} />}
      {kind === 'prev' && (<><Rect x={4} y={4} width={2.4} height={16} rx={1} fill={color} /><Path d="M19 4 L8 12 L19 20 Z" stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" /></>)}
      {kind === 'next' && (<><Rect x={17.6} y={4} width={2.4} height={16} rx={1} fill={color} /><Path d="M5 4 L16 12 L5 20 Z" stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" /></>)}
    </Svg>
  );
}

export function RoundBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
      <T bold style={{ fontSize: 18, lineHeight: 22 }}>{label}</T>
    </Pressable>
  );
}

export function Pill({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={{ paddingHorizontal: 18, minHeight: 48, borderRadius: 24, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontSize: 14 }}>{label}</T>
    </Pressable>
  );
}

export function FlowShell({
  visible, elapsed, paused, guideOn, onBack, onToggleGuide, onPrev, onTogglePause, onNext, prevDisabled, nextDisabled, side, children, onClose,
}: {
  visible: boolean;
  elapsed: string;
  paused: boolean;
  guideOn: boolean;
  onBack: () => void;
  onToggleGuide: () => void;
  onPrev?: () => void;
  onTogglePause?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  side?: React.ReactNode; // 오른쪽 둥근 버튼 줄(⋯ 등)
  children: React.ReactNode;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const bar = (icon: FlowIcon, onPress: (() => void) | undefined, disabled: boolean | undefined, wide?: boolean) => (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityLabel={icon}
      style={{ flex: wide ? 1.3 : 1, height: 68, borderRadius: 34, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center', opacity: disabled || !onPress ? 0.35 : 1 }}
    >
      <FlowGlyph kind={icon} color={C.text} />
    </Pressable>
  );
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + S.sm, paddingBottom: insets.bottom + S.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, height: 52 }}>
          <Pressable onPress={onBack} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <FlowGlyph kind="back" color={C.text} />
            <T bold style={{ fontSize: 22 }}>{elapsed}</T>
            {paused ? <FlowGlyph kind="pause" color={C.muted} size={16} /> : null}
          </Pressable>
          <Pressable onPress={onToggleGuide} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: C.card2 }}>
            <T bold style={{ fontSize: 14 }}>{guideOn ? '음성 가이드 끄기' : '음성 가이드 켜기'}</T>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          {children}
          {side ? <View style={{ position: 'absolute', right: S.lg, top: S.md, gap: S.md }}>{side}</View> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: S.md, paddingHorizontal: S.lg }}>
          {bar('prev', onPrev, prevDisabled)}
          {bar(paused ? 'play' : 'pause', onTogglePause, false, true)}
          {bar('next', onNext, nextDisabled)}
        </View>
      </View>
    </Modal>
  );
}
