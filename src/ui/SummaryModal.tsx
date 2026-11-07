import React, { useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Modal, ScrollView, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { fmtDuration } from '../domain/format.ts';
import { Btn, Row, T } from './components.tsx';
import { S } from './theme.ts';

export interface SummaryData {
  title: string; date: string; durationSec: number | null; volume: number; sets: number; streak: number;
  exercises: { name: string; sets: number; e1rm: number | null; part: string }[];
}

// 공유 카드는 화면 모드와 상관없이 항상 검은 바탕의 흑백 카드
const K = { bg: '#0A0A0A', line: '#2C2C2C', text: '#F2F2F2', muted: '#8E8E8E' };

/** 운동 완료 요약 카드 + 이미지 공유(저장) */
export function SummaryModal({ data, onClose }: { data: SummaryData | null; onClose: () => void }) {
  const ref = useRef<View>(null);
  const insets = useSafeAreaInsets();
  if (!data) return null;

  const share = async () => {
    try {
      // 선택 기능: 화면 캡처 모듈을 이 시점에만 불러온다 (없으면 안내)
      const mod = require('react-native-view-shot') as { captureRef: (r: unknown, o: { format: 'png'; quality: number }) => Promise<string> };
      const uri = await mod.captureRef(ref.current, { format: 'png', quality: 1 });
      if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유 기능을 사용할 수 없습니다');
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '운동 요약 저장' });
    } catch (e) {
      Alert.alert('이미지를 만들 수 없습니다', (e as Error).message);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 24 }}>
          <View ref={ref} collapsable={false} style={{ backgroundColor: K.bg, borderRadius: 16, padding: S.lg, borderWidth: 1, borderColor: K.line }}>
            <T bold style={{ color: K.text, letterSpacing: 3, fontSize: 12 }}>OVERDRIVE</T>
            <T style={{ color: K.muted, marginTop: 2 }}>{data.date} · {data.title}</T>
            <Row style={{ justifyContent: 'space-between', marginVertical: S.lg }}>
              <Big label="운동 시간" value={data.durationSec != null ? fmtDuration(data.durationSec) : '-'} />
              <Big label="총 볼륨" value={`${Math.round(data.volume).toLocaleString()}kg`} />
              <Big label="완료 세트" value={`${data.sets}`} />
            </Row>
            {data.streak > 0 && <T bold style={{ color: K.text, marginBottom: S.md }}>{data.streak}주 연속 기록</T>}
            {data.exercises.map((e, i) => (
              <Row key={i} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: K.line }}>
                <View style={{ flex: 1 }}>
                  <T bold style={{ color: K.text }}>{e.name}</T>
                  <T style={{ color: K.muted, fontSize: 12 }}>{e.part} · {e.sets}세트</T>
                </View>
                <T style={{ color: K.muted }}>{e.e1rm != null ? `e1RM ${e.e1rm}kg` : ''}</T>
              </Row>
            ))}
          </View>
        </ScrollView>
        <Row style={{ padding: S.lg, paddingBottom: S.lg + insets.bottom }}>
          <Btn label="닫기" kind="ghost" style={{ flex: 1 }} onPress={onClose} />
          <Btn label="이미지 저장·공유" style={{ flex: 2 }} onPress={share} />
        </Row>
      </View>
    </Modal>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T bold style={{ color: K.text, fontSize: 22 }}>{value}</T>
      <T style={{ color: K.muted, fontSize: 11 }}>{label}</T>
    </View>
  );
}
