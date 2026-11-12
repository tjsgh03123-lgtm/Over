import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SessionExRow } from '../db/repo.ts';
import { FlowGlyph } from './FlowShell.tsx';
import { NumInput, T } from './components.tsx';
import { Icon } from './icons.tsx';
import { C, S } from './theme.ts';

/** 보이스코칭·카메라 진행 중에 여는 전체 목록: 모든 종목의 세트를 보고 무게·횟수를 바로 입력한다 */
export function WorkoutListSheet({
  visible, exercises, currentExId, onWeight, onReps, onClose,
}: {
  visible: boolean;
  exercises: SessionExRow[];
  currentExId?: string | null;
  onWeight: (setId: string, v: number | null) => void;
  onReps: (setId: string, v: number | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  // Modal 위에 Modal을 또 띄우면 기기에 따라 뒤에 가려지므로, 코칭 화면 안에 덮어씌우는 방식으로 그린다
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, elevation: 50 }}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + S.sm, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.lg, height: 52 }}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="목록 닫기" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <FlowGlyph kind="back" color={C.text} />
            <T bold style={{ fontSize: 20 }}>전체 목록</T>
          </Pressable>
          <T muted style={{ fontSize: 12 }}>무게·횟수를 눌러 바로 입력</T>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {exercises.map((e) => {
            const cur = e.id === currentExId;
            return (
              <View key={e.id} style={{ marginBottom: S.lg, borderLeftWidth: cur ? 4 : 0, borderLeftColor: C.text, paddingLeft: cur ? S.md : 0 }}>
                {(() => {
                  const n = e.sets.filter((x) => x.done).length;
                  const all = e.sets.length > 0 && n === e.sets.length;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: all ? C.accent : 'transparent', borderWidth: all ? 0 : 1, borderColor: C.line }}>
                        {all && <Icon name="check" size={14} color={C.onAccent} strokeWidth={3} />}
                      </View>
                      <T bold style={{ fontSize: 18, flex: 1, opacity: all ? 0.6 : 1 }}>{e.exercise_name}</T>
                      <T muted style={{ fontSize: 12 }}>{n}/{e.sets.length}</T>
                    </View>
                  );
                })()}
                {e.sets.map((x) => (
                  <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: S.sm, opacity: x.done ? 0.55 : 1 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, marginRight: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: x.done ? C.accent : 'transparent', borderWidth: x.done ? 0 : 1, borderColor: C.line }}>
                      {x.done ? <Icon name="check" size={14} color={C.onAccent} strokeWidth={3} /> : null}
                    </View>
                    <T bold style={{ width: 52 }}>{x.set_no}세트</T>
                    <NumInput value={x.weight} placeholder="kg" width={84} onCommit={(v) => onWeight(x.id, v)} />
                    <T muted style={{ marginHorizontal: 8 }}>kg ×</T>
                    <NumInput value={x.reps} placeholder="회" width={64} decimal={false} onCommit={(v) => onReps(x.id, v)} />
                    <T muted style={{ marginLeft: 8, flex: 1 }}>{x.done ? '완료' : '회'}</T>
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
