import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addBodyMetric, getBodyMetrics, removeBodyMetric, setBodyExtra, setSetting, updateBodyMetric, upsertMeasurement,
} from '../db/repo.ts';
import { visibleMetrics, type BodyMetric, type BuiltinKey } from '../domain/bodyMetrics.ts';
import { GRAPH_PRESETS, type GraphKey } from '../domain/themeModel.ts';
import { Btn, Card, Field, H, NumInput, Row, Segmented, T, TextField } from '../ui/components.tsx';
import { C, GC, S } from '../ui/theme.ts';

const STEPS = 3;

function Swatches({ value, onPick, label }: { value: string; onPick: (hex: string) => void; label: string }) {
  return (
    <Row style={{ flexWrap: 'wrap', gap: 10 }}>
      {GRAPH_PRESETS.map((p) => (
        <Pressable
          key={p.hex} onPress={() => onPick(p.hex)} accessibilityLabel={`${label} ${p.name}`}
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: p.hex, borderWidth: value.toUpperCase() === p.hex ? 3 : 0, borderColor: C.text }}
        />
      ))}
    </Row>
  );
}

/**
 * 처음 설치했을 때 한 번만 나오는 시작 설정.
 * 시작 화면 예시(+화면 모드) → 1) 그래프 2) 신체 정보 3) 루틴 시작 방법. 모든 단계는 건너뛸 수 있다.
 */
