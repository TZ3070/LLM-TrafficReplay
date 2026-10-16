import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { chartTime, formatRelativeTime } from './chartTime';
import { formatValue } from './data';
import { translate, type Language } from './i18n';
import { fullDateTime } from './time';
import type { Series, TimeRange } from './types';

const colors = ['#6d78ec', '#10a78e', '#ba72d6', '#c39732', '#477db7', '#d37888'];
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export default function CacheTrend({ series, range, relativeOrigin, percent, unit, decimals, language, label, emptyNote }: {
  series: Series[]; range: TimeRange; relativeOrigin?: number; percent: boolean; unit?: string; decimals?: number; language: Language; label: string; emptyNote: string;
}) {
  const ref = useRef<HTMLDivElement>(null), chart = useRef<echarts.ECharts>();
  useEffect(() => {
    const instance = echarts.init(ref.current!); chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(ref.current!);
    return () => { observer.disconnect(); instance.dispose(); chart.current = undefined; };
  }, []);
  useEffect(() => {
    const time = chartTime(range, relativeOrigin);
    const displayUnit = unit ?? (percent ? '%' : 'token/s');
    const displayDecimals = decimals ?? (percent ? 1 : 2);
    chart.current?.setOption({
      animation: false, grid: { left: 52, right: 22, top: 22, bottom: 46 },
      xAxis: { type: time.type, min: time.min, max: time.max, splitNumber: ref.current!.clientWidth < 500 ? 3 : 6,
        minInterval: time.relative ? 1 : undefined,
        axisLine: { lineStyle: { color: '#e5e9f0' } }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { fontSize: 10, color: '#8b95a7', formatter: time.format, hideOverlap: true, showMinLabel: time.relative ? true : undefined } },
      yAxis: { type: 'value', min: 0, max: percent ? 100 : undefined, splitNumber: 4,
        axisLabel: { color: '#8b95a7', fontSize: 10, formatter: (value: number) => `${formatValue(value, displayDecimals, language)}${displayUnit === '%' ? '%' : ''}` },
        splitLine: { lineStyle: { color: '#edf0f5', type: 'dashed' } } },
      tooltip: { trigger: 'axis', confine: true, borderColor: '#e5e9f0', textStyle: { fontSize: 11, color: '#243047' },
        formatter: (raw: any) => {
          const items = Array.isArray(raw) ? raw : [raw];
          if (!items.length) return '';
          const axis = Number(items[0].value[0]), stamp = time.fromAxis(axis);
          const elapsed = time.relative ? `${escape(translate(language, '相对时间'))} + ${formatRelativeTime(axis, range.end - range.start)}<br/>` : '';
          return `<div style="max-width:${Math.max(120, ref.current!.clientWidth - 45)}px;white-space:normal;overflow-wrap:anywhere">${elapsed}${fullDateTime(stamp)}${items.map((item: any) => `<div style="margin-top:6px">${escape(item.seriesName)} <b>${formatValue(item.value[1] === null ? undefined : item.value[1], displayDecimals, language)} ${escape(displayUnit)}</b></div>`).join('')}</div>`;
        } },
      // 孤立样本没有可见线段，包括被停采断点隔开的多个样本；此时显示采样点。
      series: series.map((s, i) => ({ id: s.id, name: s.name, type: 'line', showSymbol: s.points.some((p, index, points) => p.value !== undefined && Number.isFinite(p.value) && !Number.isFinite(points[index - 1]?.value) && !Number.isFinite(points[index + 1]?.value)), symbolSize: 6, connectNulls: false,
        lineStyle: { width: 2, color: colors[i % colors.length] }, itemStyle: { color: colors[i % colors.length] },
        areaStyle: series.length === 1 ? { opacity: .04 } : undefined,
        data: s.points.map(p => [time.toAxis(p.timestamp), p.value !== undefined && Number.isFinite(p.value) ? p.value : null]),
      })),
    }, true);
  }, [series, range, relativeOrigin, percent, unit, decimals, language]);
  const hasData = series.some(s => s.points.some(p => p.value !== undefined));
  return <>
    <div className="cache-chart-area"><div ref={ref} className="cache-trend" role="img" aria-label={label}/>{!hasData && <div className="cache-empty">{emptyNote}</div>}</div>
    {series.length > 0 && <div className="cache-legend">{series.map((s, i) => <span key={s.id} title={s.name}><i style={{ background: colors[i % colors.length] }}/>{s.name}</span>)}</div>}
  </>;
}
