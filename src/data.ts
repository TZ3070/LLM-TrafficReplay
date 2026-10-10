import type { LatencyMetricKey, LoadData, Metric, MetricKey, Metrics, Model, Point, Series, TimeRange } from './types';
import { DEFAULT_API_CONFIG, type ApiConfig, type MetricNameConfig } from './apiConfig';

/**
 * 数据入口与适配层。
 * 真实指标：vLLM /metrics → Prometheus → 看板后端 /api/prometheus/*
 *          → 本文件解析 vector/matrix → App 状态 → 指标卡 / LoadChart。
 * 模型列表：vLLM /metrics → Prometheus model_name 标签 → fetchModels → 模型下拉框。
 * 演示数据：demoModels / demoLoad 在浏览器生成，不读取后端或发送推理请求。
 * 后端返回原样 Prometheus JSON；历史 gauge 在 PromQL 聚合，延迟的 engine 均值在解析时合并。
 */
type Labels = Record<string, string>;
// Prometheus 的数值字段是字符串；时间戳为 Unix 秒，不是 JavaScript 毫秒。
interface PromSeries { metric: Labels; value?: [number, string]; values?: [number, string][] }
interface PromResponse { status: string; data?: { resultType: string; result: PromSeries[] }; error?: string }

/** 缺失值与真实 NaN/Inf 分开保存，避免无流量的 0/0 被误显示为 0。 */
export function parsePromValue(raw: string): number | undefined {
  if (raw === 'NaN') return NaN;
  if (raw === '+Inf' || raw === 'Inf') return Infinity;
  if (raw === '-Inf') return -Infinity;
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
// 仅用于展示，不改写解析后的原始值；NaN 的红色样式由组件负责。
export function formatValue(value?: number, decimals = 2): string {
  if (value === undefined) return '—';
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: decimals });
}
/**
 * 区间秒数 → 约 60 个点的查询步长，最小 5s；即时卡片的 rate 窗口单独按用户选择的历史范围生成。
 */
export function queryTiming(seconds: number, now = Math.floor(Date.now() / 1000)) {
  const step = Math.max(5, Math.ceil(seconds / 60));
  return { start: now - seconds, end: now, step, window: `${Math.max(30, step)}s` };
}
// 图表拖拽产生的两个时间边界排序并裁剪到查询窗口，支持向左拖动。
export function normalizeRange(a: number, b: number, bounds: TimeRange): TimeRange {
  const first = Math.round(Math.max(bounds.start, Math.min(bounds.end, a)));
  const second = Math.round(Math.max(bounds.start, Math.min(bounds.end, b)));
  return { start: Math.min(first, second), end: Math.max(first, second) };
}
function promResult(raw: unknown, type: string): PromSeries[] {
  const data = raw as PromResponse;
  if (data?.status !== 'success') throw new Error(data?.error || 'Prometheus 查询失败');
  if (data.data?.resultType !== type || !Array.isArray(data.data.result)) throw new Error('Prometheus 响应类型不匹配');
  return data.data.result;
}
/**
 * query_range 的 matrix → Series[]，传给处理/等待折线。
 * vLLM 按 model_name 分组；接入 LiteLLM 指标时可传 requested_model。
 * role 保留为独立曲线；同组 engine 应已在 PromQL 中聚合，不在此二次聚合。
 */
export function parseMatrix(raw: unknown, label = 'model_name'): Series[] {
  const groups = new Set<string>();
  return promResult(raw, 'matrix').map(s => {
    const name = s.metric[label];
    if (!name) throw new Error(`指标缺少 ${label} 标签`);
    const role = s.metric.role;
    const id = JSON.stringify([name, role ?? '']);
    if (groups.has(id)) throw new Error('查询返回重复分组，请在 PromQL 中聚合 engine 分片');
    groups.add(id);
    return { id, name: name + (role ? ` · ${role}` : ''), points: (s.values ?? []).map(([timestamp, value]) => ({ timestamp, value: parsePromValue(value) })).sort((a,b)=>a.timestamp-b.timestamp) };
  });
}
// query 的 vector → 单个卡片数值。空结果为 undefined，多条结果说明聚合口径不匹配。
export function parseVector(raw: unknown): number | undefined {
  const result = promResult(raw, 'vector');
  if (result.length > 1) throw new Error('卡片查询应在 PromQL 中聚合为单个结果');
  return result[0]?.value ? parsePromValue(result[0].value[1]) : undefined;
}
/**
 * 未聚合的延迟比值（包括 TPOT 的特殊分母）返回各 engine 的延迟均值。
 * 同模型、同 role 的 engine 求算术平均（不是按请求数加权）；PD 角色保留为独立行。
 * 已由 PromQL 聚合的单条结果直接取值。NaN/Inf 参与运算，不能丢掉或替换成 0。
 */
