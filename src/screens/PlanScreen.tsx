import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import {
  getPlan, getSchedule, listTemplates, savePlan, setScheduleRule, type ScheduleRule, type TemplateRow,
} from '../db/repo.ts';
import {
  dayNumberOf, MAX_CYCLE, resizeSlots, startForDayNumber, type CyclePlan, type PlanMode, type PlanSlot, type SlotKind,
} from '../domain/cycle.ts';
import { weekStart } from '../domain/stats.ts';
import { Btn, Card, Chip, Header, Row, Segmented, T } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일
const KIND: { key: SlotKind; label: string }[] = [
  { key: 'weights', label: '웨이트' }, { key: 'cardio', label: '유산소' }, { key: 'rest', label: '휴식' },
];

/** 한 칸(요일 또는 N일차)의 종류/루틴 선택 */
function SlotEditor({
  kind, templateId, tpls, onChange,
}: {
  kind: SlotKind; templateId: string | null; tpls: TemplateRow[];
  onChange: (v: { kind: SlotKind; templateId: string | null; label: string | null }) => void;
}) {
  return (
    <View style={{ marginTop: S.sm }}>
      <Row style={{ marginBottom: S.sm }}>
        {KIND.map((k) => (
          <Chip
            key={k.key} label={k.label} active={kind === k.key}
            onPress={() => onChange({ kind: k.key, templateId: k.key === 'weights' ? templateId : null, label: k.key === 'cardio' ? '유산소' : k.key === 'rest' ? '휴식' : null })}
          />
        ))}
      </Row>
      {kind === 'weights' && (
        tpls.length === 0
          ? <T muted style={{ fontSize: 12 }}>아직 루틴이 없어요. 운동 탭에서 ‘+ 새 루틴’으로 먼저 만들어 주세요.</T>
          : (
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              {tpls.map((t) => (
                <Chip key={t.id} label={t.name} active={templateId === t.id} onPress={() => onChange({ kind: 'weights', templateId: t.id, label: t.name })} />
              ))}
            </Row>
          )
      )}
    </View>
  );
}

