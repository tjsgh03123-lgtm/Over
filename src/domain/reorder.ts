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

/**
 * 슈퍼세트를 깨지 않는 위/아래 한 칸 이동: 같은 ss로 묶인 종목은 한 덩어리로 움직인다.
 * i번째 종목이 속한 덩어리를 바로 위(-1)/아래(+1) 덩어리와 자리를 바꾼다. 맨 끝이면 그대로.
 */
export function moveBlock<T extends { ss?: string | null }>(arr: readonly T[], i: number, dir: -1 | 1): T[] {
  if (i < 0 || i >= arr.length) return [...arr];
  const blocks: T[][] = [];
  let at = -1;
  arr.forEach((x, k) => {
    const prev = blocks[blocks.length - 1];
    if (prev && x.ss && prev[prev.length - 1].ss === x.ss) prev.push(x); else blocks.push([x]);
    if (k === i) at = blocks.length - 1;
  });
  const to = at + dir;
  if (to < 0 || to >= blocks.length) return [...arr];
  [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
  return blocks.flat();
}

/**
 * 끌어서 옮기기(슈퍼세트 유지): from 위치 종목이 속한 덩어리를 to 위치 종목이 속한 덩어리 자리로 옮긴다.
 * 같은 덩어리 안이면 그대로. 범위를 벗어난 to는 가장자리로 본다.
 */
export function moveBlockTo<T extends { ss?: string | null }>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return [...arr];
  const blocks: T[][] = [];
  const blockOf: number[] = [];
  arr.forEach((x) => {
    const prev = blocks[blocks.length - 1];
    if (prev && x.ss && prev[prev.length - 1].ss === x.ss) prev.push(x); else blocks.push([x]);
    blockOf.push(blocks.length - 1);
  });
  const a = blockOf[from];
  const b = blockOf[Math.max(0, Math.min(arr.length - 1, to))];
  if (a === b) return [...arr];
  return moveItem(blocks, a, b).flat();
}
