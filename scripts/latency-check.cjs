// 模拟后端检验首页延迟数据流；不会连接真实模型或发起回放。
const { chromium }=require('@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHECK_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  const queries=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let historyReady=false;
  let modelNames=['model-a','model-b','pd-model','model-a'];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    let body,status=200;
    if(url.pathname==='/api/prometheus/query'){
      assert.deepEqual([...url.searchParams.keys()],['query']);
      assert(!route.request().headers()['authorization']&&!route.request().headers()['x-litellm-key']);
      const query=url.searchParams.get('query');
      if(query==='count by (model_name) (vllm:num_requests_running)'){
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success',data:{resultType:'vector',result:modelNames.map(name=>({metric:{model_name:name},value:[100,'0']}))}})});
        return;
      }
      queries.push(query);
      if(query.includes('request_decode_time'))assert.match(query, /^rate\(.+_sum\{.+\}\[.+\]\) \/ \(rate\(.+_sum\{.+\}\[.+\]\) - rate\(.+_count\{.+\}\[.+\]\)\)$/);
      else assert.match(query, /^rate\(.+_sum\{.+\}\[.+\]\) \/ rate\(.+_count\{.+\}\[.+\]\)$/);
      const modelB=query.includes('model_name="model-b"')||query.includes('model_name="model-b-v2"');
      const modelPD=query.includes('model_name="pd-model"');
      assert(modelB||modelPD||query.includes('model_name="model-a"'));
      if(!modelB&&!modelPD&&query.includes('e2e_request_latency'))await new Promise(resolve=>setTimeout(resolve,800));
      if(modelPD){
        body={status:'success',data:{resultType:'vector',result:[
          {metric:{model_name:'pd-model',role:'prefill',engine:'0'},value:[100,'1']},
          {metric:{model_name:'pd-model',role:'prefill',engine:'1'},value:[100,'3']},
          {metric:{model_name:'pd-model',role:'decode',engine:'0'},value:[100,'NaN']}
        ]}};
      }else if(!modelB&&query.includes('request_queue_time')){status=504;body={error:'test upstream timeout'};}
      else body={status:'success',data:{resultType:'vector',result:!modelB&&query.includes('request_decode_time')?[]:[{metric:{},value:[Math.floor(Date.now()/1000),modelB?'0.234':query.includes('time_to_first')?'NaN':'0.123']}]}};
    }else if(url.pathname==='/api/prometheus/query_range'){
      // 让历史查询晚于即时卡片；卡片不应等待这条请求。
      await new Promise(resolve=>setTimeout(resolve,1500));historyReady=true;
      body={status:'success',data:{resultType:'matrix',result:[]}};
    }else throw new Error('unexpected route '+url.pathname);
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  try{
    await page.goto(process.env.CHECK_BASE_URL||'http://127.0.0.1:4175');
    await page.getByRole('button',{name:'后端',exact:true}).click();
    await page.locator('[data-metric="ttft"] .metric-value.nan').waitFor();
    assert(!historyReady,'instant cards must not wait for a slow history query');
    assert.equal(await page.locator('.metrics-grid .metric-card').count(),5);
    assert.equal(await page.locator('#model option').count(),3,'observed model labels must be deduplicated');
    assert((await page.locator('[data-metric="tpot"]').innerText()).includes('暂无样本'));
    await page.locator('[data-metric="qt"] summary').click();
    assert((await page.locator('[data-metric="qt"] details').innerText()).includes('504'));
    assert.equal(queries.length,5);
    assert(queries.every(query=>query.includes('[30m]')));
    // 新范围的旧模型 E2E 还在请求中时切换，新模型卡片不应被旧值覆盖。
    const pending=page.waitForRequest(request=>{
      const url=new URL(request.url()),query=url.searchParams.get('query')||'';
      return query.includes('model_name="model-a"')&&query.includes('[12h]')&&query.includes('e2e_request_latency');
    });
    await page.locator('#range').selectOption('43200');await pending;
    await page.locator('#model').selectOption('model-b');
    await page.waitForFunction(()=>document.querySelector('[data-metric="ttft"] .metric-value')?.textContent.includes('0.234'));
    await page.waitForTimeout(1000);
    for(const key of ['ttft','e2e','itl','tpot','qt'])assert((await page.locator(`[data-metric="${key}"] .metric-value`).innerText()).includes('0.234'));
    assert.equal(await page.locator('.metric-error').count(),0);
    assert(queries.filter(query=>query.includes('model_name="model-b"')).length===5);
    await page.locator('#range').selectOption('86400');
    await page.waitForFunction(()=>document.querySelector('[data-metric="qt"] .metric-value')?.textContent.includes('0.234'));
    const longer=queries.filter(query=>query.includes('[1d]'));
    assert.equal(longer.length,5);
    assert(longer.every(query=>query.includes('model_name="model-b"')));
    assert((await page.locator('.metrics-context').innerText()).includes('1d'));
    await page.locator('#model').selectOption('pd-model');
    await page.locator('[data-metric="ttft"] .metric-row strong.nan').waitFor();
    for(const key of ['ttft','e2e','itl','tpot','qt']){
      const card=page.locator(`[data-metric="${key}"]`);
      await card.locator('.metric-row strong.nan').waitFor();
      assert.equal(await card.locator('.metric-row').count(),2);
      assert((await card.innerText()).includes('pd-model · prefill'));
      assert((await card.innerText()).includes('pd-model · decode'));
      assert((await card.locator('.metric-row').filter({hasText:'prefill'}).innerText()).includes('2 s'));
    }
    await page.setViewportSize({width:390,height:844});
    assert(!await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth));
    // 更新模型名后重新发现；选中模型消失时切换到新名称并重新查询，空结果清空旧列表。
    await page.clock.install();
    modelNames=['model-b-v2'];await page.clock.fastForward(31000);
    await page.getByRole('button',{name:'刷新模型列表',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#model')?.value==='model-b-v2');
    await page.waitForFunction(()=>document.querySelector('[data-metric="ttft"] .metric-value')?.textContent.includes('0.234'));
    assert.equal(await page.locator('#model option').count(),1);
    assert(queries.some(query=>query.includes('model_name="model-b-v2"')));
    modelNames=[];await page.clock.fastForward(31000);
    await page.getByRole('button',{name:'刷新模型列表',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#model')?.value==='');
    assert(await page.locator('#model').isDisabled());
    assert((await page.getByRole('alert').innerText()).includes('Prometheus 未返回 vLLM 模型'));
    assert.deepEqual(errors,[]);
    console.log('PASS: five independent latency cards, selected model/window, stale-response isolation, NaN, empty values, visible partial errors, slow history isolation, PD engine means/role rows, renamed/empty model discovery and mobile width.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
