import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addBodyMetric, getBodyMetrics, getSetting, removeBodyMetric, setBodyExtra, setSetting, updateBodyMetric, upsertMeasurement,
} from '../db/repo.ts';
import { pickCheer } from '../domain/cheer.ts';
import { fmtSpeed, nearestSpeed, SPEEDS, speedOf, tempoOf } from '../domain/voiceSpeed.ts';
import { setSpeechTempo, speakCount, speakText, stopSpeaking } from '../services/speak.ts';
import { Icon } from '../ui/icons.tsx';
import { visibleMetrics, type BodyMetric, type BuiltinKey } from '../domain/bodyMetrics.ts';
import { GRAPH_PRESETS, type GraphKey } from '../domain/themeModel.ts';
import { Btn, Card, Field, H, NumInput, Row, Segmented, T, TextField } from '../ui/components.tsx';
import { C, GC, S } from '../ui/theme.ts';

const STEPS = 6;
const PREPS = [0, 5, 10, 15, 20, 30];
const EX_PREPS = [5, 10, 20, 30, 45, 60];
const RESTS = [0, 60, 90, 120, 180];
const EX_RESTS = [90, 120, 180, 240, 300];
const WSTEPS = [1, 2.5, 5];
const BARS = [15, 20];
const IDLES = [3, 5, 7, 10];
const restLabel = (v: number) => (v === 0 ? '끄기' : v % 60 === 0 ? `${v / 60}분` : `${v}초`);

/** 눌러서 소리 예시를 듣는 줄 */
function Sample({ title, text, onPlay }: { title: string; text: string; onPlay: () => void }) {
  return (
    <Pressable onPress={onPlay} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="volume" size={18} color={C.text} />
      </View>
      <View style={{ flex: 1 }}>
        <T muted style={{ fontSize: 11 }}>{title}</T>
        <T style={{ fontSize: 14, lineHeight: 20 }}>{text}</T>
      </View>
    </Pressable>
  );
}

