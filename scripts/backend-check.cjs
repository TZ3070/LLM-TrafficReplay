const { chromium }=require('@playwright/test');
const assert=require('assert');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  // 可对另一份构建验证自定义路由和回放别名映射；所有 API 在浏览器中拦截，不访问真实模型。
  const baseUrl=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173';
  const promPrefix=process.env.CHECK_PROMETHEUS_PREFIX||'/api/prometheus';
  const metricsModel=process.env.CHECK_METRICS_MODEL||'backend-model';
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let submitted,headerKey;let promRequests=0;
  const started=Math.floor(Date.now()/1000);
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());let body;
    if(url.pathname===`${promPrefix}/query`){
      promRequests++;assert(!req.headers()['x-litellm-key']);
      const q=url.searchParams.get('query');
      if(q==='count by (model_name) (vllm:num_requests_running)')body={status:'success',data:{resultType:'vector',result:[{metric:{model_name:metricsModel},value:[started,'0']},{metric:{model_name:metricsModel},value:[started,'0']},{metric:{model_name:'zz-other-model'},value:[started,'1']}]}};
      else {assert(q.includes(`model_name="${metricsModel}"`));body={status:'success',data:{resultType:'vector',result:[{metric:{},value:[started,q.includes('time_to_first')?'NaN':'2']}]}};}
    }else if(url.pathname===`${promPrefix}/query_range`){
      promRequests++;const start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));
      const q=url.searchParams.get('query');
      const running=q.includes('num_requests_running');
      assert.equal(q,`sum by (model_name) (vllm:num_requests_${running?'running':'waiting'}{model_name="${metricsModel}"})`);
      // 后端原样返回 Prometheus 已求和的集群数据，不再携带 role/engine。
      body={status:'success',data:{resultType:'matrix',result:[{metric:{model_name:metricsModel},values:Array.from({length:61},(_,i)=>[start+(end-start)*i/60,String(running?20+i%12:7+i%5)])}]}};
    }else if(url.pathname==='/api/replays/active')body={active:false,task:null};
    else if(url.pathname==='/api/replays'&&req.method()==='POST'){
      submitted=req.postDataJSON();headerKey=req.headers()['idempotency-key'];
      body={replay_id:'backend-replay-1',status:'queued',request_count:42};
    }else if(url.pathname==='/api/replays/backend-replay-1')body={status:'running',started_at:started,request_count:42,sent_count:12,completed_count:9};
    else throw new Error('unexpected route '+url.pathname);
    await route.fulfill({status:url.pathname==='/api/replays'?202:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(baseUrl);
  await page.getByRole('button',{name:'后端',exact:true}).click();
  await page.waitForFunction(name=>document.querySelector('#model')?.value===name,metricsModel);
  assert.equal(await page.locator('#model option').count(),2,'same-name instances must merge');
  await page.locator('.metric-value.nan').waitFor();
  assert((await page.locator('.metric-value.nan').innerText()).includes('NaN'));
  await page.getByRole('button',{name:'连接设置',exact:true}).click();
  await page.locator('.settings-field input').fill('Bearer test-only');
  await page.getByRole('button',{name:'应用设置',exact:true}).click();
  const checkTotalTooltip=async chart=>{
    const box=await chart.boundingBox();
    await page.mouse.move(box.x+box.width*.55,box.y+110);
    const values=chart.locator('b');await values.first().waitFor();
    assert.equal(await values.count(),2,'one running total and one waiting total, with no role curves');
    const [running,waiting]=(await values.allTextContents()).map(Number);
    assert(running>=20&&running<32,'running chart must keep the aggregated request count');
    assert(waiting>=7&&waiting<12,'waiting chart must keep the aggregated request count');
  };
  await checkTotalTooltip(page.locator('.load-chart').first());
  const box=await page.locator('.load-chart').first().boundingBox();
  await page.mouse.move(box.x+box.width*.25,box.y+100);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+100,{steps:8});await page.mouse.up();
  await page.getByRole('button',{name:'确认回放',exact:true}).click();await page.getByRole('button',{name:'开始回放',exact:true}).click();
  await page.getByText('回放中',{exact:true}).waitFor();
  assert.deepEqual(Object.keys(submitted).sort(),['end_time','model_id','speed','start_time']);
  assert.equal(submitted.model_id,metricsModel);assert(submitted.end_time>submitted.start_time);assert(headerKey);
  await checkTotalTooltip(page.locator('.replay-panel .load-chart'));
  assert(promRequests<=10,'one model discovery, five latency cards, two history curves and two replay curves');
  assert.deepEqual(errors,[]);
  console.log('PASS: backend mode, raw Prometheus parsing, NaN rendering, model filtering, summed running/waiting curves and tooltips in history/replay, replay body and idempotency key, task polling, request budget');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
