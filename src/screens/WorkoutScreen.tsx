import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  getActiveSession, listTemplates, startFreeSession, startSessionFromTemplate, type SessionMeta, type TemplateRow,
} from '../db/repo.ts';
import { Btn, Card, Empty, H, Row, T } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';
import { fmtClock, fmtDuration } from '../domain/format.ts';

export function WorkoutScreen() {
  const { db, today, version, nav, bump } = useApp();
  const [tpls, setTpls] = useState<TemplateRow[]>([]);
  const [active, setActive] = useState<SessionMeta | null>(null);
  const [recent, setRecent] = useState<SessionMeta[]>([]);

  useEffect(() => {
    (async () => {
      setTpls(await listTemplates(db));
      setActive(await getActiveSession(db));
      setRecent(await db.all<SessionMeta>("SELECT * FROM workout_sessions WHERE status='done' ORDER BY date DESC, started_at DESC LIMIT 12"));
    })();
  }, [db, version]);

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <H style={{ fontSize: 22, marginBottom: S.lg }}>운동</H>

      {active && (
        <Card style={{ borderColor: C.accent }}>
          <T bold>진행 중: {active.title}</T>
          <T muted style={{ marginBottom: S.sm }}>{active.date}</T>
          <Btn label="이어서 기록하기" onPress={() => nav.openSession(active.id)} />
        </Card>
      )}

      <Btn
        label="자유 운동 시작"
        onPress={async () => { nav.openSession(await startFreeSession(db, today)); bump(); }}
        style={{ marginBottom: S.lg }}
      />

      <Row style={{ marginBottom: S.sm }}>
        <H style={{ fontSize: 16, flex: 1 }}>내 루틴</H>
        <Btn label="일정" kind="ghost" small onPress={nav.openPlan} />
        <Btn label="관리" kind="ghost" small onPress={() => nav.openTemplates()} />
        <Btn label="+ 새 루틴" small onPress={() => nav.openTemplates(true)} />
      </Row>
      {tpls.length === 0 && <Empty text="루틴이 없습니다. ‘+ 새 루틴’으로 만들거나 AI 루틴을 가져오세요." />}
      {tpls.map((t) => (
        <Card key={t.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <T bold>{t.name}</T>
              {t.post_cardio_min ? <T muted style={{ fontSize: 12 }}>후 유산소 {t.post_cardio_min}분 선택</T> : null}
            </View>
            <Btn
              label="시작" small
              onPress={async () => { nav.openSession(await startSessionFromTemplate(db, t.id, today)); bump(); }}
            />
          </Row>
        </Card>
      ))}

      <H style={{ fontSize: 16, marginTop: S.lg, marginBottom: S.sm }}>최근 운동</H>
      {recent.length === 0 && <Empty text="완료한 운동이 없습니다." />}
      {recent.map((s) => (
        <Pressable key={s.id} onPress={() => nav.openSession(s.id)}>
          <Card>
            <Row>
              <View style={{ flex: 1 }}>
                <T bold>{s.title}</T>
                <T muted style={{ fontSize: 12 }}>
                  {s.date} · {fmtClock(s.started_at)}–{fmtClock(s.ended_at)}{s.duration_sec != null ? ` · ${fmtDuration(s.duration_sec)}` : ''}
                </T>
              </View>
            </Row>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
