import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C, S, themed } from './theme.ts';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.card, style]}>{children}</View>;
}

export function H({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[st.h, style]}>{children}</Text>;
}

export function T({ children, muted, style, bold }: { children: React.ReactNode; muted?: boolean; bold?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text style={[st.t, muted && { color: C.muted }, bold && { fontWeight: '700' }, style]}>{children}</Text>;
}

export function Btn({
  label, onPress, kind = 'primary', small, disabled, style,
}: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = kind === 'primary' ? C.accent : C.card2;
  const fg = kind === 'primary' ? C.onAccent : kind === 'danger' ? C.danger : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.btn, small && st.btnSm, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}
    >
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, active && { backgroundColor: C.accent, borderColor: C.accent }]}>
      <Text style={{ color: active ? C.onAccent : C.muted, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={st.seg}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={[st.segItem, value === o.key && { backgroundColor: C.accent }]}>
          <Text style={{ color: value === o.key ? C.onAccent : C.muted, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * 숫자 입력: 입력 중에는 문자열을 유지하고, 유효한 값만 상위로 전달 (소수점 입력 중 깨짐 방지).
 * suggest: 값이 비어 있을 때 흐리게 보여 주는 시작값. 칸을 누르면 그 숫자가 입력되어 거기서부터 고칠 수 있다.
 */
export function NumInput({
  value, onCommit, placeholder, width = 72, decimal = true, style, suggest, onFocus,
}: {
  value: number | null; onCommit: (v: number | null) => void; placeholder?: string; width?: number; decimal?: boolean;
  style?: StyleProp<TextStyle>; suggest?: number | null; onFocus?: () => void;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText((prev) => (parseNum(prev) === value ? prev : value == null ? '' : String(value)));
  }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(v) => {
        const clean = decimal ? v.replace(/[^0-9.]/g, '') : v.replace(/[^0-9]/g, '');
        setText(clean);
        onCommit(parseNum(clean));
      }}
      onFocus={() => {
        if (value == null && suggest != null) {
          setText(String(suggest));
          onCommit(suggest);
        }
        onFocus?.();
      }}
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
      placeholder={suggest != null ? String(suggest) : placeholder}
      placeholderTextColor={C.muted}
      selectTextOnFocus
      style={[st.input, { width }, style]}
    />
  );
}

export function parseNum(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: S.md }}>
      <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      {children}
    </View>
  );
}

export function TextField(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={C.muted} {...props} style={[st.textField, props.style]} />;
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: S.xl, alignItems: 'center' }}>
      <Text style={{ color: C.muted, textAlign: 'center', lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: S.sm }, style]}>{children}</View>;
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={st.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={{ paddingRight: 12 }}>
          <Text style={{ color: C.text, fontSize: 22 }}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={[st.h, { flex: 1 }]} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

const st = themed(() => ({
  card: { backgroundColor: C.card, borderRadius: 14, padding: S.lg, marginBottom: S.md, borderWidth: 1, borderColor: C.line },
  h: { color: C.text, fontSize: 18, fontWeight: '800' },
  t: { color: C.text, fontSize: 14 },
  btn: { minHeight: 46, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnSm: { minHeight: 34, paddingHorizontal: 12, borderRadius: 9 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2 },
  seg: { flexDirection: 'row', backgroundColor: C.card2, borderRadius: 12, padding: 3 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  input: {
    height: 44, borderRadius: 10, backgroundColor: C.card2, color: C.text, textAlign: 'center',
    fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: C.line,
  },
  textField: { backgroundColor: C.card2, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: C.line },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.lg, paddingVertical: S.md },
}));
