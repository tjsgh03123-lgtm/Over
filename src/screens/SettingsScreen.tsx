import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { exportBackup, exportBodyCsv, exportWorkoutCsv, restoreBackup } from '../db/backup.ts';
import { getSchedule, listTemplates, setScheduleRule, type ScheduleRule, type TemplateRow } from '../db/repo.ts';
import type { Intensity } from '../domain/types.ts';
import { pickTextFile, shareTextFile, stamp } from '../services/files.ts';
import { GRAPH_KEYS, GRAPH_LABEL, GRAPH_PRESETS } from '../domain/themeModel.ts';
import { Btn, Card, Chip, H, IntensityPicker, Row, Segmented, T } from '../ui/components.tsx';
import { C, GC, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const KIND: { key: ScheduleRule['kind']; label: string }[] = [
  { key: 'weights', label: '웨이트' }, { key: 'cardio', label: '유산소' }, { key: 'rest', label: '휴식' },
];

export function SettingsScreen() {
  const { db, version, nav, bump, theme } = useApp();
  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [tpls, setTpls] = useState<TemplateRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSchedule(db).then(setRules);
    listTemplates(db).then(setTpls);
  }, [db, version]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('오류', (e as Error).message); } finally { setBusy(false); }
  };

  const update = async (r: ScheduleRule, p: Partial<{ kind: ScheduleRule['kind']; templateId: string | null; intensity: Intensity; label: string | null }>) => {
    const kind = p.kind ?? r.kind;
    await setScheduleRule(db, r.weekday, {
      kind,
      templateId: kind === 'weights' ? ('templateId' in p ? p.templateId : r.template_id) : null,
      intensity: p.intensity ?? r.default_intensity,
      label: 'label' in p ? p.label : r.label,
    });
    bump();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }}>
      <H style={{ fontSize: 22, marginBottom: S.lg }}>설정</H>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>주간 루틴</H>
        {rules.map((r) => {
          const tpl = tpls.find((t) => t.id === r.template_id);
          return (
            <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: S.sm }}>
              <Row>
                <T bold style={{ width: 28 }}>{WD[r.weekday]}</T>
                <T style={{ flex: 1 }}>{r.kind === 'rest' ? '휴식' : r.kind === 'cardio' ? (r.label ?? '유산소') : tpl?.name ?? '(루틴 미연결)'}</T>
                <Btn label={open === r.weekday ? '닫기' : '변경'} kind="ghost" small onPress={() => setOpen(open === r.weekday ? null : r.weekday)} />
              </Row>
              {open === r.weekday && (
                <View style={{ marginTop: S.sm }}>
                  <Row style={{ marginBottom: S.sm }}>
                    {KIND.map((k) => <Chip key={k.key} label={k.label} active={r.kind === k.key} onPress={() => update(r, { kind: k.key })} />)}
                  </Row>
                  {r.kind === 'weights' && (
                    <Row style={{ flexWrap: 'wrap', gap: 6, marginBottom: S.sm }}>
                      {tpls.map((t) => <Chip key={t.id} label={t.name} active={r.template_id === t.id} onPress={() => update(r, { templateId: t.id, label: t.name })} />)}
                    </Row>
                  )}
                  {r.kind !== 'rest' && (
                    <>
                      <T muted style={{ fontSize: 12, marginBottom: 4 }}>오늘의 강도</T>
                      <IntensityPicker value={r.default_intensity} compact onChange={(v) => update(r, { intensity: v ?? 'none' })} />
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>백업 · 내보내기</H>
        <T muted style={{ fontSize: 12, marginBottom: S.md }}>
          모든 기록은 이 기기의 앱 저장소(SQLite)에 저장되며, 브라우저 기록·쿠키·사이트 데이터 삭제와 무관합니다. 앱을 삭제하면 데이터도 지워지므로 JSON 백업을 주기적으로 보관하세요.
        </T>
        <Btn
          label="JSON 전체 백업 (공유로 저장)" disabled={busy}
          onPress={() => guard(async () => { await shareTextFile(`overdrive-backup-${stamp()}.json`, JSON.stringify(await exportBackup(db)), 'application/json'); })}
          style={{ marginBottom: S.sm }}
        />
        <Btn
          label="JSON 백업에서 복원" kind="ghost" disabled={busy}
          style={{ marginBottom: S.sm }}
          onPress={() => guard(async () => {
            const text = await pickTextFile();
            if (text == null) return;
            let data: unknown;
            try { data = JSON.parse(text); } catch { throw new Error('JSON 파일을 읽을 수 없습니다'); }
            Alert.alert('복원', '현재 앱의 모든 기록이 백업 내용으로 교체됩니다. 계속할까요?', [
              { text: '취소' },
              {
                text: '복원', style: 'destructive',
                onPress: () => guard(async () => {
                  const r = await restoreBackup(db, data);
                  bump();
                  Alert.alert('복원 완료', `${r.rows}개 행을 복원했습니다.`);
                }),
              },
            ]);
          })}
        />
        <Row>
          <Btn label="운동 CSV" kind="ghost" style={{ flex: 1 }} disabled={busy}
            onPress={() => guard(async () => { await shareTextFile(`overdrive-workouts-${stamp()}.csv`, await exportWorkoutCsv(db), 'text/csv'); })} />
          <Btn label="신체 CSV" kind="ghost" style={{ flex: 1 }} disabled={busy}
            onPress={() => guard(async () => { await shareTextFile(`overdrive-body-${stamp()}.csv`, await exportBodyCsv(db), 'text/csv'); })} />
        </Row>
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>화면</H>
        <Segmented
          options={[{ key: 'light', label: '라이트' }, { key: 'dark', label: '다크' }]}
          value={theme.mode}
          onChange={theme.setMode}
        />
        <T muted style={{ fontSize: 12, marginTop: S.md, marginBottom: S.sm }}>그래프 색상 (화면은 흑백, 그래프에만 색이 쓰입니다)</T>
        {GRAPH_KEYS.map((k) => (
          <View key={k} style={{ paddingVertical: 6 }}>
            <T style={{ marginBottom: 6 }}>{GRAPH_LABEL[k]}</T>
            <Row style={{ flexWrap: 'wrap', gap: 10 }}>
              {GRAPH_PRESETS.map((p) => {
                const on = GC[k].toUpperCase() === p.hex;
                return (
                  <Pressable
                    key={p.hex}
                    onPress={() => theme.setGraphColor(k, p.hex)}
                    accessibilityLabel={`${GRAPH_LABEL[k]} ${p.name}`}
                    style={{
                      width: 30, height: 30, borderRadius: 15, backgroundColor: p.hex,
                      borderWidth: on ? 3 : 0, borderColor: C.text,
                    }}
                  />
                );
              })}
            </Row>
          </View>
        ))}
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: S.sm }}>관리</H>
        <Row style={{ flexWrap: 'wrap' }}>
          <Btn label="루틴 관리" kind="ghost" onPress={nav.openTemplates} />
          <Btn label="종목 관리" kind="ghost" onPress={nav.openExercises} />
          <Btn label="AI 루틴 가져오기" kind="ghost" onPress={nav.openImport} />
        </Row>
      </Card>

      <Card>
        <H style={{ fontSize: 16, marginBottom: 4 }}>정보</H>
        <T muted style={{ fontSize: 12, lineHeight: 18 }}>
          OVERDRIVE는 완전한 오프라인 앱입니다. 서버 전송·AI API 호출·크레딧 소모가 없습니다. 인바디 OCR은 기기 안에서 처리됩니다.
          강도(고중량/중간중량/저중량)는 실제 kg과 별개인 사용자 지정 태그이며, 세트 → 종목 → 운동일 순으로 적용됩니다.
        </T>
      </Card>
    </ScrollView>
  );
}
