// Browser lifecycle regressions. All API requests are intercepted; no inference traffic.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173';
const proxy=process.env.CHECK_PROXY==='1';

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const errors=[];
  const contexts=[];
  const now=Math.floor(Date.now()/1000);
  const fullTask=(id,status='running')=>({replay_id:id,model_id:'lifecycle-model',source_model:'lifecycle-model',target_model:'lifecycle-model',start_time:now-1200,end_time:now-600,speed:5,status,cancellable:!['cancelling','succeeded','failed','cancelled'].includes(status),started_at:['preparing','queued'].includes(status)?undefined:now-120,finished_at:['succeeded','failed','cancelled'].includes(status)?now-10:undefined,progress:{ready:status!=='preparing',total:status==='preparing'?null:100,sent:60,completed:40},target:{metrics_labels:{model_name:'lifecycle-model'}}});
  const fixture=async()=>{
    const context=await browser.newContext({viewport:{width:1440,height:1120}});contexts.push(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const state={task:null,creates:[],cancels:0,curves:[],activeCode:200,statusCode:200,cancelEnded:false,cancelInvalid:false,createPolicy:'normal',holdPoll:false,held:false,release:undefined};
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());let body,status=200;
      if(url.pathname.startsWith('/api/prometheus/')){
        assert(!req.headers().authorization,'metrics must not receive replay credentials');
        if(url.pathname.endsWith('/query'))body={status:'success',data:{resultType:'vector',result:[{metric:url.searchParams.get('query').startsWith('count by')?{model_name:'lifecycle-model'}:{},value:[now,'1']}]}};
        else{
          const start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));
          state.curves.push({start,end});
          body={status:'success',data:{resultType:'matrix',result:[{metric:{model_name:'lifecycle-model'},values:[[start,'2'],[end,'3']]}]}};
        }
      }else{
        assert.equal(req.headers().authorization,proxy?undefined:'Bearer lifecycle-test');
        if(url.pathname==='/api/replays/active'){
          status=state.activeCode;
          body=status===200?{active:!!state.task&&!['succeeded','failed','cancelled'].includes(state.task.status),task:state.task&&!['succeeded','failed','cancelled'].includes(state.task.status)?state.task:null}:{error:'recovery unavailable'};
        }else if(url.pathname==='/api/replays'&&req.method()==='POST'){
          const input=req.postDataJSON(),key=req.headers()['idempotency-key'];state.creates.push({input,key});
          if(state.createPolicy==='conflict'){
            state.task=fullTask('other-tab');status=409;body={error:'already active',active_task:state.task};
          }else if(state.createPolicy==='lost'&&state.creates.length===1){
            state.task={...fullTask('lost-response','succeeded'),...input};status=503;body={error:'response was lost'};
          }else{
            if(state.createPolicy==='lost')status=200;
            else{status=202;state.task={...fullTask('created-'+state.creates.length),...input};}
            body=state.task;
          }
        }else if(url.pathname.endsWith('/cancel')){
          state.cancels++;
          if(state.cancelInvalid){status=409;body={error:'invalid snapshot',task:{replay_id:state.task.replay_id,status:'unknown-status'}};}
          else if(state.cancelEnded){state.task={...state.task,status:'succeeded',cancellable:false,finished_at:now};status=409;body={error:'already succeeded',task:state.task};}
          else{state.task={...state.task,status:'cancelling',cancellable:false,cancel_requested_at:now};status=202;body=state.task;}
        }else{
          status=state.statusCode;body=status===200?{...state.task}:{error:'task unavailable'};
          if(state.holdPoll&&!state.held){state.held=true;await new Promise(resolve=>state.release=resolve);}
        }
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    });
    return {page,state};
  };
  const authenticate=async page=>{
    if(proxy)return;
    await page.getByRole('button',{name:'连接设置',exact:true}).first().click();
    await page.locator('.settings-field input').fill('Bearer lifecycle-test');
    await page.getByRole('button',{name:'应用设置',exact:true}).click();
  };
  const enter=async page=>{
    await page.goto(base);
    if(await page.getByRole('button',{name:'后端',exact:true}).isEnabled())await page.getByRole('button',{name:'后端',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#model')?.value==='lifecycle-model');
    await authenticate(page);
    await expect(page.locator('.recovery-banner').filter({hasText:'正在恢复回放任务'})).toHaveCount(0);
  };
  const select=async page=>{
    const inputs=page.locator('.selection-form input');
    await inputs.first().fill(await inputs.first().getAttribute('min'));
    await inputs.last().fill(await inputs.last().getAttribute('max'));
    await page.locator('#replay-speed').selectOption('5');
  };
  const begin=async page=>{
    await expect(page.getByRole('button',{name:'确认回放',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'确认回放',exact:true}).click();
    await page.getByRole('button',{name:'开始回放',exact:true}).click();
  };
  try{
    const {page,state}=await fixture();await enter(page);await select(page);await begin(page);
    await expect(page.locator('.replay-actions code')).toHaveText('created-1');
    assert.equal(state.creates[0].input.speed,5);
    await expect(page.locator('.task-summary')).toContainText('5×');
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    const origin=state.task.started_at;
    await page.reload();
    if(!proxy){await expect(page.locator('.recovery-banner')).toContainText('请先');await authenticate(page);}
    await expect(page.locator('.replay-actions code')).toHaveText('created-1');
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    await expect.poll(()=>state.curves.filter(item=>item.start===origin).length).toBeGreaterThanOrEqual(4);
    assert.equal(state.creates.length,1,'known task reload must not POST');
    const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
    assert(!stored.includes('lifecycle-test'),'credentials must not persist');
    for(const phase of ['preparing','queued','draining','cancelling']){
      state.task=fullTask('phase-'+phase,phase);
      await page.reload();await authenticate(page);
      await expect(page.locator('.replay-actions code')).toHaveText('phase-'+phase);
      await expect(page.locator('.task-summary')).toContainText('5×');
      assert.equal(state.creates.length,1);
    }
    state.task={...state.task,status:'cancelled',finished_at:now,cancellable:false};
    await page.reload();await authenticate(page);
    await expect(page.locator('.replay-panel .badge')).toHaveText('已取消');
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    assert.equal(state.creates.length,1,'completion during reload must restore by last ID');

    state.activeCode=503;
    await page.reload();await authenticate(page);
    await expect(page.locator('.recovery-banner')).toContainText('恢复回放失败');
    await expect(page.getByRole('button',{name:'确认回放',exact:true})).toBeDisabled();
    assert.equal(state.creates.length,1);
    state.activeCode=401;
    await page.getByRole('button',{name:'重试恢复',exact:true}).click();
    await expect(page.locator('.recovery-banner')).toContainText('HTTP 401');
    await expect(page.getByRole('button',{name:'确认回放',exact:true})).toBeDisabled();
    state.activeCode=200;state.statusCode=404;
    await page.getByRole('button',{name:'重试恢复',exact:true}).click();
    await expect(page.locator('.replay-actions code')).toHaveCount(0);

    const racing=await fixture();await enter(racing.page);await select(racing.page);
    racing.state.holdPoll=true;await begin(racing.page);
    await expect.poll(()=>racing.state.held).toBe(true);
    await racing.page.getByRole('button',{name:'取消回放',exact:true}).click();
    await expect(racing.page.locator('.replay-panel .badge')).toHaveText('正在取消');
    racing.state.release();
    await expect(racing.page.locator('.replay-panel .badge')).toHaveText('正在取消');
    await racing.page.reload();await authenticate(racing.page);
    await expect(racing.page.locator('.replay-panel .badge')).toHaveText('正在取消');
    assert.equal(racing.state.cancels,1);assert.equal(racing.state.creates.length,1);

    const ended=await fixture();await enter(ended.page);await select(ended.page);await begin(ended.page);
    ended.state.cancelEnded=true;
    await ended.page.getByRole('button',{name:'取消回放',exact:true}).click();
    await expect(ended.page.locator('.replay-panel .badge')).toHaveText('已完成');

    const malformed=await fixture();await enter(malformed.page);await select(malformed.page);await begin(malformed.page);
    malformed.state.cancelInvalid=true;
    await malformed.page.getByRole('button',{name:'取消回放',exact:true}).click();
    await expect(malformed.page.locator('.error-banner')).toContainText('未知回放状态');
    await expect(malformed.page.locator('.replay-panel .badge')).toHaveText('回放中');

    const conflict=await fixture();await enter(conflict.page);await select(conflict.page);conflict.state.createPolicy='conflict';await begin(conflict.page);
    await expect(conflict.page.locator('.replay-actions code')).toHaveText('other-tab');
    await expect(conflict.page.getByRole('dialog')).toHaveCount(0);
    assert.equal(conflict.state.creates.length,1);

    const lost=await fixture();await enter(lost.page);await select(lost.page);lost.state.createPolicy='lost';await begin(lost.page);
    await expect(lost.page.getByRole('dialog')).toContainText('创建回放失败');
    const key=lost.state.creates[0].key;
    await lost.page.reload();await authenticate(lost.page);
    await expect(lost.page.getByRole('button',{name:'重试原创建请求',exact:true})).toBeEnabled();
    await lost.page.getByRole('button',{name:'重试原创建请求',exact:true}).click();
    await expect(lost.page.locator('.replay-actions code')).toHaveText('lost-response');
    assert.equal(lost.state.creates.length,2);assert.equal(lost.state.creates[1].key,key);
    assert.deepEqual(lost.state.creates[1].input,lost.state.creates[0].input);
    assert.deepEqual(errors,[]);
    console.log('PASS: 5x speed, running/preparing/queued/draining/cancelling refresh, curve reconstruction, finish during refresh, failed recovery/404, cancellation races/409, creation conflict and lost-response idempotency; auth='+ (proxy?'proxy':'manual'));
  }finally{await Promise.all(contexts.map(context=>context.close()));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
