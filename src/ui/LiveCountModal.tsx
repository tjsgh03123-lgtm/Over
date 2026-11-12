import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, Text, Vibration, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requireNativeView } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Path, Polyline } from 'react-native-svg';
import { jointPoint, PathTrail, TRAIL_LABEL, type TrailJoint } from '../domain/pathTrail.ts';
import { useApp } from '../app/context.tsx';
import { setSetting } from '../db/repo.ts';
import { coarseOfExercise } from '../domain/exerciseTable.ts';
import { classifyPose, VIEW_LABEL, verifyAgainst, type Guess } from '../domain/patternClassify.ts';
import { buildPoseLog, LOG_SECONDS, type LogEvent, type LogFrame } from '../domain/poseLog.ts';
import { shareTextFile, stamp } from '../services/files.ts';
import { AutoRepCounter, countWord, FOCUS_LABEL, type Focus, rangeText, STRICT_LABEL, type Strictness } from '../domain/liveCount.ts';
import { SetFlow, type FlowConfig, type FlowEvent } from '../domain/setFlow.ts';
import { speakCount, speakText, stopSpeaking, setSpeechTempo } from '../services/speak.ts';
import { cycleTempo, fmtSpeed, nearestSpeed, SPEEDS, speedOf, tempoOf } from '../domain/voiceSpeed.ts';
import { Btn, Card, Chip, Header, Row, Segmented, T } from './components.tsx';
import { FlowGlyph, Pill } from './FlowShell.tsx';
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


function fmtRep(ms: number) { return `${(ms / 1000).toFixed(1)}초`; }

/**
 * 실시간 횟수 세기. 열면 바로 카메라가 켜지고, 운동 종류를 고르지 않아도
 * 크게 반복해서 움직이는 관절을 찾아 횟수를 자동으로 센다.
 * ‘이 횟수 사용’을 누르면 onUse(횟수)로 돌려준다.
 */
export type CountSource = 'camera' | 'tempo';
export type LiveDefaults = FlowConfig & { focus?: Focus; tip?: string; source?: CountSource; tempoSec?: number; exerciseName?: string; sound?: boolean; idleEndSec?: number };

export function LiveCountModal({
  visible, onClose, onUse, defaults, onList, overlay, minimized, onMinimize, onExpand,
}: {
  overlay?: React.ReactNode; visible: boolean; defaults?: LiveDefaults; onClose: () => void; onUse: (counts: number[]) => void; onList?: () => void;
  /** 접힘: 화면은 숨기고 위쪽 작은 띠만 남긴 채 카메라·보이스 진행은 계속된다 */
  minimized?: boolean; onMinimize?: () => void; onExpand?: () => void;
}) {
  const leave = useRef<() => void>(() => {});
  if (!visible) return null;
  // Modal이 아니라 화면 위에 덮는 방식: 접어도 카메라·박자가 계속 돌고, 아래 목록(무게 입력 등)을 쓸 수 있다
  return (
    <LiveBody leave={leave} onList={onList} overlay={overlay} minimized={!!minimized} onMinimize={onMinimize} onExpand={onExpand} onClose={onClose} onUse={onUse} defaults={defaults ?? { targetReps: 10, totalSets: 3, restSec: 60 }} />
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

function Label({ children }: { children: React.ReactNode }) {
  return <T muted style={{ fontSize: 12, fontWeight: '700', marginTop: S.lg, marginBottom: S.sm }}>{children}</T>;
}

/** 카메라 + 회전 화살표 아이콘(앞/뒤 카메라 전환) */
function FlipIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <Path d="M9 12.6A3.2 3.2 0 0 1 14.7 11.7" />
      <Path d="M14.9 9.9l-.2 1.8-1.8-.2" />
      <Path d="M15 14.4A3.2 3.2 0 0 1 9.3 15.3" />
      <Path d="M9.1 17.1l.2-1.8 1.8.2" />
    </Svg>
  );
}

