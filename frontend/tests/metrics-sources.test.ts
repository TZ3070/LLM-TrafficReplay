import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMetricsApiConfigs } from '../src/apiConfig';
import { fetchLoad, parseModelVector, requestPrometheus, setMetricsAuth } from '../src/data';
import { applyReplayResponse, restoreReplay } from '../src/replay';

test('history and replay have independent prefixes, with legacy and LiteLLM overrides', () => {
  const legacy = createMetricsApiConfigs({ VITE_PROMETHEUS_API_PREFIX: '/api/legacy' });
  assert.equal(legacy.history.prometheusPrefix, '/api/legacy');
  assert.equal(legacy.replay.prometheusPrefix, '/api/legacy');
  const split = createMetricsApiConfigs({
    VITE_PROMETHEUS_API_PREFIX: '/api/prometheus/',
    VITE_REPLAY_PROMETHEUS_API_PREFIX: '/api/replay-prometheus/',
    VITE_REPLAY_THROUGHPUT_PROMETHEUS_API_PREFIX: '/api/prometheus',
    VITE_MODEL_METRICS_MAP: '{"alias":"actual"}',
  });
  assert.equal(split.history.prometheusPrefix, '/api/prometheus');
  assert.equal(split.replay.prometheusPrefix, '/api/replay-prometheus');
  assert.equal(split.throughput.prometheusPrefix, '/api/prometheus');
  assert.deepEqual(split.replay.modelMetricsMap, { alias: 'actual' });
  assert.equal(createMetricsApiConfigs({ VITE_REPLAY_PROMETHEUS_API_PREFIX: '/api/gray' }).throughput.prometheusPrefix, '/api/gray');
  assert.throws(() => createMetricsApiConfigs({ VITE_REPLAY_PROMETHEUS_API_PREFIX: 'https://gray.example' }), /接口路径/);
});

test('gray target aliases cannot change the production archive model and remain mapped on cancellation', () => {
  const { history, replay } = createMetricsApiConfigs({
    VITE_MODEL_METRICS_MAP: '{"archive-model":"shared-vllm"}',
    VITE_REPLAY_MODEL_METRICS_MAP: '{"gray-target":"shared-vllm","gray-target-2":"shared-vllm"}',
  });
  const discovered = parseModelVector({status:'success',data:{resultType:'vector',result:[
    {metric:{model_name:'shared-vllm'},value:[100,'0']},
  ]}}, history.modelMetricsMap);
  assert.equal(discovered[0].replayModelId, 'archive-model');
  assert.equal(discovered[0].replayError, undefined);
  const task = restoreReplay({replay_id:'alias-task',source_model:'archive-model',target_model:'gray-target',
    start_time:100,end_time:200,status:'running',target:{metrics_labels:{model_name:'gray-target'}}}, replay.modelMetricsMap);
  assert.equal(task.sourceModelId, 'archive-model');
  assert.equal(task.metricsLabels?.model_name, 'shared-vllm');
  const cancelled = applyReplayResponse({replay_id:'alias-task',status:'cancelled',finished_at:300,
    target:{metrics_labels:{model_name:'gray-target'}}}, task, 301, replay.modelMetricsMap);
  assert.equal(cancelled.metricsLabels?.model_name, 'shared-vllm');
  assert.equal(cancelled.status, 'cancelled');
  const sameAlias = createMetricsApiConfigs({VITE_MODEL_METRICS_MAP:'{"service":"prod-vllm"}',VITE_REPLAY_MODEL_METRICS_MAP:'{"service":"gray-vllm"}'});
  assert.equal(sameAlias.history.modelMetricsMap.service,'prod-vllm');
  assert.equal(sameAlias.replay.modelMetricsMap.service,'gray-vllm');
  assert.deepEqual(createMetricsApiConfigs({VITE_MODEL_METRICS_MAP:'{"service":"prod-vllm"}',VITE_REPLAY_MODEL_METRICS_MAP:'{}'}).replay.modelMetricsMap,{});
  assert.throws(() => createMetricsApiConfigs({VITE_REPLAY_MODEL_METRICS_MAP:'[]'}), /VITE_REPLAY_MODEL_METRICS_MAP/);
});

