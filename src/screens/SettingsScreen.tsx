import { fmtSpeed, nearestSpeed, SPEEDS, speedOf, tempoOf } from '../domain/voiceSpeed.ts';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { exportBackup, exportBodyCsv, exportWorkoutCsv, restoreBackup } from '../db/backup.ts';
import { getExerciseRest, getRestDefault, getSetting, getWeightStep, setSetting } from '../db/repo.ts';
import { pickTextFile, shareTextFile, stamp } from '../services/files.ts';
import { GRAPH_KEYS, GRAPH_LABEL, GRAPH_PRESETS } from '../domain/themeModel.ts';
import { Btn, Card, H, Row, Segmented, T } from '../ui/components.tsx';
import { C, GC, S } from '../ui/theme.ts';

const STEPS = [1, 2.5, 5];
const RESTS = [0, 60, 90, 120, 180];
const EX_RESTS = [90, 120, 180, 240, 300];
const GOALS = [8, 12, 16, 20];
const PREPS = [0, 5, 10, 15, 20, 30];
const EX_PREPS = [5, 10, 20, 30, 45, 60];
const IDLES = [3, 5, 7, 10];
const BARS = [15, 20];
const restLabel = (v: number) => (v === 0 ? '끄기' : v % 60 === 0 ? `${v / 60}분` : `${v}초`);

export function SettingsScreen() {
  const { db, version, nav, bump, theme } = useApp();
  const [step, setStep] = useState(2.5);
  const [rest, setRest] = useState(90);
  const [busy, setBusy] = useState(false);
  const [exRest, setExRest] = useState(180);
  const [goal, setGoal] = useState(12);
  const [bar, setBar] = useState(20);
  const [prep, setPrep] = useState(10);
  const [exPrep, setExPrep] = useState(20);
  const [tempo, setTempo] = useState(3);
  const [idle, setIdle] = useState(5);

  useEffect(() => {
    getWeightStep(db).then(setStep);
    getRestDefault(db).then(setRest);
    getExerciseRest(db).then(setExRest);
    getSetting(db, 'month_goal').then((v) => setGoal(Number(v) > 0 ? Number(v) : 12));
    const num = (k: string, d: number, set: (n: number) => void) => getSetting(db, k).then((v) => { const n = v == null ? NaN : Number(v); set(Number.isFinite(n) && n >= 0 ? n : d); });
    num('prep_sec', 10, setPrep); num('ex_prep_sec', 20, setExPrep); num('tempo_sec', 3, setTempo); num('idle_end_sec', 5, setIdle);
    getSetting(db, 'bar_kg').then((v) => setBar(Number(v) > 0 ? Number(v) : 20));
  }, [db, version]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('오류', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }}>
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
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>
          종목 간 휴식 — 루틴을 한 종목씩 진행할 때 종목이 끝나면 쉬는 시간 (운동 중 ±30초로도 바꿀 수 있어요)
        </T>
        <Segmented
          options={EX_RESTS.map((v) => ({ key: String(v), label: restLabel(v) }))}
          value={String(exRest)}
          onChange={(k) => { setExRest(Number(k)); setSetting(db, 'exercise_rest_sec', k); }}
        />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>바벨 기본 무게 (바+원판 계산에 사용)</T>
        <Segmented
          options={BARS.map((v) => ({ key: String(v), label: `${v}kg` }))}
          value={String(bar)}
          onChange={(k) => { setBar(Number(k)); setSetting(db, 'bar_kg', k); }}
        />
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>보이스코칭 · 카메라 시간</H>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>세트 준비 — 세트를 시작하기 전 카운트다운 (코칭·카메라 화면에서도 바꿀 수 있어요)</T>
        <Segmented options={PREPS.map((v) => ({ key: String(v), label: v === 0 ? '없음' : `${v}초` }))} value={String(prep)} onChange={(k) => { setPrep(Number(k)); setSetting(db, 'prep_sec', k); }} />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>종목 준비 — 다음 종목으로 넘어갈 때 준비 시간 (‘준비 끝’을 누르면 5초 뒤 시작)</T>
        <Segmented options={EX_PREPS.map((v) => ({ key: String(v), label: `${v}초` }))} value={String(exPrep)} onChange={(k) => { setExPrep(Number(k)); setSetting(db, 'ex_prep_sec', k); }} />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>음성 속도 — 보이스코칭이 숫자를 읽는 빠르기 (1x = 한 회 3초 간격)</T>
        <Segmented options={SPEEDS.map((v) => ({ key: String(v), label: fmtSpeed(v) }))} value={String(nearestSpeed(speedOf(tempo)))} onChange={(k) => { const t = tempoOf(Number(k)); setTempo(t); setSetting(db, 'tempo_sec', String(t)); }} />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>카메라 — 동작이 이만큼 멈추면 세트 끝 (센 횟수 그대로 기록)</T>
        <Segmented options={IDLES.map((v) => ({ key: String(v), label: `${v}초` }))} value={String(idle)} onChange={(k) => { setIdle(Number(k)); setSetting(db, 'idle_end_sec', k); }} />
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>목표</H>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>한 달에 운동할 날 수 (프로필에 표시)</T>
        <Segmented
          options={GOALS.map((v) => ({ key: String(v), label: `${v}일` }))}
          value={String(goal)}
          onChange={(k) => { setGoal(Number(k)); setSetting(db, 'month_goal', k); }}
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
