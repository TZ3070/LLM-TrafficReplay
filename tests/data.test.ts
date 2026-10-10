import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatValue, normalizeRange, parseMatrix, parsePromValue, parseVector, queryTiming, loadQueries } from '../src/data';

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
