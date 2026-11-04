import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { deleteMeasurement, listMeasurements, type Measurement } from '../db/repo.ts';
import { change, rangeFor, type Change, type DateRange, type RangeKey } from '../domain/stats.ts';
import { Btn, Card, Chip, Empty, H, Row, T } from '../ui/components.tsx';
import { LineChart, type ChartSeries } from '../ui/LineChart.tsx';
import { RangePicker } from '../ui/RangePicker.tsx';
import { C, GC, S } from '../ui/theme.ts';

type Key = 'weight' | 'skeletal_muscle' | 'body_fat_mass' | 'body_fat_pct';
const METRICS: { key: Key; label: string; unit: string }[] = [
  { key: 'weight', label: '몸무게', unit: 'kg' },
  { key: 'skeletal_muscle', label: '골격근량', unit: 'kg' },
  { key: 'body_fat_mass', label: '체지방량', unit: 'kg' },
  { key: 'body_fat_pct', label: '체지방률', unit: '%' },
];

const fmt = (c: Change | null, unit: string) =>
  c == null ? '—' : `${c.kg > 0 ? '+' : ''}${c.kg}${unit}${c.pct != null ? ` (${c.pct > 0 ? '+' : ''}${c.pct}%)` : ''}`;

export function BodyGrowth() {
  const { db, today, version, nav, bump } = useApp();
  const [rows, setRows] = useState<Measurement[]>([]);
  const [key, setKey] = useState<Key>('weight');
  const [rangeKey, setRangeKey] = useState<RangeKey>('6m');
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null });
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => { listMeasurements(db).then(setRows); }, [db, version]);

  const m = METRICS.find((x) => x.key === key)!;
  const range = rangeFor(rangeKey, today, custom);

  // 측정한 날짜만 사용: 값이 없는(NULL) 날짜나 측정하지 않은 날짜에는 지점을 만들지 않는다
  const points = useMemo(
    () => rows
      .filter((r) => r[key] != null && (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to))
      .map((r) => ({ date: r.date, value: r[key] as number })),
    [rows, key, range.from, range.to],
  );
  const all = useMemo(() => rows.filter((r) => r[key] != null).map((r) => ({ date: r.date, value: r[key] as number })), [rows, key]);

  const series: ChartSeries[] = [{ key, label: m.label, color: GC[key], points }];
  const last = all.length ? all[all.length - 1] : null;
  const prev = all.length > 1 ? all[all.length - 2] : null;
  const first = all.length ? all[0] : null;
  const selRow = sel ? rows.find((r) => r.date === sel) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingTop: S.sm, paddingBottom: 60 }}>
      <Btn label="+ 인바디 · 신체 기록 추가" onPress={nav.openBody} style={{ marginBottom: S.md }} />
      <Row style={{ flexWrap: 'wrap', marginBottom: S.sm }}>
        {METRICS.map((x) => (
          <Chip key={x.key} label={x.label} active={key === x.key} onPress={() => { setKey(x.key); setSel(null); }} />
        ))}
      </Row>
      <RangePicker value={rangeKey} onChange={setRangeKey} custom={custom} onCustom={setCustom} />

      <Card style={{ marginTop: S.md }}>
        {all.length === 0 ? (
          <Empty text="아직 기록이 없습니다. 인바디 이미지 또는 수동 입력으로 기록하세요." />
        ) : (
          <LineChart series={series} unit={m.unit} selected={sel ? { seriesKey: key, date: sel } : null} onSelect={(_, p) => setSel(p.date)} />
        )}
      </Card>

      {selRow && (
        <Card style={{ borderColor: C.accent }}>
          <T bold>{selRow.date}</T>
          <T muted style={{ marginTop: 4 }}>
            몸무게 {selRow.weight ?? '—'}kg · 골격근량 {selRow.skeletal_muscle ?? '—'}kg · 체지방량 {selRow.body_fat_mass ?? '—'}kg · 체지방률 {selRow.body_fat_pct ?? '—'}%
          </T>
        </Card>
      )}

      {last && (
        <Card>
          <H style={{ fontSize: 16, marginBottom: S.sm }}>{m.label} 변화</H>
          <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <T muted>최근 ({last.date})</T><T bold>{last.value}{m.unit}</T>
          </Row>
          <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <T muted>이전 기록 대비</T><T bold>{fmt(prev ? change(last.value, prev.value) : null, m.unit)}</T>
          </Row>
          <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <T muted>최초 기록 대비</T><T bold>{fmt(first && all.length > 1 ? change(last.value, first.value) : null, m.unit)}</T>
          </Row>
        </Card>
      )}

      <H style={{ fontSize: 16, marginVertical: S.sm }}>기록 목록</H>
      {rows.length === 0 ? <T muted>기록 없음</T> : [...rows].reverse().slice(0, 40).map((r) => (
        <Card key={r.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <T bold>{r.date}{r.source === 'ocr' ? ' · OCR' : ''}</T>
              <T muted style={{ fontSize: 12 }}>
                {r.weight ?? '—'}kg · 근육 {r.skeletal_muscle ?? '—'} · 지방 {r.body_fat_mass ?? '—'} · {r.body_fat_pct ?? '—'}%
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
