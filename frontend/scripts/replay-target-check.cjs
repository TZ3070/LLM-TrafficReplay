// All APIs are mocked. This check never sends requests to Benchmark or an inference target.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.CHECK_BASE_URL || 'http://127.0.0.1:4173';

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHECK_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1120}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const now=Math.floor(Date.now()/1000);
  const state={targets:['source-a','target-b','target-b'],targetCode:200,targetPayload:undefined,task:null,creates:[],queries:[],targetCalls:0};
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());let body,code=200;
    if(url.pathname==='/api/models'){
      state.targetCalls++;assert(!req.headers().authorization);assert(!req.headers()['x-api-key']);
      code=state.targetCode;body=code===200?state.targetPayload??{source_models:['ignored-archive-model'],target_models:state.targets}:{error:'target list unavailable'};
    }else if(url.pathname.startsWith('/api/prometheus/')){
      assert(!req.headers().authorization);
      const query=url.searchParams.get('query');state.queries.push(query);
      const model=query.includes('target-vllm')?'target-vllm':query.includes('source-c')?'source-c':'source-a';
      body=query.startsWith('count by')?{status:'success',data:{resultType:'vector',result:['source-a','source-c'].map(name=>({metric:{model_name:name},value:[now,'0']}))}}
        :url.pathname.endsWith('/query')?{status:'success',data:{resultType:'vector',result:[{metric:{model_name:model},value:[now,'0.2']}]}}
        :{status:'success',data:{resultType:'matrix',result:[{metric:{model_name:model},values:[[Number(url.searchParams.get('start')),'1'],[Number(url.searchParams.get('end')),'2']]}]}};
    }else{
      assert.equal(req.headers().authorization,'Bearer target-test');
      if(url.pathname==='/api/replays/active')body={active:!!state.task&&state.task.status==='running',task:state.task?.status==='running'?state.task:null};
      else if(req.method()==='POST'){
        const input=req.postDataJSON();state.creates.push({input,key:req.headers()['idempotency-key']});
        state.task={...input,replay_id:'separate-task',status:'running',cancellable:true,started_at:now-120,request_count:10,sent_count:5,completed_count:3,target:{metrics_labels:{model_name:'target-vllm',deployment:'optimized'}}};
        code=202;body=state.task;
      }else body=state.task;
    }
    await route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(body)});
  });
  const authenticate=async()=>{
    await page.getByRole('button',{name:'连接设置',exact:true}).click();
    await page.locator('.settings-field input').fill('Bearer target-test');
    await page.getByRole('button',{name:'应用设置',exact:true}).click();
  };
  const refresh=async()=>{
    await page.getByRole('button',{name:'刷新目标列表',exact:true}).click();
    await expect(page.getByRole('button',{name:'刷新目标列表',exact:true})).toBeEnabled();
  };
  try{
    await page.goto(base);await page.getByRole('button',{name:'后端',exact:true}).click();
    await expect(page.locator('#model')).toHaveValue('source-a');await authenticate();
    const inputs=page.locator('.selection-form input');
    await inputs.first().fill((await inputs.first().getAttribute('min')).replace(/:00$/,''));
    await inputs.last().fill((await inputs.last().getAttribute('max')).replace(/:00$/,''));
    await expect(page.getByRole('button',{name:'确认回放',exact:true})).toBeDisabled();
    assert.equal(state.targetCalls,0,'target list loads on explicit selection');
    await page.getByRole('button',{name:'选择打流目标',exact:true}).click();
    const picker=page.getByRole('dialog');
    await expect(page.locator('.target-option')).toHaveCount(2);
    await expect(picker).not.toContainText('ignored-archive-model');
    await page.getByRole('searchbox',{name:'搜索目标模型'}).fill('missing');
    await expect(page.locator('.target-empty')).toContainText('没有匹配');
    await page.getByRole('searchbox',{name:'搜索目标模型'}).fill('target');
    await page.getByRole('button',{name:'target-b',exact:true}).click();
    await expect(page.getByRole('button',{name:'确认回放',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'更换打流目标',exact:true}).click();
    state.targetCode=503;await refresh();await expect(picker.getByRole('alert')).toContainText('target list unavailable');
    state.targetCode=200;state.targets=[];await refresh();await expect(page.locator('.target-empty')).toHaveText('没有可用目标模型');
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await expect(page.getByRole('button',{name:'确认回放',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'选择打流目标',exact:true}).click();
    state.targetPayload={models:['wrong-contract']};await refresh();await expect(picker.getByRole('alert')).toContainText('target_models');
    state.targetPayload=undefined;state.targets=['target-b','target-c-with-a-long-name-that-wraps-on-a-small-screen'];await refresh();
    await page.setViewportSize({width:320,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'picker must fit 320px');
    if(process.env.CHECK_SCREENSHOT_PATH)await page.screenshot({path:process.env.CHECK_SCREENSHOT_PATH,fullPage:true});
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'Switch to English',exact:true}).click();
    await page.getByRole('button',{name:'Choose replay target',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('available targets');
    await page.getByRole('button',{name:'target-b',exact:true}).click();
    await page.getByRole('button',{name:'切换到中文',exact:true}).click();
    await page.setViewportSize({width:1440,height:1120});
    await page.getByRole('button',{name:'确认回放',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('source-a');await expect(page.getByRole('dialog')).toContainText('target-b');
    await page.getByRole('button',{name:'开始回放',exact:true}).click();
    await expect(page.locator('.replay-actions code')).toHaveText('separate-task');
    assert.deepEqual(Object.keys(state.creates[0].input).sort(),['end_time','source_model','speed','start_time','target_model']);
    assert.equal(state.creates[0].input.source_model,'source-a');assert.equal(state.creates[0].input.target_model,'target-b');assert(state.creates[0].key);
    await expect(page.locator('.replay-panel .panel-model strong')).toHaveText('source-a → target-b');
    await expect.poll(()=>state.queries.some(query=>query.includes('model_name="target-vllm"')&&query.includes('optimized'))).toBe(true);
    await page.locator('#model').selectOption('source-c');await expect(page.locator('.replay-panel .panel-model strong')).toHaveText('source-a → target-b');
    await page.reload();await authenticate();await expect(page.locator('#model')).toHaveValue('source-a');
    await expect(page.locator('.replay-panel .panel-model strong')).toHaveText('source-a → target-b');assert.equal(state.creates.length,1);
    await page.setViewportSize({width:320,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'observations must fit 320px');
    assert.deepEqual(errors,[]);
    console.log('PASS: explicit A → B selection, five-field request, target metric labels, pinned task and refresh recovery, empty/error/malformed lists, search, localization and 320px layout.');
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
