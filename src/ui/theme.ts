import type { TextStyle, ViewStyle } from 'react-native';
import { DEFAULT_GRAPH_COLORS, type GraphKey, type ThemeMode } from '../domain/themeModel.ts';

/** UI는 흑·백·회색만 사용한다. 색은 그래프(GC)에서만 쓴다. */
const DARK = {
  bg: '#0A0A0A',
  card: '#141414',
  card2: '#1F1F1F',
  line: '#2C2C2C',
  text: '#F2F2F2',
  muted: '#8E8E8E',
  accent: '#F2F2F2', // 주요 버튼/선택 상태
  onAccent: '#0A0A0A', // accent 위의 글자색
  accentDim: '#262626',
  ok: '#F2F2F2',
  danger: '#9A9A9A',
  overlay: '#000000AA',
};
const LIGHT: typeof DARK = {
  bg: '#F4F4F4',
  card: '#FFFFFF',
  card2: '#EBEBEB',
  line: '#D9D9D9',
  text: '#111111',
  muted: '#6B6B6B',
  accent: '#111111',
  onAccent: '#FFFFFF',
  accentDim: '#E2E2E2',
  ok: '#111111',
  danger: '#7A7A7A',
  overlay: '#00000066',
};

/** 현재 팔레트 (applyTheme으로 교체됨 — 화면은 렌더링 때마다 C를 읽는다) */
export const C: typeof DARK = { ...DARK };
export const GC: Record<GraphKey, string> = { ...DEFAULT_GRAPH_COLORS };
export let themeVersion = 0;
export let currentMode: ThemeMode = 'dark';

export function applyTheme(mode: ThemeMode, graphColors?: Record<GraphKey, string>): void {
  Object.assign(C, mode === 'light' ? LIGHT : DARK);
  if (graphColors) Object.assign(GC, graphColors);
  currentMode = mode;
  themeVersion++;
}

/** 테마가 바뀌면 스타일을 다시 만드는 StyleSheet 대용 (모듈 로드 시점에 색이 굳는 것을 방지) */
export function themed<T extends Record<string, ViewStyle | TextStyle>>(make: () => T): T {
  let cache: T | null = null;
  let ver = -1;
  return new Proxy({} as T, {
    get(_t, key: string) {
      if (!cache || ver !== themeVersion) {
        cache = make();
        ver = themeVersion;
      }
      return (cache as T)[key];
    },
  });
}

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** 디자인 토큰 — 글자 크기·모서리·숫자 서식은 화면에서 직접 쓰지 말고 여기 값을 쓴다 */
export const FS = { display: 56, title: 28, heading: 20, body: 15, caption: 12, label: 11 } as const;
export const R = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
/** 타이머·횟수·무게처럼 자릿수가 바뀌어도 폭이 흔들리지 않는 숫자 */
export const NUM: TextStyle = { fontVariant: ['tabular-nums'] };
