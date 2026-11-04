import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  deleteDay, deleteRoutine, getRoutines, moveDay, renameRoutine, setActiveRoutine, setRoutineMode, setRoutineStart,
} from '../db/repo.ts';
import { startForDayNumber } from '../domain/cycle.ts';
import { cycleDayNumber, type Routine, type RoutineDay } from '../domain/routine.ts';
import { Btn, Card, Header, Row, Segmented, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const KIND_LABEL = { weights: '웨이트', cardio: '유산소', rest: '휴식' } as const;

/** 루틴 상세: 이름·방식(사이클/요일)·시작일 같은 세부 설정과 날 목록 */
export function RoutineDetailScreen({ routineId }: { routineId: string }) {
  const { db, today, version, nav, bump } = useApp();
  const [r, setR] = useState<Routine | null>(null);
  const [active, setActive] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    getRoutines(db, today).then((st) => {
      const x = st.routines.find((y) => y.id === routineId) ?? null;
      setR(x);
      setActive(st.activeId === routineId);
      if (x) setName((cur) => (cur === '' ? x.name : cur));
    });
  }, [db, today, version, routineId]);

  if (!r) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="루틴" onBack={nav.close} /></View>;

  const len = r.days.length;
  const todayDay = cycleDayNumber(r, today);
  const dayText = (d: RoutineDay) =>
    `${d.name}${d.kind === 'weights' ? '' : ` · ${KIND_LABEL[d.kind]}`}${r.mode === 'weekday' ? ` · ${d.weekday != null ? WD[d.weekday] + '요일' : '요일 미지정'}` : ''}`;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="루틴 설정" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Card>
          <T muted style={{ marginBottom: 6 }}>루틴 이름</T>
          <TextField
            value={name} onChangeText={setName}
            onEndEditing={async () => { await renameRoutine(db, today, r.id, name); bump(); }}
          />
          <Row style={{ marginTop: S.md }}>
            {active
              ? <T bold style={{ flex: 1 }}>지금 사용 중인 루틴</T>
              : <Btn label="이 루틴 사용하기" style={{ flex: 1 }} onPress={async () => { await setActiveRoutine(db, today, r.id); bump(); }} />}
          </Row>
        </Card>

        <Card>
          <T muted style={{ marginBottom: 6 }}>세부 설정</T>
          <Segmented
            options={[{ key: 'cycle', label: 'N일 반복' }, { key: 'weekday', label: '요일 지정' }]}
            value={r.mode}
            onChange={async (m) => { await setRoutineMode(db, today, r.id, m); bump(); }}
          />
          <T muted style={{ fontSize: 12, marginTop: S.sm }}>
            {r.mode === 'cycle'
              ? `아래 ${len || 'N'}개의 날을 순서대로 ${len || 'N'}일마다 반복합니다. 요일과 상관없어요.`
              : '날마다 요일을 지정합니다. 지정하지 않은 요일은 쉬는 날이에요.'}
          </T>
          {r.mode === 'cycle' && len > 0 && (
            <Row style={{ marginTop: S.md }}>
              <T style={{ flex: 1 }}>오늘은</T>
              <Btn label="−" kind="ghost" small onPress={async () => { await setRoutineStart(db, today, r.id, startForDayNumber(today, ((todayDay - 2 + len) % len) + 1, len)); bump(); }} />
              <T bold style={{ width: 64, textAlign: 'center' }}>{todayDay}일차</T>
              <Btn label="+" kind="ghost" small onPress={async () => { await setRoutineStart(db, today, r.id, startForDayNumber(today, (todayDay % len) + 1, len)); bump(); }} />
            </Row>
          )}
        </Card>

        <Row style={{ marginBottom: S.sm }}>
          <T bold style={{ flex: 1 }}>날 ({len})</T>
          <Btn label="+ 날 추가" small onPress={() => nav.openDay(r.id, null)} />
        </Row>
        {len === 0 && <T muted style={{ marginBottom: S.md }}>날을 추가해 종목을 정하세요. 휴식도 하나의 날이에요.</T>}
        {r.days.map((d, i) => (
          <Card key={d.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <T bold>{r.mode === 'cycle' ? `${i + 1}일차 · ` : ''}{dayText(d)}{r.mode === 'cycle' && i + 1 === todayDay && active ? '  · 오늘' : ''}</T>
              </View>
              <Btn label="↑" kind="ghost" small disabled={i === 0} onPress={async () => { await moveDay(db, today, r.id, d.id, -1); bump(); }} />
              <Btn label="↓" kind="ghost" small disabled={i === len - 1} onPress={async () => { await moveDay(db, today, r.id, d.id, 1); bump(); }} />
              <Btn label="편집" kind="ghost" small onPress={() => nav.openDay(r.id, d.id)} />
              <Btn
                label="✕" kind="danger" small
                onPress={() => Alert.alert('날 삭제', `‘${d.name}’을(를) 루틴에서 삭제할까요? 이미 완료한 기록은 유지됩니다.`, [
                  { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteDay(db, today, r.id, d.id); bump(); } },
                ])}
              />
            </Row>
          </Card>
        ))}

        <Btn
          label="루틴 삭제" kind="danger" style={{ marginTop: S.lg }}
          onPress={() => Alert.alert('루틴 삭제', `‘${r.name}’ 루틴과 날별 종목이 삭제됩니다. 이미 완료한 운동 기록과 성장 그래프는 그대로 유지됩니다.`, [
            { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteRoutine(db, today, r.id); bump(); nav.close(); } },
          ])}
        />
      </ScrollView>
    </View>
  );
}
