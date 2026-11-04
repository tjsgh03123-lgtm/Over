import React, { useState } from 'react';
import { View } from 'react-native';
import { Segmented } from '../ui/components.tsx';
import { C, S } from '../ui/theme.ts';
import { WeightGrowth } from './WeightGrowth.tsx';
import { BodyGrowth } from './BodyGrowth.tsx';

export function GrowthScreen() {
  const [mode, setMode] = useState<'weight' | 'body'>('weight');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: S.lg, paddingBottom: S.sm, backgroundColor: C.bg }}>
        <Segmented
          options={[{ key: 'weight', label: '운동 중량' }, { key: 'body', label: '신체 변화' }]}
          value={mode}
          onChange={setMode}
        />
      </View>
      {mode === 'weight' ? <WeightGrowth /> : <BodyGrowth />}
    </View>
  );
}
