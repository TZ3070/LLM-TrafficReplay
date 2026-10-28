// All HTTP responses are mocked; this check never sends real replay traffic.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.CHECK_BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHECK_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let releaseTTFT;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], queries = [];
    page.on('pageerror', error => errors.push(error.message));
    const now = Math.floor(Date.now() / 1000);
    await page.clock.install({ time: new Date(now * 1000) });
    let task = { replay_id: 'trend-task', model_id: 'model-a', source_model: 'model-a', target_model: 'model-a', status: 'preparing', speed: 1, revision: 1, start_time: now - 1200, end_time: now - 600, target: { metrics_labels: { model_name: 'model-v2', deployment: 'trend-deploy' } } };
    let failTTFT = false, emptyTTFT = false, holdTTFT = false, heldTTFT = false, releasedTTFT = false, failDeployment = false, missingMiddle = false;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      let body, status = 200;
      assert.equal(request.method(), 'GET', 'observation and recovery must never create or control replay traffic');
      if (url.pathname.startsWith('/api/prometheus/')) {
        assert(!request.headers().authorization, 'metric queries must not carry replay credentials');
        const query = url.searchParams.get('query'), range = url.pathname.endsWith('/query_range');
        const ttft = range && query.includes('time_to_first_token');
        assert(!(range && query.includes('request_generation_tokens_sum') && query.startsWith('sum(rate(')), 'throughput must not be queried');
        if (ttft) {
          const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end')), step = Number(url.searchParams.get('step'));
          const deployment = query.match(/deployment="([^"]+)"/)[1];
          queries.push({ query, start, end, step, deployment });
          assert(query.includes('model_name="model-v2"'));
          assert(['trend-deploy', 'trend-deploy-b'].includes(deployment));
          assert(!query.includes(' @ '));
          assert(start - 60 >= task.started_at, 'full rate window must not reach before actual replay start');
          assert(step >= 15);
          assert(query.startsWith('1000 * ('), 'TTFT history is displayed in milliseconds');
          if (holdTTFT && deployment === 'trend-deploy') {
            heldTTFT = true; await new Promise(resolve => releaseTTFT = resolve); releasedTTFT = true;
          }
          if (failTTFT || deployment === 'trend-deploy-b' && failDeployment) { status = 503; body = { error: 'temporary TTFT failure' }; }
          else {
            const values = [];
            for (let timestamp = start; timestamp <= end; timestamp += step) {
              if (missingMiddle && timestamp === start + 2 * step) continue;
              values.push([timestamp, String((deployment === 'trend-deploy-b' ? 300 : 180) + (timestamp - start) % 80)]);
            }
            const metric = { model_name: 'model-v2', role: 'prefill', engine: '0' };
            body = { status: 'success', data: { resultType: 'matrix', result: emptyTTFT ? [] : [{ metric, values }] } };
          }
        } else if (query.startsWith('count by')) body = { status: 'success', data: { resultType: 'vector', result: ['model-a', 'model-b'].map(model_name => ({ metric: { model_name }, value: [now, '0'] })) } };
        else body = { status: 'success', data: { resultType: range ? 'matrix' : 'vector', result: [] } };
      } else {
        assert.equal(request.headers().authorization, 'Bearer trend-test');
        body = url.pathname.endsWith('/active') ? { active: true, task } : task;
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    });
    const authenticate = async () => {
      await page.getByRole('button', { name: '连接设置', exact: true }).click();
      await page.locator('.settings-field input').fill('Bearer trend-test');
      await page.getByRole('button', { name: '应用设置', exact: true }).click();
    };
    const section = page.locator('.replay-trend-section');
    const ttft = section.locator('[data-replay-trend="ttft"]');
    const ttftQueries = () => queries;
    await page.goto(base);
    await expect(section.locator('[data-replay-trend]')).toHaveCount(1);
    await expect(section).toContainText('等待创建回放任务');
    await page.getByRole('button', { name: '后端', exact: true }).click();
    await authenticate();
    await expect(section).toContainText('等待实际打流开始时间');
    assert.equal(queries.length, 0);
    task = { ...task, status: 'running', started_at: now + .25, revision: 2 };
    await page.clock.runFor(2500);
    await expect(ttft).toContainText('等待完整统计窗口');
    assert.equal(queries.length, 0);
    fs.mkdirSync('test-results', { recursive: true });
    await ttft.screenshot({ path: 'test-results/replay-ttft-warmup.png' });
    await page.clock.runFor(95000);
    await expect(ttft.locator('.cache-legend')).toContainText('model-v2 · prefill');
    await expect(section.locator('.replay-trend-context [role="status"]')).toHaveText('持续观测中');
    await expect(ttft).toContainText('观测于');
    await ttft.locator('.cache-trend').scrollIntoViewIfNeeded();
    const bounds = await ttft.locator('.cache-trend').boundingBox();
    await ttft.locator('.cache-trend').hover({ position: { x: bounds.width * .8, y: 100 } });
    await expect(ttft.locator('.cache-trend')).toContainText('ms');
    await section.screenshot({ path: 'test-results/replay-ttft-desktop.png' });
    const oldObserved = await ttft.locator('.replay-trend-note').innerText();
    failTTFT = true;
    await page.clock.runFor(31000);
    await expect(ttft.locator('.chart-error')).toContainText('503');
    await expect(ttft.locator('.cache-legend')).toContainText('model-v2');
    assert.equal(await ttft.locator('.replay-trend-note').innerText(), oldObserved);
    failTTFT = false; emptyTTFT = true;
    await page.clock.runFor(31000);
    await expect(ttft.locator('.cache-legend')).toHaveCount(0);
    await expect(ttft).toContainText('暂无样本');
    emptyTTFT = false;
    await page.clock.runFor(31000);
    await expect(ttft.locator('.cache-legend')).toContainText('model-v2');
    await section.getByRole('checkbox', { name: '相对时间', exact: true }).uncheck();
    await expect(section.getByRole('checkbox')).not.toBeChecked();
    await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
    await expect(ttft.locator('h3')).toHaveText('Time to first token');
    await expect(ttft.locator('.replay-trend-panel-header')).toContainText('Lookback 1m');
    await page.setViewportSize({ width: 320, height: 900 });
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), '320px page must not overflow');
    await section.screenshot({ path: 'test-results/replay-ttft-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: '切换到中文', exact: true }).click();
    task = { ...task, status: 'succeeded', finished_at: Math.floor(await page.evaluate(() => Date.now() / 1000)), revision: 3 };
    await page.clock.runFor(95000);
    await expect(section).toContainText('最终观测已固定');
    const fixedEnd = task.finished_at + 30;
    assert.equal(ttftQueries().at(-1).end, fixedEnd);
    const settledCount = ttftQueries().length;
    await page.clock.runFor(65000);
    assert.equal(ttftQueries().length, settledCount, 'settled trends stop polling');
    await page.getByRole('button', { name: '刷新指标', exact: true }).click();
    await expect.poll(() => ttftQueries().length).toBeGreaterThan(settledCount);
    assert.equal(ttftQueries().at(-1).end, fixedEnd);
    await page.reload(); await authenticate();
    await expect(section).toContainText('最终观测已固定');
    assert.equal(ttftQueries().at(-1).end, fixedEnd, 'reload must retain the original observation interval');
    // A slower query from the previous deployment must never overwrite the new target.
    holdTTFT = true;
    await page.clock.runFor(31000);
    await page.getByRole('button', { name: '刷新指标', exact: true }).click();
    await expect.poll(() => heldTTFT).toBe(true);
    failDeployment = true;
    task = { ...task, target: { metrics_labels: { model_name: 'model-v2', deployment: 'trend-deploy-b' } }, revision: 4 };
    await authenticate();
    await expect(section).toContainText('deployment=trend-deploy-b');
    await expect(ttft.locator('.chart-error')).toContainText('查询失败 · 查看详情');
    await expect(ttft.locator('.cache-legend')).toHaveCount(0);
    await expect(ttft.locator('.replay-trend-note')).not.toContainText('观测于');
    releaseTTFT(); holdTTFT = false;
    await expect.poll(() => releasedTTFT).toBe(true);
    await expect(ttft.locator('.cache-legend')).toHaveCount(0);
    failDeployment = false; missingMiddle = true;
    await page.clock.runFor(31000);
    await expect(section).toContainText('最终观测已固定');
    await expect(ttft.locator('.chart-error')).toHaveCount(0);
    await expect(ttft.locator('.cache-legend')).toContainText('model-v2');
    await section.screenshot({ path: 'test-results/replay-ttft-gaps.png' });
    missingMiddle = false;
    const shortStart = Math.floor(await page.evaluate(() => Date.now() / 1000));
    task = { ...task, replay_id: 'short-trend-task', status: 'running', started_at: shortStart, finished_at: undefined, revision: 1 };
    await authenticate();
    await expect(section).toContainText('short-trend-task');
    await expect(ttft.locator('.cache-legend')).toHaveCount(0);
    const beforeShort = ttftQueries().length;
    task = { ...task, status: 'succeeded', finished_at: shortStart + 1, revision: 2 };
    await page.clock.runFor(2500);
    await expect(section).toContainText('任务观测时段不足完整统计窗口');
    await page.clock.runFor(65000);
    assert.equal(ttftQueries().length, beforeShort, 'short ended tasks must not poll an impossible full window');
    await expect(section).not.toContainText('正在补采');
    assert.deepEqual(errors, []);
    console.log('PASS: TTFT only, warm-up, target labels, ms tooltip, failure retention, empty results, relative time, terminal freeze, refresh/reload, late deployment responses, first failure, gaps, short tasks, English and 320px layout.');
  } finally { if (releaseTTFT) releaseTTFT(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
