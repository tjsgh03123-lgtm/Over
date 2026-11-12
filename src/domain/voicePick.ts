/** 기기에 설치된 한국어 음성 중 가장 자연스러운 것을 고르는 순수 로직 */
export type VoiceInfo = { identifier: string; name?: string; language?: string; quality?: string };

const isKo = (v: VoiceInfo) => /^ko([-_]|$)/i.test(v.language ?? '') || /^ko[-_]/i.test(v.identifier);

/** 높을수록 자연스러움: 신경망/네트워크/고품질 음성 우선, 오프라인 기본 음성은 뒤로 */
export function voiceScore(v: VoiceInfo): number {
  const id = `${v.identifier} ${v.name ?? ''}`.toLowerCase();
  let s = 0;
  if (/enhanced|premium/.test(String(v.quality ?? '').toLowerCase())) s += 10;
  if (/neural|wavenet|studio/.test(id)) s += 8;
  if (/network/.test(id)) s += 6;
  if (/\bko-kr-x-ko[a-d]\b|x-ko[a-d]-/.test(id)) s += 1;
  if (/embedded|compact|local|offline|espeak/.test(id)) s -= 3;
  return s;
}

export function koVoices(all: VoiceInfo[]): VoiceInfo[] {
  return all.filter(isKo).sort((a, b) => voiceScore(b) - voiceScore(a) || a.identifier.localeCompare(b.identifier));
}

/** 저장된 음성이 있으면 그대로, 없으면 가장 점수가 높은 한국어 음성. 없으면 undefined(기기 기본) */
export function pickVoice(all: VoiceInfo[], savedId?: string | null): string | undefined {
  const ko = koVoices(all);
  if (savedId && ko.some((v) => v.identifier === savedId)) return savedId;
  return ko[0]?.identifier;
}
