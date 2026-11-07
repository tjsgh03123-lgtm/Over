import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  autoFillRoutine, deleteDay, deleteRoutine, getRoutines, renameRoutine, setActiveRoutine, setRepeatDays, setRoutineMode,
  setRoutineSlots, setRoutineStart, setSlot,
} from '../db/repo.ts';
import { startForDayNumber } from '../domain/cycle.ts';
import { weekdayOf } from '../domain/stats.ts';
import {
  convertMode, cycleDayNumber, MAX_REPEAT, slotName, slotOrder, unplacedDays, WD_LABEL,
  type Routine, type RoutineMode,
} from '../domain/routine.ts';
import { moveItem } from '../domain/reorder.ts';
import { Btn, Card, Header, Row, T, TextField } from '../ui/components.tsx';
import { ReorderList } from '../ui/ReorderList.tsx';
import { C, S } from '../ui/theme.ts';

type StepKey = 'type' | 'repeat' | 'days' | 'layout' | 'done';
const STEP_TITLE: Record<StepKey, string> = {
  type: '방식과 이름', repeat: '반복 일수', days: '날 만들기', layout: '칸 배치', done: '확인',
};
const STEP_HINT: Record<StepKey, string> = {
  type: '루틴 이름을 정하고, 어떤 방식으로 돌릴지 고릅니다.',
  repeat: '며칠 동안 하고 다시 처음(Day 1)부터 할지 정합니다.',
  days: '운동할 날(Day)을 만들고 종목을 넣습니다. 쉬는 날은 만들 필요 없어요.',
  layout: '만든 날을 칸에 놓습니다. 비워 둔 칸은 쉬는 날이에요.',
  done: '정한 내용을 확인하고 저장합니다.',
};

/** 화면을 다녀와도(날 편집 등) 보던 단계를 기억한다 */
const lastStep = new Map<string, StepKey>();

const KIND_LABEL = { weights: '웨이트', cardio: '유산소', rest: '휴식' } as const;

