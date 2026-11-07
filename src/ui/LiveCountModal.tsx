import React, { useEffect, useRef, useState } from 'react';
import { Modal, PermissionsAndroid, Platform, ScrollView, Text, Vibration, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requireNativeView } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Circle, Line } from 'react-native-svg';
import { useApp } from '../app/context.tsx';
import { setSetting } from '../db/repo.ts';
import { AutoRepCounter, countWord, FOCUS_LABEL, type Focus, STRICT_LABEL, type Strictness } from '../domain/liveCount.ts';
import { SetFlow, type FlowConfig, type FlowEvent } from '../domain/setFlow.ts';
import { speakCount, speakText, stopSpeaking } from '../services/speak.ts';
import { Btn, Chip, Header, Row, Segmented, T } from './components.tsx';
import { C, GC, S } from './theme.ts';

interface PoseEvent { nativeEvent: { lm: number[]; w: number; h: number; t: number } }
interface ErrEvent { nativeEvent: { code: string; message: string } }

let NativeCamera: React.ComponentType<{
  style?: object; active: boolean; front: boolean; model: string; onPose: (e: PoseEvent) => void; onError: (e: ErrEvent) => void;
}> | null | undefined;
function cameraView() {
  if (NativeCamera === undefined) {
    try { NativeCamera = Platform.OS === 'android' ? requireNativeView('PoseCamera') : null; } catch { NativeCamera = null; }
  }
  return NativeCamera;
}

const BONES: [number, number][] = [
  [11, 12], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

function fmtRep(ms: number) { return `${(ms / 1000).toFixed(1)}초`; }

/**
 * 실시간 횟수 세기. 열면 바로 카메라가 켜지고, 운동 종류를 고르지 않아도
 * 크게 반복해서 움직이는 관절을 찾아 횟수를 자동으로 센다.
 * ‘이 횟수 사용’을 누르면 onUse(횟수)로 돌려준다.
 */
export type CountSource = 'camera' | 'tempo';
export type LiveDefaults = FlowConfig & { focus?: Focus; tip?: string; source?: CountSource; tempoSec?: number };

export function LiveCountModal({
  visible, onClose, onUse, defaults,
}: { visible: boolean; defaults?: LiveDefaults; onClose: () => void; onUse: (counts: number[]) => void }) {
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <LiveBody onClose={onClose} onUse={onUse} defaults={defaults ?? { targetReps: 10, totalSets: 3, restSec: 60 }} />
    </Modal>
  );
}

function Stepper({ label, value, unit, step, min, max, onChange }: {
  label: string; value: number; unit: string; step: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <Row style={{ marginTop: S.sm }}>
      <T muted style={{ flex: 1 }}>{label}</T>
      <Btn label="−" kind="ghost" small onPress={() => onChange(Math.max(min, value - step))} />
      <T bold style={{ width: 64, textAlign: 'center' }}>{value}{unit}</T>
      <Btn label="+" kind="ghost" small onPress={() => onChange(Math.min(max, value + step))} />
    </Row>
  );
}

