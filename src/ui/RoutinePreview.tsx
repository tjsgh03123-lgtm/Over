import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../app/context.tsx';
import {
  getExerciseRest, getRestDefault, getSetting, getTemplateExercises, getWeightStep, listTemplates, setSetting,
  type TemplateExerciseRow, type TemplateRow,
} from '../db/repo.ts';
import { adjustForCondition, COND_LABEL, CONDS, RUN_LABEL, sanitizeRunMode, type Cond, type RunMode } from '../domain/condition.ts';
import { partOf } from '../domain/exerciseCatalog.ts';
import { moveBlockTo } from '../domain/reorder.ts';
import { estimateMinutes } from '../domain/workoutStats.ts';
import { Btn, Chip, H, Row, T } from './components.tsx';
import { ReorderList } from './ReorderList.tsx';
import { C, S } from './theme.ts';

export interface StartOpts { templateId: string; order: string[]; cond: Cond }

/**
 * 루틴 시작 전 미리보기: 루틴 바꾸기, 컨디션, 진행 방식, 순서 변경, 종목 수·예상 시간·부위별 세트 수.
 * 컨디션과 순서는 이번 운동에만 적용되고 루틴은 그대로다.
 */
export function RoutinePreview({ templateId, title, onClose, onStart }: { templateId: string | null; title: string; onClose: () => void; onStart: (o: StartOpts) => void }) {
  const { db } = useApp();
  const insets = useSafeAreaInsets();
  const [tplId, setTplId] = useState<string | null>(templateId);
  const [tpls, setTpls] = useState<TemplateRow[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [rows, setRows] = useState<TemplateExerciseRow[]>([]);
  const [restDef, setRestDef] = useState(90);
  const [exRest, setExRest] = useState(180);
  const [step, setStep] = useState(2.5);
  const [cond, setCond] = useState<Cond>(100);
  const [runMode, setRunModeState] = useState<RunMode>('manual');
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  // 열 때마다 처음 상태로: 오늘의 루틴, 컨디션 100%, 순서 그대로
  useEffect(() => {
    if (!templateId) return;
    setTplId(templateId); setCond(100); setPickOpen(false);
    (async () => {
      setTpls(await listTemplates(db));
      setRestDef(await getRestDefault(db));
      setExRest(await getExerciseRest(db));
      setStep(await getWeightStep(db));
      setRunModeState(sanitizeRunMode(await getSetting(db, 'run_mode')));
    })();
  }, [db, templateId]);
  useEffect(() => {
    if (!tplId) return;
    getTemplateExercises(db, tplId).then(setRows);
  }, [db, tplId]);

  const shown = useMemo(() => rows.map((r) => ({ r, adj: adjustForCondition(r.target_sets, r.target_weight, cond, step) })), [rows, cond, step]);

  if (!templateId || !tplId) return null;
  const parts = new Map<string, number>();
  for (const { r, adj } of shown) parts.set(partOf(r.name, r.category), (parts.get(partOf(r.name, r.category)) ?? 0) + adj.sets);
  const minutes = estimateMinutes(shown.map(({ r, adj }) => ({ sets: adj.sets, restSec: (r.rest_sec ?? restDef) + exRest / Math.max(1, adj.sets) })));
  const h = Math.floor(minutes / 60);
  const curTpl = tpls.find((t) => t.id === tplId);
  const heading = tplId === templateId ? title : curTpl?.name ?? title;

  const setRun = (m: RunMode) => { setRunModeState(m); setSetting(db, 'run_mode', m); };
  // 손잡이로 끌어서 순서 변경: 슈퍼세트로 묶인 종목은 함께 움직여서 묶음이 깨지지 않는다
  const reorderRows = (from: number, to: number) => setRows((rs) => moveBlockTo(rs, from, to));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg, paddingBottom: S.lg + insets.bottom, maxHeight: '92%' }}>
        <Pressable onPress={() => setPickOpen((v) => !v)} style={{ alignItems: 'center' }}>
          <H style={{ fontSize: 20, textAlign: 'center' }}>{heading} {pickOpen ? '▴' : '▾'}</H>
          <T muted style={{ fontSize: 11 }}>다른 루틴으로 바꾸려면 눌러요</T>
        </Pressable>
        {pickOpen && (
          <ScrollView style={{ maxHeight: 180, marginTop: S.sm, borderWidth: 1, borderColor: C.line, borderRadius: 10 }} nestedScrollEnabled>
            {tpls.map((t) => (
              <Pressable key={t.id} onPress={() => { setTplId(t.id); setPickOpen(false); }} style={{ paddingVertical: 10, paddingHorizontal: S.md, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: C.text, flex: 1, fontWeight: t.id === tplId ? '800' : '400' }}>{t.name}</Text>
                {t.id === tplId ? <Text style={{ color: C.text }}>✓</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        )}
        <ScrollView
          ref={scrollRef} style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} nestedScrollEnabled
          scrollEnabled={!dragging} scrollEventThrottle={16} onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        >
        <T muted style={{ textAlign: 'center', marginTop: S.sm, marginBottom: S.md }}>{rows.length}종목 · 약 {h > 0 ? `${h}시간 ` : ''}{minutes % 60}분</T>

        <T muted style={{ fontSize: 12, marginBottom: 4 }}>오늘 컨디션</T>
        <Row style={{ marginBottom: 2 }}>
          {CONDS.map((c) => <Chip key={c} label={`${c}%`} active={cond === c} onPress={() => setCond(c)} />)}
        </Row>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>{COND_LABEL[cond]}{cond !== 100 ? '\n이번 운동에만 적용되고 루틴은 그대로예요.' : ''}</T>

        <T muted style={{ fontSize: 12, marginBottom: 4 }}>진행 방식</T>
        <Row style={{ marginBottom: 2 }}>
          {(['manual', 'camera', 'tempo'] as RunMode[]).map((m) => <Chip key={m} label={RUN_LABEL[m]} active={runMode === m} onPress={() => setRun(m)} />)}
        </Row>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>
          {runMode === 'manual' ? '세트마다 직접 ✓ 체크해 기록해요.' : runMode === 'camera' ? '종목마다 카메라가 횟수를 세요. 카메라를 못 쓰면 직접 기록으로 바꿀 수 있어요.' : '정해 둔 박자로 앱이 횟수를 소리 내어 세요. 카메라 없이 따라 하면 돼요.'}
        </T>

        <Row style={{ marginBottom: S.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[...parts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => <Chip key={p} label={`${p} ${n}세트`} />)}
          </View>
        </Row>

        <T muted style={{ fontSize: 11, marginBottom: 4 }}>오른쪽 ≡ 손잡이를 길게 누른 채 위아래로 끌면 순서가 바뀌어요 (이번 운동에만 적용)</T>
        <View style={{ marginBottom: S.md }}>
          <ReorderList<{ r: TemplateExerciseRow; adj: { sets: number; weight: number | null } }>
            items={shown}
            keyOf={(x) => x.r.id}
            scroll={{ ref: scrollRef, offset: scrollY }}
            onDragChange={setDragging}
            onReorder={reorderRows}
            renderItem={({ r, adj }, i, handle) => (
              <Row style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
                <View style={{ flex: 1 }}>
                  <T bold>{r.name}{r.ss && rows[i - 1]?.ss === r.ss ? '  ⛓ 슈퍼세트' : ''}</T>
                  <T muted style={{ fontSize: 12 }}>
                    {adj.sets}세트{r.target_reps ? ` × ${r.target_reps}회` : ''}{adj.weight ? ` · ${adj.weight}kg` : ''} · {partOf(r.name, r.category)}
                    {cond !== 100 && (adj.sets !== r.target_sets || adj.weight !== r.target_weight) ? `  (원래 ${r.target_sets}세트${r.target_weight ? ` ${r.target_weight}kg` : ''})` : ''}
                  </T>
                </View>
                {handle}
              </Row>
            )}
          />
        </View>
        </ScrollView>
        <Row>
          <Btn label="닫기" kind="ghost" style={{ flex: 1 }} onPress={onClose} />
          <Btn label="운동 시작하기" style={{ flex: 2 }} onPress={() => onStart({ templateId: tplId, order: rows.map((r) => r.id), cond })} />
        </Row>
      </View>
    </Modal>
  );
}
