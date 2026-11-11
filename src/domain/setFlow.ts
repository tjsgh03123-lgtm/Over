/**
 * 세트 자동 진행: (준비) → 세트마다 목표 횟수를 채우면 → 쉬는 시간 → (준비) → 다시 시작을 반복한다.
 * 준비 시간(prepSec)이 0이면 준비 단계 없이 곧바로 센다.
 * 시간은 밖에서 넣어 주므로(nowMs) 그대로 테스트할 수 있다.
 */

export interface FlowConfig {
  targetReps: number;
  totalSets: number;
  restSec: number;
  /** 세트를 시작하기 전 자세를 잡는 시간(초). 없거나 0이면 준비 단계 없음 */
  prepSec?: number;
  /**
   * 세트를 '동작이 멈춘 뒤'에 끝낸다(초). 목표에 닿아도 바로 끝내지 않고, 마지막 1회 뒤로 이 시간 동안 새 횟수가 없으면 끝낸다.
   * 목표보다 적게 했어도 같은 조건으로 끝나고, 그 안에 동작이 이어지면 계속 센다. 기록은 센 횟수 그대로. 없으면 목표 도달 즉시 끝.
   */
  idleEndSec?: number;
}

export type FlowPhase = 'preparing' | 'counting' | 'resting' | 'done';

/** 소리·화면 안내로 바꿀 이벤트 */
export type FlowEvent =
  | { kind: 'setDone'; setNo: number; count: number; last: boolean }
  | { kind: 'restTick'; secLeft: number }
  | { kind: 'prep'; setNo: number }
  | { kind: 'prepTick'; secLeft: number }
  | { kind: 'start'; setNo: number };

export class SetFlow {
  phase: FlowPhase = 'counting';
  /** 지금 몇 번째 세트인지 (1부터) */
  setNo = 1;
  /** 끝낸 세트들의 횟수 */
  counts: number[] = [];
  private endAt = 0;
  private lastTick = -1;
  private lastRepAt = 0;

  cfg: FlowConfig;
  constructor(cfg: FlowConfig) { this.cfg = cfg; }

  get target() { return this.cfg.targetReps; }
  private get prep() { return this.cfg.prepSec && this.cfg.prepSec > 0 ? this.cfg.prepSec : 0; }

  /** 첫 세트 전에 준비 시간을 시작한다 (준비 시간이 없으면 아무것도 안 함) */
  beginPrep(nowMs: number): FlowEvent | null {
    if (!this.prep || this.phase !== 'counting' || this.counts.length > 0) return null;
    this.phase = 'preparing';
    this.endAt = nowMs + this.prep * 1000;
    this.lastTick = -1;
    return { kind: 'prep', setNo: this.setNo };
  }

  /** 이번 세트의 횟수가 바뀌었을 때 부른다. 목표에 닿으면 세트를 끝내고 쉬기(또는 종료)로 넘어간다. (idleEndSec이 있으면 끝내지 않고 마지막 횟수 시각만 적어 둔다) */
  onCount(count: number, nowMs: number): FlowEvent | null {
    if (this.phase !== 'counting') return null;
    if (this.cfg.idleEndSec && this.cfg.idleEndSec > 0) { this.lastRepAt = nowMs; return null; }
    if (count < this.cfg.targetReps) return null;
    return this.endSet(count, nowMs);
  }

  /** 주기적으로 부른다: 마지막 1회 뒤로 idleEndSec 동안 새 횟수가 없으면 세트를 끝낸다 (횟수는 센 그대로) */
  checkIdle(count: number, nowMs: number): FlowEvent | null {
    const idle = this.cfg.idleEndSec;
    if (!idle || idle <= 0 || this.phase !== 'counting' || count <= 0 || this.lastRepAt <= 0) return null;
    if (nowMs - this.lastRepAt < idle * 1000) return null;
    return this.endSet(count, nowMs);
  }

  private endSet(count: number, nowMs: number): FlowEvent {
    this.counts.push(count);
    this.lastRepAt = 0;
    const last = this.setNo >= this.cfg.totalSets;
    const ev: FlowEvent = { kind: 'setDone', setNo: this.setNo, count, last };
    if (last) { this.phase = 'done'; return ev; }
    this.phase = 'resting';
    this.endAt = nowMs + this.cfg.restSec * 1000;
    this.lastTick = -1;
    return ev;
  }

  /** 쉬는 중·준비 중 남은 초 (그 외에는 0) */
  secLeft(nowMs: number): number {
    return this.phase === 'resting' || this.phase === 'preparing' ? Math.max(0, Math.ceil((this.endAt - nowMs) / 1000)) : 0;
  }

  /** 쉬는 시간이 끝났을 때: 준비 시간이 있으면 준비로, 없으면 바로 다음 세트 */
  private afterRest(nowMs: number): FlowEvent {
    this.setNo++;
    if (this.prep) {
      this.phase = 'preparing';
      this.endAt = nowMs + this.prep * 1000;
      this.lastTick = -1;
      return { kind: 'prep', setNo: this.setNo };
    }
    this.phase = 'counting';
    this.lastRepAt = 0;
    return { kind: 'start', setNo: this.setNo };
  }

  /**
   * 주기적으로(예: 0.25초마다) 부른다. 마지막 3초를 알리고, 끝나면 다음 단계로 넘어간다.
   * 준비 시간이 있으면 쉬는 시간의 마지막 3초 대신 준비 시간의 마지막 3초를 알린다(카운트가 두 번 나오지 않게).
   */
  tick(nowMs: number): FlowEvent | null {
    if (this.phase !== 'resting' && this.phase !== 'preparing') return null;
    const left = this.secLeft(nowMs);
    if (left <= 0) {
      if (this.phase === 'resting') return this.afterRest(nowMs);
      this.phase = 'counting';
      return { kind: 'start', setNo: this.setNo };
    }
    if (left <= 3 && left !== this.lastTick) {
      if (this.phase === 'resting' && this.prep) return null;
      this.lastTick = left;
      return this.phase === 'resting' ? { kind: 'restTick', secLeft: left } : { kind: 'prepTick', secLeft: left };
    }
    return null;
  }

  /** 쉬는 시간을 건너뛴다 (준비 시간이 있으면 준비부터, 없으면 바로 다음 세트 시작) */
  skipRest(nowMs = Date.now()): FlowEvent | null {
    if (this.phase !== 'resting') return null;
    return this.afterRest(nowMs);
  }

  /** 준비 시간을 건너뛰고 바로 센다 */
  skipPrep(): FlowEvent | null {
    if (this.phase !== 'preparing') return null;
    this.phase = 'counting';
    this.lastRepAt = 0;
    return { kind: 'start', setNo: this.setNo };
  }

  /** 목표를 못 채우고 끝낼 때: 지금까지 센 횟수를 포함한 세트별 횟수 */
  finish(currentCount: number): number[] {
    const out = this.counts.slice();
    if ((this.phase === 'counting' || this.phase === 'preparing') && currentCount > 0) out.push(currentCount);
    return out;
  }
}