export function PlanScreen() {
  const { db, today, version, nav, bump } = useApp();
  const [plan, setPlan] = useState<CyclePlan | null>(null);
  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [tpls, setTpls] = useState<TemplateRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setPlan(await getPlan(db, today));
      setRules(await getSchedule(db));
      setTpls(await listTemplates(db));
    })();
  }, [db, today, version]);

  if (!plan) return <View style={{ flex: 1, backgroundColor: C.bg }}><Header title="루틴 일정" onBack={nav.close} /></View>;

  const tplName = (id: string | null) => tpls.find((t) => t.id === id)?.name ?? '(루틴 미연결)';
  const slotText = (kind: SlotKind, templateId: string | null, label: string | null) =>
    kind === 'rest' ? '휴식' : kind === 'cardio' ? (label ?? '유산소') : tplName(templateId);

  const commit = async (next: CyclePlan) => { setPlan(next); await savePlan(db, next); bump(); };

  const setMode = async (mode: PlanMode) => {
    if (mode === plan.mode) return;
    if (mode === 'cycle' && plan.slots.length === 0) {
      // 처음 주기 모드로 바꾸면 현재 요일별 일정(월~일)을 7일 주기로 가져와서 시작점으로 삼는다
      const slots: PlanSlot[] = WD_ORDER.map((wd) => {
        const r = rules.find((x) => x.weekday === wd);
        return { kind: r?.kind ?? 'rest', templateId: r?.kind === 'weights' ? r.template_id : null, label: r?.label ?? null };
      });
      return commit({ mode, startDate: weekStart(today), slots });
    }
    await commit({ ...plan, mode });
  };

  const updateRule = async (r: ScheduleRule, v: { kind: SlotKind; templateId: string | null; label: string | null }) => {
    await setScheduleRule(db, r.weekday, { kind: v.kind, templateId: v.kind === 'weights' ? v.templateId : null, label: v.label });
    bump();
  };

  const updateSlot = (i: number, v: PlanSlot) => commit({ ...plan, slots: plan.slots.map((s, k) => (k === i ? v : s)) });
  const len = plan.slots.length;
  const todayDay = dayNumberOf(plan, today);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="루틴 일정" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }}>
        <Segmented
          options={[{ key: 'weekday', label: '요일별' }, { key: 'cycle', label: 'N일 주기' }]}
          value={plan.mode}
          onChange={setMode}
        />
        <T muted style={{ fontSize: 12, marginTop: S.sm, marginBottom: S.lg }}>
          {plan.mode === 'weekday'
            ? '요일마다 루틴이나 휴식을 정합니다. 매주 같은 패턴이 반복됩니다.'
            : '며칠을 한 바퀴로 정하고, 각 날에 루틴이나 휴식을 넣습니다. 예: 3일 주기 = 상체 → 하체 → 휴식'}
        </T>

        {plan.mode === 'weekday' ? (
          <Card>
            {WD_ORDER.map((wd) => {
              const r = rules.find((x) => x.weekday === wd);
              const id = `wd${wd}`;
              return (
                <View key={wd} style={{ borderTopWidth: wd === 1 ? 0 : 1, borderTopColor: C.line, paddingVertical: S.sm }}>
                  <Row>
                    <T bold style={{ width: 28 }}>{WD[wd]}</T>
                    <T style={{ flex: 1 }}>{r ? slotText(r.kind, r.template_id, r.label) : '정해지지 않음'}</T>
                    <Btn label={open === id ? '닫기' : '변경'} kind="ghost" small onPress={() => setOpen(open === id ? null : id)} />
                  </Row>
                  {open === id && (
                    <SlotEditor
                      kind={r?.kind ?? 'rest'} templateId={r?.template_id ?? null} tpls={tpls}
                      onChange={(v) => updateRule(r ?? ({ weekday: wd } as ScheduleRule), v)}
                    />
                  )}
                </View>
              );
            })}
          </Card>
        ) : (
          <>
            <Card>
              <Row style={{ marginBottom: S.md }}>
                <T style={{ flex: 1 }}>한 바퀴</T>
                <Btn label="−" kind="ghost" small disabled={len <= 1} onPress={() => commit({ ...plan, slots: resizeSlots(plan.slots, len - 1) })} />
                <T bold style={{ width: 52, textAlign: 'center' }}>{len}일</T>
                <Btn label="+" kind="ghost" small disabled={len >= MAX_CYCLE} onPress={() => commit({ ...plan, slots: resizeSlots(plan.slots, len + 1) })} />
              </Row>
              <Row>
                <T style={{ flex: 1 }}>오늘은</T>
                <Btn
                  label="−" kind="ghost" small
                  onPress={() => commit({ ...plan, startDate: startForDayNumber(today, ((todayDay - 2 + len) % len) + 1, len) })}
                />
                <T bold style={{ width: 52, textAlign: 'center' }}>{todayDay}일차</T>
                <Btn
                  label="+" kind="ghost" small
                  onPress={() => commit({ ...plan, startDate: startForDayNumber(today, (todayDay % len) + 1, len) })}
                />
              </Row>
              <T muted style={{ fontSize: 11, marginTop: S.sm }}>
                ‘오늘은 N일차’를 바꾸면 주기의 시작 위치가 맞춰집니다. 이후로는 날짜가 지날 때마다 자동으로 다음 날이 됩니다.
              </T>
            </Card>

            <Card>
              {plan.slots.map((sl, i) => {
                const id = `c${i}`;
                const isToday = i + 1 === todayDay;
                return (
                  <View key={i} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line, paddingVertical: S.sm }}>
                    <Row>
                      <T bold style={{ width: 52 }}>{i + 1}일차</T>
                      <T style={{ flex: 1 }}>{slotText(sl.kind, sl.templateId, sl.label)}{isToday ? '  · 오늘' : ''}</T>
                      <Btn label={open === id ? '닫기' : '변경'} kind="ghost" small onPress={() => setOpen(open === id ? null : id)} />
                    </Row>
                    {open === id && (
                      <SlotEditor kind={sl.kind} templateId={sl.templateId} tpls={tpls} onChange={(v) => updateSlot(i, v)} />
                    )}
                  </View>
                );
              })}
            </Card>
          </>
        )}

        <Btn label="새 루틴 만들기" kind="ghost" onPress={() => { nav.close(); nav.openTemplates(true); }} />
      </ScrollView>
    </View>
  );
}
