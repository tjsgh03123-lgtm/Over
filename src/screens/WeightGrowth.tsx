import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  getTrackedIds, listRoutineExercises, listWatchedExercises, loadFlatSets, toggleTracked, setTrackedIds,
  type RoutineExercise, type TrackedExercise,
} from '../db/repo.ts';
import {
  dailyPoints, filterSets, rangeFor, repChoices, sameRepsTrend, summarize,
  type Change, type DateRange, type DayPoint, type RangeKey,
} from '../domain/stats.ts';
import type { FlatSet, WeightMode } from '../domain/types.ts';
import { Btn, Card, Chip, Empty, H, Row, Segmented, T } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { LineChart, Sparkline, type ChartSeries } from '../ui/LineChart.tsx';
import { RangePicker } from '../ui/RangePicker.tsx';
import { C, GC, S } from '../ui/theme.ts';

const fmtChange = (c: Change | null) =>
  c == null ? '—' : `${c.kg > 0 ? '+' : ''}${c.kg}kg${c.pct != null ? ` (${c.pct > 0 ? '+' : ''}${c.pct}%)` : ''}`;
const changeColor = (c: Change | null, mode: WeightMode) => {
  if (!c || c.kg === 0) return C.muted;
  const good = mode === 'assisted' ? c.kg < 0 : c.kg > 0;
  return good ? C.ok : C.danger;
};
const arrow = (c: Change | null, mode: WeightMode) => {
  if (!c || c.kg === 0) return '–';
  const up = mode === 'assisted' ? c.kg < 0 : c.kg > 0;
  return up ? '▲' : '▼';
};

/**
 * 성장 분석(운동 중량): 내 루틴에서 고른 운동만 한 줄씩 보여 주고,
 * 누르면 '평소 운동'(횟수별) / '1RM' 두 탭으로 추이를 본다.
 */
export function WeightGrowth() {
  const { db, today, version, bump } = useApp();
  const [watched, setWatched] = useState<TrackedExercise[]>([]);
  const [routineEx, setRoutineEx] = useState<RoutineExercise[]>([]);
  const [trackedIds, setIds] = useState<string[]>([]);
  const [flat, setFlat] = useState<FlatSet[]>([]);
  const [picking, setPicking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setWatched(await listWatchedExercises(db));
      setRoutineEx(await listRoutineExercises(db, today));
      setIds(await getTrackedIds(db));
      setFlat(await loadFlatSets(db));
    })();
  }, [db, today, version]);

  const open = watched.find((w) => w.id === openId) ?? null;
  if (open) return <Detail ex={open} flat={flat} today={today} onBack={() => setOpenId(null)} />;

  const extra = watched.filter((w) => !routineEx.some((r) => r.id === w.id)); // 루틴 밖에서 직접 추가한 운동

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: S.sm, paddingBottom: 60 }}>
      <Row style={{ marginBottom: S.md }}>
        <H style={{ fontSize: 16, flex: 1 }}>보는 운동 {watched.length > 0 ? `${watched.length}개` : ''}</H>
        <Btn label={picking ? '완료' : '운동 고르기'} kind={picking ? 'primary' : 'ghost'} small onPress={() => setPicking((v) => !v)} />
      </Row>

      {picking && (
        <Card>
          <T muted style={{ fontSize: 12, marginBottom: S.sm }}>
            변화를 보고 싶은 운동을 체크하세요. 여러 날에 같은 운동이 있어도 한 번만 나옵니다. 체크하지 않은 운동도 기록은 그대로 남습니다.
          </T>
          {routineEx.length === 0 ? (
            <T muted>내 루틴에 운동이 아직 없어요. 루틴 탭에서 만들거나 아래에서 직접 추가하세요.</T>
          ) : routineEx.map((e) => (
            <PickRow key={e.id} name={e.name} sub={e.routines.join(' · ')} on={trackedIds.includes(e.id)}
              onPress={async () => { await toggleTracked(db, e.id); bump(); }} />
          ))}
          {extra.map((e) => (
            <PickRow key={e.id} name={e.name} sub="직접 추가" on
              onPress={async () => { await toggleTracked(db, e.id); bump(); }} />
          ))}
          <Row style={{ marginTop: S.md }}>
            <Btn label="+ 다른 운동 추가" kind="ghost" small onPress={() => setAddOpen(true)} />
            <View style={{ flex: 1 }} />
            {trackedIds.length > 0 && (
              <Btn label="모두 해제" kind="ghost" small onPress={async () => { await setTrackedIds(db, []); bump(); }} />
            )}
          </Row>
        </Card>
      )}

      {watched.length === 0 ? (
        !picking && (
          <>
            <Empty text={'보고 싶은 운동을 골라 주세요.\n내 루틴에 있는 운동 중에서 고를 수 있어요.'} />
            <Btn label="운동 고르기" onPress={() => setPicking(true)} />
          </>
        )
      ) : (
        watched.map((w) => <ListRow key={w.id} ex={w} flat={flat} onPress={() => setOpenId(w.id)} />)
      )}

      <ExercisePicker
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onPick={async (e) => {
          setAddOpen(false);
          if (!trackedIds.includes(e.id)) await toggleTracked(db, e.id);
          bump();
        }}
      />
    </ScrollView>
  );
}