export function parseLatencyVector(raw: unknown, modelName: string): Metric {
  const groups = new Map<string, (number | undefined)[]>();
  for (const series of promResult(raw, 'vector')) {
    if (series.metric.model_name && series.metric.model_name !== modelName) {
      throw new Error('延迟响应包含其他模型，请检查 PromQL 模型筛选');
    }
    const role = series.metric.role || '';
    const values = groups.get(role) ?? [];
    values.push(series.value ? parsePromValue(series.value[1]) : undefined);
    groups.set(role, values);
  }
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([role, values]) => {
    const present = values.filter((value): value is number => value !== undefined);
    const value = present.length ? present.reduce((total, next) => total + next, 0) / present.length : undefined;
    return { name: modelName + (role ? ` · ${role}` : ''), role: role || undefined, value };
  });
  if (rows.some(row => row.role)) return { rows };
  return { value: rows[0]?.value };
}
// 单引号和尖括号转义；PromQL 标签匹配所需的双引号保留。
export function promString(value: string): string {
  return JSON.stringify(value).replace(/'/g, '\\x27').replace(/</g, '\\x3c').replace(/>/g, '\\x3e');
}
export function selector(modelName: string, labels: Labels = {}): string {
  // 回放响应可提供部署标签和实际 model_name；优先使用后端映射的标签定位目标实例。
  const merged = { ...labels, model_name: labels.model_name || modelName };
  return '{' + Object.entries(merged).map(([key, value]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) throw new Error('非法指标标签');
    return `${key}=${promString(value)}`;
  }).join(',') + '}';
}
// running/waiting 是瞬时 gauge。跨 engine 求和，保留 PD 的 prefill/decode 角色。
export function loadQueries(modelName: string, labels?: Labels) {
  const filter = selector(modelName, labels);
  return {
    running: `sum by (model_name, role) (vllm:num_requests_running${filter})`,
    waiting: `sum by (model_name, role) (vllm:num_requests_waiting${filter})`
  };
}
/** PromQL duration：避免 0h0m 这类 Prometheus 不接受的写法。 */
export function promDuration(seconds: number): string {
  if(!Number.isFinite(seconds)||seconds<=0)throw new Error('rate 回溯范围必须是正数秒');
  const value = Math.max(1, Math.round(seconds));
  if (value % 86400 === 0) return `${value / 86400}d`;
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

const defaultMetricNames: Record<LatencyMetricKey, MetricNameConfig> = {
  ttft: { sum: 'vllm:time_to_first_token_seconds_sum', count: 'vllm:time_to_first_token_seconds_count' },
  e2e: { sum: 'vllm:e2e_request_latency_seconds_sum', count: 'vllm:e2e_request_latency_seconds_count' },
  itl: { sum: 'vllm:inter_token_latency_seconds_sum', count: 'vllm:inter_token_latency_seconds_count' },
  // 用户确认的 TPOT：解码总耗时 ÷（生成 token 总数 - 请求数），扣除每个请求的首 token。
  tpot: { decodeSum: 'vllm:request_decode_time_seconds_sum', generationTokensSum: 'vllm:request_generation_tokens_sum', generationTokensCount: 'vllm:request_generation_tokens_count' },
  qt: { sum: 'vllm:request_queue_time_seconds_sum', count: 'vllm:request_queue_time_seconds_count' }
};

/**
 * 五张首页卡片各发一条即时 query。后端按 TTL 缓存后透传 Prometheus 的原样响应。
 * rate 窗口就是历史查询范围（例如 30m、24h、7d），不是固定 1m。
 */
export function metricQueries(modelName: string, windowSeconds: number, config: ApiConfig = DEFAULT_API_CONFIG) {
  const f = selector(modelName);
  const window = promDuration(windowSeconds);
  return (Object.keys(defaultMetricNames) as LatencyMetricKey[]).reduce((queries, key) => {
    const metric = config.metricNames[key] || defaultMetricNames[key];
    // 保持旧看板的 ratio 表达式：分片与 role 标签留给 parseLatencyVector 解析。
    if ('decodeSum' in metric) {
      queries[key] = `rate(${metric.decodeSum}${f}[${window}]) / (rate(${metric.generationTokensSum}${f}[${window}]) - rate(${metric.generationTokensCount}${f}[${window}]))`;
    } else {
      queries[key] = `rate(${metric.sum}${f}[${window}]) / rate(${metric.count}${f}[${window}])`;
    }
    return queries;
  }, {} as Record<LatencyMetricKey, string>);
}
export const MODEL_DISCOVERY_QUERY = 'count by (model_name) (vllm:num_requests_running)';
/**
 * Prometheus 的 vLLM gauge 标签 → 当前已采集的模型列表。空闲模型也有值为 0 的 gauge。
 * 不从 LiteLLM 推断指标名。回放后端若使用逻辑别名，反向读取显式映射来确定 model_id。
 */
export function parseModelVector(raw: unknown, metricsMap: Record<string, string> = {}): Model[] {
  const names = [...new Set(promResult(raw, 'vector').map(series => series.metric.model_name).filter((name): name is string => typeof name === 'string' && !!name.trim()))].sort();
  return names.map(name => {
    const aliases = Object.entries(metricsMap).filter(([, metricsName]) => metricsName === name).map(([alias]) => alias);
    return { id: name, name, metricsName: name, provider: 'vLLM', replayModelId: aliases.length === 1 ? aliases[0] : undefined, replayError: aliases.length > 1 ? `指标模型 ${name} 对应多个回放别名，请配置唯一对应关系` : undefined };
  });
}
export async function fetchModels(config: ApiConfig = DEFAULT_API_CONFIG): Promise<Model[]> {
  return parseModelVector(await requestPrometheus(promPath(MODEL_DISCOVERY_QUERY, undefined, config)), config.modelMetricsMap);
}
/**
 * /api/litellm/model/info → 前端逻辑模型列表。
 * 同名 LiteLLM 实例合并为一个选项；id 提交回放，metricsName 用于 Prometheus 筛选。
 * 当前接受数组或 { data: [...] }；实际响应不同应在这里集中调整字段映射。
 * 不推断 litellm_params.model：其 provider 前缀/模型路径不一定等于 vLLM 标签。
 * 显式配置的映射优先于响应中的 metrics_model_name；不改变回放的逻辑模型 ID。
 */
export function adaptModels(raw: unknown, metricsMap: Record<string, string> = {}): Model[] {
  const response = raw as { data?: unknown };
  const rows = Array.isArray(raw) ? raw : response?.data;
  if (!Array.isArray(rows)) throw new Error('模型配置应为数组或 { data: [...] }，请按实际 JSON 调整 adaptModels');
  const grouped = new Map<string, Model>();
  for (const item of rows) {
    if (typeof item !== 'object' || !item) continue;
    const row = item as Record<string, any>;
    const name = row.model_name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const mapped = Object.hasOwn(metricsMap, name) ? metricsMap[name] : undefined;
    const declared = row.metrics_model_name || row.model_info?.metrics_model_name;
    const metricsName = mapped || (typeof declared === 'string' && declared.trim() ? declared : undefined);
    const provider = row.litellm_params?.custom_llm_provider;
    const previous = grouped.get(name);
    if (previous?.metricsName && metricsName && previous.metricsName !== metricsName) {
      throw new Error(`模型 ${name} 的实例具有不同指标名，请确认分组或配置 VITE_MODEL_METRICS_MAP`);
    }
    // 同名实例合并时保留已有元数据，避免最后一个实例的缺失字段覆盖正确映射。
    grouped.set(name, {
      id: name, name,
      provider: previous?.provider || (typeof provider === 'string' ? provider : undefined),
      metricsName: previous?.metricsName || metricsName
    });
  }
  return [...grouped.values()];
}
export interface ClientOptions { apiKey?: string; authHeader?: 'x-litellm-key' | 'x-api-key' | 'Authorization' }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
// 以完整 URL（包含 query/start/end/step）缓存 30s，也复用正在进行的同一请求。
// 只缓存无需认证的 Prometheus GET；回放 POST 和携带凭据的模型查询不进入此缓存。
const promCache = new Map<string, { promise: Promise<any>; expires: number }>();
// LiteLLM 与 Prometheus 共享后端限流；任一接口返回 429 后，本页 /api 请求共同退避。
let rateLimitUntil = 0;
export function request(path: string, options: RequestInit = {}, auth?: ClientOptions): Promise<any> {
  if(Date.now() < rateLimitUntil && path.startsWith('/api/')) return Promise.reject(new ApiError('请求限流，正在等待 60 秒后恢复', 429));
  return performRequest(path,options,auth);
}
// 由指标入口显式使用缓存，改路由前缀后仍保持 30s 去重，不依赖某一种拼写。
function requestPrometheus(path: string): Promise<any> {
  const existing=promCache.get(path);
  if(existing && existing.expires>Date.now())return existing.promise;
  for(const [key,value] of promCache)if(value.expires<=Date.now())promCache.delete(key);
  const promise=request(path);
  promCache.set(path,{promise,expires:Date.now()+30000});
  promise.catch(()=>{if(promCache.get(path)?.promise===promise)promCache.delete(path);});
  return promise;
}
async function performRequest(path: string, options: RequestInit = {}, auth?: ClientOptions): Promise<any> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    // 仅显式传入 auth 的调用附带认证头；Prometheus 的调用不传 auth。
    if (auth?.apiKey) headers.set(auth.authHeader ?? 'x-litellm-key', auth.apiKey);
    // 相对路径走同源服务：开发/预览由 Vite 代理，生产由静态服务的反向代理转发。
    const response = await fetch(path, { ...options, headers, signal: controller.signal });
    if(response.status===429)rateLimitUntil=Date.now()+60000;
    const raw = await response.text();
    let result;
    // 错误只展示路由，不输出查询串或认证头，便于定位后端不存在的接口。
    const route = path.split('?')[0];
    try { result = JSON.parse(raw); } catch { throw new ApiError(`HTTP ${response.status} · ${route} · 后端返回非 JSON 响应，请检查代理配置`, response.status); }
    if (!response.ok) throw new ApiError([`HTTP ${response.status}`, route, result?.error, result?.details].filter(Boolean).join(' · '), response.status);
    return result;
  } finally { clearTimeout(timeout); }
}
// 前缀来自环境配置；URLSearchParams 编码 PromQL，不改变其聚合语义。
export function promPath(query: string, range?: TimeRange, config = DEFAULT_API_CONFIG): string {
  const params = new URLSearchParams({ query });
  if (range) {
    params.set('start', String(range.start)); params.set('end', String(range.end));
    params.set('step', String(queryTiming(range.end - range.start).step));
  }
  return `${config.prometheusPrefix}/${range ? 'query_range' : 'query'}?${params}`;
}
/** 历史窗口与回放窗口共用此入口，只是模型标签和查询时间不同。 */
export async function fetchLoad(modelName: string, range: TimeRange, labels?: Labels, config: ApiConfig = DEFAULT_API_CONFIG): Promise<LoadData> {
  const queries = loadQueries(modelName, labels);
  const keys = ['running', 'waiting'] as const;
  // 单条曲线失败时保留另一条的成功结果，错误信息交给页面展示。
  const results = await Promise.allSettled(keys.map(async key => parseMatrix(await requestPrometheus(promPath(queries[key], range, config)))));
  const data: LoadData = { running: [], waiting: [], errors: [] };
  results.forEach((r, i) => { if (r.status === 'fulfilled') data[keys[i]] = r.value; else { data.errors.push(`${keys[i]}：${r.reason.message}`); console.warn(r.reason); } });
  return data;
}
/** 即时 query → 页面顶部卡片；这些值不是历史选区的汇总结果。 */
export async function fetchMetrics(modelName: string, windowSeconds: number, config: ApiConfig = DEFAULT_API_CONFIG): Promise<Metrics> {
  const queries = metricQueries(modelName, windowSeconds, config);
  const keys = Object.keys(queries) as MetricKey[];
  const results = await Promise.allSettled(keys.map(async key => parseLatencyVector(await requestPrometheus(promPath(queries[key], undefined, config)), modelName)));
  const data = {} as Metrics;
  results.forEach((r, i) => { data[keys[i]] = r.status === 'fulfilled' ? r.value : { error: r.reason.message }; if(r.status === 'rejected') console.warn(r.reason); });
  return data;
}
// 本地演示模型，与 /api/litellm/model/info 无关。
export const demoModels: Model[] = [
  { id: 'Qwen3-32B', name: 'Qwen3-32B', provider: 'vLLM' },
  { id: 'DeepSeek-R1-Distill-70B', name: 'DeepSeek-R1-Distill-70B', provider: 'vLLM' },
  { id: 'Llama-3.3-70B', name: 'Llama-3.3-70B', provider: 'vLLM' }
];
/**
 * 在整个传入窗口一次性生成 61 个模拟点，不是逐点到达的实时数据。
 * optimized 只应用预设缩放系数示意回放结果，不代表真实测得的优化收益。
 */
export function demoLoad(modelId: string, range: TimeRange, optimized = false): LoadData {
  const size = 61, factor = 0.85 + modelId.length % 5 / 10;
  const build = (waiting: boolean): Point[] => Array.from({ length: size }, (_, i) => {
    const t = i / (size - 1);
    const peak = Math.exp(-Math.pow((t - .45) / .15, 2));
    const second = Math.exp(-Math.pow((t - .79) / .065, 2));
    const wave = Math.sin(i * .8) * 2 + Math.cos(i * .36) * 3;
    const value = waiting ? (peak * 49 + second * 19 + wave) * (optimized ? .23 : 1) : (16 + peak * 40 + second * 26 + wave) * (optimized ? .75 : 1);
    return { timestamp: Math.round(range.start + t * (range.end - range.start)), value: Math.round(Math.max(0, value) * factor) };
  });
  return { running: [{ id: modelId, name: modelId, points: build(false) }], waiting: [{ id: modelId, name: modelId, points: build(true) }], errors: [] };
}
export const emptyMetrics: Metrics = { ttft: {}, e2e: {}, itl: {}, tpot: {}, qt: {} };
