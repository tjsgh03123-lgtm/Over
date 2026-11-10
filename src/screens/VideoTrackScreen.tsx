import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { VideoView } from 'expo-video';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useApp } from '../app/context.tsx';
import {
  countSwings, fitRect, lastSeenMs, mergeTrack, pathStats, pointAt, simplifyPath, smoothPath, tiltFromVertical, toNorm, toScreen,
  trackFromNative, validPoints, type P, type Track,
} from '../domain/trackMath.ts';
import {
  getVideoInfo, isCancelled, startTracking, trackerAvailable, type TrackJob, type VideoInfo,
} from '../services/videoTrackNative.ts';
import { Btn, Card, Header, Segmented, T } from '../ui/components.tsx';
import { MultiSlider } from '../ui/MultiSlider.tsx';
import { C, GC, S } from '../ui/theme.ts';
import { useVideoClock } from '../ui/useVideoClock.ts';

const COLORS = () => [GC.all, GC.body_fat_mass];
const MIN_SPAN_MS = 300;

function fmtT(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * 영상 점 추적: 영상 고르기 → 멈춘 화면에서 따라갈 곳 누르기(점 1개, 또는 2개로 선) → 구간 정하기 → 그 점(들)만 따라가 궤적을 그린다.
 * 사람 전체를 분석하지 않고, 찍은 곳 주변의 작은 조각만 프레임마다 찾으므로 가볍다. 영상은 폰 안에서만 처리된다.
 */
export function VideoTrackScreen() {
  const { nav } = useApp();
  const { width: winW, height: winH } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'1' | '2'>('1');
  const [anchors, setAnchors] = useState<P[]>([]);
  const [anchorMs, setAnchorMs] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const [tracks, setTracks] = useState<(Track | null)[]>([null, null]);
  const [lost, setLost] = useState<number[]>([-1, -1]);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const job = useRef<TrackJob | null>(null);

  const dur = info?.durationMs ?? 0;
  const clock = useVideoClock(uri, { startMs: 0, endMs: Math.max(1, dur) });
  const time = clock.time;
  const running = prog !== null;
  const hasResult = tracks.some((t) => t);
  const count = mode === '1' ? 1 : 2;

  useEffect(() => () => job.current?.cancel(), []);

  const boxW = winW - S.lg * 2;
  const aspect = info && info.height > 0 ? info.width / info.height : 16 / 9;
  const boxH = Math.min(boxW / aspect, winH * 0.5);
  const rect = useMemo(() => fitRect(boxW, boxH, info?.width ?? 16, info?.height ?? 9), [boxW, boxH, info]);

  const reset = () => { setAnchors([]); setTracks([null, null]); setLost([-1, -1]); };

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
    setTracks([null, null]); setLost([-1, -1]);
    run(anchors.map((a) => a.x), anchors.map((a) => a.y), anchorMs, anchors.map((_, i) => i));
  };

  const onTap = (px: number, py: number) => {
    if (running || !uri) return;
    if (clock.playing) { clock.pause(); return; }
    const n = toNorm(px, py, rect);
    if (!n) return;
    if (hasResult) {
      // 결과가 있으면: 눌러서 고치기 — 놓친(또는 가장 가까운) 점을 이 시각의 이 위치로 옮기고, 거기서부터 다시 추적
      if (time < anchorMs - 1 || time >= endMs - 1) { Alert.alert('추적 구간 안에서 눌러 주세요', `${fmtT(anchorMs)} ~ ${fmtT(endMs)}`); return; }
      let idx = 0;
      if (count === 2) {
        const d = [0, 1].map((k) => {
          const p = pointAt(tracks[k], time);
          return p === null ? -1 : Math.hypot((p.x - n.x) * aspect, p.y - n.y);
        });
        idx = d[0] < 0 ? 0 : d[1] < 0 ? 1 : d[0] <= d[1] ? 0 : 1;
      }
      run([n.x], [n.y], time, [idx]);
      return;
    }
    // 처음 점 찍기: 모든 점은 같은 화면(시각)에서 찍는다
    let base = anchors;
    if (Math.abs(time - anchorMs) > 1 || !anchors.length) {
      base = [];
      setAnchorMs(time);
      setEndMs(Math.min(dur, time + 15000));
    }
    if (base.length < count) setAnchors([...base, n]);
    else {
      const k = Math.hypot((base[0].x - n.x) * aspect, base[0].y - n.y) <= Math.hypot((base[1].x - n.x) * aspect, base[1].y - n.y) ? 0 : 1;
      setAnchors(base.map((a, i) => (i === k ? n : a)));
    }
  };

  const setEnd = () => {
    if (time - anchorMs < MIN_SPAN_MS) { Alert.alert('시작 지점보다 뒤로 옮겨 주세요'); return; }
    setEndMs(time);
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
  const trails = tracks.slice(0, count).map((t) => {
    if (!t) return [] as P[][];
    const sm = smoothPath(t.pts, 5);
    const runs: P[][] = [];
    let cur: P[] = [];
    for (const p of sm) {
      if (p) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs.map((r) => simplifyPath(r, 0.003));
  });
  const nowPts: (P | null)[] = hasResult ? tracks.slice(0, count).map((t) => pointAt(t, time)) : anchors.map((a) => a);

  // ---- 숫자 ----
  const stats = tracks.slice(0, count).map((t) => {
    const v = validPoints(t);
    const st = pathStats(v, aspect);
    return st ? { ...st, reps: countSwings(v.map((p) => p.y)) } : null;
  });
  let tilt: { min: number; max: number; now: number | null } | null = null;
  if (count === 2 && tracks[0] && tracks[1]) {
    const arr: number[] = [];
    tracks[0].times.forEach((t, i) => {
      const a = tracks[0]!.pts[i], b = pointAt(tracks[1], t, 40);
      if (a && b) arr.push(tiltFromVertical(a, b, aspect));
    });
    const a0 = nowPts[0], a1 = nowPts[1];
    if (arr.length) tilt = { min: Math.min(...arr), max: Math.max(...arr), now: a0 && a1 ? tiltFromVertical(a0, a1, aspect) : null };
  }

  const placed = anchors.length;
  const canRun = !running && !hasResult && placed === count && endMs - anchorMs >= MIN_SPAN_MS;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="영상 궤적" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 48 }}>
        {!uri || !info ? (
          <Card>
            <T bold>영상에서 한 곳만 따라가 궤적을 그려요</T>
            <T muted style={{ marginTop: 6, fontSize: 13 }}>
              영상을 고르고, 멈춘 화면에서 따라갈 곳(바벨 끝, 손목 등)을 누르면 그 점의 움직임만 선으로 보여줘요. 점 2개를 찍으면 두 점을 잇는 선이 됩니다. 영상은 폰 안에서만 처리돼요.
            </T>
            <View style={{ marginTop: 14 }}>
              <Btn label={busy ? '여는 중…' : '영상 고르기'} onPress={pick} disabled={busy} />
            </View>
          </Card>
        ) : (
          <>
            <Pressable
              onPress={(e) => onTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
              style={{ width: boxW, height: boxH, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' }}
            >
              <VideoView player={clock.player} nativeControls={false} contentFit="contain" style={{ width: boxW, height: boxH }} pointerEvents="none" />
              <Svg width={boxW} height={boxH} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                {trails.map((runs, k) => runs.map((r, ri) => (
                  <Polyline
                    key={`${k}_${ri}`} fill="none" stroke={colors[k]} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"
                    points={r.map((p) => { const s = toPx(p); return `${s.x},${s.y}`; }).join(' ')}
                  />
                )))}
                {count === 2 && nowPts[0] && nowPts[1] ? (
                  <Line x1={toPx(nowPts[0]).x} y1={toPx(nowPts[0]).y} x2={toPx(nowPts[1]).x} y2={toPx(nowPts[1]).y} stroke="#fff" strokeWidth={2} strokeDasharray="6,4" />
                ) : null}
                {nowPts.map((p, k) => (p ? (
                  <Circle key={`d${k}`} cx={toPx(p).x} cy={toPx(p).y} r={7} fill="none" stroke={colors[k]} strokeWidth={3} />
                ) : null))}
              </Svg>
              {running ? (
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8 }}>
                  <T style={{ color: '#fff', fontSize: 12 }}>따라가는 중… {Math.round(((prog?.done ?? 0) / Math.max(1, prog?.total ?? 1)) * 100)}%</T>
                </View>
              ) : null}
            </Pressable>

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
                  <Segmented options={[{ key: '1', label: '점 1개' }, { key: '2', label: '점 2개 (선)' }]} value={mode} onChange={(k) => { if (!running) { setMode(k); setAnchors([]); } }} />
                  <T style={{ marginTop: 10, fontSize: 13 }}>
                    {placed < count
                      ? `① 시작할 장면에서 멈추고, 영상 위 따라갈 곳을 누르세요 (${placed}/${count})`
                      : '② 끝낼 장면에서 멈추고 [여기까지]를 누른 뒤 [추적 시작]'}
                  </T>
                  {placed > 0 ? (
                    <T muted style={{ marginTop: 4, fontSize: 12 }}>구간 {fmtT(anchorMs)} ~ {fmtT(endMs)} ({((endMs - anchorMs) / 1000).toFixed(1)}초)</T>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Btn label="여기까지" kind="ghost" small onPress={setEnd} disabled={placed === 0 || running} style={{ flex: 1 }} />
                    <Btn label="점 지우기" kind="ghost" small onPress={() => setAnchors([])} disabled={placed === 0 || running} style={{ flex: 1 }} />
                  </View>
                  <View style={{ marginTop: 10 }}>
                    <Btn label="추적 시작" onPress={start} disabled={!canRun} />
                  </View>
                </>
              ) : (
                <>
                  <T bold>궤적 {fmtT(anchorMs)} ~ {fmtT(endMs)}</T>
                  {stats.map((s, k) => (s ? (
                    <T key={k} style={{ marginTop: 6, fontSize: 13 }}>
                      {count === 2 ? `점 ${k + 1}  ` : ''}위아래 {s.verticalPct}% · 좌우 흔들림 {s.horizontalPct}% · 왕복 약 {s.reps}회
                    </T>
                  ) : null))}
                  {tilt ? (
                    <T style={{ marginTop: 6, fontSize: 13 }}>
                      선 기울기(수직 기준) {tilt.min}°~{tilt.max}°{tilt.now != null ? ` · 지금 ${tilt.now}°` : ''}
                    </T>
                  ) : null}
                  <T muted style={{ marginTop: 6, fontSize: 11 }}>% = 영상 높이 대비. 카메라가 흔들리거나 각도가 다르면 실제와 다를 수 있어요.</T>
                  {lostIdx >= 0 && !running ? (
                    <View style={{ marginTop: 10 }}>
                      <T style={{ fontSize: 13 }}>
                        {count === 2 ? `점 ${lostIdx + 1}을 ` : '점을 '}{fmtT(lost[lostIdx])}에서 놓쳤어요. 그 장면에서 점을 다시 누르면 거기서부터 이어서 따라가요.
                      </T>
                      <View style={{ marginTop: 8 }}><Btn label="놓친 장면으로 이동" kind="ghost" small onPress={goLost} /></View>
                    </View>
                  ) : (
                    <T muted style={{ marginTop: 6, fontSize: 12 }}>선이 어긋난 곳이 있으면 그 장면으로 가서 점을 다시 눌러 고칠 수 있어요.</T>
                  )}
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
