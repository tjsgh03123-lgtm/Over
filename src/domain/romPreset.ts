/**
 * 운동마다 "한 번"의 크기가 다르다(컬은 팔꿈치가 100° 가까이 굽지만 카프 레이즈는 뒤꿈치만 살짝 든다).
 * 그래서 세는 범위(작게/보통/크게)를 도(°) 고정값이 아니라 '그 운동의 표준 가동범위에 대한 비율'로 정한다.
 * 표준 가동범위는 관절 움직임 크기를 어림잡은 초안이고, 실제 폰 데이터로 맞춘 값이 아니다.
 * 그래서 처음 몇 번을 센 뒤에는 그 사람의 실제 움직임 크기로 기준을 조금 조정한다(liveCount의 보정).
 */
import { coarseOfExercise, type CoarsePattern } from './exerciseTable.ts';

export interface RomPreset {
  /** 표준 가동범위(도). 각도로 세는 동작의 기준. 위치로 세는 동작(승모·종아리)은 null */
  rom: number | null;
  /** 위치 신호(손목·몸·으쓱·뒤꿈치) 문턱에 곱하는 값. 1이 기본 */
  posScale: number;
  /** 화면 설명에 쓰는 말 */
  what: string;
}

export const ROM_PRESET: Record<CoarsePattern, RomPreset> = {
  squat: { rom: 100, posScale: 1, what: '무릎' },
  hinge: { rom: 80, posScale: 1, what: '고관절(엉덩이)' },
  lunge: { rom: 80, posScale: 1, what: '무릎' },
  pushH: { rom: 90, posScale: 1, what: '팔꿈치' },
  pushUp: { rom: 90, posScale: 1, what: '팔꿈치' },
  pushV: { rom: 90, posScale: 1, what: '팔꿈치' },
  pullV: { rom: 100, posScale: 1, what: '팔꿈치' },
  pullH: { rom: 90, posScale: 1, what: '팔꿈치' },
  curlExt: { rom: 100, posScale: 1, what: '팔꿈치' },
  lift: { rom: 80, posScale: 1, what: '어깨(팔을 든 각도)' },
  shrug: { rom: null, posScale: 0.6, what: '어깨 으쓱' },
  legExt: { rom: 80, posScale: 1, what: '무릎' },
  calf: { rom: null, posScale: 0.8, what: '뒤꿈치' },
  bridge: { rom: 50, posScale: 1, what: '고관절(엉덩이)' },
  core: { rom: 60, posScale: 1, what: '고관절(상체·다리)' },
};

/** 운동 이름을 모르거나 표에 없을 때 쓰는 표준 가동범위(도). 예전 고정값 20/35/50°와 거의 같은 결과가 나오게 잡았다 */
export const DEFAULT_ROM = 70;

export function romPresetOf(name: string | null | undefined): RomPreset | null {
  if (!name) return null;
  const p = coarseOfExercise(name);
  return p ? ROM_PRESET[p] : null;
}
