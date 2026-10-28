import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchLoad, retainFailedLoad } from '../src/data';

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
