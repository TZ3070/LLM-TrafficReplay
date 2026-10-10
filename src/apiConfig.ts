/**
 * 构建时的后端契约配置。这里只配置同源路径与模型标签，不保存服务地址或密钥。
 * BACKEND_URL 由 Vite 读取；VITE_ 配置在 App 中读取并传给数据入口。
 */
export interface ApiConfig {
  prometheusPrefix: string;
  modelInfoPath: string;
  modelMetricsMap: Record<string, string>;
}
export const DEFAULT_API_CONFIG: ApiConfig = {
  // 与已确认的真实后端路由一致；部署使用其他前缀时可通过环境变量覆盖。
  prometheusPrefix: '/api/prometheus',
  modelInfoPath: '/api/litellm/model/info',
  modelMetricsMap: {}
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
  return {
    prometheusPrefix: apiPath(env.VITE_PROMETHEUS_API_PREFIX, DEFAULT_API_CONFIG.prometheusPrefix),
    modelInfoPath: apiPath(env.VITE_MODEL_INFO_PATH, DEFAULT_API_CONFIG.modelInfoPath),
    modelMetricsMap
  };
}
