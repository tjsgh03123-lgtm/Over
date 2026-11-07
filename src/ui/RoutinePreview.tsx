import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { getExerciseRest, getRestDefault, getTemplateExercises, type TemplateExerciseRow } from '../db/repo.ts';
import { partOf } from '../domain/exerciseCatalog.ts';
import { estimateMinutes } from '../domain/workoutStats.ts';
import { Btn, Chip, H, Row, T } from './components.tsx';
import { C, S } from './theme.ts';

/** 루틴 시작 전 미리보기: 종목 수, 예상 시간, 부위별 세트 수, 종목 목록 */
export function RoutinePreview({ templateId, title, onClose, onStart }: { templateId: string | null; title: string; onClose: () => void; onStart: () => void }) {
  const { db } = useApp();
  const [rows, setRows] = useState<TemplateExerciseRow[]>([]);
  const [restDef, setRestDef] = useState(90);
  const [exRest, setExRest] = useState(180);

  useEffect(() => {
    if (!templateId) return;
    (async () => {
      setRows(await getTemplateExercises(db, templateId));
      setRestDef(await getRestDefault(db));
      setExRest(await getExerciseRest(db));
    })();
  }, [db, templateId]);

  if (!templateId) return null;
  const parts = new Map<string, number>();
  for (const r of rows) parts.set(partOf(r.name), (parts.get(partOf(r.name)) ?? 0) + r.target_sets);
  const minutes = estimateMinutes(rows.map((r) => ({ sets: r.target_sets, restSec: (r.rest_sec ?? restDef) + exRest / Math.max(1, r.target_sets) })));
  const h = Math.floor(minutes / 60);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg, maxHeight: '85%' }}>
        <H style={{ fontSize: 20, textAlign: 'center' }}>{title}</H>
        <T muted style={{ textAlign: 'center', marginBottom: S.md }}>{rows.length}종목 · 약 {h > 0 ? `${h}시간 ` : ''}{minutes % 60}분</T>
        <Row style={{ flexWrap: 'wrap', justifyContent: 'center', marginBottom: S.md }}>
          {[...parts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => <Chip key={p} label={`${p} ${n}세트`} />)}
        </Row>
        <ScrollView style={{ marginBottom: S.md }}>
          {rows.map((r, i) => (
            <Row key={r.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ flex: 1 }}>
                <T bold>{r.name}{r.ss && rows[i - 1]?.ss === r.ss ? '  ⛓ 슈퍼세트' : ''}</T>
                <T muted style={{ fontSize: 12 }}>
                  {r.target_sets}세트{r.target_reps ? ` × ${r.target_reps}회` : ''}{r.target_weight ? ` · ${r.target_weight}kg` : ''} · {partOf(r.name)}
                </T>
              </View>
            </Row>
          ))}
        </ScrollView>
        <Row>
          <Btn label="닫기" kind="ghost" style={{ flex: 1 }} onPress={onClose} />
          <Btn label="운동 시작하기" style={{ flex: 2 }} onPress={onStart} />
        </Row>
      </View>
    </Modal>
  );
}
