import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, BackHandler, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Ctx, useApp, type AppCtx, type Nav, type Tab } from './src/app/context.tsx';
import { localDateStr, type Db } from './src/db/adapter.ts';
import { openDb } from './src/db/openDb.ts';
import { BodyEntryScreen } from './src/screens/BodyEntryScreen.tsx';
import { CalendarScreen } from './src/screens/CalendarScreen.tsx';
import { ExercisesScreen } from './src/screens/ExercisesScreen.tsx';
import { GrowthScreen } from './src/screens/GrowthScreen.tsx';
import { HomeScreen } from './src/screens/HomeScreen.tsx';
import { RoutineDetailScreen } from './src/screens/RoutineDetailScreen.tsx';
import { DayEditorScreen } from './src/screens/DayEditorScreen.tsx';
import { RoutineScreen } from './src/screens/RoutineScreen.tsx';
import { WizardScreen } from './src/screens/WizardScreen.tsx';
import { ImportScreen } from './src/screens/ImportScreen.tsx';
import { SessionScreen } from './src/screens/SessionScreen.tsx';
import { SetupScreen } from './src/screens/SetupScreen.tsx';
import { SettingsScreen } from './src/screens/SettingsScreen.tsx';
import { ProfileScreen } from './src/screens/ProfileScreen.tsx';
import { Header } from './src/ui/components.tsx';
import { Icon, type IconName } from './src/ui/icons.tsx';
import { findMissedRoutine, getActiveRoutine, getSetting, resolveMissed, setSetting, type MissedChoice, type MissedRoutine } from './src/db/repo.ts';
import { MissedRoutineModal } from './src/ui/MissedRoutineModal.tsx';
import { WebAlertHost } from './src/ui/webAlert.tsx';
import { sanitizeGraphColors, sanitizeMode, type GraphKey, type ThemeMode } from './src/domain/themeModel.ts';
import { applyTheme, C, GC } from './src/ui/theme.ts';

// 폰의 '글자 크기' 설정을 크게 해도 화면이 깨지지 않도록 확대 한도를 둔다 (1.25배까지만 따라간다)
for (const C0 of [Text, TextInput] as any[]) C0.defaultProps = { ...(C0.defaultProps ?? {}), maxFontSizeMultiplier: 1.25 };

type Overlay =
  | { name: 'session'; id: string }
  | { name: 'import' }
  | { name: 'wizard' }
  | { name: 'body' }
  | { name: 'routine'; id: string }
  | { name: 'day'; routineId: string; dayId: string | null; slot?: number | null }
  | { name: 'exercises' }
  | { name: 'setup' }
  | { name: 'settings' };

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: '운동', icon: 'dumbbell' },
  { key: 'routine', label: '루틴', icon: 'routine' },
  { key: 'calendar', label: '캘린더', icon: 'calendar' },
  { key: 'growth', label: '분석', icon: 'chart' },
  { key: 'profile', label: '프로필', icon: 'user' },
];

