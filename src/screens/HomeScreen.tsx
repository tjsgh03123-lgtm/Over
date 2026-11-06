import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addCardio, getActiveSession, getTemplateBrief, listWatchedExercises, loadFlatSets, sessionsOnDate, slotForDate,
  startFreeSession, startSessionFromTemplate, weekStats, type DaySlot, type SessionMeta, type TemplateBrief, type WeekStats,
} from '../db/repo.ts';
import { fmtDuration, fmtElapsed } from '../domain/format.ts';
import { summarize, weekdayOf } from '../domain/stats.ts';
import { Btn, Card, H, NumInput, Row, T } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';
import { useElapsed } from '../ui/useElapsed.ts';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];

interface Growth { id: string; name: string; best: number; kg: number | null; pct: number | null }

export function HomeScreen() {
  const { db, today, version, nav, bump } = useApp();
  const [slot, setSlot] = useState<DaySlot | null>(null);
  const [tpl, setTpl] = useState<TemplateBrief | null>(null);
  const [active, setActive] = useState<SessionMeta | null>(null);
  const [doneToday, setDoneToday] = useState<SessionMeta[]>([]);
  const [week, setWeek] = useState<WeekStats | null>(null);
  const [growth, setGrowth] = useState<Growth[]>([]);
  const [cardioMin, setCardioMin] = useState<number | null>(30);
  const elapsed = useElapsed(active?.started_at, !!active);

  useEffect(() => {
    (async () => {
      const sl = await slotForDate(db, today);
      setSlot(sl);
      setTpl(sl?.kind === 'weights' && sl.template_id ? await getTemplateBrief(db, sl.template_id) : null);
      setActive(await getActiveSession(db));
      setDoneToday((await sessionsOnDate(db, today)).filter((x) => x.status === 'done'));
      setWeek(await weekStats(db, today));
      const tracked = (await listWatchedExercises(db)).slice(0, 5);
      const flat = await loadFlatSets(db);
      setGrowth(tracked.flatMap((t) => {
        const sm = summarize(flat, t.id, t.weight_mode);
        if (!sm.currentBest) return [];
        return [{ id: t.id, name: t.name, best: sm.currentBest.best, kg: sm.vsPrevious?.kg ?? null, pct: sm.vsPrevious?.pct ?? null }];
      }));
    })();
  }, [db, today, version]);

  const startRoutine = async () => {
    if (!tpl) return;
    nav.openSession(await startSessionFromTemplate(db, tpl.id, today));
    bump();
  };
  const startFree = async () => {
    nav.openSession(await startFreeSession(db, today));
    bump();
  };

  const cycleNote = slot?.cycleDay ? `${slot.routineName} · ${slot.cycleDay}/${slot.cycleLength}일차` : slot ? slot.routineName : null;

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <H style={{ fontSize: 24, marginBottom: 2 }}>OVERDRIVE</H>
      <T muted style={{ marginBottom: S.lg }}>{today} ({DAY[weekdayOf(today)]})</T>

      {active ? (
        <Card style={{ borderColor: C.accent }}>
          <T muted>진행 중인 운동</T>
          <Row style={{ marginTop: 2, marginBottom: S.sm }}>
            <T bold style={{ flex: 1, fontSize: 16 }}>{active.title}</T>
            <T bold style={{ fontSize: 26 }}>{fmtElapsed(elapsed)}</T>
          </Row>
          <Btn label="이어서 기록하기" onPress={() => nav.openSession(active.id)} />
        </Card>
      ) : (
        <Card>
          <Row style={{ marginBottom: 6 }}>
            <T muted style={{ flex: 1 }}>오늘의 운동{cycleNote ? ` · ${cycleNote}` : ''}</T>
            <Btn label="루틴" kind="ghost" small onPress={() => nav.goTab('routine')} />
          </Row>

          {doneToday.length > 0 && (
            <T muted style={{ marginBottom: S.sm }}>
              오늘 {doneToday.length}회 완료{doneToday[0].duration_sec ? ` · ${fmtDuration(doneToday.reduce((n, x) => n + (x.duration_sec ?? 0), 0))}` : ''}
            </T>
          )}

          {slot?.kind === 'weights' && tpl ? (
            <>
              <H>{slot.label ?? tpl.name}</H>
              <T muted style={{ marginTop: 4, marginBottom: S.md }}>
                {tpl.count}종목{tpl.names.length ? ` · ${tpl.names.join(', ')}${tpl.count > tpl.names.length ? ' …' : ''}` : ''}
              </T>
              <Btn label="운동 시작" onPress={startRoutine} style={{ marginBottom: S.sm }} />
              <Btn label="자유 운동" kind="ghost" onPress={startFree} />
            </>
          ) : slot?.kind === 'cardio' ? (
            <>
              <H>{slot.label ?? '유산소'}</H>
              <T muted style={{ marginTop: 4, marginBottom: S.sm }}>시간(분) 입력 후 기록</T>
              <Row style={{ marginBottom: S.sm }}>
                <NumInput value={cardioMin} onCommit={setCardioMin} width={80} placeholder="분" />
                <Btn
                  label="유산소 기록" style={{ flex: 1 }}
                  onPress={async () => {
                    if (!cardioMin) return;
                    await addCardio(db, { date: today, durationMin: cardioMin, intensity: 'mid' });
                    bump();
                  }}
                />
              </Row>
              <Btn label="자유 운동" kind="ghost" onPress={startFree} />
            </>
          ) : slot?.kind === 'rest' ? (
            <>
              <H>휴식일</H>
              <T muted style={{ marginTop: 4, marginBottom: S.md }}>회복도 훈련의 일부입니다.</T>
              <Btn label="자유 운동" kind="ghost" onPress={startFree} />
            </>
          ) : (
            <>
              <H>오늘 정해진 루틴이 없어요</H>
              <T muted style={{ marginTop: 4, marginBottom: S.md }}>루틴을 만들어 두면 여기서 바로 시작할 수 있어요.</T>
              <Btn label="루틴 만들기" onPress={() => nav.goTab('routine')} style={{ marginBottom: S.sm }} />
              <Btn label="자유 운동" kind="ghost" onPress={startFree} />
            </>
          )}
        </Card>
      )}

      <Row style={{ marginBottom: S.lg }}>
        <Btn label="AI 루틴 가져오기" kind="ghost" style={{ flex: 1 }} onPress={nav.openImport} />
        <Btn label="인바디 · 신체 기록" kind="ghost" style={{ flex: 1 }} onPress={nav.openBody} />
      </Row>

      <Card>
        <Row style={{ marginBottom: S.sm }}>
          <H style={{ fontSize: 16, flex: 1 }}>이번 주 운동</H>
          <T muted style={{ fontSize: 12 }}>월~일</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="운동 횟수" value={`${week?.workouts ?? 0}회`} />
          <Stat label="완료 세트" value={`${week?.sets ?? 0}`} />
          <Stat label="총 볼륨" value={`${Math.round(week?.volume ?? 0).toLocaleString()}kg`} />
          <Stat label="유산소" value={`${Math.round(week?.cardioMin ?? 0)}분`} />
        </Row>
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>최근 중량 성장</H>
        {growth.length === 0 ? (
          <T muted>성장 분석에서 보고 싶은 운동을 고르면, 완료한 기록의 최고 중량과 변화량이 여기에 표시됩니다.</T>
        ) : (
          growth.map((g) => (
            <Pressable key={g.id} onPress={() => nav.goTab('growth')} style={{ paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
              <T style={{ flex: 1 }}>{g.name}</T>
              <T bold>{g.best}kg</T>
              <Text style={{ width: 92, textAlign: 'right', color: g.kg == null ? C.muted : g.kg > 0 ? C.ok : g.kg < 0 ? C.danger : C.muted, fontSize: 12 }}>
                {g.kg == null ? '첫 기록' : `${g.kg > 0 ? '+' : ''}${g.kg}kg${g.pct != null ? ` (${g.pct > 0 ? '+' : ''}${g.pct}%)` : ''}`}
              </Text>
            </Pressable>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T bold style={{ fontSize: 16 }}>{value}</T>
      <T muted style={{ fontSize: 11 }}>{label}</T>
    </View>
  );
}
