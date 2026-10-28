// Mocked HTTP only: target changes, late responses and manual refresh of ended tasks.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173';

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHECK_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  let releaseOld;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[],calls=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(/same key|unique.*key/i.test(message.text()))errors.push(message.text());});
    const now=Math.floor(Date.now()/1000);
    await page.clock.install({time:new Date(now*1000)});
    let task={replay_id:'review-task',model_id:'review-model',source_model:'review-model',target_model:'review-model',status:'running',speed:1,cancellable:true,revision:1,start_time:now-1200,end_time:now-600,started_at:now-120,target:{metrics_labels:{model_name:'review-model',deployment:'a'}}};
    let holdA=false,failB=true,oldCount=0,releasedCount=0,failLoad=false,emptyKV=false;
    const oldGate=new Promise(resolve=>releaseOld=resolve);
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());let body,status=200;
      if(url.pathname.startsWith('/api/prometheus/')){
        assert(!req.headers().authorization);
        const query=url.searchParams.get('query'),range=url.pathname.endsWith('/query_range');
        const deployment=query.match(/deployment="([^"]+)"/)?.[1];
        if(deployment){
          calls.push({deployment,range,query,start:Number(url.searchParams.get('start')),end:Number(url.searchParams.get('end'))});
          if(deployment==='a'&&holdA){oldCount++;await oldGate;releasedCount++;}
          if(deployment==='b'&&(failB||failLoad&&query.includes('num_requests_'))){status=503;body={error:'temporary deployment B failure'};}
          else{
            const metric=query.includes('num_requests_')?{model_name:'review-model'}:query.includes('kv_cache')?{model_name:'review-model',instance:'worker-0',deployment}:{};
            const stamp=range?Number(url.searchParams.get('start')):Number(query.match(/ @ (\d+)/)?.[1]);
            const value=query.includes('kv_cache')?deployment==='a'?'64':'40':query.includes('prefix_cache')?'50':query.includes('num_requests_')?deployment==='a'?'20':'7':deployment==='a'?'0.222':'0.333';
            // One genuine sample: a short/mostly missing series must remain visible as a point.
            const samples=query.includes('num_requests_')?[[stamp,value],[Number(url.searchParams.get('end')),value]]:[[stamp,value]];
            const result=emptyKV&&query.includes('kv_cache')?[]:[{metric,...(range?{values:samples}:{value:[stamp,value]})}];
            body={status:'success',data:{resultType:range?'matrix':'vector',result}};
          }
        }else if(query.startsWith('count by'))body={status:'success',data:{resultType:'vector',result:[{metric:{model_name:'review-model'},value:[now,'0']}]}};
        else body={status:'success',data:{resultType:range?'matrix':'vector',result:[]}};
      }else{
        assert.equal(req.method(),'GET','observing/recovering must never create or control replay traffic');
        assert.equal(req.headers().authorization,'Bearer review-test');
        body=url.pathname.endsWith('/active')?{active:task.status==='running',task:task.status==='running'?task:null}:task;
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    });
    const authenticate=async()=>{
      await page.getByRole('button',{name:'连接设置',exact:true}).click();
      await page.locator('.settings-field input').fill('Bearer review-test');
      await page.getByRole('button',{name:'应用设置',exact:true}).click();
    };
    const kv=page.locator('[data-cache-metric="kv"]'),ttft=page.locator('[data-replay-metric="ttft"]');
    await page.goto(base);await page.getByRole('button',{name:'后端',exact:true}).click();await authenticate();
    await expect(kv.locator('.metric-value')).toContainText('64');
    await expect(ttft.locator('.metric-value')).toContainText('0.222');
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    const load=page.locator('.replay-panel .load-chart');
    const hoverLoad=async()=>{await load.scrollIntoViewIfNeeded();const bounds=await load.boundingBox();await load.hover({position:{x:bounds.width/2,y:100}});};
    await hoverLoad();
    await expect(load).toContainText('正在处理 · review-model 20');
    holdA=true;await page.clock.runFor(31000);
    await expect.poll(()=>oldCount).toBeGreaterThanOrEqual(9); // 2 load + 5 latency + 1 KV query per 30s round; token mode adds prefix queries.
    task={...task,revision:2,target:{metrics_labels:{model_name:'review-model',deployment:'b'}}};
    await page.clock.runFor(2500);
    await expect(page.locator('.replay-cache-section')).toContainText('deployment=b');
    await expect(kv).toContainText('查询失败 · 查看详情');
    await expect(kv.locator('.metric-value')).toContainText('—');
    await expect(ttft.locator('.metric-value')).toContainText('—');
    await expect(page.locator('.replay-panel .chart-error')).toContainText('503');
    await expect(page.locator('[data-cache-chart="kv"] .cache-legend>span')).toHaveCount(0);
    releaseOld();holdA=false;
    await expect.poll(()=>releasedCount).toBe(oldCount);
    await expect(kv.locator('.metric-value')).toContainText('—');
    await expect(ttft.locator('.metric-value')).toContainText('—');
    // Old load failures used to keep the old deployment's 20-request curve under the new target.
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    await hoverLoad();
    await expect(load).not.toContainText('20');
    failB=false;await page.clock.runFor(31000);
    await expect(kv.locator('.metric-value')).toContainText('40');
    await expect(ttft.locator('.metric-value')).toContainText('0.333');
    fs.mkdirSync('test-results',{recursive:true});
    await page.locator('[data-cache-chart="kv"]').screenshot({path:'test-results/replay-cache-derived.png'});
    task={...task,status:'cancelled',finished_at:Math.floor(await page.evaluate(()=>Date.now()/1000)),revision:3,cancellable:false};
    await page.clock.runFor(2500);await page.clock.runFor(95000);
    await expect(page.locator('.replay-cache-section')).toContainText('最终观测已固定');
    const fixedLoadEnd=task.finished_at+30;
    const loadCalls=()=>calls.filter(call=>call.deployment==='b'&&call.query.includes('num_requests_'));
    const settledCount=loadCalls().length;
    await page.clock.runFor(65000);assert.equal(loadCalls().length,settledCount);
    failLoad=true;
    await page.getByRole('button',{name:'刷新指标',exact:true}).click();
    await expect(page.locator('.replay-panel .chart-error')).toContainText('503');
    assert(loadCalls().length>settledCount,'manual refresh must restart a settled load chart');
    assert.equal(loadCalls().at(-1).end,fixedLoadEnd,'manual refresh must keep the original task time');
    await page.reload();await authenticate();
    await expect(kv.locator('.metric-value')).toContainText('40');
    assert.equal(loadCalls().at(-1).start,task.started_at);assert.equal(loadCalls().at(-1).end,fixedLoadEnd);
    emptyKV=true;await page.clock.runFor(31000);await page.getByRole('button',{name:'刷新指标',exact:true}).click();
    await expect(kv.locator('.metric-value')).toContainText('—');
    assert.deepEqual(errors,[]);
    console.log('PASS: deployment update clears all observations, late responses ignored, first-error empty state, one-point cache chart, manual refresh restarts ended load curve, historical refresh/reload preserve task times.');
  }finally{releaseOld?.();await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
