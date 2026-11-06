import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, PermissionsAndroid, Platform, ScrollView, Text, Vibration, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requireNativeView } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Circle, Line } from 'react-native-svg';
import {
  guessExercise, LIVE_EXERCISES, RepCounter, STRICT_LABEL, type LiveExercise, type Strictness,
} from '../domain/liveCount.ts';
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
 * 실시간 횟수 세기. 카메라로 운동을 보면서 반복 횟수를 자동으로 센다.
 * ‘이 횟수 사용’을 누르면 onUse(횟수)로 돌려준다.
 */
export function LiveCountModal({
  visible, exerciseName, onClose, onUse,
}: { visible: boolean; exerciseName: string; onClose: () => void; onUse: (count: number) => void }) {
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <LiveBody exerciseName={exerciseName} onClose={onClose} onUse={onUse} />
    </Modal>
  );
}

function LiveBody({ exerciseName, onClose, onUse }: { exerciseName: string; onClose: () => void; onUse: (n: number) => void }) {
  useKeepAwake();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [frames, setFrames] = useState(0);
  const [ex, setEx] = useState<LiveExercise>(guessExercise(exerciseName) ?? LIVE_EXERCISES[0]);
  const [strict, setStrict] = useState<Strictness>('normal');
  const [model, setModel] = useState<'lite' | 'full'>('lite');
  const [front, setFront] = useState(false);
  const [running, setRunning] = useState(false);
  const [perm, setPerm] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ lm: number[]; w: number; h: number } | null>(null);
  const [angle, setAngle] = useState<number | null>(null);
  const counter = useRef(new RepCounter(ex, strict));
  const lastSeen = useRef(0);
  const [seen, setSeen] = useState(false);

  useEffect(() => { counter.current = new RepCounter(ex, strict); setCount(0); setLastMs(null); }, [ex]);
  useEffect(() => { counter.current.setStrictness(strict); }, [strict]);

  // 사람이 몇 초째 안 보이면 안내
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeen(Date.now() - lastSeen.current < 1500), 500);
    return () => clearInterval(id);
  }, [running]);

  const CameraView = cameraView();

  const start = async () => {
    setErr(null);
    if (!CameraView) return Alert.alert('이 앱 버전에서는 카메라 분석을 사용할 수 없습니다');
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const ok = r === PermissionsAndroid.RESULTS.GRANTED;
    setPerm(ok);
    if (!ok) return Alert.alert('카메라 권한이 필요합니다', '설정에서 카메라 권한을 허용해 주세요.');
    counter.current.reset(); setCount(0); setLastMs(null); setFrames(0);
    setRunning(true);
  };

  const onPose = (e: PoseEvent) => {
    const { lm, w, h, t } = e.nativeEvent;
    // 신뢰도가 전부 0이면 사람이 없는 프레임
    let any = false;
    for (let i = 11; i <= 28; i++) if (lm[i * 3 + 2] > 0.5) { any = true; break; }
    if (any) lastSeen.current = Date.now();
    setFrame({ lm, w, h });
    setFrames((n) => n + 1);
    const ev = counter.current.push(lm, w, h, t);
    setAngle(counter.current.angle);
    if (ev) {
      setCount(ev.n);
      setLastMs(ev.timeMs);
      Vibration.vibrate(40);
    }
  };

  // 화면: 카메라 영상은 비율을 유지(FIT)해서 보이므로, 같은 비율의 상자에 영상과 뼈대를 겹쳐 그린다
  const ar = frame ? frame.w / frame.h : 3 / 4;
  const maxH = winH * 0.4;
  const boxW = Math.min(winW - S.lg * 2, maxH * ar);
  const boxH = boxW / ar;
  const lm = frame?.lm;
  const vis = (i: number) => (lm ? lm[i * 3 + 2] > 0.5 : false);

  const phaseText = useMemo(() => {
    const p = counter.current.phase;
    return p === 'up' ? '펴짐' : p === 'down' ? '굽힘' : '준비 중';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, angle]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Header title="실시간 횟수 세기" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 40 }}>
        <View style={{ width: boxW, height: boxH, alignSelf: 'center', backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' }}>
          {running && CameraView ? (
            <>
              <CameraView
                style={{ width: boxW, height: boxH }} active front={front} model={model}
                onPose={onPose} onError={(e) => { setErr(e.nativeEvent.message); }}
              />
              <Svg width={boxW} height={boxH} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                {lm && BONES.map(([a, b], i) => (vis(a) && vis(b) ? (
                  <Line key={i} x1={lm[a * 3] * boxW} y1={lm[a * 3 + 1] * boxH} x2={lm[b * 3] * boxW} y2={lm[b * 3 + 1] * boxH} stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={2} />
                ) : null))}
                {lm && [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].map((i) => (vis(i) ? (
                  <Circle key={i} cx={lm[i * 3] * boxW} cy={lm[i * 3 + 1] * boxH} r={4} fill={GC.all} />
                ) : null))}
              </Svg>
              {!seen && <Text style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#FFFFFFCC', textAlign: 'center', fontSize: 12 }}>사람이 보이지 않아요 — {ex.tip}</Text>}
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.lg }}>
              <Text style={{ color: '#FFFFFFAA', textAlign: 'center', lineHeight: 20 }}>
                폰을 세워 두고, {ex.tip} 찍어 주세요.{'\n'}시작을 누르면 바로 세기 시작해요.
              </Text>
            </View>
          )}
        </View>

        <Row style={{ justifyContent: 'center', alignItems: 'flex-end', marginTop: S.md }}>
          <T bold style={{ fontSize: 64, lineHeight: 70 }}>{count}</T>
          <T muted style={{ fontSize: 20, marginBottom: 10 }}>회</T>
        </Row>
        <T muted style={{ textAlign: 'center' }}>
          {running ? `${phaseText}${angle != null ? ` · ${Math.round(angle)}°` : ''}` : '대기 중'}
          {lastMs != null ? ` · 마지막 ${fmtRep(lastMs)}` : ''}
          {counter.current.avgRepMs != null ? ` · 평균 ${fmtRep(counter.current.avgRepMs)}` : ''}
        </T>
        {err && <T style={{ marginTop: 6, textAlign: 'center' }}>{err}</T>}
        {perm === false && <T style={{ marginTop: 6, textAlign: 'center' }}>카메라 권한이 없습니다.</T>}

        <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: S.md }}>
          {LIVE_EXERCISES.map((e) => <Chip key={e.id} label={e.label} active={ex.id === e.id} onPress={() => setEx(e)} />)}
        </Row>
        <Row style={{ marginTop: S.sm }}>
          <View style={{ flex: 1 }}>
            <Segmented<Strictness> options={(['easy', 'normal', 'strict'] as Strictness[]).map((k) => ({ key: k, label: STRICT_LABEL[k] }))} value={strict} onChange={setStrict} />
          </View>
        </Row>
        <Row style={{ marginTop: S.sm }}>
          <View style={{ flex: 1 }}>
            <Segmented<'lite' | 'full'> options={[{ key: 'lite', label: '빠름' }, { key: 'full', label: '정밀' }]} value={model} onChange={setModel} />
          </View>
          <View style={{ flex: 1 }}>
            <Segmented<'back' | 'front'> options={[{ key: 'back', label: '뒷카메라' }, { key: 'front', label: '앞카메라' }]} value={front ? 'front' : 'back'} onChange={(k) => setFront(k === 'front')} />
          </View>
        </Row>

        <Row style={{ marginTop: S.md }}>
          {running ? (
            <>
              <Btn label="정지" kind="ghost" style={{ flex: 1 }} onPress={() => setRunning(false)} />
              <Btn label="처음부터" kind="ghost" style={{ flex: 1 }} onPress={() => { counter.current.reset(); setCount(0); setLastMs(null); }} />
            </>
          ) : (
            <Btn label="시작" style={{ flex: 1 }} onPress={start} />
          )}
        </Row>
        <Btn
          label={`이 횟수 사용 (${count}회)`} disabled={count === 0} style={{ marginTop: S.sm }}
          onPress={() => { setRunning(false); onUse(count); }}
        />
        <T muted style={{ fontSize: 12, marginTop: S.sm, textAlign: 'center' }}>
          횟수가 틀리면 ‘쉬움/엄격’으로 바꿔 보세요. 쉬움은 덜 굽혀도 세고, 엄격은 깊게 굽혀야 셉니다.
        </T>
        {running && <T muted style={{ fontSize: 11, marginTop: 4, textAlign: 'center' }}>카메라 프레임 {frames}</T>}
      </ScrollView>
    </View>
  );
}
