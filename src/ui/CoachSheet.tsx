import React from 'react';
import { Modal, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtElapsed } from '../domain/format.ts';
import { Btn, Row, T } from './components.tsx';
import { C, S } from './theme.ts';

/**
 * 보이스코칭 진행 시트: 준비 카운트다운 → 박자에 맞춘 횟수 세기.
 * 준비·박자 시간은 이 시트에서 바로 ±로 조절한다. 세트를 일찍 끝내거나 코칭을 멈출 수 있다.
 */
export function CoachSheet({
  visible, phase, title, sub, left, total, count, target, tempoSec, exercisePrep,
  onPrepAdjust, onTempoAdjust, onReady, onFinish, onStop,
}: {
  visible: boolean;
  phase: 'prep' | 'count';
  title: string; // 종목 이름
  sub: string; // '2세트 · 25kg × 12회'
  left: number; // 준비 남은 초
  total: number; // 준비 전체 초
  count: number; // 센 횟수
  target: number;
  tempoSec: number;
  exercisePrep: boolean; // 새 종목 준비 중이면 '준비 끝' 버튼
  onPrepAdjust: (deltaSec: number) => void;
  onTempoAdjust: (deltaSec: number) => void;
  onReady: () => void; // 준비 끝 → 5초 뒤 시작 / 바로 시작
  onFinish: () => void; // 세트 끝(지금까지 센 횟수로 기록)
  onStop: () => void; // 코칭 중단
}) {
  const insets = useSafeAreaInsets();
  const SIZE = 220;
  const STROKE = 12;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  const frac = phase === 'prep' ? (total > 0 ? Math.max(0, Math.min(1, left / total)) : 0) : target > 0 ? Math.max(0, Math.min(1, count / target)) : 0;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onStop}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: C.overlay }}>
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: S.md, paddingBottom: insets.bottom + S.lg, paddingHorizontal: S.lg }}>
          <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: S.md }} />
          <T bold style={{ fontSize: 20, textAlign: 'center' }}>{title}</T>
          <T muted style={{ textAlign: 'center', marginTop: 2 }}>{sub}</T>

          <View style={{ alignItems: 'center', marginTop: S.xl }}>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={SIZE} height={SIZE} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={C.card2} strokeWidth={STROKE} fill="none" />
                <Circle
                  cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={C.accent} strokeWidth={STROKE} fill="none"
                  strokeLinecap="round" strokeDasharray={`${CIRC} ${CIRC}`} strokeDashoffset={CIRC * (1 - frac)}
                />
              </Svg>
              {phase === 'prep' ? (
                <>
                  <T bold style={{ fontSize: 56, lineHeight: 64 }}>{fmtElapsed(left)}</T>
                  <T muted style={{ fontSize: 13, marginTop: 2 }}>{exercisePrep ? '다음 종목 준비' : '세트 준비'}</T>
                </>
              ) : (
                <>
                  <T bold style={{ fontSize: 64, lineHeight: 72 }}>{count}</T>
                  <T muted style={{ fontSize: 13, marginTop: 2 }}>목표 {target}회</T>
                </>
              )}
            </View>
          </View>

          <Row style={{ justifyContent: 'center', marginTop: S.lg, gap: S.lg }}>
            {phase === 'prep' ? (
              <>
                <Btn label="− 5초" kind="ghost" onPress={() => onPrepAdjust(-5)} style={{ minWidth: 110 }} />
                <Btn label="+ 5초" kind="ghost" onPress={() => onPrepAdjust(5)} style={{ minWidth: 110 }} />
              </>
            ) : (
              <>
                <Btn label={`− 0.5초`} kind="ghost" onPress={() => onTempoAdjust(-0.5)} style={{ minWidth: 110 }} />
                <T muted style={{ alignSelf: 'center' }}>한 회 {tempoSec}초</T>
                <Btn label={`+ 0.5초`} kind="ghost" onPress={() => onTempoAdjust(0.5)} style={{ minWidth: 110 }} />
              </>
            )}
          </Row>

          {phase === 'prep' ? (
            <Btn label={exercisePrep ? '준비 끝 · 5초 후 시작' : '바로 시작'} onPress={onReady} style={{ marginTop: S.lg, height: 52 }} />
          ) : (
            <Btn label={`세트 끝 (${count}회로 기록)`} onPress={onFinish} disabled={count <= 0} style={{ marginTop: S.lg, height: 52 }} />
          )}
          <Btn label="코칭 중단" kind="ghost" onPress={onStop} style={{ marginTop: S.sm, height: 48 }} />
        </View>
      </View>
    </Modal>
  );
}
