import { isTerminalReplay } from './replay';
import type { Metric, Metrics, Replay, TimeRange } from './types';

export interface ReplayLatencyConfig { windowSeconds: number; scrapeSeconds: number }
export interface ReplayLatencyWindow { evaluatedAt: number; windowSeconds: number; settleAfter?: number }
export interface ReplayLoadWindow { range: TimeRange; settleAfter?: number }
export type ReplayLatencyMetrics = { [Key in keyof Metrics]: Metric & { observedAt?: number } };

export function createReplayLatencyConfig(env: Record<string, string | undefined>): ReplayLatencyConfig {
  const seconds = (key: string, fallback: number) => {
    if (!env[key]?.trim()) return fallback;
    const value = Number(env[key]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} 应为正整数秒`);
    return value;
  };
  const scrapeSeconds = seconds('VITE_PROMETHEUS_SCRAPE_INTERVAL_SECONDS', 15);
  return { scrapeSeconds, windowSeconds: Math.max(4 * scrapeSeconds, seconds('VITE_REPLAY_LATENCY_WINDOW_SECONDS', 60)) };
}

/** 窗口不越过实际打流起点。终态固定在结束后两次采集，刷新仍查询同一片段。 */
export function replayLatencyWindow(replay: Replay, now: number, config: ReplayLatencyConfig): ReplayLatencyWindow | undefined {
  if (replay.startedAt === undefined) return;
  const finalTime = isTerminalReplay(replay.status) && replay.finishedAt !== undefined
    ? Math.ceil(replay.finishedAt + 2 * config.scrapeSeconds) : undefined;
  const evaluatedAt = Math.floor(Math.min(now, finalTime ?? now));
  const elapsed = Math.floor(evaluatedAt - replay.startedAt);
  if (elapsed < 2 * config.scrapeSeconds) return;
  return {
    evaluatedAt,
    windowSeconds: Math.min(config.windowSeconds, elapsed),
    // 前端与常见指标代理有 30s 缓存；尾部评估时间固定后再留一轮缓存余量。
    settleAfter: finalTime === undefined ? undefined : finalTime + 30,
  };
}

/** 负载保留两次实际采集的尾部，之后再等待 30s 缓存余量。 */
export function replayLoadWindow(replay: Replay, now: number, config: ReplayLatencyConfig): ReplayLoadWindow | undefined {
  if (replay.startedAt === undefined) return;
  const finalTime = isTerminalReplay(replay.status) && replay.finishedAt !== undefined
    ? replay.finishedAt + 2 * config.scrapeSeconds : undefined;
  return {
    range: { start: replay.startedAt, end: finalTime ?? Math.max(replay.startedAt + 30, Math.floor(now)) },
    settleAfter: finalTime === undefined ? undefined : finalTime + 30,
  };
}

/** 失败仅保留同任务上次成功值和观测时间；空响应、NaN、Inf 均采纳真实结果。 */
export function retainReplayLatency(previous: ReplayLatencyMetrics, next: Metrics, evaluatedAt: number): ReplayLatencyMetrics {
  return Object.fromEntries((Object.keys(next) as (keyof Metrics)[]).map(key => [key,
    next[key].error ? { ...previous[key], error: next[key].error } : { ...next[key], observedAt: evaluatedAt },
  ])) as ReplayLatencyMetrics;
}
