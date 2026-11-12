import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { deleteCardio, listCardio, monthMarks, sessionsOnDate, type SessionMeta } from '../db/repo.ts';
import { Btn, Card, H, Row, T } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';
import { fmtClock, fmtDuration } from '../domain/format.ts';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];

export function CalendarScreen() {
  const { db, today, version, nav, bump, calendarDate } = useApp();
  const [ym, setYm] = useState((calendarDate ?? today).slice(0, 7));
  const [marks, setMarks] = useState<Record<string, { done: number; active: number; cardio: number }>>({});
  const [sel, setSel] = useState(calendarDate ?? today);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [cardio, setCardio] = useState<Awaited<ReturnType<typeof listCardio>>>([]);

  useEffect(() => { monthMarks(db, ym).then(setMarks); }, [db, ym, version]);
  useEffect(() => {
    sessionsOnDate(db, sel).then(setSessions);
    listCardio(db, sel).then(setCardio);
  }, [db, sel, version]);

  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const dateOf = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <Row style={{ marginBottom: S.md }}>
        <Btn label="‹" kind="ghost" small onPress={() => shift(-1)} />
        <H style={{ flex: 1, textAlign: 'center' }}>{y}년 {m}월</H>
        <Btn label="›" kind="ghost" small onPress={() => shift(1)} />
      </Row>

      <Card>
        <Row style={{ marginBottom: 6 }}>
          {DAY.map((d, i) => (
            <Text key={d} style={{ flex: 1, textAlign: 'center', color: C.muted, fontSize: 12 }}>{d}</Text>
          ))}
        </Row>
        {Array.from({ length: cells.length / 7 }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
              if (d == null) return <View key={i} style={{ flex: 1, height: 52 }} />;
              const ds = dateOf(d);
              const mk = marks[ds];
              const isSel = ds === sel;
              return (
                <Pressable
                  key={i}
                  onPress={() => setSel(ds)}
                  style={{
                    flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
                    backgroundColor: isSel ? C.accentDim : 'transparent', borderWidth: ds === today ? 1 : 0, borderColor: C.accent,
                  }}
                >
                  <Text style={{ color: C.text, fontWeight: isSel ? '800' : '500' }}>{d}</Text>
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 4, height: 6 }}>
                    {mk?.done ? <Dot kind="done" /> : null}
                    {mk?.active ? <Dot kind="active" /> : null}
                    {mk?.cardio ? <Dot kind="cardio" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Row style={{ marginTop: S.sm, gap: 14 }}>
          <Legend kind="done" label="웨이트 완료" />
          <Legend kind="active" label="진행 중" />
          <Legend kind="cardio" label="유산소" />
        </Row>
      </Card>

      <H style={{ fontSize: 16, marginBottom: S.sm }}>{sel}</H>
      {sessions.length === 0 && cardio.length === 0 && <T muted>이 날의 기록이 없습니다.</T>}
      {sessions.map((s) => (
        <Pressable key={s.id} onPress={() => nav.openSession(s.id)}>
          <Card>
            <Row>
              <View style={{ flex: 1 }}>
                <T bold>{s.title}</T>
                <T muted style={{ fontSize: 12 }}>
                  {s.status === 'done'
                    ? `완료 · ${fmtClock(s.started_at)}–${fmtClock(s.ended_at)}${s.duration_sec != null ? ` · ${fmtDuration(s.duration_sec)}` : ''}`
                    : `진행 중 · 시작 ${fmtClock(s.started_at)}`}
                </T>
              </View>
            </Row>
          </Card>
        </Pressable>
      ))}
      {cardio.map((c) => (
        <Card key={c.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <T bold>{c.kind === 'post_weights' ? '웨이트 후 유산소' : '유산소'}</T>
              <T muted style={{ fontSize: 12 }}>{c.duration_min}분</T>
            </View>
            <Btn label="삭제" kind="danger" small onPress={async () => { await deleteCardio(db, c.id); bump(); }} />
          </Row>
        </Card>
      ))}
    </ScrollView>
  );
}

type DotKind = 'done' | 'active' | 'cardio';
const Dot = ({ kind }: { kind: DotKind }) => (
  <View
    style={{
      width: 7, height: 7, borderRadius: kind === 'cardio' ? 1.5 : 3.5,
      backgroundColor: kind === 'active' ? 'transparent' : kind === 'done' ? C.accent : C.muted,
      borderWidth: kind === 'active' ? 1.5 : 0, borderColor: C.accent,
    }}
  />
);
const Legend = ({ kind, label }: { kind: DotKind; label: string }) => (
  <Row style={{ gap: 5 }}><Dot kind={kind} /><T muted style={{ fontSize: 11 }}>{label}</T></Row>
);
