// 使用模拟 HTTP 响应验证进度链路，不访问 Benchmark 或真实模型。
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  let releaseCurves, releaseStatus;
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1120}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const started=Math.floor(Date.now()/1000);
    await page.clock.install({time:new Date(started*1000)});
    let task={replay_id:'progress-1',status:'preparing',sent_count:0,completed_count:0,progress:{ready:false,total:null,sent:0,completed:0}};
    let creation=task, failStatus=false, holdCurves=true, holdStatus=false;
    let statusCalls=0, replayCurveCalls=0, zeroStatusCalls=0;
    const curveGate=new Promise(resolve=>releaseCurves=resolve);
    const statusGate=new Promise(resolve=>releaseStatus=resolve);
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      let response,status=200;
      if(url.pathname.startsWith('/api/prometheus/')) {
        assert(!request.headers().authorization,'metrics must not receive the Benchmark token');
        assert(!request.headers()['x-litellm-key']);
        if(url.pathname.endsWith('/query')) {
          const query=url.searchParams.get('query');
          response={status:'success',data:{resultType:'vector',result:[{metric:query.startsWith('count by')?{model_name:'benchmark-model'}:{},value:[started,'1']}]}};
        } else {
          const start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));
          if(start===started&&/num_requests_(running|waiting)/.test(url.searchParams.get('query')||'')) {
            replayCurveCalls++;
            if(holdCurves)await curveGate;
          }
          response={status:'success',data:{resultType:'matrix',result:[{metric:{model_name:'benchmark-model'},values:[[start,'2'],[end,'3']]}]}};
        }
      } else if(url.pathname==='/api/models') {
        response={target_models:['benchmark-model']};
      } else {
        assert.equal(request.headers().authorization,'Bearer test-benchmark-key');
        if(url.pathname==='/api/replays/active') {response={active:false,task:null};}
        else if(request.method()==='POST') {
          assert.equal(url.pathname,'/api/replays');
          assert.deepEqual(Object.keys(request.postDataJSON()).sort(),['end_time','source_model','speed','start_time','target_model']);
          assert(request.headers()['idempotency-key']);
          status=202;response=creation;
        } else {
          statusCalls++;
          if(url.pathname.endsWith('/empty-task'))zeroStatusCalls++;
          if(holdStatus)await statusGate;
          if(failStatus) {status=503;response={error:'Temporary status failure'};}
          else response=task;
        }
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(response)});
    });
    await page.goto(process.env.CHECK_BASE_URL||'http://127.0.0.1:4173');
    await page.getByRole('button',{name:'后端',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#model')?.value==='benchmark-model');
    await page.getByRole('button',{name:'连接设置',exact:true}).click();
    assert.equal(await page.locator('.settings-field select').inputValue(),'Authorization');
    await page.locator('.settings-field input').fill('Bearer test-benchmark-key');
    await page.getByRole('button',{name:'应用设置',exact:true}).click();
    const inputs=page.locator('.selection-form input');
    await inputs.first().fill(await inputs.first().getAttribute('min'));
    await inputs.last().fill(await inputs.last().getAttribute('max'));
    await page.getByRole('button',{name:'选择打流目标',exact:true}).click();
    await page.locator('.target-option').first().click();
    const begin=async()=>{
      await page.getByRole('button',{name:'确认回放',exact:true}).click();
      await page.getByRole('button',{name:'开始回放',exact:true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await begin();
    const count=page.locator('.replay-progress-count');
    const percent=page.locator('.replay-progress-percent');
    const progress=page.getByRole('progressbar');
    await expect(count).toHaveText('统计中…');
    await expect(progress).not.toHaveAttribute('aria-valuenow');
    assert.equal(replayCurveCalls,0);

    task={...task,status:'queued',progress:{ready:true,total:1200,sent:0,completed:0}};
    await page.clock.runFor(2000);
    await expect(count).toHaveText('0 / 1,200');
    await expect(percent).toHaveText('0%');
    await expect(page.locator('.waiting-replay')).toContainText('已准备 1,200 个请求');
    assert.equal(replayCurveCalls,0,'known totals must be shown before metrics start');

    task={...task,status:'running',started_at:started,progress:{ready:true,total:1200,sent:600,completed:560}};
    await page.clock.runFor(2000);
    await expect(count).toHaveText('560 / 1,200');
    await expect(percent).toHaveText('46.7%');
    await expect.poll(()=>replayCurveCalls).toBe(2);
    task={...task,progress:{ready:true,total:1200,sent:700,completed:600}};
    await page.clock.runFor(2000);
    await expect(count).toHaveText('600 / 1,200');
    assert.equal(replayCurveCalls,2,'fast status polls must not refresh metrics');
    assert.equal(await page.locator('.replay-panel .load-chart').count(),0,'progress must update while curves are still pending');
    if(process.env.CHECK_SCREENSHOT_PATH)await page.screenshot({path:process.env.CHECK_SCREENSHOT_PATH,fullPage:true});

    const updated=await page.locator('.replay-progress-details').innerText();
    failStatus=true;
    await page.clock.runFor(2000);
    await expect(page.locator('.replay-progress-hint')).toContainText('状态更新暂时失败');
    await expect(count).toHaveText('600 / 1,200');
    const lastTime=updated.match(/\d{2}:\d{2}:\d{2}/)[0];
    await expect(page.locator('.replay-progress-details')).toContainText(lastTime);
    await page.getByRole('button',{name:'Switch to English'}).click();
    await expect(page.locator('.replay-progress-hint')).toContainText('Showing the last received data');
    await page.getByRole('button',{name:'切换到中文'}).click();
    failStatus=false;
    task={...task,status:'cancelling',progress:{ready:true,total:1200,sent:1200,completed:950}};
    await page.clock.runFor(5000);
    await expect(page.locator('.replay-panel .badge')).toHaveText('正在取消');
    await expect(count).toHaveText('950 / 1,200');
    holdCurves=false;releaseCurves();
    await expect(page.locator('.replay-panel .load-chart')).toHaveCount(1);
    task={...task,status:'failed',finished_at:started+15,failed_count:12,error:'12 request(s) failed',progress:{ready:true,total:1200,sent:1200,completed:1200}};
    await page.clock.runFor(2000);
    await expect(count).toHaveText('1,200 / 1,200');
    await expect(percent).toHaveText('100%');
    await expect(page.locator('.replay-panel .badge')).toHaveText('失败');
    await expect(page.locator('.replay-progress-failed')).toHaveText('失败 12 个');
    await expect(page.locator('.replay-progress-error')).toContainText('12 request(s) failed');
    const finalCalls=statusCalls;
    await page.clock.runFor(6000);
    assert.equal(statusCalls,finalCalls,'terminal tasks must stop status polling');

    creation={replay_id:'empty-task',status:'failed',request_count:0,sent_count:0,completed_count:0,error:'No replayable requests'};
    await begin();
    await expect(count).toHaveText('0 / 0');
    await expect(percent).toHaveText('—');
    await expect(page.locator('.waiting-replay')).toContainText('此选区没有可回放请求');
    await page.clock.runFor(4000);
    assert.equal(zeroStatusCalls,0,'failure before sending must stop without inventing a start time');

    holdStatus=true;
    creation={replay_id:'creation-counts',status:'running',started_at:started,request_count:42,sent_count:12,completed_count:9};
    task={...creation};
    await begin();
    await expect(count).toHaveText('9 / 42');
    await expect(percent).toHaveText('21.4%');
    task={...task,status:'cancelled',finished_at:started+25};
    holdStatus=false;releaseStatus();
    await expect(page.locator('.replay-panel .badge')).toHaveText('已取消');
    await expect(count).toHaveText('9 / 42');
    await page.setViewportSize({width:320,height:844});
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'progress layout must fit a 320px screen');
    assert.deepEqual(errors,[]);
    console.log('PASS: Bearer authentication, creation counts, preparation/zero totals, 2s progress independent of slow curves, last snapshot on failure, English labels, cancelling, failed 100%, terminal stop, cancellation progress and 320px layout');
  } finally {
    releaseCurves?.();releaseStatus?.();
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
