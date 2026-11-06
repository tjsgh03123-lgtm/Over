import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, PermissionsAndroid, Platform, ScrollView, Text, Vibration, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requireNativeView } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Circle, Line } from 'react-native-svg';
import { AutoRepCounter, STRICT_LABEL, type Strictness } from '../domain/liveCount.ts';
import { Btn, Header, Row, Segmented, T } from './components.tsx';
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
export function LiveCountModal({
  visible, onClose, onUse,
}: { visible: boolean; exerciseName?: string; onClose: () => void; onUse: (count: number) => void }) {
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <LiveBody onClose={onClose} onUse={onUse} />
    </Modal>
  );
}

function LiveBody({ onClose, onUse }: { onClose: () => void; onUse: (n: number) => void }) {
  useKeepAwake();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [strict, setStrict] = useState<Strictness>('normal');
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

  // 열자마자 권한을 확인하고 카메라를 켠다 (시작 버튼 없음)
  useEffect(() => {
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
  }, []);

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
    const ev = counter.current.push(lm, w, h, t);
    if (ev) {
      setCount(counter.current.count);
      setLastMs(ev.timeMs);
      Vibration.vibrate(40);
    }
    force((n) => (n + 1) % 1000);
  };

  const reset = () => { counter.current.reset(); setCount(0); setLastMs(null); };
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
      <Header title="실시간 횟수 세기" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 40 }}>
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

        <Row style={{ justifyContent: 'center', alignItems: 'flex-end', marginTop: S.md }}>
          <T bold style={{ fontSize: 64, lineHeight: 70 }}>{count}</T>
          <T muted style={{ fontSize: 20, marginBottom: 10 }}>회</T>
        </Row>
        <T muted style={{ textAlign: 'center' }}>
          {count === 0
            ? '폰을 세워 두고 운동을 시작하면 자동으로 셉니다'
            : `${cnt.jointLabel ?? ''} 움직임 감지${lastMs != null ? ` · 마지막 ${fmtRep(lastMs)}` : ''}${cnt.avgRepMs != null ? ` · 평균 ${fmtRep(cnt.avgRepMs)}` : ''}`}
        </T>
        {err && <T style={{ marginTop: 6, textAlign: 'center' }}>{err}</T>}
        {perm === false && (
          <Btn label="권한 다시 요청" kind="ghost" style={{ marginTop: S.sm }} onPress={async () => {
            const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
            const ok = r === PermissionsAndroid.RESULTS.GRANTED; setPerm(ok); if (ok) setReady(true);
          }} />
        )}
        {ready && stalled && (
          <View style={{ marginTop: S.sm }}>
            <T muted style={{ textAlign: 'center', marginBottom: 6 }}>카메라 화면이 안 나오나요?</T>
            <Btn label="카메라 다시 켜기" kind="ghost" onPress={restartCamera} />
          </View>
        )}

        <Row style={{ marginTop: S.md }}>
          <Btn label="처음부터" kind="ghost" style={{ flex: 1 }} onPress={reset} />
          <Btn label={front ? '뒷카메라로' : '앞카메라로'} kind="ghost" style={{ flex: 1 }} onPress={() => setFront((f) => !f)} />
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
        </Row>
        <Btn label={`이 횟수 사용 (${count}회)`} disabled={count === 0} style={{ marginTop: S.md }} onPress={() => onUse(count)} />
        <T muted style={{ fontSize: 12, marginTop: S.sm, textAlign: 'center' }}>
          횟수가 틀리면 ‘쉬움/엄격’으로 바꿔 보세요. 쉬움은 작은 움직임도 세고, 엄격은 크게 움직여야 셉니다.
        </T>
        {ready && <T muted style={{ fontSize: 11, marginTop: 4, textAlign: 'center' }}>카메라 프레임 {frames}</T>}
      </ScrollView>
    </View>
  );
}
