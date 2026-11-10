/** 카운트가 이상할 때 원인을 데이터로 보기 위한 기록. 영상은 저장하지 않고 관절 좌표(0~1)만 최근 60초 담는다 */
export interface LogFrame { t: number; lm: ArrayLike<number> }
export interface LogEvent { t: number; n: number; joint: string | null }
export interface LogMeta { w: number; h: number; focus: string; strict: string; exercise?: string | null; count: number }

export const LOG_SECONDS = 60;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** 최근 60초만 남기고 좌표를 소수 3자리로 줄여 JSON 문자열로 만든다. t는 기록 마지막 시각 기준 초(음수 = 이전) */
export function buildPoseLog(frames: LogFrame[], events: LogEvent[], meta: LogMeta): string {
  const end = frames.length ? frames[frames.length - 1].t : 0;
  const from = end - LOG_SECONDS * 1000;
  const fs = frames.filter((f) => f.t >= from);
  return JSON.stringify({
    app: 'OVERDRIVE', kind: 'pose-log', version: 1, ...meta,
    layout: '프레임마다 관절 33개의 [x,y,신뢰도]를 이어 붙인 배열(x,y는 화면 비율 0~1)',
    seconds: Math.round(((fs.length ? fs[fs.length - 1].t - fs[0].t : 0) / 1000) * 10) / 10,
    events: events.filter((e) => e.t >= from).map((e) => ({ s: r3((e.t - end) / 1000), n: e.n, joint: e.joint })),
    frames: fs.map((f) => ({ s: r3((f.t - end) / 1000), lm: Array.from(f.lm, r3) })),
  });
}
