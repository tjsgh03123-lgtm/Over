import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { applyImportedRoutine } from '../db/repo.ts';
import { WD_LABEL } from '../domain/routine.ts';
import { buildPlan, GEAR_LABEL, GOAL_LABEL, type Gear, type Goal } from '../domain/routineWizard.ts';
import type { ParsedDay } from '../domain/parser.ts';
import { Btn, Card, Chip, Header, Row, T } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { C, S } from '../ui/theme.ts';

const DAYS = [2, 3, 4, 5, 6];
const MINUTES = [30, 45, 60, 75, 90];

/** 루틴 만들기 도우미: 질문 4개에 답하면 규칙으로 초안을 만들고, 확인·수정 뒤 저장한다 (AI·서버 없음) */
export function WizardScreen() {
  const { db, today, nav, bump } = useApp();
  const [goal, setGoal] = useState<Goal>('size');
  const [days, setDays] = useState(4);
  const [gear, setGear] = useState<Gear>('gym');
  const [minutes, setMinutes] = useState(60);
  const [draft, setDraft] = useState<ParsedDay[] | null>(null);
  const [pickDay, setPickDay] = useState<number | null>(null); // 종목을 추가할 날(초안 인덱스)
  const [info, setInfo] = useState<{ name: string; summary: string; warnings: string[] } | null>(null);

  const make = () => {
    const p = buildPlan({ goal, days, gear, minutes });
    setDraft(p.days);
    setInfo({ name: p.name, summary: p.summary, warnings: p.warnings });
  };
  const removeEx = (di: number, ei: number) =>
    setDraft((d) => (d ? d.map((x, k) => (k !== di ? x : { ...x, exercises: x.exercises.filter((_, m) => m !== ei) })) : d));

  const patchEx = (di: number, ei: number, patch: { sets?: number; reps?: number }) =>
    setDraft((d) => (d ? d.map((x, k) => (k !== di ? x : { ...x, exercises: x.exercises.map((e, m) => (m !== ei ? e : { ...e, ...patch, ...(patch.reps != null ? { repsMax: null } : {}) })) })) : d));
  const addEx = (di: number, name: string, category: string | null) =>
    setDraft((d) => (d ? d.map((x, k) => (k !== di ? x : { ...x, exercises: [...x.exercises, { name, sets: 3, reps: 10, repsMax: null, weight: null, intensity: null, restSec: null, ...(category ? { category } : {}) }] })) : d));

  const total = useMemo(() => (draft ? draft.reduce((n, d) => n + d.exercises.length, 0) : 0), [draft]);

  const save = async () => {
    if (!draft || !info) return;
    const usable = draft.filter((d) => d.exercises.length);
    if (!usable.length) return Alert.alert('저장할 운동이 없어요');
    try {
      await applyImportedRoutine(db, today, usable, '(루틴 도우미)', 'wizard', { name: info.name, mode: 'weekday', activate: true });
      bump();
      nav.goTab('home');
    } catch (e) {
      Alert.alert('저장할 수 없습니다', (e as Error).message);
    }
  };

  const Q = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card>
      <T bold style={{ marginBottom: S.sm }}>{title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{children}</View>
    </Card>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="루틴 도우미" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {!draft ? (
          <>
            <Card>
              <T bold>간단한 루틴만 만들 수 있어요</T>
              <T muted style={{ fontSize: 12, marginTop: 4 }}>도우미는 질문 4개로 기본 분할 루틴(요일별 종목·세트·횟수)만 뽑아요. 슈퍼세트·사이클·무게 지정 같은 세밀한 루틴은 저장한 뒤 루틴 탭에서 고치거나 ‘AI로 가져오기’를 이용하세요.</T>
            </Card>
            <T muted style={{ marginBottom: S.md }}>AI를 쓰지 않고 정해진 규칙으로 고르며, 저장하기 전에 종목을 추가·삭제하고 세트·횟수도 고칠 수 있어요.</T>
            <Q title="1. 목표가 뭐예요?">
              {(Object.keys(GOAL_LABEL) as Goal[]).map((g) => <Chip key={g} label={GOAL_LABEL[g]} active={goal === g} onPress={() => setGoal(g)} />)}
            </Q>
            <Q title="2. 일주일에 며칠 운동해요?">
              {DAYS.map((d) => <Chip key={d} label={`${d}일`} active={days === d} onPress={() => setDays(d)} />)}
            </Q>
            <Q title="3. 쓸 수 있는 장비는요?">
              {(Object.keys(GEAR_LABEL) as Gear[]).map((g) => <Chip key={g} label={GEAR_LABEL[g]} active={gear === g} onPress={() => setGear(g)} />)}
            </Q>
            <Q title="4. 하루에 얼마나 해요?">
              {MINUTES.map((m) => <Chip key={m} label={`${m}분`} active={minutes === m} onPress={() => setMinutes(m)} />)}
            </Q>
            <Btn label="루틴 초안 만들기" onPress={make} />
          </>
        ) : (
          <>
            <Card>
              <T bold style={{ fontSize: 16 }}>{info?.name}</T>
              <T muted style={{ fontSize: 12, marginTop: 4 }}>{info?.summary}</T>
              {info?.warnings.map((w, i) => <T key={i} style={{ fontSize: 12, marginTop: 4, color: C.danger }}>{w}</T>)}
            </Card>
            {draft.map((d, di) => (
              <Card key={di}>
                <T bold>{d.weekday != null ? `${WD_LABEL[d.weekday]}요일 · ` : ''}{d.title}</T>
                {d.exercises.map((e, ei) => (
                  <View key={ei} style={{ marginTop: S.sm, paddingTop: S.sm, borderTopWidth: ei ? 1 : 0, borderTopColor: C.line }}>
                    <Row>
                      <T bold style={{ flex: 1 }}>{e.name}</T>
                      <Btn label="✕" kind="danger" small onPress={() => removeEx(di, ei)} />
                    </Row>
                    <Row style={{ marginTop: 6 }}>
                      <T muted style={{ flex: 1 }}>세트</T>
                      <Btn label="−" kind="ghost" small onPress={() => patchEx(di, ei, { sets: Math.max(1, e.sets - 1) })} />
                      <T bold style={{ width: 48, textAlign: 'center' }}>{e.sets}</T>
                      <Btn label="+" kind="ghost" small onPress={() => patchEx(di, ei, { sets: Math.min(10, e.sets + 1) })} />
                    </Row>
                    <Row style={{ marginTop: 6 }}>
                      <T muted style={{ flex: 1 }}>횟수</T>
                      <Btn label="−" kind="ghost" small onPress={() => patchEx(di, ei, { reps: Math.max(1, (e.reps ?? 10) - 1) })} />
                      <T bold style={{ width: 48, textAlign: 'center' }}>{e.repsMax && e.reps ? `${e.reps}-${e.repsMax}` : e.reps ?? '-'}</T>
                      <Btn label="+" kind="ghost" small onPress={() => patchEx(di, ei, { reps: Math.min(100, (e.reps ?? 10) + 1) })} />
                    </Row>
                  </View>
                ))}
                <Btn label="+ 종목 추가" kind="ghost" small style={{ marginTop: S.md }} onPress={() => setPickDay(di)} />
                {!d.exercises.length && <T muted style={{ marginTop: 6 }}>운동이 없어요. 저장하면 이 날은 빠져요.</T>}
              </Card>
            ))}
            <T muted style={{ fontSize: 12 }}>저장한 뒤에도 루틴 탭에서 고칠 수 있어요. 무게는 첫 운동 때 정해요.</T>
          </>
        )}
      </ScrollView>
      <ExercisePicker
        visible={pickDay != null}
        onClose={() => setPickDay(null)}
        onPick={(e) => { if (pickDay != null) addEx(pickDay, e.name, e.category); setPickDay(null); }}
      />
      {draft && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line, flexDirection: 'row', gap: 8 }}>
          <Btn label="다시 고르기" kind="ghost" style={{ flex: 1 }} onPress={() => setDraft(null)} />
          <Btn label={`저장하고 사용 (${total}개)`} style={{ flex: 2 }} onPress={save} />
        </View>
      )}
    </View>
  );
}
