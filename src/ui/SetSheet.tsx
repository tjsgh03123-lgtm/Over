import React, { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { barbellTotal } from '../domain/workoutStats.ts';
import { Btn, Chip, Row, T } from './components.tsx';
import { C, S } from './theme.ts';

export interface SheetSet { weight: number | null; reps: number | null; setNo: number; kind: 'working' | 'warmup' | 'rm' }
const PLATES = [1.25, 2.5, 5, 10, 15, 20];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 세트를 누르면 아래에서 올라오는 입력 시트: 큰 −/+ 버튼, 최근·추천, 바+원판 계산, 남은 세트 통일 */
export function SetSheet({
  visible, title, set, weightLabel, bodyweight, barbell, step, barKg, last, recommend,
  onClose, onKind, onComplete, onApplyRest, onDelete,
}: {
  visible: boolean; title: string; set: SheetSet | null; weightLabel: string; bodyweight: boolean; barbell: boolean; step: number; barKg: number;
  last: { weight: number | null; reps: number | null } | null; recommend: { weight: number; reps: number } | null;
  onClose: () => void; onKind: (k: 'working' | 'warmup' | 'rm') => void;
  onComplete: (weight: number | null, reps: number | null) => void;
  onApplyRest: (weight: number | null, reps: number | null) => void;
  onDelete: () => void;
}) {
  const [w, setW] = useState(0);
  const [r, setR] = useState(0);
  const [plates, setPlates] = useState<number[]>([]);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!visible || !set) return;
    setW(set.weight ?? recommend?.weight ?? last?.weight ?? 0);
    setR(set.reps ?? recommend?.reps ?? last?.reps ?? 0);
    setPlates([]);
  }, [visible, set?.setNo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible || !set) return null;

  const fw = bodyweight && w === 0 ? null : w;
  const Stepper = ({ label, value, unit, small, big, onChange }: { label: string; value: number; unit: string; small: number; big: number; onChange: (v: number) => void }) => (
    <View style={{ flex: 1 }}>
      <T muted style={{ fontSize: 12, textAlign: 'center' }}>{label}</T>
      <T bold style={{ fontSize: 34, textAlign: 'center', marginVertical: 2 }}>{value}<T muted style={{ fontSize: 14 }}> {unit}</T></T>
      <Row style={{ justifyContent: 'center' }}>
        <Btn label="−" kind="ghost" small onPress={() => onChange(Math.max(0, round2(value - small)))} />
        <T bold style={{ minWidth: 38, textAlign: 'center' }}>{small}</T>
        <Btn label="+" kind="ghost" small onPress={() => onChange(round2(value + small))} />
      </Row>
      <Row style={{ justifyContent: 'center', marginTop: 4 }}>
        <Btn label="−" kind="ghost" small onPress={() => onChange(Math.max(0, round2(value - big)))} />
        <T bold style={{ minWidth: 38, textAlign: 'center' }}>{big}</T>
        <Btn label="+" kind="ghost" small onPress={() => onChange(round2(value + big))} />
      </Row>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg, paddingBottom: S.lg + insets.bottom, maxHeight: '88%' }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Row style={{ marginBottom: S.sm }}>
            <T bold style={{ flex: 1, fontSize: 16 }}>{title} · {set.setNo}세트</T>
            <Btn label="삭제" kind="danger" small onPress={onDelete} />
          </Row>
          <Row style={{ flexWrap: 'wrap', marginBottom: S.md }}>
            <Chip label="본 세트" active={set.kind === 'working'} onPress={() => onKind('working')} />
            <Chip label="준비 세트" active={set.kind === 'warmup'} onPress={() => onKind('warmup')} />
            <Chip label="1RM 측정" active={set.kind === 'rm'} onPress={() => onKind('rm')} />
          </Row>

          <Row style={{ alignItems: 'flex-start', gap: 16 }}>
            <Stepper label={weightLabel} value={w} unit="kg" small={step} big={5} onChange={setW} />
            <Stepper label="횟수" value={r} unit="회" small={1} big={5} onChange={setR} />
          </Row>

          {barbell && (
            <View style={{ marginTop: S.md, padding: S.md, borderRadius: 12, backgroundColor: C.card2 }}>
              <T muted style={{ fontSize: 12 }}>바 {barKg}kg + 한쪽 원판 (양쪽 같게)</T>
              <Row style={{ flexWrap: 'wrap', marginVertical: 6 }}>
                {PLATES.map((p) => <Chip key={p} label={`+${p}`} onPress={() => setPlates((l) => [...l, p])} />)}
              </Row>
              <Row>
                <T style={{ flex: 1 }}>
                  {plates.length ? plates.join(' + ') : '원판 없음'} → <T bold>{barbellTotal(barKg, plates)}kg</T>
                </T>
                <Btn label="초기화" kind="ghost" small onPress={() => setPlates([])} />
                <Btn label="적용" small onPress={() => setW(barbellTotal(barKg, plates))} />
              </Row>
            </View>
          )}

          <Row style={{ marginTop: S.md, flexWrap: 'wrap' }}>
            {last?.weight != null && (
              <Chip label={`최근 ${last.weight}kg × ${last.reps ?? '-'}회`} onPress={() => { setW(last.weight ?? 0); setR(last.reps ?? 0); }} />
            )}
            {recommend && (
              <Chip label={`추천 ${recommend.weight}kg × ${recommend.reps}회`} onPress={() => { setW(recommend.weight); setR(recommend.reps); }} />
            )}
          </Row>

          <Row style={{ marginTop: S.lg }}>
            <Btn label="남은 세트 통일" kind="ghost" style={{ flex: 1 }} onPress={() => onApplyRest(fw, r || null)} />
            <Btn label="✓ 세트 완료" style={{ flex: 1 }} onPress={() => onComplete(fw, r || null)} />
          </Row>
        </ScrollView>
      </View>
    </Modal>
  );
}
