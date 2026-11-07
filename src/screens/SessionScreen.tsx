import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, Vibration, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addCardio, addSessionExercise, addSet, deleteSet, deleteSession, finishSession, getExerciseRest, getLastSets, getRestDefault, getSessionRests, getSetting, setSetting, listDoneDates, setExerciseRestFor, setRestDefault, getWeightStep, lastPerformance, loadCategoryMap,
  loadSession, removeSessionExercise, reopenSession, saveSessionAsDay, setExerciseNote, setExerciseRest,
  setSessionExerciseMode, setSessionNote, updateSet, type SessionExRow, type SessionFull, type SetRow,
} from '../db/repo.ts';
import { matchProfile, partOf, WEIGHT_LABEL, type Equip } from '../domain/exerciseCatalog.ts';
import { bestE1rm, doneWorkingCount, e1rm, recommendNext, streakWeeks, volumeOf } from '../domain/workoutStats.ts';
import { SetSheet } from '../ui/SetSheet.tsx';
import { SummaryModal, type SummaryData } from '../ui/SummaryModal.tsx';
import { currentOf, restAfter, type GEx } from '../domain/guided.ts';
import type { Focus as LiveFocus } from '../domain/liveCount.ts';
import { speakText } from '../services/speak.ts';
import { fmtClock, fmtDuration, fmtElapsed, restFor, suggestFor } from '../domain/format.ts';
import { LiveCountModal, type CountSource } from '../ui/LiveCountModal.tsx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RUN_LABEL, sanitizeRunMode, type RunMode } from '../domain/condition.ts';
import { countWord } from '../domain/liveCount.ts';
import { Btn, Card, Chip, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { ExercisePicker } from '../ui/ExercisePicker.tsx';
import { C, S } from '../ui/theme.ts';
import { useElapsed } from '../ui/useElapsed.ts';

type Last = { weight: number | null; reps: number | null };
type Focus = { setId: string; field: 'weight' | 'reps' } | null;
type Rest = { endAt: number; total: number; done: boolean; kind: 'set' | 'exercise'; exId?: string; next?: string; nextTip?: string; nextExId?: string } | null;

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
  const [sheet, setSheet] = useState<{ exId: string; setId: string } | null>(null); // 입력 시트가 열린 세트
  const [lastSets, setLastSets] = useState<Record<string, { weight: number | null; reps: number | null }[]>>({}); // 세션 종목 id → 지난 운동의 완료 세트
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [barKg, setBarKg] = useState(20);
  const [rests, setRests] = useState<Record<string, number | null>>({}); // 세션 종목 id → 루틴에 정해 둔 휴식(초)
  const [restDefault, setRestDefault] = useState(90);
  const [rest, setRest] = useState<Rest>(null); // 세트 사이 휴식 카운트다운
  const [now, setNow] = useState(Date.now());
  const [guided, setGuided] = useState<boolean | null>(null); // null이면 루틴으로 시작한 운동만 '한 종목씩 보기'
  const [deferred, setDeferred] = useState<string[]>([]); // 나중에 하기로 미룬 종목(덩어리의 첫 종목 id)
  const [skipped, setSkipped] = useState<string[]>([]); // 건너뛴 종목 id
  const [exRest, setExRest] = useState(180);
  const [live, setLive] = useState<{ exId: string; target: number; sets: number; restSec: number; focus: LiveFocus; tip?: string; source: CountSource } | null>(null); // 실시간 횟수 세기 중인 종목
  const [runMode, setRunMode] = useState<RunMode>('manual'); // 진행 방식: 직접 기록 / 카메라 / 박자
  const [prepSec, setPrepSec] = useState(10);
  const [tempoSec, setTempoSec] = useState(3);
  const [restMini, setRestMini] = useState(false); // 휴식 화면을 작게(아래 줄) 보기
  const insets = useSafeAreaInsets();

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
      const ls: Record<string, { weight: number | null; reps: number | null }[]> = {};
      for (const e of full.exercises) ls[e.id] = await getLastSets(db, e.exercise_id, full.id);
      setLastSets(ls);
      const bk = Number(await getSetting(db, 'bar_kg'));
      setBarKg(Number.isFinite(bk) && bk > 0 ? bk : 20);
      setStep(await getWeightStep(db));
      setRests(await getSessionRests(db, sessionId));
      setRestDefault(await getRestDefault(db));
      setExRest(await getExerciseRest(db));
      setRunMode(sanitizeRunMode(await getSetting(db, 'run_mode')));
      const rawPrep = await getSetting(db, 'prep_sec');
      const ps = rawPrep == null ? 10 : Number(rawPrep);
      setPrepSec(Number.isFinite(ps) && ps >= 0 ? ps : 10);
      const ts = Number(await getSetting(db, 'tempo_sec'));
      setTempoSec(Number.isFinite(ts) && ts >= 1 ? ts : 3);
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
      if (rest.kind === 'exercise' && rest.next) speakText(`휴식 끝. 다음 운동, ${rest.next}`);
      else if (rest.kind === 'set') speakText('휴식 끝, 다음 세트 시작');
      setRest({ ...rest, done: true });
    }
  }, [rest, restLeft]);
  // 끝나기 3초 전부터 3·2·1을 소리로 알려 준다
  useEffect(() => {
    if (rest && !rest.done && restLeft > 0 && restLeft <= 3) speakText(countWord(restLeft));
  }, [restLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rest?.done) return;
    const t = setTimeout(() => setRest(null), 5000);
    return () => clearTimeout(t);
  }, [rest?.done, rest?.endAt]);

  if (!s) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="불러오는 중" onBack={nav.close} /></View>;

  const editable = s.status === 'active';
  const allSets = s.exercises.flatMap((e) => e.sets);
  const allDone = allSets.length > 0 && allSets.every((x) => x.done);

  // 한 종목씩 보기: 지금 할 덩어리(슈퍼세트면 묶인 종목들)만 보여 준다. 다 끝나면 전체 목록으로
  const gex: GEx[] = s.exercises.map((e) => ({ id: e.id, name: e.exercise_name, ss: e.ss, sets: e.sets.map((x) => ({ id: x.id, done: x.done, set_type: x.set_type })) }));
  const guidedOn = editable && (guided ?? !!s.template_id);
  const cur = guidedOn ? currentOf(gex, deferred, skipped) : null;
  const shownExercises = cur ? s.exercises.filter((e) => cur.block.some((b) => b.id === e.id)) : s.exercises;
  const nameOf = (id: string) => s.exercises.find((e) => e.id === id)?.exercise_name ?? '';

  const openLive = (ex: SessionExRow, source: CountSource = runMode === 'tempo' ? 'tempo' : 'camera') => setLive({
    source,
    exId: ex.id,
    target: ex.sets.find((x) => x.set_type !== 'warmup' && x.reps)?.reps ?? lasts[ex.id]?.reps ?? 10,
    sets: Math.max(1, ex.sets.filter((x) => !x.done && x.set_type !== 'warmup').length || 3),
    restSec: restFor(rests[ex.id], restDefault) || 60,
    focus: matchProfile(ex.exercise_name)?.focus ?? (ex.weight_mode === 'bodyweight' ? 'body' : 'auto'),
    tip: matchProfile(ex.exercise_name)?.tip,
  });

  /** 휴식 시간 조절: 세트 간은 10초, 종목 간은 30초 단위. 종목 간 휴식이면 그 값이 다음부터의 기본값이 된다 */
  const adjustRest = (d: number) => {
    if (!rest || rest.done) return;
    const total = Math.max(rest.kind === 'exercise' ? 30 : 10, rest.total + d);
    const delta = total - rest.total;
    setRest({ ...rest, total, endAt: rest.endAt + delta * 1000 });
    if (rest.kind === 'exercise') { setExRest(total); setExerciseRest(db, total); }
  };

  /** 세트 간 휴식 시간을 이 종목만 / 모든 종목에 저장 */
  const saveSetRest = () => {
    if (!rest) return;
    const curEx = s.exercises.find((e) => e.id === rest.exId);
    Alert.alert('휴식 시간 저장', `${fmtElapsed(rest.total)}을 어디에 쓸까요?`, [
      { text: '취소', style: 'cancel' },
      ...(curEx ? [{ text: '이 종목만', onPress: async () => { await setExerciseRestFor(db, curEx.exercise_id, rest.total); reload(); } }] : []),
      { text: '모든 종목에', onPress: async () => { await setRestDefault(db, rest.total); reload(); } },
    ]);
  };
  /** 휴식 화면의 '다음' 안내: 세트 간이면 다음 세트와 무게·횟수, 종목 간이면 다음 종목 */
  const restNext = (() => {
    if (!rest) return null;
    const exOf = rest.kind === 'set' ? s.exercises.find((e) => e.id === rest.exId) : s.exercises.find((e) => e.id === rest.nextExId);
    const ns = exOf?.sets.find((x) => !x.done && x.set_type !== 'warmup');
    const detail = ns ? `${ns.set_no}세트${ns.weight != null ? ` · ${ns.weight}kg` : ''}${ns.reps != null ? ` × ${ns.reps}회` : ''}` : '';
    if (rest.kind === 'set') return exOf && ns ? { title: `다음 세트 | ${detail}`, tip: undefined } : null;
    return rest.next ? { title: `다음 종목 | ${rest.next}${detail ? `\n${detail}` : ''}`, tip: rest.nextTip } : null;
  })();

  /** 지금 종목(덩어리) 끝내기: 남은 세트를 지우거나 건너뜀으로 남긴다 */
  const finishBlock = () => {
    if (!cur) return;
    const ids = cur.block.map((b) => b.id);
    const undone = s.exercises.filter((e) => ids.includes(e.id)).flatMap((e) => e.sets.filter((x) => !x.done));
    if (!undone.length) return;
    Alert.alert('남은 세트가 있어요', `${undone.length}세트를 어떻게 할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '건너뜀으로 남기기', onPress: () => setSkipped((k) => [...k, ...ids]) },
      { text: '남은 세트 지우기', style: 'destructive', onPress: async () => { for (const x of undone) await deleteSet(db, x.id); bump(); reload(); } },
    ]);
  };

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
      // 완료 요약 카드 (완료한 세트가 있을 때만)
      const full = await loadSession(db, s.id);
      if (full && doneSets > 0) {
        const dates = await listDoneDates(db);
        const cats = await loadCategoryMap(db);
        setSummary({
          title: full.title, date: full.date, durationSec: full.duration_sec,
          volume: full.exercises.reduce((n, e) => n + volumeOf(e.sets), 0),
          sets: full.exercises.reduce((n, e) => n + doneWorkingCount(e.sets), 0),
          streak: streakWeeks(dates, today),
          exercises: full.exercises.filter((e) => doneWorkingCount(e.sets) > 0).map((e) => ({
            name: e.exercise_name, sets: doneWorkingCount(e.sets), e1rm: bestE1rm(e.sets), part: partOf(e.exercise_name, cats.get(e.exercise_id)),
          })),
        });
      }
    };
    const undone = allSets.filter((x) => !x.done).length;
    if (doneSets === 0) {
      Alert.alert('완료한 세트가 없습니다', '그래도 운동을 종료할까요? 완료 체크한 세트만 성장 그래프에 반영됩니다.', [
        { text: '계속 기록' }, { text: '종료', onPress: go },
      ]);
    } else if (undone > 0) {
      Alert.alert('남은 세트가 있어요', '이대로 운동을 완료할까요? 체크한 세트만 기록됩니다.', [
        { text: '취소', style: 'cancel' }, { text: '완료', onPress: go },
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
      {editable && (
        <Row style={{ justifyContent: 'space-around', paddingVertical: S.md, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <SumStat label="볼륨" value={`${Math.round(s.exercises.reduce((n, e) => n + volumeOf(e.sets), 0)).toLocaleString()}kg`} />
          <SumStat label="완료 세트" value={`${s.exercises.reduce((n, e) => n + doneWorkingCount(e.sets), 0)}`} />
          <SumStat label="종목" value={`${s.exercises.filter((e) => doneWorkingCount(e.sets) > 0).length}/${s.exercises.length}`} />
        </Row>
      )}
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 240 }} keyboardShouldPersistTaps="handled">
        {editable && s.exercises.length > 0 && (
          <Row style={{ marginBottom: S.sm }}>
            <Chip label="한 종목씩" active={guidedOn} onPress={() => { setGuided(true); }} />
            <Chip label="전체 목록" active={!guidedOn} onPress={() => setGuided(false)} />
          </Row>
        )}
        {editable && s.exercises.length > 0 && (
          <Row style={{ marginBottom: S.sm }}>
            <T muted style={{ fontSize: 12, marginRight: 4 }}>진행</T>
            {(['manual', 'camera', 'tempo'] as RunMode[]).map((m) => (
              <Chip key={m} label={RUN_LABEL[m]} active={runMode === m} onPress={() => { setRunMode(m); setSetting(db, 'run_mode', m); }} />
            ))}
          </Row>
        )}
        {cur && (
          <Card>
            <T muted style={{ fontSize: 12 }}>종목 {cur.index} / {cur.total}{cur.block.length > 1 ? ' · 슈퍼세트' : ''}</T>
            <T bold style={{ fontSize: 18, marginTop: 2 }}>{cur.block.map((b) => b.name).join(' ↔ ')}</T>
            {cur.next ? (
              <T muted style={{ fontSize: 13, marginTop: 4 }}>
                다음: {cur.next.map((b) => b.name).join(' ↔ ')}{matchProfile(cur.next[0].name)?.tip ? `\n📍 ${matchProfile(cur.next[0].name)!.tip}` : ''}
              </T>
            ) : <T muted style={{ fontSize: 13, marginTop: 4 }}>마지막 종목이에요</T>}
            {runMode !== 'manual' && (
              <Btn
                label={runMode === 'camera' ? '📷 카메라로 시작' : '⏱ 박자로 시작'} style={{ marginTop: S.sm }}
                onPress={() => { const ex = s.exercises.find((e) => e.id === cur.exId); if (ex) openLive(ex, runMode === 'tempo' ? 'tempo' : 'camera'); }}
              />
            )}
            <Row style={{ marginTop: S.sm }}>
              {cur.next && <Btn label="나중에 하기" kind="ghost" small onPress={() => setDeferred((d) => [...d, cur.block[0].id])} />}
              <Btn label="이 종목 끝내기" kind="ghost" small onPress={finishBlock} />
            </Row>
          </Card>
        )}
        {shownExercises.map((ex) => {
          const open = !collapsed[ex.id];
          const showOpts = !!opts[ex.id];
          const doneN = ex.sets.filter((x) => x.done).length;
          const last = lasts[ex.id] ?? null;
          const equip: Equip | null = ex.weight_mode === 'bodyweight' ? '맨몸' : (matchProfile(ex.exercise_name)?.equip ?? null);
          const prevSets = lastSets[ex.id] ?? [];
          const prevVol = prevSets.reduce((n, x) => n + (x.weight && x.reps ? x.weight * x.reps : 0), 0);
          const vol = volumeOf(ex.sets);
          const best = bestE1rm(ex.sets) ?? (last ? e1rm(last.weight, last.reps) : null);
          const idxAll = s.exercises.findIndex((e) => e.id === ex.id);
          const prevEx = s.exercises[idxAll - 1];
          const nextEx = s.exercises[idxAll + 1];
          const inSs = !!ex.ss && (prevEx?.ss === ex.ss || nextEx?.ss === ex.ss);
          const ssFirst = inSs && prevEx?.ss !== ex.ss;
          return (
            <View key={ex.id}>
              {ssFirst && <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: C.accent, marginBottom: 4 }}><Text style={{ color: C.onAccent, fontSize: 11, fontWeight: '800' }}>슈퍼 세트</Text></View>}
            <Card style={{ padding: 0, ...(inSs ? { borderLeftWidth: 4, borderLeftColor: C.accent } : {}) }}>
              <Pressable onPress={() => setCollapsed((c) => ({ ...c, [ex.id]: open }))} style={{ padding: S.lg }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <T bold style={{ fontSize: 16 }}>{ex.exercise_name}{cur && cur.block.length > 1 && cur.exId === ex.id ? '  ▶ 지금 차례' : ''}</T>
                    <T muted style={{ fontSize: 12 }}>
                      {doneN}/{ex.sets.length}{equip ? ` · ${equip}` : ''}{ex.weight_mode === 'assisted' ? ' · 보조 중량' : ex.weight_mode === 'bodyweight' ? ' · 체중' : ''}
                      {` · 휴식 ${fmtElapsed(restFor(rests[ex.id], restDefault))}`}
                      {best != null ? ` · e1RM ${best}kg` : ''}
                    </T>
                    {(vol > 0 || prevVol > 0) && (
                      <T muted style={{ fontSize: 12 }}>
                        볼륨 {Math.round(vol).toLocaleString()}kg{prevVol > 0 ? ` (${vol - prevVol >= 0 ? '+' : '−'}${Math.round(Math.abs(vol - prevVol)).toLocaleString()} 지난번 대비)` : ''}
                      </T>
                    )}
                  </View>
                  <Text style={{ color: C.muted, fontSize: 18, marginLeft: 8 }}>{open ? '▾' : '▸'}</Text>
                </Row>
              </Pressable>

              {open && (
                <View style={{ paddingHorizontal: S.lg, paddingBottom: S.lg }}>
                  {editable && (
                    <Row style={{ flexWrap: 'wrap', marginBottom: S.sm }}>
                      {([['weighted', '중량'], ['bodyweight', '맨몸(체중)'], ['assisted', '보조']] as const).map(([k, label]) => (
                        <Chip key={k} label={label} active={ex.weight_mode === k} onPress={async () => { await setSessionExerciseMode(db, ex.id, k); bump(); reload(); }} />
                      ))}
                    </Row>
                  )}
                  {editable && (
                    <Row style={{ marginBottom: S.sm }}>
                      <Btn label="📷 카메라로 세기" kind="ghost" small style={{ flex: 1 }} onPress={() => openLive(ex, 'camera')} />
                      <Btn label="⏱ 박자로 세기" kind="ghost" small style={{ flex: 1 }} onPress={() => openLive(ex, 'tempo')} />
                      {prevSets.length > 0 && (
                        <Btn label="불러오기" kind="ghost" small onPress={async () => {
                          const free = ex.sets.filter((x) => !x.done && x.set_type !== 'warmup');
                          for (let i = 0; i < free.length && i < prevSets.length; i++) await updateSet(db, free[i].id, { weight: prevSets[i].weight, reps: prevSets[i].reps });
                          bump(); reload();
                        }} />
                      )}
                    </Row>
                  )}
                  {equip && ex.sets.length > 0 && <T muted style={{ fontSize: 10, marginLeft: 40, marginBottom: 2 }}>{WEIGHT_LABEL[equip]}</T>}
                  {ex.sets.map((row, idx) => {
                    const sugW = suggestFor(ex.sets, idx, (x) => x.weight, last?.weight ?? null);
                    const sugR = suggestFor(ex.sets, idx, (x) => x.reps, last?.reps ?? null);
                    const focused = focus?.setId === row.id ? focus.field : null;
                    return (
                      <View key={row.id} style={{ marginBottom: S.sm }}>
                        <Row>
                          <Pressable
                            disabled={!editable}
                            onPress={() => setSheet({ exId: ex.id, setId: row.id })}
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
                              let sec = row.set_type === 'warmup' || allOthersDone ? 0 : restFor(rests[ex.id], restDefault);
                              let kind: 'set' | 'exercise' = 'set';
                              let nextExId: string | undefined;
                              if (guidedOn) {
                                const upd = gex.map((g) => (g.id !== ex.id ? g : { ...g, sets: g.sets.map((x) => (x.id === row.id ? { ...x, done: 1 } : x)) }));
                                const rk = row.set_type === 'warmup' ? 'none' : restAfter(upd, ex.id, skipped);
                                sec = rk === 'exercise' ? exRest : rk === 'set' ? restFor(rests[ex.id], restDefault) : 0;
                                if (rk === 'exercise') kind = 'exercise';
                                nextExId = currentOf(upd, deferred, skipped)?.exId;
                              }
                              if (sec > 0) {
                                const t = Date.now(); setNow(t); setRestMini(false);
                                const nx = nextExId ? nameOf(nextExId) : undefined;
                                setRest({ endAt: t + sec * 1000, total: sec, done: false, kind, exId: ex.id, next: nx, nextTip: nx ? matchProfile(nx)?.tip : undefined, nextExId });
                                if (kind === 'exercise' && nx) speakText(`종목 끝. ${sec}초 쉬세요. 다음은 ${nx}`);
                              }
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
            </View>
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
          {rest && restMini && (
            <Row style={{ marginBottom: S.sm, padding: S.md, borderRadius: 12, backgroundColor: C.card2, borderWidth: 1, borderColor: rest.done ? C.accent : C.line }}>
              <View style={{ flex: 1 }}>
                <T bold style={{ fontSize: 16 }}>{rest.done ? (rest.kind === 'exercise' ? '휴식 끝 · 다음 종목' : '휴식 끝 · 다음 세트') : `${rest.kind === 'exercise' ? '종목 간 휴식' : '휴식'} ${fmtElapsed(restLeft)}`}</T>
                {rest.next ? <T muted style={{ fontSize: 12 }}>다음: {rest.next}{rest.kind === 'exercise' && rest.nextTip ? `\n📍 ${rest.nextTip}` : ''}</T> : null}
              </View>
              {!rest.done && <Btn label={rest.kind === 'exercise' ? '−30' : '−10'} kind="ghost" small onPress={() => adjustRest(rest.kind === 'exercise' ? -30 : -10)} />}
              {!rest.done && <Btn label={rest.kind === 'exercise' ? '+30' : '+10'} kind="ghost" small onPress={() => adjustRest(rest.kind === 'exercise' ? 30 : 10)} />}
              <Btn label="크게" kind="ghost" small onPress={() => setRestMini(false)} />
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

      {(() => {
        const sx = sheet ? s.exercises.find((e) => e.id === sheet.exId) : null;
        const sr = sx && sheet ? sx.sets.find((x) => x.id === sheet.setId) : null;
        if (!sx || !sr) return null;
        const lastSet = lasts[sx.id] ?? null;
        const eq: Equip | null = sx.weight_mode === 'bodyweight' ? '맨몸' : (matchProfile(sx.exercise_name)?.equip ?? null);
        return (
          <SetSheet
            visible title={sx.exercise_name}
            set={{ weight: sr.weight, reps: sr.reps, setNo: sr.set_no, kind: sr.is_rm ? 'rm' : sr.set_type === 'warmup' ? 'warmup' : 'working' }}
            weightLabel={eq ? WEIGHT_LABEL[eq] : '무게'} bodyweight={sx.weight_mode === 'bodyweight'} barbell={eq === '바벨'}
            step={step} barKg={barKg} last={lastSet} recommend={recommendNext(lastSet, step)}
            onClose={() => setSheet(null)}
            onKind={(k) => patchSet(sx, sr, { kind: k })}
            onComplete={(w, r) => {
              setSheet(null);
              patchSet(sx, sr, { weight: w, reps: r, done: true });
              reload();
            }}
            onApplyRest={async (w, r) => {
              for (const x of sx.sets) if (!x.done && x.id !== sr.id && x.set_type !== 'warmup') await updateSet(db, x.id, { weight: w, reps: r });
              await updateSet(db, sr.id, { weight: w, reps: r });
              setSheet(null); bump(); reload();
            }}
            onDelete={() => Alert.alert('세트 삭제', `${sr.set_no}세트를 삭제할까요?`, [
              { text: '취소' }, { text: '삭제', style: 'destructive', onPress: async () => { setSheet(null); await deleteSet(db, sr.id); bump(); reload(); } },
            ])}
          />
        );
      })()}
      <Modal visible={!!rest && !restMini} animationType="fade" onRequestClose={() => setRestMini(true)}>
        {rest && (
          <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + S.lg, paddingBottom: insets.bottom + S.lg, paddingHorizontal: S.lg }}>
            <Row>
              <T muted style={{ flex: 1 }}>{rest.kind === 'exercise' ? '종목 간 휴식' : '세트 간 휴식'}</T>
              <Btn label="작게 보기" kind="ghost" small onPress={() => setRestMini(true)} />
            </Row>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {rest.done ? (
                <T bold style={{ fontSize: 44 }}>휴식 끝</T>
              ) : (
                <>
                  <T bold style={{ fontSize: 84, lineHeight: 96 }}>{fmtElapsed(restLeft)}</T>
                  <T muted style={{ marginBottom: S.sm }}>휴식 시간 설정</T>
                  <Row>
                    <Btn label={rest.kind === 'exercise' ? '−30초' : '−10초'} kind="ghost" onPress={() => adjustRest(rest.kind === 'exercise' ? -30 : -10)} />
                    <Btn label={rest.kind === 'exercise' ? '+30초' : '+10초'} kind="ghost" onPress={() => adjustRest(rest.kind === 'exercise' ? 30 : 10)} />
                  </Row>
                </>
              )}
              {restNext && (
                <View style={{ marginTop: S.xl, padding: S.lg, borderRadius: 14, backgroundColor: C.card2, alignSelf: 'stretch' }}>
                  <T bold style={{ fontSize: 18, textAlign: 'center' }}>{restNext.title}</T>
                  {restNext.tip ? <T muted style={{ fontSize: 12, marginTop: 6, textAlign: 'center' }}>📍 {restNext.tip}</T> : null}
                </View>
              )}
            </View>
            <Row>
              {!rest.done && rest.kind === 'set' && <Btn label="저장" kind="ghost" onPress={saveSetRest} />}
              {rest.kind === 'exercise' && rest.nextExId && runMode !== 'manual' && (
                <Btn
                  label={runMode === 'camera' ? '📷 카메라로 시작' : '⏱ 박자로 시작'} kind="ghost"
                  onPress={() => { const ex = s.exercises.find((e) => e.id === rest.nextExId); if (ex) { setRest(null); openLive(ex, runMode === 'tempo' ? 'tempo' : 'camera'); } }}
                />
              )}
              <Btn label={rest.done ? '닫기' : '건너뛰기'} style={{ flex: 1 }} onPress={() => setRest(null)} />
            </Row>
          </View>
        )}
      </Modal>
      <SummaryModal data={summary} onClose={() => setSummary(null)} />
      <LiveCountModal
        visible={!!live}
                defaults={live ? { targetReps: live.target, totalSets: live.sets, restSec: live.restSec, focus: live.focus, tip: live.tip, source: live.source, prepSec, tempoSec } : undefined}
        onClose={() => setLive(null)}
        onUse={(counts) => { const l = live; setLive(null); if (l) applyLiveCount(l.exId, counts); }}
      />
      <ExercisePicker
        visible={picker}
                onClose={() => setPicker(false)}
        onPick={async (e) => { setPicker(false); await addSessionExercise(db, s.id, e.id); bump(); reload(); }}
      />
    </View>
  );
}

function SumStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <T bold style={{ fontSize: 18 }}>{value}</T>
      <T muted style={{ fontSize: 11 }}>{label}</T>
    </View>
  );
}