/** 루틴 만들기·편집: 한 번에 한 단계씩 (방식·이름 → 반복 일수 → 날 만들기 → 칸 배치 → 확인) */
export function RoutineDetailScreen({ routineId }: { routineId: string }) {
  const { db, today, version, nav, bump } = useApp();
  const insets = useSafeAreaInsets();
  const [r, setR] = useState<Routine | null>(null);
  const [active, setActive] = useState(false);
  const [name, setName] = useState('');
  const [step, setStepState] = useState<StepKey | null>(lastStep.get(routineId) ?? null);
  const [sheet, setSheet] = useState<number | null>(null); // 칸 고르기 시트가 열린 칸 번호
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  useEffect(() => {
    getRoutines(db, today).then((st) => {
      const x = st.routines.find((y) => y.id === routineId) ?? null;
      setR(x);
      setActive(st.activeId === routineId);
      if (x) {
        setName((cur) => (cur === '' ? x.name : cur));
        // 처음 열 때: 아직 날이 없는 새 루틴이면 1단계부터, 이미 만든 루틴이면 확인 단계(거기서 원하는 단계로 이동)
        setStepState((cur) => cur ?? (x.days.length === 0 ? 'type' : 'done'));
      }
    });
  }, [db, today, version, routineId]);

  const setStep = (k: StepKey) => { lastStep.set(routineId, k); setStepState(k); };

  if (!r || !step) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="루틴" onBack={nav.close} /></View>;

  const steps: StepKey[] = r.mode === 'cycle' ? ['type', 'repeat', 'days', 'layout', 'done'] : ['type', 'days', 'layout', 'done'];
  const cur: StepKey = steps.includes(step) ? step : 'type';
  const idx = steps.indexOf(cur);
  const dayName = (id: string | null) => (id ? r.days.find((d) => d.id === id)?.name ?? null : null);
  const order = slotOrder(r);
  const placed = r.slots.filter(Boolean).length;
  const unplaced = unplacedDays(r);
  const len = r.slots.length;
  const todayNo = cycleDayNumber(r, today);

  const commitName = async () => { if (name.trim() && name.trim() !== r.name) { await renameRoutine(db, today, r.id, name); bump(); } };
  const go = async (to: StepKey) => { await commitName(); setStep(to); };
  const next = () => { if (idx < steps.length - 1) go(steps[idx + 1]); };
  const prev = () => { if (idx > 0) go(steps[idx - 1]); };

  const changeMode = (m: RoutineMode) => {
    if (m === r.mode) return;
    const { lost } = convertMode(r, m);
    const apply = async () => { await setRoutineMode(db, today, r.id, m); bump(); };
    if (lost > 0) {
      Alert.alert('방식을 바꿀까요?', `요일 방식은 7칸이라 Day 8 이후에 놓은 날 ${lost}개는 칸에서 빠져요. 만든 날은 그대로 남습니다.`, [
        { text: '취소' }, { text: '바꾸기', onPress: apply },
      ]);
    } else apply();
  };

  const changeRepeat = (n: number) => {
    const v = Math.max(1, Math.min(MAX_REPEAT, n));
    if (v === len) return;
    const apply = async () => { await setRepeatDays(db, today, r.id, v); bump(); };
    if (v < len && r.slots.slice(v).some(Boolean)) {
      Alert.alert('반복 일수를 줄일까요?', `Day ${v + 1} 이후 칸에 놓은 날은 칸에서 빠져요. 만든 날은 그대로 남습니다.`, [
        { text: '취소' }, { text: '줄이기', onPress: apply },
      ]);
    } else apply();
  };

  /** 손잡이로 끌어서 칸의 내용을 옮긴다. 칸 이름(Day 1, 월 …)은 제자리에 두고 날만 움직인다. */
  const reorderSlots = async (from: number, to: number) => {
    const shown = order.map((i) => r.slots[i]);
    const moved = moveItem(shown, from, to);
    const slots = [...r.slots];
    order.forEach((slotIdx, pos) => { slots[slotIdx] = moved[pos]; });
    await setRoutineSlots(db, today, r.id, slots);
    bump();
  };

  /* ---------------- 단계별 내용 ---------------- */
  const body = () => {
    if (cur === 'type') {
      return (
        <>
          <Card>
            <T muted style={{ marginBottom: 6 }}>루틴 이름</T>
            <TextField value={name} onChangeText={setName} onEndEditing={commitName} placeholder="예: 3분할 루틴" />
          </Card>
          <T muted style={{ marginBottom: 6 }}>방식</T>
          {([
            ['cycle', 'N일 반복', '며칠을 한 바퀴로 정해 두고, 끝나면 처음부터 다시 시작해요. 요일과 상관없이 돌아가요.\n예) 4일 반복: Day 1 가슴 → Day 2 등 → Day 3 휴식 → Day 4 하체'],
            ['weekday', '요일 고정', '월~일 요일마다 무엇을 할지 정해요. 매주 같은 요일에 같은 운동을 해요.\n예) 월 가슴 · 수 등 · 금 하체'],
          ] as [RoutineMode, string, string][]).map(([k, t, d]) => (
            <Pressable key={k} onPress={() => changeMode(k)}>
              <Card style={r.mode === k ? { borderColor: C.accent, borderWidth: 2 } : undefined}>
                <Row>
                  <T bold style={{ flex: 1, fontSize: 16 }}>{t}</T>
                  <T bold>{r.mode === k ? '✓' : ''}</T>
                </Row>
                <T muted style={{ fontSize: 12, marginTop: 4 }}>{d}</T>
              </Card>
            </Pressable>
          ))}
        </>
      );
    }
    if (cur === 'repeat') {
      return (
        <>
          <Card>
            <T muted style={{ marginBottom: 8 }}>며칠마다 처음으로 돌아갈까요?</T>
            <Row>
              <Btn label="−" kind="ghost" onPress={() => changeRepeat(len - 1)} />
              <T bold style={{ flex: 1, textAlign: 'center', fontSize: 28 }}>{len}일</T>
              <Btn label="+" kind="ghost" onPress={() => changeRepeat(len + 1)} />
            </Row>
            <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: S.md }}>
              {[3, 4, 5, 6, 7, 10, 14].map((n) => (
                <Btn key={n} label={`${n}일`} kind={len === n ? 'primary' : 'ghost'} small onPress={() => changeRepeat(n)} />
              ))}
            </Row>
            <T muted style={{ fontSize: 12, marginTop: S.md }}>
              Day 1부터 Day {len}까지 한 바퀴 돌고, 다음 날 다시 Day 1이에요. 최대 {MAX_REPEAT}일까지 정할 수 있어요.
            </T>
          </Card>
          <Card>
            <T muted style={{ marginBottom: 8 }}>오늘은 몇 일차인가요?</T>
            <Row>
              <Btn label="−" kind="ghost" small onPress={async () => { await setRoutineStart(db, today, r.id, startForDayNumber(today, ((todayNo - 2 + len) % len) + 1, len)); bump(); }} />
              <T bold style={{ flex: 1, textAlign: 'center', fontSize: 18 }}>Day {todayNo}</T>
              <Btn label="+" kind="ghost" small onPress={async () => { await setRoutineStart(db, today, r.id, startForDayNumber(today, (todayNo % len) + 1, len)); bump(); }} />
            </Row>
            <T muted style={{ fontSize: 12, marginTop: S.sm }}>오늘을 기준으로 일정이 이어져요. 나중에 바꿀 수도 있어요.</T>
          </Card>
        </>
      );
    }
    if (cur === 'days') {
      return (
        <>
          {r.days.length === 0 && <T muted style={{ marginBottom: S.md }}>아직 만든 날이 없어요. ‘+ 날 만들기’로 첫 운동 날을 만들어 보세요.</T>}
          {r.days.map((d) => {
            const where = r.slots.map((s, i) => (s === d.id ? slotName(r.mode, i) : null)).filter(Boolean) as string[];
            return (
              <Card key={d.id}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <T bold>{d.name}{d.kind === 'weights' ? '' : ` · ${KIND_LABEL[d.kind]}`}</T>
                    <T muted style={{ fontSize: 12 }}>{where.length ? `놓인 칸: ${where.join(', ')}` : '아직 칸에 놓지 않았어요'}</T>
                  </View>
                  <Btn label="편집" kind="ghost" small onPress={() => nav.openDay(r.id, d.id)} />
                  <Btn
                    label="✕" kind="danger" small
                    onPress={() => Alert.alert('날 삭제', `‘${d.name}’을(를) 삭제할까요? 놓인 칸은 비워지고, 이미 완료한 기록은 유지됩니다.`, [
                      { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteDay(db, today, r.id, d.id); bump(); } },
                    ])}
                  />
                </Row>
              </Card>
            );
          })}
          <Btn label="+ 날 만들기" onPress={() => nav.openDay(r.id, null)} />
          <T muted style={{ fontSize: 12, marginTop: S.sm }}>새로 만든 날은 처음 비어 있는 칸에 자동으로 놓여요. 다음 단계에서 자유롭게 옮길 수 있어요.</T>
        </>
      );
    }
    if (cur === 'layout') {
      return (
        <>
          <T muted style={{ fontSize: 12, marginBottom: S.sm }}>
            {r.mode === 'cycle'
              ? `Day 1~${len}가 한 바퀴예요. 칸을 눌러 날을 고르고, 오른쪽 ≡ 손잡이를 길게 누른 채 끌어서 옮기세요. 같은 날을 여러 칸에 놓아도 돼요.`
              : '요일마다 날을 고르세요. 같은 날을 여러 요일에 놓아도 되고, 비워 두면 쉬는 날이에요.'}
          </T>
          {unplaced.length > 0 && (
            <Card>
              <T style={{ fontSize: 13 }}>아직 놓지 않은 날: {unplaced.map((d) => d.name).join(', ')}</T>
              <Btn label="빈 칸에 차례로 채우기" kind="ghost" small style={{ marginTop: S.sm }} onPress={async () => { await autoFillRoutine(db, today, r.id); bump(); }} />
            </Card>
          )}
          <ReorderList<{ slotIdx: number; id: string | null }>
            items={order.map((slotIdx) => ({ slotIdx, id: r.slots[slotIdx] }))}
            keyOf={(x) => String(x.slotIdx)}
            scroll={{ ref: scrollRef, offset: scrollY }}
            onDragChange={setDragging}
            onReorder={reorderSlots}
            renderItem={({ slotIdx, id }, _pos, handle) => {
              const nm = dayName(id);
              const isToday = active && (r.mode === 'cycle' ? slotIdx + 1 === todayNo : slotIdx === weekdayOf(today));
              return (
                <Card style={isToday ? { borderColor: C.accent } : undefined}>
                  <Row>
                    <Pressable
                      onPress={async () => { if (id) { await setSlot(db, today, r.id, slotIdx, null); bump(); } else setSheet(slotIdx); }}
                      style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: C.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: id ? C.accent : 'transparent', marginRight: S.md }}
                    >
                      {id ? <Text style={{ color: C.onAccent, fontWeight: '800' }}>✓</Text> : null}
                    </Pressable>
                    <Pressable style={{ flex: 1 }} onPress={() => setSheet(slotIdx)}>
                      <T muted style={{ fontSize: 12 }}>{r.mode === 'cycle' ? `Day ${slotIdx + 1}` : `${WD_LABEL[slotIdx]}요일`}{isToday ? ' · 오늘' : ''}</T>
                      <T bold style={{ opacity: nm ? 1 : 0.5 }}>{nm ?? '휴식'}</T>
                    </Pressable>
                    {id && <Btn label="편집" kind="ghost" small onPress={() => nav.openDay(r.id, id)} />}
                    {handle}
                  </Row>
                </Card>
              );
            }}
          />
        </>
      );
    }
    // done
    return (
      <>
        <Card>
          <T bold style={{ fontSize: 18 }}>{r.name}</T>
          <T muted style={{ marginTop: 4 }}>
            {r.mode === 'cycle' ? `${len}일 반복 · 오늘은 Day ${todayNo}` : '요일 고정 · 매주 같은 요일'}
          </T>
          <T muted>운동하는 칸 {placed}개 · 쉬는 칸 {len - placed}개 · 만든 날 {r.days.length}개</T>
        </Card>
        <Card>
          {order.map((slotIdx) => (
            <Row key={slotIdx} style={{ paddingVertical: 4 }}>
              <T muted style={{ width: 72 }}>{r.mode === 'cycle' ? `Day ${slotIdx + 1}` : `${WD_LABEL[slotIdx]}요일`}</T>
              <T bold={!!r.slots[slotIdx]} style={{ flex: 1, opacity: r.slots[slotIdx] ? 1 : 0.5 }}>{dayName(r.slots[slotIdx]) ?? '휴식'}</T>
            </Row>
          ))}
        </Card>
        {placed === 0 && <T style={{ marginBottom: S.md }}>아직 칸에 놓은 날이 없어요. ‘3 날 만들기’, ‘4 칸 배치’ 단계에서 정해 주세요.</T>}
        <T muted style={{ fontSize: 12, marginBottom: 6 }}>고치고 싶은 단계를 눌러 이동하세요.</T>
        <Row style={{ flexWrap: 'wrap', gap: 6, marginBottom: S.md }}>
          {steps.slice(0, -1).map((k, i) => <Btn key={k} label={`${i + 1} ${STEP_TITLE[k]}`} kind="ghost" small onPress={() => go(k)} />)}
        </Row>
        {!active && <Btn label="이 루틴 사용하기" style={{ marginBottom: S.sm }} onPress={async () => { await setActiveRoutine(db, today, r.id); bump(); }} />}
        {active && <T bold style={{ textAlign: 'center', marginBottom: S.sm }}>지금 사용 중인 루틴</T>}
        <Btn
          label="루틴 삭제" kind="danger"
          onPress={() => Alert.alert('루틴 삭제', `‘${r.name}’ 루틴과 날별 종목이 삭제됩니다. 이미 완료한 운동 기록과 성장 그래프는 그대로 유지됩니다.`, [
            { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteRoutine(db, today, r.id); lastStep.delete(r.id); bump(); nav.close(); } },
          ])}
        />
      </>
    );
  };

  const last = idx === steps.length - 1;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title={r.days.length === 0 && cur === 'type' ? '루틴 만들기' : '루틴 설정'} onBack={nav.close} />
      <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm }}>
        <Row style={{ gap: 4, marginBottom: 6 }}>
          {steps.map((k, i) => (
            <Pressable key={k} onPress={() => go(k)} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= idx ? C.accent : C.line }} />
          ))}
        </Row>
        <T muted style={{ fontSize: 12 }}>{idx + 1} / {steps.length}</T>
        <T bold style={{ fontSize: 20 }}>{STEP_TITLE[cur]}</T>
        <T muted style={{ fontSize: 12, marginBottom: S.sm }}>{STEP_HINT[cur]}</T>
      </View>
      <ScrollView
        ref={scrollRef} scrollEnabled={!dragging} scrollEventThrottle={16}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        contentContainerStyle={{ padding: S.lg, paddingBottom: 110 }} keyboardShouldPersistTaps="handled"
      >
        {body()}
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line }}>
        <Row>
          <Btn label="이전" kind="ghost" style={{ flex: 1 }} disabled={idx === 0} onPress={prev} />
          {last
            ? <Btn label="완료" style={{ flex: 2 }} onPress={async () => { await commitName(); lastStep.delete(r.id); nav.close(); }} />
            : <Btn label="다음" style={{ flex: 2 }} onPress={next} />}
        </Row>
      </View>

      <Modal visible={sheet != null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={() => setSheet(null)} />
        <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg, paddingBottom: S.lg + insets.bottom, maxHeight: '75%' }}>
          {sheet != null && (
            <>
              <T bold style={{ fontSize: 17, textAlign: 'center', marginBottom: S.sm }}>
                {r.mode === 'cycle' ? `Day ${sheet + 1}` : `${WD_LABEL[sheet]}요일`}에 놓을 날
              </T>
              <ScrollView style={{ marginBottom: S.sm }}>
                <Pressable
                  onPress={async () => { await setSlot(db, today, r.id, sheet, null); setSheet(null); bump(); }}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row' }}
                >
                  <Text style={{ color: C.text, flex: 1, fontWeight: r.slots[sheet] == null ? '800' : '400' }}>휴식 (비워 두기)</Text>
                  {r.slots[sheet] == null ? <Text style={{ color: C.text }}>✓</Text> : null}
                </Pressable>
                {r.days.map((d) => (
                  <Pressable
                    key={d.id}
                    onPress={async () => { await setSlot(db, today, r.id, sheet, d.id); setSheet(null); bump(); }}
                    style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row' }}
                  >
                    <Text style={{ color: C.text, flex: 1, fontWeight: r.slots[sheet] === d.id ? '800' : '400' }}>{d.name}{d.kind === 'weights' ? '' : ` · ${KIND_LABEL[d.kind]}`}</Text>
                    {r.slots[sheet] === d.id ? <Text style={{ color: C.text }}>✓</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
              <Btn label="+ 새 날 만들어서 놓기" kind="ghost" onPress={() => { const s = sheet; setSheet(null); nav.openDay(r.id, null, s); }} />
              <Btn label="닫기" kind="ghost" style={{ marginTop: S.sm }} onPress={() => setSheet(null)} />
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}
