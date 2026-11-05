import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { exportBackup, exportBodyCsv, exportWorkoutCsv, restoreBackup } from '../db/backup.ts';
import { getRestDefault, getWeightStep, setSetting } from '../db/repo.ts';
import { pickTextFile, shareTextFile, stamp } from '../services/files.ts';
import { GRAPH_KEYS, GRAPH_LABEL, GRAPH_PRESETS } from '../domain/themeModel.ts';
import { Btn, Card, H, Row, Segmented, T } from '../ui/components.tsx';
import { C, GC, S } from '../ui/theme.ts';

const STEPS = [1, 2.5, 5];
const RESTS = [0, 60, 90, 120, 180];
const restLabel = (v: number) => (v === 0 ? '끄기' : v % 60 === 0 ? `${v / 60}분` : `${v}초`);

export function SettingsScreen() {
  const { db, version, nav, bump, theme } = useApp();
  const [step, setStep] = useState(2.5);
  const [rest, setRest] = useState(90);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getWeightStep(db).then(setStep);
    getRestDefault(db).then(setRest);
  }, [db, version]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('오류', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }}>
      <H style={{ fontSize: 22, marginBottom: S.lg }}>설정</H>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>세트 입력</H>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>중량 칸 아래 ± 버튼이 한 번에 바꾸는 kg</T>
        <Segmented
          options={STEPS.map((v) => ({ key: String(v), label: `${v}kg` }))}
          value={String(step)}
          onChange={(k) => { setStep(Number(k)); setSetting(db, 'weight_step', k); }}
        />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>
          세트 사이 휴식 타이머 — 세트를 ✓하면 카운트다운이 돌고, 끝나면 진동해요. 루틴에서 종목별로 정한 휴식(초)이 있으면 그 값을 먼저 씁니다.
        </T>
        <Segmented
          options={RESTS.map((v) => ({ key: String(v), label: restLabel(v) }))}
          value={String(rest)}
          onChange={(k) => { setRest(Number(k)); setSetting(db, 'rest_default_sec', k); }}
        />
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>백업 · 내보내기</H>
        <T muted style={{ fontSize: 12, marginBottom: S.md }}>
          모든 기록은 이 기기의 앱 저장소(SQLite)에 저장되며, 브라우저 기록·쿠키·사이트 데이터 삭제와 무관합니다. 앱을 삭제하면 데이터도 지워지므로 JSON 백업을 주기적으로 보관하세요.
        </T>
        <Btn
          label="JSON 전체 백업 (공유로 저장)" disabled={busy}
          onPress={() => guard(async () => { await shareTextFile(`overdrive-backup-${stamp()}.json`, JSON.stringify(await exportBackup(db)), 'application/json'); })}
          style={{ marginBottom: S.sm }}
        />
        <Btn
          label="JSON 백업에서 복원" kind="ghost" disabled={busy}
          style={{ marginBottom: S.sm }}
          onPress={() => guard(async () => {
            const text = await pickTextFile();
            if (text == null) return;
            let data: unknown;
            try { data = JSON.parse(text); } catch { throw new Error('JSON 파일을 읽을 수 없습니다'); }
            Alert.alert('복원', '현재 앱의 모든 기록이 백업 내용으로 교체됩니다. 계속할까요?', [
              { text: '취소' },
              {
                text: '복원', style: 'destructive',
                onPress: () => guard(async () => {
                  const r = await restoreBackup(db, data);
                  bump();
                  Alert.alert('복원 완료', `${r.rows}개 행을 복원했습니다.`);
                }),
              },
            ]);
          })}
        />
        <Row>
          <Btn label="운동 CSV" kind="ghost" style={{ flex: 1 }} disabled={busy}
            onPress={() => guard(async () => { await shareTextFile(`overdrive-workouts-${stamp()}.csv`, await exportWorkoutCsv(db), 'text/csv'); })} />
          <Btn label="신체 CSV" kind="ghost" style={{ flex: 1 }} disabled={busy}
            onPress={() => guard(async () => { await shareTextFile(`overdrive-body-${stamp()}.csv`, await exportBodyCsv(db), 'text/csv'); })} />
        </Row>
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>화면</H>
        <Segmented
          options={[{ key: 'light', label: '라이트' }, { key: 'dark', label: '다크' }]}
          value={theme.mode}
          onChange={theme.setMode}
        />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>그래프 색상 (화면은 흑백, 그래프에만 색이 쓰입니다)</T>
        {GRAPH_KEYS.map((k) => (
          <View key={k} style={{ paddingVertical: 6 }}>
            <T style={{ marginBottom: 6 }}>{GRAPH_LABEL[k]}</T>
            <Row style={{ flexWrap: 'wrap', gap: 10 }}>
              {GRAPH_PRESETS.map((p) => {
                const on = GC[k].toUpperCase() === p.hex;
                return (
                  <Pressable
                    key={p.hex}
                    onPress={() => theme.setGraphColor(k, p.hex)}
                    accessibilityLabel={`${GRAPH_LABEL[k]} ${p.name}`}
                    style={{
                      width: 30, height: 30, borderRadius: 15, backgroundColor: p.hex,
                      borderWidth: on ? 3 : 0, borderColor: C.text,
                    }}
                  />
                );
              })}
            </Row>
          </View>
        ))}
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>관리</H>
        <Row style={{ flexWrap: 'wrap' }}>
          <Btn label="루틴" kind="ghost" onPress={() => nav.goTab('routine')} />
          <Btn label="종목 관리" kind="ghost" onPress={nav.openExercises} />
          <Btn label="AI 루틴 가져오기" kind="ghost" onPress={nav.openImport} />
          <Btn label="처음 설정 다시 하기" kind="ghost" onPress={nav.openSetup} />
        </Row>
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>정보</H>
        <T muted style={{ fontSize: 12, lineHeight: 18 }}>
          OVERDRIVE는 완전한 오프라인 앱입니다. 서버 전송·AI API 호출·크레딧 소모가 없습니다.
        </T>
      </Card>
    </ScrollView>
  );
}
