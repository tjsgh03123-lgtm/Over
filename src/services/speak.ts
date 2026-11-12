import * as Speech from 'expo-speech';
import { countWord } from '../domain/liveCount.ts';
import { speedOf, voiceRate } from '../domain/voiceSpeed.ts';
import { koVoices, pickVoice, type VoiceInfo } from '../domain/voicePick.ts';

let speed = 1;
let voiceId: string | undefined;
/** 목소리 높낮이: 남자 목소리 느낌을 위해 기본을 살짝 낮춤 (1이 보통) */
let pitch = 0.85;
export function setPitch(p: number): void { pitch = Math.min(1.5, Math.max(0.5, p)); }

/** 설치된 한국어 음성 목록 (자연스러운 순) */
export async function listKoVoices(): Promise<VoiceInfo[]> {
  try { return koVoices((await Speech.getAvailableVoicesAsync()) as VoiceInfo[]); } catch { return []; }
}
/** 저장된 음성(또는 가장 자연스러운 음성)을 적용한다. 앱 시작·설정 변경 때 호출 */
export async function initVoice(savedId?: string | null): Promise<string | undefined> {
  try { voiceId = pickVoice((await Speech.getAvailableVoicesAsync()) as VoiceInfo[], savedId); } catch { voiceId = undefined; }
  return voiceId;
}
export function setVoiceId(id: string | undefined): void { voiceId = id; }

/** 보이스코칭 속도(한 회당 초 기준)를 목소리에도 적용한다 */
export function setSpeechTempo(tempoSec: number): void { speed = speedOf(tempoSec); }

/** 횟수를 소리 내어 읽어 준다 (하나, 둘, 셋…). 앞의 소리가 남아 있으면 끊고 새로 읽는다. */
export function speakCount(n: number): void {
  const w = countWord(n);
  if (!w) return;
  try {
    Speech.stop();
    Speech.speak(w, { language: 'ko-KR', voice: voiceId, pitch, rate: voiceRate(speed, 1.15) });
  } catch { /* 음성 기능이 없으면 무시 */ }
}

export function stopSpeaking(): void {
  try { Speech.stop(); } catch { /* 무시 */ }
}

/** 문장을 읽어 준다. queue가 true면 앞의 소리를 끊지 않고 이어서 읽는다. */
export function speakText(text: string, queue = false): void {
  try {
    if (!queue) Speech.stop();
    Speech.speak(text, { language: 'ko-KR', voice: voiceId, pitch, rate: voiceRate(speed, 1.1) });
  } catch { /* 무시 */ }
}
