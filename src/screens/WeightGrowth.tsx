import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { listTrackedExercises, loadFlatSets } from '../db/repo.ts';
import {
  dailyPoints, estimate1RM, EST_1RM_NOTE, filterSets, rangeFor, sameRepsTrend, seriesByIntensity, summarize,
  type Change, type DateRange, type DayPoint, type IntensityFilter, type RangeKey,
} from '../domain/stats.ts';
import { INTENSITIES, INTENSITY_LABEL, type FlatSet, type Intensity, type WeightMode } from '../domain/types.ts';
import { Card, Chip, Empty, H, IntensityBadge, NumInput, Row, Segmented, T } from '../ui/components.tsx';
import { LineChart, type ChartSeries } from '../ui/LineChart.tsx';
import { RangePicker } from '../ui/RangePicker.tsx';
import { C, GC, S } from '../ui/theme.ts';

type Tracked = Awaited<ReturnType<typeof listTrackedExercises>>[number];
type Metric = 'best' | 'avg' | 'volume';

const FILTERS: { key: IntensityFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'high', label: INTENSITY_LABEL.high },
  { key: 'mid', label: INTENSITY_LABEL.mid },
  { key: 'low', label: INTENSITY_LABEL.low },
  { key: 'none', label: INTENSITY_LABEL.none },
];

const fmtChange = (c: Change | null) =>
  c == null ? '—' : `${c.kg > 0 ? '+' : ''}${c.kg}kg${c.pct != null ? ` (${c.pct > 0 ? '+' : ''}${c.pct}%)` : ''}`;
const changeColor = (c: Change | null, mode: WeightMode) => {
  if (!c || c.kg === 0) return C.muted;
  const good = mode === 'assisted' ? c.kg < 0 : c.kg > 0;
  return good ? C.ok : C.danger;
};

