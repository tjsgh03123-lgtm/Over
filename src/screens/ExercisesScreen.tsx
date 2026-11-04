import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { deleteExercise, getOrCreateExercise, listExercises, renameExercise, setExerciseMode, type ExerciseRow } from '../db/repo.ts';
import type { WeightMode } from '../domain/types.ts';
import { Btn, Card, Chip, Header, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const MODES: { key: WeightMode; label: string }[] = [
  { key: 'weighted', label: '일반(중량)' },
  { key: 'bodyweight', label: '체중' },
  { key: 'assisted', label: '보조(어시스트)' },
];

export function ExercisesScreen() {
  const { db, version, nav, bump } = useApp();
  const [list, setList] = useState<ExerciseRow[]>([]);
  const [newName, setNewName] = useState('');

  useEffect(() => { listExercises(db).then(setList); }, [db, version]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="종목 관리" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Row style={{ marginBottom: S.md }}>
          <TextField value={newName} onChangeText={setNewName} placeholder="새 종목 이름" style={{ flex: 1 }} />
          <Btn label="추가" onPress={async () => { if (!newName.trim()) return; await getOrCreateExercise(db, newName); setNewName(''); bump(); }} />
        </Row>
        <T muted style={{ fontSize: 12, marginBottom: S.md }}>
          이름을 바꿔도 과거 기록과 그래프는 같은 종목으로 유지됩니다. 기록이 있는 종목을 삭제하면 목록에서만 숨겨지고(보관) 기록은 보존됩니다.
          체중·보조 운동은 중량을 일반 중량 운동과 다르게 해석합니다(보조는 낮을수록 좋은 기록).
        </T>
        {list.map((e) => (
          <ExerciseItem key={e.id} e={e} onChanged={bump} />
        ))}
      </ScrollView>
    </View>
  );
}

function ExerciseItem({ e, onChanged }: { e: ExerciseRow; onChanged: () => void }) {
  const { db } = useApp();
  const [name, setName] = useState(e.name);
  useEffect(() => setName(e.name), [e.name]);
  return (
    <Card>
      <TextField
        value={name} onChangeText={setName}
        onEndEditing={async () => { if (name.trim() && name.trim() !== e.name) { await renameExercise(db, e.id, name.trim()); onChanged(); } }}
      />
      <Row style={{ flexWrap: 'wrap', marginTop: S.sm }}>
        {MODES.map((m) => (
          <Chip key={m.key} label={m.label} active={e.weight_mode === m.key} onPress={async () => { await setExerciseMode(db, e.id, m.key); onChanged(); }} />
        ))}
        <View style={{ flex: 1 }} />
        <Btn
          label="삭제" kind="danger" small
          onPress={() => Alert.alert('종목 삭제', `${e.name}을(를) 삭제할까요? 기록이 있으면 숨김(보관) 처리됩니다.`, [
            { text: '취소' },
            {
              text: '삭제', style: 'destructive',
              onPress: async () => {
                const r = await deleteExercise(db, e.id);
                if (r === 'archived') Alert.alert('보관됨', '기록이 있어 목록에서만 숨겼습니다. 같은 이름으로 다시 추가하면 복원됩니다.');
                onChanged();
              },
            },
          ])}
        />
      </Row>
    </Card>
  );
}
