const { chromium }=require('@playwright/test');
const assert=require('assert');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let submitted,headerKey;let promRequests=0;
  const started=Math.floor(Date.now()/1000);
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());let body;
    if(url.pathname==='/api/litellm/model/info')body={data:[{model_name:'backend-model',litellm_params:{custom_llm_provider:'vllm'}},{model_name:'other-model'}]};
    else if(url.pathname==='/api/promethues/query'){
      promRequests++;assert(!req.headers()['x-litellm-key']);
      const q=url.searchParams.get('query');body={status:'success',data:{resultType:'vector',result:[{metric:{},value:[started,q.includes('time_to_first')?'NaN':'2']}]}};
    }else if(url.pathname==='/api/promethues/query_range'){
      promRequests++;const start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));
      assert(url.searchParams.get('query').includes('model_name="backend-model"'));
      body={status:'success',data:{resultType:'matrix',result:[{metric:{model_name:'backend-model'},values:Array.from({length:61},(_,i)=>[start+(end-start)*i/60,String(i%12)])}]}};
    }else if(url.pathname==='/api/replays'&&req.method()==='POST'){
      submitted=req.postDataJSON();headerKey=req.headers()['idempotency-key'];
      body={replay_id:'backend-replay-1',status:'queued',request_count:42};
    }else if(url.pathname==='/api/replays/backend-replay-1')body={status:'running',started_at:started,request_count:42,sent_count:12,completed_count:9};
    else throw new Error('unexpected route '+url.pathname);
    await route.fulfill({status:url.pathname==='/api/replays'?202:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button',{name:'后端',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#model')?.value==='backend-model');
  await page.locator('.metric-value.nan').waitFor();
  assert((await page.locator('.metric-value.nan').innerText()).includes('NaN'));
  const box=await page.locator('.load-chart').first().boundingBox();
  await page.mouse.move(box.x+box.width*.25,box.y+100);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+100,{steps:8});await page.mouse.up();
  await page.getByRole('button',{name:'确认回放',exact:true}).click();await page.getByRole('button',{name:'开始回放',exact:true}).click();
  await page.getByText('回放中',{exact:true}).waitFor();
  assert.deepEqual(Object.keys(submitted).sort(),['end_time','model_id','start_time']);
  assert.equal(submitted.model_id,'backend-model');assert(submitted.end_time>submitted.start_time);assert(headerKey);
  assert(promRequests<=8,'single page load and replay must stay within expected request count');
  assert.deepEqual(errors,[]);
  console.log('PASS: backend mode, raw Prometheus parsing, NaN rendering, model filtering, replay body and idempotency key, task polling, request budget');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