function LiveBody({ onClose, onUse, defaults, leave, onList, overlay, minimized, onMinimize, onExpand }: { minimized: boolean; onMinimize?: () => void; onExpand?: () => void; overlay?: React.ReactNode; onList?: () => void; leave: React.MutableRefObject<() => void>; onClose: () => void; onUse: (counts: number[]) => void; defaults: LiveDefaults }) {
  useKeepAwake();
  const { db } = useApp();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [strict, setStrict] = useState<Strictness>('normal');
  const [sound, setSound] = useState(defaults.sound ?? true); // 횟수를 소리로 읽기
  const [focus, setFocus] = useState<Focus>(defaults.focus ?? 'auto');
  const [mode, setMode] = useState<'free' | 'sets'>('sets'); // 세트 자동 진행 / 자유 카운트
  const [cfg, setCfg] = useState<FlowConfig>({ targetReps: defaults.targetReps, totalSets: defaults.totalSets, restSec: defaults.restSec, prepSec: defaults.prepSec ?? 10, idleEndSec: (defaults.source ?? 'camera') === 'camera' ? (defaults.idleEndSec ?? 5) : undefined });
  const [source, setSource] = useState<CountSource>(defaults.source ?? 'camera'); // 카메라로 세기 / 박자에 맞춰 세기
  const [tempoSec, setTempoSec] = useState(defaults.tempoSec ?? 3); // 박자: 한 회당 초 (화면에는 배속으로 보여 줌)
  useEffect(() => { setSpeechTempo(tempoSec); }, [tempoSec]);
  const nextAt = useRef(0);
  const flow = useRef<SetFlow | null>(null);
  const [, flowRender] = useState(0);
  const [model, setModel] = useState<'lite' | 'full'>('lite');
  const [showSettings, setShowSettings] = useState((defaults.source ?? 'camera') === 'tempo'); // 보이스코칭은 설정을 열어 둔 채로 시작
  const [front, setFront] = useState(true); // 기본은 전면. 바꾸려면 미리보기 오른쪽 위 아이콘
  const [ready, setReady] = useState(false); // 카메라 권한 확인 끝, 카메라 켜짐
  const [perm, setPerm] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ lm: number[]; w: number; h: number } | null>(null);
  const [frames, setFrames] = useState(0);
  const [trailJoint, setTrailJoint] = useState<TrailJoint>('off'); // 관절이 지나간 길 표시
  const trail = useRef(new PathTrail(90));
  const [seen, setSeen] = useState(false);
  const [camKey, setCamKey] = useState(0); // 카메라 화면이 안 나올 때 새로 만들기 위한 값
  const counter = useRef(new AutoRepCounter());
  // 동작 유형 추정: 최근 6초의 관절 프레임을 모아 1초마다 판별
  const poseBuf = useRef<{ lm: number[]; at: number }[]>([]);
  const poseDim = useRef({ w: 3, h: 4 });
  const logFrames = useRef<LogFrame[]>([]); // 오작동 확인용 좌표 기록(최근 60초, 영상 아님)
  const logEvents = useRef<LogEvent[]>([]);
  const [guess, setGuess] = useState<Guess | null>(null);
  const expected = defaults.exerciseName ? coarseOfExercise(defaults.exerciseName) : null;
  const lastSeen = useRef(0);
  const [, force] = useState(0);

  useEffect(() => { counter.current.setExercise(defaults.exerciseName ?? null); counter.current.setStrictness(strict); }, [strict, defaults.exerciseName]);
  useEffect(() => { counter.current.setFocus(focus); counter.current.reset(); setCount(0); setLastMs(null); }, [focus]);
  useEffect(() => stopSpeaking, []);
  useEffect(() => {
    if (source !== 'camera' || !ready) return;
    const id = setInterval(() => {
      const now = Date.now();
      const buf = poseBuf.current = poseBuf.current.filter((f) => now - f.at <= 6000);
      setGuess(buf.length >= 15 ? classifyPose(buf.map((f) => f.lm), poseDim.current.w, poseDim.current.h) : null);
    }, 1000);
    return () => clearInterval(id);
  }, [source, ready]);

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

  // 카메라: 마지막 1회 뒤 일정 시간 동작이 없으면 세트를 끝낸다 (목표를 채웠든 못 채웠든 센 횟수 그대로 기록)
  useEffect(() => {
    if (mode !== 'sets' || source !== 'camera') return;
    const id = setInterval(() => {
      const f = flow.current;
      if (!f || f.phase !== 'counting') return;
      handleFlow(f.checkIdle(counter.current.count, Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, [mode, source, cfg]); // eslint-disable-line react-hooks/exhaustive-deps

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
    trail.current.push(jointPoint(lm, trailJoint));
    poseBuf.current.push({ lm, at: Date.now() });
    logFrames.current.push({ t: Date.now(), lm });
    if (logFrames.current.length > LOG_SECONDS * 30) logFrames.current.shift();
    if (poseBuf.current.length > 240) poseBuf.current.shift();
    poseDim.current = { w, h };
    setFrame({ lm, w, h });
    setFrames((n) => n + 1);
    const f = flow.current;
    if (f && f.phase !== 'counting') return; // 쉬는 중·끝난 뒤에는 세지 않는다
    const ev = counter.current.push(lm, w, h, t);
    if (ev) {
      const n = counter.current.count;
      setCount(n);
      setLastMs(ev.timeMs);
      logEvents.current.push({ t: Date.now(), n, joint: counter.current.jointLabel });
      if (logEvents.current.length > 200) logEvents.current.shift();
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

  const saveLog = async () => {
    try {
      if (!logFrames.current.length) { Alert.alert('저장할 기록이 없어요', '카메라에 사람이 보이는 상태에서 잠깐 움직인 뒤 눌러 주세요'); return; }
      const json = buildPoseLog(logFrames.current, logEvents.current, {
        w: poseDim.current.w, h: poseDim.current.h, focus, strict, exercise: defaults.exerciseName ?? null, count,
      });
      await shareTextFile(`overdrive-pose-${stamp()}.json`, json, 'application/json');
    } catch (e) {
      Alert.alert('저장하지 못했어요', String((e as Error)?.message ?? e));
    }
  };

  const adjustCount = (d: number) => {
    counter.current.adjust(d);
    const n = counter.current.count;
    setCount(n);
    const f = flow.current;
    if (f && f.phase === 'counting' && d > 0) handleFlow(f.onCount(n, Date.now()));
  };
  const reset = () => { trail.current.reset(); stopSpeaking(); counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0; if (mode === 'sets') { flow.current = newFlow(cfg); flowRender((n) => n + 1); } };
  /** 앞/뒤 전환: 카메라 화면을 통째로 새로 만들어 다시 켠다(제자리에서 바꾸면 검은 화면이 남는 기기가 있음). 앞/뒤 좌표가 섞이지 않게 모아 둔 것은 비운다 */
  const flipCamera = () => {
    poseBuf.current = []; logFrames.current = []; trail.current.reset(); setGuess(null);
    setFront((f) => !f);
    restartCamera();
  };
  const restartCamera = () => { setFrames(0); setFrame(null); setErr(null); setCamKey((k) => k + 1); };

  // 영상은 비율을 유지(FIT)해서 보이므로, 같은 비율의 상자에 영상과 뼈대를 겹쳐 그린다
  const ar = frame ? frame.w / frame.h : 3 / 4;
  const maxH = winH * 0.4;
  const boxW = Math.min(winW - S.lg * 2, maxH * ar);
  const boxH = boxW / ar;
  const cnt = counter.current;

  // 센 횟수는 화면을 나갈 때 자동으로 기록에 담긴다 (따로 '사용' 버튼 없음)
  const finalCounts = () => (mode === 'sets' && flow.current ? flow.current.finish(count) : count > 0 ? [count] : []);
  const leaveNow = () => { const c = finalCounts(); if (c.length) onUse(c); else onClose(); };
  leave.current = leaveNow;
  // 안드로이드 뒤로 가기: 펼쳐 있으면 접기만 한다 (진행은 계속)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (minimized || !onMinimize) return false;
      onMinimize();
      return true;
    });
    return () => sub.remove();
  }, [minimized, onMinimize]);

  const fl = flow.current;
  const miniText = (() => {
    const who = defaults.exerciseName ? `${defaults.exerciseName} · ` : '';
    if (mode === 'sets' && fl) {
      const left = fl.secLeft(Date.now());
      if (fl.phase === 'preparing') return `${who}${fl.setNo}세트 준비 ${left}초`;
      if (fl.phase === 'resting') return `${who}휴식 ${left}초`;
      if (fl.phase === 'done') return `${who}운동 끝`;
      return `${who}${fl.setNo}/${cfg.totalSets}세트 · ${count}/${cfg.targetReps}회`;
    }
    return `${who}${count}회`;
  })();
  const body = (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, height: 52 }}>
        <Pressable onPress={onMinimize ?? leaveNow} hitSlop={12} accessibilityLabel="뒤로" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <FlowGlyph kind="back" color={C.text} />
          <T bold style={{ fontSize: 18 }}>{source === 'tempo' ? '보이스코칭' : '카메라로 세기'}</T>
        </Pressable>
        <Pressable onPress={() => { if (sound) stopSpeaking(); setSound((v) => !v); }} style={{ paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
          <T bold style={{ fontSize: 14 }}>{sound ? '음성 가이드 끄기' : '음성 가이드 켜기'}</T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 40 }}>
        {source === 'tempo' ? null : (
        <View style={{ width: boxW, height: boxH, alignSelf: 'center', backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' }}>
          {ready && CameraView ? (
            <>
              <CameraView
                key={camKey}
                style={{ width: boxW, height: boxH }} active front={front} model={model}
                onPose={onPose} onError={(e) => setErr(e.nativeEvent.message)}
              />
              <Svg width={boxW} height={boxH} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                {trailJoint !== 'off' && trail.current.points.length > 1 && (
                  <Polyline points={trail.current.points.map((p) => `${p.x * boxW},${p.y * boxH}`).join(' ')} fill="none" stroke={GC.all} strokeWidth={3} strokeOpacity={0.9} strokeLinejoin="round" />
                )}
              </Svg>
              {seen && (
                <Text style={{ position: 'absolute', left: 8, top: 6, color: '#FFFFFFCC', fontSize: 11 }}>
                  ● 인식 중{counter.current.partialBody ? ' · 상체만' : ''}
                </Text>
              )}
              <Pressable
                onPress={flipCamera} accessibilityLabel="카메라 전환" hitSlop={6}
                style={({ pressed }) => ({ position: 'absolute', right: 8, top: 8, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
              >
                <FlipIcon />
              </Pressable>
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

        {source === 'camera' && ready && guess && guess.top.length > 0 && (
          <View style={{ marginTop: S.md, padding: S.md, borderRadius: 12, backgroundColor: C.card2 }}>
            <T bold>지금 동작은 {guess.top[0].label} 같아요 ({Math.round(guess.top[0].conf * 100)}%)</T>
            {guess.top.length > 1 && (
              <T muted style={{ fontSize: 12, marginTop: 2 }}>
                {guess.top.slice(1).map((c) => `${c.label} ${Math.round(c.conf * 100)}%`).join(' · ')} 일 수도 있어요
              </T>
            )}
            {(() => {
              const v = verifyAgainst(expected, guess);
              return v.text ? <T style={{ fontSize: 12, marginTop: 4 }}>{v.status === 'match' ? '✓ ' : v.status === 'close' ? '△ ' : '✕ '}{v.text}</T> : null;
            })()}
            <T muted style={{ fontSize: 11, marginTop: 4 }}>카메라 방향: {VIEW_LABEL[guess.view]}{guess.note ? ` · ${guess.note}` : ''}</T>
          </View>
        )}
        {mode === 'sets' && flow.current ? (() => {
          const f = flow.current;
          const ph = f.phase;
          const left = f.secLeft(Date.now());
          const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
          const nextLine = `다음 세트 | ${f.setNo}세트, 목표 ${cfg.targetReps}회`;
          return (
            <View style={{ marginTop: S.md }}>
              <T muted style={{ fontSize: 16 }}>{`${Math.min(f.setNo, cfg.totalSets)} / ${cfg.totalSets}세트`}</T>
              {defaults.exerciseName ? <T bold style={{ fontSize: 26, marginTop: 2 }}>{defaults.exerciseName}</T> : null}
              <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 230 }}>
                {ph === 'preparing' ? (
                  <T bold style={{ fontSize: 170, lineHeight: 190 }}>{left}</T>
                ) : ph === 'resting' ? (
                  <>
                    <T bold style={{ fontSize: 88, lineHeight: 100 }}>{mmss}</T>
                    <T muted style={{ fontSize: 16 }}>휴식 시간</T>
                  </>
                ) : ph === 'done' ? (
                  <T bold style={{ fontSize: 40, lineHeight: 52 }}>운동 끝</T>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                    <T bold style={{ fontSize: 130, lineHeight: 146 }}>{count}</T>
                    <T bold style={{ fontSize: 30, marginLeft: 10, marginBottom: 22 }}>{`/ ${cfg.targetReps}회`}</T>
                  </View>
                )}
              </View>
              <T bold style={{ fontSize: 19, textAlign: 'center' }}>
                {ph === 'preparing' ? nextLine : ph === 'resting' ? `${f.setNo}세트 끝, 쉬는 시간` : ph === 'done' ? f.counts.join(' / ') + '회' : `${f.setNo}세트 진행중 | 목표 ${cfg.targetReps}회`}
              </T>
              {ph === 'resting' ? <T bold style={{ fontSize: 17, textAlign: 'center', marginTop: S.sm }}>{nextLine}</T> : null}
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: S.sm, marginTop: S.lg }}>
                {ph === 'counting' && source === 'tempo' ? (
                  <Pill label={`속도 ${fmtSpeed(speedOf(tempoSec))}`} onPress={() => { const t = cycleTempo(tempoSec); setTempoSec(t); setSetting(db, 'tempo_sec', String(t)); }} />
                ) : ph === 'counting' ? (
                  <>
                    <Pill label="− 1" onPress={() => adjustCount(-1)} />
                    <Pill label="+ 1" onPress={() => adjustCount(1)} />
                  </>
                ) : ph === 'preparing' ? (
                  <Pill label="바로 시작" onPress={() => {
                    const e = flow.current?.skipPrep();
                    if (e) { counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0; if (sound) speakText(`${e.setNo}세트 시작`); flowRender((n) => n + 1); }
                  }} />
                ) : ph === 'resting' ? (
                  <Pill label="쉬기 건너뛰기" onPress={() => {
                    const e = flow.current?.skipRest(Date.now());
                    if (e) {
                      counter.current.reset(); setCount(0); setLastMs(null); nextAt.current = 0;
                      if (sound) speakText(e.kind === 'prep' ? `${e.setNo}세트 준비하세요` : `${e.setNo}세트 시작`);
                      flowRender((n) => n + 1);
                    }
                  }} />
                ) : null}
              </View>
              {onList ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: S.sm }}>
                  <Pill label="전체 목록 · 무게" onPress={onList} />
                </View>
              ) : null}
            </View>
          );
        })() : (
        <Row style={{ justifyContent: 'center', alignItems: 'flex-end', marginTop: S.md }}>
          <Btn label="−1" kind="ghost" small onPress={() => adjustCount(-1)} />
          <T bold style={{ fontSize: 64, lineHeight: 70, marginHorizontal: S.md }}>{count}</T>
          <T muted style={{ fontSize: 20, marginBottom: 10, marginRight: S.md }}>회</T>
          <Btn label="+1" kind="ghost" small onPress={() => adjustCount(1)} />
        </Row>
        )}
        <T muted style={{ textAlign: 'center' }}>
          {source === 'tempo'
            ? (count === 0 ? '준비가 끝나면 음성으로 세기 시작해요' : `속도 ${fmtSpeed(speedOf(tempoSec))} · 음성에 맞춰 동작하세요`)
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

        <T muted style={{ marginTop: S.lg, textAlign: 'center', fontSize: 12 }}>뒤로 가기는 화면만 접고 진행은 계속돼요. 다 끝나면 ‘종료하고 기록’을 누르세요.</T>
        <Btn label="종료하고 기록" kind="ghost" style={{ marginTop: S.sm }} onPress={leaveNow} />
        <Row style={{ marginTop: S.sm }}>
          <Btn label={showSettings ? '설정 닫기' : '설정'} kind="ghost" style={{ flex: 1 }} onPress={() => setShowSettings((v) => !v)} />
        </Row>
        {defaults.tip ? <T muted style={{ marginTop: S.md, fontSize: 12 }}>📍 {defaults.tip}</T> : null}

        {showSettings && (
          <Card style={{ marginTop: S.md }}>
            <Label>방식</Label>
            <Segmented<CountSource> options={[{ key: 'camera', label: '카메라로' }, { key: 'tempo', label: '보이스코칭' }]} value={source} onChange={(v) => { setSource(v); setSetting(db, 'run_mode', v); }} />
            {source === 'camera' && (
              <View style={{ marginTop: S.sm }}>
                <Segmented<'free' | 'sets'> options={[{ key: 'sets', label: '세트 자동 진행' }, { key: 'free', label: '자유 카운트' }]} value={mode} onChange={setMode} />
              </View>
            )}
            {mode === 'sets' && (
              <>
                <Label>세트</Label>
                <Stepper label="세트당 목표 횟수" value={cfg.targetReps} unit="회" step={1} min={1} max={100} onChange={(v) => setCfg((c) => ({ ...c, targetReps: v }))} />
                <Stepper label="세트 수" value={cfg.totalSets} unit="세트" step={1} min={1} max={20} onChange={(v) => setCfg((c) => ({ ...c, totalSets: v }))} />
                <Stepper label="쉬는 시간" value={cfg.restSec} unit="초" step={15} min={5} max={600} onChange={(v) => setCfg((c) => ({ ...c, restSec: v }))} />
                <Stepper label="준비 시간 (0이면 없음)" value={cfg.prepSec ?? 0} unit="초" step={5} min={0} max={30} onChange={(v) => { setCfg((c) => ({ ...c, prepSec: v })); setSetting(db, 'prep_sec', String(v)); }} />
                {source === 'camera' && (
                  <Stepper label="동작이 멈추면 세트 끝 (초)" value={cfg.idleEndSec ?? 5} unit="초" step={1} min={2} max={20} onChange={(v) => { setCfg((c) => ({ ...c, idleEndSec: v })); setSetting(db, 'idle_end_sec', String(v)); }} />
                )}
                {source === 'tempo' && (
                  <>
                    <Label>음성 속도</Label>
                    <Segmented<string> options={SPEEDS.map((v) => ({ key: String(v), label: fmtSpeed(v) }))} value={String(nearestSpeed(speedOf(tempoSec)))} onChange={(k) => { const t = tempoOf(Number(k)); setTempoSec(t); setSetting(db, 'tempo_sec', String(t)); }} />
                  </>
                )}
                <T muted style={{ fontSize: 12, marginTop: 4 }}>준비 시간이 끝나기 전 3·2·1로 알려 주고 “시작”이라고 말합니다. 목표 횟수를 채우면 쉬는 시간을 알려 주고, 쉬고 나면 다시 준비 → 시작으로 이어져요.</T>
              </>
            )}
            <Label>소리</Label>
            <Row>
              <Chip label={sound ? '🔊 횟수 소리 켜짐' : '🔇 횟수 소리 꺼짐'} active={sound} onPress={() => { if (sound) stopSpeaking(); setSound((v) => !v); }} />
            </Row>
            {source === 'camera' && (
              <>
                <Label>운동 종류</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(Object.keys(FOCUS_LABEL) as Focus[]).map((k) => (
                    <Chip key={k} label={FOCUS_LABEL[k]} active={focus === k} onPress={() => setFocus(k)} />
                  ))}
                </View>
                <Label>움직인 길 (손목은 바벨이 지나간 길과 비슷해요)</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(Object.keys(TRAIL_LABEL) as TrailJoint[]).map((k) => (
                    <Chip key={k} label={TRAIL_LABEL[k]} active={trailJoint === k} onPress={() => { trail.current.reset(); setTrailJoint(k); }} />
                  ))}
                </View>
                {trailJoint !== 'off' && trail.current.points.length > 1 && (
                  <T muted style={{ fontSize: 12, marginTop: 4 }}>위아래로 움직인 폭: 화면 높이의 약 {trail.current.verticalRangePct}%</T>
                )}
                <Label>세는 크기 (안 세지면 '작은 동작도', 헛세면 '큰 동작만')</Label>
                <Segmented<Strictness> options={(['easy', 'normal', 'strict'] as Strictness[]).map((k) => ({ key: k, label: STRICT_LABEL[k] }))} value={strict} onChange={setStrict} />
                <T muted style={{ fontSize: 12, marginTop: 4 }}>
                  {defaults.exerciseName ? `${defaults.exerciseName}: ` : ''}{rangeText(strict, defaults.exerciseName)}
                  {counter.current.learnedRange != null ? ` · 내 움직임 약 ${Math.round(counter.current.learnedRange)}°로 기준을 맞췄어요` : ' · 3번 세면 내 움직임에 맞춰 기준을 조정해요'}
                </T>
                <Label>인식 정밀도</Label>
                <Segmented<'lite' | 'full'> options={[{ key: 'lite', label: '빠름' }, { key: 'full', label: '정밀' }]} value={model} onChange={setModel} />
                {ready && (
                  <>
                    <Label>횟수가 이상할 때</Label>
                    <Btn label="최근 60초 좌표 기록 저장" kind="ghost" small onPress={saveLog} />
                    <T muted style={{ fontSize: 11, marginTop: 4 }}>영상은 저장하지 않고 관절 좌표만 담아요. 공유해 주시면 원인을 확인할 수 있어요. (카메라 프레임 {frames})</T>
                  </>
                )}
              </>
            )}
          </Card>
        )}
      </ScrollView>
      {overlay}
    </View>
  );
  // 같은 구조를 유지해 접고 펼 때 카메라가 다시 켜지지 않게 한다
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 100, elevation: 100 }}>
      <View pointerEvents={minimized ? 'none' : 'auto'} style={minimized ? { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'hidden', opacity: 0.01 } : { flex: 1 }}>
        <View style={minimized ? { width: winW, height: winH } : { flex: 1 }}>{body}</View>
      </View>
      {minimized ? (
        <View style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 60, flexDirection: 'row', alignItems: 'center', gap: 8, padding: S.md, borderRadius: 16, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line }}>
          <T bold style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>{source === 'camera' ? '📷 ' : '🔊 '}{miniText}</T>
          <Btn label="열기" kind="ghost" small onPress={onExpand} />
          <Btn label="종료" kind="ghost" small onPress={leaveNow} />
        </View>
      ) : null}
    </View>
  );
}
