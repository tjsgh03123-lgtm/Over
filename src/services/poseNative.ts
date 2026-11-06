import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

export type PoseModel = 'lite' | 'full' | 'heavy';

export interface VideoInfo { durationMs: number; width: number; height: number; rotation: number }

interface Native {
  getVideoInfo(uri: string): Promise<VideoInfo>;
  analyze(uri: string, opts: { startMs: number; endMs: number; fps: number; model: PoseModel; jobId: string }): Promise<string>;
  cancel(jobId: string): void;
  addListener(name: 'onProgress', cb: (e: { jobId: string; done: number; total: number }) => void): { remove(): void };
}

let mod: Native | null | undefined;
function native(): Native {
  if (mod === undefined) {
    try { mod = Platform.OS === 'android' ? requireNativeModule<Native>('PoseAnalyzer') : null; } catch { mod = null; }
  }
  if (!mod) throw new Error('영상 분석 기능을 사용할 수 없습니다 (안드로이드 앱에서만 동작합니다)');
  return mod;
}

export function poseAvailable(): boolean {
  try { native(); return true; } catch { return false; }
}

export function getVideoInfo(uri: string): Promise<VideoInfo> {
  return native().getVideoInfo(uri);
}

export interface AnalyzeJob { promise: Promise<string>; cancel(): void }

/** 구간을 분석해 압축된 관절 트랙(base64, domain/pose.ts의 decodeTrack으로 복원)을 돌려준다 */
export function startAnalysis(
  uri: string, o: { startMs: number; endMs: number; fps: number; model: PoseModel },
  onProgress: (done: number, total: number) => void,
): AnalyzeJob {
  const n = native();
  const jobId = `job_${Date.now().toString(36)}`;
  const sub = n.addListener('onProgress', (e) => { if (e.jobId === jobId) onProgress(e.done, e.total); });
  const promise = n.analyze(uri, { ...o, jobId }).finally(() => sub.remove());
  return { promise, cancel: () => n.cancel(jobId) };
}

export function isCancelled(e: unknown): boolean {
  return /CANCELLED|취소/.test(String((e as Error)?.message ?? e));
}
