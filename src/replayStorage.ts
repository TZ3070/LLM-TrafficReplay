import type { Replay, ReplaySpeed, TimeRange } from './types';
import { replaySpeed, restoreReplay } from './replay';

export interface ReplayBody { model_id: string; start_time: number; end_time: number; speed: ReplaySpeed }
export interface PendingReplay { key: string; signature: string; body: ReplayBody; context: Replay }
export interface HistorySnapshot { modelId: string; seconds: number; range: TimeRange; selection?: TimeRange; historyEnd?: number; relative: boolean }
export interface ReplaySnapshot { replay?: Replay; history?: HistorySnapshot }
const key=(scope: string)=>`trafficReplay.v2.${scope}`;

function read(storage: Storage, name: string): any {
  try { return JSON.parse(storage.getItem(name) || 'null'); } catch { return undefined; }
}
function write(storage: Storage, name: string, value: unknown) {
  try { if(value === undefined) storage.removeItem(name); else storage.setItem(name,JSON.stringify(value)); } catch { /* 存储不可用仍可通过活动接口恢复。 */ }
}
function validReplay(value: any): value is Replay {
  try {
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.metricsName !== 'string') return false;
    if (value.speed !== undefined && replaySpeed(value.speed) === undefined) return false;
    restoreReplay({replay_id:value.id,status:value.status,model_id:value.modelId,start_time:value.source?.start,end_time:value.source?.end});
    return true;
  } catch { return false; }
}
export function readSnapshot(scope: string): ReplaySnapshot {
  try {
    const raw=read(localStorage,key(scope));
    const history=raw?.history;
    const validHistory=history && typeof history.modelId === 'string' && Number.isFinite(history.seconds) && history.seconds > 0 && Number.isFinite(history.range?.start) && Number.isFinite(history.range?.end) && history.range.end > history.range.start;
    return {replay:validReplay(raw?.replay)?raw.replay:undefined,history:validHistory?history:undefined};
  } catch { return {}; }
}
export function saveSnapshot(scope: string, value: ReplaySnapshot) {
  // 显式白名单：不保存凭据、完整请求、结果文本或临时网络错误。
  const r=value.replay;
  const replay=r && {id:r.id,modelId:r.modelId,sourceModelId:r.sourceModelId,modelName:r.modelName,metricsName:r.metricsName,source:r.source,status:r.status,speed:r.speed,cancellable:r.cancellable,pausable:r.pausable,resumable:r.resumable,pausedAt:r.pausedAt,pausedSeconds:r.pausedSeconds,cancelRequestedAt:r.cancelRequestedAt,revision:r.revision,startedAt:r.startedAt,finishedAt:r.finishedAt,metricsLabels:r.metricsLabels,requestCount:r.requestCount,sentCount:r.sentCount,completedCount:r.completedCount,failedCount:r.failedCount,skippedCount:r.skippedCount,statusUpdatedAt:r.statusUpdatedAt,taskError:r.taskError};
  try { write(localStorage,key(scope),{replay,history:value.history}); } catch { /* 无本地存储时使用后端恢复。 */ }
}
export function readPending(scope: string): PendingReplay | undefined {
  try {
    const raw=read(sessionStorage,key(scope)+'.pending');
    const b=raw?.body;
    if(typeof raw?.key !== 'string' || !raw.key || !b || typeof b.model_id !== 'string' || !b.model_id || !Number.isFinite(b.start_time) || !Number.isFinite(b.end_time) || b.end_time <= b.start_time || replaySpeed(b.speed) === undefined || JSON.stringify(b) !== raw.signature) return;
    restoreReplay({replay_id:'pending',status:'queued',...b},{},{...raw.context,id:'pending'});
    return raw;
  } catch { return; }
}
export function savePending(scope: string, value?: PendingReplay) {
  try { write(sessionStorage,key(scope)+'.pending',value); } catch { /* 当前页面仍复用内存中的幂等键。 */ }
}
export function readMode(): 'demo' | 'backend' {
  try { return localStorage.getItem('trafficReplay.mode') === 'backend' ? 'backend' : 'demo'; } catch { return 'demo'; }
}
export function rememberMode(mode: 'demo' | 'backend') {
  try { localStorage.setItem('trafficReplay.mode',mode); } catch { /* 仍可使用当前模式。 */ }
}
