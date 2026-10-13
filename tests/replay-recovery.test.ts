import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyReplayResponse, restoreReplay } from '../src/replay';
import { readPending, readSnapshot, savePending, saveSnapshot } from '../src/replayStorage';
import { ApiError, request } from '../src/data';

const task={replay_id:'recovered',model_id:'alias',source_model:'source',start_time:100,end_time:200,status:'running',speed:5,started_at:300,cancellable:true,revision:2,progress:{ready:true,total:10,sent:8,completed:4},target:{metrics_labels:{model_name:'alias'}}};

test('restoration uses the task context and corrects legacy metric aliases without inventing speed',()=>{
  const restored=restoreReplay(task,{alias:'real-model'});
  assert.equal(restored.modelId,'alias');assert.equal(restored.sourceModelId,'source');
  assert.equal(restored.metricsName,'real-model');assert.equal(restored.metricsLabels?.model_name,'real-model');
  assert.equal(restored.speed,5);assert.deepEqual(restored.source,{start:100,end:200});
  assert.equal(restoreReplay({...task,speed:undefined}).speed,undefined);
  assert.equal(restoreReplay({...task,target:{metrics_labels:{model_name:'explicit-model'}}},{alias:'mapped-model'}).metricsName,'explicit-model');
  assert.throws(()=>restoreReplay({replay_id:'bad',status:'running'}),/模型或历史区间/);
  assert.throws(()=>applyReplayResponse({...task,replay_id:'different'},restored),/ID 不匹配/);
});

test('older revisions and late polls cannot undo cancellation, reduce counts or reopen terminal tasks',()=>{
  const running=restoreReplay(task);
  const cancelling=applyReplayResponse({...task,status:'cancelling',revision:3,cancel_requested_at:310},running);
  assert.equal(cancelling.cancellable,false);
  assert.equal(applyReplayResponse(task,cancelling),cancelling);
  const legacy=applyReplayResponse({status:'running',completed_count:2,cancellable:true},cancelling);
  assert.equal(legacy.status,'cancelling');assert.equal(legacy.completedCount,4);assert.equal(legacy.cancellable,false);
  const ended=applyReplayResponse({status:'cancelled',revision:4,finished_at:320},legacy);
  assert.equal(applyReplayResponse({status:'running',revision:5},ended),ended);
});

test('refresh storage keeps non-secret context and the original pending idempotency key, isolated by environment',()=>{
  const memory=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)} as Storage;};
  const priorLocal=globalThis.localStorage,priorSession=globalThis.sessionStorage;
  globalThis.localStorage=memory();globalThis.sessionStorage=memory();
  try{
    const replay=restoreReplay(task);
    saveSnapshot('test',{replay:{...replay,apiKey:'must-not-persist'} as any});
    assert.equal(readSnapshot('test').replay?.speed,5);assert.equal(readSnapshot('other').replay,undefined);
    assert(!JSON.stringify(readSnapshot('test')).includes('must-not-persist'));
    const body={model_id:'alias',start_time:100,end_time:200,speed:5};
    savePending('test',{key:'original-key',body,signature:JSON.stringify(body),context:{...replay,id:''}});
    assert.equal(readPending('test')?.key,'original-key');
    assert.equal(readPending('test')?.body.speed,5);assert.equal(readPending('other'),undefined);
    savePending('test');assert.equal(readPending('test'),undefined);
  }finally{globalThis.localStorage=priorLocal;globalThis.sessionStorage=priorSession;}
});

test('structured conflict payloads survive errors and metrics throttling does not block cancellation',async()=>{
  const originalFetch=globalThis.fetch;
  const priorWindow=globalThis.window;
  globalThis.window={setTimeout,clearTimeout} as any;
  const calls:string[]=[];
  globalThis.fetch=async(input:any)=>{
    const path=String(input);calls.push(path);
    if(path==='/api/limit-metrics')return new Response(JSON.stringify({error:'busy'}),{status:429,headers:{'Retry-After':'1'}});
    if(path.endsWith('/cancel'))return new Response(JSON.stringify({error:'already ended',task:{...task,status:'cancelled'}}),{status:409});
    return new Response('{}');
  };
  try{
    await assert.rejects(request('/api/limit-metrics'),error=>error instanceof ApiError && error.retryAfterMs===1000);
    await assert.rejects(request('/api/replays/recovered/cancel',{method:'POST'},{service:'replay'}),error=>error instanceof ApiError && error.payload.task.status==='cancelled');
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=originalFetch;globalThis.window=priorWindow;}
});
