import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  getActiveSession, listTemplates, startFreeSession, startSessionFromTemplate, type SessionMeta, type TemplateRow,
} from '../db/repo.ts';
import { Btn, Card, Empty, H, IntensityBadge, Row, T } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';
import { resolveIntensity } from '../domain/intensity.ts';

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
        <Btn label="루틴 관리" kind="ghost" small onPress={nav.openTemplates} />
      </Row>
      {tpls.length === 0 && <Empty text="루틴이 없습니다. 루틴 관리에서 만들거나 AI 루틴을 가져오세요." />}
      {tpls.map((t) => (
        <Card key={t.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <T bold>{t.name}</T>
              {t.post_cardio_min ? <T muted style={{ fontSize: 12 }}>후 유산소 {t.post_cardio_min}분 선택</T> : null}
            </View>
            {t.default_intensity !== 'none' && <IntensityBadge value={t.default_intensity} />}
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
                <T muted style={{ fontSize: 12 }}>{s.date}{s.duration_sec ? ` · ${Math.round(s.duration_sec / 60)}분` : ''}</T>
              </View>
              <IntensityBadge value={resolveIntensity(null, null, s.intensity)} />
            </Row>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