function PickRow({ name, sub, on, onPress }: { name: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? C.accent : C.muted, backgroundColor: on ? C.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
        {on && <T bold style={{ color: C.onAccent, fontSize: 13 }}>✓</T>}
      </View>
      <View style={{ flex: 1 }}>
        <T bold>{name}</T>
        {!!sub && <T muted style={{ fontSize: 11 }}>{sub}</T>}
      </View>
    </Pressable>
  );
}

/** 목록 한 줄: 운동 이름 · 현재 최고 · 직전 대비 · 작은 추이선 (평소 운동 기록 기준) */
function ListRow({ ex, flat, onPress }: { ex: TrackedExercise; flat: FlatSet[]; onPress: () => void }) {
  const mode = ex.weight_mode;
  const sm = useMemo(() => summarize(flat, ex.id, mode), [flat, ex.id, mode]);
  const pts = useMemo(() => dailyPoints(filterSets(flat, { exerciseId: ex.id }), mode).slice(-12), [flat, ex.id, mode]);
  const ch = sm.vsPrevious;
  return (
    <Pressable onPress={onPress}>
      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <T bold style={{ fontSize: 15 }}>{ex.name}</T>
            {sm.currentBest ? (
              <Row style={{ marginTop: 2, gap: 6 }}>
                <T bold>{sm.currentBest.best}kg</T>
                <T style={{ color: changeColor(ch, mode), fontSize: 12 }}>{arrow(ch, mode)} {ch ? fmtChange(ch) : '첫 기록'}</T>
              </Row>
            ) : <T muted style={{ fontSize: 12, marginTop: 2 }}>아직 완료한 기록이 없어요</T>}
          </View>
          <Sparkline values={pts.map((p) => p.best)} color={GC.all} />
          <T muted style={{ fontSize: 18 }}>›</T>
        </Row>
      </Card>
    </Pressable>
  );
}

/* ----------------------------- 종목 상세 ----------------------------- */

