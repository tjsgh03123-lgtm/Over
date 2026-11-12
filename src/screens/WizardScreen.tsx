import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { applyImportedRoutine } from '../db/repo.ts';
import { WD_LABEL } from '../domain/routine.ts';
import { buildPlan, GEAR_LABEL, GOAL_LABEL, type Gear, type Goal } from '../domain/routineWizard.ts';
import type { ParsedDay } from '../domain/parser.ts';
import { Btn, Card, Chip, Header, Row, T } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { Icon } from '../ui/icons.tsx';
import { C, FS, R, S } from '../ui/theme.ts';

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
  const [selDay, setSelDay] = useState(0);
  const [pickDay, setPickDay] = useState<number | null>(null); // 종목을 추가할 날(초안 인덱스)
  const [info, setInfo] = useState<{ name: string; summary: string; warnings: string[] } | null>(null);

  const make = () => {
    const p = buildPlan({ goal, days, gear, minutes });
    setDraft(p.days); setSelDay(0);
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -S.lg, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: S.lg, gap: 8, paddingBottom: S.md }}>
              {draft.map((d, di) => {
                const on = di === selDay;
                const lab = d.weekday != null ? WD_LABEL[d.weekday] : `Day ${di + 1}`;
                return (
                  <Pressable key={di} onPress={() => setSelDay(di)} accessibilityLabel={`draft-day-${di}`}
                    style={{ minWidth: 56, paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.lg, alignItems: 'center', backgroundColor: on ? C.accent : C.card, borderWidth: 1, borderColor: on ? C.accent : C.line }}>
                    <Text style={{ color: on ? C.bg : C.text, fontWeight: '800', fontSize: 15 }}>{lab}</Text>
                    <Text style={{ color: on ? C.bg : C.muted, fontSize: 11, marginTop: 3 }}>{d.exercises.length}종목</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {(() => {
              const di = Math.min(selDay, draft.length - 1);
              const d = draft[di];
              if (!d) return null;
              return (
                <View style={{ gap: S.sm }}>
                  <View style={{ marginBottom: 2 }}>
                    <T muted style={{ fontSize: 12 }}>{d.weekday != null ? `${WD_LABEL[d.weekday]}요일` : `Day ${di + 1}`}</T>
                    <T bold style={{ fontSize: FS.heading }}>{d.title}</T>
                  </View>
                  {d.exercises.map((e, ei) => (
                    <View key={ei} style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md, gap: S.sm }}>
                      <Row style={{ gap: S.sm }}>
                        <T muted style={{ fontSize: 13, fontWeight: '700', width: 16 }}>{ei + 1}</T>
                        <T bold style={{ flex: 1, fontSize: 16 }} numberOfLines={2}>{e.name}</T>
                        <Pressable hitSlop={8} onPress={() => removeEx(di, ei)} style={{ padding: 6 }}><Icon name="trash" size={18} color={C.muted} /></Pressable>
                      </Row>
                      <Row style={{ gap: 8 }}>
                        {([
                          ['세트', String(e.sets), () => patchEx(di, ei, { sets: Math.max(1, e.sets - 1) }), () => patchEx(di, ei, { sets: Math.min(10, e.sets + 1) })],
                          ['횟수', e.repsMax && e.reps ? `${e.reps}-${e.repsMax}` : String(e.reps ?? '-'), () => patchEx(di, ei, { reps: Math.max(1, (e.reps ?? 10) - 1) }), () => patchEx(di, ei, { reps: Math.min(100, (e.reps ?? 10) + 1) })],
                        ] as [string, string, () => void, () => void][]).map(([lb, val, dec, inc]) => (
                          <View key={lb} style={{ flex: 1, backgroundColor: C.card2, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: 8 }}>
                            <T muted style={{ fontSize: 12, marginBottom: 4 }}>{lb}</T>
                            <Row style={{ justifyContent: 'space-between' }}>
                              <Pressable hitSlop={6} onPress={dec} style={{ padding: 8 }}><Icon name="minus" size={18} color={C.text} /></Pressable>
                              <T bold style={{ fontSize: 18 }}>{val}</T>
                              <Pressable hitSlop={6} onPress={inc} style={{ padding: 8 }}><Icon name="plus" size={18} color={C.text} /></Pressable>
                            </Row>
                          </View>
                        ))}
                      </Row>
                    </View>
                  ))}
                  <Btn label="+ 종목 추가" kind="ghost" onPress={() => setPickDay(di)} />
                  {!d.exercises.length && <T muted>운동이 없어요. 저장하면 이 날은 빠져요.</T>}
                </View>
              );
            })()}
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