export default function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [today, setToday] = useState(localDateStr());
  const [tab, setTab] = useState<Tab>('home');
  const [stack, setStack] = useState<Overlay[]>([]);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => { fade.setValue(0); Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start(); }, [tab, fade]);
  const [calDate, setCalDate] = useState<string | null>(null);
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [missed, setMissed] = useState<MissedRoutine | null>(null);
  const [cycleMode, setCycleMode] = useState(false);
  const [foreground, setForeground] = useState(0);
  const [bootTry, setBootTry] = useState(0); // 데이터베이스 열기 다시 시도 횟수

  useEffect(() => {
    (async () => {
      const d = await openDb();
      // 저장된 화면 모드·그래프 색상 복원 (없으면 다크 + 기본 색)
      const m = sanitizeMode(await getSetting(d, 'theme_mode'));
      applyTheme(m, sanitizeGraphColors(await getSetting(d, 'graph_colors')));
      SystemUI.setBackgroundColorAsync(C.bg).catch(() => {}); // 앱 창 배경을 화면 모드에 맞춰 깜빡임 방지
      setModeState(m);
      setDb(d);
      if ((await getSetting(d, 'setup_pending')) === '1') setStack([{ name: 'setup' }]);
    })().catch((e) => setError(String(e?.message ?? e)));
  }, [bootTry]);

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
      if (m) setCycleMode((await getActiveRoutine(db, today))?.mode === 'cycle');
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
    openWizard: () => push({ name: 'wizard' }),
    openBody: () => push({ name: 'body' }),
    openRoutine: (id) => push({ name: 'routine', id }),
    openDay: (routineId, dayId, slot) => push({ name: 'day', routineId, dayId, slot }),
    openExercises: () => push({ name: 'exercises' }),
    openSetup: () => push({ name: 'setup' }),
    openSettings: () => push({ name: 'settings' }),
    goTab: (t) => { setStack([]); setCalDate(null); setTab(t); },
    openCalendar: (date) => { setStack([]); setCalDate(date); setTab('calendar'); },
    close,
  }), [push, close]);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: C.danger, fontWeight: '800', marginBottom: 8 }}>데이터베이스를 열 수 없습니다</Text>
        <Text style={{ color: C.muted, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
        <Pressable onPress={() => { setError(null); setBootTry((n) => n + 1); }} style={{ paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, backgroundColor: C.accent }}>
          <Text style={{ color: C.onAccent, fontWeight: '800' }}>다시 시도</Text>
        </Pressable>
        <Text style={{ color: C.muted, textAlign: 'center', fontSize: 12, marginTop: 12 }}>기록은 지워지지 않았어요. 계속 안 되면 앱을 완전히 종료했다가 다시 열어 주세요.</Text>
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
      SystemUI.setBackgroundColorAsync(C.bg).catch(() => {});
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
  const ctx: AppCtx = { db, today, version, bump, calendarDate: calDate, nav, theme };
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
            <Overlay o={top} key={stack.length + (top.name === 'session' || top.name === 'routine' ? top.id : top.name === 'day' ? `${top.routineId}${top.dayId}` : top.name)} />
          ) : (
            <>
              <Animated.View style={{ flex: 1, opacity: fade }}>
                {tab === 'home' && <HomeScreen />}
                {tab === 'routine' && <RoutineScreen />}
                {tab === 'calendar' && <CalendarScreen />}
                {tab === 'growth' && <GrowthScreen />}
                {tab === 'profile' && <ProfileScreen />}
              </Animated.View>
              <View style={{ flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
                {TABS.map((t) => {
                  const on = tab === t.key;
                  return (
                    <Pressable key={t.key} onPress={() => { setCalDate(null); setTab(t.key); }} accessibilityRole="tab" accessibilityState={{ selected: on }} style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 8, opacity: pressed ? 0.7 : 1 })}>
                      <View style={{ width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.card2 : 'transparent' }}>
                        <Icon name={t.icon} size={22} color={on ? C.text : C.muted} strokeWidth={on ? 2.1 : 1.8} />
                      </View>
                      <Text style={{ fontSize: 11, marginTop: 3, fontWeight: on ? '800' : '500', color: on ? C.text : C.muted, letterSpacing: -0.1 }}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          <MissedRoutineModal missed={missed} cycle={cycleMode} onChoose={chooseMissed} />
          <WebAlertHost />
        </SafeAreaView>
      </Ctx.Provider>
    </SafeAreaProvider>
  );
}

function Overlay({ o }: { o: Overlay }) {
  switch (o.name) {
    case 'session': return <SessionScreen sessionId={o.id} />;
    case 'import': return <ImportScreen />;
    case 'wizard': return <WizardScreen />;
    case 'body': return <BodyEntryScreen />;
    case 'routine': return <RoutineDetailScreen routineId={o.id} />;
    case 'day': return <DayEditorScreen routineId={o.routineId} dayId={o.dayId} slot={o.slot ?? null} />;
    case 'exercises': return <ExercisesScreen />;
    case 'setup': return <SetupScreen />;
    case 'settings': return <SettingsOverlay />;
  }
}

function SettingsOverlay() {
  const { nav } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="설정" onBack={nav.close} />
      <SettingsScreen />
    </View>
  );
}
