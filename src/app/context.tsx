import React, { createContext, useContext } from 'react';
import type { Db } from '../db/adapter.ts';
import type { GraphKey, ThemeMode } from '../domain/themeModel.ts';

export type Tab = 'home' | 'routine' | 'calendar' | 'growth' | 'profile';

export interface Nav {
  openSession(id: string): void;
  openImport(): void;
  openBody(): void;
  openRoutine(id: string): void;
  /** dayId가 null이면 새 날 추가 */
  openDay(routineId: string, dayId: string | null): void;
  openExercises(): void;
  openSetup(): void;
  openSettings(): void;
  goTab(t: Tab): void;
  close(): void;
}

export interface ThemeApi {
  mode: ThemeMode;
  setMode(m: ThemeMode): void;
  setGraphColor(key: GraphKey, hex: string): void;
}

export interface AppCtx {
  db: Db;
  today: string;
  /** DB가 바뀔 때마다 증가 — 화면은 이 값을 의존성으로 받아 자동 재조회한다 (그래프 자동 갱신) */
  version: number;
  bump(): void;
  nav: Nav;
  theme: ThemeApi;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppCtx missing');
  return v;
}
