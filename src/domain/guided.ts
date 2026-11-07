/** 루틴 '한 종목씩 진행' 모드: 지금 할 종목·세트와 휴식 종류를 정한다. 화면·DB와 무관한 순수 함수. */
export interface GSet { id: string; done: number; set_type: string }
export interface GEx { id: string; name: string; ss: string | null; sets: GSet[] }

export type RestKind = 'none' | 'set' | 'exercise';

/** 연달아 같은 슈퍼세트 이름을 가진 종목(2개 이상)은 한 덩어리, 나머지는 종목 하나가 한 덩어리 */
export function blocksOf(exs: GEx[]): GEx[][] {
  const out: GEx[][] = [];
  for (const e of exs) {
    const last = out[out.length - 1];
    if (e.ss && last && last[0].ss === e.ss) last.push(e);
    else out.push([e]);
  }
  return out;
}

const pending = (e: GEx, skipped: Set<string>) => (skipped.has(e.id) ? 0 : e.sets.filter((s) => !s.done).length);
const blockPending = (b: GEx[], skipped: Set<string>) => b.reduce((n, e) => n + pending(e, skipped), 0);

export interface Current {
  block: GEx[];
  /** 지금 몇 번째 덩어리인지 (1부터) */
  index: number;
  total: number;
  /** 지금 차례인 종목·세트 */
  exId: string;
  setId: string;
  /** 다음 덩어리 (없으면 null) */
  next: GEx[] | null;
}

/** 지금 할 덩어리를 찾는다. deferred(나중에 하기)는 뒤로 밀리고, skipped(건너뜀) 종목은 끝난 것으로 본다. 다 끝났으면 null */
export function currentOf(exs: GEx[], deferred: string[] = [], skipped: string[] = []): Current | null {
  const sk = new Set(skipped);
  const all = blocksOf(exs);
  const isDef = (b: GEx[]) => deferred.includes(b[0].id);
  const ordered = [...all.filter((b) => !isDef(b)), ...all.filter(isDef)];
  const open = ordered.filter((b) => blockPending(b, sk) > 0);
  const block = open[0];
  if (!block) return null;
  const pick = nextInBlock(block, sk)!;
  return {
    block, index: all.length - open.length + 1, total: all.length,
    exId: pick.exId, setId: pick.setId, next: open[1] ?? null,
  };
}

/** 덩어리 안에서 다음에 할 세트: 완료 세트가 가장 적은 종목부터 번갈아 (같으면 앞 종목) */
export function nextInBlock(block: GEx[], skipped: Set<string>): { exId: string; setId: string } | null {
  let best: { e: GEx; done: number } | null = null;
  for (const e of block) {
    if (pending(e, skipped) === 0) continue;
    const done = e.sets.filter((s) => s.done).length;
    if (!best || done < best.done) best = { e, done };
  }
  if (!best) return null;
  return { exId: best.e.id, setId: best.e.sets.find((s) => !s.done)!.id };
}

/**
 * 방금 이 세트를 끝냈을 때 어떤 휴식을 줄지.
 * 모든 종목이 끝났으면 none, 지금 덩어리가 끝났으면 exercise, 슈퍼세트가 한 바퀴 다 돌았거나 단일 종목이면 set,
 * 슈퍼세트 중간(다음 종목으로 바로 넘어감)이면 none.
 * exs는 해당 세트를 done으로 바꾼 뒤의 상태.
 */
export function restAfter(exs: GEx[], exId: string, skipped: string[] = []): RestKind {
  const sk = new Set(skipped);
  const blocks = blocksOf(exs);
  const block = blocks.find((b) => b.some((e) => e.id === exId));
  if (!block) return 'none';
  if (blocks.every((b) => blockPending(b, sk) === 0)) return 'none';
  if (blockPending(block, sk) === 0) return 'exercise';
  if (block.length === 1) return 'set';
  const counts = block.filter((e) => pending(e, sk) > 0).map((e) => e.sets.filter((s) => s.done).length);
  return counts.every((c) => c === counts[0]) ? 'set' : 'none';
}
