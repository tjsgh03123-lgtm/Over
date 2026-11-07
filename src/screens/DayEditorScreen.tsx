import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { getDayDetail, getRoutines, upsertDay, type TemplateExerciseInput } from '../db/repo.ts';
import type { DayKind, RoutineMode } from '../domain/routine.ts';
import { moveItem } from '../domain/reorder.ts';
import { Btn, Card, Chip, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { ReorderList } from '../ui/ReorderList.tsx';
import { C, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const KINDS: { key: DayKind; label: string }[] = [
  { key: 'weights', label: '웨이트' }, { key: 'cardio', label: '유산소' }, { key: 'rest', label: '휴식' },
];

interface EditEx extends TemplateExerciseInput { name: string; key: string }
let keySeq = 0;
const newKey = () => `ex${++keySeq}`;

/** 루틴의 '날' 한 개 편집: 이름·종류·(요일 지정 방식이면 요일)·종목 */
export function DayEditorScreen({ routineId, dayId }: { routineId: string; dayId: string | null }) {
  const { db, today, nav, bump } = useApp();
  const [mode, setMode] = useState<RoutineMode>('cycle');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DayKind>('weights');
  const [weekday, setWeekday] = useState<number | null>(null);
  const [postCardio, setPostCardio] = useState<number | null>(null);
  const [exercises, setExercises] = useState<EditEx[]>([]);
  const [picker, setPicker] = useState(false);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  useEffect(() => {
    (async () => {
      const st = await getRoutines(db, today);
      setMode(st.routines.find((r) => r.id === routineId)?.mode ?? 'cycle');
      if (dayId) {
        const d = await getDayDetail(db, today, routineId, dayId);
        if (d) {
          setName(d.day.name); setKind(d.day.kind); setWeekday(d.day.weekday); setPostCardio(d.postCardioMin);
          setExercises(d.exercises.map((e) => ({
            key: newKey(), exerciseId: e.exercise_id, name: e.name, targetSets: e.target_sets, targetReps: e.target_reps,
            targetWeight: e.target_weight, intensity: e.intensity, restSec: e.rest_sec, note: e.note, ss: e.ss,
          })));
        }
      }
      setReady(true);
    })();
  }, [db, today, routineId, dayId]);

  const patchEx = (i: number, p: Partial<EditEx>) => setExercises((l) => l.map((e, k) => (k === i ? { ...e, ...p } : e)));

  const save = async () => {
    if (kind === 'weights' && !name.trim()) return Alert.alert('날 이름을 입력하세요', '예: 가슴·삼두');
    try {
      await upsertDay(db, today, routineId, {
        id: dayId ?? undefined, name, kind, weekday: mode === 'weekday' ? weekday : null,
        postCardioMin: postCardio, exercises: exercises.map(({ name: _n, key: _k, ...rest }) => rest),
      });
      bump();
      nav.close();
    } catch (e) {
      Alert.alert('저장할 수 없습니다', (e as Error).message);
    }
  };

  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="불러오는 중" onBack={nav.close} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title={dayId ? '날 편집' : '날 추가'} onBack={nav.close} />
      <ScrollView
        ref={scrollRef} scrollEnabled={!dragging} scrollEventThrottle={16}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        contentContainerStyle={{ padding: S.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled"
      >
        <Card>
          <TextField value={name} onChangeText={setName} placeholder={kind === 'rest' ? '휴식' : kind === 'cardio' ? '유산소' : '날 이름 (예: 가슴·삼두)'} />
          <Row style={{ marginTop: S.md }}>
            {KINDS.map((k) => <Chip key={k.key} label={k.label} active={kind === k.key} onPress={() => setKind(k.key)} />)}
          </Row>
          {mode === 'weekday' && (
            <>
              <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: 6 }}>요일</T>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                <Chip label="없음" active={weekday == null} onPress={() => setWeekday(null)} />
                {WD_ORDER.map((w) => <Chip key={w} label={WD[w]} active={weekday === w} onPress={() => setWeekday(w)} />)}
              </Row>
            </>
          )}
          {kind === 'weights' && (
            <Row style={{ marginTop: S.md }}>
              <T muted style={{ flex: 1 }}>웨이트 후 유산소(분, 비우면 없음)</T>
              <NumInput value={postCardio} decimal={false} width={64} onCommit={setPostCardio} />
            </Row>
          )}
        </Card>

        {kind === 'weights' && (
          <>
            {exercises.length > 1 && <T muted style={{ fontSize: 12, marginBottom: S.sm }}>오른쪽 ≡를 길게 누른 채 위아래로 끌면 순서가 바뀝니다.</T>}
            <ReorderList<EditEx>
              items={exercises}
              keyOf={(e) => e.key}
              scroll={{ ref: scrollRef, offset: scrollY }}
              onDragChange={setDragging}
              onReorder={(from, to) => setExercises((l) => moveItem(l, from, to))}
              renderItem={(e, i, handle) => (
                <Card>
                  <Row>
                    <T bold style={{ flex: 1 }}>{i + 1}. {e.name}{e.ss && exercises[i - 1]?.ss === e.ss ? '  ⛓ 슈퍼세트' : ''}</T>
                    <Btn label="✕" kind="danger" small onPress={() => setExercises((l) => l.filter((x) => x.key !== e.key))} />
                    {handle}
                  </Row>
                  {i > 0 && (
                    <Row style={{ marginTop: 6 }}>
                      <Chip
                        label={e.ss && exercises[i - 1]?.ss === e.ss ? '위 종목과 슈퍼세트 해제' : '위 종목과 슈퍼세트로 묶기'}
                        active={!!e.ss && exercises[i - 1]?.ss === e.ss}
                        onPress={() => {
                          if (e.ss && exercises[i - 1]?.ss === e.ss) return patchEx(i, { ss: null });
                          const g = exercises[i - 1]?.ss ?? `ss${Date.now().toString(36)}`;
                          setExercises((l) => l.map((x, k) => (k === i || k === i - 1 ? { ...x, ss: g } : x)));
                        }}
                      />
                    </Row>
                  )}
                  <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                    <T muted>세트</T><NumInput value={e.targetSets ?? 3} decimal={false} width={52} onCommit={(v) => patchEx(i, { targetSets: Math.max(1, v ?? 3) })} />
                    <T muted>횟수</T><NumInput value={e.targetReps ?? null} decimal={false} width={52} onCommit={(v) => patchEx(i, { targetReps: v })} />
                    <T muted>kg</T><NumInput value={e.targetWeight ?? null} width={64} onCommit={(v) => patchEx(i, { targetWeight: v })} />
                    <T muted>휴식(초)</T><NumInput value={e.restSec ?? null} decimal={false} width={60} placeholder="기본" onCommit={(v) => patchEx(i, { restSec: v })} />
                  </Row>
                </Card>
              )}
            />
            <Btn label="+ 종목 추가" kind="ghost" onPress={() => setPicker(true)} />
          </>
        )}
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line }}>
        <Btn label="저장" onPress={save} />
      </View>
      <ExercisePicker
        visible={picker}
        onClose={() => setPicker(false)}
        onPick={(e) => { setPicker(false); setExercises((l) => [...l, { key: newKey(), exerciseId: e.id, name: e.name, targetSets: 3 }]); }}
      />
    </View>
  );
}
