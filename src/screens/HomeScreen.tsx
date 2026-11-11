import React, { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  addCardio, getActiveSession, getArchivedTemplates, getTemplateCards, getTodayOverride, listDoneDates, listWatchedExercises, loadCategoryMap, loadFlatSets,
  sessionsOnDate, setArchivedTemplates, setTodayOverride, slotForDate, startFreeSession, startSessionFromTemplate, weekStats,
  type DaySlot, type SessionMeta, type TemplateCard, type WeekStats,
} from '../db/repo.ts';
import { fmtDuration, fmtElapsed } from '../domain/format.ts';
import { fmtDaysAgo, weekDays } from '../domain/homeCards.ts';
import { partOf } from '../domain/exerciseCatalog.ts';
import { addDays, dailyPoints, filterSets, summarize, weekdayOf, weekStart } from '../domain/stats.ts';
import { partTotals, streakWeeks } from '../domain/workoutStats.ts';
import { Btn, Card, Chip, H, NumInput, Row, T } from '../ui/components.tsx';
import { RoutinePreview, type StartOpts } from '../ui/RoutinePreview.tsx';
import { C, GC, S } from '../ui/theme.ts';
import { useElapsed } from '../ui/useElapsed.ts';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_HEAD = ['월', '화', '수', '목', '금', '토', '일'];

interface Growth { id: string; name: string; best: number; kg: number | null; pct: number | null; series: number[] }

/** 최근 기록의 최고 중량을 작은 막대 그래프로 (색은 그래프에만 쓴다) */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <View style={{ width: 64 }} />;
  const lo = Math.min(...values); const hi = Math.max(...values); const span = hi - lo || 1;
  return (
    <View style={{ width: 64, height: 28, flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginRight: 8 }}>
      {values.map((v, i) => (
        <View key={i} style={{ flex: 1, height: 6 + ((v - lo) / span) * 22, borderRadius: 2, backgroundColor: GC.all, opacity: i === values.length - 1 ? 1 : 0.55 }} />
      ))}
    </View>
  );
}

const partsText = (c: TemplateCard, n = 3) => c.parts.slice(0, n).map((p) => `${p.part} ${p.sets}`).join(' · ');

