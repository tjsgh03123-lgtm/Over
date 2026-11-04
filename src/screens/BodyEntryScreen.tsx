import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../app/context.tsx';
import { listMeasurements, upsertMeasurement } from '../db/repo.ts';
import { parseInBodyText } from '../domain/inbody.ts';
import { recognizeText } from '../services/ocr.ts';
import { Btn, Card, Field, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

export function BodyEntryScreen() {
  const { db, today, nav, bump } = useApp();
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState<number | null>(null);
  const [muscle, setMuscle] = useState<number | null>(null);
  const [fatMass, setFatMass] = useState<number | null>(null);
  const [fatPct, setFatPct] = useState<number | null>(null);
  const [source, setSource] = useState<'manual' | 'ocr'>('manual');
  const [busy, setBusy] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  // NumInput은 값 변경(외부 갱신)을 반영하므로 OCR 결과를 그대로 state에 넣으면 입력칸에 표시됨

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const loadExisting = async (d: string) => {
    const row = (await listMeasurements(db)).find((r) => r.date === d);
    setWeight(row?.weight ?? null); setMuscle(row?.skeletal_muscle ?? null);
    setFatMass(row?.body_fat_mass ?? null); setFatPct(row?.body_fat_pct ?? null);
  };

  const fromImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('사진 접근 권한이 필요합니다', '권한 없이도 수동으로 입력할 수 있습니다.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets?.length) return;
    setBusy(true);
    setOcrNote(null);
    try {
      const text = await recognizeText(res.assets[0].uri);
      const v = parseInBodyText(text);
      const found = Object.values(v).filter((x) => x != null).length;
      if (v.weight != null) setWeight(v.weight);
      if (v.skeletal_muscle != null) setMuscle(v.skeletal_muscle);
      if (v.body_fat_mass != null) setFatMass(v.body_fat_mass);
      if (v.body_fat_pct != null) setFatPct(v.body_fat_pct);
      if (found > 0) setSource('ocr');
      setOcrNote(
        found === 0
          ? '값을 인식하지 못했습니다. 아래에 직접 입력해 주세요.'
          : `${found}개 항목을 인식했습니다. 저장 전에 반드시 값을 확인·수정하세요. (인식 못한 항목은 비워 두면 NULL로 저장)`,
      );
    } catch (e) {
      setOcrNote(
        (e as Error).message === 'OCR_UNAVAILABLE'
          ? '이 빌드에서는 온디바이스 OCR을 사용할 수 없습니다(Expo Go 등). 수동으로 입력해 주세요.'
          : '이미지를 읽지 못했습니다. 수동으로 입력해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!validDate) return Alert.alert('날짜 형식', 'YYYY-MM-DD 형식으로 입력하세요.');
    if (weight == null && muscle == null && fatMass == null && fatPct == null) return Alert.alert('입력 없음', '최소 한 항목은 입력하세요.');
    await upsertMeasurement(db, date, { weight, skeletal_muscle: muscle, body_fat_mass: fatMass, body_fat_pct: fatPct, source });
    bump();
    nav.close();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="인바디 · 신체 기록" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg }} keyboardShouldPersistTaps="handled">
        <Btn label={busy ? '인식 중…' : '인바디 캡처 이미지에서 불러오기 (OCR)'} kind="ghost" disabled={busy} onPress={fromImage} style={{ marginBottom: S.sm }} />
        {ocrNote && <T muted style={{ marginBottom: S.md, fontSize: 12 }}>{ocrNote}</T>}

        <Card>
          <Field label="날짜 (YYYY-MM-DD)">
            <Row>
              <TextField
                value={date} onChangeText={setDate} style={{ flex: 1 }} maxLength={10} keyboardType="numbers-and-punctuation"
                onEndEditing={() => validDate && loadExisting(date)}
              />
              <Btn label="오늘" kind="ghost" small onPress={() => { setDate(today); loadExisting(today); }} />
            </Row>
          </Field>
          <Row style={{ flexWrap: 'wrap', gap: S.lg }}>
            <Field label="몸무게 (kg)"><NumInput value={weight} onCommit={setWeight} width={110} /></Field>
            <Field label="골격근량 (kg)"><NumInput value={muscle} onCommit={setMuscle} width={110} /></Field>
            <Field label="체지방량 (kg)"><NumInput value={fatMass} onCommit={setFatMass} width={110} /></Field>
            <Field label="체지방률 (%)"><NumInput value={fatPct} onCommit={setFatPct} width={110} /></Field>
          </Row>
          <T muted style={{ fontSize: 12 }}>측정하지 않은 항목은 비워 두세요. 비워 둔 항목은 NULL로 저장되며 그래프에 임의 값이 만들어지지 않습니다.</T>
        </Card>
        <Btn label="저장" onPress={save} />
      </ScrollView>
    </View>
  );
}
