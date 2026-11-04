import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../app/context.tsx';
import { applyImportedRoutine } from '../db/repo.ts';
import { AI_IMPORT_PROMPT, ROUTINE_JSON_SCHEMA } from '../domain/importSchema.ts';
import { parseRoutine, type ParsedDay, type ParseResult } from '../domain/parser.ts';
import { Btn, Card, Chip, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const FORMAT_LABEL: Record<ParseResult['format'], string> = { json: 'JSON', table: 'Markdown 표', text: '텍스트/목록', empty: '없음' };

/** 외부 AI가 만든 루틴을 붙여넣기 → 로컬 파서(네트워크/AI API 호출 없음) → 미리보기·수정 → 저장 */
export function ImportScreen() {
  const { db, nav, bump } = useApp();
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [days, setDays] = useState<ParsedDay[]>([]);
  const [link, setLink] = useState(true);

  const analyze = (text = raw) => {
    const r = parseRoutine(text);
    setResult(r);
    setDays(r.days);
  };

  const patchDay = (i: number, p: Partial<ParsedDay>) => setDays((d) => d.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const patchEx = (i: number, j: number, p: Partial<ParsedDay['exercises'][number]>) =>
    setDays((d) => d.map((x, k) => (k !== i ? x : { ...x, exercises: x.exercises.map((e, m) => (m === j ? { ...e, ...p } : e)) })));

  const save = async () => {
    const usable = days
      .map((d) => ({ ...d, exercises: d.exercises.filter((e) => e.name.trim()) }))
      .filter((d) => d.exercises.length || d.isRest);
    if (!usable.length) return Alert.alert('저장할 루틴이 없습니다');
    const r = await applyImportedRoutine(db, usable, raw, result?.format ?? 'text', { linkWeekdays: link });
    bump();
    Alert.alert('저장됨', `루틴 ${r.templates}개를 저장했습니다.`, [{ text: '확인', onPress: nav.close }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="AI 루틴 가져오기" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Card>
          <T bold>1. 외부 AI에 요청하기</T>
          <T muted style={{ fontSize: 12, marginVertical: 6 }}>
            ChatGPT·Claude·Gemini 등에 아래 프롬프트를 붙여넣고 조건을 적으면 앱이 정확히 읽을 수 있는 JSON이 만들어집니다.
            이 앱은 AI를 호출하지 않으며 비용이 들지 않습니다.
          </T>
          <Row>
            <Btn label="프롬프트 복사" small kind="ghost" onPress={async () => { await Clipboard.setStringAsync(AI_IMPORT_PROMPT); Alert.alert('복사됨', 'AI 채팅창에 붙여넣으세요.'); }} />
            <Btn label="JSON Schema 복사" small kind="ghost" onPress={async () => { await Clipboard.setStringAsync(JSON.stringify(ROUTINE_JSON_SCHEMA, null, 2)); Alert.alert('복사됨'); }} />
          </Row>
        </Card>

        <Card>
          <T bold style={{ marginBottom: 6 }}>2. AI가 만든 루틴 붙여넣기</T>
          <T muted style={{ fontSize: 12, marginBottom: 6 }}>일반 텍스트 · Markdown 표 · Markdown 목록 · JSON 지원</T>
          <TextField value={raw} onChangeText={setRaw} multiline placeholder="여기에 붙여넣기" style={{ minHeight: 140, textAlignVertical: 'top' }} />
          <Row style={{ marginTop: S.sm }}>
            <Btn label="붙여넣기" small kind="ghost" onPress={async () => { const t = await Clipboard.getStringAsync(); setRaw(t); if (t) analyze(t); }} />
            <Btn label="분석하기" onPress={() => analyze()} style={{ flex: 1 }} />
          </Row>
        </Card>

        {result && (
          <>
            <T muted style={{ marginBottom: 6 }}>
              인식 형식: {FORMAT_LABEL[result.format]} · 루틴 {days.length}개 · 종목 {days.reduce((n, d) => n + d.exercises.length, 0)}개
            </T>
            {result.warnings.map((w, i) => <T key={i} style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>⚠ {w}</T>)}

            {days.map((d, i) => (
              <Card key={i}>
                <Row style={{ marginBottom: 6 }}>
                  <TextField value={d.title} onChangeText={(v) => patchDay(i, { title: v })} style={{ flex: 1 }} />
                  <Btn label="삭제" kind="danger" small onPress={() => setDays((x) => x.filter((_, k) => k !== i))} />
                </Row>
                <Row style={{ flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                  <Chip label="요일 없음" active={d.weekday == null} onPress={() => patchDay(i, { weekday: null })} color={C.muted} />
                  {WD.map((w, k) => <Chip key={w} label={w} active={d.weekday === k} onPress={() => patchDay(i, { weekday: k })} />)}
                </Row>
                <Row style={{ marginTop: S.sm }}>
                  <Chip label={d.isRest ? '휴식일 ✓' : '휴식일로 표시'} active={d.isRest} onPress={() => patchDay(i, { isRest: !d.isRest })}  />
                </Row>

                {d.exercises.map((e, j) => (
                  <View key={j} style={{ marginTop: S.md, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
                    <Row>
                      <TextField value={e.name} onChangeText={(v) => patchEx(i, j, { name: v })} style={{ flex: 1 }} />
                      <Btn
                        label="✕" kind="ghost" small
                        onPress={() => patchDay(i, { exercises: d.exercises.filter((_, m) => m !== j) })}
                      />
                    </Row>
                    <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <T muted>세트</T><NumInput value={e.sets} decimal={false} width={52} onCommit={(v) => patchEx(i, j, { sets: v ?? 3 })} />
                      <T muted>횟수</T><NumInput value={e.reps} decimal={false} width={52} onCommit={(v) => patchEx(i, j, { reps: v })} />
                      <T muted>kg</T><NumInput value={e.weight} width={64} onCommit={(v) => patchEx(i, j, { weight: v })} />
                      <T muted>휴식(초)</T><NumInput value={e.restSec} decimal={false} width={60} onCommit={(v) => patchEx(i, j, { restSec: v })} />
                    </Row>
                    {e.repsMax != null && <T muted style={{ fontSize: 11, marginTop: 4 }}>목표 범위 {e.reps}-{e.repsMax}회 (저장 시 {e.reps}회로 기록)</T>}
                  </View>
                ))}
              </Card>
            ))}

            {days.length > 0 && (
              <>
                <Row style={{ marginBottom: S.md }}>
                  <Chip label={link ? '요일 규칙에 연결 ✓' : '요일 규칙에 연결 안 함'} active={link} onPress={() => setLink((v) => !v)} />
                </Row>
                <T muted style={{ fontSize: 12, marginBottom: S.md }}>
                  요일이 있는 루틴은 해당 요일의 오늘의 운동으로 지정됩니다(기존 요일 설정을 덮어씀). 같은 이름의 종목은 기존 종목과 통합되어 기록이 이어집니다.
                </T>
                <Btn label="이대로 저장" onPress={save} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
