import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../app/context.tsx';
import { applyImportedRoutine } from '../db/repo.ts';
import { AI_IMPORT_PROMPT } from '../domain/importSchema.ts';
import { inferMode, type RoutineMode } from '../domain/routine.ts';
import { pickTextFile, shareTextFile } from '../services/files.ts';
import { parseRoutine, type ParsedDay, type ParseResult } from '../domain/parser.ts';
import { Btn, Card, Chip, Header, NumInput, Row, T, TextField } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const FORMAT_LABEL: Record<ParseResult['format'], string> = { json: 'JSON', table: 'Markdown 표', text: '텍스트/목록', empty: '없음' };

/** 외부 AI가 만든 루틴을 붙여넣기 → 로컬 파서(네트워크/AI API 호출 없음) → 미리보기·수정 → 저장 */
export function ImportScreen() {
  const { db, today, nav, bump } = useApp();
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [days, setDays] = useState<ParsedDay[]>([]);
  const [routineName, setRoutineName] = useState('가져온 루틴');
  const [mode, setMode] = useState<RoutineMode>('cycle');
  const [activate, setActivate] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const analyze = (text = raw) => {
    const r = parseRoutine(text);
    setResult(r);
    setDays(r.days);
    setRoutineName(r.routineName ?? '가져온 루틴');
    setMode(r.mode ?? inferMode(r.days));
  };

  const patchDay = (i: number, p: Partial<ParsedDay>) => setDays((d) => d.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const patchEx = (i: number, j: number, p: Partial<ParsedDay['exercises'][number]>) =>
    setDays((d) => d.map((x, k) => (k !== i ? x : { ...x, exercises: x.exercises.map((e, m) => (m === j ? { ...e, ...p } : e)) })));

  const save = async () => {
    const usable = days
      .map((d) => ({ ...d, exercises: d.exercises.filter((e) => e.name.trim()) }))
      .filter((d) => d.exercises.length || d.isRest);
    if (!usable.length) return Alert.alert('저장할 루틴이 없습니다');
    const r = await applyImportedRoutine(db, today, usable, raw, result?.format ?? 'text', { name: routineName.trim(), mode, activate });
    bump();
    Alert.alert('저장됨', `‘${routineName.trim() || '가져온 루틴'}’ 루틴을 저장했습니다. (${r.days}일)`, [{ text: '확인', onPress: nav.close }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="AI 루틴 가져오기" onBack={nav.close} />
      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Card>
          <T bold>1. 다른 AI에 요청하기</T>
          <T muted style={{ fontSize: 12, marginVertical: 6 }}>
            ChatGPT·Claude·Gemini 등에 프롬프트를 붙여넣고, 맨 아래 구분선 밑에 원하는 루틴을 적으면 이 앱이 바로 읽을 수 있는 형식으로 만들어 줍니다.
            이 앱은 AI를 호출하지 않으며 비용이 들지 않습니다.
          </T>
          <Row>
            <Btn label="프롬프트 복사" small style={{ flex: 1 }} onPress={async () => { await Clipboard.setStringAsync(AI_IMPORT_PROMPT); Alert.alert('복사됨', 'AI 채팅창에 붙여넣고, 맨 아래 구분선 밑에 원하는 루틴을 적으세요.'); }} />
            <Btn
              label="텍스트 파일로 저장" small kind="ghost" style={{ flex: 1 }}
              onPress={async () => { try { await shareTextFile('overdrive-ai-prompt.txt', AI_IMPORT_PROMPT, 'text/plain'); } catch (e) { Alert.alert('오류', (e as Error).message); } }}
            />
          </Row>
        </Card>

        <Card>
          <T bold style={{ marginBottom: 6 }}>2. AI가 만든 루틴 가져오기</T>
          <T muted style={{ fontSize: 12, marginBottom: 6 }}>AI가 만든 글을 복사한 뒤 아래 ‘붙여넣어 분석’을 누르세요. 글이 길어도 입력창을 열 필요가 없어요. JSON(권장)·Markdown 표/목록·일반 텍스트를 읽어요.</T>
          <Row>
            <Btn label="붙여넣어 분석" style={{ flex: 1 }} onPress={async () => { const t = await Clipboard.getStringAsync(); if (!t.trim()) return Alert.alert('복사한 글이 없어요', 'AI가 만든 루틴을 먼저 복사해 주세요.'); setRaw(t); analyze(t); setShowRaw(false); }} />
            <Btn
              label="파일 불러오기" kind="ghost"
              onPress={async () => { try { const t = await pickTextFile(); if (t != null) { setRaw(t); analyze(t); setShowRaw(false); } } catch (e) { Alert.alert('오류', (e as Error).message); } }}
            />
          </Row>
          {raw.length > 0 && !showRaw && <T muted style={{ fontSize: 12, marginTop: S.sm }}>불러온 글 {raw.length.toLocaleString()}자</T>}
          <Row style={{ marginTop: S.sm }}>
            <Chip label={showRaw ? '입력창 접기' : '글을 직접 붙여넣거나 고치기'} active={showRaw} onPress={() => setShowRaw((v) => !v)} />
          </Row>
          {showRaw && (
            <>
              <TextField value={raw} onChangeText={setRaw} multiline placeholder="여기에 붙여넣기" style={{ marginTop: S.sm, minHeight: 100, maxHeight: 160, textAlignVertical: 'top' }} />
              <Btn label="분석하기" onPress={() => { analyze(); setShowRaw(false); }} style={{ marginTop: S.sm }} />
            </>
          )}
        </Card>

        {result && (
          <>
            <T muted style={{ marginBottom: 6 }}>
              인식 형식: {FORMAT_LABEL[result.format]} · {days.length}일 · 종목 {days.reduce((n, d) => n + d.exercises.length, 0)}개
            </T>
            <Card>
              <T muted style={{ marginBottom: 6 }}>루틴 이름</T>
              <TextField value={routineName} onChangeText={setRoutineName} />
              <Row style={{ marginTop: S.sm }}>
                <Chip label="N일 반복" active={mode === 'cycle'} onPress={() => setMode('cycle')} />
                <Chip label="요일 지정" active={mode === 'weekday'} onPress={() => setMode('weekday')} />
              </Row>
            </Card>
            {result.warnings.map((w, i) => <T key={i} style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>⚠ {w}</T>)}

            {days.map((d, i) => (
              <Card key={i}>
                <Row style={{ marginBottom: 6 }}>
                  <TextField value={d.title} onChangeText={(v) => patchDay(i, { title: v })} style={{ flex: 1 }} />
                  <Btn label="삭제" kind="danger" small onPress={() => setDays((x) => x.filter((_, k) => k !== i))} />
                </Row>
                {mode === 'weekday' && (
                  <Row style={{ flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    <Chip label="요일 없음" active={d.weekday == null} onPress={() => patchDay(i, { weekday: null })} color={C.muted} />
                    {WD.map((w, k) => <Chip key={w} label={w} active={d.weekday === k} onPress={() => patchDay(i, { weekday: k })} />)}
                  </Row>
                )}
                <Row style={{ marginTop: S.sm }}>
                  <Chip label={d.isRest ? '휴식 ✓' : '휴식으로 표시'} active={d.isRest} onPress={() => patchDay(i, { isRest: !d.isRest, kind: undefined })}  />
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
                <Row style={{ marginBottom: S.sm }}>
                  <Chip label={activate ? '저장 후 바로 사용 ✓' : '저장만 하기'} active={activate} onPress={() => setActivate((v) => !v)} />
                </Row>
                <T muted style={{ fontSize: 12, marginBottom: S.md }}>
                  같은 이름의 종목은 기존 종목과 통합되어 기록이 이어집니다. 저장한 루틴은 루틴 탭에서 고칠 수 있어요.
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
