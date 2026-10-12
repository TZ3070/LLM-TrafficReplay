/** 语言只控制界面文案；模型名、接口字段、查询条件和上海时间保持原有含义。 */
export type Language = 'zh' | 'en';
const LANGUAGE_KEY = 'trafficReplay.language';

const english: Record<string, string> = {
  'TrafficReplay / 大模型流量回放': 'TrafficReplay / LLM Traffic Replay',
  '演示数据': 'Demo data',
  '后端模式': 'Backend mode',
  '连接设置': 'Connection settings',
  '回放历史请求，观察模型负载与排队变化，验证优化效果。': 'Replay historical requests to compare model load and queue behavior after optimization.',
  '每 30s 更新': 'Updates every 30s',
  '刷新指标': 'Refresh metrics',
  '查询设置': 'Query settings',
  '查询模型': 'Model',
  '刷新模型列表': 'Refresh model list',
  '加载中…': 'Loading…',
  '刷新列表': 'Refresh list',
  '等待模型配置': 'Waiting for models',
  '历史查询范围': 'History range',
  '最近 15 分钟': 'Last 15 minutes',
  '最近 30 分钟': 'Last 30 minutes',
  '最近 1 小时': 'Last 1 hour',
  '最近 6 小时': 'Last 6 hours',
  '最近 12 小时': 'Last 12 hours',
  '最近 24 小时': 'Last 24 hours',
  '最近 7 天': 'Last 7 days',
  '截止时间': 'End time',
  '现在': 'Now',
  '历史窗口已固定': 'History window pinned',
  '约 60 个采样点 · {step}s 步长': '~60 samples · {step}s step',
  '数据源': 'Data source',
  '演示': 'Demo',
  '后端': 'Backend',
  '关闭错误': 'Dismiss error',
  '流量实验': 'Traffic experiment',
  '历史流量 → 当前模型部署': 'Historical traffic → Current deployment',
  '历史流量': 'Historical traffic',
  '已固定': 'Pinned',
  '历史查询': 'History',
  '尚未选择模型': 'No model selected',
  '正在处理': 'Running',
  '等待处理': 'Waiting',
  '请求数 / requests': 'Request count',
  '横向拖动选择区间': 'Drag to select a time range',
  '此时间范围暂无指标数据': 'No metrics for this time range',
  '回放时间区间': 'Replay time range',
  '清除选区': 'Clear selection',
  '开始时间': 'Start time',
  '结束时间': 'End time',
  '已选择 {minutes} 分 {seconds} 秒': 'Selected {minutes}m {seconds}s',
  '请选择窗口内有效的开始与结束时间': 'Select valid start and end times within the history window',
  '在折线图中拖动，或输入时间': 'Drag on the chart or enter times',
  '时间范围包含起点，不包含终点': 'Includes start, excludes end',
  '回放进行中': 'Replay in progress',
  '确认回放': 'Confirm replay',
  '回放观测': 'Replay observation',
  '等待回放': 'Awaiting replay',
  '等待创建回放任务': 'No replay task yet',
  '{time} 开始': 'Started {time}',
  '回放开始后自动获取模型曲线': 'Model curves appear once replay starts',
  '相对时间': 'Relative time',
  '（{unit}）': ' ({unit})',
  '矩形选择': 'Rectangle selection',
  '圈选': 'Polygon selection',
  '横向选择': 'Horizontal selection',
  '纵向选择': 'Vertical selection',
  '保持选择': 'Keep selection',
  '清除选择': 'Clear selection',
  '秒': 'seconds',
  '分:秒': 'mm:ss',
  '时:分:秒': 'hh:mm:ss',
  '回放 + {elapsed}（{unit}）': 'Replay + {elapsed} ({unit})',
  '等待实际打流开始时间': 'Waiting for the actual replay start time',
  '历史区间': 'Source range',
  '已完成 / 总请求': 'Completed / Total',
  '回放规则': 'Replay policy',
  '同模型 · 原速': 'Same model · Original pace',
  '模拟回放，45 秒演示完成；曲线不代表真实优化效果。': 'Simulated replay completes in 45s. Curves do not represent measured improvements.',
  '实例指标可能包含其他流量；回放尾部指标受采集和缓存延迟影响。': 'Instance metrics may include other traffic. Scrape and cache delays affect the replay tail.',
  '让历史流量，再跑一次': 'Give historical traffic another run',
  '在左侧选定时间区间并确认回放。': 'Select a time range on the left and confirm replay.',
  '该模型的新处理与等待曲线将在这里展示。': 'The model’s new running and waiting curves will appear here.',
  '选择区间': 'Select range',
  '观察效果': 'Observe results',
  '切换查询模型不会改变已创建的回放任务': 'Changing the query model keeps the current replay task',
  '延迟数据': 'Latency metrics',
  '即时查询 · 回溯 {window}': 'Instant query · Lookback {window}',
  '{model} · 延迟回溯 {window} · 即时查询': '{model} · Lookback {window} · Instant query',
  '首 TOKEN 延迟': 'Time to first token',
  '端到端延迟': 'End-to-end latency',
  'Token 间延迟': 'Inter-token latency',
  '每输出 Token 延迟': 'Time per output token',
  '请求排队时间': 'Request queue time',
  '查询失败 · 查看详情': 'Query failed · View details',
  '查询中…': 'Querying…',
  '暂无样本 · 检查指标名与模型标签': 'No samples · Check metrics and model labels',
  '错误详情': 'Error details',
  '演示模式 · 所有曲线与任务均为模拟数据': 'Demo mode · All curves and tasks use simulated data',
  '后端模式 · Prometheus 原样数据解析': 'Backend mode · Raw Prometheus data',
  '指标更新于 {time}': 'Metrics updated at {time}',
  '等待指标查询': 'Waiting for metrics',
  '时间：': 'Time zone: ',
  '关闭': 'Close',
  '确认回放历史流量': 'Confirm historical traffic replay',
  '将所选时间段的请求按原始节奏发送给该模型当前部署。': 'Send requests from the selected period to this model’s current deployment at their original pace.',
  '模型': 'Model',
  '模式': 'Mode',
  '模拟演示，不发送真实流量': 'Simulation — no real traffic is sent',
  '后端回放，发送真实历史请求': 'Backend replay — sends real historical requests',
  '取消': 'Cancel',
  '开始回放': 'Start replay',
  '后端连接设置': 'Backend connection settings',
  '模型列表直接读取 Prometheus 的 vLLM 模型标签。在 .env.local 中配置 BACKEND_URL 和接口路径，修改后重新运行 npm run dev。': 'Models come from vLLM labels in Prometheus. Configure BACKEND_URL and API paths in .env.local, then restart with npm run dev.',
  '认证头': 'Authentication header',
  '认证值': 'Authentication value',
  '凭据仅保存在页面内存中，不写入本地存储。Prometheus 查询不携带认证。': 'Credentials are kept in page memory only. Prometheus queries do not include authentication.',
  '模型来源：Prometheus / vLLM': 'Model source: Prometheus / vLLM',
  '回放 model_id = {model}': 'Replay model_id = {model}',
  '应用设置': 'Apply settings',
  '等待开始': 'Queued',
  '准备请求': 'Preparing',
  '回放中': 'Running',
  '等待处理完成': 'Draining',
  '已完成': 'Completed',
  '失败': 'Failed',
  '已取消': 'Cancelled',
  '正在处理与等待处理请求曲线，可通过下方时间输入精确设置回放区间': 'Running and waiting request curves. Use the time inputs below to set the replay range precisely.',
  'Prometheus 未返回 vLLM 模型，请检查采集目标和 vllm:num_requests_running 的 model_name 标签': 'Prometheus returned no vLLM models. Check scrape targets and the model_name label on vllm:num_requests_running.',
  '未知回放状态': 'Unknown replay status',
  '创建回放响应缺少 replay_id，请确认后端契约': 'Replay creation response is missing replay_id. Check the backend contract.'
};

