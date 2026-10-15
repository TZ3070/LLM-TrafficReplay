import { Activity, Clock3, Database, Timer, Zap } from 'lucide-react';
import { formatValue } from './data';
import { localizeMessage, translate, type Language } from './i18n';
import { fullDateTime } from './time';
import type { LatencyMetricKey, Metric } from './types';

export const LATENCY_CARDS = [
  { key: 'ttft', label: '首 TOKEN 延迟', icon: Timer, note: 'TTFT · time to first token' },
  { key: 'e2e', label: '端到端延迟', icon: Clock3, note: 'E2E · end-to-end latency' },
  { key: 'itl', label: 'Token 间延迟', icon: Activity, note: 'ITL · inter-token latency' },
  { key: 'tpot', label: '每输出 Token 延迟', icon: Zap, note: 'TPOT · time per output token' },
  { key: 'qt', label: '请求排队时间', icon: Database, note: 'QT · queue time' },
] as const;

export default function LatencyCard({ metricKey, metric: m, loading, language, kind = 'query', emptyNote, observedAt }: {
  metricKey: LatencyMetricKey; metric: Metric; loading: boolean; language: Language;
  kind?: 'query' | 'replay'; emptyNote?: string; observedAt?: number;
}) {
  const t = (text: string) => translate(language, text);
  const { label, icon: Icon, note } = LATENCY_CARDS.find(card => card.key === metricKey)!;
  const hasSample = m.value !== undefined || m.rows?.some(row => row.value !== undefined);
  const hint = m.error ? t(kind === 'replay' && hasSample ? '查询失败 · 显示上次数据' : '查询失败 · 查看详情')
    : loading && !hasSample ? t('查询中…') : !hasSample ? emptyNote || t('暂无样本 · 检查指标名与模型标签') : note;
  return <section className="metric-card" data-metric={kind === 'query' ? metricKey : undefined} data-replay-metric={kind === 'replay' ? metricKey : undefined}>
    <div className="metric-label">{t(label)}<Icon size={16}/></div>
    {m.rows?.length ? <div className="metric-rows">{m.rows.map(row => <div className="metric-row" key={row.name}>
      <span title={row.name}>{row.name}</span><strong className={Number.isNaN(row.value) ? 'nan' : ''}>{formatValue(row.value, 3, language)} <small>s</small></strong>
    </div>)}</div> : <div className={`metric-value ${Number.isNaN(m.value) ? 'nan' : ''}`}>{formatValue(m.value, 3, language)}<span>s</span></div>}
    <div className="metric-sub" title={m.error ? localizeMessage(language, m.error) : hint}>{hint}</div>
    {observedAt !== undefined && <div className="metric-observed">{translate(language, '观测于 {time}', { time: fullDateTime(observedAt) })}</div>}
    {m.error && <details className="metric-error"><summary>{t('错误详情')}</summary><p>{localizeMessage(language, m.error)}</p></details>}
  </section>;
}
