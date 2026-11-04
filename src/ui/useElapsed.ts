import { useEffect, useState } from 'react';

/** 시작 시각(ISO)부터 지금까지 흐른 초. running이 false이면 멈춘다. 앱을 껐다 켜도 시작 시각 기준이라 이어서 흐른다. */
export function useElapsed(startedAt: string | null | undefined, running: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!startedAt || !running) return;
    const start = new Date(startedAt).getTime();
    const tick = () => setSec(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, running]);
  return sec;
}
