import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addCardio, addSessionExercise, addSet, deleteSet, deleteSession, finishSession, lastPerformance,
  loadSession, removeSessionExercise, reopenSession, saveSessionAsTemplate, setExerciseIntensity, setExerciseNote,
  setSessionIntensity, setSessionNote, updateSet, type SessionExRow, type SessionFull, type SetRow,
} from '../db/repo.ts';
import { resolveIntensity } from '../domain/intensity.ts';
import type { Intensity } from '../domain/types.ts';
import { Btn, Card, Header, IntensityBadge, IntensityPicker, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { C, S } from '../ui/theme.ts';

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const { db, nav, bump } = useApp();
  const [s, setS] = useState<SessionFull | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [opts, setOpts] = useState<Record<string, boolean>>({}); // 종목별 '옵션'(강도·메모·준비 세트) 펼침
  const [picker, setPicker] = useState(false);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [postCardio, setPostCardio] = useState(false);
  const [postCardioMin, setPostCardioMin] = useState<number | null>(null);
  const [saveTplName, setSaveTplName] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const full = await loadSession(db, sessionId);
    setS(full);
    if (full) {
      const h: Record<string, string> = {};
      for (const e of full.exercises) {
        const p = await lastPerformance(db, e.exercise_id);
        if (p) h[e.id] = `지난 기록 ${p.weight}kg × ${p.reps ?? '-'}`;
      }
      setHints(h);
      if (full.template_id) {
        const t = await db.first<{ post_cardio_min: number | null }>('SELECT post_cardio_min FROM workout_templates WHERE id = ?', [full.template_id]);
        setPostCardioMin(t?.post_cardio_min ?? null);
      }
    }
  }, [db, sessionId]);

  useEffect(() => { reload(); }, [reload]);

  // 운동 시간 타이머 (진행 중일 때만)
  useEffect(() => {
    if (!s || s.status !== 'active') return;
    const start = new Date(s.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [s?.status, s?.started_at]);

  if (!s) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="불러오는 중" onBack={nav.close} /></View>;

  const editable = s.status === 'active';

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
          ...('intensity' in patch ? { intensity: patch.intensity ?? null } : {}),
        }),
      }),
    });
    updateSet(db, row.id, patch).then(bump);
  };

  const finish = async () => {
    const doneSets = s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);
    const go = async () => {
      await finishSession(db, s.id);
      if (postCardio && postCardioMin) {
        await addCardio(db, { date: s.date, durationMin: postCardioMin, intensity: 'low', kind: 'post_weights', sessionId: s.id });
      }
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
        right={editable ? <T bold style={{ color: C.accent, fontSize: 16 }}>{fmtElapsed(elapsed)}</T> : <T muted>{s.date}</T>}
      />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Card>
          <T muted style={{ marginBottom: 6 }}>오늘 강도</T>
          <IntensityPicker
            value={s.intensity ?? 'none'}
            allowInherit={false}
            onChange={async (v) => { await setSessionIntensity(db, s.id, v === 'none' ? null : v); bump(); reload(); }}
          />
        </Card>

        {s.exercises.map((ex) => {
          const open = !collapsed[ex.id];
          const showOpts = !!opts[ex.id];
          const doneN = ex.sets.filter((x) => x.done).length;
          const exEff = resolveIntensity(null, ex.intensity, s.intensity);
          return (
            <Card key={ex.id} style={{ padding: 0 }}>
              <Pressable onPress={() => setCollapsed((c) => ({ ...c, [ex.id]: open }))} style={{ padding: S.lg }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <T bold style={{ fontSize: 16 }}>{ex.exercise_name}</T>
                    <T muted style={{ fontSize: 12 }}>
                      {doneN}/{ex.sets.length}{ex.weight_mode === 'assisted' ? ' · 보조 중량' : ex.weight_mode === 'bodyweight' ? ' · 체중' : ''}
                      {hints[ex.id] ? ` · ${hints[ex.id]}` : ''}
                    </T>
                  </View>
                  {exEff !== 'none' && <IntensityBadge value={exEff} />}
                  <Text style={{ color: C.muted, fontSize: 18, marginLeft: 8 }}>{open ? '▾' : '▸'}</Text>
                </Row>
              </Pressable>

              {open && (
                <View style={{ paddingHorizontal: S.lg, paddingBottom: S.lg }}>
                  {ex.sets.map((row) => {
                    const eff = resolveIntensity(row.intensity, ex.intensity, s.intensity);
                    return (
                      <Row key={row.id} style={{ marginBottom: S.sm }}>
                        <Pressable
                          disabled={!editable || !showOpts}
                          onPress={() => patchSet(ex, row, { setType: row.set_type === 'warmup' ? 'working' : 'warmup' })}
                          onLongPress={() => Alert.alert('세트 삭제', `${row.set_no}세트를 삭제할까요?`, [
                            { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteSet(db, row.id); bump(); reload(); } },
                          ])}
                          style={{ width: 40, alignItems: 'center' }}
                        >
                          <T bold style={{ color: row.set_type === 'warmup' ? C.muted : C.text }}>{row.set_no}</T>
                          {row.set_type === 'warmup' && <T muted style={{ fontSize: 10 }}>준비</T>}
                        </Pressable>
                        <NumInput value={row.weight} onCommit={(v) => patchSet(ex, row, { weight: v })} placeholder="kg" width={84} />
                        <T muted>×</T>
                        <NumInput value={row.reps} onCommit={(v) => patchSet(ex, row, { reps: v })} placeholder="회" width={64} decimal={false} />
                        <Pressable
                          disabled={!editable}
                          onPress={() => patchSet(ex, row, { done: !row.done })}
                          style={{
                            width: 48, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                            backgroundColor: row.done ? C.accent : C.card2, borderWidth: 1, borderColor: row.done ? C.accent : C.line,
                          }}
                        >
                          <Text style={{ color: row.done ? C.onAccent : C.muted, fontWeight: '800', fontSize: 18 }}>✓</Text>
                        </Pressable>
                        {showOpts && (
                          <Pressable
                            disabled={!editable}
                            onPress={() => {
                              // 세트 강도 순환: 상속 → 고 → 중 → 저 → 미지정(명시) → 상속
                              const order: (Intensity | null)[] = [null, 'high', 'mid', 'low', 'none'];
                              patchSet(ex, row, { intensity: order[(order.indexOf(row.intensity) + 1) % order.length] });
                            }}
                            style={{ flex: 1, alignItems: 'center' }}
                          >
                            <IntensityBadge value={eff} />
                            <T muted style={{ fontSize: 9 }}>{row.intensity ? '세트 지정' : '상속'}</T>
                          </Pressable>
                        )}
                      </Row>
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
                      <T muted style={{ fontSize: 12, marginBottom: 6 }}>종목 강도</T>
                      <IntensityPicker
                        value={ex.intensity}
                        allowInherit
                        compact
                        onChange={async (v) => { await setExerciseIntensity(db, ex.id, v); bump(); reload(); }}
                      />
                      <TextField
                        defaultValue={ex.note ?? ''}
                        placeholder="종목 메모"
                        editable={editable}
                        onEndEditing={(e) => setExerciseNote(db, ex.id, e.nativeEvent.text)}
                        style={{ marginTop: S.md }}
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
                      <T muted style={{ fontSize: 11, marginTop: S.sm }}>세트 번호 탭: 준비/본 전환 · 길게 누름: 삭제 · 오른쪽 라벨 탭: 세트 강도</T>
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
                <T bold>웨이트 후 저강도 유산소 {postCardioMin}분</T>
                <T muted style={{ fontSize: 12 }}>선택 항목 · 완료 시 함께 기록</T>
              </View>
              <Switch value={postCardio} onValueChange={setPostCardio} trackColor={{ true: C.accent }} />
            </Row>
          </Card>
        ) : null}

        {s.status === 'done' && (
          <Card>
            <T muted style={{ marginBottom: 8 }}>
              완료된 기록입니다{s.duration_sec ? ` · 운동 시간 ${fmtElapsed(s.duration_sec)}` : ''}. 수정하면 그래프에 자동 반영됩니다.
            </T>
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
              <Btn label="이 운동을 새 루틴으로 저장" kind="ghost" onPress={() => setSaveTplName(s.title === '자유 운동' ? `자유 루틴 ${s.date}` : s.title)} />
            ) : (
              <>
                <TextField value={saveTplName} onChangeText={setSaveTplName} placeholder="루틴 이름" />
                <Row style={{ marginTop: S.sm }}>
                  <Btn
                    label="저장" small
                    onPress={async () => {
                      if (!saveTplName.trim()) return;
                      await saveSessionAsTemplate(db, s.id, saveTplName.trim());
                      setSaveTplName(null);
                      bump();
                      Alert.alert('저장됨', '운동 탭의 루틴 목록에서 확인할 수 있습니다.');
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
          <Row>
            <Btn
              label="운동 취소" kind="danger"
              onPress={() => Alert.alert('운동 취소', '이 운동 기록을 모두 삭제할까요?', [
                { text: '계속 기록' }, { text: '삭제', style: 'destructive', onPress: async () => { await deleteSession(db, s.id); bump(); nav.close(); } },
              ])}
            />
            <Btn label="운동 완료" onPress={finish} style={{ flex: 1 }} />
          </Row>
        </View>
      )}

      <ExercisePicker
        visible={picker}
        onClose={() => setPicker(false)}
        onPick={async (e) => { setPicker(false); await addSessionExercise(db, s.id, e.id); bump(); reload(); }}
      />
    </View>
  );
}
