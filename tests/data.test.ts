import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatValue, normalizeRange, parseMatrix, parsePromValue, parseVector, parseLatencyVector, queryTiming, loadQueries } from '../src/data';

test('preserves Prometheus NaN and infinity values', () => {
  assert(Number.isNaN(parsePromValue('NaN')));
  assert.equal(parsePromValue('+Inf'), Infinity);
  assert.equal(parsePromValue('-Inf'), -Infinity);
  assert.equal(parsePromValue('0.42'), .42);
  assert.equal(parsePromValue(''), undefined);
  assert.equal(formatValue(NaN), 'NaN');
  assert.equal(formatValue(Infinity), '+Inf');
  assert.equal(formatValue(undefined), '—');
});
test('matrix keeps PD roles and genuine NaN samples', () => {
  const response={status:'success',data:{resultType:'matrix',result:[{metric:{model_name:'model-a',role:'prefill'},values:[[100,'NaN'],[105,'2']]}]}};
  const series=parseMatrix(response);
  assert.equal(series[0].name,'model-a · prefill');
  assert(Number.isNaN(series[0].points[0].value));
  assert.equal(series[0].points[1].value,2);
});
test('PromQL uses source model filter and keeps deployment label', () => {
  const query=loadQueries('model-a',{deployment:'optimized-a'}).running;
  assert(query.includes('model_name="model-a"'));
  assert(query.includes('deployment="optimized-a"'));
  assert(query.includes('sum by (model_name, role)'));
});
test('uses a minimum 5 second step and at least 30 second rate window', () => {
  const result = queryTiming(120, 1000);
  assert.deepEqual(result, { start: 880, end: 1000, step: 5, window: '30s' });
  assert.equal(queryTiming(3600, 1000).step, 60);
  assert.equal(queryTiming(3600, 1000).window, '60s');
});
test('normalizes a reverse drag inside the chart bounds', () => {
  assert.deepEqual(normalizeRange(90, 20, { start: 0, end: 100 }), { start: 20, end: 90 });
  assert.deepEqual(normalizeRange(-10, 120, { start: 0, end: 100 }), { start: 0, end: 100 });
});
test('vector parser rejects an unaggregated card response', () => {
  assert.equal(parseVector({ status:'success', data:{ resultType:'vector', result:[] } }), undefined);
  assert.throws(() => parseVector({ status:'success', data:{ resultType:'vector', result:[{metric:{},value:[1,'2']},{metric:{},value:[1,'3']}] } }), /聚合/);
});

test('latency ratios average parallel engines and preserve nonfinite signals', () => {
  const vector = (values: string[]) => ({status:'success',data:{resultType:'vector',result:values.map((value, engine)=>({metric:{model_name:'model-a',engine:String(engine)},value:[100,value]}))}});
  assert.deepEqual(parseLatencyVector(vector(['0.2','0.4']), 'model-a'), {value:.30000000000000004});
  assert(Number.isNaN(parseLatencyVector(vector(['0.2','NaN']), 'model-a').value));
  assert.equal(parseLatencyVector(vector(['+Inf','0.2']), 'model-a').value, Infinity);
  assert.deepEqual(parseLatencyVector(vector([]), 'model-a'), {value:undefined});
  assert.deepEqual(parseLatencyVector(vector(['0.42']), 'model-a'), {value:.42});
  assert.throws(()=>parseLatencyVector(vector(['0.2']), 'model-b'), /其他模型/);
});

test('latency PD roles stay separate while their engines are averaged', () => {
  const result = [
    {metric:{model_name:'model-a',role:'prefill',engine:'0'},value:[100,'1']},
    {metric:{model_name:'model-a',role:'prefill',engine:'1'},value:[100,'3']},
    {metric:{model_name:'model-a',role:'decode',engine:'0'},value:[100,'NaN']}
  ];
  const data = parseLatencyVector({status:'success',data:{resultType:'vector',result}}, 'model-a');
  assert.equal(data.value, undefined, 'do not average different PD roles into one headline');
  assert.equal(data.rows?.length, 2);
  assert.equal(data.rows?.find(row=>row.role==='prefill')?.value, 2);
  assert.equal(data.rows?.find(row=>row.role==='prefill')?.name, 'model-a · prefill');
  assert(Number.isNaN(data.rows?.find(row=>row.role==='decode')?.value));
});