test('the final replay load fetch bypasses cached data collected before the settling deadline', async () => {
  const originalFetch=globalThis.fetch, originalWindow=globalThis.window, originalNow=Date.now;
  (globalThis as any).window={setTimeout:globalThis.setTimeout};
  let clock=1_000_000, calls=0;
  Date.now=()=>clock;
  globalThis.fetch=async()=>{
    calls++;
    return new Response(JSON.stringify({status:'success',data:{resultType:'matrix',result:[
      {metric:{model_name:'final-load'},values:[[100,String(calls)]]},
    ]}}));
  };
  const api=createMetricsApiConfigs({VITE_REPLAY_PROMETHEUS_API_PREFIX:'/api/final-load-cache'}).replay;
  try {
    await fetchLoad('final-load',{start:100,end:200},undefined,api);
    clock+=1000;
    await fetchLoad('final-load',{start:100,end:200},undefined,api);
    assert.equal(calls,2);
    await fetchLoad('final-load',{start:100,end:200},undefined,api,{freshAfter:clock});
    assert.equal(calls,4,'the unchanged final URL must still get a post-deadline response');
  } finally {
    Date.now=originalNow;globalThis.fetch=originalFetch;
    if(originalWindow===undefined)delete(globalThis as any).window;else globalThis.window=originalWindow;
  }
});

test('identical model, PromQL and time range stay isolated across metrics sources and caches', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  (globalThis as any).window = { setTimeout: globalThis.setTimeout };
  const calls: URL[] = [];
  const { history, replay } = createMetricsApiConfigs({
    VITE_PROMETHEUS_API_PREFIX: '/api/source-isolation-prod',
    VITE_REPLAY_PROMETHEUS_API_PREFIX: '/api/source-isolation-gray',
  });
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://localhost'); calls.push(url);
    const value = url.pathname.startsWith(history.prometheusPrefix + '/') ? '11' : '33';
    return new Response(JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [
      { metric: { model_name: 'shared-model' }, values: [[100, value]] },
    ] } }));
  };
  try {
    const range = { start: 100, end: 200 };
    const [prod, gray] = await Promise.all([
      fetchLoad('shared-model', range, undefined, history), fetchLoad('shared-model', range, undefined, replay),
    ]);
    assert.equal(prod.running[0].points[0].value, 11);
    assert.equal(gray.running[0].points[0].value, 33);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].search, calls[2].search, 'only the data source differs');
    await fetchLoad('shared-model', range, undefined, history);
    await fetchLoad('shared-model', range, undefined, replay);
    assert.equal(calls.length, 4, 'each source caches its own response');
    assert(calls.every(url => !/namespace=|deployment=|environment=/.test(url.searchParams.get('query')!)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window; else globalThis.window = originalWindow;
  }
});

test('gray Prometheus rate limiting does not block production metrics', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  (globalThis as any).window = { setTimeout: globalThis.setTimeout };
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const path = String(input); calls.push(path);
    return path.includes('/limit-gray/')
      ? new Response(JSON.stringify({ error: 'gray rate limited' }), { status: 429, headers: { 'Retry-After': '60' } })
      : new Response(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
  };
  try {
    await assert.rejects(requestPrometheus('/api/limit-gray/query?query=up'), /429/);
    await requestPrometheus('/api/limit-prod/query?query=up');
    await assert.rejects(requestPrometheus('/api/limit-gray/query_range?query=up&start=100&end=200&step=15'), /限流/);
    assert.equal(calls.length, 2);
  } finally {
    setMetricsAuth({ apiKey: 'clear-rate-limit-test' }); setMetricsAuth({});
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window; else globalThis.window = originalWindow;
  }
});