export function SetupScreen() {
  const { db, today, nav, bump, theme } = useApp();
  const [page, setPage] = useState(0); // 0 = 시작 화면 예시, 1..3 = 단계
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');

  const reload = async () => setMetrics(await getBodyMetrics(db));
  useEffect(() => { reload(); }, [db]);
  // 어떻게 나가든(완료·건너뛰기·뒤로가기) 다음 실행부터는 다시 나오지 않는다
  useEffect(() => () => { setSetting(db, 'setup_pending', '0'); }, [db]);

  const shown = visibleMetrics(metrics);
  const colorOf = (m: BodyMetric) => (m.builtin ? GC[m.key as GraphKey] : m.color ?? GC.all);

  const pick = async (m: BodyMetric, hex: string) => {
    if (m.builtin) theme.setGraphColor(m.key as GraphKey, hex);
    else { await updateBodyMetric(db, m.key, { color: hex }); await reload(); }
  };

  const add = async () => {
    try {
      await addBodyMetric(db, { label: newName, unit: newUnit });
      setNewName(''); setNewUnit('');
      await reload();
    } catch (e) {
      Alert.alert('항목 추가', (e as Error).message);
    }
  };

  const saveBody = async () => {
    if (!shown.some((m) => vals[m.key] != null)) return;
    const patch: Partial<Record<BuiltinKey, number | null>> = {};
    for (const m of shown) if (m.builtin) patch[m.key as BuiltinKey] = vals[m.key] ?? null;
    await upsertMeasurement(db, today, { ...patch, source: 'manual' });
    for (const m of shown) if (!m.builtin) await setBodyExtra(db, m.key, today, vals[m.key] ?? null);
  };

  const finish = async (to: 'home' | 'routine' | 'import') => {
    await setSetting(db, 'setup_pending', '0');
    bump();
    nav.goTab(to === 'routine' ? 'routine' : 'home');
    if (to === 'import') nav.openImport();
  };

  const footer = (next: () => void, nextLabel = '다음') => (
    <View style={{ padding: S.lg, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg }}>
      <Btn label={nextLabel} onPress={next} />
      <Row style={{ marginTop: S.sm }}>
        {page > 0 && <Btn label="이전" kind="ghost" small onPress={() => setPage(page - 1)} />}
        <View style={{ flex: 1 }} />
        <Btn label="건너뛰기" kind="ghost" small onPress={() => (page === 0 || page >= STEPS ? finish('home') : setPage(page + 1))} />
      </Row>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {page === 0 && (
          <>
            <H style={{ fontSize: 24, marginBottom: 4 }}>OVERDRIVE</H>
            <T muted style={{ marginBottom: S.lg }}>처음이시네요. 먼저 화면 모양을 골라 보세요. 아래가 시작 화면 예시입니다.</T>
            <Segmented
              options={[{ key: 'dark', label: '다크' }, { key: 'light', label: '라이트' }]}
              value={theme.mode}
              onChange={theme.setMode}
            />
            <View style={{ marginTop: S.lg, padding: S.md, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg }}>
              <H style={{ fontSize: 20, marginBottom: 2 }}>OVERDRIVE</H>
              <T muted style={{ marginBottom: S.md }}>{today}</T>
              <Card>
                <T muted style={{ marginBottom: 6 }}>오늘의 운동</T>
                <H>상체 A</H>
                <T muted style={{ marginTop: 4, marginBottom: S.md }}>5종목 · 벤치프레스, 랫풀다운 …</T>
                <Btn label="운동 시작" onPress={() => {}} style={{ marginBottom: S.sm }} />
                <Btn label="자유 운동" kind="ghost" onPress={() => {}} />
              </Card>
            </View>
            <T muted style={{ fontSize: 12, marginTop: S.md }}>설정 탭에서 언제든 바꿀 수 있어요. 화면은 흑백·회색이고, 색은 그래프에만 쓰입니다.</T>
          </>
        )}

        {page === 1 && (
          <>
            <T muted style={{ marginBottom: 4 }}>1 / {STEPS}</T>
            <H style={{ fontSize: 22, marginBottom: S.sm }}>그래프</H>
            <T style={{ lineHeight: 21, marginBottom: S.md }}>
              몸무게, 골격근량, 체지방량, 체지방률을 각각 그래프로 확인할 수 있어요. 그래프마다 색을 고르세요.
            </T>
            <T muted style={{ lineHeight: 20, marginBottom: S.lg }}>
              허리둘레 같은 항목은 이름과 단위를 정해서 직접 추가해 같은 방식으로 볼 수 있고, 쓰지 않는 기본 항목은 지울 수 있어요.
            </T>

            <Card>
              <T bold style={{ marginBottom: 6 }}>운동 중량</T>
              <Swatches value={GC.all} onPick={(hex) => theme.setGraphColor('all', hex)} label="운동 중량" />
            </Card>
            {shown.map((m) => (
              <Card key={m.key}>
                <Row style={{ marginBottom: 6 }}>
                  <T bold style={{ flex: 1 }}>{m.label}{m.unit ? ` (${m.unit})` : ''}</T>
                  <Btn label="지우기" kind="ghost" small onPress={async () => { await removeBodyMetric(db, m.key); await reload(); }} />
                </Row>
                <Swatches value={colorOf(m)} onPick={(hex) => pick(m, hex)} label={m.label} />
              </Card>
            ))}

            <Card>
              <H style={{ fontSize: 15, marginBottom: S.sm }}>+ 항목 추가</H>
              <Row>
                <TextField value={newName} onChangeText={setNewName} placeholder="이름 (예: 허리둘레)" maxLength={20} style={{ flex: 2 }} />
                <TextField value={newUnit} onChangeText={setNewUnit} placeholder="단위 (cm)" maxLength={8} style={{ flex: 1 }} />
              </Row>
              <Btn label="추가" kind="ghost" onPress={add} style={{ marginTop: S.sm }} />
            </Card>
            <T muted style={{ fontSize: 12 }}>나중에 성장 분석의 ‘신체 변화’와 기록 추가 화면에서도 바꿀 수 있어요. 지운 기본 항목은 다시 보이게 할 수 있습니다.</T>
          </>
        )}

        {page === 2 && (
          <>
            <T muted style={{ marginBottom: 4 }}>2 / {STEPS}</T>
            <H style={{ fontSize: 22, marginBottom: S.sm }}>신체 정보</H>
            <T muted style={{ lineHeight: 20, marginBottom: S.lg }}>
              지금 상태를 첫 기록으로 남기면 앞으로의 변화를 볼 수 있어요. 숫자만 입력하고, 모르는 항목은 비워 두세요.
            </T>
            <Card>
              {shown.length === 0 ? <T muted>보이는 항목이 없어요. 이전 단계에서 항목을 추가하세요.</T> : (
                <Row style={{ flexWrap: 'wrap', gap: S.lg }}>
                  {shown.map((m) => (
                    <Field key={m.key} label={`${m.label}${m.unit ? ` (${m.unit})` : ''}`}>
                      <NumInput value={vals[m.key] ?? null} onCommit={(v) => setVals((cur) => ({ ...cur, [m.key]: v }))} width={110} />
                    </Field>
                  ))}
                </Row>
              )}
            </Card>
          </>
        )}

        {page === 3 && (
          <>
            <T muted style={{ marginBottom: 4 }}>3 / {STEPS}</T>
            <H style={{ fontSize: 22, marginBottom: S.sm }}>루틴 시작 방법</H>
            <T muted style={{ lineHeight: 20, marginBottom: S.lg }}>
              루틴은 요일이나 N일 주기로 반복되는 한 사이클 전체예요. 어떻게 시작할까요?
            </T>
            <Btn label="루틴 직접 만들기" onPress={() => finish('routine')} style={{ marginBottom: S.sm }} />
            <T muted style={{ fontSize: 12, marginBottom: S.lg }}>루틴 탭에서 새 루틴을 만들고 날마다 운동을 넣습니다.</T>
            <Btn label="AI로 가져오기" kind="ghost" onPress={() => finish('import')} style={{ marginBottom: S.sm }} />
            <T muted style={{ fontSize: 12, marginBottom: S.lg }}>프롬프트를 복사해 다른 AI에서 루틴을 만들고, 결과를 붙여 넣어 가져옵니다.</T>
            <Btn label="나중에 하기" kind="ghost" onPress={() => finish('home')} />
            <T muted style={{ fontSize: 12, marginTop: S.sm }}>자유 운동으로 바로 시작할 수 있어요.</T>
          </>
        )}
      </ScrollView>

      {page === 0 && footer(() => setPage(1), '시작하기')}
      {page === 1 && footer(() => setPage(2))}
      {page === 2 && footer(async () => { await saveBody(); bump(); setPage(3); })}
      {page === 3 && (
        <View style={{ padding: S.lg, borderTopWidth: 1, borderTopColor: C.line }}>
          <Btn label="이전" kind="ghost" small onPress={() => setPage(2)} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
    </View>
  );
}
