import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { getOrCreateExercise, listExercises, type ExerciseRow } from '../db/repo.ts';
import type { WeightMode } from '../domain/types.ts';
import { ALL_ITEMS, EQUIPS, type Equip } from '../domain/exerciseCatalog.ts';
import { buildPickGroups, GROUP_ORDER, type PickItem } from '../domain/exerciseList.ts';
import { Btn, Chip, Row, TextField } from './components.tsx';
import { C, S } from './theme.ts';

type Line = { kind: 'head'; part: string; count: number } | { kind: 'item'; item: PickItem<ExerciseRow> };

/** 종목 선택/추가 모달. 목록은 하나이고 부위별로 묶인다 (직접 추가한 종목은 각 부위 맨 위). 이름이 같거나 별칭이 같으면 기존 종목으로 통합된다. */
export function ExercisePicker({ visible, onClose, onPick, newMode }: { visible: boolean; onClose: () => void; onPick: (e: ExerciseRow) => void; /** 새로 만드는 종목의 기본 방식 (맨몸 운동에서는 체중) */ newMode?: WeightMode }) {
  const { db, version } = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState<ExerciseRow[]>([]);
  const [part, setPart] = useState<string | null>(null);
  const [equip, setEquip] = useState<Equip | null>(null);

  useEffect(() => {
    if (visible) listExercises(db).then(setList);
  }, [db, visible, version]);

  const groups = useMemo(() => buildPickGroups(list, { part, equip, q }), [list, part, equip, q]);
  const lines = useMemo<Line[]>(
    () => groups.flatMap((g) => [{ kind: 'head' as const, part: g.part, count: g.items.length }, ...g.items.map((item) => ({ kind: 'item' as const, item }))]),
    [groups],
  );
  const nq = q.replace(/\s+/g, '').toLowerCase();
  const exact = list.some((e) => e.name.replace(/\s+/g, '').toLowerCase() === nq) || ALL_ITEMS.some((c) => c.name.replace(/\s+/g, '').toLowerCase() === nq);

  const reset = () => { setQ(''); setPart(null); setEquip(null); };
  const modeFor = (eq: Equip | null): { mode: WeightMode } | {} => (eq === '맨몸' ? { mode: 'bodyweight' as const } : newMode ? { mode: newMode } : {});

  const pick = async (it: PickItem<ExerciseRow>) => {
    const e = it.row ?? await getOrCreateExercise(db, it.name, { category: it.part, ...modeFor(it.equip) });
    reset();
    onPick(e);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.bg, height: '88%', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg }}>
          <Row style={{ marginBottom: S.md }}>
            <TextField value={q} onChangeText={setQ} placeholder="종목 검색 또는 새 종목 이름" style={{ flex: 1 }} autoFocus />
            <Btn label="닫기" kind="ghost" small onPress={() => { reset(); onClose(); }} />
          </Row>
          {q.trim() && !exact ? (
            <Btn
              label={`‘${q.trim()}’ ${part && part !== '기타' ? `${part}에 ` : ''}새 종목으로 추가`}
              style={{ marginBottom: S.md }}
              onPress={async () => {
                const e = await getOrCreateExercise(db, q, { ...(part && part !== '기타' ? { category: part } : {}), ...modeFor(equip) });
                reset();
                onPick(e);
              }}
            />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: S.sm }}>
            <Chip label="전체" active={part === null} onPress={() => setPart(null)} />
            {GROUP_ORDER.map((p) => <Chip key={p} label={p} active={part === p} onPress={() => setPart(part === p ? null : p)} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: S.sm }}>
            {EQUIPS.map((e) => <Chip key={e} label={e} active={equip === e} onPress={() => setEquip(equip === e ? null : e)} />)}
          </View>
          <FlatList
            data={lines}
            keyExtractor={(l) => (l.kind === 'head' ? `h:${l.part}` : l.item.key)}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={{ color: C.muted, paddingVertical: S.lg, textAlign: 'center' }}>맞는 종목이 없어요. 위에 이름을 입력해 새로 추가하세요.</Text>}
            renderItem={({ item: l }) => l.kind === 'head' ? (
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', marginTop: S.md, marginBottom: 2 }}>{l.part} <Text style={{ color: C.muted, fontWeight: '400' }}>{l.count}</Text></Text>
            ) : (
              <Pressable onPress={() => pick(l.item)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={{ color: C.text, fontSize: 15 }}>{l.item.name}</Text>
                {l.item.equip ? <Text style={{ color: C.muted, fontSize: 12 }}>{l.item.equip}</Text> : null}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
