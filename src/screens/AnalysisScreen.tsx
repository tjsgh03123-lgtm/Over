import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { VideoView } from 'expo-video';
import { useApp } from '../app/context.tsx';
import { uid } from '../db/adapter.ts';
import { deleteAnalysis, getAnalysis, getMsPerFrame, recordMsPerFrame, saveAnalysis } from '../db/repo.ts';
import {
  angleSeries, autoPickPreset, confidenceSeries, decodeTrack, detectReps, estimateSeconds, fmtClockMs, fmtSec, frameCountFor,
  frameCountOf, lowRanges, POINT_LABEL, PRESET_ANGLES, smoothSeries, summarizeReps, type AngleDef,
} from '../domain/pose.ts';
import { getVideoInfo, isCancelled, poseAvailable, startAnalysis, type AnalyzeJob, type PoseModel, type VideoInfo } from '../services/poseNative.ts';
import { AngleChart } from '../ui/AngleChart.tsx';
import { Btn, Card, Chip, H, Header, Row, Segmented, T, TextField } from '../ui/components.tsx';
import { MultiSlider } from '../ui/MultiSlider.tsx';
import { PoseOverlay } from '../ui/PoseOverlay.tsx';
import { C, GC, S } from '../ui/theme.ts';
import { useVideoClock } from '../ui/useVideoClock.ts';

const MAX_FRAMES = 6000;

interface ResultData {
  id: string | null;
  uri: string | null;
  videoW: number; videoH: number;
  startMs: number; endMs: number; fps: number; model: string;
  trackB64: string;
  angle: AngleDef;
  exerciseName: string;
  keepCopy: boolean;
}

type Phase =
  | { name: 'pick' }
  | { name: 'range'; uri: string; info: VideoInfo; fromCamera: boolean }
  | { name: 'running'; uri: string; info: VideoInfo; fromCamera: boolean; opts: { startMs: number; endMs: number; fps: number; model: PoseModel } }
  | { name: 'result'; data: ResultData };

