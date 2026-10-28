import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clock, dateTime, toInput, fromInput, fullDateTime } from '../src/time';
import { chartTime } from '../src/chartTime';

test('Shanghai display and input round-trip do not depend on host time zone', () => {
  const utc = Date.parse('2026-10-10T00:00:00Z') / 1000;
  assert.equal(clock(utc), '08:00:00');
  assert.equal(dateTime(utc), '10/10 08:00');
  assert.equal(fullDateTime(utc), '2026/10/10 08:00:00');
  assert.equal(toInput(utc), '2026-10-10T08:00:00');
  assert.equal(fromInput('2026-10-10T08:00:00'), utc);
  assert.equal(fromInput('2026-10-10T08:00'), utc);
  assert(Number.isNaN(fromInput('')));
});
test('cross-day axis dates use Shanghai date boundaries', () => {
  const utc = Date.parse('2026-10-10T18:00:00Z') / 1000;
  const axis = chartTime({ start:utc, end:utc+86400 });
  assert.equal(axis.format(utc * 1000), '10/11\n02:00');
});
