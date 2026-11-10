import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { VideoView } from 'expo-video';
import Svg, { Circle, Line, Path, Polyline } from 'react-native-svg';
import { useApp } from '../app/context.tsx';
import {
  countSwings, fitRect, lastSeenMs, lineSamples, mergeTrack, pathLengthPct, pathStats, pointAt, rangeOf, sampleAt, simplifyPath,
  smoothPath, toNorm, toScreen, trackFromNative, validPoints, type LineSample, type P, type Track,
} from '../domain/trackMath.ts';
import {
  getVideoInfo, isCancelled, startTracking, trackerAvailable, type TrackJob, type VideoInfo,
} from '../services/videoTrackNative.ts';
import { Btn, Card, Header, Segmented, T } from '../ui/components.tsx';
import { MultiSlider } from '../ui/MultiSlider.tsx';
import { C, GC, S } from '../ui/theme.ts';
import { useVideoClock } from '../ui/useVideoClock.ts';

type Tool = 'point' | 'line' | 'arc';
const COUNT: Record<Tool, number> = { point: 1, line: 2, arc: 3 };
const HINT: Record<Tool, string[]> = {
  point: ['따라갈 곳'],
  line: ['선의 한쪽 끝', '선의 반대쪽 끝'],
  arc: ['호의 한쪽 끝', '호의 가운데', '호의 반대쪽 끝'],
};
const COLORS = () => [GC.all, GC.body_fat_mass, GC.skeletal_muscle];
const MIN_SPAN_MS = 300;

