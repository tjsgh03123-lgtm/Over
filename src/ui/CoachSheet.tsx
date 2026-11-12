import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { fmtElapsed } from '../domain/format.ts';
import { FlowShell, Pill } from './FlowShell.tsx';
import { T } from './components.tsx';
import { C, S } from './theme.ts';

/**
 * 보이스코칭 진행 화면(전체 화면): 새 종목이면 '다음 운동' 미리보기 + 준비 시간 → 큰 숫자 카운트다운 → "0 / 14회" 횟수 세기.
 * 준비·박자 시간은 이 화면에서 바로 ±로 조절한다. 아래 버튼: 이전(코칭 중단) · 일시정지 · 다음(세트 끝/준비 건너뛰기).
 */
export function CoachSheet({
  visible, phase, title, sub, setNo, setLines, curIdx, left, count, target, tempoSec, exercisePrep,
  elapsed, paused, guideOn, onTogglePause, onToggleGuide,
  onPrepAdjust, onTempoAdjust, onReady, onFinish, onStop,
}: {
  visible: boolean;
  phase: 'prep' | 'count';
  title: string; // 종목 이름
  sub: string; // '25kg × 14회'
  setNo: number;
  setLines: string[]; // 종목의 세트 목록 ('1세트  25kg × 14회')
  curIdx: number; // 지금 세트의 위치(0부터)
  left: number; // 준비 남은 초
  count: number; // 센 횟수
  target: number;
  tempoSec: number;
  exercisePrep: boolean; // 새 종목 준비 중
  elapsed: string;
  paused: boolean;
  guideOn: boolean;
  onTogglePause: () => void;
  onToggleGuide: () => void;
  onPrepAdjust: (deltaSec: number) => void;
  onTempoAdjust: (deltaSec: number) => void;
  onReady: () => void; // 준비 건너뛰기
  onFinish: () => void; // 세트 끝(지금까지 센 횟수로 기록)
  onStop: () => void; // 코칭 중단
}) {
  const chips = (a: string, aP: () => void, mid: string, b: string, bP: () => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, marginTop: S.lg }}>
      <Pill label={a} onPress={aP} />
      <T muted style={{ minWidth: 80, textAlign: 'center' }}>{mid}</T>
      <Pill label={b} onPress={bP} />
    </View>
  );
  const next = `다음 세트 | ${setNo}세트, ${sub}`;
  let body: React.ReactNode;
  if (phase === 'prep' && exercisePrep) {
    body = (
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.lg, paddingTop: S.xl, paddingBottom: S.lg }}>
        <T muted style={{ fontSize: 16 }}>다음 운동</T>
        <T bold style={{ fontSize: 28, marginTop: 4, marginRight: 60 }}>{title}</T>
        <View style={{ marginTop: S.xl, borderLeftWidth: 4, borderLeftColor: C.text, paddingLeft: S.md, paddingVertical: S.sm }}>
          <T bold style={{ fontSize: 18, marginBottom: S.sm }}>본 세트</T>
          {setLines.map((l, i) => (
            <T key={i} bold={i === curIdx} muted={i !== curIdx} style={{ fontSize: 18, lineHeight: 34 }}>{l}</T>
          ))}
        </View>
        <View style={{ marginTop: S.xl, borderRadius: 20, backgroundColor: C.card, padding: S.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T bold style={{ fontSize: 17 }}>준비 시간 수정</T>
          <T bold style={{ fontSize: 44, lineHeight: 52 }}>{fmtElapsed(left)}</T>
        </View>
        {chips('− 5초', () => onPrepAdjust(-5), '준비 시간', '+ 5초', () => onPrepAdjust(5))}
      </ScrollView>
    );
  } else if (phase === 'prep') {
    body = (
      <View style={{ flex: 1, paddingHorizontal: S.lg }}>
        <T muted style={{ fontSize: 16, marginTop: S.xl }}>{`${setNo} / ${setLines.length}`}</T>
        <T bold style={{ fontSize: 26, marginTop: 4, marginRight: 60 }}>{title}</T>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <T bold style={{ fontSize: 200, lineHeight: 220 }}>{left}</T>
        </View>
        <T bold style={{ fontSize: 20, textAlign: 'center' }}>{next}</T>
        {chips('− 5초', () => onPrepAdjust(-5), '준비 시간', '+ 5초', () => onPrepAdjust(5))}
        <View style={{ height: S.xl }} />
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1, paddingHorizontal: S.lg }}>
        <T muted style={{ fontSize: 16, marginTop: S.xl }}>{`${setNo} / ${setLines.length}`}</T>
        <T bold style={{ fontSize: 26, marginTop: 4, marginRight: 60 }}>{title}</T>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}>
          <T bold style={{ fontSize: 150, lineHeight: 170 }}>{count}</T>
          <T bold style={{ fontSize: 34, marginLeft: 12, marginTop: 70 }}>{`/ ${target}회`}</T>
        </View>
        <T bold style={{ fontSize: 20, textAlign: 'center' }}>{`${setNo}세트 진행중 | ${sub}`}</T>
        {chips('− 0.5초', () => onTempoAdjust(-0.5), `한 회 ${tempoSec}초`, '+ 0.5초', () => onTempoAdjust(0.5))}
        <View style={{ height: S.xl }} />
      </View>
    );
  }
  return (
    <FlowShell
      visible={visible} elapsed={elapsed} paused={paused} guideOn={guideOn}
      onBack={onStop} onClose={onStop} onToggleGuide={onToggleGuide} onTogglePause={onTogglePause}
      onNext={phase === 'prep' ? onReady : onFinish} nextDisabled={phase === 'count' && count <= 0}
    >
      {body}
    </FlowShell>
  );
}