function Detail({ ex, flat, today, onBack }: { ex: TrackedExercise; flat: FlatSet[]; today: string; onBack: () => void }) {
  const mode = ex.weight_mode;
  const [tab, setTab] = useState<'normal' | 'rm'>('normal');
  const [rangeKey, setRangeKey] = useState<RangeKey>('3m');
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null });
  const choices = useMemo(() => repChoices(flat, ex.id), [flat, ex.id]);
  const [reps, setReps] = useState<number | null | undefined>(undefined); // undefined=아직 안 골랐음(가장 많이 한 횟수), null=전체
  const [sel, setSel] = useState<string | null>(null);
  const range = useMemo(() => rangeFor(rangeKey, today, custom), [rangeKey, today, custom]);

  const repsSel = reps === undefined ? choices.mostUsed : reps; // null이면 '전체'

  const normal = useMemo(() => {
    if (repsSel == null) {
      const pts = dailyPoints(filterSets(flat, { exerciseId: ex.id, range }), mode);
      return pts.map((p) => ({ date: p.date, value: p.best, note: `${p.best}kg × ${p.bestReps ?? '-'}회 · ${p.bestSetNo}세트 · 평균 ${Math.round(p.avg * 10) / 10}kg · ${p.setCount}세트` }));
    }
    return sameRepsTrend(flat, ex.id, repsSel, mode)
      .filter((p) => (!range.from || p.date >= range.from) && (!range.to || p.date <= range.to))
      .map((p) => ({ date: p.date, value: p.weight, note: `${repsSel}회 이상 · ${p.weight}kg` }));
  }, [flat, ex.id, mode, repsSel, range]);

  const rm = useMemo(
    () => dailyPoints(filterSets(flat, { exerciseId: ex.id, range, onlyRm: true }), mode)
      .map((p) => ({ date: p.date, value: p.best, note: `${p.best}kg${p.bestReps ? ` × ${p.bestReps}회` : ''}` })),
    [flat, ex.id, mode, range],
  );
  const rmAll = useMemo(() => dailyPoints(filterSets(flat, { exerciseId: ex.id, onlyRm: true }), mode), [flat, ex.id, mode]);

  const rows = tab === 'normal' ? normal : rm;
  const series: ChartSeries[] = [{
    key: tab, label: tab === 'rm' ? '1RM' : repsSel == null ? '최고 중량' : `${repsSel}회 이상`, color: GC.all,
    points: rows.map((r) => ({ date: r.date, value: r.value })),
  }];
  const selRow = sel ? rows.find((r) => r.date === sel) : null;

  const first = rows.length ? rows[0].value : null;
  const last = rows.length ? rows[rows.length - 1].value : null;
  const prev = rows.length > 1 ? rows[rows.length - 2].value : null;
  const delta = (a: number | null, b: number | null): Change | null =>
    a == null || b == null ? null : { kg: Math.round((a - b) * 100) / 100, pct: b === 0 ? null : Math.round(((a - b) / b) * 10000) / 100 };
  const volPts = useMemo(() => dailyPoints(filterSets(flat, { exerciseId: ex.id, range }), mode), [flat, ex.id, mode, range]);
  const lastVol = volPts.length ? Math.round(volPts[volPts.length - 1].volume) : null;
  const prevVol = volPts.length > 1 ? Math.round(volPts[volPts.length - 2].volume) : null;
  const best = rows.reduce<number | null>((b, r) => (b == null || (mode === 'assisted' ? r.value < b : r.value > b) ? r.value : b), null);

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: S.sm, paddingBottom: 60 }}>
      <Row style={{ marginBottom: S.md }}>
        <Pressable onPress={onBack} hitSlop={10}><T style={{ fontSize: 22 }}>‹</T></Pressable>
        <H style={{ fontSize: 17, flex: 1 }}>{ex.name}</H>
      </Row>

      <Segmented
        options={[{ key: 'normal', label: '평소 운동' }, { key: 'rm', label: '1RM' }]}
        value={tab}
        onChange={(k) => { setTab(k); setSel(null); }}
      />

      {tab === 'normal' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: S.md }}>
          <Chip label="전체" active={repsSel == null} onPress={() => { setReps(null); setSel(null); }} />
          {choices.options.map((r) => (
            <Chip key={r} label={`${r}회+`} active={repsSel === r} onPress={() => { setReps(r); setSel(null); }} />
          ))}
        </ScrollView>
      )}
      <View style={{ marginTop: tab === 'rm' ? S.md : 0 }}>
        <RangePicker value={rangeKey} onChange={setRangeKey} custom={custom} onCustom={setCustom} />
      </View>

      <Card style={{ marginTop: S.md }}>
        {rows.length === 0 ? (
          <Empty text={tab === 'rm'
            ? '아직 1RM 기록이 없어요.\n운동 기록에서 세트 번호를 눌러 ‘1RM’으로 바꾸면 여기에 모입니다.'
            : '이 조건에 맞는 기록이 없어요.'} />
        ) : (
          <LineChart
            series={series} unit="kg" invert={mode === 'assisted'}
            selected={sel ? { seriesKey: tab, date: sel } : null}
            onSelect={(_, p) => setSel(p.date)}
          />
        )}
      </Card>
      {tab === 'normal' && repsSel != null && (
        <T muted style={{ fontSize: 11, marginBottom: S.sm }}>‘{repsSel}회+’는 {repsSel}회 이상 한 세트 중 그날의 최고 중량입니다.</T>
      )}

      {selRow && (
        <Card style={{ borderColor: C.accent }}>
          <T bold>{selRow.date}</T>
          <T muted style={{ marginTop: 4 }}>{selRow.note}</T>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <Kv k={tab === 'rm' ? '최고 1RM' : '기간 내 최고'} v={best != null ? `${best}kg` : '—'} />
          {tab === 'rm' && rmAll.length > 0 && <Kv k="전체 기간 최고 1RM" v={`${rmAll.reduce((b, p) => Math.max(b, p.best), 0)}kg`} />}
          <Kv k="직전 대비" v={fmtChange(delta(last, prev))} color={changeColor(delta(last, prev), mode)} />
          {tab === 'normal' && lastVol != null && lastVol > 0 && (
            <Kv k="최근 볼륨" v={`${lastVol.toLocaleString()}kg${prevVol != null && prevVol > 0 ? ` (지난번 대비 ${lastVol - prevVol >= 0 ? '+' : '−'}${Math.abs(lastVol - prevVol).toLocaleString()}kg)` : ''}`} />
          )}
          <Kv k="처음 대비" v={fmtChange(rows.length > 1 ? delta(last, first) : null)} color={changeColor(rows.length > 1 ? delta(last, first) : null, mode)} />
          {mode === 'assisted' && <T muted style={{ marginTop: 6, fontSize: 12 }}>보조 중량은 낮을수록 좋은 기록입니다.</T>}
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <H style={{ fontSize: 15, marginBottom: S.sm }}>날짜별 기록</H>
          {[...rows].reverse().slice(0, 30).map((r) => (
            <Row key={r.date} style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <T muted style={{ width: 92 }}>{r.date}</T>
              <T bold style={{ flex: 1 }}>{r.value}kg</T>
            </Row>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function Kv({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <T muted style={{ flex: 1 }}>{k}</T>
      <T bold style={{ color: color ?? C.text, textAlign: 'right', flexShrink: 1 }}>{v}</T>
    </Row>
  );
}