function Q({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: S.lg }}>
      <T bold style={{ marginBottom: 2 }}>{title}</T>
      {hint ? <T muted style={{ fontSize: 12, marginBottom: S.sm, lineHeight: 18 }}>{hint}</T> : <View style={{ height: S.sm }} />}
      {children}
    </View>
  );
}

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
  const [voiceOn, setVoiceOn] = useState(true);
  const [cheerOn, setCheerOn] = useState(true);
  const [tempo, setTempo] = useState(3);
  const [prep, setPrep] = useState(10);
  const [exPrep, setExPrep] = useState(20);
  const [rest, setRest] = useState(90);
  const [exRest, setExRest] = useState(180);
  const [wstep, setWstep] = useState(2.5);
  const [bar, setBar] = useState(20);
  const [runMode, setRunMode] = useState<'manual' | 'camera'>('manual');
  const [idle, setIdle] = useState(5);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopSamples = () => { timers.current.forEach(clearTimeout); timers.current = []; stopSpeaking(); };
  useEffect(() => stopSamples, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const num = async (k: string, d: number, set: (n: number) => void, min = 0) => { const v = await getSetting(db, k); const n = v == null ? NaN : Number(v); set(Number.isFinite(n) && n >= min ? n : d); };
    (async () => {
      const vc = await getSetting(db, 'voice_coach'); setVoiceOn(vc == null ? true : vc === '1');
      setCheerOn((await getSetting(db, 'cheer_on')) !== '0');
      setRunMode((await getSetting(db, 'run_mode')) === 'camera' ? 'camera' : 'manual');
      await num('tempo_sec', 3, setTempo, 1); await num('prep_sec', 10, setPrep); await num('ex_prep_sec', 20, setExPrep);
      await num('rest_default_sec', 90, setRest); await num('exercise_rest_sec', 180, setExRest);
      await num('weight_step', 2.5, setWstep, 0.5); await num('bar_kg', 20, setBar, 1); await num('idle_end_sec', 5, setIdle, 2);
    })();
  }, [db]);
  const save = (k: string, v: string | number) => setSetting(db, k, String(v));
  /** 지금 고른 속도로 숫자를 읽어 보여 준다 */
  const playCount = () => {
    stopSamples(); setSpeechTempo(tempo);
    for (let n = 1; n <= 5; n++) timers.current.push(setTimeout(() => speakCount(n), (n - 1) * tempo * 1000));
  };
  const say = (t: string) => { stopSamples(); setSpeechTempo(tempo); speakText(t); };

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
            <H style={{ fontSize: 22, marginBottom: S.sm }}>음성 코칭</H>
            <T muted style={{ lineHeight: 20, marginBottom: S.lg }}>운동 중에 앱이 소리로 박자를 세고 진행 상황을 알려 줘요. 아래 줄을 눌러 소리를 먼저 들어 보세요.</T>
            <Q title="음성 가이드" hint="끄면 소리 없이 화면으로만 진행해요. 운동 중에도 켜고 끌 수 있어요.">
              <Segmented options={[{ key: '1', label: '켬' }, { key: '0', label: '끔' }]} value={voiceOn ? '1' : '0'} onChange={(k) => { setVoiceOn(k === '1'); save('voice_coach', k); if (k === '0') stopSamples(); }} />
            </Q>
            <Q title="말하는 속도" hint="1x는 한 회에 3초 간격이에요. 종목마다 운동 중에 따로 바꿀 수 있어요.">
              <Segmented options={SPEEDS.map((v) => ({ key: String(v), label: fmtSpeed(v) }))} value={String(nearestSpeed(speedOf(tempo)))} onChange={(k) => { const t = tempoOf(Number(k)); setTempo(t); save('tempo_sec', t); setSpeechTempo(t); }} />
            </Q>
            <Q title="응원 멘트" hint="종목을 시작할 때, 종목의 마지막 세트, 운동이 끝났을 때만 한마디 해요.">
              <Segmented options={[{ key: '1', label: '켬' }, { key: '0', label: '끔' }]} value={cheerOn ? '1' : '0'} onChange={(k) => { setCheerOn(k === '1'); save('cheer_on', k); }} />
            </Q>
            <Card>
              <T bold style={{ marginBottom: 2 }}>이렇게 말해요 (눌러서 듣기)</T>
              <Sample title="횟수 세기 · 지금 속도" text="하나, 둘, 셋, 넷, 다섯 …" onPlay={playCount} />
              <Sample title="종목 시작" text={`벤치프레스. 오늘 운동은 3종목이에요.${cheerOn ? ' ' + pickCheer('start') : ''} 3세트 중 1번째예요. 준비하세요`} onPlay={() => say(`벤치프레스. 오늘 운동은 3종목이에요.${cheerOn ? ' ' + pickCheer('start') : ''} 3세트 중 1번째예요. 준비하세요`)} />
              <Sample title="세트가 끝났을 때" text="1세트 완료. 2세트 남았어요." onPlay={() => say('1세트 완료. 2세트 남았어요.')} />
              <Sample title="종목의 마지막 세트" text={`3세트. 마지막 세트예요.${cheerOn ? ' ' + pickCheer('lastSet') : ''} 준비하세요`} onPlay={() => say(`3세트. 마지막 세트예요.${cheerOn ? ' ' + pickCheer('lastSet') : ''} 준비하세요`)} />
              <Sample title="종목이 끝났을 때" text="종목 끝. 오늘 3종목 중 1종목 끝났어요. 2종목 남았어요. 90초 쉬세요." onPlay={() => say('종목 끝. 오늘 3종목 중 1종목 끝났어요. 2종목 남았어요. 90초 쉬세요.')} />
              <Sample title="마지막 운동" text="오늘 3종목 중 2종목 끝났어요. 마지막 운동이에요." onPlay={() => say('오늘 3종목 중 2종목 끝났어요. 마지막 운동이에요.')} />
            </Card>
          </>
        )}

        {page === 2 && (
          <>
            <T muted style={{ marginBottom: 4 }}>2 / {STEPS}</T>
            <H style={{ fontSize: 22, marginBottom: S.sm }}>시간 설정</H>
            <T muted style={{ lineHeight: 20, marginBottom: S.lg }}>준비하고, 운동하고, 쉬는 시간을 정해요. 모두 운동 중에 바꿀 수 있어요.</T>
            <Card>
              <T muted style={{ fontSize: 12, marginBottom: S.sm }}>한 세트의 흐름 예시</T>
              <Row style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {[`준비 ${prep}초`, '운동 (횟수 세기)', `휴식 ${restLabel(rest)}`, '다음 세트'].map((t, i, a) => (
                  <Row key={t} style={{ gap: 6, alignItems: 'center' }}>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: i === 1 ? C.accent : C.card2 }}>
                      <T bold={i === 1} style={{ fontSize: 12, color: i === 1 ? C.onAccent : C.text }}>{t}</T>
                    </View>
                    {i < a.length - 1 && <Icon name="forward" size={14} color={C.muted} />}
                  </Row>
                ))}
              </Row>
              <T muted style={{ fontSize: 12, marginTop: S.sm }}>종목이 끝나면 종목 간 휴식 {restLabel(exRest)} 후 다음 종목을 {exPrep}초 준비해요.</T>
            </Card>
            <Q title="세트 준비 시간" hint="세트를 시작하기 전 카운트다운이에요. 0이면 바로 시작해요.">
              <Segmented options={PREPS.map((v) => ({ key: String(v), label: v === 0 ? '없음' : `${v}초` }))} value={String(prep)} onChange={(k) => { setPrep(Number(k)); save('prep_sec', k); }} />
            </Q>
            <Q title="종목 준비 시간" hint="새 종목으로 넘어갈 때 자세를 잡는 시간이에요.">
              <Segmented options={EX_PREPS.map((v) => ({ key: String(v), label: `${v}초` }))} value={String(exPrep)} onChange={(k) => { setExPrep(Number(k)); save('ex_prep_sec', k); }} />
            </Q>
            <Q title="세트 사이 휴식" hint="세트를 끝내면 카운트다운이 돌고, 끝나면 진동해요. 루틴에서 종목별로 정한 값이 있으면 그걸 먼저 써요.">
              <Segmented options={RESTS.map((v) => ({ key: String(v), label: restLabel(v) }))} value={String(rest)} onChange={(k) => { setRest(Number(k)); save('rest_default_sec', k); }} />
            </Q>
            <Q title="종목 간 휴식" hint="한 종목이 끝나고 다음 종목으로 넘어가기 전 쉬는 시간이에요.">
              <Segmented options={EX_RESTS.map((v) => ({ key: String(v), label: restLabel(v) }))} value={String(exRest)} onChange={(k) => { setExRest(Number(k)); save('exercise_rest_sec', k); }} />
            </Q>
          </>
        )}

        {page === 3 && (
          <>
            <T muted style={{ marginBottom: 4 }}>3 / {STEPS}</T>
            <H style={{ fontSize: 22, marginBottom: S.sm }}>운동 방식과 입력</H>
            <T muted style={{ lineHeight: 20, marginBottom: S.lg }}>횟수를 어떻게 기록할지, 무게는 얼마씩 바꿀지 정해요.</T>
            <Q title="횟수 기록 방식" hint="직접 기록은 보이스코칭이 박자에 맞춰 세어 주고, 카메라는 폰이 동작을 보고 횟수를 세요.">
              <Segmented options={[{ key: 'manual', label: '직접 기록' }, { key: 'camera', label: '카메라로 세기' }]} value={runMode} onChange={(k) => { setRunMode(k as 'manual' | 'camera'); save('run_mode', k); }} />
            </Q>
            {runMode === 'camera' && (
              <Q title="세트 끝 판단" hint={`마지막 횟수 뒤 ${idle}초 동안 동작이 없으면 그 세트를 끝내고 센 횟수를 기록해요.`}>
                <Segmented options={IDLES.map((v) => ({ key: String(v), label: `${v}초` }))} value={String(idle)} onChange={(k) => { setIdle(Number(k)); save('idle_end_sec', k); }} />
              </Q>
            )}
            <Q title="무게 ± 버튼 단위" hint={`중량 칸 아래 버튼을 한 번 누를 때 바뀌는 무게예요. 예: 60kg에서 +를 누르면 ${60 + wstep}kg`}>
              <Segmented options={WSTEPS.map((v) => ({ key: String(v), label: `${v}kg` }))} value={String(wstep)} onChange={(k) => { setWstep(Number(k)); save('weight_step', k); }} />
            </Q>
            <Q title="바벨 기본 무게" hint="바+원판 무게를 계산할 때 바의 무게로 써요.">
              <Segmented options={BARS.map((v) => ({ key: String(v), label: `${v}kg` }))} value={String(bar)} onChange={(k) => { setBar(Number(k)); save('bar_kg', k); }} />
            </Q>
          </>
        )}

        {page === 4 && (
          <>
            <T muted style={{ marginBottom: 4 }}>4 / {STEPS}</T>
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

        {page === 5 && (
          <>
            <T muted style={{ marginBottom: 4 }}>5 / {STEPS}</T>
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

        {page === 6 && (
          <>
            <T muted style={{ marginBottom: 4 }}>6 / {STEPS}</T>
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
      {page >= 1 && page <= 4 && footer(() => setPage(page + 1))}
      {page === 5 && footer(async () => { await saveBody(); bump(); setPage(6); })}
      {page === 6 && (
        <View style={{ padding: S.lg, borderTopWidth: 1, borderTopColor: C.line }}>
          <Btn label="이전" kind="ghost" small onPress={() => setPage(5)} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
    </View>
  );
}
