import type { Focus } from './liveCount.ts';

export type Part = '가슴' | '등' | '어깨' | '하체' | '팔';
export const PARTS: Part[] = ['가슴', '등', '어깨', '하체', '팔'];

export interface CatalogItem {
  name: string;
  part: Part;
  equip: '바벨' | '덤벨';
  /** 실시간 횟수 세기에서 볼 동작 */
  focus: Focus;
  /** 이름 매칭용 (공백 제거·소문자 기준) */
  aliases: string[];
  /** 카메라 놓는 법 */
  tip: string;
}

const SIDE = '카메라를 옆(몸 측면)에 두고 머리부터 발끝까지 보이게 하세요.';
const FRONT = '카메라를 정면에 두고 양팔이 모두 보이게 하세요.';

export const CATALOG: CatalogItem[] = [
  // 가슴
  { name: '바벨 벤치프레스', part: '가슴', equip: '바벨', focus: 'arm', aliases: ['벤치프레스', '바벨벤치', '벤치'], tip: '벤치 옆에서 상체와 팔이 보이게 두세요.' },
  { name: '인클라인 바벨 벤치프레스', part: '가슴', equip: '바벨', focus: 'arm', aliases: ['인클라인벤치', '인클라인바벨', '인클라인벤치프레스'], tip: '벤치 옆에서 상체와 팔이 보이게 두세요.' },
  { name: '덤벨 벤치프레스', part: '가슴', equip: '덤벨', focus: 'arm', aliases: ['덤벨벤치', '덤벨프레스', '덤벨벤치프레스'], tip: '벤치 옆에서 상체와 팔이 보이게 두세요.' },
  { name: '인클라인 덤벨 프레스', part: '가슴', equip: '덤벨', focus: 'arm', aliases: ['인클라인덤벨', '인클라인덤벨프레스'], tip: '벤치 옆에서 상체와 팔이 보이게 두세요.' },
  { name: '덤벨 플라이', part: '가슴', equip: '덤벨', focus: 'raise', aliases: ['덤벨플라이', '플라이', '체스트플라이'], tip: '머리 쪽 정면에서 양팔이 보이게 두세요.' },
  // 등
  { name: '바벨 로우', part: '등', equip: '바벨', focus: 'arm', aliases: ['바벨로우', '벤트오버로우', '펜들레이로우'], tip: SIDE },
  { name: '원암 덤벨 로우', part: '등', equip: '덤벨', focus: 'arm', aliases: ['덤벨로우', '원암로우', '원암덤벨로우'], tip: SIDE },
  { name: '데드리프트', part: '등', equip: '바벨', focus: 'hinge', aliases: ['데드리프트', '데드', '컨벤셔널데드'], tip: SIDE },
  { name: '루마니안 데드리프트', part: '등', equip: '바벨', focus: 'hinge', aliases: ['루마니안', 'rdl', '루마니안데드리프트'], tip: SIDE },
  // 어깨
  { name: '바벨 오버헤드 프레스', part: '어깨', equip: '바벨', focus: 'arm', aliases: ['오버헤드프레스', '밀리터리프레스', '숄더프레스바벨', 'ohp'], tip: FRONT },
  { name: '덤벨 숄더 프레스', part: '어깨', equip: '덤벨', focus: 'arm', aliases: ['덤벨숄더프레스', '숄더프레스', '덤벨오버헤드'], tip: FRONT },
  { name: '덤벨 사이드 레터럴 레이즈', part: '어깨', equip: '덤벨', focus: 'raise', aliases: ['사이드레터럴', '레터럴레이즈', '사레레', '사이드레이즈'], tip: FRONT },
  { name: '덤벨 프론트 레이즈', part: '어깨', equip: '덤벨', focus: 'raise', aliases: ['프론트레이즈', '프론트레이즈덤벨'], tip: SIDE },
  { name: '벤트오버 리어델트 레이즈', part: '어깨', equip: '덤벨', focus: 'raise', aliases: ['리어델트', '벤트오버레이즈', '리어레이즈'], tip: FRONT },
  { name: '덤벨 슈러그', part: '어깨', equip: '덤벨', focus: 'shrug', aliases: ['슈러그', '덤벨슈러그', '바벨슈러그'], tip: FRONT },
  // 하체
  { name: '바벨 백스쿼트', part: '하체', equip: '바벨', focus: 'leg', aliases: ['스쿼트', '백스쿼트', '바벨스쿼트'], tip: SIDE },
  { name: '프론트 스쿼트', part: '하체', equip: '바벨', focus: 'leg', aliases: ['프론트스쿼트'], tip: SIDE },
  { name: '고블릿 스쿼트', part: '하체', equip: '덤벨', focus: 'leg', aliases: ['고블릿', '고블릿스쿼트'], tip: SIDE },
  { name: '덤벨 런지', part: '하체', equip: '덤벨', focus: 'leg', aliases: ['런지', '덤벨런지', '워킹런지'], tip: SIDE },
  { name: '불가리안 스플릿 스쿼트', part: '하체', equip: '덤벨', focus: 'leg', aliases: ['불가리안', '스플릿스쿼트'], tip: SIDE },
  { name: '바벨 힙 쓰러스트', part: '하체', equip: '바벨', focus: 'hinge', aliases: ['힙쓰러스트', '힙쓰러스트바벨', '브릿지'], tip: SIDE },
  { name: '스탠딩 카프 레이즈', part: '하체', equip: '덤벨', focus: 'calf', aliases: ['카프레이즈', '종아리', '스탠딩카프'], tip: SIDE },
  // 팔
  { name: '바벨 컬', part: '팔', equip: '바벨', focus: 'arm', aliases: ['바벨컬', 'ez바컬', 'ez컬', '이지바컬'], tip: '정면이나 옆에서 팔꿈치가 보이게 두세요.' },
  { name: '덤벨 컬', part: '팔', equip: '덤벨', focus: 'arm', aliases: ['덤벨컬', '바이셉컬', '이두컬', '컬'], tip: '정면이나 옆에서 팔꿈치가 보이게 두세요.' },
  { name: '해머 컬', part: '팔', equip: '덤벨', focus: 'arm', aliases: ['해머컬', '해머'], tip: '정면이나 옆에서 팔꿈치가 보이게 두세요.' },
  { name: '라잉 트라이셉스 익스텐션', part: '팔', equip: '바벨', focus: 'arm', aliases: ['스컬크러셔', '라잉트라이셉스', '라잉익스텐션'], tip: '벤치 옆에서 팔꿈치가 보이게 두세요.' },
  { name: '오버헤드 덤벨 익스텐션', part: '팔', equip: '덤벨', focus: 'arm', aliases: ['오버헤드익스텐션', '덤벨익스텐션', '프렌치프레스', '트라이셉스익스텐션'], tip: SIDE },
];

const n = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 종목 이름에 가장 잘 맞는 기본 종목을 찾는다 (정확히 같거나, 가장 긴 별칭이 이름에 들어 있는 것) */
export function matchProfile(name: string): CatalogItem | null {
  const q = n(name);
  if (!q) return null;
  let best: { item: CatalogItem; len: number } | null = null;
  for (const item of CATALOG) {
    for (const a of [n(item.name), ...item.aliases.map(n)]) {
      if (q === a) return item;
      if (q.includes(a) && (!best || a.length > best.len)) best = { item, len: a.length };
    }
  }
  return best?.item ?? null;
}
