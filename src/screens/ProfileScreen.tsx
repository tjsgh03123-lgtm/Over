import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { getSetting, listDoneDates, listMeasurements, loadFlatSets, setSetting, type Measurement } from '../db/repo.ts';
import { matchProfile } from '../domain/exerciseCatalog.ts';
import { fmtDuration } from '../domain/format.ts';
import { bestE1rm, e1rm, monthDays, monthWeeks, streakWeeks } from '../domain/workoutStats.ts';
import { Btn, Card, H, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const BIG3 = [
  { key: '바벨 벤치프레스', label: '벤치프레스' },
  { key: '바벨 백스쿼트', label: '스쿼트' },
  { key: '데드리프트', label: '데드리프트' },
];

/** 프로필 탭: 이름, 3대 운동, 신체 기록, 주 연속 기록·월 목표, 1RM 계산기, 내 메모 */
export function ProfileScreen() {
  const { db, today, version, nav } = useApp();
  const [name, setName] = useState('');
  const [editName, setEditName] = useState(false);
  const [memo, setMemo] = useState('');
  const [goal, setGoal] = useState(12);
  const [dates, setDates] = useState<string[]>([]);
  const [big3, setBig3] = useState<Record<string, number | null>>({});
  const [totals, setTotals] = useState({ workouts: 0, volume: 0, seconds: 0 });
  const [body, setBody] = useState<Measurement | null>(null);
  const [calc, setCalc] = useState(false);

  useEffect(() => {
    (async () => {
      setName((await getSetting(db, 'profile_name')) ?? '');
      setMemo((await getSetting(db, 'my_memo')) ?? '');
      const g = Number(await getSetting(db, 'month_goal'));
      setGoal(Number.isFinite(g) && g > 0 ? g : 12);
      setDates(await listDoneDates(db));
      const flat = await loadFlatSets(db);
      const best: Record<string, number | null> = {};
      for (const b of BIG3) best[b.key] = null;
      let vol = 0;
      for (const f of flat) {
        if (f.done && f.setType !== 'warmup' && !f.isRm && f.weight && f.reps) vol += f.weight * f.reps;
        const m = matchProfile(f.exerciseName)?.name;
        if (m && m in best && f.done && f.setType !== 'warmup') {
          const v = bestE1rm([{ weight: f.weight, reps: f.reps, done: 1, set_type: f.setType }]);
          if (v != null && (best[m] == null || v > (best[m] as number))) best[m] = v;
        }
      }
      setBig3(best);
      const sess = await db.first<{ n: number; sec: number | null }>("SELECT COUNT(*) AS n, SUM(duration_sec) AS sec FROM workout_sessions WHERE status = 'done'");
      setTotals({ workouts: sess?.n ?? 0, volume: vol, seconds: sess?.sec ?? 0 });
      const ms = await listMeasurements(db);
      setBody(ms.length ? ms[ms.length - 1] : null);
    })();
  }, [db, version]);

  const saveName = async (v: string) => { setName(v); await setSetting(db, 'profile_name', v.trim()); };
  const sum = BIG3.reduce((n, b) => n + (big3[b.key] ?? 0), 0);
  const streak = streakWeeks(dates, today);
  const days = monthDays(dates, today);
  const weeks = monthWeeks(dates, today);
  const shown = name.trim() || '운동하는 사람';

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Row style={{ marginBottom: S.lg }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center', marginRight: S.md }}>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{shown.slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          {editName ? (
            <TextField value={name} onChangeText={setName} onBlur={() => { saveName(name); setEditName(false); }} onSubmitEditing={() => { saveName(name); setEditName(false); }} placeholder="이름" autoFocus />
          ) : (
            <Pressable onPress={() => setEditName(true)}>
              <H style={{ fontSize: 20 }}>{shown} <Text style={{ color: C.muted, fontSize: 13 }}>✎</Text></H>
            </Pressable>
          )}
          <T muted style={{ fontSize: 12 }}>
            운동 {totals.workouts}회 · 총 볼륨 {Math.round(totals.volume).toLocaleString()}kg{totals.seconds ? ` · ${fmtDuration(totals.seconds)}` : ''}
          </T>
        </View>
        <Btn label="⚙ 설정" kind="ghost" small onPress={nav.openSettings} />
      </Row>

      <Card>
        <Row style={{ marginBottom: S.sm }}>
          <H style={{ fontSize: 16, flex: 1 }}>이번 달 운동</H>
          <T muted style={{ fontSize: 12 }}>{streak > 0 ? `${streak}주 연속 기록` : '이번 주 운동을 시작해 보세요'}</T>
        </Row>
        <Row style={{ alignItems: 'flex-end', marginBottom: 6 }}>
          <T bold style={{ fontSize: 28 }}>{days}</T>
          <T muted style={{ marginBottom: 4 }}> / {goal}일 목표</T>
        </Row>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.card2, overflow: 'hidden', marginBottom: S.md }}>
          <View style={{ height: '100%', width: `${Math.min(100, (days / goal) * 100)}%`, backgroundColor: C.accent }} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          {weeks.map((w) => (
            <View key={w.label} style={{ alignItems: 'center', flex: 1 }}>
              <View style={{
                width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
                backgroundColor: w.count > 0 ? C.accent : C.card2, borderWidth: w.current ? 2 : 0, borderColor: C.text,
              }}>
                <Text style={{ color: w.count > 0 ? C.onAccent : C.muted, fontWeight: '800', fontSize: 13 }}>{w.count > 0 ? '✓' : ''}</Text>
              </View>
              <T muted style={{ fontSize: 11, marginTop: 3 }}>{w.label}</T>
            </View>
          ))}
        </Row>
      </Card>

      <Card>
        <Row style={{ marginBottom: S.sm }}>
          <H style={{ fontSize: 16, flex: 1 }}>3대 운동 (예상 1RM)</H>
          <T bold>{sum > 0 ? `${Math.round(sum * 10) / 10}kg` : '-'}</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          {BIG3.map((b) => (
            <View key={b.key} style={{ alignItems: 'center', flex: 1 }}>
              <T bold style={{ fontSize: 18 }}>{big3[b.key] != null ? `${big3[b.key]}kg` : '-'}</T>
              <T muted style={{ fontSize: 11 }}>{b.label}</T>
            </View>
          ))}
        </Row>
      </Card>

      <Card>
        <Row style={{ marginBottom: S.sm }}>
          <H style={{ fontSize: 16, flex: 1 }}>신체</H>
          <Btn label="+ 기록 추가" kind="ghost" small onPress={nav.openBody} />
        </Row>
        {body ? (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <Stat label="몸무게" value={body.weight != null ? `${body.weight}kg` : '-'} />
              <Stat label="골격근량" value={body.skeletal_muscle != null ? `${body.skeletal_muscle}kg` : '-'} />
              <Stat label="체지방률" value={body.body_fat_pct != null ? `${body.body_fat_pct}%` : '-'} />
            </Row>
            <T muted style={{ fontSize: 11, marginTop: 6 }}>{body.date} 기록</T>
          </>
        ) : <T muted>아직 신체 기록이 없어요.</T>}
      </Card>

      <Card style={{ padding: 0 }}>
        <MenuRow label="1RM 계산기" onPress={() => setCalc(true)} />
        <MenuRow label="종목 관리" onPress={nav.openExercises} last />
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>내 메모</H>
        <TextField
          value={memo} onChangeText={setMemo} onEndEditing={() => setSetting(db, 'my_memo', memo)}
          placeholder="목표, 컨디션, 주의할 점" multiline style={{ minHeight: 90, textAlignVertical: 'top' }}
        />
      </Card>

      <OneRmModal visible={calc} onClose={() => setCalc(false)} />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T bold style={{ fontSize: 18 }}>{value}</T>
      <T muted style={{ fontSize: 11 }}>{label}</T>
    </View>
  );
}

