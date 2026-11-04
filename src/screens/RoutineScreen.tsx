import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { createRoutine, getRoutines, setActiveRoutine } from '../db/repo.ts';
import type { RoutinesState } from '../domain/routine.ts';
import { Btn, Card, Empty, H, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

/** 루틴 탭: 루틴(= 사이클 한 개 전체) 목록. 눌러서 세부 설정과 날별 종목을 편집한다. */
export function RoutineScreen() {
  const { db, today, version, nav, bump } = useApp();
  const [st, setSt] = useState<RoutinesState>({ activeId: null, routines: [] });
  const [name, setName] = useState<string | null>(null); // null이면 이름 입력창 닫힘

  useEffect(() => { getRoutines(db, today).then(setSt); }, [db, today, version]);

  const create = async () => {
    const id = await createRoutine(db, today, { name: name ?? '' });
    setName(null);
    bump();
    nav.openRoutine(id);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Row style={{ marginBottom: S.lg }}>
        <H style={{ fontSize: 22, flex: 1 }}>루틴</H>
        <Btn label="AI로 가져오기" kind="ghost" small onPress={nav.openImport} />
        <Btn label="+ 새 루틴" small onPress={() => setName('')} />
      </Row>

      {name != null && (
        <Card>
          <T muted style={{ marginBottom: 6 }}>새 루틴 이름</T>
          <TextField value={name} onChangeText={setName} placeholder="예: 3분할 루틴" autoFocus />
          <Row style={{ marginTop: S.sm }}>
            <Btn label="만들기" small style={{ flex: 1 }} onPress={create} />
            <Btn label="취소" kind="ghost" small onPress={() => setName(null)} />
          </Row>
        </Card>
      )}

      {st.routines.length === 0 && name == null && (
        <Empty text={'아직 루틴이 없어요.\n‘+ 새 루틴’으로 직접 만들거나, ‘AI로 가져오기’로 다른 AI가 만든 루틴을 불러오세요.'} />
      )}

      {st.routines.map((r) => {
        const active = r.id === st.activeId;
        return (
          <Pressable key={r.id} onPress={() => nav.openRoutine(r.id)}>
            <Card style={active ? { borderColor: C.accent } : undefined}>
              <Row>
                <View style={{ flex: 1 }}>
                  <T bold style={{ fontSize: 16 }}>{r.name}{active ? '  · 사용 중' : ''}</T>
                  <T muted style={{ fontSize: 12 }}>
                    {r.days.length}일 {r.mode === 'cycle' ? '주기' : '· 요일 지정'}
                    {r.days.length ? ` · ${r.days.slice(0, 3).map((d) => d.name).join(', ')}${r.days.length > 3 ? ' …' : ''}` : ' · 날을 추가하세요'}
                  </T>
                </View>
                {!active && (
                  <Btn label="사용" kind="ghost" small onPress={async () => { await setActiveRoutine(db, today, r.id); bump(); }} />
                )}
              </Row>
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
