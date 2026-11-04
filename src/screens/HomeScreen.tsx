import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addCardio, getActiveSession, getRuleForWeekday, listTrackedExercises, loadFlatSets, startFreeSession,
  startSessionFromTemplate, weekStats, type ScheduleRule, type SessionMeta, type WeekStats,
} from '../db/repo.ts';
import { summarize, weekdayOf } from '../domain/stats.ts';
import { INTENSITY_LABEL } from '../domain/types.ts';
import { Btn, Card, H, IntensityBadge, NumInput, Row, T } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];

interface Growth { id: string; name: string; best: number; kg: number | null; pct: number | null }

export function HomeScreen() {
  const { db, today, version, nav, bump } = useApp();
  const [rule, setRule] = useState<ScheduleRule | null>(null);
  const [active, setActive] = useState<SessionMeta | null>(null);
  const [week, setWeek] = useState<WeekStats | null>(null);
  const [growth, setGrowth] = useState<Growth[]>([]);
  const [cardioMin, setCardioMin] = useState<number | null>(30);

  useEffect(() => {
    (async () => {
      setRule(await getRuleForWeekday(db, weekdayOf(today)));
      setActive(await getActiveSession(db));
      setWeek(await weekStats(db, today));
      const tracked = (await listTrackedExercises(db)).slice(0, 5);
      const flat = await loadFlatSets(db);
      setGrowth(tracked.flatMap((t) => {
        const sm = summarize(flat, t.id, t.weight_mode);
        if (!sm.currentBest) return [];
        return [{ id: t.id, name: t.name, best: sm.currentBest.best, kg: sm.vsPrevious?.kg ?? null, pct: sm.vsPrevious?.pct ?? null }];
      }));
    })();
  }, [db, today, version]);

  const startToday = async () => {
    if (!rule?.template_id) return;
    nav.openSession(await startSessionFromTemplate(db, rule.template_id, today));
    bump();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <H style={{ fontSize: 24, marginBottom: 2 }}>OVERDRIVE</H>
      <T muted style={{ marginBottom: S.lg }}>{today} ({DAY[weekdayOf(today)]})</T>

      {active && (
        <Card style={{ borderColor: C.accent }}>
          <T bold>진행 중인 운동</T>
          <T muted style={{ marginBottom: S.sm }}>{active.title} · {active.date}</T>
          <Btn label="이어서 기록하기" onPress={() => nav.openSession(active.id)} />
        </Card>
      )}

      <Card>
        <Row style={{ marginBottom: 6 }}>
          <T muted style={{ flex: 1 }}>오늘의 운동</T>
          {rule && rule.default_intensity !== 'none' && <IntensityBadge value={rule.default_intensity} />}
        </Row>
        {!rule ? (
          <T muted>요일 루틴이 설정되지 않았습니다. 설정에서 지정하세요.</T>
        ) : rule.kind === 'rest' ? (
          <>
            <H>휴식일</H>
            <T muted style={{ marginTop: 4 }}>회복도 훈련의 일부입니다.</T>
          </>
        ) : rule.kind === 'cardio' ? (
          <>
            <H>{rule.label ?? '유산소'}</H>
            <T muted style={{ marginTop: 4, marginBottom: S.sm }}>
              강도: {INTENSITY_LABEL[rule.default_intensity]} · 시간(분) 입력 후 기록
            </T>
            <Row>
              <NumInput value={cardioMin} onCommit={setCardioMin} width={80} placeholder="분" />
              <Btn
                label="유산소 기록" style={{ flex: 1 }}
                onPress={async () => {
                  if (!cardioMin) return;
                  await addCardio(db, { date: today, durationMin: cardioMin, intensity: rule.default_intensity === 'none' ? 'mid' : (rule.default_intensity as 'low' | 'mid' | 'high') });
                  bump();
                }}
              />
            </Row>
          </>
        ) : (
          <>
            <H>{rule.label ?? '웨이트'}</H>
            <T muted style={{ marginTop: 4, marginBottom: S.sm }}>
              오늘의 강도: {INTENSITY_LABEL[rule.default_intensity]}
            </T>
            <Btn label={rule.template_id ? '오늘 운동 시작' : '루틴이 연결되지 않음'} disabled={!rule.template_id} onPress={startToday} />
          </>
        )}
      </Card>

      <Row style={{ marginBottom: S.md }}>
        <Btn label="자유 운동 시작" kind="ghost" style={{ flex: 1 }} onPress={async () => { nav.openSession(await startFreeSession(db, today)); bump(); }} />
        <Btn label="AI 루틴 가져오기" kind="ghost" style={{ flex: 1 }} onPress={nav.openImport} />
      </Row>
      <Btn label="인바디 · 신체 기록" kind="ghost" onPress={nav.openBody} style={{ marginBottom: S.lg }} />

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
          <T muted>운동을 완료하면 종목별 최고 중량과 변화량이 여기에 표시됩니다.</T>
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