function MenuRow({ label, onPress, last }: { label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', padding: S.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Text style={{ color: C.muted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

/** 무게×횟수로 예상 1RM과 %별 무게표를 보여 준다 */
function OneRmModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [w, setW] = useState<number | null>(60);
  const [r, setR] = useState<number | null>(8);
  const one = e1rm(w, r);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg }}>
        <Row style={{ marginBottom: S.md }}>
          <H style={{ fontSize: 18, flex: 1 }}>1RM 계산기</H>
          <Btn label="닫기" kind="ghost" small onPress={onClose} />
        </Row>
        <Row style={{ marginBottom: S.md }}>
          <NumInput value={w} onCommit={setW} placeholder="kg" width={96} />
          <T muted>kg ×</T>
          <NumInput value={r} onCommit={setR} placeholder="회" width={72} decimal={false} />
          <T muted>회</T>
        </Row>
        <T bold style={{ fontSize: 30, marginBottom: S.sm }}>{one != null ? `${one}kg` : '-'}</T>
        {one != null && (
          <View>
            {[95, 90, 85, 80, 75, 70, 60, 50].map((p) => (
              <Row key={p} style={{ paddingVertical: 4, borderTopWidth: 1, borderTopColor: C.line }}>
                <T muted style={{ flex: 1 }}>{p}%</T>
                <T bold>{Math.round(one * p) / 100}kg</T>
              </Row>
            ))}
          </View>
        )}
        <T muted style={{ fontSize: 11, marginTop: S.md }}>Epley 공식(무게 × (1 + 횟수/30))으로 추정한 값이에요.</T>
      </View>
    </Modal>
  );
}