export function WeightGrowth() {
  const { db, today, version } = useApp();
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [flat, setFlat] = useState<FlatSet[]>([]);
  const [exId, setExId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IntensityFilter>('all');
  const [compare, setCompare] = useState(false); // 전체 선택 시: 전체 최고 추이 vs 강도별 비교
  const [metric, setMetric] = useState<Metric>('best');
  const [warmupView, setWarmupView] = useState(false);
  const [rangeKey, setRangeKey] = useState<RangeKey>('3m');
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null });
  const [selected, setSelected] = useState<{ seriesKey: string; date: string; point: DayPoint } | null>(null);
  const [reps, setReps] = useState<number | null>(8);
  const [detail, setDetail] = useState(false); // 기본은 단순하게, '상세'에서만 고급 항목 표시

  // DB가 바뀔 때마다(version) 원본 세트 기록에서 다시 계산 → 수정/삭제가 그래프에 자동 반영
  useEffect(() => {
    (async () => {
      const t = await listTrackedExercises(db);
      setTracked(t);
      setFlat(await loadFlatSets(db));
      setExId((cur) => (cur && t.some((x) => x.id === cur) ? cur : t[0]?.id ?? null));
    })();
  }, [db, version]);

  const ex = tracked.find((t) => t.id === exId) ?? null;
  const mode: WeightMode = ex?.weight_mode ?? 'weighted';
  const range = useMemo(() => rangeFor(rangeKey, today, custom), [rangeKey, today, custom]);

  const series: ChartSeries<DayPoint>[] = useMemo(() => {
    if (!ex) return [];
    const val = (p: DayPoint) => (metric === 'best' ? p.best : metric === 'avg' ? Math.round(p.avg * 100) / 100 : p.volume);
    const toSeries = (key: string, label: string, color: string, pts: DayPoint[]): ChartSeries<DayPoint> => ({
      key, label, color, points: pts.map((p) => ({ date: p.date, value: val(p), meta: p })),
    });
    if (filter === 'all' && compare && !warmupView) {
      const by = seriesByIntensity(flat, ex.id, mode, range);
      return (['high', 'mid', 'low'] as Intensity[]).map((i) => toSeries(i, INTENSITY_LABEL[i], GC[i as 'high' | 'mid' | 'low'], by[i]));
    }
    const pts = dailyPoints(filterSets(flat, { exerciseId: ex.id, intensity: filter, range, onlyWarmup: warmupView }), mode);
    const label = (filter === 'all' ? '전체 최고' : INTENSITY_LABEL[filter]) + (warmupView ? ' (준비 세트)' : '');
    return [toSeries(filter, label, filter === 'high' || filter === 'mid' || filter === 'low' ? GC[filter] : GC.all, pts)];
  }, [flat, ex, filter, compare, metric, warmupView, range, mode]);

  const summary = useMemo(
    () => (ex ? summarize(flat, ex.id, mode, { intensity: filter, range }) : null),
    [flat, ex, mode, filter, range],
  );
  const tableRows = useMemo(
    () => (ex ? dailyPoints(filterSets(flat, { exerciseId: ex.id, intensity: filter, range, onlyWarmup: warmupView }), mode).reverse() : []),
    [flat, ex, filter, range, warmupView, mode],
  );
  const sameReps = useMemo(
    () => (ex && reps ? sameRepsTrend(flat, ex.id, reps, mode, filter).slice(-8).reverse() : []),
    [flat, ex, reps, mode, filter],
  );

  if (!ex) {
    return <Empty text={'아직 완료한 운동 기록이 없습니다.\n운동을 기록하고 완료하면 종목별 성장 그래프가 자동으로 만들어집니다.'} />;
  }

  const best = summary?.currentBest;
  const est = best ? estimate1RM(best.best, best.bestReps, mode) : null;

  const rangeLabel = RANGE_LABEL[rangeKey];

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: S.sm, paddingBottom: 60 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: S.md }}>
        {tracked.map((t) => (
          <Chip key={t.id} label={t.name} active={t.id === exId} onPress={() => { setExId(t.id); setSelected(null); }} />
        ))}
      </ScrollView>

      <Row style={{ flexWrap: 'wrap', marginBottom: S.sm }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => { setFilter(f.key); setSelected(null); }} />
        ))}
      </Row>

      {filter === 'all' && !warmupView && (
        <View style={{ marginBottom: S.sm }}>
          <Segmented
            options={[{ key: 'single', label: '전체 최고 중량' }, { key: 'compare', label: '강도별 비교' }]}
            value={compare ? 'compare' : 'single'}
            onChange={(k) => { setCompare(k === 'compare'); setSelected(null); }}
          />
        </View>
      )}

      <Card>
        <LineChart
          series={series}
          unit={metric === 'volume' ? 'kg·회' : 'kg'}
          invert={mode === 'assisted' && metric !== 'volume'}
          selected={selected}
          onSelect={(key, p) => setSelected({ seriesKey: key, date: p.date, point: p.meta as DayPoint })}
        />
      </Card>

      {selected && (
        <Card style={{ borderColor: C.accent }}>
          <Row style={{ marginBottom: 6 }}>
            <T bold style={{ flex: 1 }}>{selected.date} · {ex.name}</T>
            <IntensityBadge value={selected.point.bestIntensity} />
          </Row>
          <T>
            {selected.point.best}kg × {selected.point.bestReps ?? '-'}회 · {selected.point.bestSetNo}세트 ·{' '}
            {selected.point.bestSetType === 'warmup' ? '준비 세트' : '본 세트'}
          </T>
          <T muted style={{ marginTop: 4 }}>
            평균 {Math.round(selected.point.avg * 100) / 100}kg · 볼륨 {Math.round(selected.point.volume)} · {selected.point.setCount}세트
          </T>
        </Card>
      )}

      {summary && (
        <Card>
          <Kv k="현재 최고" v={best ? `${best.best}kg × ${best.bestReps ?? '-'}회` : '—'} />
          <Kv k="역대 최고" v={summary.allTimeBest ? `${summary.allTimeBest.best}kg × ${summary.allTimeBest.bestReps ?? '-'}회` : '—'} />
          <Kv k="직전 대비" v={fmtChange(summary.vsPrevious)} color={changeColor(summary.vsPrevious, mode)} />
          <Kv k="최초 대비" v={fmtChange(summary.vsFirst)} color={changeColor(summary.vsFirst, mode)} />
          {mode === 'assisted' && <T muted style={{ marginTop: 6, fontSize: 12 }}>보조 중량은 낮을수록 좋은 기록입니다.</T>}
        </Card>
      )}

      <Pressable onPress={() => setDetail((v) => !v)} style={{ paddingVertical: S.md, alignItems: 'center' }}>
        <T muted>{detail ? '상세 접기 ▴' : `상세 보기 ▾  ·  기간 ${rangeLabel}`}</T>
      </Pressable>

      {detail && summary && (
        <>
          <RangePicker value={rangeKey} onChange={setRangeKey} custom={custom} onCustom={setCustom} />
          <Row style={{ marginTop: S.md, marginBottom: S.md }}>
            <Chip label="최고" active={metric === 'best'} onPress={() => setMetric('best')} />
            <Chip label="평균" active={metric === 'avg'} onPress={() => setMetric('avg')} />
            <Chip label="볼륨" active={metric === 'volume'} onPress={() => setMetric('volume')} />
            <View style={{ flex: 1 }} />
            <Chip label="준비 세트" active={warmupView} onPress={() => { setWarmupView((v) => !v); setSelected(null); }} />
          </Row>

          <Card>
            <Kv k="선택 기간 최고" v={summary.rangeBest != null ? `${summary.rangeBest}kg` : '—'} />
            <Kv k="선택 기간 평균" v={summary.rangeAvg != null ? `${summary.rangeAvg}kg` : '—'} />
            <T muted style={{ marginTop: S.sm, marginBottom: 4, fontSize: 12 }}>강도별 최고 기록</T>
            <Row style={{ flexWrap: 'wrap', gap: 14 }}>
              {INTENSITIES.map((i) => (
                <View key={i}>
                  <T muted style={{ fontSize: 12 }}>{INTENSITY_LABEL[i]}</T>
                  <T bold>{summary.bestByIntensity[i] != null ? `${summary.bestByIntensity[i]}kg` : '—'}</T>
                </View>
              ))}
            </Row>
            {est != null && (
              <View style={{ marginTop: S.md }}>
                <T bold>추정 1RM {est}kg <T muted style={{ fontSize: 12 }}>(실측 아님)</T></T>
                <T muted style={{ fontSize: 11, marginTop: 2 }}>{EST_1RM_NOTE}</T>
              </View>
            )}
          </Card>

          <Card>
            <H style={{ fontSize: 15, marginBottom: 4 }}>동일 반복 횟수에서의 중량</H>
            <Row style={{ marginVertical: S.sm }}>
              <NumInput value={reps} onCommit={setReps} decimal={false} width={64} placeholder="회" />
              <T muted>회 이상 수행한 날의 최고 중량</T>
            </Row>
            {sameReps.length === 0 ? <T muted>해당 기록이 없습니다.</T> : sameReps.map((r) => (
              <Row key={r.date} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
                <T muted>{r.date}</T><T bold>{r.weight}kg</T>
              </Row>
            ))}
          </Card>

          <Card>
            <H style={{ fontSize: 15, marginBottom: S.sm }}>날짜별 기록</H>
            {tableRows.length === 0 ? <T muted>선택한 조건의 기록이 없습니다.</T> : tableRows.slice(0, 30).map((p) => (
              <View key={p.date} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Row>
                  <T muted style={{ width: 92 }}>{p.date}</T>
                  <T bold style={{ flex: 1 }}>{p.best}kg × {p.bestReps ?? '-'}회</T>
                  <IntensityBadge value={p.bestIntensity} />
                </Row>
                <T muted style={{ fontSize: 11, marginLeft: 100 }}>평균 {Math.round(p.avg * 10) / 10}kg · 볼륨 {Math.round(p.volume)} · {p.setCount}세트</T>
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const RANGE_LABEL: Record<RangeKey, string> = {
  '7d': '7일', '30d': '30일', '3m': '3개월', '6m': '6개월', '1y': '1년', all: '전체', custom: '직접 지정',
};

function Kv({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <T muted style={{ flex: 1 }}>{k}</T>
      <T bold style={{ color: color ?? C.text, textAlign: 'right', flexShrink: 1 }}>{v}</T>
    </Row>
  );
}
