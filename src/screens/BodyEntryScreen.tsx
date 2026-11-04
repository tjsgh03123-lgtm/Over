import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addBodyMetric, getBodyExtra, getBodyMetrics, listMeasurements, removeBodyMetric, setBodyExtra, setBodyMetricHidden,
  upsertMeasurement, type Measurement,
} from '../db/repo.ts';
import { visibleMetrics, type BodyMetric, type BuiltinKey } from '../domain/bodyMetrics.ts';
import { Btn, Card, Field, H, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

type Values = Record<string, number | null>;

/** 신체 기록: 기본 항목(인바디) + 직접 만든 항목을 숫자로 입력한다. 사진 인식은 없다. */
export function BodyEntryScreen() {
  const { db, today, version, nav, bump } = useApp();
  const [date, setDate] = useState(today);
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [vals, setVals] = useState<Values>({});
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');

  const loaded = useRef(false); // 값은 처음 한 번만 불러온다 (항목을 추가·숨겨도 입력 중인 숫자가 지워지지 않게)

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  /** 그 날짜에 저장된 값을 입력칸에 채운다 */
  const load = useCallback(async (d: string, list: BodyMetric[]) => {
    const row: Measurement | undefined = (await listMeasurements(db)).find((r) => r.date === d);
    const extra = await getBodyExtra(db);
    const v: Values = {};
    for (const m of list) v[m.key] = m.builtin ? (row?.[m.key as BuiltinKey] ?? null) : (extra[m.key]?.[d] ?? null);
    setVals(v);
  }, [db]);

  useEffect(() => {
    (async () => {
      const list = await getBodyMetrics(db);
      setMetrics(list);
      if (!loaded.current) { loaded.current = true; await load(date, list); }
    })();
    // 날짜를 직접 고칠 때는 onEndEditing에서 다시 불러온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);

  const shown = visibleMetrics(metrics);
  const hidden = metrics.filter((m) => m.hidden);

  const save = async () => {
    if (!validDate) return Alert.alert('날짜 형식', 'YYYY-MM-DD 형식으로 입력하세요.');
    if (!shown.some((m) => vals[m.key] != null)) return Alert.alert('입력 없음', '최소 한 항목은 입력하세요.');
    const patch: Partial<Record<BuiltinKey, number | null>> = {};
    for (const m of shown) if (m.builtin) patch[m.key as BuiltinKey] = vals[m.key] ?? null;
    await upsertMeasurement(db, date, { ...patch, source: 'manual' }); // 숨긴 기본 항목은 patch에 없으므로 기존 값 유지
    for (const m of shown) if (!m.builtin) await setBodyExtra(db, m.key, date, vals[m.key] ?? null);
    bump();
    nav.close();
  };

  const add = async () => {
    try {
      await addBodyMetric(db, { label: newName, unit: newUnit });
      setNewName(''); setNewUnit('');
      bump();
    } catch (e) {
      Alert.alert('항목 추가', (e as Error).message);
    }
  };

  const remove = (m: BodyMetric) => {
    if (m.builtin) {
      Alert.alert(`‘${m.label}’ 숨기기`, '입력칸과 그래프에서만 빠지고, 이미 저장한 기록은 남습니다. 언제든 다시 보이게 할 수 있어요.', [
        { text: '취소' }, { text: '숨기기', onPress: async () => { await setBodyMetricHidden(db, m.key, true); bump(); } },
      ]);
    } else {
      Alert.alert(`‘${m.label}’ 삭제`, '이 항목과 지금까지 입력한 값이 모두 삭제됩니다. 되돌릴 수 없어요.', [
        { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await removeBodyMetric(db, m.key); bump(); } },
      ]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="인바디 · 신체 기록" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Field label="날짜 (YYYY-MM-DD)">
            <Row>
              <TextField
                value={date} onChangeText={setDate} style={{ flex: 1 }} maxLength={10} keyboardType="numbers-and-punctuation"
                onEndEditing={() => validDate && load(date, metrics)}
              />
              <Btn label="오늘" kind="ghost" small onPress={() => { setDate(today); load(today, metrics); }} />
            </Row>
          </Field>
          {shown.length === 0 ? (
            <T muted>보이는 항목이 없어요. 아래에서 항목을 추가하거나 다시 보이게 하세요.</T>
          ) : (
            <Row style={{ flexWrap: 'wrap', gap: S.lg }}>
              {shown.map((m) => (
                <Field key={m.key} label={`${m.label}${m.unit ? ` (${m.unit})` : ''}`}>
                  <NumInput value={vals[m.key] ?? null} onCommit={(v) => setVals((cur) => ({ ...cur, [m.key]: v }))} width={110} />
                </Field>
              ))}
            </Row>
          )}
          <T muted style={{ fontSize: 12 }}>측정하지 않은 항목은 비워 두세요. 비워 둔 항목은 그래프에 임의 값이 만들어지지 않습니다.</T>
        </Card>
        <Btn label="저장" onPress={save} />

        <H style={{ fontSize: 16, marginTop: S.xl, marginBottom: S.sm }}>항목 관리</H>
        <Card>
          <T muted style={{ fontSize: 12, marginBottom: S.sm }}>
            허리둘레, 혈압처럼 필요한 항목을 이름과 단위로 직접 만들 수 있어요. 숫자만 입력하고, 그래프에서도 똑같이 볼 수 있습니다.
          </T>
          {shown.map((m) => (
            <Row key={m.key} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
              <T style={{ flex: 1 }}>{m.label}{m.unit ? ` · ${m.unit}` : ''}{m.builtin ? '' : '  (직접 추가)'}</T>
              <Btn label={m.builtin ? '숨기기' : '삭제'} kind={m.builtin ? 'ghost' : 'danger'} small onPress={() => remove(m)} />
            </Row>
          ))}
          {hidden.length > 0 && (
            <View style={{ marginTop: S.sm }}>
              <T muted style={{ fontSize: 12, marginBottom: 4 }}>숨긴 항목</T>
              {hidden.map((m) => (
                <Row key={m.key} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
                  <T muted style={{ flex: 1 }}>{m.label}{m.unit ? ` · ${m.unit}` : ''}</T>
                  <Btn label="다시 보이기" kind="ghost" small onPress={async () => { await setBodyMetricHidden(db, m.key, false); bump(); }} />
                  {!m.builtin && <Btn label="삭제" kind="danger" small onPress={() => remove(m)} />}
                </Row>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <H style={{ fontSize: 15, marginBottom: S.sm }}>+ 항목 추가</H>
          <Row>
            <TextField value={newName} onChangeText={setNewName} placeholder="이름 (예: 허리둘레)" maxLength={20} style={{ flex: 2 }} />
            <TextField value={newUnit} onChangeText={setNewUnit} placeholder="단위 (cm)" maxLength={8} style={{ flex: 1 }} />
          </Row>
          <Btn label="추가" kind="ghost" onPress={add} style={{ marginTop: S.sm }} />
        </Card>
      </ScrollView>
    </View>
  );
}
