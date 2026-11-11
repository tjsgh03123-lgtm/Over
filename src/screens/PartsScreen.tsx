import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { loadCategoryMap, loadFlatSets } from '../db/repo.ts';
import { partOf } from '../domain/exerciseCatalog.ts';
import { addDays, weekStart } from '../domain/stats.ts';
import { partTotals } from '../domain/workoutStats.ts';
import { Btn, Card, Empty, H, Row, T } from '../ui/components.tsx';
import { C, GC, S } from '../ui/theme.ts';

/** 분석 > 부위별: 주간 부위별 완료 세트 막대 (색은 그래프 색 하나만 사용) */
export function PartsScreen() {
  const { db, today, version } = useApp();
  const [from, setFrom] = useState(weekStart(today));
  const [rows, setRows] = useState<{ part: string; sets: number; volume: number }[]>([]);
  const to = addDays(from, 6);

  useEffect(() => {
    (async () => {
      const flat = await loadFlatSets(db);
      const cats = await loadCategoryMap(db);
      setRows(partTotals(flat, from, to, (s) => partOf(s.exerciseName, cats.get(s.exerciseId))));
    })();
  }, [db, from, to, version]);

  const max = Math.max(1, ...rows.map((r) => r.sets));
  const thisWeek = from === weekStart(today);
  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }}>
      <Row style={{ marginBottom: S.md }}>
        <Btn label="‹" kind="ghost" small onPress={() => setFrom(addDays(from, -7))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <H style={{ fontSize: 16 }}>{thisWeek ? '이번 주' : '주간'}</H>
          <T muted style={{ fontSize: 12 }}>{from} ~ {to}</T>
        </View>
        <Btn label="›" kind="ghost" small disabled={thisWeek} onPress={() => setFrom(addDays(from, 7))} />
      </Row>
      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>부위별 완료 세트</H>
        {rows.length === 0 ? (
          <Empty text="이 주에는 완료한 세트가 없어요." />
        ) : rows.map((r) => (
          <View key={r.part} style={{ marginBottom: S.md }}>
            <Row>
              <T bold style={{ flex: 1 }}>{r.part}</T>
              <T muted>{r.sets}세트</T>
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden', marginTop: 4 }}>
              <View style={{ height: '100%', width: `${(r.sets / max) * 100}%`, backgroundColor: GC.all }} />
            </View>
          </View>
        ))}
        <T muted style={{ fontSize: 11 }}>기본 종목(바벨·덤벨·머신 등)은 이름으로 부위를 알아보고, 직접 만든 종목은 ‘기타’로 묶여요.</T>
      </Card>
    </ScrollView>
  );
}
