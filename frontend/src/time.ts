// 时区只决定界面显示/输入的解释方式；接口仍传不带时区歧义的 Unix 秒。
export const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

export function timeParts(timestamp: number): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(timestamp * 1000));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function clock(timestamp: number): string {
  const p = timeParts(timestamp);
  return `${p.hour}:${p.minute}:${p.second}`;
}

export function dateTime(timestamp: number): string {
  const p = timeParts(timestamp);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

export function fullDateTime(timestamp: number): string {
  const p = timeParts(timestamp);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// datetime-local 不携带时区，因此与 fromInput 配套使用，不能直接交给浏览器本地时区解析。
export function toInput(timestamp: number): string {
  const p = timeParts(timestamp);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

// 页面输入按上海时间（UTC+08:00）解释，不使用浏览器所在时区。
export function fromInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return NaN;
  return Math.floor(new Date(`${value}+08:00`).getTime() / 1000);
}
