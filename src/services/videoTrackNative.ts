import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface VideoInfo { durationMs: number; width: number; height: number; rotation: number }

export interface TrackRequest {
  startMs: number; endMs: number;
  /** 시작 프레임에서 찍은 점들(0~1, 영상 가로·세로 비율) */
  xs: number[]; ys: number[];
  stepMs?: number;
}
export interface NativeTrack { xs: number[]; ys: number[]; scores: number[]; lostAtMs: number }
export interface TrackReply { times: number[]; frameW: number; frameH: number; tracks: NativeTrack[] }

interface Native {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  track(uri: string, o: Record<string, unknown>): Promise<TrackReply>;
  cancel(jobId: string): void;
  addListener(name: 'onProgress', cb: (e: { jobId: string; done: number; total: number }) => void): { remove(): void };
}

let mod: Native | null | undefined;
function native(): Native {
  if (mod === undefined) {
    try { mod = Platform.OS === 'android' ? requireNativeModule<Native>('VideoTracker') : null; } catch { mod = null; }
  }
  if (!mod) throw new Error('영상 점 추적은 안드로이드 앱에서만 동작합니다');
  return mod;
}

export function trackerAvailable(): boolean {
  try { native(); return true; } catch { return false; }
}
export function getVideoInfo(uri: string): Promise<VideoInfo> { return native().getVideoInfo(uri); }

export interface TrackJob { promise: Promise<TrackReply>; cancel(): void }

/** 구간의 영상 프레임을 읽으며 찍은 점(들)만 따라간다 */
export function startTracking(uri: string, req: TrackRequest, onProgress: (done: number, total: number) => void): TrackJob {
  const n = native();
  const jobId = `trk_${Date.now().toString(36)}`;
  const sub = n.addListener('onProgress', (e) => { if (e.jobId === jobId) onProgress(e.done, e.total); });
  const promise = n.track(uri, { stepMs: 66, ...req, jobId }).finally(() => sub.remove());
  return { promise, cancel: () => n.cancel(jobId) };
}

export function isCancelled(e: unknown): boolean {
  return /CANCELLED|취소/.test(String((e as Error)?.message ?? e));
}
