import type { Replay } from './types';

const STATUSES = new Set<Replay['status']>(['queued','preparing','running','draining','cancelling','succeeded','failed','cancelled']);

export function isTerminalReplay(status: Replay['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function timestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 创建和状态响应共用适配；未知/省略的字段不覆盖已经收到的有效数据。 */
export function applyReplayResponse(raw: unknown, previous: Replay, receivedAt = Date.now() / 1000): Replay {
  const response = object(raw);
  if (!response || !STATUSES.has(response.status as Replay['status'])) throw new Error('未知回放状态');
  const progress = object(response.progress);
  const labels = object(object(response.target)?.metrics_labels);
  const metricsLabels = labels && Object.values(labels).every(value => typeof value === 'string') ? labels as Record<string, string> : previous.metricsLabels;
  return {
    ...previous,
    status: response.status as Replay['status'],
    startedAt: timestamp(response.started_at) ?? previous.startedAt,
    finishedAt: timestamp(response.finished_at) ?? previous.finishedAt,
    requestCount: (progress?.ready === false ? undefined : count(progress?.total)) ?? count(response.request_count) ?? previous.requestCount,
    sentCount: count(progress?.sent) ?? count(response.sent_count) ?? previous.sentCount,
    completedCount: count(progress?.completed) ?? count(response.completed_count) ?? previous.completedCount,
    failedCount: count(response.failed_count) ?? previous.failedCount,
    skippedCount: count(progress?.skipped) ?? count(response.skipped_count) ?? previous.skippedCount,
    metricsLabels,
    statusUpdatedAt: receivedAt,
    statusError: undefined,
    taskError: typeof response.error === 'string' ? response.error : undefined,
  };
}

/** 100% 表示处理结束的比例，任务是否成功仍由 status 决定。 */
export function replayPercent(replay: Pick<Replay, 'requestCount' | 'completedCount'>): number | undefined {
  if (replay.requestCount === undefined || replay.requestCount <= 0 || replay.completedCount === undefined) return undefined;
  return Math.min(100, Math.max(0, replay.completedCount / replay.requestCount * 100));
}
