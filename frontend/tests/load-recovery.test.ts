import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchLoad, retainFailedLoad, promPath } from '../src/data';

test('load failures retain only failed series while successful empty responses clear old data', async context => {
  context.mock.method(console,'warn',()=>{});
  const priorFetch=globalThis.fetch,priorWindow=globalThis.window;
  globalThis.window={setTimeout,clearTimeout} as any;
  let phase=0;
  globalThis.fetch=async(input:any)=>{
    const url=new URL(String(input),'http://localhost');
    const running=url.searchParams.get('query')!.includes('num_requests_running');
    if(phase===2 || phase===1&&running)return new Response(JSON.stringify({error:'temporary metrics outage'}),{status:503});
    return new Response(JSON.stringify({status:'success',data:{resultType:'matrix',result:phase===0
      ? [{metric:{model_name:'load-recovery-model'},values:[[100,'2'],[110,'8']]}]
      : []}}));
  };
  try{
    const initial=await fetchLoad('load-recovery-model',{start:100,end:120});
    assert.equal(initial.running.length,1);assert.equal(initial.waiting.length,1);
    phase=1;
    const partial=await fetchLoad('load-recovery-model',{start:100,end:121});
    assert.deepEqual(partial.failedQueries,['running']);
    const retained=retainFailedLoad(initial,partial);
    assert.equal(retained.running,initial.running);assert.deepEqual(retained.waiting,[]);
    assert.equal(retained.errors.length,1);
    phase=2;
    const failed=retainFailedLoad(retained,await fetchLoad('load-recovery-model',{start:100,end:122}));
    assert.equal(failed.running,initial.running);assert.equal(failed.waiting,retained.waiting);
    assert.equal(failed.errors.length,2);
    phase=3;
    const recovered=retainFailedLoad(failed,await fetchLoad('load-recovery-model',{start:100,end:123}));
    assert.deepEqual(recovered,{running:[],waiting:[],errors:[]});
  }finally{globalThis.fetch=priorFetch;globalThis.window=priorWindow;}
});


test('replay can request 1s samples while history keeps its adaptive step', () => {
  const range={start:100,end:1000};
  assert.equal(new URL(promPath('up',range,undefined,1),'http://localhost').searchParams.get('step'),'1');
  assert.equal(new URL(promPath('up',range),'http://localhost').searchParams.get('step'),'15');
});


test('live load forwards 1s step and can refresh the fixed terminal range without cached data', async () => {
  const priorFetch=globalThis.fetch,priorWindow=globalThis.window;
  globalThis.window={setTimeout,clearTimeout} as any;
  let calls=0;
  globalThis.fetch=async(input:any)=>{
    calls++;
    const url=new URL(String(input),'http://localhost');
    assert.equal(url.searchParams.get('step'),'1');
    assert.equal(url.searchParams.get('start'),'100');
    assert.equal(url.searchParams.get('end'),'120');
    return new Response(JSON.stringify({status:'success',data:{resultType:'matrix',result:[]}}));
  };
  try {
    const range={start:100,end:120};
    const config={...require('../src/apiConfig').DEFAULT_API_CONFIG,prometheusPrefix:'/api/live-load-test'};
    await fetchLoad('live-model',range,undefined,config,{step:1});
    assert.equal(calls,2);
    await fetchLoad('live-model',range,undefined,config,{step:1,freshAfter:Date.now()+1});
    assert.equal(calls,4,'the terminal range is queried again for late samples');
  } finally { globalThis.fetch=priorFetch;globalThis.window=priorWindow; }
});
