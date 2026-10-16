// Mock HTTP only. Build with targets.token-alias={requestedModel:'lite-target',labels:{job:'litellm'}}.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHECK_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let release;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const now = Math.floor(Date.now() / 1000), queries = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date(now * 1000) });
    let task = { replay_id: 'token-observation', model_id: 'token-alias', target_model: 'token-alias', source_model: 'token-alias', status: 'running', started_at: now - 120, revision: 1, start_time: now - 1200, end_time: now - 600, target: { metrics_labels: { model_name: 'vllm-only', deployment: 'never-copy-this' } } };
    let hold = true, fail = false, empty = false, inputValue = 10, metricsAuth = false, ttftCalls = 0, taskCalls = 0;
    let gate = new Promise(resolve => release = resolve);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.method(), 'GET', 'observation must never create traffic');
      let body, status = 200;
      if (url.pathname.startsWith('/api/prometheus/')) {
        assert.equal(request.headers()['x-api-key'], metricsAuth ? 'independent-metrics' : undefined);
        assert(!request.headers().authorization, 'Benchmark key must not enter metric queries');
        const query = url.searchParams.get('query'), range = url.pathname.endsWith('/query_range');
        if (query.includes('litellm_') && range) {
          assert(query.startsWith('sum by (requested_model) (rate('));
          assert(query.includes('requested_model="lite-target"')); assert(query.includes('job="litellm"'));
          assert(!query.includes('model_name') && !query.includes('never-copy-this'));
          const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end')), step = Number(url.searchParams.get('step'));
          const direction = query.includes('input_tokens') ? 'input' : 'output';
          queries.push({ start, end, step, direction });
          assert(start >= task.started_at + 60); assert(step >= 15);
          if (direction === 'output' && hold) await gate;
          if (direction === 'output' && fail) { status = 503; body = { error: 'output temporarily unavailable' }; }
          else {
            const values = [];
            for (let timestamp = start; timestamp <= end; timestamp += step) {
              if (timestamp === start + 2 * step) continue;
              values.push([timestamp, timestamp === start + step ? 'NaN' : String(direction === 'input' ? inputValue : 5)]);
            }
            body = { status: 'success', data: { resultType: 'matrix', result: empty ? [] : [{ metric: { requested_model: 'lite-target' }, values }] } };
          }
        } else {
          if (range && query.includes('time_to_first_token')) ttftCalls++;
          body = { status: 'success', data: { resultType: range ? 'matrix' : 'vector', result: query.startsWith('count by') ? [{ metric: { model_name: 'vllm-only' }, value: [now, '0'] }] : [] } };
        }
      } else {
        taskCalls++; assert.equal(request.headers().authorization, 'Bearer replay-only'); assert(!request.headers()['x-api-key']);
        body = url.pathname.endsWith('/active') ? { active: true, task } : task;
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    });
    const authenticate = async () => {
      await page.getByRole('button', { name: '连接设置', exact: true }).click();
      await page.locator('.settings-field input').fill('Bearer replay-only');
      await page.locator('.metrics-settings summary').click();
      await page.locator('.metrics-settings input').fill('independent-metrics');
      metricsAuth = true;
      await page.getByRole('button', { name: '应用设置', exact: true }).click();
    };
    const section = page.locator('.replay-throughput-section');
    const observed = key => section.locator('.replay-trend-note span').filter({ hasText: key });
    await page.goto(process.env.CHECK_BASE_URL || 'http://127.0.0.1:4173');
    await page.getByRole('button', { name: '后端', exact: true }).click();
    await authenticate();
    if (process.env.CHECK_THROUGHPUT_CONFIGURED === '0') {
      await expect(section).toContainText('未配置 LiteLLM 目标映射');
      await page.clock.runFor(31000);
      assert.equal(queries.length, 0);
      await expect(section.locator('.cache-legend')).toHaveCount(0);
      assert.deepEqual(errors, []);
      console.log('PASS: default build explains missing LiteLLM mapping and sends no throughput query.');
      return;
    }
    await expect(section).toContainText('requested_model=lite-target');
    await expect(section.getByRole('button', { name: '输入 Token', exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: '输出 Token', exact: true })).toHaveCount(0);
    const progressBefore = taskCalls, ttftBefore = ttftCalls;
    await page.clock.runFor(31000);
    assert(taskCalls > progressBefore); assert(ttftCalls > ttftBefore, 'slow output must not block TTFT');
    hold = false; release();
    await expect(section.getByRole('button', { name: '总 Token', exact: true })).toBeVisible();
    const totalTime = await observed('总 Token').innerText();
    const outputTime = await observed('输出 Token').innerText();
    const toggle = section.getByRole('button', { name: '输出 Token', exact: true });
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    inputValue = 20; fail = true;
    await page.clock.runFor(31000);
    await expect(section.locator('.chart-error')).toContainText('503');
    assert.equal(await observed('总 Token').innerText(), totalTime);
    assert.equal(await observed('输出 Token').innerText(), outputTime);
    await expect(observed('输入 Token')).not.toHaveText(outputTime.replace('输出', '输入'));
    await expect(section).toContainText('总吞吐等待同轮输入与输出数据');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fail = false; empty = true;
    await page.clock.runFor(31000);
    await expect(section.locator('.cache-legend')).toHaveCount(0);
    await expect(section).toContainText('暂无样本');
    empty = false; inputValue = 0;
    await page.clock.runFor(31000);
    await expect(section.getByRole('button', { name: '总 Token', exact: true })).toBeVisible();
    const beforeHidden = queries.length;
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    await page.clock.runFor(31000); assert.equal(queries.length, beforeHidden);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => queries.length).toBeGreaterThan(beforeHidden);
    await section.getByRole('checkbox', { name: '相对时间', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
    await expect(section.locator('h2')).toHaveText('Token throughput trends');
    await page.setViewportSize({ width: 320, height: 900 });
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    fs.mkdirSync('test-results', { recursive: true });
    await section.screenshot({ path: 'test-results/replay-throughput-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: '切换到中文', exact: true }).click();
    task = { ...task, status: 'succeeded', finished_at: Math.floor(await page.evaluate(() => Date.now() / 1000)), revision: 2 };
    hold = true; gate = new Promise(resolve => release = resolve);
    const beforeTerminal = queries.length;
    await page.clock.runFor(2500);
    await expect.poll(() => queries.length).toBeGreaterThan(beforeTerminal);
    await page.clock.setSystemTime(new Date((task.finished_at + 180) * 1000));
    hold = false; release();
    await expect(section).not.toContainText('最终观测已固定');
    await page.clock.runFor(31000);
    await expect(section).toContainText('最终观测已固定');
    assert.equal(queries.at(-1).end, task.finished_at + 60);
    const settledCount = queries.length;
    await page.clock.runFor(65000); assert.equal(queries.length, settledCount);
    await page.getByRole('button', { name: '刷新指标', exact: true }).click();
    await expect.poll(() => queries.length).toBeGreaterThan(settledCount);
    const saved = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert(!saved.includes('independent-metrics') && !saved.includes('replay-only'));
    metricsAuth = false;
    await page.reload(); await authenticate();
    await expect(section).toContainText('最终观测已固定');
    assert.equal(queries.at(-1).end, task.finished_at + 60);
    await section.screenshot({ path: 'test-results/replay-throughput-desktop.png' });
    // A different target without a mapping must never query all models or reuse old series.
    const beforeUnmapped = queries.length;
    task = { ...task, replay_id: 'unmapped-task', model_id: 'unmapped', target_model: 'unmapped', revision: 1 };
    await authenticate();
    await expect(section).toContainText('未配置 LiteLLM 目标映射');
    await expect(section.locator('.cache-legend')).toHaveCount(0);
    await page.clock.runFor(31000); assert.equal(queries.length, beforeUnmapped);
    assert.deepEqual(errors, []);
    console.log('PASS: throughput mapping, auth isolation, slow output, independent TTFT/progress, partial retention, empty clear, legend, visibility, terminal sleep, refresh/reload, unmapped target, English and 320px layout.');
  } finally { release?.(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
