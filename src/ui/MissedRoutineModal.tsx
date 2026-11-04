import React from 'react';
import { Modal, View } from 'react-native';
import type { MissedChoice, MissedRoutine } from '../db/repo.ts';
import { Btn, H, T } from './components.tsx';
import { C, S } from './theme.ts';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];

function label(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}월 ${d}일(${DAY[wd]})`;
}

/** 앱을 켰을 때 지난 루틴을 완료하지 않았다면 띄우는 선택창 */
export function MissedRoutineModal({
  missed, cycle, onChoose,
}: { missed: MissedRoutine | null; cycle: boolean; onChoose: (c: MissedChoice) => void }) {
  return (
    <Modal visible={!!missed} transparent animationType="fade" onRequestClose={() => onChoose('skip')}>
      <View style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'center', padding: S.xl }}>
        <View style={{ backgroundColor: C.card, borderRadius: 18, padding: S.xl, borderWidth: 1, borderColor: C.line }}>
          {missed && (
            <>
              <H style={{ marginBottom: 6 }}>지난 루틴을 못 했어요</H>
              <T muted style={{ marginBottom: S.lg, lineHeight: 20 }}>
                {label(missed.date)}의 ‘{missed.templateName}’을(를) 완료하지 않았어요. 어떻게 할까요?
              </T>
              <Btn label="루틴대로 하기" onPress={() => onChoose('follow')} />
              <T muted style={{ fontSize: 11, marginTop: 4, marginBottom: S.md }}>
                그 루틴을 오늘 합니다.{cycle ? ' 이후 일정은 하루씩 이어서 밀려요.' : ''}
              </T>
              <Btn label="오늘만 자유 운동" kind="ghost" onPress={() => onChoose('free')} />
              <T muted style={{ fontSize: 11, marginTop: 4, marginBottom: S.md }}>오늘은 자유롭게 운동하고, 일정은 그대로 둡니다.</T>
              <Btn label="넘어가기" kind="ghost" onPress={() => onChoose('skip')} />
              <T muted style={{ fontSize: 11, marginTop: 4 }}>그 루틴은 건너뛰고 일정대로 진행합니다.</T>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
