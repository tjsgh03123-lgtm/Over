/**
 * 보이스 안내 문구: 오늘 종목이 몇 개 중 몇 개 끝났는지, 세트가 몇 개 중 몇 개 남았는지, 마지막인지 알려 준다.
 * 화면·소리와 무관한 순수 함수라 테스트할 수 있다.
 */
export interface VSet { done: number | boolean; set_type: string }
export interface VEx { sets: VSet[] }

const working = (e: VEx) => e.sets.filter((s) => s.set_type !== 'warmup');
/** 본 세트가 있고 모두 끝났으면 종목 완료 */
export const exDone = (e: VEx) => { const w = working(e); return w.length > 0 && w.every((s) => !!s.done); };

export interface ExProgress { total: number; done: number; remaining: number; isLast: boolean }
/** 운동 중인 종목(없으면 마지막 위치 기준)의 오늘 진행: 전체 종목 수, 끝난 수, 남은 수(지금 종목 포함), 마지막 종목인지 */
export function exerciseProgress(exs: VEx[], currentIdx: number): ExProgress {
  const total = exs.filter((e) => working(e).length > 0).length;
  const done = exs.filter((e, i) => i !== currentIdx && exDone(e)).length;
  const remaining = Math.max(0, total - done);
  return { total, done, remaining, isLast: remaining <= 1 };
}

export interface SetProgress { total: number; no: number; remainingAfter: number; isLast: boolean }
/** 지금 하려는 세트(workingNo: 본 세트 중 몇 번째, 1부터) 기준 */
export function setProgress(totalSets: number, workingNo: number): SetProgress {
  const total = Math.max(1, totalSets);
  const no = Math.min(Math.max(1, workingNo), total);
  return { total, no, remainingAfter: total - no, isLast: no >= total };
}

/** 종목을 시작할 때: 오늘 몇 종목 중 몇 종목 끝, 마지막 운동인지 */
export function exerciseIntro(p: ExProgress): string {
  if (p.total <= 1) return '오늘은 이 운동 하나예요.';
  if (p.done === 0) return `오늘 운동은 ${p.total}종목이에요.`;
  return `오늘 ${p.total}종목 중 ${p.done}종목 끝났어요. ${p.isLast ? '마지막 운동이에요.' : `${p.remaining}종목 남았어요.`}`;
}

/** 세트를 시작할 때: 몇 세트 중 몇 번째, 마지막 세트인지 */
export function setIntro(s: SetProgress): string {
  if (s.total <= 1) return '';
  return s.isLast ? '마지막 세트예요.' : `${s.total}세트 중 ${s.no}번째예요.`;
}

/** 세트를 끝냈을 때: 몇 세트 남았는지 */
export function setOutro(s: SetProgress): string {
  return s.remainingAfter > 0 ? `${s.no}세트 완료. ${s.remainingAfter}세트 남았어요.` : `${s.no}세트 완료. 이 종목 마지막 세트였어요.`;
}

/** 종목을 끝냈을 때(다음 종목이 있을 때) */
export function exerciseOutro(p: ExProgress): string {
  return p.remaining > 0 ? `종목 끝. 오늘 ${p.total}종목 중 ${p.total - p.remaining}종목 끝났어요. ${p.remaining}종목 남았어요.` : '오늘 운동을 모두 마쳤어요.';
}
