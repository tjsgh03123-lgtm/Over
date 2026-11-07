/**
 * 세트 자동 진행: 세트마다 목표 횟수를 채우면 → 쉬는 시간 → 다시 시작을 반복한다.
 * 시간은 밖에서 넣어 주므로(nowMs) 그대로 테스트할 수 있다.
 */

export interface FlowConfig {
  targetReps: number;
  totalSets: number;
  restSec: number;
}

export type FlowPhase = 'counting' | 'resting' | 'done';

/** 소리·화면 안내로 바꿀 이벤트 */
export type FlowEvent =
  | { kind: 'setDone'; setNo: number; count: number; last: boolean }
  | { kind: 'restTick'; secLeft: number }
  | { kind: 'start'; setNo: number };

export class SetFlow {
  phase: FlowPhase = 'counting';
  /** 지금 몇 번째 세트인지 (1부터) */
  setNo = 1;
  /** 끝낸 세트들의 횟수 */
  counts: number[] = [];
  private restEndAt = 0;
  private lastTick = -1;

  cfg: FlowConfig;
  constructor(cfg: FlowConfig) { this.cfg = cfg; }

  get target() { return this.cfg.targetReps; }

  /** 이번 세트의 횟수가 바뀌었을 때 부른다. 목표에 닿으면 세트를 끝내고 쉬기(또는 종료)로 넘어간다. */
  onCount(count: number, nowMs: number): FlowEvent | null {
    if (this.phase !== 'counting' || count < this.cfg.targetReps) return null;
    this.counts.push(count);
    const last = this.setNo >= this.cfg.totalSets;
    const ev: FlowEvent = { kind: 'setDone', setNo: this.setNo, count, last };
    if (last) { this.phase = 'done'; return ev; }
    this.phase = 'resting';
    this.restEndAt = nowMs + this.cfg.restSec * 1000;
    this.lastTick = -1;
    return ev;
  }

  /** 쉬는 중 남은 초 (쉬는 중이 아니면 0) */
  secLeft(nowMs: number): number {
    return this.phase === 'resting' ? Math.max(0, Math.ceil((this.restEndAt - nowMs) / 1000)) : 0;
  }

  /** 주기적으로(예: 0.25초마다) 부른다. 마지막 3초를 알리고, 끝나면 다음 세트를 시작한다. */
  tick(nowMs: number): FlowEvent | null {
    if (this.phase !== 'resting') return null;
    const left = this.secLeft(nowMs);
    if (left <= 0) {
      this.phase = 'counting';
      this.setNo++;
      return { kind: 'start', setNo: this.setNo };
    }
    if (left <= 3 && left !== this.lastTick) { this.lastTick = left; return { kind: 'restTick', secLeft: left }; }
    return null;
  }

  /** 쉬는 시간을 건너뛰고 바로 다음 세트 시작 */
  skipRest(): FlowEvent | null {
    if (this.phase !== 'resting') return null;
    this.phase = 'counting';
    this.setNo++;
    return { kind: 'start', setNo: this.setNo };
  }

  /** 목표를 못 채우고 끝낼 때: 지금까지 센 횟수를 포함한 세트별 횟수 */
  finish(currentCount: number): number[] {
    const out = this.counts.slice();
    if (this.phase === 'counting' && currentCount > 0) out.push(currentCount);
    return out;
  }
}