function fmtT(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
const f1 = (v: number | undefined | null) => (v == null ? '-' : String(Math.round(v * 10) / 10));

/**
 * 영상 점 추적: 영상 고르기 → 멈춘 화면에서 점 1개 / 선(점 2개) / 호(점 3개)를 찍기 → 구간 정하기 → 그 점들만 따라가며 수치를 잰다.
 * 결과는 숫자만 보여 준다(해석·피드백 없음). 영상은 폰 안에서만 처리된다.
 */
export function VideoTrackScreen() {
  const { nav } = useApp();
  const { width: winW, height: winH } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<Tool>('point');
  const [anchors, setAnchors] = useState<P[]>([]);
  const [anchorMs, setAnchorMs] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const [tracks, setTracks] = useState<(Track | null)[]>([null, null, null]);
  const [lost, setLost] = useState<number[]>([-1, -1, -1]);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [tapMsg, setTapMsg] = useState<string>('');
  const job = useRef<TrackJob | null>(null);

  const dur = info?.durationMs ?? 0;
  const clock = useVideoClock(uri, { startMs: 0, endMs: Math.max(1, dur) });
  const time = clock.time;
  const running = prog !== null;
  const hasResult = tracks.some((t) => t);
  const count = COUNT[tool];

  useEffect(() => () => job.current?.cancel(), []);

  const boxW = winW - S.lg * 2;
  const aspect = info && info.height > 0 ? info.width / info.height : 16 / 9;
  const boxH = Math.min(boxW / aspect, winH * 0.5);
  const rect = useMemo(() => fitRect(boxW, boxH, info?.width ?? 16, info?.height ?? 9), [boxW, boxH, info]);

  const reset = () => { setAnchors([]); setTracks([null, null, null]); setLost([-1, -1, -1]); setTapMsg(''); };

  const pick = async () => {
    setBusy(true);
    try {
      if (!trackerAvailable()) throw new Error('영상 점 추적은 안드로이드 앱에서만 동작합니다');
      const r = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: false });
      if (r.canceled || !r.assets?.length) return;
      const u = r.assets[0].uri;
      const i = await getVideoInfo(u);
      if (!i.durationMs || !i.width || !i.height) throw new Error('영상 정보를 읽을 수 없습니다');
      clock.pause();
      reset();
      setInfo(i); setUri(u); setEndMs(i.durationMs); setAnchorMs(0);
    } catch (e) {
      Alert.alert('영상을 열 수 없습니다', String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (xs: number[], ys: number[], startMs: number, which: number[]) => {
    if (!uri) return;
    const j = startTracking(uri, { startMs, endMs, xs, ys }, (done, total) => setProg({ done, total }));
    job.current = j;
    setProg({ done: 0, total: 1 });
    try {
      const rep = await j.promise;
      setTracks((prev) => {
        const next = prev.slice();
        rep.tracks.forEach((nt, k) => { const idx = which[k]; next[idx] = mergeTrack(prev[idx], trackFromNative(rep.times, nt.xs, nt.ys)); });
        return next;
      });
      setLost((prev) => {
        const next = prev.slice();
        rep.tracks.forEach((nt, k) => { next[which[k]] = nt.lostAtMs; });
        return next;
      });
    } catch (e) {
      if (!isCancelled(e)) Alert.alert('추적하지 못했습니다', String((e as Error)?.message ?? e));
    } finally {
      job.current = null;
      setProg(null);
    }
  };

  const start = () => {
    if (anchors.length !== count) return;
    setTracks([null, null, null]); setLost([-1, -1, -1]);
    run(anchors.map((a) => a.x), anchors.map((a) => a.y), anchorMs, anchors.map((_, i) => i));
  };

  /** 영상 위를 눌렀을 때. 어떤 경우든 화면에 이유가 보이도록 tapMsg를 남긴다 */
  const onTap = (px: number, py: number) => {
    if (!uri) return;
    if (running) { setTapMsg('추적 중에는 점을 찍을 수 없어요'); return; }
    if (clock.playing) { clock.pause(); setTapMsg('재생을 멈췄어요. 다시 눌러 점을 찍으세요'); return; }
    const n = toNorm(px, py, rect);
    if (!n) { setTapMsg('영상 밖(검은 여백)을 눌렀어요'); return; }
    const where = `가로 ${Math.round(n.x * 100)}% · 세로 ${Math.round(n.y * 100)}%`;
    if (hasResult) {
      // 결과가 있으면: 눌러서 고치기 — 놓친(또는 가장 가까운) 점을 이 시각의 이 위치로 옮기고 거기서부터 다시 추적
      if (time < anchorMs - 1 || time >= endMs - 1) { setTapMsg(`추적 구간(${fmtT(anchorMs)} ~ ${fmtT(endMs)}) 안에서 눌러 주세요`); return; }
      let idx = 0;
      if (count > 1) {
        const d = Array.from({ length: count }, (_, k) => {
          const p = pointAt(tracks[k], time);
          return p === null ? -1 : Math.hypot((p.x - n.x) * aspect, p.y - n.y);
        });
        const lostK = d.findIndex((v) => v < 0);
        idx = lostK >= 0 ? lostK : d.indexOf(Math.min(...d));
      }
      setTapMsg(`점 ${idx + 1}을 ${where}으로 고쳐서 다시 따라가요`);
      run([n.x], [n.y], time, [idx]);
      return;
    }
    // 처음 점 찍기: 모든 점은 같은 장면(시각)에서 찍는다
    let base = anchors;
    if (Math.abs(time - anchorMs) > 1 || !anchors.length) {
      base = [];
      setAnchorMs(time);
      setEndMs(Math.min(dur, time + 15000));
    }
    if (base.length < count) {
      setAnchors([...base, n]);
      setTapMsg(`점 ${base.length + 1}/${count} 찍음 (${HINT[tool][base.length]}) · ${where} · ${fmtT(time)}`);
    } else {
      let k = 0, bd = Infinity;
      base.forEach((a, i) => { const d = Math.hypot((a.x - n.x) * aspect, a.y - n.y); if (d < bd) { bd = d; k = i; } });
      setAnchors(base.map((a, i) => (i === k ? n : a)));
      setTapMsg(`점 ${k + 1}을 옮겼어요 · ${where}`);
    }
  };

  const setEnd = () => {
    if (time - anchorMs < MIN_SPAN_MS) { setTapMsg('시작 장면보다 뒤로 옮긴 뒤 눌러 주세요'); return; }
    setEndMs(time);
    setTapMsg(`끝 장면을 ${fmtT(time)}로 정했어요`);
  };

  const lostIdx = lost.findIndex((l, i) => i < count && l >= 0 && tracks[i]);
  const goLost = () => {
    const l = lost[lostIdx];
    const seen = lastSeenMs(tracks[lostIdx]);
    clock.pause();
    clock.seek(seen >= 0 ? seen : l);
  };

  // ---- 그리기 ----
  const colors = COLORS();
  const toPx = (p: P) => toScreen(p, rect);
  const trails = tool === 'point' && tracks[0] ? (() => {
    const sm = smoothPath(tracks[0]!.pts, 5);
    const runs: P[][] = [];
    let cur: P[] = [];
    for (const p of sm) {
      if (p) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs.map((r) => simplifyPath(r, 0.003));
  })() : [];
  const nowPts: (P | null)[] = hasResult ? tracks.slice(0, count).map((t) => pointAt(t, time)) : anchors.map((a) => a);
  const shape = nowPts.length === count && nowPts.every(Boolean) && count >= 2 ? (nowPts as P[]).map(toPx) : null;

  // ---- 숫자 ----
  const pv = tool === 'point' ? validPoints(tracks[0]) : [];
  const pst = pathStats(pv, aspect);
  const samples: LineSample[] = tool === 'point' ? [] : lineSamples(tracks.slice(0, count), count as 2 | 3, aspect);
  const cur = sampleAt(samples, time);
  const rng = (key: 'tilt' | 'length' | 'bend' | 'arc') => rangeOf(samples.map((s) => s[key]).filter((v): v is number => v != null));

  const placed = anchors.length;
  const canRun = !running && !hasResult && placed === count && endMs - anchorMs >= MIN_SPAN_MS;

  const Row3 = ({ label, now, r, unit }: { label: string; now?: number | null; r: { min: number; max: number } | null; unit: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <T style={{ flex: 1.2, fontSize: 13 }}>{label}</T>
      <T bold style={{ flex: 1, fontSize: 15, textAlign: 'right' }}>{f1(now)}{unit}</T>
      <T muted style={{ flex: 1.4, fontSize: 12, textAlign: 'right' }}>{r ? `${f1(r.min)} ~ ${f1(r.max)}${unit}` : '-'}</T>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="영상 궤적" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 48 }}>
        {!uri || !info ? (
          <Card>
            <T bold>영상에서 점·선·호의 움직임을 숫자로 재요</T>
            <T muted style={{ marginTop: 6, fontSize: 13 }}>
              영상을 고르고, 멈춘 화면에서 점 1개(궤적), 점 2개(직선의 기울기·길이), 점 3개(호의 휘어짐)를 찍으면 그 점들만 따라가며 수치를 보여 줘요. 영상은 폰 안에서만 처리돼요.
            </T>
            <View style={{ marginTop: 14 }}>
              <Btn label={busy ? '여는 중…' : '영상 고르기'} onPress={pick} disabled={busy} />
            </View>
          </Card>
        ) : (
          <>
            <View style={{ width: boxW, height: boxH, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' }}>
              <VideoView player={clock.player} nativeControls={false} contentFit="contain" surfaceType="textureView" style={{ width: boxW, height: boxH }} />
              <Svg width={boxW} height={boxH} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                {trails.map((r, ri) => (
                  <Polyline
                    key={`t${ri}`} fill="none" stroke={colors[0]} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"
                    points={r.map((p) => { const s = toPx(p); return `${s.x},${s.y}`; }).join(' ')}
                  />
                ))}
                {shape && count === 2 ? (
                  <Line x1={shape[0].x} y1={shape[0].y} x2={shape[1].x} y2={shape[1].y} stroke={colors[0]} strokeWidth={3} />
                ) : null}
                {shape && count === 3 ? (
                  <Path
                    d={`M ${shape[0].x} ${shape[0].y} Q ${2 * shape[1].x - (shape[0].x + shape[2].x) / 2} ${2 * shape[1].y - (shape[0].y + shape[2].y) / 2} ${shape[2].x} ${shape[2].y}`}
                    fill="none" stroke={colors[0]} strokeWidth={3} strokeLinecap="round"
                  />
                ) : null}
                {nowPts.map((p, k) => (p ? (
                  <React.Fragment key={`d${k}`}>
                    <Circle cx={toPx(p).x} cy={toPx(p).y} r={9} fill="none" stroke="#fff" strokeWidth={2} />
                    <Line x1={toPx(p).x - 14} y1={toPx(p).y} x2={toPx(p).x + 14} y2={toPx(p).y} stroke={colors[k]} strokeWidth={2} />
                    <Line x1={toPx(p).x} y1={toPx(p).y - 14} x2={toPx(p).x} y2={toPx(p).y + 14} stroke={colors[k]} strokeWidth={2} />
                  </React.Fragment>
                ) : null))}
              </Svg>
              {nowPts.map((p, k) => (p && count > 1 ? (
                <Text key={`n${k}`} style={{ position: 'absolute', left: toPx(p).x + 10, top: toPx(p).y - 24, color: '#fff', fontWeight: '800', fontSize: 13 }}>{k + 1}</Text>
              ) : null))}
              {running ? (
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8 }}>
                  <T style={{ color: '#fff', fontSize: 12 }}>따라가는 중… {Math.round(((prog?.done ?? 0) / Math.max(1, prog?.total ?? 1)) * 100)}%</T>
                </View>
              ) : null}
              {/* 터치 전용 투명 판: 영상 위에서 누른 위치를 직접 받는다 */}
              <View
                style={{ position: 'absolute', left: 0, top: 0, width: boxW, height: boxH }}
                onStartShouldSetResponder={() => true}
                onResponderRelease={(e) => onTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
              />
            </View>
            <T muted style={{ fontSize: 12, marginTop: 6, minHeight: 16 }}>{tapMsg || '영상 위를 눌러 점을 찍으세요'}</T>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: S.sm }}>
              <Btn label={clock.playing ? '❚❚' : '▶'} small kind="ghost" onPress={() => (clock.playing ? clock.pause() : clock.play())} disabled={running} />
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                <MultiSlider values={[time]} max={dur} onChange={(v) => { if (!running) { if (clock.playing) clock.pause(); clock.seek(v[0]); } }} />
              </View>
              <T muted style={{ fontSize: 12, minWidth: 74, textAlign: 'right' }}>{fmtT(time)} / {fmtT(dur)}</T>
            </View>

            <Card style={{ marginTop: S.md }}>
              {!hasResult ? (
                <>
                  <Segmented<Tool>
                    options={[{ key: 'point', label: '점' }, { key: 'line', label: '직선' }, { key: 'arc', label: '호' }]}
                    value={tool} onChange={(k) => { if (!running) { setTool(k); setAnchors([]); setTapMsg(''); } }}
                  />
                  <T style={{ marginTop: 10, fontSize: 13 }}>
                    {placed < count
                      ? `① 시작할 장면에서 멈추고 ${HINT[tool][placed]}을(를) 누르세요 (${placed}/${count})`
                      : '② 끝낼 장면으로 옮겨 [여기까지]를 누른 뒤 [추적 시작]'}
                  </T>
                  {placed > 0 ? (
                    <T muted style={{ marginTop: 4, fontSize: 12 }}>구간 {fmtT(anchorMs)} ~ {fmtT(endMs)} ({((endMs - anchorMs) / 1000).toFixed(1)}초)</T>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Btn label="여기까지" kind="ghost" small onPress={setEnd} disabled={placed === 0 || running} style={{ flex: 1 }} />
                    <Btn label="점 지우기" kind="ghost" small onPress={() => { setAnchors([]); setTapMsg(''); }} disabled={placed === 0 || running} style={{ flex: 1 }} />
                  </View>
                  <View style={{ marginTop: 10 }}>
                    <Btn label="추적 시작" onPress={start} disabled={!canRun} />
                  </View>
                </>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
                    <T muted style={{ flex: 1.2, fontSize: 11 }}>{fmtT(anchorMs)} ~ {fmtT(endMs)}</T>
                    <T muted style={{ flex: 1, fontSize: 11, textAlign: 'right' }}>지금</T>
                    <T muted style={{ flex: 1.4, fontSize: 11, textAlign: 'right' }}>최소 ~ 최대</T>
                  </View>
                  {tool === 'point' && pst ? (
                    <>
                      <Row3 label="위아래 움직임" now={pst.verticalPct} r={null} unit="%" />
                      <Row3 label="좌우 움직임" now={pst.horizontalPct} r={null} unit="%" />
                      <Row3 label="움직인 총 거리" now={pathLengthPct(pv, aspect)} r={null} unit="%" />
                      <Row3 label="왕복 횟수(대략)" now={countSwings(pv.map((p) => p.y))} r={null} unit="회" />
                    </>
                  ) : null}
                  {tool !== 'point' ? (
                    <>
                      <Row3 label="기울기(수직 기준)" now={cur?.tilt} r={rng('tilt')} unit="°" />
                      <Row3 label="길이" now={cur?.length} r={rng('length')} unit="%" />
                      {tool === 'arc' ? (
                        <>
                          <Row3 label="휘어짐(선 길이 대비)" now={cur?.bend} r={rng('bend')} unit="%" />
                          <Row3 label="호 중심각" now={cur?.arc} r={rng('arc')} unit="°" />
                        </>
                      ) : null}
                      {!samples.length ? <T muted style={{ fontSize: 12, marginTop: 6 }}>모든 점이 잡힌 장면이 없어요</T> : null}
                    </>
                  ) : null}
                  <T muted style={{ marginTop: 6, fontSize: 11 }}>% = 영상 높이 대비 · 영상 속 2D 값</T>
                  {lostIdx >= 0 && !running ? (
                    <View style={{ marginTop: 10 }}>
                      <T style={{ fontSize: 13 }}>
                        점 {lostIdx + 1}을 {fmtT(lost[lostIdx])}에서 놓쳤어요. 그 장면에서 점을 다시 누르면 거기서부터 이어서 따라가요.
                      </T>
                      <View style={{ marginTop: 8 }}><Btn label="놓친 장면으로 이동" kind="ghost" small onPress={goLost} /></View>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Btn label="다시 찍기" kind="ghost" small onPress={() => { reset(); clock.pause(); clock.seek(anchorMs); }} disabled={running} style={{ flex: 1 }} />
                  </View>
                </>
              )}
              {running ? (
                <View style={{ marginTop: 10 }}>
                  <Btn label="취소" kind="danger" small onPress={() => job.current?.cancel()} />
                </View>
              ) : null}
            </Card>

            <View style={{ marginTop: S.sm }}>
              <Btn label="다른 영상 고르기" kind="ghost" small onPress={pick} disabled={busy || running} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
