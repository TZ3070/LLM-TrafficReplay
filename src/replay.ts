import type { Replay } from './types';

const STATUSES = new Set<Replay['status']>(['queued','preparing','running','paused','draining','cancelling','succeeded','failed','cancelled']);

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

function capability(value: unknown, previous: boolean | undefined, eligible: boolean): boolean | undefined {
  const supported = typeof value === 'boolean' ? value : previous;
  return supported === undefined ? undefined : eligible && supported;
}

export function replaySpeed(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 创建和状态响应共用适配；未知/省略的字段不覆盖已经收到的有效数据。 */
export function applyReplayResponse(raw: unknown, previous: Replay, receivedAt = Date.now() / 1000): Replay {
  const response = object(raw);
  if (!response || !STATUSES.has(response.status as Replay['status'])) throw new Error('未知回放状态');
  if (typeof response.replay_id === 'string' && response.replay_id !== previous.id) throw new Error('回放任务 ID 不匹配');
  const revision=count(response.revision);
  if (revision !== undefined && previous.revision !== undefined && revision < previous.revision) return previous;
  if (isTerminalReplay(previous.status) && response.status !== previous.status) return previous;
  const progress = object(response.progress);
  const labels = object(object(response.target)?.metrics_labels);
  const metricsLabels = labels && Object.values(labels).every(value => typeof value === 'string') ? labels as Record<string, string> : previous.metricsLabels;
  const status=previous.status === 'cancelling' && !isTerminalReplay(response.status as Replay['status']) ? 'cancelling' : response.status as Replay['status'];
  // 完整任务响应必须重新声明控制能力，不能仅凭刷新前的缓存启用旧后端按钮。
  const fullTask=typeof response.replay_id === 'string';
  return {
    ...previous,
    status,
    speed: replaySpeed(response.speed) ?? previous.speed,
    cancellable: status === 'cancelling' || isTerminalReplay(status) ? false : typeof response.cancellable === 'boolean' ? response.cancellable : previous.cancellable,
    pausable: capability(response.pausable, fullTask ? undefined : previous.pausable, ['queued','running'].includes(status)),
    resumable: capability(response.resumable, fullTask ? undefined : previous.resumable, status === 'paused'),
    pausedAt: response.paused_at === null ? undefined : timestamp(response.paused_at) ?? previous.pausedAt,
    pausedSeconds: timestamp(response.paused_seconds) ?? previous.pausedSeconds,
    cancelRequestedAt: timestamp(response.cancel_requested_at) ?? previous.cancelRequestedAt,
    revision: revision ?? previous.revision,
    startedAt: timestamp(response.started_at) ?? previous.startedAt,
    finishedAt: timestamp(response.finished_at) ?? previous.finishedAt,
    requestCount: (progress?.ready === false ? undefined : count(progress?.total)) ?? count(response.request_count) ?? previous.requestCount,
    sentCount: monotonicCount(count(progress?.sent) ?? count(response.sent_count), previous.sentCount),
    completedCount: monotonicCount(count(progress?.completed) ?? count(response.completed_count), previous.completedCount),
    failedCount: monotonicCount(count(response.failed_count), previous.failedCount),
    skippedCount: count(progress?.skipped) ?? count(response.skipped_count) ?? previous.skippedCount,
    metricsLabels,
    statusUpdatedAt: receivedAt,
    statusError: undefined,
    taskError: typeof response.error === 'string' ? response.error : undefined,
  };
}

function monotonicCount(value: number | undefined, previous: number | undefined) {
  return value === undefined ? previous : previous === undefined ? value : Math.max(value, previous);
}

/** 活动任务可以独立恢复；创建接口的旧响应可用请求上下文补齐字段。 */
export function restoreReplay(raw: unknown, metricsMap: Record<string,string> = {}, fallback?: Replay): Replay {
  const response=object(raw);
  const id=response?.replay_id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('创建回放响应缺少 replay_id，请确认后端契约');
  const same=fallback?.id === id || fallback?.id === '' ? fallback : undefined;
  const modelId=typeof response?.target_model === 'string' ? response.target_model : typeof response?.model_id === 'string' ? response.model_id : same?.modelId;
  const sourceModelId=typeof response?.source_model === 'string' ? response.source_model : same?.sourceModelId ?? modelId;
  const start=timestamp(response?.start_time) ?? same?.source.start;
  const end=timestamp(response?.end_time) ?? same?.source.end;
  if (!modelId || start === undefined || end === undefined || end <= start) throw new Error('任务响应缺少有效模型或历史区间');
  let labels=object(object(response?.target)?.metrics_labels);
  // 兼容旧 Benchmark 将逻辑别名直接作为 model_name 的响应；显式部署标签仍优先。
  if (labels?.model_name === modelId && metricsMap[modelId]) labels={...labels,model_name:metricsMap[modelId]};
  const metricsName=typeof labels?.model_name === 'string' ? labels.model_name : metricsMap[modelId] || same?.metricsName || modelId;
  const base: Replay={...same,id,modelId,sourceModelId,modelName:same?.modelName || metricsName,metricsName,source:{start,end},status:same?.status ?? 'queued'};
  return applyReplayResponse({...response,target:{metrics_labels:labels},status:response?.status ?? 'queued'},base);
}

/** 100% 表示处理结束的比例，任务是否成功仍由 status 决定。 */
export function replayPercent(replay: Pick<Replay, 'requestCount' | 'completedCount'>): number | undefined {
  if (replay.requestCount === undefined || replay.requestCount <= 0 || replay.completedCount === undefined) return undefined;
  return Math.min(100, Math.max(0, replay.completedCount / replay.requestCount * 100));
}
