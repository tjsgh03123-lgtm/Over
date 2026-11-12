import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View, useWindowDimensions } from 'react-native';
import { getDayDetail, upsertDay, type TemplateExerciseInput } from '../db/repo.ts';
import type { DayKind } from '../domain/routine.ts';
import { Btn, NumField, NumInput, Row, T, TextField } from './components.tsx';
import { ExercisePicker } from './ExercisePicker.tsx';
import { Icon } from './icons.tsx';
import { C, FS, R, S } from './theme.ts';

interface EditEx extends TemplateExerciseInput { name: string; key: string }
let seq = 0;
const nk = () => `se${++seq}`;

/** 선택한 칸(요일/Day)의 운동 구성을 그 자리에서 바로 고친다. 바꾸는 즉시 저장된다. */
export function SlotEditor({ db, today, routineId, slotIdx, dayId, onSaved }: {
  db: any; today: string; routineId: string; slotIdx: number; dayId: string | null; onSaved: () => void;
}) {
  const { width: winW } = useWindowDimensions();
  const narrow = winW < 380;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DayKind>('weights');
  const [post, setPost] = useState<number | null>(null);
  const [list, setList] = useState<EditEx[]>([]);
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(false);
  const cur = useRef({ name, kind, post, list });
  cur.current = { name, kind, post, list };

  useEffect(() => {
    let off = false;
    setReady(false);
    (async () => {
      if (dayId) {
        const d = await getDayDetail(db, today, routineId, dayId);
        if (d && !off) {
          setName(d.day.name); setKind(d.day.kind); setPost(d.postCardioMin);
          setList(d.exercises.map((e) => ({
            key: nk(), exerciseId: e.exercise_id, name: e.name, targetSets: e.target_sets, targetReps: e.target_reps,
            targetWeight: e.target_weight, intensity: e.intensity, restSec: e.rest_sec, note: e.note, ss: e.ss,
          })));
        }
      } else { setName(''); setKind('weights'); setPost(null); setList([]); }
      if (!off) setReady(true);
    })();
    return () => { off = true; };
  }, [db, today, routineId, dayId]);

  const persist = async (over?: Partial<{ name: string; kind: DayKind; post: number | null; list: EditEx[] }>) => {
    const s = { ...cur.current, ...over };
    if (s.kind === 'weights' && !s.name.trim()) return false;
    try {
      await upsertDay(db, today, routineId, {
        id: dayId ?? undefined, name: s.name, kind: s.kind, slot: dayId ? null : slotIdx,
        postCardioMin: s.post, exercises: s.list.map(({ name: _n, key: _k, ...rest }) => rest),
      });
      onSaved();
      return true;
    } catch (e) { Alert.alert('저장할 수 없습니다', (e as Error).message); return false; }
  };
  const setL = (fn: (l: EditEx[]) => EditEx[]) => {
    const next = fn(cur.current.list);
    setList(next);
    if (dayId) persist({ list: next });
  };
  const patch = (i: number, p: Partial<EditEx>) => setL((l) => l.map((e, k) => (k === i ? { ...e, ...p } : e)));
  const move = (i: number, d: number) => setL((l) => {
    const j = i + d; if (j < 0 || j >= l.length) return l;
    const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  if (!ready) return <View style={{ height: 120 }} />;

  if (!dayId) {
    return (
      <View style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.lg, gap: S.md }}>
        <T bold style={{ fontSize: FS.heading }}>휴식</T>
        <T muted style={{ fontSize: 12 }}>이 칸은 비어 있어요. 운동 이름을 적고 만들면 종목을 바로 넣을 수 있어요.</T>
        <TextField value={name} onChangeText={setName} placeholder="운동 이름 (예: 가슴·삼두)" />
        <Btn label="운동 만들기" onPress={async () => { if (!name.trim()) return Alert.alert('운동 이름을 입력하세요', '예: 가슴·삼두'); await persist({ kind: 'weights' }); }} />
      </View>
    );
  }

  return (
    <View style={{ gap: S.sm }}>
      <View style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md, gap: S.sm }}>
        <TextField value={name} onChangeText={setName} onEndEditing={() => persist()} placeholder="운동 이름" />
        {kind === 'weights' && (
          <Row>
            <T muted style={{ flex: 1, fontSize: 12 }}>웨이트 후 유산소(분)</T>
            <NumInput value={post} decimal={false} width={64} onCommit={(v) => { setPost(v); persist({ post: v }); }} />
          </Row>
        )}
      </View>
      {kind === 'weights' && list.map((e, i) => {
        const linked = !!e.ss && list[i - 1]?.ss === e.ss;
        return (
          <View key={e.key} style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md, gap: S.sm }}>
            <Row style={{ gap: S.sm }}>
              <T muted style={{ fontSize: 13, fontWeight: '700', width: 16 }}>{i + 1}</T>
              <T bold style={{ flex: 1, fontSize: 16 }} numberOfLines={2}>{e.name}</T>
              {[['up', -1], ['down', 1]].map(([ic, d]) => (
                <Pressable key={ic as string} hitSlop={6} onPress={() => move(i, d as number)} style={{ padding: 6, opacity: (i === 0 && d === -1) || (i === list.length - 1 && d === 1) ? 0.25 : 1 }}>
                  <Icon name={ic as 'up' | 'down'} size={18} color={C.muted} />
                </Pressable>
              ))}
              <Pressable hitSlop={6} onPress={() => setL((l) => l.filter((x) => x.key !== e.key))} style={{ padding: 6 }}>
                <Icon name="trash" size={18} color={C.muted} />
              </Pressable>
            </Row>
            {i > 0 && (
              <Pressable onPress={() => {
                if (linked) return patch(i, { ss: null });
                const g = list[i - 1]?.ss ?? `ss${Date.now().toString(36)}`;
                setL((l) => l.map((x, k) => (k === i || k === i - 1 ? { ...x, ss: g } : x)));
              }}>
                <T style={{ fontSize: 12, color: linked ? C.text : C.muted }}>{linked ? '⛓ 위 종목과 슈퍼세트 · 눌러서 해제' : '위 종목과 슈퍼세트로 묶기'}</T>
              </Pressable>
            )}
            <View style={{ gap: 6 }}>
              <Row style={{ alignItems: 'stretch', gap: 6 }}>
                <NumField label="세트" value={e.targetSets ?? 3} decimal={false} placeholder="3" onCommit={(v) => patch(i, { targetSets: Math.max(1, v ?? 3) })} />
                <NumField label="횟수" value={e.targetReps ?? null} decimal={false} placeholder="없음" onCommit={(v) => patch(i, { targetReps: v })} />
                {!narrow && <NumField label="무게" unit="kg" value={e.targetWeight ?? null} placeholder="없음" onCommit={(v) => patch(i, { targetWeight: v })} />}
                {!narrow && <NumField label="휴식" unit="초" value={e.restSec ?? null} decimal={false} placeholder="기본" onCommit={(v) => patch(i, { restSec: v })} />}
              </Row>
              {narrow && (
                <Row style={{ alignItems: 'stretch', gap: 6 }}>
                  <NumField label="무게" unit="kg" value={e.targetWeight ?? null} placeholder="없음" onCommit={(v) => patch(i, { targetWeight: v })} />
                  <NumField label="휴식" unit="초" value={e.restSec ?? null} decimal={false} placeholder="기본" onCommit={(v) => patch(i, { restSec: v })} />
                </Row>
              )}
            </View>
          </View>
        );
      })}
      {kind === 'weights' && <Btn label="+ 종목 추가" kind="ghost" onPress={() => setPicker(true)} />}
      {kind !== 'weights' && <T muted style={{ fontSize: 12 }}>{kind === 'cardio' ? '유산소 날이에요.' : '휴식 날이에요.'}</T>}
      <ExercisePicker
        visible={picker}
        onClose={() => setPicker(false)}
        onPick={(e) => { setPicker(false); setL((l) => [...l, { key: nk(), exerciseId: e.id, name: e.name, targetSets: 3 }]); }}
      />
    </View>
  );
}
