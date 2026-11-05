/** 끌어서 순서 바꾸기에 쓰는 순수 계산 (화면 코드와 분리해서 테스트할 수 있게) */

/** from 위치의 항목을 to 위치로 옮긴 새 배열 (범위를 벗어나면 가장자리로) */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

/**
 * 끌고 있는 항목(from)이 dy만큼 움직였을 때 놓이게 될 위치.
 * 항목마다 높이가 달라도 된다. 아래로 끌 때는 항목의 아래쪽 가장자리가, 위로 끌 때는 위쪽 가장자리가
 * 다른 항목의 중심선을 넘는 순간 자리가 바뀐다(절반쯤 겹치면 바뀌는 느낌).
 */
export function targetIndex(heights: readonly number[], from: number, dy: number): number {
  const n = heights.length;
  if (from < 0 || from >= n) return from;
  let top = 0;
  const mids: number[] = [];
  let fromTop = 0;
  for (let i = 0; i < n; i++) {
    if (i === from) fromTop = top;
    mids.push(top + heights[i] / 2);
    top += heights[i];
  }
  const edge = dy >= 0 ? fromTop + heights[from] + dy : fromTop + dy;
  let t = 0;
  for (let i = 0; i < n; i++) if (i !== from && mids[i] < edge) t++;
  return t;
}

/** 끌고 있는 항목이 목록 밖으로 나가지 않도록 dy를 제한 */
export function clampDrag(heights: readonly number[], from: number, dy: number): number {
  const before = heights.slice(0, from).reduce((a, b) => a + b, 0);
  const after = heights.slice(from + 1).reduce((a, b) => a + b, 0);
  const v = Math.max(-before, Math.min(after, dy));
  return v === 0 ? 0 : v; // -0 방지
}
