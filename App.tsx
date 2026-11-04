import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ctx, type AppCtx, type Nav, type Tab } from './src/app/context.tsx';
import { localDateStr, type Db } from './src/db/adapter.ts';
import { openAppDb } from './src/db/expoAdapter.ts';
import { BodyEntryScreen } from './src/screens/BodyEntryScreen.tsx';
import { CalendarScreen } from './src/screens/CalendarScreen.tsx';
import { ExercisesScreen } from './src/screens/ExercisesScreen.tsx';
import { GrowthScreen } from './src/screens/GrowthScreen.tsx';
import { HomeScreen } from './src/screens/HomeScreen.tsx';
import { PlanScreen } from './src/screens/PlanScreen.tsx';
import { ImportScreen } from './src/screens/ImportScreen.tsx';
import { SessionScreen } from './src/screens/SessionScreen.tsx';
import { SettingsScreen } from './src/screens/SettingsScreen.tsx';
import { TemplatesScreen } from './src/screens/TemplatesScreen.tsx';
import { WorkoutScreen } from './src/screens/WorkoutScreen.tsx';
import { findMissedRoutine, getPlan, getSetting, resolveMissed, setSetting, type MissedChoice, type MissedRoutine } from './src/db/repo.ts';
import { MissedRoutineModal } from './src/ui/MissedRoutineModal.tsx';
import { sanitizeGraphColors, sanitizeMode, type GraphKey, type ThemeMode } from './src/domain/themeModel.ts';
import { applyTheme, C, GC } from './src/ui/theme.ts';

type Overlay =
  | { name: 'session'; id: string }
  | { name: 'import' }
  | { name: 'body' }
  | { name: 'templates'; create?: boolean }
  | { name: 'plan' }
  | { name: 'exercises' };

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: '홈' },
  { key: 'workout', label: '운동' },
  { key: 'calendar', label: '캘린더' },
  { key: 'growth', label: '성장 분석' },
  { key: 'settings', label: '설정' },
];

export default function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [today, setToday] = useState(localDateStr());
  const [tab, setTab] = useState<Tab>('home');
  const [stack, setStack] = useState<Overlay[]>([]);
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [missed, setMissed] = useState<MissedRoutine | null>(null);
  const [cycleMode, setCycleMode] = useState(false);
  const [foreground, setForeground] = useState(0);

  useEffect(() => {
    (async () => {
      const d = await openAppDb();
      // 저장된 화면 모드·그래프 색상 복원 (없으면 다크 + 기본 색)
      const m = sanitizeMode(await getSetting(d, 'theme_mode'));
      applyTheme(m, sanitizeGraphColors(await getSetting(d, 'graph_colors')));
      setModeState(m);
      setDb(d);
    })().catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // 앱이 다시 활성화될 때 날짜 갱신 (자정을 넘긴 경우 오늘의 운동 갱신)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setToday(localDateStr());
        setVersion((v) => v + 1);
        setForeground((n) => n + 1);
      }
    });
    return () => sub.remove();
  }, []);

  // 앱을 켰을 때(또는 다시 활성화됐을 때) 지난 루틴을 완료하지 못했다면 선택창을 띄운다
  useEffect(() => {
    if (!db) return;
    (async () => {
      const m = await findMissedRoutine(db, today);
      if (m) setCycleMode((await getPlan(db, today)).mode === 'cycle');
      setMissed(m);
    })().catch(() => {});
  }, [db, today, foreground]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const push = useCallback((o: Overlay) => setStack((s) => [...s, o]), []);
  const close = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) { close(); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, close]);

  const nav: Nav = useMemo(() => ({
    openSession: (id) => push({ name: 'session', id }),
    openImport: () => push({ name: 'import' }),
    openBody: () => push({ name: 'body' }),
    openTemplates: (create) => push({ name: 'templates', create: !!create }),
    openPlan: () => push({ name: 'plan' }),
    openExercises: () => push({ name: 'exercises' }),
    goTab: (t) => { setStack([]); setTab(t); },
    close,
  }), [push, close]);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: C.danger, fontWeight: '800', marginBottom: 8 }}>데이터베이스를 열 수 없습니다</Text>
        <Text style={{ color: C.muted, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }
  if (!db) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  const theme = {
    mode,
    setMode: (m: ThemeMode) => {
      applyTheme(m);
      setModeState(m);
      setSetting(db, 'theme_mode', m);
    },
    setGraphColor: (key: GraphKey, hex: string) => {
      const next = { ...GC, [key]: hex };
      applyTheme(mode, next);
      setVersion((v) => v + 1);
      setSetting(db, 'graph_colors', JSON.stringify(next));
    },
  };
  const ctx: AppCtx = { db, today, version, bump, nav, theme };
  const top = stack[stack.length - 1];

  const chooseMissed = async (choice: MissedChoice) => {
    const m = missed;
    setMissed(null);
    if (!m) return;
    const sid = await resolveMissed(db, today, m, choice);
    setVersion((v) => v + 1);
    if (sid) push({ name: 'session', id: sid });
  };

  return (
    <SafeAreaProvider>
      <Ctx.Provider value={ctx}>
        <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          {top ? (
            <Overlay o={top} key={stack.length + (top.name === 'session' ? top.id : top.name)} />
          ) : (
            <>
              <View style={{ flex: 1 }}>
                {tab === 'home' && <HomeScreen />}
                {tab === 'workout' && <WorkoutScreen />}
                {tab === 'calendar' && <CalendarScreen />}
                {tab === 'growth' && <GrowthScreen />}
                {tab === 'settings' && <SettingsScreen />}
              </View>
              <View style={{ flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line }}>
                {TABS.map((t) => (
                  <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}>
                    <Text style={{ fontSize: 13, fontWeight: tab === t.key ? '800' : '500', color: tab === t.key ? C.text : C.muted }}>{t.label}</Text>
                    <View style={{ height: 3, width: 18, borderRadius: 2, marginTop: 5, backgroundColor: tab === t.key ? C.accent : 'transparent' }} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <MissedRoutineModal missed={missed} cycle={cycleMode} onChoose={chooseMissed} />
        </SafeAreaView>
      </Ctx.Provider>
    </SafeAreaProvider>
  );
}

function Overlay({ o }: { o: Overlay }) {
  switch (o.name) {
    case 'session': return <SessionScreen sessionId={o.id} />;
    case 'import': return <ImportScreen />;
    case 'body': return <BodyEntryScreen />;
    case 'templates': return <TemplatesScreen startNew={o.create} />;
    case 'plan': return <PlanScreen />;
    case 'exercises': return <ExercisesScreen />;
  }
}
