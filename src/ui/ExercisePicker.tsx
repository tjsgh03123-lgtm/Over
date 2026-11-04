import React, { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { getOrCreateExercise, listExercises, type ExerciseRow } from '../db/repo.ts';
import { Btn, Row, TextField } from './components.tsx';
import { C, S } from './theme.ts';

/** 종목 선택/추가 모달. 이름이 같거나 별칭이 같으면 기존 종목으로 통합된다. */
export function ExercisePicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (e: ExerciseRow) => void }) {
  const { db, version } = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState<ExerciseRow[]>([]);

  useEffect(() => {
    if (visible) listExercises(db).then(setList);
  }, [db, visible, version]);

  const nq = q.replace(/\s+/g, '').toLowerCase();
  const shown = list.filter((e) => !nq || e.name.replace(/\s+/g, '').toLowerCase().includes(nq));
  const exact = list.some((e) => e.name.replace(/\s+/g, '').toLowerCase() === nq);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.bg, maxHeight: '80%', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg }}>
          <Row style={{ marginBottom: S.md }}>
            <TextField value={q} onChangeText={setQ} placeholder="종목 검색 또는 새 종목 이름" style={{ flex: 1 }} autoFocus />
            <Btn label="닫기" kind="ghost" small onPress={onClose} />
          </Row>
          {q.trim() && !exact ? (
            <Btn
              label={`‘${q.trim()}’ 새 종목으로 추가`}
              style={{ marginBottom: S.md }}
              onPress={async () => {
                const e = await getOrCreateExercise(db, q);
                setQ('');
                onPick(e);
              }}
            />
          ) : null}
          <FlatList
            data={shown}
            keyExtractor={(e) => e.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable onPress={() => { setQ(''); onPick(item); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={{ color: C.text, fontSize: 15 }}>{item.name}</Text>
                {item.category ? <Text style={{ color: C.muted, fontSize: 12 }}>{item.category}</Text> : null}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
