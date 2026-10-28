import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createApiConfig } from '../src/apiConfig';
import { adaptModels, ApiError, fetchModels, fetchLoad, fetchMetrics, metricQueries, MODEL_DISCOVERY_QUERY, parseModelVector, promDuration, promPath, request } from '../src/data';

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

test('five instant latency queries use the selected history window and selected model', () => {
  const queries = metricQueries('model-a', 43200);
  assert.deepEqual(Object.keys(queries).sort(), ['e2e', 'itl', 'qt', 'tpot', 'ttft']);
  assert.equal(promDuration(43200), '12h');
  for (const [key,query] of Object.entries(queries)) {
    assert(query.includes('model_name="model-a"'));
    assert(query.includes('[12h]'));
    if(key!=='tpot')assert.match(query, /^rate\(.+_sum\{model_name="model-a"\}\[12h\]\) \/ rate\(.+_count\{model_name="model-a"\}\[12h\]\)$/);
  }
  assert.equal(queries.itl, 'rate(vllm:inter_token_latency_seconds_sum{model_name="model-a"}[12h]) / rate(vllm:inter_token_latency_seconds_count{model_name="model-a"}[12h])');
  assert.equal(queries.tpot, 'rate(vllm:request_decode_time_seconds_sum{model_name="model-a"}[12h]) / (rate(vllm:request_generation_tokens_sum{model_name="model-a"}[12h]) - rate(vllm:request_generation_tokens_count{model_name="model-a"}[12h]))');
});

test('deployed histogram names can be configured and every duration is a valid PromQL window', () => {
  const config = createApiConfig({ VITE_PROMETHEUS_METRIC_NAMES: '{"itl":{"sum":"custom:itl_sum","count":"custom:itl_count"}}' });
  const query = metricQueries('selected-model', 604800, config).itl;
  assert(query.includes('custom:itl_sum{model_name="selected-model"}[7d]'));
  assert(query.includes('custom:itl_count{model_name="selected-model"}[7d]'));
  assert.equal(promDuration(30), '30s');
  assert.equal(promDuration(900), '15m');
  assert.equal(promDuration(86400), '1d');
  assert.throws(()=>promDuration(NaN), /正数秒/);
  assert.throws(()=>createApiConfig({VITE_PROMETHEUS_METRIC_NAMES:'{"itl":{"sum":"up{}","count":"custom:itl_count"}}'}), /sum/);
  const tpotConfig=createApiConfig({VITE_PROMETHEUS_METRIC_NAMES:'{"tpot":{"decodeSum":"custom:decode_sum","generationTokensSum":"custom:tokens_sum","generationTokensCount":"custom:tokens_count"}}'});
  assert(metricQueries('model-a',900,tpotConfig).tpot.includes('(rate(custom:tokens_sum{model_name="model-a"}[15m]) - rate(custom:tokens_count{model_name="model-a"}[15m]))'));
  assert.throws(()=>createApiConfig({VITE_PROMETHEUS_METRIC_NAMES:'{"tpot":{"sum":"custom:decode_sum","count":"custom:tokens_count"}}'}), /decodeSum/);
});

test('mixed latency role model matching defaults to DeepSeek and can be configured', () => {
  assert.deepEqual(createApiConfig({}).mixedLatencyRoleModels, ['deepseek']);
  assert.deepEqual(createApiConfig({VITE_MIXED_LATENCY_ROLE_MODELS:'deepseek-v3,custom-model'}).mixedLatencyRoleModels, ['deepseek-v3','custom-model']);
});

test('instant cards isolate failure, preserve NaN and leave successful empty results undefined', async () => {
  const originalFetch=globalThis.fetch, originalWindow=globalThis.window;
  const originalWarn=console.warn;
  (globalThis as any).window={setTimeout:globalThis.setTimeout};
  console.warn=()=>{};
  const urls:URL[]=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input),'http://localhost');urls.push(url);
    assert.equal(url.pathname,'/api/prometheus/query');
    assert.deepEqual([...url.searchParams.keys()],['query']);
    const query=url.searchParams.get('query')!;
    assert(query.includes('[30m]')&&query.includes('model_name="isolation-model"'));
    if(query.includes('request_queue_time'))return new Response(JSON.stringify({error:'upstream timeout'}),{status:504});
    const result=query.includes('request_decode_time')?[]:[{metric:{},value:[100,query.includes('time_to_first')?'NaN':'0.123']}];
    return new Response(JSON.stringify({status:'success',data:{resultType:'vector',result}}));
  };
  try {
    const data=await fetchMetrics('isolation-model',1800);
    assert.equal(urls.length,5,'exactly five independent instant latency queries');
    assert(Number.isNaN(data.ttft.value));
    assert.equal(data.e2e.value,.123);
    assert.equal(data.itl.value,.123);
    assert.equal(data.tpot.value,undefined);
    assert.equal(data.tpot.error,undefined);
    assert(data.qt.error?.includes('504'));
    assert.equal(data.qt.value,undefined);
  }finally{
    globalThis.fetch=originalFetch;console.warn=originalWarn;
    if(originalWindow===undefined)delete(globalThis as any).window;
    else globalThis.window=originalWindow;
  }
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

