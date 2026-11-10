import { Platform } from 'react-native';
import type { Db } from './adapter.ts';
import { openAppDb } from './expoAdapter.ts';
import { openWebDb } from './webAdapter.ts';

/** 앱은 expo-sqlite, 웹 미리보기는 메모리 SQLite */
export function openDb(): Promise<Db> {
  return Platform.OS === 'web' ? openWebDb() : openAppDb();
}
