/** 从 LiteLLM 模型配置适配而来，演示模式则来自 demoModels。 */
export interface Model {
  id: string; // 逻辑模型标识：下拉框选中值，也是 POST /api/replays 的 model_id。
  name: string; // 页面展示名；当前适配器使用 LiteLLM 的 model_name。
  provider?: string;
  metricsName?: string; // vLLM 指标的 model_name；未提供时回退 name。
}
// 状态和接口均使用 Unix 秒；作为回放请求时采用 [start, end)。
export interface TimeRange { start: number; end: number }
// undefined 表示无数据；NaN/±Infinity 保留 Prometheus 的真实信号。
export interface Point { timestamp: number; value: number | undefined }
// Prometheus matrix 的一个模型/角色分组，已由查询侧聚合 engine。
export interface Series { id: string; name: string; points: Point[] }
export interface LoadData {
  running: Series[];
  waiting: Series[];
  errors: string[];
}
/** 创建响应与状态接口映射到此类型；与当前下拉框状态独立。 */
export interface Replay {
  id: string; // 后端 replay_id，供 GET /api/replays/{id} 轮询。
  modelId: string; // 创建任务时固定的逻辑模型，不随用户切换下拉框变化。
  modelName: string;
  metricsName: string;
  source: TimeRange; // 创建任务时复制的历史选区，用于查询原始请求档案。
  status: 'queued' | 'preparing' | 'running' | 'draining' | 'succeeded' | 'failed' | 'cancelled';
  startedAt?: number; // 后端 started_at：实际开始打流的 Unix 秒，不是按钮点击时间。
  finishedAt?: number; // 后端 finished_at：全部请求处理完成时间，不仅是发送完毕。
  metricsLabels?: Record<string, string>; // target.metrics_labels：定位本次回放部署的指标。
  requestCount?: number;
  sentCount?: number;
  completedCount?: number;
  statusError?: string;
}
// 即时指标：查询失败时仅填 error，成功空结果时 value 为 undefined。
export interface Metric { value?: number; error?: string }
export type Metrics = Record<'ttft' | 'e2e' | 'throughput' | 'cache', Metric>;
