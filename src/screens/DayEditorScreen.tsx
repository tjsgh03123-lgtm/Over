import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { getDayDetail, getRoutines, upsertDay, type TemplateExerciseInput } from '../db/repo.ts';
import type { DayKind, RoutineMode } from '../domain/routine.ts';
import { Btn, Card, Chip, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { C, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const KINDS: { key: DayKind; label: string }[] = [
  { key: 'weights', label: '웨이트' }, { key: 'cardio', label: '유산소' }, { key: 'rest', label: '휴식' },
];

interface EditEx extends TemplateExerciseInput { name: string }

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

  useEffect(() => {
    (async () => {
      const st = await getRoutines(db, today);
      setMode(st.routines.find((r) => r.id === routineId)?.mode ?? 'cycle');
      if (dayId) {
        const d = await getDayDetail(db, today, routineId, dayId);
        if (d) {
          setName(d.day.name); setKind(d.day.kind); setWeekday(d.day.weekday); setPostCardio(d.postCardioMin);
          setExercises(d.exercises.map((e) => ({
            exerciseId: e.exercise_id, name: e.name, targetSets: e.target_sets, targetReps: e.target_reps,
            targetWeight: e.target_weight, intensity: e.intensity, restSec: e.rest_sec, note: e.note,
          })));
        }
      }
      setReady(true);
    })();
  }, [db, today, routineId, dayId]);

  const patchEx = (i: number, p: Partial<EditEx>) => setExercises((l) => l.map((e, k) => (k === i ? { ...e, ...p } : e)));
  const move = (i: number, dir: -1 | 1) =>
    setExercises((l) => {
      const j = i + dir;
      if (j < 0 || j >= l.length) return l;
      const arr = [...l];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });

  const save = async () => {
    if (kind === 'weights' && !name.trim()) return Alert.alert('날 이름을 입력하세요', '예: 가슴·삼두');
    try {
      await upsertDay(db, today, routineId, {
        id: dayId ?? undefined, name, kind, weekday: mode === 'weekday' ? weekday : null,
        postCardioMin: postCardio, exercises: exercises.map(({ name: _n, ...rest }) => rest),
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
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
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
            {exercises.map((e, i) => (
              <Card key={`${e.exerciseId}-${i}`}>
                <Row>
                  <T bold style={{ flex: 1 }}>{i + 1}. {e.name}</T>
                  <Btn label="↑" kind="ghost" small onPress={() => move(i, -1)} />
                  <Btn label="↓" kind="ghost" small onPress={() => move(i, 1)} />
                  <Btn label="✕" kind="danger" small onPress={() => setExercises((l) => l.filter((_, k) => k !== i))} />
                </Row>
                <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <T muted>세트</T><NumInput value={e.targetSets ?? 3} decimal={false} width={52} onCommit={(v) => patchEx(i, { targetSets: Math.max(1, v ?? 3) })} />
                  <T muted>횟수</T><NumInput value={e.targetReps ?? null} decimal={false} width={52} onCommit={(v) => patchEx(i, { targetReps: v })} />
                  <T muted>kg</T><NumInput value={e.targetWeight ?? null} width={64} onCommit={(v) => patchEx(i, { targetWeight: v })} />
                </Row>
              </Card>
            ))}
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
        onPick={(e) => { setPicker(false); setExercises((l) => [...l, { exerciseId: e.id, name: e.name, targetSets: 3 }]); }}
      />
    </View>
  );
}
