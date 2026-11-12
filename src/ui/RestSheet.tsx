import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { fmtElapsed } from '../domain/format.ts';
import { FlowShell, Pill } from './FlowShell.tsx';
import { T } from './components.tsx';
import { useFit } from './fit.ts';
import { C, S } from './theme.ts';

/** 휴식 화면(전체 화면): 큰 시간 → 휴식 시간 설정(±) → 빠른 선택 → 다음 안내. 아래 '다음' 버튼이 휴식 중단/닫기. */
export function RestSheet({
  visible, kind, left, total, done, presets, defaultSec, next, nextTip, stepSec, title, elapsed, guideOn,
  onPreset, onAdjust, onStop, onMini, onToggleGuide, extra,
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
  title?: string; // 지금 종목 이름
  elapsed: string;
  guideOn: boolean;
  onPreset: (sec: number) => void;
  onAdjust: (deltaSec: number) => void;
  onStop: () => void; // 휴식 중단 / 닫기
  onMini: () => void; // 화면을 내리고 아래 줄로 작게
  onToggleGuide: () => void;
  extra?: React.ReactNode; // 저장·카메라로 시작 등 추가 버튼 줄
}) {
  const fit = useFit();
  const list = Array.from(new Set([defaultSec, ...presets])).filter((n) => n > 0);
  return (
    <FlowShell
      visible={visible} elapsed={elapsed} paused={false} guideOn={guideOn}
      onBack={onMini} onClose={onMini} onToggleGuide={onToggleGuide} onNext={onStop}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: S.lg, paddingBottom: S.lg }}>
        {title ? <T bold style={{ fontSize: 26, marginTop: S.xl, marginRight: 60 }}>{title}</T> : null}
        <View style={{ alignItems: 'center', marginTop: S.xl * 2 }}>
          {done ? (
            <T bold style={{ fontSize: fit(56), lineHeight: fit(70) }}>휴식 끝</T>
          ) : (
            <>
              <T bold style={{ fontSize: fit(96), lineHeight: fit(110) }}>{fmtElapsed(left)}</T>
              <T muted style={{ fontSize: 16, marginTop: 2 }}>{kind === 'exercise' ? '종목 간 휴식 시간 설정' : '휴식 시간 설정'}</T>
              <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.lg }}>
                <Pill label={`− ${stepSec}초`} onPress={() => onAdjust(-stepSec)} />
                <Pill label={`+ ${stepSec}초`} onPress={() => onAdjust(stepSec)} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: S.lg }} contentContainerStyle={{ gap: S.sm }}>
                {list.map((sec) => {
                  const on = Math.round(total) === sec;
                  return (
                    <Pressable key={sec} onPress={() => onPreset(sec)} style={{ paddingHorizontal: 14, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.accent : C.card2 }}>
                      <T bold style={{ color: on ? C.onAccent : C.text, fontSize: 13 }}>{sec === defaultSec ? `기본 ${fmtElapsed(sec)}` : fmtElapsed(sec)}</T>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>
        <View style={{ flex: 1 }} />
        <T bold style={{ fontSize: 20, textAlign: 'center', color: C.text, marginTop: S.xl }}>{kind === 'exercise' ? '종목 끝, 쉬는 시간' : '세트 끝, 쉬는 시간'}</T>
        {next ? <T bold style={{ fontSize: 18, textAlign: 'center', marginTop: S.sm }}>{next}</T> : null}
        {nextTip ? <T muted style={{ fontSize: 13, textAlign: 'center', marginTop: 4 }}>{nextTip}</T> : null}
        {extra ? <View style={{ marginTop: S.lg }}>{extra}</View> : null}
      </ScrollView>
    </FlowShell>
  );
}