export function translate(language: Language, text: string, values: Record<string, string | number> = {}): string {
  const template = language === 'en' ? english[text] ?? text : text;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

// 数据层/后端错误保留原文存储，显示时翻译已知前端消息；不改写模型名或未知上游详情。
const errorTranslations: Record<string, string> = {
  '模型加载失败：': 'Model loading failed: ',
  '任务状态查询失败：': 'Task status query failed: ',
  '创建回放失败：': 'Replay creation failed: ',
  'Prometheus 查询失败': 'Prometheus query failed',
  'Prometheus 响应类型不匹配': 'Unexpected Prometheus response type',
  '查询返回重复分组，请在 PromQL 中聚合 engine 分片': 'Duplicate groups returned. Aggregate engine shards in PromQL.',
  '卡片查询应在 PromQL 中聚合为单个结果': 'Aggregate the card query to a single result in PromQL.',
  '延迟响应包含其他模型，请检查 PromQL 模型筛选': 'Latency response includes other models. Check the PromQL model filter.',
  '非法指标标签': 'Invalid metric label',
  'rate 回溯范围必须是正数秒': 'The rate lookback must be positive seconds.',
  '请求限流，正在等待 60 秒后恢复': 'Rate limited. Waiting 60 seconds before retrying.',
  '后端返回非 JSON 响应，请检查代理配置': 'The backend returned a non-JSON response. Check the proxy configuration.',
  '未知回放状态': english['未知回放状态'],
  '创建回放响应缺少 replay_id，请确认后端契约': english['创建回放响应缺少 replay_id，请确认后端契约'],
  'Prometheus 未返回 vLLM 模型，请检查采集目标和 vllm:num_requests_running 的 model_name 标签': english['Prometheus 未返回 vLLM 模型，请检查采集目标和 vllm:num_requests_running 的 model_name 标签']
};

export function localizeMessage(language: Language, message: string): string {
  if (language === 'zh') return message;
  let result = message
    .replace(/指标模型 (.+?) 对应多个回放别名，请配置唯一对应关系/g, 'Metric model $1 maps to multiple replay aliases. Configure a unique mapping.')
    .replace(/指标缺少 (\w+) 标签/g, 'Metric is missing the $1 label');
  for (const [source, target] of Object.entries(errorTranslations)) result = result.split(source).join(target);
  return result;
}

export function readLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh'; }
  catch { return 'zh'; }
}

export function rememberLanguage(language: Language): void {
  try { localStorage.setItem(LANGUAGE_KEY, language); }
  catch { /* 无法访问存储时，当前页面仍可正常切换语言。 */ }
}
