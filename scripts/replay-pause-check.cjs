// Browser control regressions. All HTTP responses are mocked; no inference traffic.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173';

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const errors=[];
  let releasePoll,releaseControl;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    page.on('pageerror',error=>errors.push(error.message));
    const now=Math.floor(Date.now()/1000);
    await page.clock.install({time:new Date(now*1000)});
    let task={replay_id:'pause-1',status:'running',revision:1,model_id:'pause-model',source_model:'pause-model',target_model:'pause-model',start_time:now-1200,end_time:now-600,started_at:now-120,speed:2,cancellable:true,pausable:true,resumable:false,paused_at:null,paused_seconds:0,request_count:10,sent_count:5,completed_count:2};
    const actions=[],curves=[];
    let holdPoll=false,held=false,failControl=false,holdControl=false,conflict=false,statusCalls=0;
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());let body,status=200;
      if(url.pathname.startsWith('/api/prometheus/')){
        assert(!request.headers().authorization);
        if(url.pathname.endsWith('/query'))body={status:'success',data:{resultType:'vector',result:[{metric:{model_name:'pause-model'},value:[now,'1']}]}};
        else{
          const start=+url.searchParams.get('start'),end=+url.searchParams.get('end');
          curves.push({start,end});
          body={status:'success',data:{resultType:'matrix',result:[{metric:{model_name:'pause-model'},values:[[start,'2'],[end,'3']]}]}};
        }
      }else{
        assert.equal(request.headers().authorization,'Bearer pause-test');
        if(url.pathname==='/api/replays/active')body={active:!['cancelled','succeeded','failed'].includes(task.status),task:!['cancelled','succeeded','failed'].includes(task.status)?task:null};
        else if(request.method()==='POST'){
          actions.push(url.pathname);
          if(holdControl)await new Promise(resolve=>releaseControl=resolve);
          if(failControl){status=503;body={error:'control unavailable'};}
          else if(conflict){task={...task,status:'draining',sent_count:10,revision:task.revision+1,pausable:false,resumable:false};status=409;body={error:'dispatch already finished',task};}
          else{
            const action=url.pathname.split('/').at(-1);
            assert(['pause','resume','cancel'].includes(action),'refresh must not create a task');
            task={...task,revision:task.revision+1};
            if(action==='pause')task={...task,status:'paused',paused_at:now,pausable:false,resumable:true};
            if(action==='resume')task={...task,status:'running',paused_at:null,paused_seconds:12,pausable:true,resumable:false};
            if(action==='cancel'){task={...task,status:'cancelling',cancellable:false,pausable:false,resumable:false,cancel_requested_at:now};status=202;}
            body=task;
          }
        }else{
          statusCalls++;body={...task};
          if(holdPoll&&!held){held=true;await new Promise(resolve=>releasePoll=resolve);}
        }
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    });
    const authenticate=async()=>{
      await page.getByRole('button',{name:'连接设置',exact:true}).first().click();
      await page.locator('.settings-field input').fill('Bearer pause-test');
      await page.getByRole('button',{name:'应用设置',exact:true}).click();
    };
    const pause=()=>page.getByRole('button',{name:'暂停回放',exact:true});
    const resume=()=>page.getByRole('button',{name:'继续回放',exact:true});
    const cancel=()=>page.getByRole('button',{name:'取消回放',exact:true});
    const badge=page.locator('.replay-panel .badge');
    const count=page.locator('.replay-progress-count');
    await page.goto(base);
    await page.getByRole('button',{name:'后端',exact:true}).click();
    await authenticate();
    await expect(pause()).toBeEnabled();
    await expect(count).toHaveText('2 / 10');
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);

    holdPoll=true;
    await page.clock.runFor(2000);
    await expect.poll(()=>held).toBe(true);
    holdControl=true;
    await pause().click();
    await expect(page.getByRole('button',{name:'正在提交暂停…',exact:true})).toBeDisabled();
    await expect(cancel()).toBeDisabled();
    holdControl=false;releaseControl();
    await expect(badge).toHaveText('已暂停');
    await expect(resume()).toBeEnabled();
    releasePoll();holdPoll=false;
    await expect(badge).toHaveText('已暂停');
    task={...task,completed_count:5,revision:task.revision+1};
    const oldCurves=curves.filter(value=>value.start===task.started_at).length;
    await page.clock.runFor(31000);
    await expect(count).toHaveText('5 / 10');
    assert(curves.filter(value=>value.start===task.started_at).length>oldCurves,'paused tasks must still query metrics');
    assert.equal(actions.length,1);

    await page.reload();await authenticate();
    await expect(badge).toHaveText('已暂停');
    await expect(resume()).toBeEnabled();
    await expect(page.locator('.replay-actions code')).toHaveText('pause-1');
    assert.equal(actions.length,1,'reload must only recover, not resume or create');
    assert(!await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('pause-test')));
    failControl=true;await resume().click();
    await expect(page.getByRole('alert').filter({hasText:'继续回放失败'})).toHaveCount(1);
    await expect(badge).toHaveText('已暂停');
    await expect(resume()).toBeEnabled();
    failControl=false;await resume().click();
    await expect(badge).toHaveText('回放中');
    await expect(pause()).toBeEnabled();
    await pause().click();
    await expect(badge).toHaveText('已暂停');
    await cancel().click();
    await expect(badge).toHaveText('正在取消');
    await expect(pause()).toBeDisabled();
    task={...task,status:'cancelled',finished_at:now,revision:task.revision+1};
    await page.clock.runFor(2000);
    await expect(badge).toHaveText('已取消');
    await expect(count).toHaveText('5 / 10');
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    const polls=statusCalls;
    await page.clock.runFor(5000);
    assert.equal(statusCalls,polls,'terminal cancellation must stop status polling');

    task={...task,replay_id:'pause-2',status:'running',revision:20,cancellable:true,pausable:true,resumable:false,finished_at:undefined};
    await page.reload();await authenticate();
    conflict=true;await pause().click();
    await expect(badge).toHaveText('等待处理完成');
    await expect(pause()).toBeDisabled();
    conflict=false;
    task={...task,status:'running',revision:21,pausable:undefined,resumable:undefined};
    await page.reload();await authenticate();
    await expect(pause()).toBeDisabled();
    await expect(page.locator('.replay-caption').filter({hasText:'当前后端未提供暂停能力'})).toHaveCount(1);
    task={...task,pausable:true,resumable:false,revision:22};
    await page.clock.runFor(2000);
    await expect(pause()).toBeEnabled();
    await pause().click();
    await page.setViewportSize({width:320,height:1000});
    fs.mkdirSync('test-results',{recursive:true});
    await page.screenshot({path:'test-results/replay-paused-mobile.png',fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile layout overflow');
    await page.getByRole('button',{name:'Switch to English',exact:true}).click();
    await expect(page.getByRole('button',{name:'Resume replay',exact:true})).toBeEnabled();

    const demo=await browser.newPage({viewport:{width:1440,height:1100}});
    demo.on('pageerror',error=>errors.push(error.message));
    await demo.clock.install({time:new Date(now*1000)});
    await demo.goto(base);
    const inputs=demo.locator('.selection-form input');
    await inputs.first().fill((await inputs.first().getAttribute('min')).replace(/:00$/,''));
    await inputs.last().fill((await inputs.last().getAttribute('max')).replace(/:00$/,''));
    await demo.getByRole('button',{name:'确认回放',exact:true}).click();
    await demo.getByRole('button',{name:'开始回放',exact:true}).click();
    await expect(demo.getByRole('button',{name:'暂停回放',exact:true})).toBeEnabled();
    await demo.clock.runFor(6000);
    await demo.getByRole('button',{name:'暂停回放',exact:true}).click();
    const demoCount=await demo.locator('.replay-progress-count').textContent();
    await demo.clock.runFor(12000);
    await expect(demo.locator('.replay-progress-count')).toHaveText(demoCount);
    await demo.getByRole('button',{name:'继续回放',exact:true}).click();
    await demo.clock.runFor(6000);
    await expect(demo.locator('.replay-progress-count')).not.toHaveText(demoCount);
    await demo.getByRole('button',{name:'取消回放',exact:true}).click();
    await demo.clock.runFor(3000);
    await expect(demo.locator('.replay-panel .badge')).toHaveText('已取消');
    assert.deepEqual(errors,[]);
    console.log('PASS: pause/resume requests, stale polls, busy controls, in-flight progress, paused metrics, reload, errors/conflicts, paused cancellation, legacy capability, mobile, English and demo controls');
  }finally{
    releasePoll?.();releaseControl?.();await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
