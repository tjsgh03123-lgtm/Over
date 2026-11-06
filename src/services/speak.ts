import * as Speech from 'expo-speech';
import { countWord } from '../domain/liveCount.ts';

/** 횟수를 소리 내어 읽어 준다 (하나, 둘, 셋…). 앞의 소리가 남아 있으면 끊고 새로 읽는다. */
export function speakCount(n: number): void {
  const w = countWord(n);
  if (!w) return;
  try {
    Speech.stop();
    Speech.speak(w, { language: 'ko-KR', rate: 1.15 });
  } catch { /* 음성 기능이 없으면 무시 */ }
}

export function stopSpeaking(): void {
  try { Speech.stop(); } catch { /* 무시 */ }
}
