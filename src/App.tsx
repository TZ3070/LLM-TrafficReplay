import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Check, Clock3, Database, Layers3, LoaderCircle, Play, Radio, RefreshCw, Settings2, Terminal, Timer, X, Zap } from 'lucide-react';
import LoadChart from './LoadChart';
import { relativeTimeUnit } from './chartTime';
import { DISPLAY_TIME_ZONE, clock, dateTime, fullDateTime, toInput, fromInput } from './time';
import { adaptModels, ApiError, demoLoad, demoModels, emptyMetrics, fetchLoad, fetchMetrics, formatValue, queryTiming, request } from './data';
import type { LoadData, Metrics, Model, Replay, TimeRange } from './types';
import { createApiConfig } from './apiConfig';
/**
 * 页面编排层：负责选择条件、网络查询、回放任务和组件数据之间的流转。
 * 历史：模型配置 → 当前模型/时间范围 → fetchLoad → history → 左侧 LoadChart。
 * 回放：selection → POST → replay_id → GET 状态 → 实际时间/标签
 *      → fetchLoad → replayData → 右侧 LoadChart。
 * 完整请求的检索和重新发送在后端执行；本页只提交回放条件并观测指标。
 */
const EMPTY: LoadData = { running:[],waiting:[],errors:[] };
const API = createApiConfig(import.meta.env);
// 路径由构建时环境配置覆盖；回放接口为待与真实后端联调的契约。
const CREATE = import.meta.env.VITE_REPLAY_CREATE_PATH || '/api/replays';
const STATUS = import.meta.env.VITE_REPLAY_STATUS_PATH || '/api/replays/{id}';
const statusNames: Record<Replay['status'],string> = {queued:'等待开始',preparing:'准备请求',running:'回放中',draining:'等待处理完成',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
function maxLoad(a: LoadData,b: LoadData) { const numbers=[...a.running,...a.waiting,...b.running,...b.waiting].flatMap(s=>s.points.map(p=>p.value)).filter((v):v is number=>v!==undefined&&Number.isFinite(v));return numbers.length?Math.max(10,Math.ceil(Math.max(...numbers)*1.15/10)*10):undefined; }

export default function App() {
  // 数据源切换：demo 完全在浏览器生成数据；backend 请求现有看板后端。
  const [mode,setMode]=useState<'demo'|'backend'>('demo');
  const [models,setModels]=useState<Model[]>(demoModels);
  const [modelMode,setModelMode]=useState<'demo'|'backend'>(); // 标记模型列表所属数据源，防止切换时拿旧模型查询新后端。
  const [modelId,setModelId]=useState(demoModels[0].id);
  const model=models.find(m=>m.id===modelId);
  // range 是历史查询窗口；selection 是其中准备回放的子区间，两者都使用 Unix 秒。
  const [seconds,setSeconds]=useState(1800);
  const [historyEnd,setHistoryEnd]=useState<number>();
  const [range,setRange]=useState<TimeRange>(()=>{const t=queryTiming(1800);return {start:t.start,end:t.end};});
  const [selection,setSelection]=useState<TimeRange>();
  const [history,setHistory]=useState<LoadData>(EMPTY); // matrix 解析结果，仅供历史窗口。
  const [metrics,setMetrics]=useState<Metrics>(emptyMetrics);
  const [loading,setLoading]=useState(false);
  const [refreshToken,setRefreshToken]=useState(0);
  const [updatedAt,setUpdatedAt]=useState<number>();
  const [error,setError]=useState('');
  // 任务保存创建时的模型和选区，独立于当前下拉框；右侧数据使用任务自身的查询上下文。
  const [replay,setReplay]=useState<Replay>();
  const [replayData,setReplayData]=useState<LoadData>(EMPTY);
  const [replayRange,setReplayRange]=useState<TimeRange>();
  const [confirmOpen,setConfirmOpen]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [apiKey,setApiKey]=useState(''); // 仅内存保存，由调用方显式传给模型/回放接口。
  const [authHeader,setAuthHeader]=useState<'x-litellm-key'|'x-api-key'|'Authorization'>('x-litellm-key');
  const [settingsToken,setSettingsToken]=useState(0);
  const [relative,setRelative]=useState(false); // 只控制横轴展示，不改变查询边界或打流速度。
  const operation=useRef<{ signature:string; key:string }>();
  const sending=useRef(false);
  // 定时查询读取最新选区，避免每次拖动都重建查询 effect 或立即发起 HTTP 请求。
  const selectionRef=useRef(selection); selectionRef.current=selection;
  const active=!!replay&&!['succeeded','failed','cancelled'].includes(replay.status);
  const validSelection=!!selection&&selection.start>=range.start&&selection.end<=range.end&&selection.end>selection.start;
  // 模型入口：后端模式从 LiteLLM 透传接口读取，经 adaptModels 转为下拉项。
  // live 用于忽略切换数据源/卸载后到达的旧响应，不是网络请求取消器。
  useEffect(()=>{
    let live=true;
    setError('');setSelection(undefined);setReplay(undefined);setReplayData(EMPTY);setMetrics(emptyMetrics);setModels([]);setModelId('');setModelMode(undefined);
    if(mode==='demo'){setModels(demoModels);setModelId(demoModels[0].id);setModelMode('demo');return;}
    request(API.modelInfoPath,{}, {apiKey,authHeader}).then(raw=>{
      if(!live)return;const list=adaptModels(raw,API.modelMetricsMap);if(!list.length)throw new Error('未找到可选模型，请检查模型配置响应中的 model_name 字段');setModels(list);setModelId(list[0].id);setModelMode('backend');
    }).catch(e=>{if(live)setError(`模型加载失败：${e.message}`);});
    return()=>{live=false;};
  // 凭据保存在内存中，仅点击应用时重新加载。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mode,settingsToken]);
  // 查询左侧历史曲线和顶部即时卡片；成功结果分别进入 history / metrics。
  useEffect(()=>{
    if(!model||modelMode!==mode)return;
    let live=true;let timer:number|undefined;let busy=false;
    const load=async()=>{
      if(busy||document.hidden)return;
      busy=true;setLoading(true);setError('');
      let next=range;
      // 无选区时按截止时间计算窗口；有选区时保留原窗口，避免自动刷新移动已选边界。
      if(!selectionRef.current){const t=queryTiming(seconds,historyEnd);next={start:t.start,end:t.end};setRange(next);}
      try {
        const load=mode==='demo'?demoLoad(model.id,next):await fetchLoad(model.metricsName||model.name,next,undefined,API);
        if(live){setHistory(load);setUpdatedAt(Math.floor(Date.now()/1000));}
        // 卡片读取当前 query，与历史 query_range 分开；演示分支是固定示例值。
        const cardData=mode==='demo'?{ttft:{value:.186},e2e:{value:3.42},throughput:{value:846.5},cache:{value:.724}}:await fetchMetrics(model.metricsName||model.name,API);
        if(live)setMetrics(cardData);
      }catch(e){if(live)setError((e as Error).message);}finally{busy=false;if(live)setLoading(false);}
    };
    // 仅“截止到现在”的窗口定时更新；指定历史截止时间后通过手动刷新重新查询。
    void load();if(historyEnd===undefined)timer=window.setInterval(()=>void load(),30000);
    const visible=()=>{if(!document.hidden)void load();};document.addEventListener('visibilitychange',visible);
    return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  // 选区固定历史窗口，不将 range 放入依赖引起重复请求。
  },[mode,modelMode,modelId,seconds,historyEnd,refreshToken]);
  // 右侧独立数据链：先查询任务状态，再用真实打流时间查询 Prometheus。
  // 依赖任务 ID，而不是 modelId；切换左侧模型不影响本次回放观测。
  useEffect(()=>{
    if(!replay)return;
    const id=replay.id;let live=true,busy=false;let backoffUntil=0;let metricsSettled=false;
    const poll=async()=>{
      if(busy||document.hidden||Date.now()<backoffUntil||metricsSettled)return;
      busy=true;
      try {
        let current=replay;
        if(mode==='demo'){
          // 仅演示：45 秒自动完成，计数也是估算值，与所选历史区间长度无关。
          // 生产分支必须以状态接口结果为准，不使用此计时规则判断任务完成。
          const elapsed=Math.max(0,Math.floor(Date.now()/1000)-(replay.startedAt??0));
          current={...replay,status:elapsed>=45?'succeeded':'running',sentCount:Math.min(replay.requestCount??0,Math.floor((replay.requestCount??0)*elapsed/40)),completedCount:Math.min(replay.requestCount??0,Math.floor((replay.requestCount??0)*elapsed/45)),finishedAt:elapsed>=45?(replay.startedAt??0)+45:undefined};
        } else {
          try {
            // 后端任务库 → status/started_at/finished_at/计数 → 本页 Replay 状态。
            const raw=await request(STATUS.replace('{id}',encodeURIComponent(id)),{}, {apiKey,authHeader});
            if(!Object.hasOwn(statusNames,raw.status))throw new Error('未知回放状态');
            current={...replay,status:raw.status,startedAt:raw.started_at,finishedAt:raw.finished_at,requestCount:raw.request_count,sentCount:raw.sent_count,completedCount:raw.completed_count,statusError:undefined,metricsLabels:raw.target?.metrics_labels||replay.metricsLabels};
          } catch(e) {
            current={...replay,statusError:`任务状态查询失败：${(e as Error).message}`};
            if(e instanceof ApiError&&e.status===429)backoffUntil=Date.now()+60000;
          }
        }
        if(live)setReplay(current);
        // 尚未收到实际打流起点时只展示等待状态，不拿按钮点击时间冒充 started_at。
        if(!current.startedAt)return;
        const start=current.startedAt;
        // 起点固定，运行时终点随现在增长；结束后留 30s 尾部，供处理/等待曲线观测。
        // 初始至少展示 30s：真实查询的未来部分应为空；demoLoad 会生成满窗口模拟点。
        const end=current.finishedAt?current.finishedAt+30:Math.max(start+30,Math.floor(Date.now()/1000));
        const window={start,end};
        // 与历史图共用 fetchLoad，但标签和时间来自回放任务；不是读取原历史区间。
        const data=mode==='demo'?demoLoad(current.modelId,window,true):await fetchLoad(current.metricsName,window,current.metricsLabels,API);
        if(live){setReplayRange(window);setReplayData(data);}
        // 后端报告完成后再等待采集/缓存延迟，并在一次无查询错误的结果后停止轮询。
        // 这是前端刷新停止条件，不证明档案完整，也不是通过折线推断任务成功。
        if(current.finishedAt && Math.floor(Date.now()/1000)>current.finishedAt+60 && data.errors.length===0)metricsSettled=true;
      }catch(e){if(live)setReplay(r=>r?.id===id?{...r,statusError:(e as Error).message}:r);}finally{busy=false;}
    };
    // 演示每 3s 更新，生产每 30s 更新，以配合后端缓存和共享限流。
    void poll();const timer=setInterval(()=>void poll(),mode==='demo'?3000:30000);
    return()=>{live=false;clearInterval(timer);};
  },[replay?.id,mode]);
  // 新模型需要重新选历史区间，但已创建的 replay 和 replayData 不清空。
  const chooseModel=(id:string)=>{setModelId(id);setSelection(undefined);setHistory(EMPTY);setMetrics(emptyMetrics);};
  const chooseTime=(duration:number)=>{setSeconds(duration);setSelection(undefined);};
  // 图表刷选只更新本地状态；真正 POST 要等用户在确认框中点击“开始回放”。
  const select=useCallback((s:TimeRange)=>setSelection(s),[]);
  const beginReplay=async()=>{
    if(!model||!selection||!validSelection||sending.current)return;
    sending.current=true;
    setSubmitting(true);setError('');
    try {
      // 浏览器 → 后端：只传逻辑模型与 [start,end)；请求档案、目标路由和原速调度由后端处理。
      const body={model_id:model.id,start_time:selection.start,end_time:selection.end};
      const signature=JSON.stringify(body);
      // 相同条件失败重试复用幂等键；后端需支持该头才能避免超时重试导致重复打流。
      if(operation.current?.signature!==signature)operation.current={signature,key:crypto.randomUUID()};
      const raw=mode==='demo'?{replay_id:`demo-${Date.now()}`,status:'running',started_at:Math.floor(Date.now()/1000),request_count:Math.round((selection.end-selection.start)*2.8)}:await request(CREATE,{method:'POST',headers:{'Idempotency-Key':operation.current.key},body:signature},{apiKey,authHeader});
      if(typeof raw.replay_id!=='string')throw new Error('创建回放响应缺少 replay_id，请确认后端契约');
      // 创建响应只建立任务上下文，不含折线或完整请求；新任务 ID 随后触发右侧轮询。
      setReplay({id:raw.replay_id,modelId:model.id,modelName:model.name,metricsName:model.metricsName||model.name,source:{...selection},status:Object.hasOwn(statusNames,raw.status)?raw.status:'queued',startedAt:raw.started_at,requestCount:raw.request_count,metricsLabels:raw.target?.metrics_labels});
      setReplayRange(undefined);setReplayData(EMPTY);setConfirmOpen(false);operation.current=undefined;
    }catch(e){setError(`创建回放失败：${(e as Error).message}`);}finally{setSubmitting(false);sending.current=false;}
  };
  const changeInput=(key:'start'|'end',value:string)=>{
    // 上海本地时间文本 → Unix 秒；结果与图表拖拽一样流入 selection。
    const timestamp=fromInput(value);if(!Number.isFinite(timestamp))return;
    setSelection(s=>({...s??{start:range.start,end:range.end},[key]:timestamp}));
  };
  // 两个窗口使用同一纵轴上限，避免缩放差异被误当作负载改善。
  const sharedMax=maxLoad(history,replayData);
  const cards=[
    {key:'ttft' as const,label:'首 TOKEN 延迟',unit:'s',icon:Timer,note:'Time to first token'},
    {key:'e2e' as const,label:'端到端延迟',unit:'s',icon:Clock3,note:'End-to-end latency'},
    {key:'throughput' as const,label:'输出吞吐',unit:'tokens/s',icon:Zap,note:'Generation throughput'},
    {key:'cache' as const,label:'前缀缓存命中率',unit:'%',icon:Database,note:'Prefix cache hit rate'}
  ];
  return <div className="app-shell">
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace</div><div className="header-right"><span className={`connection ${mode==='demo'?'demo':''}`}><i/>{mode==='demo'?'演示数据':'后端模式'}</span><button className="icon-button" aria-label="连接设置" onClick={()=>setSettingsOpen(true)}><Settings2 size={18}/></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">LLM TRAFFIC REPLAY</div><h1>TrafficReplay</h1><p>回放历史请求，观察模型负载与排队变化，验证优化效果。</p></div><div className="heading-actions"><span className="refresh-note"><Radio size={13}/> 每 30s 更新</span><button className="button secondary" disabled={loading} onClick={()=>setRefreshToken(x=>x+1)}><RefreshCw size={14} className={loading?'spin':''}/>刷新指标</button></div></div>
        <section className="filters" aria-label="查询设置">
          <div className="field model-field"><label htmlFor="model">查询模型</label><div className="select-wrap"><Layers3 size={16}/><select id="model" value={modelId} onChange={e=>chooseModel(e.target.value)} disabled={!models.length}>{!models.length&&<option value="">等待模型配置</option>}{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div></div>
          <div className="field"><label htmlFor="range">历史查询范围</label><select id="range" value={seconds} onChange={e=>chooseTime(Number(e.target.value))}><option value={900}>最近 15 分钟</option><option value={1800}>最近 30 分钟</option><option value={3600}>最近 1 小时</option><option value={21600}>最近 6 小时</option><option value={43200}>最近 12 小时</option><option value={86400}>最近 24 小时</option><option value={604800}>最近 7 天</option></select></div>
          <div className="field history-end"><label htmlFor="history-end">截止时间 <button className="text-action" onClick={()=>{setHistoryEnd(undefined);setSelection(undefined);}}>现在</button></label><input id="history-end" type="datetime-local" step="1" value={toInput(historyEnd??range.end)} onChange={e=>{const end=fromInput(e.target.value);if(Number.isFinite(end)){setHistoryEnd(end);setSelection(undefined);}}}/></div>
          <div className="filter-meta"><span className="model-tag">{model?.provider||'MODEL'}</span><span>{selection?'历史窗口已固定':`约 60 个采样点 · ${queryTiming(seconds).step}s 步长`}</span></div>
          <div className="mode-switch" aria-label="数据源"><button className={mode==='demo'?'selected':''} onClick={()=>setMode('demo')} disabled={active}>演示</button><button className={mode==='backend'?'selected':''} onClick={()=>setMode('backend')} disabled={active}>后端</button></div>
        </section>
        {error&&<div className="error-banner" role="alert">{error}<button aria-label="关闭错误" onClick={()=>setError('')}><X size={15}/></button></div>}
        <div className="metrics-grid">{cards.map(({key,label,unit,icon:Icon,note})=>{
          const m=metrics[key],value=key==='cache'&&m.value!==undefined?m.value*100:m.value;
          return <section className="metric-card" key={key}><div className="metric-label">{label}<Icon size={16}/></div><div className={`metric-value ${Number.isNaN(value)?'nan':''}`}>{formatValue(value)}<span>{unit}</span></div><div className="metric-sub" title={m.error}>{m.error?'查询失败 · 当前无数据':note}</div></section>;
        })}</div>
        <div className="section-title"><div><h2>流量实验</h2><span>TRAFFIC REPLAY</span></div><span className="section-hint">历史流量 → 当前模型部署</span></div>
        <div className="charts-grid">
          <section className="chart-panel">
            <div className="panel-header"><div><span className="panel-index">01</span><h3>历史流量</h3></div><span className="badge neutral">{selection?'已固定':'历史查询'}</span></div>
            <div className="panel-model"><strong>{model?.name||'尚未选择模型'}</strong><span>{dateTime(range.start)} — {range.end-range.start>=86400?dateTime(range.end):clock(range.end)}</span></div>
            <div className="chart-toolbar"><span className="legend"><i className="purple"/>正在处理<i className="teal"/>等待处理</span><span className="drag-hint">横向拖动选择区间</span></div>
            <LoadChart data={history} range={range} selection={selection} onSelect={select} selectable max={sharedMax}/>
            {history.errors.length>0&&<div className="chart-error" role="alert">{history.errors.join('；')}</div>}
            {!loading&&!history.running.length&&!history.waiting.length&&<div className="empty-line">此时间范围暂无指标数据</div>}
            <div className="selection-form">
              <div className="selection-title"><span><span className="selection-dot"/>回放时间区间</span>{selection&&<button onClick={()=>setSelection(undefined)}>清除选区</button>}</div>
              <div className="time-inputs"><label>开始时间<input type="datetime-local" step="1" value={selection?toInput(selection.start):''} min={toInput(range.start)} max={toInput(range.end)} onChange={e=>changeInput('start',e.target.value)}/></label><span className="time-arrow">→</span><label>结束时间<input type="datetime-local" step="1" value={selection?toInput(selection.end):''} min={toInput(range.start)} max={toInput(range.end)} onChange={e=>changeInput('end',e.target.value)}/></label></div>
              <div className="selection-footer"><span>{selection?validSelection?`已选择 ${Math.floor((selection.end-selection.start)/60)} 分 ${Math.round((selection.end-selection.start)%60)} 秒`:'请选择窗口内有效的开始与结束时间':'在折线图中拖动，或输入时间'}<small>时间范围包含起点，不包含终点</small></span><button className="button primary" onClick={()=>setConfirmOpen(true)} disabled={!validSelection||active||submitting}><Play size={14}/>{active?'回放进行中':'确认回放'}</button></div>
            </div>
          </section>
          <section className={`chart-panel replay-panel ${!replay?'no-replay':''}`}>
            <div className="panel-header"><div><span className="panel-index">02</span><h3>回放观测</h3></div><span className={`badge ${active?'live':'neutral'}`}>{active&&<i/>}{replay?statusNames[replay.status]:'等待回放'}</span></div>
            <div className="panel-model"><strong>{replay?.modelName||'等待创建回放任务'}</strong><span>{replay?.startedAt?`${dateTime(replay.startedAt)} 开始`:'回放开始后自动获取模型曲线'}</span></div>
            {replay&&<><div className="chart-toolbar"><span className="legend"><i className="purple"/>正在处理<i className="teal"/>等待处理</span><label className="relative"><input type="checkbox" checked={relative} onChange={e=>setRelative(e.target.checked)}/>相对时间{relative&&replayRange?`（${relativeTimeUnit(replayRange.end-replayRange.start)}）`:''}</label></div>{replayRange?<LoadChart data={replayData} range={replayRange} relativeOrigin={relative?replay.startedAt:undefined} max={sharedMax}/>:<div className="waiting-replay"><LoaderCircle size={24} className="spin"/><p>等待实际打流开始时间</p></div>}{replayData.errors.length>0&&<div className="chart-error">{replayData.errors.join('；')}</div>}{replay.statusError&&<div className="chart-error" role="alert">{replay.statusError}</div>}<div className="task-summary"><div><span>历史区间</span><strong>{clock(replay.source.start)} — {clock(replay.source.end)}</strong></div><div><span>已完成 / 总请求</span><strong>{formatValue(replay.completedCount,0)} / {formatValue(replay.requestCount,0)}</strong></div><div><span>回放规则</span><strong>同模型 · 原速</strong></div></div><div className="replay-caption">{mode==='demo'?'模拟回放，45 秒演示完成；曲线不代表真实优化效果。':'实例指标可能包含其他流量；回放尾部指标受采集和缓存延迟影响。'}</div></>}
            {!replay&&<div className="replay-empty"><div className="empty-orbit"><Activity size={28}/><span className="orbit-dot"/></div><h4>让历史流量，再跑一次</h4><p>在左侧选定时间区间并确认回放。<br/>该模型的新处理与等待曲线将在这里展示。</p><div className="empty-steps"><span><span>1</span>选择区间</span><span className="step-line"/><span><span>2</span>确认回放</span><span className="step-line"/><span><span>3</span>观察效果</span></div><div className="empty-tip"><Check size={14}/>切换查询模型不会改变已创建的回放任务</div></div>}
          </section>
        </div>
        <div className="bottom-note"><span><Terminal size={14}/>{mode==='demo'?'演示模式 · 所有曲线与任务均为模拟数据':'后端模式 · Prometheus 原样数据解析'}</span><span>{updatedAt?`指标更新于 ${clock(updatedAt)}`:'等待指标查询'}<span className="footer-dot">·</span>时间：{DISPLAY_TIME_ZONE}</span></div>
      </main>
    </div>
    {confirmOpen&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="modal-close icon-button" aria-label="关闭" disabled={submitting} onClick={()=>setConfirmOpen(false)}><X size={19}/></button><div className="modal-icon"><Play size={22}/></div><h2 id="confirm-title">确认回放历史流量</h2><p>将所选时间段的请求按原始节奏发送给该模型当前部署。</p><dl><dt>模型</dt><dd>{model?.name}</dd><dt>开始时间</dt><dd>{selection&&fullDateTime(selection.start)}</dd><dt>结束时间</dt><dd>{selection&&fullDateTime(selection.end)}</dd><dt>模式</dt><dd>{mode==='demo'?'模拟演示，不发送真实流量':'后端回放，发送真实历史请求'}</dd></dl>{error&&<div className="chart-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" disabled={submitting} onClick={()=>setConfirmOpen(false)}>取消</button><button className="button primary" disabled={submitting} onClick={()=>void beginReplay()}>{submitting?<LoaderCircle size={15} className="spin"/>:<Play size={14}/>}开始回放</button></div></section></div>}
    {settingsOpen&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-close icon-button" aria-label="关闭" onClick={()=>setSettingsOpen(false)}><X size={19}/></button><h2 id="settings-title">后端连接设置</h2><p>在 .env.local 中配置 BACKEND_URL 和接口路径，修改后重新运行 npm run dev。下方显示本次构建使用的路由。</p><label className="settings-field">认证头<select value={authHeader} onChange={e=>setAuthHeader(e.target.value as typeof authHeader)}><option>x-litellm-key</option><option>x-api-key</option><option>Authorization</option></select></label><label className="settings-field">认证值<input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={authHeader==='Authorization'?'Bearer …':'LiteLLM API key'}/></label><p className="settings-note">凭据仅保存在页面内存中，不写入本地存储。Prometheus 查询不携带认证。</p><div className="endpoint-list"><code>{API.modelInfoPath}</code><code>{API.prometheusPrefix}/query</code><code>{API.prometheusPrefix}/query_range</code><code>{CREATE}</code>{model&&<code>model_name = {model.metricsName||model.name}</code>}</div><div className="modal-actions"><button className="button primary" disabled={active} onClick={()=>{setSettingsToken(t=>t+1);setSettingsOpen(false);}}>应用设置</button></div></section></div>}
  </div>;
}



