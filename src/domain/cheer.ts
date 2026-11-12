/**
 * 응원 멘트(상남자 스타일): 종목을 시작할 때, 종목의 마지막 세트를 할 때, 운동이 끝났을 때만 말한다.
 * 같은 말이 연달아 나오지 않게 직전에 한 말은 피해서 고른다.
 */
export type CheerKind = 'start' | 'lastSet' | 'end';

export const CHEER: Record<CheerKind, string[]> = {
  start: [
    '쇠질 시작이다. 오늘도 박살 내자!',
    '약한 소리 집어치워. 시작한다!',
    '이 종목, 오늘 완전히 부숴버리자!',
    '핑계는 집에 두고 왔지? 가자!',
    '준비됐냐? 무게한테 지지 말자!',
    '오늘도 한계를 넘는다. 간다!',
  ],
  lastSet: [
    '마지막 세트다. 남김없이 다 쏟아내!',
    '여기서 갈린다. 끝까지 밀어붙여!',
    '마지막이다. 죽을 각오로 들어!',
    '포기는 없다. 한 개라도 더!',
    '이 세트가 오늘의 승부다. 가자!',
    '힘들어도 올려. 끝까지 간다!',
  ],
  end: [
    '오늘도 해냈다. 진짜 사나이다!',
    '고생했다. 오늘 운동은 네가 이겼다!',
    '끝났다. 내일도 또 박살 내러 오자!',
    '수고했다. 이게 꾸준함의 힘이다!',
    '오늘도 한계를 넘었다. 대단하다!',
    '무게를 이겼다. 푹 쉬고 단백질 챙겨라!',
  ],
};

const lastPicked: Partial<Record<CheerKind, string>> = {};

/** 한 줄을 고른다. rand는 0 이상 1 미만(테스트용으로 바꿀 수 있다). 직전에 고른 말은 피한다. */
export function pickCheer(kind: CheerKind, rand: () => number = Math.random): string {
  const all = CHEER[kind];
  const pool = all.length > 1 ? all.filter((x) => x !== lastPicked[kind]) : all;
  const line = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  lastPicked[kind] = line;
  return line;
}
