import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chartTime, formatRelativeTime, relativeTimeUnit } from '../src/chartTime';

test('short replay axis starts at zero and preserves distinct second ticks', () => {
  const start = 1791601207;
  const axis = chartTime({ start, end: start + 30 }, start);
  assert.equal(axis.type, 'value');
  assert.equal(axis.min, 0);
  assert.equal(axis.max, 30);
  assert.deepEqual([0, 5, 10, 15, 20, 25, 30].map(axis.format), ['0 s', '5 s', '10 s', '15 s', '20 s', '25 s', '30 s']);
});
test('relative coordinates reconstruct original timestamps for tooltips', () => {
  const start = 1791601207;
  const axis = chartTime({ start, end: start + 120 }, start);
  assert.equal(axis.toAxis(start + 25), 25);
  assert.equal(axis.fromAxis(25), start + 25);
  assert.equal(axis.format(25), '00:25');
  assert.equal(axis.format(90), '01:30');
  assert.equal(relativeTimeUnit(120), '分:秒');
});
test('long replay formats elapsed hours without wrapping at 24 hours', () => {
  assert.equal(formatRelativeTime(3661, 7200), '1:01:01');
  assert.equal(formatRelativeTime(90000, 604800), '25:00:00');
  assert.equal(relativeTimeUnit(7200), '时:分:秒');
});
test('switching back to absolute time restores milliseconds and a time axis', () => {
  const start = 1791601207;
  const axis = chartTime({ start, end: start + 30 });
  assert.equal(axis.type, 'time');
  assert.equal(axis.min, start * 1000);
  assert.equal(axis.toAxis(start + 5), (start + 5) * 1000);
  assert.equal(axis.fromAxis((start + 5) * 1000), start + 5);
});