function LiveBody({ onClose, onUse, defaults }: { onClose: () => void; onUse: (counts: number[]) => void; defaults: LiveDefaults }) {
  useKeepAwake();
  const { db } = useApp();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [strict, setStrict] = useState<Strictness>('normal');
  const [sound, setSound] = useState(true); // 횟수를 소리로 읽기
  const [focus, setFocus] = useState<Focus>(defaults.focus ?? 'auto');
  const [mode, setMode] = useState<'free' | 'sets'>('sets'); // 세트 자동 진행 / 자유 카운트
  const [cfg, setCfg] = useState<FlowConfig>({ targetReps: defaults.targetReps, totalSets: defaults.totalSets, restSec: defaults.restSec, prepSec: defaults.prepSec ?? 10 });
  const [source, setSource] = useState<CountSource>(defaults.source ?? 'camera'); // 카메라로 세기 / 박자에 맞춰 세기
  const [tempoSec, setTempoSec] = useState(defaults.tempoSec ?? 3); // 박자: 한 회당 초
  const nextAt = useRef(0);
  const flow = useRef<SetFlow | null>(null);
  const [, flowRender] = useState(0);
  const [model, setModel] = useState<'lite' | 'full'>('lite');
  const [front, setFront] = useState(false);
  const [ready, setReady] = useState(false); // 카메라 권한 확인 끝, 카메라 켜짐
  const [perm, setPerm] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ lm: number[]; w: number; h: number } | null>(null);
  const [frames, setFrames] = useState(0);
  const [seen, setSeen] = useState(false);
  const [camKey, setCamKey] = useState(0); // 카메라 화면이 안 나올 때 새로 만들기 위한 값
  const counter = useRef(new AutoRepCounter());
  const lastSeen = useRef(0);
  const [, force] = useState(0);

  useEffect(() => { counter.current.setStrictness(strict); }, [strict]);
  useEffect(() => { counter.current.setFocus(focus); counter.current.reset(); setCount(0); setLastMs(null); }, [focus]);
  useEffect(() => stopSpeaking, []);

  // 세트 자동 진행: 설정이 바뀌거나 모드를 바꾸면 처음부터 다시 준비
  useEffect(() => {
    flow.current = mode === 'sets' ? newFlow(cfg) : null;
    counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0;
    flowRender((n) => n + 1);
  }, [mode, cfg]);
  // 박자 방식은 세트 자동 진행으로만 쓴다
  useEffect(() => { if (source === 'tempo' && mode !== 'sets') setMode('sets'); }, [source, mode]);

  // 쉬는 시간 카운트다운 (0.25초마다 확인)
  useEffect(() => {
    if (mode !== 'sets') return;
    const id = setInterval(() => {
      const f = flow.current;
      if (!f || (f.phase !== 'resting' && f.phase !== 'preparing')) return;
      const ev = f.tick(Date.now());
      if ((ev?.kind === 'restTick' || ev?.kind === 'prepTick') && sound) speakText(countWord(ev.secLeft));
      if (ev?.kind === 'prep') {
        counter.current.reset(); setCount(0); setLastMs(null);
        Vibration.vibrate(120);
        if (sound) speakText(`${ev.setNo}세트 준비하세요`);
      }
      if (ev?.kind === 'start') {
        counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0;
        Vibration.vibrate([0, 200, 100, 200]);
        if (sound) speakText(`${ev.setNo}세트 시작`);
      }
      flowRender((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, [mode, sound]);

  // 열자마자 권한을 확인하고 카메라를 켠다 (시작 버튼 없음)
  useEffect(() => {
    if (source !== 'camera') return;
    let alive = true;
    (async () => {
      if (!cameraView()) { setErr('이 앱 버전에서는 카메라 분석을 사용할 수 없습니다'); return; }
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!alive) return;
      const ok = r === PermissionsAndroid.RESULTS.GRANTED;
      setPerm(ok);
      if (ok) setReady(true);
    })();
    return () => { alive = false; };
  }, [source]);

  // 사람이 보이는지 확인
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => setSeen(Date.now() - lastSeen.current < 1500), 500);
    return () => clearInterval(id);
  }, [ready]);

  // 카메라를 켰는데 3초 넘게 프레임이 안 오면 안내
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!ready) return;
    setStalled(false);
    const id = setTimeout(() => setStalled(true), 3500);
    return () => clearTimeout(id);
  }, [ready, camKey, front, model]);
  useEffect(() => { if (frames > 0) setStalled(false); }, [frames]);

  const CameraView = cameraView();

  const onPose = (e: PoseEvent) => {
    const { lm, w, h, t } = e.nativeEvent;
    let any = false;
    for (let i = 11; i <= 28; i++) if (lm[i * 3 + 2] > 0.5) { any = true; break; }
    if (any) lastSeen.current = Date.now();
    setFrame({ lm, w, h });
    setFrames((n) => n + 1);
    const f = flow.current;
    if (f && f.phase !== 'counting') return; // 쉬는 중·끝난 뒤에는 세지 않는다
    const ev = counter.current.push(lm, w, h, t);
    if (ev) {
      const n = counter.current.count;
      setCount(n);
      setLastMs(ev.timeMs);
      Vibration.vibrate(40);
      if (sound) speakCount(n);
      handleFlow(f?.onCount(n, Date.now()) ?? null);
    }
    force((n) => (n + 1) % 1000);
  };

  /** 세트 흐름 시작: 준비 시간이 있으면 준비부터 (소리로 알림) */
  function newFlow(c: FlowConfig): SetFlow {
    const f = new SetFlow(c);
    if (f.beginPrep(Date.now()) && sound) speakText('준비하세요');
    return f;
  }
  /** 세트 완료 알림 (진동·소리) */
  function handleFlow(fe: FlowEvent | null) {
    if (fe?.kind !== 'setDone') return;
    Vibration.vibrate([0, 300, 100, 300]);
    if (sound) speakText(fe.last ? '운동 끝, 수고했어요' : `${fe.setNo}세트 완료, ${cfg.restSec}초 쉬세요`, true);
    flowRender((x) => x + 1);
  }
  /** 박자 한 번: 횟수를 하나 올리고 소리 내어 센다 */
  const tempoStep = () => {
    const f = flow.current;
    if (!f || f.phase !== 'counting') return;
    counter.current.adjust(1);
    const n = counter.current.count;
    setCount(n);
    Vibration.vibrate(40);
    if (sound) speakCount(n);
    handleFlow(f.onCount(n, Date.now()));
  };
  const tempoRef = useRef(tempoStep);
  tempoRef.current = tempoStep;
  useEffect(() => {
    if (source !== 'tempo') return;
    const id = setInterval(() => {
      const f = flow.current;
      if (!f || f.phase !== 'counting') { nextAt.current = 0; return; }
      const now = Date.now();
      if (nextAt.current === 0) { nextAt.current = now + tempoSec * 1000; return; }
      if (now < nextAt.current) return;
      nextAt.current = now + tempoSec * 1000;
      tempoRef.current();
    }, 100);
    return () => clearInterval(id);
  }, [source, tempoSec]);

  const adjustCount = (d: number) => {
    counter.current.adjust(d);
    const n = counter.current.count;
    setCount(n);
    const f = flow.current;
    if (f && f.phase === 'counting' && d > 0) handleFlow(f.onCount(n, Date.now()));
  };
  const reset = () => { stopSpeaking(); counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0; if (mode === 'sets') { flow.current = newFlow(cfg); flowRender((n) => n + 1); } };
  const restartCamera = () => { setFrames(0); setFrame(null); setErr(null); setCamKey((k) => k + 1); };

  // 영상은 비율을 유지(FIT)해서 보이므로, 같은 비율의 상자에 영상과 뼈대를 겹쳐 그린다
  const ar = frame ? frame.w / frame.h : 3 / 4;
  const maxH = winH * 0.4;
  const boxW = Math.min(winW - S.lg * 2, maxH * ar);
  const boxH = boxW / ar;
  const lm = frame?.lm;
  const vis = (i: number) => (lm ? lm[i * 3 + 2] > 0.5 : false);
  const cnt = counter.current;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Header title={source === 'tempo' ? '박자로 세기' : '실시간 횟수 세기'} onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 40 }}>
        {source === 'tempo' ? (
          <View style={{ padding: S.md, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center' }}>
            <T bold>박자 카운트 · 한 회당 {tempoSec}초</T>
            <T muted style={{ fontSize: 12, marginTop: 2, textAlign: 'center' }}>카메라를 쓰지 않아요. 앱이 소리 내어 세는 박자에 맞춰 동작하세요.</T>
          </View>
        ) : (
        <View style={{ width: boxW, height: boxH, alignSelf: 'center', backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' }}>
          {ready && CameraView ? (
            <>
              <CameraView
                key={camKey}
                style={{ width: boxW, height: boxH }} active front={front} model={model}
                onPose={onPose} onError={(e) => setErr(e.nativeEvent.message)}
              />
              <Svg width={boxW} height={boxH} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                {lm && BONES.map(([a, b], i) => (vis(a) && vis(b) ? (
                  <Line key={i} x1={lm[a * 3] * boxW} y1={lm[a * 3 + 1] * boxH} x2={lm[b * 3] * boxW} y2={lm[b * 3 + 1] * boxH} stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={2} />
                ) : null))}
                {lm && [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].map((i) => (vis(i) ? (
                  <Circle key={i} cx={lm[i * 3] * boxW} cy={lm[i * 3 + 1] * boxH} r={4} fill={GC.all} />
                ) : null))}
              </Svg>
              {frames > 0 && !seen && (
                <Text style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#FFFFFFCC', textAlign: 'center', fontSize: 12 }}>
                  사람이 보이지 않아요 — 몸 전체가 화면에 들어오게 해 주세요
                </Text>
              )}
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.lg }}>
              <Text style={{ color: '#FFFFFFAA', textAlign: 'center', lineHeight: 20 }}>
                {perm === false ? '카메라 권한이 필요합니다' : '카메라를 켜는 중…'}
              </Text>
            </View>
          )}
        </View>
        )}

        {mode === 'sets' && flow.current && (
          <View style={{ marginTop: S.md, padding: S.md, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center' }}>
            {flow.current.phase === 'preparing' ? (
              <>
                <T muted>{flow.current.setNo}세트 준비 · 목표 {cfg.targetReps}회</T>
                <T bold style={{ fontSize: 56, lineHeight: 64 }}>{flow.current.secLeft(Date.now())}</T>
                <Btn label="바로 시작" kind="ghost" small onPress={() => {
                  const e = flow.current?.skipPrep();
                  if (e) { counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0; if (sound) speakText(`${e.setNo}세트 시작`); flowRender((n) => n + 1); }
                }} />
              </>
            ) : flow.current.phase === 'resting' ? (
              <>
                <T muted>{flow.current.setNo}세트 완료 · 쉬는 중</T>
                <T bold style={{ fontSize: 40 }}>{flow.current.secLeft(Date.now())}초</T>
                <T muted style={{ fontSize: 12 }}>다음 세트 {flow.current.setNo + 1} / {cfg.totalSets} · 목표 {cfg.targetReps}회</T>
                <Btn label="쉬기 건너뛰기" kind="ghost" small onPress={() => {
                  const e = flow.current?.skipRest(Date.now());
                  if (e) {
                    counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0;
                    if (sound) speakText(e.kind === 'prep' ? `${e.setNo}세트 준비하세요` : `${e.setNo}세트 시작`);
                    flowRender((n) => n + 1);
                  }
                }} />
              </>
            ) : flow.current.phase === 'done' ? (
              <T bold>운동 끝 · {flow.current.counts.join(' / ')}회</T>
            ) : (
              <T bold>{flow.current.setNo} / {cfg.totalSets}세트 · 목표 {cfg.targetReps}회</T>
            )}
          </View>
        )}
        <Row style={{ justifyContent: 'center', alignItems: 'flex-end', marginTop: S.md }}>
          <Btn label="−1" kind="ghost" small onPress={() => adjustCount(-1)} />
          <T bold style={{ fontSize: 64, lineHeight: 70, marginHorizontal: S.md }}>{count}</T>
          <T muted style={{ fontSize: 20, marginBottom: 10, marginRight: S.md }}>회</T>
          <Btn label="+1" kind="ghost" small onPress={() => adjustCount(1)} />
        </Row>
        <T muted style={{ textAlign: 'center' }}>
          {source === 'tempo'
            ? (count === 0 ? '준비가 끝나면 박자에 맞춰 세기 시작해요' : `박자 ${tempoSec}초 · 소리에 맞춰 동작하세요`)
            : count === 0
            ? '폰을 세워 두고 운동을 시작하면 자동으로 셉니다'
            : `${cnt.jointLabel ?? ''} 움직임 감지${lastMs != null ? ` · 마지막 ${fmtRep(lastMs)}` : ''}${cnt.avgRepMs != null ? ` · 평균 ${fmtRep(cnt.avgRepMs)}` : ''}`}
        </T>
        {err && <T style={{ marginTop: 6, textAlign: 'center' }}>{err}</T>}
        {source === 'camera' && perm === false && (
          <Btn label="권한 다시 요청" kind="ghost" style={{ marginTop: S.sm }} onPress={async () => {
            const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
            const ok = r === PermissionsAndroid.RESULTS.GRANTED; setPerm(ok); if (ok) setReady(true);
          }} />
        )}
        {source === 'camera' && ready && stalled && (
          <View style={{ marginTop: S.sm }}>
            <T muted style={{ textAlign: 'center', marginBottom: 6 }}>카메라 화면이 안 나오나요?</T>
            <Btn label="카메라 다시 켜기" kind="ghost" onPress={restartCamera} />
          </View>
        )}

        <Row style={{ marginTop: S.md }}>
          <Btn label="처음부터" kind="ghost" style={{ flex: 1 }} onPress={reset} />
          {source === 'camera' && <Btn label={front ? '뒷카메라로' : '앞카메라로'} kind="ghost" style={{ flex: 1 }} onPress={() => setFront((f) => !f)} />}
        </Row>
        <Row style={{ marginTop: S.md }}>
          <View style={{ flex: 1 }}>
            <Segmented<CountSource> options={[{ key: 'camera', label: '📷 카메라로' }, { key: 'tempo', label: '⏱ 박자로' }]} value={source} onChange={(v) => { setSource(v); setSetting(db, 'run_mode', v); }} />
          </View>
        </Row>
        {source === 'camera' && (
          <Row style={{ marginTop: S.sm }}>
            <View style={{ flex: 1 }}>
              <Segmented<'free' | 'sets'> options={[{ key: 'sets', label: '세트 자동 진행' }, { key: 'free', label: '자유 카운트' }]} value={mode} onChange={setMode} />
            </View>
          </Row>
        )}
        {mode === 'sets' && (
          <View>
            <Stepper label="세트당 목표 횟수" value={cfg.targetReps} unit="회" step={1} min={1} max={100} onChange={(v) => setCfg((c) => ({ ...c, targetReps: v }))} />
            <Stepper label="세트 수" value={cfg.totalSets} unit="세트" step={1} min={1} max={20} onChange={(v) => setCfg((c) => ({ ...c, totalSets: v }))} />
            <Stepper label="쉬는 시간" value={cfg.restSec} unit="초" step={15} min={5} max={600} onChange={(v) => setCfg((c) => ({ ...c, restSec: v }))} />
            <Stepper label="준비 시간 (0이면 없음)" value={cfg.prepSec ?? 0} unit="초" step={5} min={0} max={30} onChange={(v) => { setCfg((c) => ({ ...c, prepSec: v })); setSetting(db, 'prep_sec', String(v)); }} />
            {source === 'tempo' && (
              <Stepper label="박자 (한 회당)" value={tempoSec} unit="초" step={0.5} min={1} max={10} onChange={(v) => { setTempoSec(v); setSetting(db, 'tempo_sec', String(v)); }} />
            )}
            <T muted style={{ fontSize: 12, marginTop: 4 }}>준비 시간이 끝나기 전 3·2·1로 알려 주고 “시작”이라고 말합니다. 목표 횟수를 채우면 쉬는 시간을 알려 주고, 쉬고 나면 다시 준비 → 시작으로 이어져요.</T>
          </View>
        )}
        <Row style={{ marginTop: S.sm }}>
          <Chip label={sound ? '🔊 횟수 소리 켜짐' : '🔇 횟수 소리 꺼짐'} active={sound} onPress={() => { if (sound) stopSpeaking(); setSound((v) => !v); }} />
        </Row>
        {defaults.tip ? <T muted style={{ marginTop: S.md, fontSize: 12 }}>📍 {defaults.tip}</T> : null}
        {source === 'camera' && (<>
        <T muted style={{ marginTop: S.md, fontSize: 12 }}>운동 종류</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {(Object.keys(FOCUS_LABEL) as Focus[]).map((k) => (
            <Chip key={k} label={FOCUS_LABEL[k]} active={focus === k} onPress={() => setFocus(k)} />
          ))}
        </View>
        <Row style={{ marginTop: S.sm }}>
          <View style={{ flex: 1 }}>
            <Segmented<Strictness> options={(['easy', 'normal', 'strict'] as Strictness[]).map((k) => ({ key: k, label: STRICT_LABEL[k] }))} value={strict} onChange={setStrict} />
          </View>
        </Row>
        <Row style={{ marginTop: S.sm }}>
          <View style={{ flex: 1 }}>
            <Segmented<'lite' | 'full'> options={[{ key: 'lite', label: '빠름' }, { key: 'full', label: '정밀' }]} value={model} onChange={setModel} />
          </View>
        </Row>
        </>)}
        {(() => {
          const counts = mode === 'sets' && flow.current ? flow.current.finish(count) : count > 0 ? [count] : [];
          return (
            <Btn
              label={counts.length > 1 ? `이 기록 사용 (${counts.join(' / ')}회)` : `이 횟수 사용 (${count}회)`}
              disabled={counts.length === 0} style={{ marginTop: S.md }} onPress={() => onUse(counts)}
            />
          );
        })()}
        {source === 'camera' && <T muted style={{ fontSize: 12, marginTop: S.sm, textAlign: 'center' }}>
          횟수가 틀리면 ‘쉬움/엄격’으로 바꿔 보세요. 쉬움은 작은 움직임도 세고, 엄격은 크게 움직여야 셉니다.
        </T>}
        {source === 'camera' && ready && <T muted style={{ fontSize: 11, marginTop: 4, textAlign: 'center' }}>카메라 프레임 {frames}</T>}
      </ScrollView>
    </View>
  );
}
