/**
 * 응원 멘트(가볍게 힘을 주는 말투): 종목을 시작할 때, 종목의 마지막 세트를 할 때, 운동이 끝났을 때만 말한다.
 * 같은 말이 연달아 나오지 않게 직전에 한 말은 피해서 고른다.
 */
export type CheerKind = 'start' | 'lastSet' | 'end';

export const CHEER: Record<CheerKind, string[]> = {
  start: [
    '좋아요, 화이팅!',
    '오늘도 잘해봐요!',
    '천천히 해봐요, 화이팅!',
    '자세 신경 쓰면서 가볼게요!',
    '컨디션 좋아 보여요, 화이팅!',
    '한 번 해봐요!',
  ],
  lastSet: [
    '마지막이에요, 화이팅!',
    '조금만 더 힘내요!',
    '끝까지 집중해요!',
    '거의 다 왔어요, 힘내요!',
    '마지막 한 번 더, 할 수 있어요!',
    '여기까지 잘했어요, 끝까지 가요!',
  ],
  end: [
    '오늘도 수고했어요!',
    '정말 잘했어요, 고생했어요!',
    '오늘 운동 끝, 수고 많았어요!',
    '꾸준히 하는 모습 멋져요!',
    '고생했어요, 푹 쉬어요!',
    '오늘도 해냈어요, 수고했어요!',
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
