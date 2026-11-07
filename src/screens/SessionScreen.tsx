import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, Vibration, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addCardio, addSessionExercise, addSet, deleteSet, deleteSession, finishSession, getRestDefault, getSessionRests, getWeightStep, lastPerformance,
  loadSession, removeSessionExercise, reopenSession, saveSessionAsDay, setExerciseNote,
  setSessionNote, updateSet, type SessionExRow, type SessionFull, type SetRow,
} from '../db/repo.ts';
import { matchProfile } from '../domain/exerciseCatalog.ts';
import type { Focus } from '../domain/liveCount.ts';
import { fmtClock, fmtDuration, fmtElapsed, restFor, suggestFor } from '../domain/format.ts';
import { LiveCountModal } from '../ui/LiveCountModal.tsx';
import { Btn, Card, Chip, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { C, S } from '../ui/theme.ts';
import { useElapsed } from '../ui/useElapsed.ts';

type Last = { weight: number | null; reps: number | null };
type Focus = { setId: string; field: 'weight' | 'reps' } | null;
type Rest = { endAt: number; total: number; done: boolean } | null;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const { db, today, nav, bump } = useApp();
  const [s, setS] = useState<SessionFull | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [opts, setOpts] = useState<Record<string, boolean>>({}); // 종목별 '옵션'(메모·준비 세트·삭제) 펼침
  const [picker, setPicker] = useState(false);
  const [lasts, setLasts] = useState<Record<string, Last | null>>({}); // 세션 종목 id → 지난 기록
  const [step, setStep] = useState(2.5);
  const [focus, setFocus] = useState<Focus>(null);
  const [postCardio, setPostCardio] = useState(false);
  const [postCardioMin, setPostCardioMin] = useState<number | null>(null);
  const [saveTplName, setSaveTplName] = useState<string | null>(null);
  const [kindOpen, setKindOpen] = useState<string | null>(null); // 세트 종류(본/준비/1RM) 선택을 펼친 세트
  const [rests, setRests] = useState<Record<string, number | null>>({}); // 세션 종목 id → 루틴에 정해 둔 휴식(초)
  const [restDefault, setRestDefault] = useState(90);
  const [rest, setRest] = useState<Rest>(null); // 세트 사이 휴식 카운트다운
  const [now, setNow] = useState(Date.now());
  const [live, setLive] = useState<{ exId: string; target: number; sets: number; restSec: number; focus: Focus; tip?: string } | null>(null); // 실시간 횟수 세기 중인 종목

  const reload = useCallback(async () => {
    const full = await loadSession(db, sessionId);
    setS(full);
    if (full) {
      const l: Record<string, Last | null> = {};
      for (const e of full.exercises) {
        const p = await lastPerformance(db, e.exercise_id);
        l[e.id] = p ? { weight: p.weight, reps: p.reps } : null;
      }
      setLasts(l);
      setStep(await getWeightStep(db));
      setRests(await getSessionRests(db, sessionId));
      setRestDefault(await getRestDefault(db));
      if (full.template_id) {
        const t = await db.first<{ post_cardio_min: number | null }>('SELECT post_cardio_min FROM workout_templates WHERE id = ?', [full.template_id]);
        setPostCardioMin(t?.post_cardio_min ?? null);
      }
    }
  }, [db, sessionId]);

  useEffect(() => { reload(); }, [reload]);

  // 운동 타이머: 시작 시각 기준이라 앱을 껐다 켜거나 화면을 나갔다 와도 이어서 흐른다
  const elapsed = useElapsed(s?.started_at, s?.status === 'active');

  // 휴식 카운트다운: 끝나면 진동하고 '휴식 끝'을 잠깐 보여 준 뒤 사라진다
  useEffect(() => {
    if (!rest) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [rest]);
  const restLeft = rest ? Math.max(0, Math.ceil((rest.endAt - now) / 1000)) : 0;
  useEffect(() => {
    if (rest && !rest.done && restLeft === 0) {
      Vibration.vibrate([0, 250, 120, 250]);
      setRest({ ...rest, done: true });
    }
  }, [rest, restLeft]);
  useEffect(() => {
    if (!rest?.done) return;
    const t = setTimeout(() => setRest(null), 5000);
    return () => clearTimeout(t);
  }, [rest?.done, rest?.endAt]);

  if (!s) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="불러오는 중" onBack={nav.close} /></View>;

  const editable = s.status === 'active';
  const allSets = s.exercises.flatMap((e) => e.sets);
  const allDone = allSets.length > 0 && allSets.every((x) => x.done);

  /** 입력 즉시 저장(자동 저장): 화면은 낙관적으로 갱신하고 DB에 바로 기록 */
  const patchSet = (ex: SessionExRow, row: SetRow, patch: Parameters<typeof updateSet>[2]) => {
    setS((cur) => cur && {
      ...cur,
      exercises: cur.exercises.map((e) => e.id !== ex.id ? e : {
        ...e,
        sets: e.sets.map((x) => x.id !== row.id ? x : {
          ...x,
          ...('weight' in patch ? { weight: patch.weight ?? null } : {}),
          ...('reps' in patch ? { reps: patch.reps ?? null } : {}),
          ...('done' in patch ? { done: patch.done ? 1 : 0 } : {}),
          ...('setType' in patch ? { set_type: patch.setType! } : {}),
          ...('kind' in patch ? { set_type: patch.kind === 'warmup' ? 'warmup' as const : 'working' as const, is_rm: patch.kind === 'rm' ? 1 : 0 } : {}),
        }),
      }),
    });
    updateSet(db, row.id, patch).then(bump);
  };

  /** 실시간 횟수 세기 결과를 그 종목의 미완료 본 세트 횟수에 차례로 넣는다 (세트가 모자라면 추가) */
  const applyLiveCount = async (exId: string, counts: number[]) => {
    const ex = s.exercises.find((e) => e.id === exId);
    if (!ex || !counts.length) return;
    let free = ex.sets.filter((x) => !x.done && x.set_type !== 'warmup');
    const need = counts.length - free.length;
    for (let i = 0; i < need; i++) await addSet(db, ex.id, 'working');
    if (need > 0) {
      const full = await loadSession(db, sessionId);
      free = (full?.exercises.find((e) => e.id === exId)?.sets ?? []).filter((x) => !x.done && x.set_type !== 'warmup');
    }
    for (let i = 0; i < counts.length && i < free.length; i++) await updateSet(db, free[i].id, { reps: counts[i] });
    bump();
    await reload();
  };

  const finish = async () => {
    const doneSets = allSets.filter((x) => x.done).length;
    const go = async () => {
      await finishSession(db, s.id);
      if (postCardio && postCardioMin) {
        await addCardio(db, { date: s.date, durationMin: postCardioMin, intensity: 'low', kind: 'post_weights', sessionId: s.id });
      }
      setFocus(null);
      setRest(null);
      bump();
      await reload();
    };
    if (doneSets === 0) {
      Alert.alert('완료한 세트가 없습니다', '그래도 운동을 종료할까요? 완료 체크한 세트만 성장 그래프에 반영됩니다.', [
        { text: '계속 기록' }, { text: '종료', onPress: go },
      ]);
    } else await go();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header
        title={s.title}
        onBack={nav.close}
        right={editable ? <T bold style={{ fontSize: 16 }}>{fmtElapsed(elapsed)}</T> : <T muted>{s.date}</T>}
      />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 240 }} keyboardShouldPersistTaps="handled">
        {s.exercises.map((ex) => {
          const open = !collapsed[ex.id];
          const showOpts = !!opts[ex.id];
          const doneN = ex.sets.filter((x) => x.done).length;
          const last = lasts[ex.id] ?? null;
          return (
            <Card key={ex.id} style={{ padding: 0 }}>
              <Pressable onPress={() => setCollapsed((c) => ({ ...c, [ex.id]: open }))} style={{ padding: S.lg }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <T bold style={{ fontSize: 16 }}>{ex.exercise_name}</T>
                    <T muted style={{ fontSize: 12 }}>
                      {doneN}/{ex.sets.length}{ex.weight_mode === 'assisted' ? ' · 보조 중량' : ex.weight_mode === 'bodyweight' ? ' · 체중' : ''}
                      {last?.weight != null ? ` · 지난 기록 ${last.weight}kg × ${last.reps ?? '-'}` : ''}
                    </T>
                  </View>
                  <Text style={{ color: C.muted, fontSize: 18, marginLeft: 8 }}>{open ? '▾' : '▸'}</Text>
                </Row>
              </Pressable>

              {open && (
                <View style={{ paddingHorizontal: S.lg, paddingBottom: S.lg }}>
                  {editable && (
                    <Btn label="📷 실시간 횟수 세기" kind="ghost" small style={{ marginBottom: S.sm }} onPress={() => setLive({
                      exId: ex.id,
                      target: ex.sets.find((x) => x.set_type !== 'warmup' && x.reps)?.reps ?? last?.reps ?? 10,
                      sets: Math.max(1, ex.sets.filter((x) => !x.done && x.set_type !== 'warmup').length || 3),
                      restSec: restFor(rests[ex.id], restDefault) || 60,
                      focus: matchProfile(ex.name)?.focus ?? (ex.weight_mode === 'bodyweight' ? 'body' : 'auto'),
                      tip: matchProfile(ex.name)?.tip,
                    })} />
                  )}
                  {ex.sets.map((row, idx) => {
                    const sugW = suggestFor(ex.sets, idx, (x) => x.weight, last?.weight ?? null);
                    const sugR = suggestFor(ex.sets, idx, (x) => x.reps, last?.reps ?? null);
                    const focused = focus?.setId === row.id ? focus.field : null;
                    return (
                      <View key={row.id} style={{ marginBottom: S.sm }}>
                        <Row>
                          <Pressable
                            disabled={!editable}
                            onPress={() => setKindOpen(kindOpen === row.id ? null : row.id)}
                            onLongPress={() => Alert.alert('세트 삭제', `${row.set_no}세트를 삭제할까요?`, [
                              { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteSet(db, row.id); bump(); reload(); } },
                            ])}
                            style={{ width: 40, alignItems: 'center' }}
                          >
                            <T bold style={{ color: row.set_type === 'warmup' ? C.muted : C.text }}>{row.set_no}</T>
                            {row.set_type === 'warmup' && <T muted style={{ fontSize: 10 }}>준비</T>}
                            {!!row.is_rm && <T bold style={{ fontSize: 10 }}>1RM</T>}
                          </Pressable>
                          <NumInput
                            value={row.weight} suggest={ex.weight_mode === 'bodyweight' ? null : sugW} placeholder={ex.weight_mode === 'bodyweight' ? '+kg' : 'kg'} width={84}
                            onFocus={() => setFocus({ setId: row.id, field: 'weight' })}
                            onCommit={(v) => patchSet(ex, row, { weight: v })}
                          />
                          <T muted>×</T>
                          <NumInput
                            value={row.reps} suggest={sugR} placeholder="회" width={64} decimal={false}
                            onFocus={() => setFocus({ setId: row.id, field: 'reps' })}
                            onCommit={(v) => patchSet(ex, row, { reps: v })}
                          />
                          <Pressable
                            disabled={!editable}
                            onPress={() => {
                              setFocus(null);
                              if (row.done) return patchSet(ex, row, { done: false });
                              // 세트를 끝내면 휴식 카운트다운 시작 (준비 세트·마지막 세트는 제외, 0이면 끔)
                              const allOthersDone = allSets.every((x) => x.id === row.id || x.done);
                              const sec = row.set_type === 'warmup' || allOthersDone ? 0 : restFor(rests[ex.id], restDefault);
                              if (sec > 0) { const t = Date.now(); setNow(t); setRest({ endAt: t + sec * 1000, total: sec, done: false }); }
                              // ✓: 칸에 들어 있는(또는 흐리게 보이던) 숫자를 그대로 이 세트의 기록으로 확정
                              patchSet(ex, row, {
                                done: true,
                                ...(row.weight == null && sugW != null ? { weight: sugW } : {}),
                                ...(row.reps == null && sugR != null ? { reps: sugR } : {}),
                              });
                            }}
                            style={{
                              width: 48, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                              backgroundColor: row.done ? C.accent : C.card2, borderWidth: 1, borderColor: row.done ? C.accent : C.line,
                            }}
                          >
                            <Text style={{ color: row.done ? C.onAccent : C.muted, fontWeight: '800', fontSize: 18 }}>✓</Text>
                          </Pressable>
                        </Row>
                        {editable && kindOpen === row.id && (
                          <Row style={{ marginTop: 6, marginLeft: 40, flexWrap: 'wrap' }}>
                            <Chip label="본 세트" active={row.set_type === 'working' && !row.is_rm} onPress={() => { patchSet(ex, row, { kind: 'working' }); setKindOpen(null); }} />
                            <Chip label="준비 세트" active={row.set_type === 'warmup'} onPress={() => { patchSet(ex, row, { kind: 'warmup' }); setKindOpen(null); }} />
                            <Chip label="1RM 측정" active={!!row.is_rm} onPress={() => { patchSet(ex, row, { kind: 'rm' }); setKindOpen(null); }} />
                            <Btn
                              label="삭제" kind="danger" small
                              onPress={() => Alert.alert('세트 삭제', `${row.set_no}세트를 삭제할까요?`, [
                                { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { setKindOpen(null); await deleteSet(db, row.id); bump(); reload(); } },
                              ])}
                            />
                          </Row>
                        )}
                        {editable && focused && (
                          <Row style={{ marginTop: 6, marginLeft: 40 }}>
                            {(focused === 'weight' ? [-step * 2, -step, step, step * 2] : [-5, -1, 1, 5]).map((d) => (
                              <Btn
                                key={d}
                                label={`${d > 0 ? '+' : '−'}${round2(Math.abs(d))}`}
                                kind="ghost" small style={{ flex: 1 }}
                                onPress={() => {
                                  if (focused === 'weight') patchSet(ex, row, { weight: Math.max(0, round2((row.weight ?? sugW ?? 0) + d)) });
                                  else patchSet(ex, row, { reps: Math.max(0, Math.round((row.reps ?? sugR ?? 0) + d)) });
                                }}
                              />
                            ))}
                          </Row>
                        )}
                      </View>
                    );
                  })}

                  {editable && (
                    <Row style={{ marginTop: 4 }}>
                      <Btn label="+ 세트" kind="ghost" small onPress={async () => { await addSet(db, ex.id, 'working'); reload(); }} />
                      <View style={{ flex: 1 }} />
                      <Btn label={showOpts ? '옵션 닫기' : '옵션'} kind="ghost" small onPress={() => setOpts((o) => ({ ...o, [ex.id]: !showOpts }))} />
                    </Row>
                  )}

                  {showOpts && (
                    <View style={{ marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
                      <TextField
                        defaultValue={ex.note ?? ''}
                        placeholder="종목 메모"
                        editable={editable}
                        onEndEditing={(e) => setExerciseNote(db, ex.id, e.nativeEvent.text)}
                      />
                      {editable && (
                        <Row style={{ marginTop: S.md }}>
                          <Btn label="+ 준비 세트" kind="ghost" small onPress={async () => { await addSet(db, ex.id, 'warmup'); reload(); }} />
                          <View style={{ flex: 1 }} />
                          <Btn
                            label="종목 삭제" kind="danger" small
                            onPress={() => Alert.alert('종목 삭제', `${ex.exercise_name} 기록을 이 운동에서 삭제할까요?`, [
                              { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await removeSessionExercise(db, ex.id); bump(); reload(); } },
                            ])}
                          />
                        </Row>
                      )}
                      <T muted style={{ fontSize: 11, marginTop: S.sm }}>세트 번호를 누르면 본 / 준비 / 1RM 측정을 고르거나 삭제할 수 있어요</T>
                    </View>
                  )}
                </View>
              )}
            </Card>
          );
        })}

        {editable && <Btn label="+ 종목 추가" kind="ghost" onPress={() => setPicker(true)} style={{ marginBottom: S.md }} />}

        <Card>
          <T muted style={{ marginBottom: 6 }}>운동 메모</T>
          <TextField
            defaultValue={s.note ?? ''}
            placeholder="컨디션, 느낌, 특이사항"
            multiline
            editable={editable}
            onEndEditing={(e) => setSessionNote(db, s.id, e.nativeEvent.text)}
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />
        </Card>

        {editable && postCardioMin ? (
          <Card>
            <Row>
              <View style={{ flex: 1 }}>
                <T bold>웨이트 후 유산소 {postCardioMin}분</T>
                <T muted style={{ fontSize: 12 }}>선택 항목 · 완료 시 함께 기록</T>
              </View>
              <Switch value={postCardio} onValueChange={setPostCardio} trackColor={{ true: C.accent }} />
            </Row>
          </Card>
        ) : null}

        {s.status === 'done' && (
          <Card>
            <T bold style={{ marginBottom: 2 }}>
              {fmtClock(s.started_at)} – {fmtClock(s.ended_at)}{s.duration_sec != null ? ` · 총 ${fmtDuration(s.duration_sec)}` : ''}
            </T>
            <T muted style={{ marginBottom: 8 }}>완료된 기록입니다. 수정하면 그래프에 자동 반영됩니다.</T>
            <Row>
              <Btn label="기록 수정" kind="ghost" onPress={async () => { await reopenSession(db, s.id); bump(); reload(); }} style={{ flex: 1 }} />
              <Btn
                label="기록 삭제" kind="danger"
                onPress={() => Alert.alert('운동 기록 삭제', '이 운동의 모든 세트 기록이 삭제되고 그래프에서도 사라집니다.', [
                  { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteSession(db, s.id); bump(); nav.close(); } },
                ])}
              />
            </Row>
          </Card>
        )}

        {s.is_free === 1 && (
          <Card>
            {saveTplName == null ? (
              <Btn label="이 운동을 루틴의 새 날로 저장" kind="ghost" onPress={() => setSaveTplName(s.title === '자유 운동' ? `자유 루틴 ${s.date}` : s.title)} />
            ) : (
              <>
                <TextField value={saveTplName} onChangeText={setSaveTplName} placeholder="날 이름" />
                <Row style={{ marginTop: S.sm }}>
                  <Btn
                    label="저장" small
                    onPress={async () => {
                      if (!saveTplName.trim()) return;
                      await saveSessionAsDay(db, today, s.id, saveTplName.trim());
                      setSaveTplName(null);
                      bump();
                      Alert.alert('저장됨', '사용 중인 루틴에 새 날로 추가했어요. 루틴 탭에서 확인할 수 있습니다.');
                    }}
                  />
                  <Btn label="취소" kind="ghost" small onPress={() => setSaveTplName(null)} />
                </Row>
              </>
            )}
          </Card>
        )}
      </ScrollView>

      {editable && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line }}>
          {rest && (
            <Row style={{ marginBottom: S.sm, padding: S.md, borderRadius: 12, backgroundColor: C.card2, borderWidth: 1, borderColor: rest.done ? C.accent : C.line }}>
              <T bold style={{ flex: 1, fontSize: 16 }}>{rest.done ? '휴식 끝 · 다음 세트' : `휴식 ${fmtElapsed(restLeft)}`}</T>
              {!rest.done && <Btn label="+30초" kind="ghost" small onPress={() => setRest({ ...rest, endAt: rest.endAt + 30000, total: rest.total + 30 })} />}
              <Btn label={rest.done ? '닫기' : '건너뛰기'} kind="ghost" small onPress={() => setRest(null)} />
            </Row>
          )}
          <Row style={{ justifyContent: 'space-between', marginBottom: S.sm }}>
            <T muted>시작 {fmtClock(s.started_at)}</T>
            <T bold style={{ fontSize: 22 }}>{fmtElapsed(elapsed)}</T>
          </Row>
          <Row>
            <Btn
              label="운동 취소" kind="danger"
              onPress={() => Alert.alert('운동 취소', '이 운동 기록을 모두 삭제할까요?', [
                { text: '계속 기록' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteSession(db, s.id); bump(); nav.close(); } },
              ])}
            />
            <Btn label={allDone ? '타이머 종료' : '운동 종료'} kind={allDone ? 'primary' : 'ghost'} onPress={finish} style={{ flex: 1 }} />
          </Row>
        </View>
      )}

      <LiveCountModal
        visible={!!live}
                defaults={live ? { targetReps: live.target, totalSets: live.sets, restSec: live.restSec, focus: live.focus, tip: live.tip } : undefined}
        onClose={() => setLive(null)}
        onUse={(counts) => { const l = live; setLive(null); if (l) applyLiveCount(l.exId, counts); }}
      />
      <ExercisePicker
        visible={picker}
        newMode={s.title === '맨몸 운동' ? 'bodyweight' : undefined}
        onClose={() => setPicker(false)}
        onPick={async (e) => { setPicker(false); await addSessionExercise(db, s.id, e.id); bump(); reload(); }}
      />
    </View>
  );
}
