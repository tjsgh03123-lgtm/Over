/** 연습(준비) 세트 안내: 본 세트 무게의 40% × 8회 → 60% × 5회 → 80% × 3회 (무게는 증량 단위에 맞춤) */
export interface WarmupSet { weight: number; reps: number }

const STEPS: [number, number][] = [[0.4, 8], [0.6, 5], [0.8, 3]];

export function warmupPlan(topWeight: number | null | undefined, step: number): WarmupSet[] {
  if (!topWeight || topWeight <= 0) return [];
  const s = step > 0 ? step : 2.5;
  const out: WarmupSet[] = [];
  for (const [pct, reps] of STEPS) {
    const w = Math.round(Math.round((topWeight * pct) / s) * s * 100) / 100;
    // 너무 가벼워 0이 되거나, 본 세트와 같아지거나, 앞 세트와 같은 무게는 건너뛴다
    if (w <= 0 || w >= topWeight || out.some((x) => x.weight === w)) continue;
    out.push({ weight: w, reps });
  }
  return out;
}
