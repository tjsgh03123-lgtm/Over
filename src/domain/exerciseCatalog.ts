import type { Focus } from './liveCount.ts';

export type Part = '가슴' | '등' | '어깨' | '하체' | '팔' | '복근';
export const PARTS: Part[] = ['가슴', '등', '어깨', '하체', '팔', '복근'];
export type Equip = '바벨' | '덤벨' | '머신' | '케이블' | '맨몸';
export const EQUIPS: Equip[] = ['바벨', '덤벨', '머신', '케이블', '맨몸'];

/** 장비에 따라 무게 칸이 뜻하는 것이 다르다 */
export const WEIGHT_LABEL: Record<Equip, string> = {
  바벨: '바+원판 무게', 덤벨: '한 손 무게', 머신: '머신 무게', 케이블: '케이블 무게', 맨몸: '추가 무게(+kg)',
};

export interface CatalogItem {
  name: string;
  part: Part;
  equip: Equip;
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

const MACHINE = '머신 옆에서 상체와 팔이 보이게 두세요.';
/** 머신·케이블·맨몸 종목: 부위·장비 구분과 동작 인식용 (바벨·덤벨 기본 종목은 위 CATALOG) */
export const EXTRA_CATALOG: CatalogItem[] = [
  { name: '펙 덱 플라이', part: '가슴', equip: '머신', focus: 'raise', aliases: ['펙덱', '펙덱플라이', '머신플라이'], tip: FRONT },
  { name: '체스트 프레스 머신', part: '가슴', equip: '머신', focus: 'arm', aliases: ['체스트프레스', '체스트프레스머신'], tip: MACHINE },
  { name: '케이블 크로스오버', part: '가슴', equip: '케이블', focus: 'raise', aliases: ['크로스오버', '케이블크로스오버'], tip: FRONT },
  { name: '딥스', part: '가슴', equip: '맨몸', focus: 'body', aliases: ['딥스', '딥'], tip: SIDE },
  { name: '푸시업', part: '가슴', equip: '맨몸', focus: 'body', aliases: ['푸시업', '팔굽혀펴기'], tip: SIDE },
  { name: '랫 풀다운', part: '등', equip: '케이블', focus: 'arm', aliases: ['렛풀다운', '랫풀다운', '와이드풀다운', '풀다운'], tip: SIDE },
  { name: '시티드 케이블 로우', part: '등', equip: '케이블', focus: 'arm', aliases: ['시티드로우', '케이블로우', '시티드케이블로우'], tip: SIDE },
  { name: '풀업', part: '등', equip: '맨몸', focus: 'body', aliases: ['풀업', '턱걸이', '친업', '어시스트풀업'], tip: FRONT },
  { name: 'T바 로우', part: '등', equip: '머신', focus: 'arm', aliases: ['t바로우', '티바로우'], tip: SIDE },
  { name: '백 익스텐션', part: '등', equip: '머신', focus: 'hinge', aliases: ['백익스텐션', '하이퍼익스텐션'], tip: SIDE },
  { name: '숄더 프레스 머신', part: '어깨', equip: '머신', focus: 'arm', aliases: ['숄더프레스머신', '머신숄더프레스'], tip: FRONT },
  { name: '케이블 레터럴 레이즈', part: '어깨', equip: '케이블', focus: 'raise', aliases: ['케이블레터럴', '케이블사레레'], tip: FRONT },
  { name: '페이스 풀', part: '어깨', equip: '케이블', focus: 'arm', aliases: ['페이스풀'], tip: FRONT },
  { name: '리어 델트 머신', part: '어깨', equip: '머신', focus: 'raise', aliases: ['리어델트머신', '리버스펙덱'], tip: SIDE },
  { name: '레그 프레스', part: '하체', equip: '머신', focus: 'leg', aliases: ['레그프레스'], tip: SIDE },
  { name: '레그 익스텐션', part: '하체', equip: '머신', focus: 'leg', aliases: ['레그익스텐션'], tip: SIDE },
  { name: '레그 컬', part: '하체', equip: '머신', focus: 'leg', aliases: ['레그컬', '라잉레그컬', '시티드레그컬'], tip: SIDE },
  { name: '핵 스쿼트', part: '하체', equip: '머신', focus: 'leg', aliases: ['핵스쿼트'], tip: SIDE },
  { name: '스미스 머신 스쿼트', part: '하체', equip: '머신', focus: 'leg', aliases: ['스미스스쿼트', '스미스머신스쿼트'], tip: SIDE },
  { name: '힙 어브덕션', part: '하체', equip: '머신', focus: 'leg', aliases: ['힙어브덕션', '이너타이', '아웃타이'], tip: SIDE },
  { name: '케이블 푸시다운', part: '팔', equip: '케이블', focus: 'arm', aliases: ['푸시다운', '케이블푸시다운', '트라이셉스푸시다운'], tip: SIDE },
  { name: '케이블 컬', part: '팔', equip: '케이블', focus: 'arm', aliases: ['케이블컬', '케이블바이셉'], tip: SIDE },
  { name: '프리처 컬 머신', part: '팔', equip: '머신', focus: 'arm', aliases: ['프리처컬', '프리처컬머신'], tip: SIDE },
  { name: '트라이셉스 딥', part: '팔', equip: '맨몸', focus: 'body', aliases: ['트라이셉스딥', '벤치딥'], tip: SIDE },
  { name: '행잉 레그 레이즈', part: '복근', equip: '맨몸', focus: 'hinge', aliases: ['행잉레그레이즈', '레그레이즈'], tip: SIDE },
  { name: '크런치', part: '복근', equip: '맨몸', focus: 'hinge', aliases: ['크런치', '싯업'], tip: SIDE },
  { name: '케이블 크런치', part: '복근', equip: '케이블', focus: 'hinge', aliases: ['케이블크런치'], tip: SIDE },
];
const BENCH = '벤치 옆에서 상체와 팔이 보이게 두세요.';
const mk = (name: string, part: Part, equip: Equip, focus: Focus, tip: string): CatalogItem => ({ name, part, equip, focus, aliases: [], tip });
/** 카메라 인식이 되는 종목을 더 늘린 목록 (이름이 정확히 같을 때만 맞춘다. 케틀벨은 덤벨과 같은 무게 방식) */
export const MORE_CATALOG: CatalogItem[] = [
  // 가슴 — 팔 움직임으로 세기
  mk('덤벨 디클라인 벤치프레스', '가슴', '덤벨', 'arm', BENCH),
  mk('덤벨 한팔 체스트 프레스', '가슴', '덤벨', 'arm', BENCH),
  mk('바벨 하이 인클라인 벤치프레스', '가슴', '바벨', 'arm', BENCH),
  mk('스미스 머신 인클라인 벤치프레스', '가슴', '머신', 'arm', BENCH),
  mk('케이블 벤치프레스', '가슴', '케이블', 'arm', BENCH),
  mk('케이블 인클라인 벤치프레스', '가슴', '케이블', 'arm', BENCH),
  mk('케이블 디클라인 벤치프레스', '가슴', '케이블', 'arm', BENCH),
  mk('케이블 스탠딩 한팔 체스트 프레스', '가슴', '케이블', 'arm', FRONT),
  mk('케틀벨 벤치프레스', '가슴', '덤벨', 'arm', BENCH),
  mk('케틀벨 인클라인 벤치프레스', '가슴', '덤벨', 'arm', BENCH),
  // 가슴 — 팔 벌리고 모으기
  mk('덤벨 인클라인 체스트 플라이', '가슴', '덤벨', 'raise', '머리 쪽 정면에서 양팔이 보이게 두세요.'),
  mk('덤벨 디클라인 체스트 플라이', '가슴', '덤벨', 'raise', '머리 쪽 정면에서 양팔이 보이게 두세요.'),
  mk('케이블 벤치 체스트 플라이', '가슴', '케이블', 'raise', FRONT),
  mk('케이블 펙 플라이', '가슴', '케이블', 'raise', FRONT),
  // 가슴 — 몸 전체
  mk('무릎 푸시업', '가슴', '맨몸', 'body', SIDE),
  mk('인클라인 푸시업', '가슴', '맨몸', 'body', SIDE),
  mk('디클라인 푸시업', '가슴', '맨몸', 'body', SIDE),
  mk('평행봉 딥스', '가슴', '맨몸', 'body', SIDE),
  // 하체 — 스쿼트·런지
  mk('덤벨 고블릿 리버스 런지', '하체', '덤벨', 'leg', SIDE),
  mk('덤벨 고블릿 포워드 런지', '하체', '덤벨', 'leg', SIDE),
  mk('덤벨 얼터네이팅 포워드 런지', '하체', '덤벨', 'leg', SIDE),
  mk('덤벨 고블릿 스플릿 스쿼트', '하체', '덤벨', 'leg', SIDE),
  mk('덤벨 스모 스쿼트', '하체', '덤벨', 'leg', FRONT),
  mk('덤벨 고블릿 얼터네이팅 커시 런지', '하체', '덤벨', 'leg', SIDE),
  mk('케틀벨 얼터네이팅 커시 런지', '하체', '덤벨', 'leg', SIDE),
  mk('케틀벨 어시스티드 불가리안 스플릿 스쿼트', '하체', '덤벨', 'leg', SIDE),
  mk('맨몸 리버스 런지', '하체', '맨몸', 'leg', SIDE),
  mk('맨몸 얼터네이팅 리버스 런지', '하체', '맨몸', 'leg', SIDE),
  mk('맨몸 얼터네이팅 래터럴 런지', '하체', '맨몸', 'leg', FRONT),
  mk('맨몸 박스 스쿼트', '하체', '맨몸', 'leg', SIDE),
  mk('포워드 런지', '하체', '맨몸', 'leg', SIDE),
  mk('플레이트 포워드 런지', '하체', '바벨', 'leg', SIDE),
  mk('바벨 스플릿 스쿼트', '하체', '바벨', 'leg', SIDE),
  mk('바벨 스텝업 니 드라이브', '하체', '바벨', 'leg', SIDE),
  mk('바벨 프론트 랙 스텝업 니 드라이브', '하체', '바벨', 'leg', SIDE),
  mk('머신 플레이트 로디드 레그 익스텐션', '하체', '머신', 'leg', SIDE),
  // 하체·둔근 — 엉덩이 접기
  mk('덤벨 크로스 바디 루마니안 데드리프트', '하체', '덤벨', 'hinge', SIDE),
  mk('케틀벨 루마니안 데드리프트', '하체', '덤벨', 'hinge', SIDE),
  mk('바벨 스티프 레그 데드리프트', '하체', '바벨', 'hinge', SIDE),
  mk('케틀벨 스모 데드리프트', '하체', '덤벨', 'hinge', SIDE),
  mk('스미스 머신 스모 루마니안 데드리프트', '하체', '머신', 'hinge', SIDE),
  mk('덤벨 발 높인 글루트 브릿지', '하체', '덤벨', 'hinge', SIDE),
  mk('덤벨 힐 엘리베이티드 힙 쓰러스트', '하체', '덤벨', 'hinge', SIDE),
  mk('덤벨 피겨 포 발뒤꿈치 높인 힙 쓰러스트', '하체', '덤벨', 'hinge', SIDE),
  mk('케틀벨 힙 쓰러스트', '하체', '덤벨', 'hinge', SIDE),
];
export const ALL_ITEMS: CatalogItem[] = [...CATALOG, ...EXTRA_CATALOG, ...MORE_CATALOG];

/** 부위 이름: 종목에 지정된 부위가 있으면 그것(내가 바꾼 값 포함), 없으면 이름이 맞는 기본 종목의 부위, 그것도 없으면 '기타' */
export function partOf(name: string, category?: string | null): string {
  if (category && (PARTS as string[]).includes(category)) return category;
  return matchProfile(name)?.part ?? '기타';
}

const n = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 종목 이름에 가장 잘 맞는 기본 종목을 찾는다 (정확히 같거나, 가장 긴 별칭이 이름에 들어 있는 것) */
export function matchProfile(name: string): CatalogItem | null {
  const q = n(name);
  if (!q) return null;
  let best: { item: CatalogItem; len: number } | null = null;
  for (const item of ALL_ITEMS) {
    for (const a of [n(item.name), ...item.aliases.map(n)]) {
      if (q === a) return item;
      if (q.includes(a) && (!best || a.length > best.len)) best = { item, len: a.length };
    }
  }
  return best?.item ?? null;
}
