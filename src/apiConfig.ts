import type { LatencyMetricKey } from './types';
export interface HistogramMetricNames { sum: string; count: string }
export interface TpotMetricNames { decodeSum: string; generationTokensSum: string; generationTokensCount: string }
export type MetricNameConfig = HistogramMetricNames | TpotMetricNames;
/**
 * 构建时的后端契约配置。这里只配置同源路径与模型标签，不保存服务地址或密钥。
 * BACKEND_URL 由 Vite 读取；VITE_ 配置在 App 中读取并传给数据入口。
 */
export interface ApiConfig {
  prometheusPrefix: string;
  modelInfoPath: string;
  modelMetricsMap: Record<string, string>;
  // 普通延迟覆盖 histogram 名称；TPOT 单独配置 decode_time 和 generation_tokens 名称。
  metricNames: Partial<Record<LatencyMetricKey, MetricNameConfig>>;
}
export const DEFAULT_API_CONFIG: ApiConfig = {
  // 与已确认的真实后端路由一致；部署使用其他前缀时可通过环境变量覆盖。
  prometheusPrefix: '/api/prometheus',
  modelInfoPath: '/api/litellm/model/info',
  modelMetricsMap: {},
  metricNames: {}
};

function apiPath(value: string | undefined, fallback: string): string {
  const path = value?.trim().replace(/\/+$/, '') || fallback;
  if (!path.startsWith('/api/') || /[?#\s\\]/.test(path)) {
    throw new Error('接口路径应以 /api/ 开头，不含域名、查询参数或空格');
  }
  return path;
}

export function createApiConfig(env: Record<string, string | undefined>): ApiConfig {
  let modelMetricsMap: Record<string, string> = {};
  if (env.VITE_MODEL_METRICS_MAP?.trim()) {
    let raw: unknown;
    try { raw = JSON.parse(env.VITE_MODEL_METRICS_MAP); }
    catch { throw new Error('VITE_MODEL_METRICS_MAP 必须是 JSON 对象'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.entries(raw).some(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim())) {
      throw new Error('VITE_MODEL_METRICS_MAP 应为 {"LiteLLM逻辑模型名":"vLLM指标model_name"}');
    }
    modelMetricsMap = raw as Record<string, string>;
  }
  const metricNames: ApiConfig['metricNames'] = {};
  if (env.VITE_PROMETHEUS_METRIC_NAMES?.trim()) {
    let raw: unknown;
    try { raw = JSON.parse(env.VITE_PROMETHEUS_METRIC_NAMES); }
    catch { throw new Error('VITE_PROMETHEUS_METRIC_NAMES 必须是 JSON 对象'); }
    const keys = ['ttft', 'e2e', 'itl', 'tpot', 'qt'] as const;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('VITE_PROMETHEUS_METRIC_NAMES 应为指标名对象');
    if (Object.keys(raw).some(key=>!keys.includes(key as LatencyMetricKey))) throw new Error('VITE_PROMETHEUS_METRIC_NAMES 仅支持 ttft/e2e/itl/tpot/qt');
    for (const key of keys) {
      const value = (raw as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`VITE_PROMETHEUS_METRIC_NAMES.${key} 应包含指标名字符串`);
      const pair=value as Record<string, unknown>;
      if (key === 'tpot') {
        const names = ['decodeSum', 'generationTokensSum', 'generationTokensCount'] as const;
        if (names.some(name => typeof pair[name] !== 'string' || !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test((pair[name] as string).trim()))) {
          throw new Error('VITE_PROMETHEUS_METRIC_NAMES.tpot 应包含 decodeSum、generationTokensSum 和 generationTokensCount 字符串');
        }
        metricNames[key] = { decodeSum: (pair.decodeSum as string).trim(), generationTokensSum: (pair.generationTokensSum as string).trim(), generationTokensCount: (pair.generationTokensCount as string).trim() };
      } else if (typeof pair.sum !== 'string' || typeof pair.count !== 'string' || !/^[a-zA-Z_:][a-zA-Z0-9_:]*_sum$/.test(pair.sum.trim()) || !/^[a-zA-Z_:][a-zA-Z0-9_:]*_count$/.test(pair.count.trim())) {
        throw new Error(`VITE_PROMETHEUS_METRIC_NAMES.${key} 应包含 sum 和 count 字符串`);
      } else {
        metricNames[key] = { sum: pair.sum.trim(), count: pair.count.trim() };
      }
    }
  }
  return {
    prometheusPrefix: apiPath(env.VITE_PROMETHEUS_API_PREFIX, DEFAULT_API_CONFIG.prometheusPrefix),
    modelInfoPath: apiPath(env.VITE_MODEL_INFO_PATH, DEFAULT_API_CONFIG.modelInfoPath),
    modelMetricsMap,
    metricNames
  };
}
