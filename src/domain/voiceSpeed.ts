/**
 * 보이스코칭 속도: 숫자를 읽어 주는 목소리의 빠르기이자 박자의 빠르기.
 * 1.0배 = 한 회 3초. 저장은 예전과 같은 tempo_sec(한 회당 초)를 쓰고, 화면에는 배속만 보여 준다.
 */
export const BASE_TEMPO_SEC = 3;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const speedOf = (tempoSec: number): number => BASE_TEMPO_SEC / (tempoSec > 0 ? tempoSec : BASE_TEMPO_SEC);
export const tempoOf = (speed: number): number => BASE_TEMPO_SEC / speed;
/** 가장 가까운 단계 */
export function nearestSpeed(speed: number): number {
  return SPEEDS.reduce((a, b) => (Math.abs(b - speed) < Math.abs(a - speed) ? b : a), SPEEDS[0]);
}
/** 한 단계 빠르게(+1)/느리게(-1)한 뒤의 한 회당 초 */
export function stepTempo(tempoSec: number, dir: 1 | -1): number {
  const i = SPEEDS.indexOf(nearestSpeed(speedOf(tempoSec)));
  return tempoOf(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]);
}
export const fmtSpeed = (speed: number): string => `${Number(speed.toFixed(2))}x`;
/** 목소리 빠르기(TTS rate): 배속에 맞춰 조금 더 빠르게/느리게 */
export const voiceRate = (speed: number, base: number): number => Math.max(0.6, Math.min(2, base * (0.5 + speed * 0.5)));
/** 속도 칩을 누를 때: 다음 단계로 (맨 끝에서는 처음으로 돌아감) */
export function cycleTempo(tempoSec: number): number {
  const i = SPEEDS.indexOf(nearestSpeed(speedOf(tempoSec)));
  return tempoOf(SPEEDS[(i + 1) % SPEEDS.length]);
}
