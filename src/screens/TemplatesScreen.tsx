import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  deleteTemplate, getTemplateExercises, listTemplates, saveTemplate, type TemplateExerciseInput, type TemplateRow,
} from '../db/repo.ts';
import type { Intensity } from '../domain/types.ts';
import { Btn, Card, Empty, Header, IntensityPicker, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { C, S } from '../ui/theme.ts';

interface EditEx extends TemplateExerciseInput { name: string }
interface Draft { id?: string; name: string; intensity: Intensity; postCardio: number | null; exercises: EditEx[] }

export function TemplatesScreen() {
  const { db, version, nav, bump } = useApp();
  const [list, setList] = useState<TemplateRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picker, setPicker] = useState(false);

  useEffect(() => { listTemplates(db).then(setList); }, [db, version]);

  const edit = async (t: TemplateRow | null) => {
    if (!t) return setDraft({ name: '새 루틴', intensity: 'none', postCardio: null, exercises: [] });
    const ex = await getTemplateExercises(db, t.id);
    setDraft({
      id: t.id, name: t.name, intensity: t.default_intensity, postCardio: t.post_cardio_min,
      exercises: ex.map((e) => ({
        exerciseId: e.exercise_id, name: e.name, targetSets: e.target_sets, targetReps: e.target_reps,
        targetWeight: e.target_weight, intensity: e.intensity, restSec: e.rest_sec, note: e.note,
      })),
    });
  };

  const patchEx = (i: number, p: Partial<EditEx>) =>
    setDraft((d) => d && { ...d, exercises: d.exercises.map((e, k) => (k === i ? { ...e, ...p } : e)) });
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.exercises.length) return d;
      const arr = [...d.exercises];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...d, exercises: arr };
    });

  if (draft) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Header title={draft.id ? '루틴 편집' : '새 루틴'} onBack={() => setDraft(null)} />
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Card>
            <TextField value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="루틴 이름" />
            <T muted style={{ fontSize: 12, marginVertical: 6 }}>운동일 기본 강도</T>
            <IntensityPicker value={draft.intensity} compact onChange={(v) => setDraft({ ...draft, intensity: v ?? 'none' })} />
            <Row style={{ marginTop: S.md }}>
              <T muted style={{ flex: 1 }}>웨이트 후 유산소(분, 비우면 없음)</T>
              <NumInput value={draft.postCardio} decimal={false} width={64} onCommit={(v) => setDraft((d) => d && { ...d, postCardio: v })} />
            </Row>
          </Card>

          {draft.exercises.map((e, i) => (
            <Card key={`${e.exerciseId}-${i}`}>
              <Row>
                <T bold style={{ flex: 1 }}>{i + 1}. {e.name}</T>
                <Btn label="↑" kind="ghost" small onPress={() => move(i, -1)} />
                <Btn label="↓" kind="ghost" small onPress={() => move(i, 1)} />
                <Btn label="✕" kind="danger" small onPress={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, k) => k !== i) })} />
              </Row>
              <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <T muted>세트</T><NumInput value={e.targetSets ?? 3} decimal={false} width={52} onCommit={(v) => patchEx(i, { targetSets: Math.max(1, v ?? 3) })} />
                <T muted>횟수</T><NumInput value={e.targetReps ?? null} decimal={false} width={52} onCommit={(v) => patchEx(i, { targetReps: v })} />
                <T muted>kg</T><NumInput value={e.targetWeight ?? null} width={64} onCommit={(v) => patchEx(i, { targetWeight: v })} />
              </Row>
              <T muted style={{ fontSize: 12, marginTop: 8, marginBottom: 4 }}>종목 강도</T>
              <IntensityPicker value={e.intensity ?? null} allowInherit compact onChange={(v) => patchEx(i, { intensity: v })} />
            </Card>
          ))}
          <Btn label="+ 종목 추가" kind="ghost" onPress={() => setPicker(true)} />
        </ScrollView>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line }}>
          <Btn
            label="저장"
            onPress={async () => {
              if (!draft.name.trim()) return Alert.alert('루틴 이름을 입력하세요');
              await saveTemplate(db, {
                id: draft.id, name: draft.name.trim(), defaultIntensity: draft.intensity, postCardioMin: draft.postCardio,
                exercises: draft.exercises.map(({ name: _n, ...rest }) => rest),
              });
              bump();
              setDraft(null);
            }}
          />
        </View>
        <ExercisePicker
          visible={picker}
          onClose={() => setPicker(false)}
          onPick={(e) => { setPicker(false); setDraft((d) => d && { ...d, exercises: [...d.exercises, { exerciseId: e.id, name: e.name, targetSets: 3 }] }); }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="루틴 관리" onBack={nav.close} right={<Btn label="+ 새 루틴" small onPress={() => edit(null)} />} />
      <ScrollView contentContainerStyle={{ padding: S.lg }}>
        {list.length === 0 && <Empty text="루틴이 없습니다." />}
        {list.map((t) => (
          <Card key={t.id}>
            <Row>
              <T bold style={{ flex: 1 }}>{t.name}</T>
              <Btn label="편집" kind="ghost" small onPress={() => edit(t)} />
              <Btn
                label="삭제" kind="danger" small
                onPress={() => Alert.alert('루틴 삭제', '루틴만 삭제되며, 이미 완료한 운동 기록과 성장 그래프는 그대로 유지됩니다.', [
                  { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteTemplate(db, t.id); bump(); } },
                ])}
              />
            </Row>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}
