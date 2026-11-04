import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Chip, Row, T, TextField } from './components.tsx';
import type { DateRange, RangeKey } from '../domain/stats.ts';
import { S } from './theme.ts';

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' },
  { key: '1y', label: '1년' },
  { key: 'all', label: '전체' },
  { key: 'custom', label: '직접 지정' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 입력 중에는 로컬 문자열을 유지하고, 완성된 날짜(또는 빈 값)만 상위에 반영 */
function DateInput({ value, placeholder, onCommit }: { value: string | null; placeholder: string; onCommit: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  return (
    <TextField
      style={{ flex: 1 }}
      placeholder={placeholder}
      value={text}
      maxLength={10}
      keyboardType="numbers-and-punctuation"
      onChangeText={(v) => {
        setText(v);
        if (v === '') onCommit(null);
        else if (DATE_RE.test(v)) onCommit(v);
      }}
    />
  );
}

export function RangePicker({
  value, onChange, custom, onCustom,
}: { value: RangeKey; onChange: (k: RangeKey) => void; custom: DateRange; onCustom: (r: DateRange) => void }) {
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {RANGE_OPTIONS.map((o) => (
          <Chip key={o.key} label={o.label} active={value === o.key} onPress={() => onChange(o.key)} />
        ))}
      </ScrollView>
      {value === 'custom' && (
        <Row style={{ marginTop: S.sm }}>
          <DateInput value={custom.from} placeholder="시작 YYYY-MM-DD" onCommit={(v) => onCustom({ ...custom, from: v })} />
          <T muted>~</T>
          <DateInput value={custom.to} placeholder="종료 YYYY-MM-DD" onCommit={(v) => onCustom({ ...custom, to: v })} />
        </Row>
      )}
    </View>
  );
}
