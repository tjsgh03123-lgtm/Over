import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoPlayer } from 'expo-video';

/**
 * 영상 재생 위치(ms)를 돌려주는 훅. 영상이 없거나 열 수 없으면(예: 원본을 지운 저장 결과) 가상 시계로 대신 재생한다.
 * range 밖으로 나가면 멈춘다.
 */
export function useVideoClock(uri: string | null, range: { startMs: number; endMs: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = true;
    p.timeUpdateEventInterval = 0.1;
  });
  const [time, setTime] = useState(range.startMs);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const virtual = !uri || error;
  const live = useRef({ range, virtual, time });
  live.current = { range, virtual, time };
  const inited = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', (e: { currentTime: number }) => {
        const ms = e.currentTime * 1000;
        setTime(ms);
        if (!live.current.virtual && ms >= live.current.range.endMs) {
          player.pause();
          player.currentTime = live.current.range.endMs / 1000;
          setTime(live.current.range.endMs);
        }
      }),
      player.addListener('playingChange', (e: { isPlaying: boolean }) => { if (!live.current.virtual) setPlaying(e.isPlaying); }),
      player.addListener('statusChange', (e: { status: string }) => {
        if (e.status === 'error') setError(true);
        if (e.status === 'readyToPlay' && !inited.current) {
          inited.current = true;
          try { player.currentTime = live.current.time / 1000; } catch { /* 무시 */ }
        }
      }),
    ];
    return () => { subs.forEach((s) => s.remove()); stopTimer(); };
  }, [player]);

  const seek = useCallback((ms: number) => {
    const t = Math.max(live.current.range.startMs, Math.min(live.current.range.endMs, ms));
    setTime(t);
    if (!live.current.virtual) { try { player.currentTime = t / 1000; } catch { /* 아직 준비 전 */ } }
  }, [player]);

  const pause = useCallback(() => {
    if (live.current.virtual) { stopTimer(); setPlaying(false); } else player.pause();
  }, [player]);

  const play = useCallback(() => {
    const { range: r, virtual: v, time: t } = live.current;
    const from = t >= r.endMs - 50 ? r.startMs : t;
    if (!v) {
      if (from !== t) { setTime(from); player.currentTime = from / 1000; }
      player.play();
      return;
    }
    setTime(from);
    setPlaying(true);
    stopTimer();
    let cur = from;
    timer.current = setInterval(() => {
      cur += 50;
      if (cur >= live.current.range.endMs) { cur = live.current.range.endMs; stopTimer(); setPlaying(false); }
      setTime(cur);
    }, 50);
  }, [player]);

  return { player, time, playing, error, virtual, seek, play, pause };
}
