// All APIs are mocked. Simulates sleep while a terminal TTFT query is in flight.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHECK_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let release;
  try {
    const page = await browser.newPage();
    const now = Math.floor(Date.now() / 1000), calls = [];
    await page.clock.install({ time: new Date(now * 1000) });
    await page.clock.pauseAt(new Date(now * 1000 + 100));
    const task = { replay_id: 'sleep-regression', model_id: 'review-model', source_model: 'review-model', target_model: 'review-model', status: 'succeeded', revision: 1, start_time: now - 1200, end_time: now - 600, started_at: now - 120, finished_at: now - 5, target: { metrics_labels: { model_name: 'review-model' } } };
    const gate = new Promise(resolve => release = resolve);
    await page.route('**/api/**', async route => {
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url()); let body;
      if (url.pathname.startsWith('/api/prometheus/')) {
        const query = url.searchParams.get('query'), range = url.pathname.endsWith('/query_range');
        if (range && query.includes('time_to_first_token')) {
          const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end'));
          calls.push({ start, end }); await gate;
          body = { status: 'success', data: { resultType: 'matrix', result: [{ metric: { model_name: 'review-model' }, values: [[start, '180']] }] } };
        } else body = { status: 'success', data: { resultType: range ? 'matrix' : 'vector', result: query.startsWith('count by') ? [{ metric: { model_name: 'review-model' }, value: [now, '0'] }] : [] } };
      } else body = url.pathname.endsWith('/active') ? { active: true, task } : task;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    });
    await page.goto(process.env.CHECK_BASE_URL || 'http://127.0.0.1:4173');
    await page.getByRole('button', { name: '后端', exact: true }).click();
    await page.getByRole('button', { name: '连接设置', exact: true }).click();
    await page.locator('.settings-field input').fill('Bearer review-test');
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    await page.clock.setSystemTime(new Date((now + 120) * 1000));
    release();
    const section = page.locator('.replay-trend-section');
    await expect(section.locator('.cache-legend')).toContainText('review-model');
    await expect(section).not.toContainText('最终观测已固定');
    await page.clock.runFor(31000);
    await expect(section).toContainText('最终观测已固定');
    assert.equal(calls.at(-1).end, task.finished_at + 30);
    const count = calls.length;
    await page.clock.runFor(65000); assert.equal(calls.length, count);
    console.log('PASS: TTFT sleep regression; final query covers the complete tail before polling stops.');
  } finally { release?.(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
