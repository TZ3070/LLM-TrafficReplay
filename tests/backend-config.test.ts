import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createApiConfig } from '../src/apiConfig';
import { adaptModels, ApiError, fetchLoad, fetchMetrics, promPath, request } from '../src/data';

test('configured Prometheus prefix preserves query encoding and range parameters', () => {
  const config = createApiConfig({ VITE_PROMETHEUS_API_PREFIX: '/api/custom-prometheus/' });
  const query = 'sum(vllm:num_requests_running{model_name="Qwen/Qwen3-32B"})';
  const url = new URL(promPath(query, { start: 100, end: 3700 }, config), 'http://localhost');
  assert.equal(url.pathname, '/api/custom-prometheus/query_range');
  assert.equal(url.searchParams.get('query'), query);
  assert.equal(url.searchParams.get('start'), '100');
  assert.equal(url.searchParams.get('end'), '3700');
  assert.equal(url.searchParams.get('step'), '60');
  assert.equal(new URL(promPath('up'), 'http://localhost').pathname, '/api/prometheus/query');
  assert.equal(new URL(promPath('up', { start: 100, end: 400 }), 'http://localhost').pathname, '/api/prometheus/query_range');
  assert.throws(() => createApiConfig({ VITE_MODEL_INFO_PATH: 'https://other.example/model/info' }), /接口路径/);
});

test('model mapping changes metric filtering without changing logical replay ID', () => {
  const config = createApiConfig({ VITE_MODEL_METRICS_MAP: '{"qwen-service":"Qwen/Qwen3-32B"}' });
  const list = adaptModels({ data: [
    { model_name: 'qwen-service', model_info: { id: 'instance-1', metrics_model_name: 'old-name' }, litellm_params: { model: 'openai/qwen', custom_llm_provider: 'openai' } },
    { model_name: 'qwen-service', model_info: { id: 'instance-2' } }
  ] }, config.modelMetricsMap);
  assert.deepEqual(list, [{ id: 'qwen-service', name: 'qwen-service', provider: 'openai', metricsName: 'Qwen/Qwen3-32B' }]);
  assert.throws(() => createApiConfig({ VITE_MODEL_METRICS_MAP: '{"qwen-service":[]}' }), /JSON|model_name/);
});

test('grouping keeps declared metric name and flags conflicting instance mappings', () => {
  assert.equal(adaptModels([
    { model_name: 'qwen', metrics_model_name: 'actual-qwen' },
    { model_name: 'qwen' }
  ])[0].metricsName, 'actual-qwen');
  assert.throws(() => adaptModels([
    { model_name: 'qwen', metrics_model_name: 'a' },
    { model_name: 'qwen', metrics_model_name: 'b' }
  ]), /不同指标名/);
});

test('load and card requests use custom routes, deduplicate, and carry no auth', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  (globalThis as any).window = { setTimeout: globalThis.setTimeout };
  const paths: URL[] = [];
  const config = createApiConfig({ VITE_PROMETHEUS_API_PREFIX: '/api/custom-prometheus' });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    paths.push(url);
    const headers = new Headers(options?.headers);
    assert(!headers.has('x-litellm-key') && !headers.has('Authorization') && !headers.has('x-api-key'));
    const isRange = url.pathname.endsWith('/query_range');
    return new Response(JSON.stringify({ status: 'success', data: {
      resultType: isRange ? 'matrix' : 'vector',
      result: [{ metric: { model_name: 'actual-test-model' }, ...(isRange ? { values: [[100, '2']] } : { value: [100, 'NaN'] }) }]
    } }), { status: 200 });
  };
  try {
    const [first, second, cards] = await Promise.all([
      fetchLoad('actual-test-model', { start: 100, end: 400 }, undefined, config),
      fetchLoad('actual-test-model', { start: 100, end: 400 }, undefined, config),
      fetchMetrics('actual-test-model', config)
    ]);
    assert.equal(first.running[0].points[0].value, 2);
    assert.deepEqual(first, second);
    assert(Number.isNaN(cards.ttft.value));
    await fetchLoad('actual-test-model', { start: 100, end: 400 }, undefined, config);
    await fetchMetrics('actual-test-model', config);
    assert.equal(paths.length, 6, 'two curves and four cards, repeated reads come from cache');
    assert(paths.every(url => url.pathname.startsWith('/api/custom-prometheus/')));
    assert(paths.every(url => url.searchParams.get('query')?.includes('model_name="actual-test-model"')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else globalThis.window = originalWindow;
  }
});

test('404 errors identify the failed route without exposing the query string', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  (globalThis as any).window = { setTimeout: globalThis.setTimeout };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'API route not found' }), { status: 404 });
  try {
    await assert.rejects(request('/api/missing/query?query=private-model'), error => {
      assert(error instanceof ApiError);
      assert.equal(error.status, 404);
      assert(error.message.includes('/api/missing/query'));
      assert(error.message.includes('API route not found'));
      assert(!error.message.includes('private-model'));
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else globalThis.window = originalWindow;
  }
});