export function HomeScreen() {
  const { db, today, version, nav, bump } = useApp();
  const insets = useSafeAreaInsets();
  const [slot, setSlot] = useState<DaySlot | null>(null);
  const [cards, setCards] = useState<TemplateCard[]>([]);
  const [archived, setArchived] = useState<string[]>([]);
  const [override, setOverride] = useState<string | null>(null);
  const [active, setActive] = useState<SessionMeta | null>(null);
  const [doneToday, setDoneToday] = useState<SessionMeta[]>([]);
  const [doneDates, setDoneDates] = useState<string[]>([]);
  const [week, setWeek] = useState<WeekStats | null>(null);
  const [parts, setParts] = useState<{ part: string; sets: number }[]>([]); // 이번 주 부위별 완료 세트
  const [growth, setGrowth] = useState<Growth[]>([]);
  const [cardioMin, setCardioMin] = useState<number | null>(30);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [daySheet, setDaySheet] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const elapsed = useElapsed(active?.started_at, !!active);

  useEffect(() => {
    (async () => {
      setSlot(await slotForDate(db, today));
      setCards(await getTemplateCards(db));
      setArchived(await getArchivedTemplates(db));
      setOverride(await getTodayOverride(db, today));
      setActive(await getActiveSession(db));
      setDoneToday((await sessionsOnDate(db, today)).filter((x) => x.status === 'done'));
      setDoneDates(await listDoneDates(db));
      setWeek(await weekStats(db, today));
      const tracked = (await listWatchedExercises(db)).slice(0, 5);
      const flat = await loadFlatSets(db);
      const cats = await loadCategoryMap(db);
      const wk0 = weekStart(today);
      setParts(partTotals(flat, wk0, addDays(wk0, 6), (x) => partOf(x.exerciseName, cats.get(x.exerciseId))).map((r) => ({ part: r.part, sets: r.sets })));
      setGrowth(tracked.flatMap((t) => {
        const sm = summarize(flat, t.id, t.weight_mode);
        if (!sm.currentBest) return [];
        const series = dailyPoints(filterSets(flat, { exerciseId: t.id }), t.weight_mode).slice(-8).map((p) => p.best);
        return [{ id: t.id, name: t.name, best: sm.currentBest.best, kg: sm.vsPrevious?.kg ?? null, pct: sm.vsPrevious?.pct ?? null, series }];
      }));
    })();
  }, [db, today, version]);

  const startRoutine = async (o: StartOpts) => {
    setPreviewId(null);
    nav.openSession(await startSessionFromTemplate(db, o.templateId, today, { order: o.order, cond: o.cond }));
    bump();
  };
  const startFree = async () => {
    nav.openSession(await startFreeSession(db, today));
    bump();
  };

  // 오늘 할 루틴: 오늘만 바꾼 것이 있으면 그것, 없으면 일정의 루틴
  const scheduledId = slot?.kind === 'weights' ? slot.template_id : null;
  const todayId = override && cards.some((c) => c.id === override) ? override : scheduledId;
  const todayCard = cards.find((c) => c.id === todayId) ?? null;
  const visible = cards.filter((c) => !archived.includes(c.id));
  const hidden = cards.filter((c) => archived.includes(c.id));
  const cycleTag = slot?.cycleDay ? `Day ${slot.cycleDay}/${slot.cycleLength}` : null;
  // 오른쪽 위 표시: 오늘이 반복의 며칠째인지(요일 고정이면 요일), 오늘만 바꿨으면 바꾼 날의 이름
  const dayTag = override && todayCard ? todayCard.name : slot?.cycleDay ? `Day ${slot.cycleDay}` : `${DAY[weekdayOf(today)]}요일`;

  const week7 = weekDays(today);
  const doneSet = new Set(doneDates);
  const streak = streakWeeks(doneDates, today);

  const archive = (id: string, on: boolean) => {
    const next = on ? [...archived, id] : archived.filter((x) => x !== id);
    setArchived(next);
    setArchivedTemplates(db, next);
  };
  const chooseDay = (c: TemplateCard) => {
    setDaySheet(false);
    if (c.id === todayId) return;
    Alert.alert('오늘 운동 바꾸기', `오늘은 ‘${c.name}’으로 할까요?\n일정은 그대로 두고 오늘만 바뀌어요.`, [
      { text: '취소', style: 'cancel' },
      { text: '바꾸기', onPress: async () => { await setTodayOverride(db, today, c.id); setOverride(c.id); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 110 }}>
        <H style={{ fontSize: 24, marginBottom: 2 }}>OVERDRIVE</H>
        <T muted>{today} ({DAY[weekdayOf(today)]})</T>
        <T muted style={{ marginBottom: S.md }}>이번 주 {week?.workouts ?? 0}회{streak > 0 ? ` · ${streak}주 연속` : ''}</T>

        <Row style={{ justifyContent: 'space-between', marginBottom: S.lg }}>
          {week7.map((d, i) => {
            const done = doneSet.has(d);
            const isToday = d === today;
            return (
              <View key={d} style={{ alignItems: 'center', flex: 1 }}>
                <T muted style={{ fontSize: 11, marginBottom: 4 }}>{WEEK_HEAD[i]}</T>
                <View style={{
                  width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: done ? C.accent : C.card2, borderWidth: isToday ? 2 : 0, borderColor: C.text, opacity: d > today && !done ? 0.5 : 1,
                }}>
                  <Text style={{ color: done ? C.onAccent : C.muted, fontWeight: '800', fontSize: 13 }}>{Number(d.slice(8))}</Text>
                </View>
              </View>
            );
          })}
        </Row>

        {active ? (
          <Card style={{ borderColor: C.accent }}>
            <T muted>진행 중인 운동</T>
            <Row style={{ marginTop: 2 }}>
              <T bold style={{ flex: 1, fontSize: 16 }}>{active.title}</T>
              <T bold style={{ fontSize: 26 }}>{fmtElapsed(elapsed)}</T>
            </Row>
          </Card>
        ) : (
          <Card>
            <Row style={{ marginBottom: 6 }}>
              <T muted style={{ flex: 1 }}>오늘의 운동{slot && !override ? ` · ${slot.routineName}` : ''}</T>
              {cards.length > 0 && (
                <Pressable onPress={() => setDaySheet(true)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <T bold style={{ fontSize: 22 }}>{dayTag}</T>
                  <Text style={{ color: C.muted, fontSize: 22, marginLeft: 8 }}>›</Text>
                </Pressable>
              )}
            </Row>

            {doneToday.length > 0 && (
              <T muted style={{ marginBottom: S.sm }}>
                오늘 {doneToday.length}회 완료{doneToday[0].duration_sec ? ` · ${fmtDuration(doneToday.reduce((n, x) => n + (x.duration_sec ?? 0), 0))}` : ''}
              </T>
            )}

            {todayCard ? (
              <>
                <H>{override ? todayCard.name : slot?.label ?? todayCard.name}</H>
                {override && <T muted style={{ fontSize: 12 }}>오늘만 바꾼 운동이에요</T>}
                <Row style={{ flexWrap: 'wrap', marginTop: S.sm }}>
                  {todayCard.parts.map((p) => <Chip key={p.part} label={`${p.part} ${p.sets}세트`} />)}
                </Row>
                <T muted style={{ marginTop: S.sm }}>{todayCard.count}종목 · 마지막 {fmtDaysAgo(todayCard.lastDate, today)}</T>
              </>
            ) : slot?.kind === 'cardio' ? (
              <>
                <H>{slot.label ?? '유산소'}</H>
                <T muted style={{ marginTop: 4, marginBottom: S.sm }}>시간(분) 입력 후 기록</T>
                <Row>
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
              </>
            ) : slot?.kind === 'rest' ? (
              <>
                <H>휴식일</H>
                <T muted style={{ marginTop: 4 }}>회복도 훈련의 일부입니다.</T>
              </>
            ) : (
              <>
                <H>오늘 정해진 루틴이 없어요</H>
                <T muted style={{ marginTop: 4 }}>루틴을 만들어 두면 여기서 바로 시작할 수 있어요.</T>
              </>
            )}
            <Pressable onPress={() => nav.goTab('routine')} style={{ marginTop: S.md }}>
              <T muted style={{ textDecorationLine: 'underline' }}>저장한 루틴 보기</T>
            </Pressable>
          </Card>
        )}

        {!active && (
          <View style={{ marginBottom: S.md }}>
            <Row style={{ marginBottom: S.sm }}>
              <H style={{ fontSize: 16, flex: 1 }}>내 루틴</H>
              <Btn label="+ 새 루틴" kind="ghost" small onPress={() => nav.goTab('routine')} />
            </Row>
            {visible.length === 0 && hidden.length === 0 ? (
              <T muted>아직 루틴이 없어요. ‘+ 새 루틴’으로 만들거나 루틴 탭에서 AI로 가져오세요.</T>
            ) : null}
            {visible.map((c) => (
              <Card key={c.id} style={{ padding: 0 }}>
                <Row>
                  <Pressable onPress={() => setPreviewId(c.id)} style={{ flex: 1, padding: S.lg }}>
                    <T bold style={{ fontSize: 16 }}>{c.name}{c.id === todayId ? '  · 오늘' : ''}</T>
                    {c.parts.length > 0 && <T muted style={{ fontSize: 12, marginTop: 2 }}>{partsText(c)}</T>}
                    <T muted style={{ fontSize: 12 }}>{c.count}종목 · {fmtDaysAgo(c.lastDate, today)}</T>
                  </Pressable>
                  <Pressable
                    onPress={() => Alert.alert(c.name, '이 루틴을 홈 목록에서 숨길까요? 루틴 탭에는 그대로 있고 보관함에서 다시 꺼낼 수 있어요.', [
                      { text: '취소', style: 'cancel' }, { text: '보관하기', onPress: () => archive(c.id, true) },
                    ])}
                    style={{ paddingHorizontal: S.lg, paddingVertical: S.lg }}
                  >
                    <Text style={{ color: C.muted, fontSize: 18 }}>⋯</Text>
                  </Pressable>
                </Row>
              </Card>
            ))}
            {hidden.length > 0 && (
              <>
                <Pressable onPress={() => setShowArchive((v) => !v)} style={{ paddingVertical: S.sm }}>
                  <T muted>보관함 {hidden.length}개 {showArchive ? '▴' : '▾'}</T>
                </Pressable>
                {showArchive && hidden.map((c) => (
                  <Row key={c.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
                    <T style={{ flex: 1 }}>{c.name}</T>
                    <Btn label="꺼내기" kind="ghost" small onPress={() => archive(c.id, false)} />
                  </Row>
                ))}
              </>
            )}
          </View>
        )}

        <Card>
          <Row style={{ marginBottom: S.sm }}>
            <H style={{ fontSize: 16, flex: 1 }}>이번 주 운동</H>
            <T muted style={{ fontSize: 12 }}>월~일</T>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Stat label="운동 횟수" value={`${week?.workouts ?? 0}회`} />
            <Stat label="완료 세트" value={`${week?.sets ?? 0}`} />
            <Stat label="유산소" value={`${Math.round(week?.cardioMin ?? 0)}분`} />
          </Row>
          <View style={{ marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
            <T muted style={{ fontSize: 12, marginBottom: 6 }}>부위별 완료 세트</T>
            {parts.length === 0 ? (
              <T muted>이번 주 완료한 세트가 없어요.</T>
            ) : (
              <Row style={{ flexWrap: 'wrap' }}>
                {parts.map((p) => (
                  <View key={p.part} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card2, alignItems: 'center', minWidth: 64 }}>
                    <T bold style={{ fontSize: 18 }}>{p.sets}</T>
                    <T muted style={{ fontSize: 12 }}>{p.part}</T>
                  </View>
                ))}
              </Row>
            )}
          </View>
        </Card>

        <Card>
          <H style={{ fontSize: 16, marginBottom: S.sm }}>최근 중량 성장</H>
          {growth.length === 0 ? (
            <T muted>성장 분석에서 보고 싶은 운동을 고르면, 완료한 기록의 최고 중량과 변화량이 여기에 표시됩니다.</T>
          ) : (
            growth.map((g) => (
              <Pressable key={g.id} onPress={() => nav.goTab('growth')} style={{ paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
                <T style={{ flex: 1 }}>{g.name}</T>
                <Spark values={g.series} />
                <T bold>{g.best}kg</T>
                <Text style={{ width: 84, textAlign: 'right', color: g.kg == null ? C.muted : g.kg > 0 ? C.ok : g.kg < 0 ? C.danger : C.muted, fontSize: 12 }}>
                  {g.kg == null ? '첫 기록' : `${g.kg > 0 ? '+' : ''}${g.kg}kg${g.pct != null ? ` (${g.pct > 0 ? '+' : ''}${g.pct}%)` : ''}`}
                </Text>
              </Pressable>
            ))
          )}
        </Card>
      </ScrollView>

      {/* 아래 고정 버튼: 스크롤해도 항상 손 닿는 곳 */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line }}>
        {active ? (
          <Btn label="이어서 기록하기" onPress={() => nav.openSession(active.id)} />
        ) : (
          <Row>
            <Btn label="자유 운동" kind="ghost" style={{ flex: 1 }} onPress={startFree} />
            {todayCard ? (
              <Btn label="운동 시작" style={{ flex: 2 }} onPress={() => setPreviewId(todayCard.id)} />
            ) : cards.length > 0 ? (
              <Btn label="루틴 고르기" style={{ flex: 2 }} onPress={() => setDaySheet(true)} />
            ) : (
              <Btn label="루틴 만들기" style={{ flex: 2 }} onPress={() => nav.goTab('routine')} />
            )}
          </Row>
        )}
      </View>

      <Modal visible={daySheet} transparent animationType="slide" onRequestClose={() => setDaySheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={() => setDaySheet(false)} />
        <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: S.lg, paddingBottom: S.lg + insets.bottom, maxHeight: '75%' }}>
          <H style={{ fontSize: 18, textAlign: 'center', marginBottom: S.md }}>오늘 어떤 운동을 할까요?</H>
          <ScrollView>
            {override && (
              <Pressable
                onPress={async () => { setDaySheet(false); await setTodayOverride(db, today, null); setOverride(null); }}
                style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}
              >
                <T bold>원래 일정으로 되돌리기</T>
              </Pressable>
            )}
            {visible.map((c) => (
              <Pressable key={c.id} onPress={() => chooseDay(c)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <T bold>{c.name}</T>
                  <T muted style={{ fontSize: 12 }}>{[partsText(c), `${c.count}종목`, fmtDaysAgo(c.lastDate, today)].filter(Boolean).join(' · ')}</T>
                </View>
                {c.id === todayId ? <T bold>✓</T> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Btn label="닫기" kind="ghost" style={{ marginTop: S.md }} onPress={() => setDaySheet(false)} />
        </View>
      </Modal>

      <RoutinePreview templateId={previewId} title={cards.find((c) => c.id === previewId)?.name ?? '루틴'} onClose={() => setPreviewId(null)} onStart={startRoutine} />
    </View>
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
