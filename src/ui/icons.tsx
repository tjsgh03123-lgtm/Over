import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { C } from './theme.ts';

/** 선 아이콘 세트 (24×24, 선 두께 1.8). 이모지 대신 쓴다 — 기기마다 모양이 달라지지 않는다. */
export type IconName =
  | 'home' | 'routine' | 'calendar' | 'chart' | 'user'
  | 'back' | 'forward' | 'down' | 'up' | 'plus' | 'minus' | 'check' | 'close' | 'more'
  | 'camera' | 'volume' | 'volumeOff' | 'settings' | 'pin' | 'edit' | 'trash' | 'list'
  | 'pause' | 'play' | 'skip' | 'timer' | 'dumbbell' | 'flame' | 'lock';

export function Icon({ name, size = 24, color, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const c = color ?? C.text;
  const p = { stroke: c, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(() => {
        switch (name) {
          case 'home': return <Path d="M4 11 L12 4 L20 11 M6 9.5 V20 H10 V14 H14 V20 H18 V9.5" {...p} />;
          case 'routine': return <><Path d="M9 6 H20 M9 12 H20 M9 18 H20" {...p} /><Circle cx={4.5} cy={6} r={1} fill={c} /><Circle cx={4.5} cy={12} r={1} fill={c} /><Circle cx={4.5} cy={18} r={1} fill={c} /></>;
          case 'calendar': return <><Rect x={4} y={5.5} width={16} height={14.5} rx={3} {...p} /><Path d="M4 10 H20 M8.5 3.5 V7 M15.5 3.5 V7" {...p} /></>;
          case 'chart': return <Path d="M4 20 H20 M7 16 V11 M12 16 V6 M17 16 V9" {...p} />;
          case 'user': return <><Circle cx={12} cy={8.5} r={3.5} {...p} /><Path d="M5 20 C5.5 15.5 8.5 14 12 14 C15.5 14 18.5 15.5 19 20" {...p} /></>;
          case 'back': return <Path d="M15 5 L8 12 L15 19" {...p} />;
          case 'forward': return <Path d="M9 5 L16 12 L9 19" {...p} />;
          case 'down': return <Path d="M6 9 L12 15 L18 9" {...p} />;
          case 'up': return <Path d="M6 15 L12 9 L18 15" {...p} />;
          case 'plus': return <Path d="M12 5 V19 M5 12 H19" {...p} />;
          case 'minus': return <Path d="M5 12 H19" {...p} />;
          case 'check': return <Path d="M5 12.5 L10 17.5 L19 7" {...p} />;
          case 'close': return <Path d="M6 6 L18 18 M18 6 L6 18" {...p} />;
          case 'more': return <><Circle cx={5.5} cy={12} r={1.4} fill={c} /><Circle cx={12} cy={12} r={1.4} fill={c} /><Circle cx={18.5} cy={12} r={1.4} fill={c} /></>;
          case 'camera': return <><Path d="M4 8.5 C4 7.4 4.9 6.5 6 6.5 H8 L9.5 4.5 H14.5 L16 6.5 H18 C19.1 6.5 20 7.4 20 8.5 V17 C20 18.1 19.1 19 18 19 H6 C4.9 19 4 18.1 4 17 Z" {...p} /><Circle cx={12} cy={12.5} r={3.3} {...p} /></>;
          case 'volume': return <><Path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14.5 H4 Z" {...p} /><Path d="M15.5 9 C16.8 10.4 16.8 13.6 15.5 15 M18 6.5 C20.4 9.3 20.4 14.7 18 17.5" {...p} /></>;
          case 'volumeOff': return <><Path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14.5 H4 Z" {...p} /><Path d="M16 9.5 L21 14.5 M21 9.5 L16 14.5" {...p} /></>;
          case 'settings': return <><Circle cx={12} cy={12} r={3} {...p} /><Path d="M12 3.5 V6 M12 18 V20.5 M3.5 12 H6 M18 12 H20.5 M6 6 L7.8 7.8 M16.2 16.2 L18 18 M18 6 L16.2 7.8 M7.8 16.2 L6 18" {...p} /></>;
          case 'pin': return <><Path d="M12 20.5 C8 16 6 13 6 10 C6 6.7 8.7 4.5 12 4.5 C15.3 4.5 18 6.7 18 10 C18 13 16 16 12 20.5 Z" {...p} /><Circle cx={12} cy={10} r={2.2} {...p} /></>;
          case 'edit': return <Path d="M5 19 L5.8 15.2 L15.5 5.5 C16.3 4.7 17.6 4.7 18.4 5.5 L18.5 5.6 C19.3 6.4 19.3 7.7 18.5 8.5 L8.8 18.2 Z M14 7 L17 10" {...p} />;
          case 'trash': return <Path d="M5 7 H19 M9.5 7 V4.5 H14.5 V7 M7 7 L8 20 H16 L17 7 M10 11 V16 M14 11 V16" {...p} />;
          case 'list': return <Path d="M4 7 H20 M4 12 H20 M4 17 H14" {...p} />;
          case 'pause': return <><Rect x={6.5} y={5} width={3.8} height={14} rx={1.2} fill={c} /><Rect x={13.7} y={5} width={3.8} height={14} rx={1.2} fill={c} /></>;
          case 'play': return <Path d="M7.5 5 L19 12 L7.5 19 Z" fill={c} stroke={c} strokeWidth={1.2} strokeLinejoin="round" />;
          case 'skip': return <><Path d="M6 5 L16 12 L6 19 Z" {...p} /><Path d="M19 5 V19" {...p} /></>;
          case 'timer': return <><Circle cx={12} cy={13.5} r={7} {...p} /><Path d="M12 13.5 V9.5 M9.5 3.5 H14.5" {...p} /></>;
          case 'dumbbell': return <Path d="M3.5 9.5 V14.5 M6.5 7 V17 M17.5 7 V17 M20.5 9.5 V14.5 M6.5 12 H17.5" {...p} />;
          case 'flame': return <Path d="M12 3.5 C13 7 17 8.5 17 13.5 C17 17 14.8 20 12 20 C9.2 20 7 17.2 7 14 C7 12 8 10.5 9 9.5 C9.2 11 10 11.8 11 12 C10.5 9 10.8 6 12 3.5 Z" {...p} />;
          case 'lock': return <><Rect x={5.5} y={10.5} width={13} height={9.5} rx={2.5} {...p} /><Path d="M8.5 10.5 V8 C8.5 6.1 10 4.5 12 4.5 C14 4.5 15.5 6.1 15.5 8 V10.5" {...p} /></>;
        }
      })()}
    </Svg>
  );
}