function fmtEst(sec: number): string {
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

/** 영상 선택 → 구간 → 분석 → 결과(재생·각도·횟수) → 저장 */
export function AnalysisScreen({ analysisId }: { analysisId: string | null }) {
  const { db, nav } = useApp();
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [busy, setBusy] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(!!analysisId);
  const [prog, setProg] = useState({ done: 0, total: 1 });
  const t0 = useRef(0);
  const job = useRef<AnalyzeJob | null>(null);

  useEffect(() => () => job.current?.cancel(), []);

  useEffect(() => {
    if (!analysisId) return;
    (async () => {
      const a = await getAnalysis(db, analysisId);
      if (!a) { Alert.alert('분석 기록을 찾을 수 없습니다'); nav.close(); return; }
      setPhase({
        name: 'result',
        data: {
          id: a.id, uri: a.videoUri, videoW: a.videoW, videoH: a.videoH, startMs: a.startMs, endMs: a.endMs, fps: a.fps, model: a.model,
          trackB64: a.trackB64, angle: a.angle, exerciseName: a.exerciseName, keepCopy: false,
        },
      });
      setLoadingSaved(false);
    })().catch((e) => { Alert.alert('불러오지 못했습니다', String(e?.message ?? e)); nav.close(); });
  }, [db, analysisId, nav]);

  const openVideo = async (uri: string, fromCamera: boolean) => {
    setBusy(true);
    try {
      const info = await getVideoInfo(uri);
      if (!info.durationMs || !info.width) throw new Error('영상 정보를 읽을 수 없습니다');
      setPhase({ name: 'range', uri, info, fromCamera });
    } catch (e) {
      Alert.alert('영상을 열 수 없습니다', String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    // 복사하지 않고 원본 주소를 그대로 사용 → 큰 영상도 바로 열린다
    const res = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: false, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    await openVideo(res.assets[0].uri, false);
  };

  const shoot = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('카메라 권한이 필요합니다', '설정에서 카메라 권한을 허용해 주세요.');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 180, videoQuality: 1 });
    if (res.canceled || !res.assets?.length) return;
    await openVideo(res.assets[0].uri, true);
  };

  const run = (p: Extract<Phase, { name: 'range' }>, opts: { startMs: number; endMs: number; fps: number; model: PoseModel }) => {
    const total = frameCountFor(opts.startMs, opts.endMs, opts.fps);
    setProg({ done: 0, total });
    t0.current = Date.now();
    setPhase({ name: 'running', uri: p.uri, info: p.info, fromCamera: p.fromCamera, opts });
    const j = startAnalysis(p.uri, opts, (done, tot) => setProg({ done, total: tot }));
    job.current = j;
    j.promise
      .then(async (b64) => {
        const elapsed = Date.now() - t0.current;
        await recordMsPerFrame(db, opts.model, elapsed / total).catch(() => {});
        const track = decodeTrack(b64);
        const def = autoPickPreset(track, p.info.width, p.info.height) ?? PRESET_ANGLES[0];
        setPhase({
          name: 'result',
          data: {
            id: null, uri: p.uri, videoW: p.info.width, videoH: p.info.height, startMs: opts.startMs, endMs: opts.endMs, fps: opts.fps,
            model: opts.model, trackB64: b64, angle: def, exerciseName: '', keepCopy: p.fromCamera,
          },
        });
      })
      .catch((e) => {
        if (!isCancelled(e)) Alert.alert('분석하지 못했습니다', String((e as Error)?.message ?? e));
        setPhase(p);
      });
  };

  const body = (() => {
    if (loadingSaved) return <T muted style={{ padding: S.lg }}>불러오는 중…</T>;
    switch (phase.name) {
      case 'pick':
        return (
          <ScrollView contentContainerStyle={{ padding: S.lg }}>
            <Card>
              <H style={{ fontSize: 16, marginBottom: 6 }}>운동 영상 분석</H>
              <T muted style={{ marginBottom: S.md, lineHeight: 20 }}>
                영상에서 관절을 찾아 각도, 반복 횟수, 한 번에 걸린 시간, 가동 범위를 계산합니다. 실시간이 아니라 촬영한 영상을 분석해요. 전신(또는 보고 싶은 쪽 몸)이 잘 보이게, 몸이 가려지지 않게 찍으면 정확해집니다. 인터넷을 쓰지 않고 이 폰에서만 처리해요.
              </T>
              {!poseAvailable() && <T style={{ marginBottom: S.md }}>이 앱 버전에서는 영상 분석을 사용할 수 없습니다.</T>}
              <Btn label="갤러리 · 내 파일에서 선택" disabled={busy || !poseAvailable()} onPress={pickFile} style={{ marginBottom: S.sm }} />
              <Btn label="지금 촬영" kind="ghost" disabled={busy || !poseAvailable()} onPress={shoot} />
              {busy && <T muted style={{ marginTop: S.md }}>영상을 여는 중…</T>}
            </Card>
          </ScrollView>
        );
      case 'range':
        return <RangeStep key={phase.uri} p={phase} onRun={(o) => run(phase, o)} />;
      case 'running': {
        const pct = Math.min(100, Math.round((prog.done / Math.max(1, prog.total)) * 100));
        const el = (Date.now() - t0.current) / 1000;
        const remain = prog.done > 2 ? Math.max(0, Math.round((el / prog.done) * (prog.total - prog.done))) : null;
        return (
          <View style={{ padding: S.lg }}>
            <Card>
              <H style={{ fontSize: 16 }}>분석 중</H>
              <T bold style={{ fontSize: 34, marginVertical: S.sm }}>{pct}%</T>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden' }}>
                <View style={{ width: `${pct}%`, height: 8, backgroundColor: C.accent }} />
              </View>
              <T muted style={{ marginTop: S.sm }}>{prog.done} / {prog.total} 프레임{remain != null ? ` · 남은 시간 약 ${fmtEst(remain)}` : ''}</T>
              <T muted style={{ marginTop: S.sm, fontSize: 12 }}>화면을 켜 둔 채로 기다려 주세요. 다른 앱으로 나가면 느려질 수 있어요.</T>
              <Btn label="취소" kind="ghost" style={{ marginTop: S.md }} onPress={() => job.current?.cancel()} />
            </Card>
          </View>
        );
      }
      case 'result':
        return <ResultStep key={phase.data.id ?? 'new'} data={phase.data} />;
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="영상 분석" onBack={nav.close} />
      {body}
    </View>
  );
}

/* ------------------------------ 구간 선택 ------------------------------ */

function RangeStep({ p, onRun }: { p: Extract<Phase, { name: 'range' }>; onRun: (o: { startMs: number; endMs: number; fps: number; model: PoseModel }) => void }) {
  const { db } = useApp();
  const dur = p.info.durationMs;
  const [sel, setSel] = useState<number[]>([0, dur]);
  const [fps, setFps] = useState<'15' | '30'>('15');
  const [model, setModel] = useState<PoseModel>('full');
  const [ms, setMs] = useState<{ ms: number; measured: boolean }>({ ms: 160, measured: false });
  const clock = useVideoClock(p.uri, { startMs: sel[0], endMs: sel[1] });
  const { width: winW, height: winH } = useWindowDimensions();

  useEffect(() => { getMsPerFrame(db, model).then(setMs); }, [db, model]);

  const boxW0 = winW - S.lg * 2;
  const boxH = Math.min(winH * 0.42, (boxW0 * p.info.height) / p.info.width);
  const boxW = (boxH * p.info.width) / p.info.height;
  const frames = frameCountFor(sel[0], sel[1], Number(fps));
  const tooLong = frames > MAX_FRAMES;

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <View style={{ width: boxW, height: boxH, alignSelf: 'center', backgroundColor: '#000', marginBottom: S.sm }}>
        <VideoView player={clock.player} style={{ width: boxW, height: boxH }} contentFit="contain" nativeControls={false} />
      </View>
      <Card>
        <Row style={{ marginBottom: 2 }}>
          <T muted style={{ flex: 1 }}>분석할 구간</T>
          <Btn label="전체" kind="ghost" small onPress={() => { setSel([0, dur]); clock.seek(0); }} />
          <Btn label={clock.playing ? '❚❚ 정지' : '▶ 미리보기'} kind="ghost" small onPress={() => (clock.playing ? clock.pause() : clock.play())} />
        </Row>
        <MultiSlider
          values={sel} max={dur} minGap={500}
          onChange={(v, active) => { setSel(v); if (clock.playing) clock.pause(); clock.seek(v[active]); }}
        />
        <Row style={{ justifyContent: 'space-between' }}>
          <T>{fmtClockMs(sel[0])}</T>
          <T muted>길이 {fmtSec(sel[1] - sel[0])}</T>
          <T>{fmtClockMs(sel[1])}</T>
        </Row>
      </Card>
      <Card>
        <T muted style={{ marginBottom: 6 }}>초당 분석 프레임 (많을수록 정확하고 오래 걸려요)</T>
        <Segmented options={[{ key: '15', label: '15fps (권장)' }, { key: '30', label: '30fps (정밀)' }]} value={fps} onChange={setFps} />
        <T muted style={{ marginTop: S.md, marginBottom: 6 }}>모델</T>
        <Segmented<PoseModel>
          options={[{ key: 'lite', label: '빠름' }, { key: 'full', label: '정밀' }, { key: 'heavy', label: '최고' }]}
          value={model} onChange={setModel}
        />
        <T muted style={{ marginTop: S.md, fontSize: 12, lineHeight: 18 }}>
          {frames}프레임 · 예상 {fmtEst(estimateSeconds(frames, ms.ms))}{ms.measured ? '' : ' (처음이라 대략값이에요. 한 번 분석하면 이 폰 속도에 맞춰 정확해져요)'}
        </T>
        {tooLong && <T style={{ marginTop: 6 }}>구간이 너무 깁니다. 더 짧게 줄여 주세요.</T>}
      </Card>
      <Btn label="이 구간 분석" disabled={frames < 5 || tooLong} onPress={() => { clock.pause(); onRun({ startMs: sel[0], endMs: sel[1], fps: Number(fps), model }); }} />
    </ScrollView>
  );
}

/* ------------------------------ 결과 ------------------------------ */

function ResultStep({ data }: { data: ResultData }) {
  const { db, today, nav, bump } = useApp();
  const { width: winW, height: winH } = useWindowDimensions();
  const [def, setDef] = useState<AngleDef>(data.angle);
  const [name, setName] = useState(data.exerciseName);
  const [keep, setKeep] = useState(data.keepCopy);
  const [savedId, setSavedId] = useState<string | null>(data.id);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);

  const track = useMemo(() => decodeTrack(data.trackB64), [data.trackB64]);
  const frames = frameCountOf(track);
  const stepMs = 1000 / data.fps;
  const series = useMemo(() => smoothSeries(angleSeries(track, def, data.videoW, data.videoH)), [track, def, data.videoW, data.videoH]);
  const reps = useMemo(() => detectReps(series, stepMs), [series, stepMs]);
  const summary = useMemo(() => summarizeReps(reps), [reps]);
  const low = useMemo(() => lowRanges(confidenceSeries(track, [def.a, def.b, def.c])), [track, def]);
  const noPerson = useMemo(() => {
    let seen = 0;
    for (let f = 0; f < frames; f += 3) if (track[f * 99 + 11 * 3 + 2] > 0.5 || track[f * 99 + 23 * 3 + 2] > 0.5) seen++;
    return seen < Math.max(1, frames / 3) * 0.2;
  }, [track, frames]);

  const clock = useVideoClock(data.uri, { startMs: data.startMs, endMs: data.endMs });
  const frame = Math.max(0, Math.min(frames - 1, Math.round((clock.time - data.startMs) / stepMs)));
  const seekFrame = (f: number) => { if (clock.playing) clock.pause(); clock.seek(data.startMs + f * stepMs); };

  const boxW0 = winW - S.lg * 2;
  const boxH = Math.min(winH * 0.46, (boxW0 * data.videoH) / data.videoW);
  const boxW = (boxH * data.videoW) / data.videoH;
  const lenMs = data.endMs - data.startMs;

  const save = async () => {
    setSaving(true);
    try {
      const id = savedId ?? uid('va');
      let uri = data.uri;
      const dir = `${FileSystem.documentDirectory}analysis/`;
      if (keep && uri && !uri.startsWith(dir)) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const dest = `${dir}${id}.mp4`;
        await FileSystem.copyAsync({ from: uri, to: dest });
        uri = dest;
        data.uri = dest;
      }
      await saveAnalysis(db, today, {
        id, exerciseName: name, videoUri: uri, startMs: data.startMs, endMs: data.endMs, fps: data.fps, model: data.model,
        videoW: data.videoW, videoH: data.videoH, frames, trackB64: data.trackB64, angle: def, reps, summary, note: null,
      });
      setSavedId(id);
      bump();
      Alert.alert('저장했습니다', '홈의 영상 분석 목록에서 다시 볼 수 있어요.');
    } catch (e) {
      Alert.alert('저장하지 못했습니다', String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert('분석 기록 삭제', '이 분석 기록(앱에 보관한 영상 포함)을 삭제할까요?', [
      { text: '취소' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          if (savedId) {
            await deleteAnalysis(db, savedId);
            await FileSystem.deleteAsync(`${FileSystem.documentDirectory}analysis/${savedId}.mp4`, { idempotent: true }).catch(() => {});
          }
          bump();
          nav.close();
        },
      },
    ]);

  const tile = (label: string, value: string) => (
    <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: S.md, alignItems: 'center' }}>
      <T bold style={{ fontSize: 20 }}>{value}</T>
      <T muted style={{ fontSize: 11, marginTop: 2 }}>{label}</T>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: boxW, height: boxH, alignSelf: 'center', backgroundColor: '#000', marginBottom: S.sm }}>
        {!clock.virtual && <VideoView player={clock.player} style={{ width: boxW, height: boxH }} contentFit="contain" nativeControls={false} />}
        <PoseOverlay track={track} frame={frame} w={boxW} h={boxH} def={def} color={GC.pose} />
        {clock.virtual && (
          <Text style={{ position: 'absolute', left: 8, bottom: 6, color: '#FFFFFF99', fontSize: 11 }}>원본 영상이 없어 관절만 표시합니다</Text>
        )}
      </View>

      <Row style={{ marginBottom: 2 }}>
        <Btn label={clock.playing ? '❚❚' : '▶'} small onPress={() => (clock.playing ? clock.pause() : clock.play())} style={{ width: 56 }} />
        <View style={{ flex: 1 }}>
          <MultiSlider
            values={[clock.time - data.startMs]} max={lenMs}
            onChange={(v) => { if (clock.playing) clock.pause(); clock.seek(data.startMs + v[0]); }}
          />
        </View>
      </Row>
      {/* 관절이 잘 안 보인 구간(빨강) */}
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.card2, marginLeft: 64, marginBottom: 4, overflow: 'hidden' }}>
        {low.map(([a, b], i) => (
          <View key={i} style={{ position: 'absolute', left: `${(a / Math.max(1, frames - 1)) * 100}%`, width: `${Math.max(1, ((b - a + 1) / Math.max(1, frames - 1)) * 100)}%`, top: 0, bottom: 0, backgroundColor: '#E53935' }} />
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between', marginBottom: S.md }}>
        <T muted style={{ fontSize: 12 }}>{fmtClockMs(clock.time - data.startMs)} / {fmtClockMs(lenMs)}</T>
        <T muted style={{ fontSize: 12 }}>{low.length ? '빨간 구간: 관절이 잘 안 보였어요' : '관절이 계속 잘 보였어요'}</T>
      </Row>

      {noPerson && (
        <Card><T>사람이 거의 감지되지 않았어요. 전신이 화면에 들어오게 찍거나, 모델을 ‘최고’로 해서 다시 분석해 보세요.</T></Card>
      )}

      <Row style={{ marginBottom: S.md }}>
        {tile('횟수', `${summary.count}회`)}
        {tile('렙당 시간', summary.avgRepMs != null ? fmtSec(summary.avgRepMs) : '-')}
        {tile('가동 범위', summary.romDeg != null ? `${Math.round(summary.romDeg)}°` : '-')}
      </Row>

      <Card>
        <Pressable onPress={() => setOpen((o) => !o)}>
          <Row>
            <T muted>각도</T>
            <T bold style={{ flex: 1 }}>{def.label}</T>
            <T muted>{open ? '▲' : '▼'}</T>
          </Row>
        </Pressable>
        {open && (
          <Row style={{ flexWrap: 'wrap', marginTop: S.sm, gap: 6 }}>
            {PRESET_ANGLES.map((a) => <Chip key={a.id} label={a.label} active={def.id === a.id} onPress={() => { setDef(a); setOpen(false); }} />)}
            <Chip label="직접 지정" active={def.id === 'custom'} onPress={() => { setCustom(true); setOpen(false); }} />
          </Row>
        )}
        <View style={{ marginTop: S.md }}>
          <AngleChart series={series} stepMs={stepMs} reps={reps} low={low} cursorFrame={frame} onSeek={seekFrame} color={GC.pose} />
        </View>
        <T muted style={{ fontSize: 12, marginTop: 4 }}>
          지금 {series[frame] != null ? `${Math.round(series[frame] as number)}°` : '-'}
          {summary.minAngle != null ? ` · 최소 ${Math.round(summary.minAngle)}° · 최대 ${Math.round(summary.maxAngle as number)}°` : ''} · 그래프를 누르면 그 장면으로 이동
        </T>
      </Card>

      <Card>
        <H style={{ fontSize: 15, marginBottom: S.sm }}>반복 기록</H>
        {reps.length === 0 ? (
          <T muted>반복 동작을 찾지 못했어요. 다른 각도를 골라 보세요. (각도가 30° 이상 변해야 한 번으로 셉니다)</T>
        ) : (
          reps.map((r, i) => (
            <Pressable key={i} onPress={() => seekFrame(r.startFrame)} style={{ paddingVertical: 9, flexDirection: 'row', alignItems: 'center', borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <T bold style={{ width: 36 }}>{i + 1}</T>
              <T style={{ flex: 1 }}>{fmtSec(r.timeMs)}</T>
              <T muted style={{ flex: 1.3, textAlign: 'right' }}>최소 {Math.round(r.minAngle)}° · 범위 {Math.round(r.romDeg)}°</T>
            </Pressable>
          ))
        )}
      </Card>

      <Card>
        <TextField value={name} onChangeText={setName} placeholder="운동 이름 (예: 바벨 컬)" />
        <Row style={{ marginVertical: S.md }}>
          <Chip label={keep ? '✓ 영상도 앱에 보관' : '영상도 앱에 보관'} active={keep} onPress={() => setKeep((k) => !k)} />
        </Row>
        <T muted style={{ fontSize: 12, marginBottom: S.md }}>
          {keep ? '영상을 앱 안에 복사해 두어 나중에도 영상 위에서 다시 볼 수 있어요. (용량 차지)' : '보관하지 않으면 원본 영상이 지워질 때 관절 표시만 볼 수 있어요.'}
        </T>
        <Btn label={saving ? '저장 중…' : savedId ? '다시 저장' : '저장'} disabled={saving} onPress={save} />
        {savedId && <Btn label="삭제" kind="danger" style={{ marginTop: S.sm }} onPress={remove} />}
      </Card>

      <CustomAngleModal
        visible={custom} onClose={() => setCustom(false)} initial={def}
        onPick={(a) => { setDef(a); setCustom(false); }}
      />
    </ScrollView>
  );
}

/** 세 점(앞점 - 꼭짓점 - 뒷점)을 직접 골라 각도를 만든다 */
function CustomAngleModal({ visible, onClose, onPick, initial }: { visible: boolean; onClose: () => void; onPick: (a: AngleDef) => void; initial: AngleDef }) {
  const [a, setA] = useState(initial.a);
  const [b, setB] = useState(initial.b);
  const [c, setC] = useState(initial.c);
  const ids = Object.keys(POINT_LABEL).map(Number);
  const group = (title: string, val: number, set: (n: number) => void) => (
    <View style={{ marginBottom: S.md }}>
      <T muted style={{ marginBottom: 6 }}>{title}</T>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {ids.map((id) => <Chip key={id} label={POINT_LABEL[id]} active={val === id} onPress={() => set(id)} />)}
      </Row>
    </View>
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Header title="각도 직접 지정" onBack={onClose} />
        <ScrollView contentContainerStyle={{ padding: S.lg }}>
          {group('첫째 점', a, setA)}
          {group('꼭짓점 (각도를 재는 관절)', b, setB)}
          {group('셋째 점', c, setC)}
          <Btn
            label="이 각도 보기"
            disabled={a === b || b === c || a === c}
            onPress={() => onPick({ id: 'custom', label: `${POINT_LABEL[a]} · ${POINT_LABEL[b]} · ${POINT_LABEL[c]}`, a, b, c })}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
