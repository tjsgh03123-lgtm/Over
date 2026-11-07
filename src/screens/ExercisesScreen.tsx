import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { deleteExercise, getOrCreateExercise, listExercises, renameExercise, setExerciseCategory, setExerciseMode, type ExerciseRow } from '../db/repo.ts';
import { partOf } from '../domain/exerciseCatalog.ts';
import { buildPickGroups, GROUP_ORDER, type PickItem } from '../domain/exerciseList.ts';
import type { WeightMode } from '../domain/types.ts';
import { Btn, Card, Chip, Header, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const MODES: { key: WeightMode; label: string }[] = [
  { key: 'weighted', label: '일반(중량)' },
  { key: 'bodyweight', label: '체중' },
  { key: 'assisted', label: '보조(어시스트)' },
];
const MODE_LABEL: Record<WeightMode, string> = { weighted: '중량', bodyweight: '체중', assisted: '보조' };

export function ExercisesScreen() {
  const { db, version, nav, bump } = useApp();
  const [list, setList] = useState<ExerciseRow[]>([]);
  const [newName, setNewName] = useState('');
  const [part, setPart] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { listExercises(db).then(setList); }, [db, version]);

  const groups = useMemo(() => buildPickGroups(list, { part, includeCatalog: false }), [list, part]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="종목 관리" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Row style={{ marginBottom: S.sm }}>
          <TextField value={newName} onChangeText={setNewName} placeholder={part && part !== '기타' ? `${part}에 새 종목 추가` : '새 종목 이름'} style={{ flex: 1 }} />
          <Btn label="추가" onPress={async () => {
            if (!newName.trim()) return;
            await getOrCreateExercise(db, newName, part && part !== '기타' ? { category: part } : {});
            setNewName(''); bump();
          }} />
        </Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: S.md }}>
          <Chip label="전체" active={part === null} onPress={() => setPart(null)} />
          {GROUP_ORDER.map((p) => <Chip key={p} label={p} active={part === p} onPress={() => setPart(part === p ? null : p)} />)}
        </View>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>
          종목을 누르면 이름·부위·방식을 바꾸거나 삭제할 수 있어요. 이름을 바꿔도 과거 기록과 그래프는 같은 종목으로 유지되고, 기록이 있는 종목을 삭제하면 목록에서만 숨겨져요(기록은 보존).
          체중·보조 운동은 중량을 일반 운동과 다르게 해석해요(보조는 낮을수록 좋은 기록).
        </T>
        {groups.length === 0 ? <T muted style={{ textAlign: 'center', paddingVertical: S.lg }}>이 부위에 종목이 없어요.</T> : null}
        {groups.map((g) => (
          <View key={g.part} style={{ marginBottom: S.md }}>
            <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>{g.part} <Text style={{ color: C.muted, fontWeight: '400' }}>{g.items.length}</Text></Text>
            <Card style={{ paddingVertical: 0 }}>
              {g.items.map((it, i) => (
                <ExerciseItem key={it.key} it={it} first={i === 0} expanded={open === it.row!.id} onToggle={() => setOpen(open === it.row!.id ? null : it.row!.id)} onChanged={bump} />
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function ExerciseItem({ it, first, expanded, onToggle, onChanged }: { it: PickItem<ExerciseRow>; first: boolean; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const { db } = useApp();
  const e = it.row!;
  const [name, setName] = useState(e.name);
  useEffect(() => setName(e.name), [e.name]);
  const cur = partOf(e.name, e.category);
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <Pressable onPress={onToggle} style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 15 }}>{e.name}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{[it.equip, MODE_LABEL[e.weight_mode]].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={{ color: C.muted, fontSize: 16 }}>{expanded ? '▴' : '▾'}</Text>
      </Pressable>
      {expanded ? (
        <View style={{ paddingBottom: S.md }}>
          <TextField
            value={name} onChangeText={setName}
            onEndEditing={async () => { if (name.trim() && name.trim() !== e.name) { await renameExercise(db, e.id, name.trim()); onChanged(); } }}
          />
          <T muted style={{ fontSize: 12, marginTop: S.sm, marginBottom: 4 }}>부위</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {GROUP_ORDER.map((p) => (
              <Chip key={p} label={p} active={cur === p} onPress={async () => { await setExerciseCategory(db, e.id, p === '기타' ? null : p); onChanged(); }} />
            ))}
          </View>
          <T muted style={{ fontSize: 12, marginTop: S.sm, marginBottom: 4 }}>방식</T>
          <Row style={{ flexWrap: 'wrap' }}>
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
        </View>
      ) : null}
    </View>
  );
}