test('Prometheus model discovery uses observed names, keeps idle models and preserves explicit replay aliases', async () => {
  const raw={status:'success',data:{resultType:'vector',result:[
    {metric:{model_name:'updated-model',role:'prefill'},value:[100,'0']},
    {metric:{model_name:'updated-model',role:'decode'},value:[100,'0']},
    {metric:{model_name:'another-model'},value:[100,'1']},
    {metric:{job:'vllm'},value:[100,'1']}
  ]}};
  const config=createApiConfig({VITE_MODEL_METRICS_MAP:'{"old-gateway-alias":"updated-model"}'});
  const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
  (globalThis as any).window={setTimeout:globalThis.setTimeout};
  let requests=0;
  globalThis.fetch=async (input,options)=>{
    const url=new URL(String(input),'http://localhost');requests++;
    assert.equal(url.pathname,'/api/prometheus/query');
    assert.equal(url.searchParams.get('query'),MODEL_DISCOVERY_QUERY);
    const headers=new Headers(options?.headers);
    assert(!headers.has('x-litellm-key')&&!headers.has('Authorization')&&!headers.has('x-api-key'));
    return new Response(JSON.stringify(raw));
  };
  try{
    const models=await fetchModels(config);
    assert.equal(models.length,2);
    const updated=models.find(model=>model.id==='updated-model')!;
    assert.equal(updated.name,'updated-model');
    assert.equal(updated.metricsName,'updated-model');
    assert.equal(updated.replayModelId,'old-gateway-alias');
    await fetchModels(config);assert.equal(requests,1,'discovery shares the 30 second Prometheus cache');
    const ambiguous=parseModelVector(raw,{a:'updated-model',b:'updated-model'}).find(model=>model.id==='updated-model')!;
    assert.equal(ambiguous.replayModelId,undefined);
    assert(ambiguous.replayError?.includes('多个回放别名'));
  }finally{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete(globalThis as any).window;else globalThis.window=originalWindow;}
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
      fetchMetrics('actual-test-model', 3600, config)
    ]);
    assert.equal(first.running[0].points[0].value, 2);
    assert.deepEqual(first, second);
    assert(Number.isNaN(cards.ttft.value));
    await fetchLoad('actual-test-model', { start: 100, end: 400 }, undefined, config);
    await fetchMetrics('actual-test-model', 3600, config);
    assert.equal(paths.length, 7, 'two history curves and five latency cards, repeated reads come from cache');
    assert(paths.every(url => url.pathname.startsWith('/api/custom-prometheus/')));
    assert(paths.every(url => url.searchParams.get('query')?.includes('model_name="actual-test-model"')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else globalThis.window = originalWindow;
  }
});

test('PD load keeps one total curve per metric in history and the targeted replay', async () => {
  const originalFetch=globalThis.fetch, originalWindow=globalThis.window;
  (globalThis as any).window={setTimeout:globalThis.setTimeout};
  const urls:URL[]=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input),'http://localhost');urls.push(url);
    assert.equal(url.pathname,'/api/prometheus/query_range');
    const query=url.searchParams.get('query')!;
    const replay=url.searchParams.get('start')==='500';
    const model=replay?'DeepSeek-load-v2':'DeepSeek-load-v1';
    const filter=replay?`{deployment="optimized-pd",model_name="${model}"}`:`{model_name="${model}"}`;
    const metric=query.includes('num_requests_running')?'running':'waiting';
    assert.equal(query,`sum by (model_name) (vllm:num_requests_${metric}${filter})`);
    // 模拟 Prometheus 已求和的结果：running = proxy 10 + prefill 3 + decode 7，waiting = 4 + 1 + 2。
    // 前端接收该总值，不能再平均或按 role 拆行。
    const start=Number(url.searchParams.get('start'));
    const values=metric==='running'?[[start,'20'],[start+5,'22']]:[[start,'7'],[start+5,'0']];
    return new Response(JSON.stringify({status:'success',data:{resultType:'matrix',result:[{metric:{model_name:model},values}]}}));
  };
  try {
    const history=await fetchLoad('DeepSeek-load-v1',{start:100,end:400});
    const replay=await fetchLoad('DeepSeek-load-v1',{start:500,end:800},{deployment:'optimized-pd',model_name:'DeepSeek-load-v2'});
    for(const [data,model] of [[history,'DeepSeek-load-v1'],[replay,'DeepSeek-load-v2']] as const) {
      assert.deepEqual(data.errors,[]);
      assert.equal(data.running.length,1);
      assert.equal(data.waiting.length,1);
      assert.equal(data.running[0].name,model);
      assert.equal(data.waiting[0].name,model);
      assert.deepEqual(data.running[0].points.map(point=>point.value),[20,22]);
      assert.deepEqual(data.waiting[0].points.map(point=>point.value),[7,0]);
    }
    assert.equal(urls.length,4,'two history queries and two deployment-filtered replay queries');
  }finally{
    globalThis.fetch=originalFetch;
    if(originalWindow===undefined)delete(globalThis as any).window;
    else globalThis.window=originalWindow;
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
