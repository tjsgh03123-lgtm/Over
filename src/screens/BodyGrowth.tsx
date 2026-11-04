import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  deleteMeasurement, getBodyExtra, getBodyMetrics, listMeasurements, updateBodyMetric, type Measurement,
} from '../db/repo.ts';
import { visibleMetrics, type BodyMetric, type BuiltinKey, type ExtraValues } from '../domain/bodyMetrics.ts';
import { change, rangeFor, type Change, type DateRange, type RangeKey } from '../domain/stats.ts';
import { GRAPH_PRESETS, type GraphKey } from '../domain/themeModel.ts';
import { Btn, Card, Chip, Empty, H, Row, T } from '../ui/components.tsx';
import { LineChart, type ChartSeries } from '../ui/LineChart.tsx';
import { RangePicker } from '../ui/RangePicker.tsx';
import { C, GC, S } from '../ui/theme.ts';

const fmt = (c: Change | null, unit: string) =>
  c == null ? '—' : `${c.kg > 0 ? '+' : ''}${c.kg}${unit}${c.pct != null ? ` (${c.pct > 0 ? '+' : ''}${c.pct}%)` : ''}`;

export function BodyGrowth() {
  const { db, today, version, nav, bump, theme } = useApp();
  const [rows, setRows] = useState<Measurement[]>([]);
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [extra, setExtra] = useState<ExtraValues>({});
  const [key, setKey] = useState<string>('weight');
  const [rangeKey, setRangeKey] = useState<RangeKey>('6m');
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null });
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setRows(await listMeasurements(db));
      setMetrics(await getBodyMetrics(db));
      setExtra(await getBodyExtra(db));
    })();
  }, [db, version]);

  const shown = visibleMetrics(metrics);
  const m = shown.find((x) => x.key === key) ?? shown[0] ?? null;
  const range = rangeFor(rangeKey, today, custom);

  /** 항목의 (날짜, 값) 목록 — 기본 항목은 측정 행에서, 직접 만든 항목은 따로 저장한 값에서 */
  const valueOf = (mm: BodyMetric, r: Measurement): number | null =>
    mm.builtin ? (r[mm.key as BuiltinKey] ?? null) : (extra[mm.key]?.[r.date] ?? null);

  const all = useMemo(
    () => (m ? rows.flatMap((r) => { const v = valueOf(m, r); return v == null ? [] : [{ date: r.date, value: v }]; }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, m, extra],
  );
  // 측정한 날짜만 사용: 값이 없는 날짜에는 지점을 만들지 않는다
  const points = all.filter((p) => (!range.from || p.date >= range.from) && (!range.to || p.date <= range.to));

  const color = m ? (m.builtin ? GC[m.key as GraphKey] : m.color ?? GC.all) : GC.all;
  const series: ChartSeries[] = m ? [{ key: m.key, label: m.label, color, points }] : [];
  const last = all.length ? all[all.length - 1] : null;
  const prev = all.length > 1 ? all[all.length - 2] : null;
  const first = all.length ? all[0] : null;
  const selRow = sel ? rows.find((r) => r.date === sel) : null;
  const unit = m?.unit ?? '';

  const pickColor = async (hex: string) => {
    if (!m) return;
    if (m.builtin) theme.setGraphColor(m.key as GraphKey, hex);
    else { await updateBodyMetric(db, m.key, { color: hex }); bump(); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: S.sm, paddingBottom: 60 }}>
      <Btn label="+ 인바디 · 신체 기록 추가" onPress={nav.openBody} style={{ marginBottom: S.md }} />
      {shown.length === 0 ? (
        <Empty text={'보이는 항목이 없어요.\n기록 추가 화면의 ‘항목 관리’에서 항목을 추가하거나 다시 보이게 하세요.'} />
      ) : m && (
        <>
          <Row style={{ flexWrap: 'wrap', marginBottom: S.sm }}>
            {shown.map((x) => (
              <Chip key={x.key} label={x.label} active={m.key === x.key} onPress={() => { setKey(x.key); setSel(null); }} />
            ))}
          </Row>
          <RangePicker value={rangeKey} onChange={setRangeKey} custom={custom} onCustom={setCustom} />

          <Card style={{ marginTop: S.md }}>
            {all.length === 0 ? (
              <Empty text={`아직 ${m.label} 기록이 없습니다. 기록 추가에서 숫자로 입력하세요.`} />
            ) : (
              <LineChart series={series} unit={unit} selected={sel ? { seriesKey: m.key, date: sel } : null} onSelect={(_, p) => setSel(p.date)} />
            )}
            <Row style={{ flexWrap: 'wrap', gap: 10, marginTop: S.md }}>
              <T muted style={{ fontSize: 12 }}>그래프 색</T>
              {GRAPH_PRESETS.map((p) => (
                <Pressable
                  key={p.hex} onPress={() => pickColor(p.hex)} accessibilityLabel={`${m.label} ${p.name}`}
                  style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: p.hex, borderWidth: color.toUpperCase() === p.hex ? 3 : 0, borderColor: C.text }}
                />
              ))}
            </Row>
          </Card>

          {selRow && (
            <Card style={{ borderColor: C.accent }}>
              <T bold>{selRow.date}</T>
              <T muted style={{ marginTop: 4 }}>
                {shown.map((x) => `${x.label} ${valueOf(x, selRow) ?? '—'}${x.unit}`).join(' · ')}
              </T>
            </Card>
          )}

          {last && (
            <Card>
              <H style={{ fontSize: 16, marginBottom: S.sm }}>{m.label} 변화</H>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <T muted>최근 ({last.date})</T><T bold>{last.value}{unit}</T>
              </Row>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <T muted>이전 기록 대비</T><T bold>{fmt(prev ? change(last.value, prev.value) : null, unit)}</T>
              </Row>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <T muted>최초 기록 대비</T><T bold>{fmt(first && all.length > 1 ? change(last.value, first.value) : null, unit)}</T>
              </Row>
            </Card>
          )}
        </>
      )}

      <H style={{ fontSize: 16, marginVertical: S.sm }}>기록 목록</H>
      {rows.length === 0 ? <T muted>기록 없음</T> : [...rows].reverse().slice(0, 40).map((r) => (
        <Card key={r.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <T bold>{r.date}</T>
              <T muted style={{ fontSize: 12 }}>
                {shown.map((x) => `${x.label} ${valueOf(x, r) ?? '—'}${x.unit}`).join(' · ')}
              </T>
            </View>
            <Btn
              label="삭제" kind="danger" small
              onPress={() => Alert.alert('기록 삭제', `${r.date} 신체 기록을 삭제할까요?`, [
                { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteMeasurement(db, r.id); bump(); } },
              ])}
            />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}
