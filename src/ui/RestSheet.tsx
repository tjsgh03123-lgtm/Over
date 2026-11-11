import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtElapsed } from '../domain/format.ts';
import { Btn, Row, T } from './components.tsx';
import { C, S } from './theme.ts';

/** 휴식 타이머 팝업(아래에서 올라오는 시트): 빠른 시간 선택 → 원형 카운트다운 → ±조절 → 중단 → 다음 안내 */
export function RestSheet({
  visible, kind, left, total, done, presets, defaultSec, next, nextTip, stepSec,
  onPreset, onAdjust, onStop, onMini, extra,
}: {
  visible: boolean;
  kind: 'set' | 'exercise';
  left: number; // 남은 초
  total: number; // 전체 초
  done: boolean;
  presets: number[]; // 빠른 선택(초)
  defaultSec: number; // 이 종목·상황의 기본 휴식(초)
  next?: string | null; // '다음 세트 | 3세트 · 25kg × 14회' 같은 안내
  nextTip?: string | null;
  stepSec: number; // ± 버튼 단위
  onPreset: (sec: number) => void;
  onAdjust: (deltaSec: number) => void;
  onStop: () => void; // 휴식 중단 / 닫기
  onMini: () => void; // 시트를 내리고 아래 줄로 작게
  extra?: React.ReactNode; // 저장·카메라로 시작 등 추가 버튼 줄
}) {
  const insets = useSafeAreaInsets();
  const SIZE = 220;
  const STROKE = 12;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  const frac = done ? 0 : total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const list = Array.from(new Set([defaultSec, ...presets])).filter((n) => n > 0);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onMini}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onMini} accessibilityLabel="시트 내리기" />
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: S.md, paddingBottom: insets.bottom + S.lg, paddingHorizontal: S.lg }}>
          <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: S.md }} />
          <Row>
            <T bold style={{ flex: 1, fontSize: 20, textAlign: 'center', marginLeft: 56 }}>휴식 타이머</T>
            <Btn label="작게" kind="ghost" small onPress={onMini} />
          </Row>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: S.lg }} contentContainerStyle={{ gap: S.sm }}>
            {list.map((sec) => {
              const on = !done && Math.round(total) === sec;
              return (
                <Pressable
                  key={sec}
                  onPress={() => onPreset(sec)}
                  style={{ paddingHorizontal: 18, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.accent : C.card2 }}
                >
                  <T bold style={{ color: on ? C.onAccent : C.text, fontSize: 15 }}>{sec === defaultSec ? `기본 ${fmtElapsed(sec)}` : fmtElapsed(sec)}</T>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ alignItems: 'center', marginTop: S.xl }}>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={SIZE} height={SIZE} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={C.card2} strokeWidth={STROKE} fill="none" />
                <Circle
                  cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={C.accent} strokeWidth={STROKE} fill="none"
                  strokeLinecap="round" strokeDasharray={`${CIRC} ${CIRC}`} strokeDashoffset={CIRC * (1 - frac)}
                />
              </Svg>
              {done ? (
                <T bold style={{ fontSize: 36 }}>휴식 끝</T>
              ) : (
                <>
                  <T bold style={{ fontSize: 56, lineHeight: 64 }}>{fmtElapsed(left)}</T>
                  <T muted style={{ fontSize: 13, marginTop: 2 }}>{kind === 'exercise' ? '종목 간 휴식' : '세트 간 휴식'}</T>
                </>
              )}
            </View>
          </View>

          {!done && (
            <Row style={{ justifyContent: 'center', marginTop: S.lg, gap: S.lg }}>
              <Btn label={`− ${stepSec}초`} kind="ghost" onPress={() => onAdjust(-stepSec)} style={{ minWidth: 110 }} />
              <Btn label={`+ ${stepSec}초`} kind="ghost" onPress={() => onAdjust(stepSec)} style={{ minWidth: 110 }} />
            </Row>
          )}

          <Btn label={done ? '닫기' : '휴식 중단'} kind={done ? 'primary' : 'ghost'} onPress={onStop} style={{ marginTop: S.lg, height: 52 }} />
          {extra ? <View style={{ marginTop: S.sm }}>{extra}</View> : null}

          {next ? (
            <View style={{ marginTop: S.lg, padding: S.md, borderRadius: 16, backgroundColor: C.card2 }}>
              <T bold style={{ fontSize: 15 }}>{next}</T>
              {nextTip ? <T muted style={{ fontSize: 12, marginTop: 4 }}>📍 {nextTip}</T> : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
