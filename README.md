# TrafficReplay

React + TypeScript + ECharts 前端。默认演示模式；演示曲线和回放任务均为模拟数据。

右上角“中文 / EN”按钮切换中英文，默认中文并记住语言选择。界面、图例、任务状态和弹窗随语言切换；语言切换不重新查询指标、不重置模型/选区/回放任务，时间始终按 Asia/Shanghai 展示。上游返回的错误详情和模型名称保留原文。

这是纯前端工程，不包含看板后端、请求档案、回放调度器或 Prometheus/vLLM/LiteLLM 服务。Vite 仅用于本地开发、构建和预览，以及将本地 API 请求代理到已有看板后端。GitHub 保存源码，不会代替后端执行流量回放。

回放后端对接请参阅 [流量回放接口文档](docs/replay-api.md)，其中列出创建任务、完整状态响应、幂等语义和前端观测流程。

页面时间统一按 Asia/Shanghai 显示，时间输入按 UTC+08:00 转换为 Unix 秒级时间戳，不依赖浏览器时区。历史查询支持 15 分钟、30 分钟、1 小时、6 小时、12 小时、24 小时、7 天，可配合截止时间查询更早的区间。各范围保持约 60 个点；7 天的查询步长为 10080 秒。跨日图表显示日期与时间。真实数据覆盖范围取决于 Prometheus 保留时间，请求回放覆盖范围取决于后端请求档案。

## 数据来源与流向

```text
模型列表：vLLM /metrics → Prometheus
        → 看板后端 /api/prometheus/query（count by (model_name)）
        → data.ts / fetchModels / parseModelVector → App.models → 模型下拉框

历史曲线：vLLM /metrics → Prometheus → 看板后端 /api/prometheus/query_range
                      → data.ts / parseMatrix → App.history → 左侧 LoadChart

即时卡片：Prometheus → 看板后端 /api/prometheus/query
                   → data.ts / parseLatencyVector → App.metrics → TTFT/E2E/ITL/TPOT/QT 五张卡

回放延迟：回放任务的实际时间、目标模型与部署标签 → 同一 /api/prometheus/query
        → ReplayLatency → 独立五张回放实时延迟卡片（短窗口，每 30s 更新）

回放缓存：同一任务的时间、目标标签 → query + query_range
        → replayCacheData / ReplayCache / CacheTrend → 三张卡片与三张趋势图

创建回放：左侧刷选 / 时间输入 → App.selection
        → POST /api/replays { model_id, start_time, end_time, speed }
        → 后端检索原请求档案并向同模型发送 → 返回 replay_id → App.replay

回放观测：GET /api/replays/{id} → 实际开始/结束时间、状态、目标指标标签
        → data.ts / fetchLoad → 同一 query_range 接口
        → App.replayData → 右侧 LoadChart
```

请求 ID 和完整请求内容不经过折线组件；任务完成由后端状态接口决定，不能从曲线是否归零推断。模型下拉框切换只影响左侧查询，右侧任务使用创建时固定的模型。所有接口时间使用 Unix 秒，图表绝对轴转换为毫秒，相对轴转换为距实际开始时间的秒数。

| 文件 | 数据相关职责 |
|---|---|
| src/data.ts | 接口调用、缓存/限流、PromQL、原样 JSON 解析、演示数据 |
| src/apiConfig.ts | 接口路径、指标名称、回放逻辑别名与 vLLM 模型标签的显式映射 |
| src/App.tsx | 查询条件、历史选区、回放提交、状态轮询与两个窗口的数据分配 |
| src/types.ts | 模型 ID、指标标签、数据类型及时间单位约定 |
| src/LoadChart.tsx | 绘制、异常值断点、tooltip、刷选边界回传，不发 HTTP 请求 |
| src/replayCacheData.ts、src/ReplayCache.tsx、src/CacheTrend.tsx | 回放缓存配置/查询、实例解析、独立轮询、指标卡与缓存趋势图 |
| src/chartTime.ts、src/time.ts | Unix 秒与图表坐标、相对时间、上海时间输入/显示之间的转换 |
| vite.config.mjs | 本地同源请求到看板后端的代理 |

演示模式使用 demoModels、固定卡片值和 demoLoad，不调用真实模型。demoLoad 一次生成整个窗口的模拟点；数字倍速的演示任务以 45 秒为基准缩放时长，`∞` 模式立即将已发送数置为总数并进入等待处理阶段，以 45 秒模拟处理完成；任务每 3 秒刷新，与历史选区时长无关。后端模式的任务状态约每 2 秒查询，指标曲线每 30 秒刷新；实际状态与时间均来自后端，没有 45 秒自动完成规则。

## 启动

建议安装 Node.js 22 LTS 和 Git。仓库提交 package-lock.json，其他电脑使用 npm ci 安装相同依赖。

```sh
npm ci
npm run dev
```

构建：`npm run build`。解析测试：`npm test`。

`npm run dev` 先构建再启动本地预览，兼容受限 Windows 环境；修改代码后需重新执行。普通本地环境可使用 `npm run dev:source` 启动 Vite 源码开发服务。

本地预览地址为 http://127.0.0.1:5173/。不要通过双击 index.html 启动页面。

## 上传到 GitHub

以 llm-dashboard 目录为仓库根目录，上传 src/、tests/、scripts/、index.html、package.json、package-lock.json、tsconfig.json、vite.config.mjs、README.md、.gitignore 和 .env.example。

不要上传 node_modules/、dist/、*.tsbuildinfo、真实 .env 配置、日志和生成的预览截图；.gitignore 已排除这些文件。package-lock.json 和 .env.example 应保留。截图可以之后单独整理到文档目录。

在 GitHub 新建空仓库 TrafficReplay，先不要自动添加 README、.gitignore 或 License。在本机 PowerShell 中执行：

```powershell
Set-Location 'D:\ai_workspace\llm-dashboard'
git init
git add .
git status --short
git diff --cached --stat
git commit -m "Initial TrafficReplay frontend"
git branch -M main
git remote add origin https://github.com/<GITHUB_USER>/TrafficReplay.git
git push -u origin main
```

将 <GITHUB_USER> 替换为账号或组织。git status 中确认没有 node_modules、dist 或真实环境配置。如果 Git 提示身份未配置，先在该仓库执行 `git config user.name "你的名字"` 和 `git config user.email "你的邮箱"`，再提交。推送时使用已登录的 GitHub 凭据或凭据管理器，不在命令中嵌入访问令牌。

## 另一台电脑拉取并对接

安装 Node.js 22 LTS 与 Git 后执行：

```sh
git clone https://github.com/<GITHUB_USER>/TrafficReplay.git
cd TrafficReplay
npm ci
```

复制环境模板。Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux：

```sh
cp .env.example .env.local
```

编辑 .env.local：

```dotenv
BACKEND_URL=http://<BACKEND_IP>:<BACKEND_PORT>
REPLAY_BACKEND_URL=http://<BENCHMARK_IP>:<BENCHMARK_PORT>
VITE_PROMETHEUS_API_PREFIX=/api/prometheus
VITE_MODEL_METRICS_MAP='{}'
VITE_REPLAY_CREATE_PATH=/api/replays
VITE_REPLAY_STATUS_PATH=/api/replays/{id}
```

`BACKEND_URL` 填写已有指标后端地址，`REPLAY_BACKEND_URL` 可选，填写独立 Benchmark 后端地址；留空时回放仍走 `BACKEND_URL`。地址不是 Prometheus、LiteLLM 或 vLLM 地址。后端位于其他机器时，不应填写 127.0.0.1。修改连接配置后重启 `npm run dev`。页面选择“后端”，先确认 Prometheus 模型列表与历史指标。连接设置默认选择 `Authorization`；接入 Benchmark 时，认证值填写 `Bearer ` 加服务端 `BENCHMARK_API_KEY` 的实际值，不带尖括号，页面不会自动补前缀。模型列表和指标查询不携带该凭据。

后续同步源码：`git pull`、`npm ci`，然后重新启动。自己的 .env.local 不进入 Git，因此不会被其他电脑的连接配置替换。

scripts/test.cjs 支持 npm test；浏览器检查脚本目前默认使用 Windows Chrome 路径和 4173 端口，其他电脑运行这些可选检查前需要按实际浏览器与预览端口调整。日常启动页面不依赖这些脚本。

## 后端连接

将 `.env.example` 复制为 `.env.local`，配置 `BACKEND_URL=http://<BACKEND_IP>:<BACKEND_PORT>`，重启服务。独立 Benchmark 可另外配置 `REPLAY_BACKEND_URL`；Vite 开发和预览会优先将创建/状态路径转发给 Benchmark，其余 `/api` 请求仍走已有看板后端，自定义回放路径也支持分流。回放认证值在右上角设置中输入，只保存在内存中。静态生产部署需在反向代理中配置相同的路径分流；这两个地址仅用于本地代理，不进入浏览器构建产物。

任务创建响应会立即显示进度，活动任务在每次状态响应结束后约 2 秒再次查询；查询失败时保留上次计数和更新时间，并按 5、10、20、30 秒退避，429 按 Retry-After 退避，未提供时等待 60 秒。页面隐藏时暂停，恢复前台后立即尝试刷新；终态立即停止状态轮询。右侧曲线独立每 30 秒刷新，较慢的指标查询不会阻塞进度。

回放观测的模型名称下方显示“已完成 / 总请求”、百分比和进度条，以及已发送、失败、跳过数量与最近成功接收时间。计数优先读取 `progress.total/completed/sent`，兼容顶层 `request_count/completed_count/sent_count`。总数未知时显示统计中，已知但尚未打流时显示 `0 / 总数`；没有可回放请求时不将 `0 / 0` 显示为 100%。已完成包含处理结束的失败请求，100% 不代表全部成功；任务结果以终态为准。

`BACKEND_URL` 用于 Vite 本地代理，不会将后端地址写入生产页面。生产部署需将 `npm run build` 生成的 dist/ 放到静态服务，并配置 `/api` 反向代理；不能只把 dist/ 放到 GitHub Pages 后期望其自动连接后端。

模型列表和即时卡片使用 `/api/prometheus/query`，负载曲线使用 `/api/prometheus/query_range`。Prometheus 前缀可通过 `VITE_PROMETHEUS_API_PREFIX` 配置；均使用以 `/api/` 开头的同源路径。旧的 `VITE_MODEL_INFO_PATH` 仅保留兼容配置，首页已不调用 LiteLLM 模型列表接口。指标按 30 秒刷新，隐藏页面暂停；历史截止时间固定后不自动刷新。同一 Prometheus URL 在前端缓存并去重 30 秒，429 按 Retry-After 退避，未提供时等待 60 秒；指标与回放分别退避。不同指标查询使用 allSettled 隔离失败，保留 NaN 和 Inf。

首页五张延迟卡片 TTFT、E2E、ITL、TPOT、QT 都使用即时 `GET /api/prometheus/query`，每张卡独立发送一条 PromQL。TTFT/E2E/ITL/QT 使用 rate(_sum)/rate(_count)；TPOT 使用解码耗时率除以生成 token 率减请求率，减法置于分母括号内。各表达式未加外层 avg。响应中的同模型 engine 分片在前端求算术平均，空闲分片的 NaN 会被跳过；如果所有分片都是 NaN，仍保留真实 NaN。普通模型按 role 分行；DeepSeek 默认把 proxy、prefill、decode 的全部分片混合平均并只展示一行，模型片段可通过 VITE_MIXED_LATENCY_ROLE_MODELS 配置。单条已聚合的结果直接取值，Inf 保留。表达式内核为 `rate(<metric>_sum{model_name="当前模型"}[<历史范围>]) / rate(<metric>_count{model_name="当前模型"}[<历史范围>])`；例如选择 12 小时，窗口就是 `[12h]`。后端接收完整 query，在看板后端的 TTL 缓存中按 URL 缓存，再请求 `${PROMETHEUS_TARGET}/api/v1/query`。因此这些卡片没有值时，应先看 Network 中的 query、HTTP 响应和 `data.result`，再区分路由错误、指标名错误、模型标签不匹配和窗口内没有样本。

原有卡片的评估时刻是现在，修改历史截止时间不会把即时 query 的评估时刻移到过去；它只调整左侧 query_range。拖拽回放子区间也不改变原有延迟卡的回溯长度。模型或历史范围切换时清空旧卡片并重新查询，旧模型尚未完成的响应不会覆盖新模型数据。历史曲线与即时卡片并发加载，卡片独立显示加载、空样本、NaN 和可展开的查询错误。历史查询刷新共发 2 条区间曲线和 5 条即时指标请求；回放开始并有足够采集时间后，新增区域另发 5 条独立延迟请求。首次模型发现另发 1 条，页面每 30 秒刷新指标。模型列表通过“刷新列表”按钮更新，同样受 30 秒缓存限制，不持续轮询。

默认指标名已按旧看板提供的表达式配置：TTFT `vllm:time_to_first_token_seconds`、E2E `vllm:e2e_request_latency_seconds`、ITL `vllm:inter_token_latency_seconds`、QT `vllm:request_queue_time_seconds`。TPOT 为 `rate(vllm:request_decode_time_seconds_sum[窗口]) / (rate(vllm:request_generation_tokens_sum[窗口]) - rate(vllm:request_generation_tokens_count[窗口]))`，五项均附加当前模型筛选。分母为 0 时保留 Prometheus 返回的 NaN/Inf，不替换为 0。

例如部署的 ITL 名称为其他指标时，在 .env.local 中配置 `VITE_PROMETHEUS_METRIC_NAMES='{"itl":{"sum":"custom:itl_sum","count":"custom:itl_count"}}'`，修改后重新构建。示例中的 custom 名称仅说明格式，不能直接用于真实部署。TPOT 覆盖配置必须包含 decodeSum、generationTokensSum、generationTokensCount 三个完整指标名，例如 `{"tpot":{"decodeSum":"vllm:request_decode_time_seconds_sum","generationTokensSum":"vllm:request_generation_tokens_sum","generationTokensCount":"vllm:request_generation_tokens_count"}}`。

### 独立的回放实时延迟（2026-10-15）

底部新增一组 TTFT、E2E、ITL、TPOT、QT；原有“延迟数据”的查询模型、历史回溯窗口和刷新规则保持原样。新区域使用右侧任务的 `metricsName` / `target.metrics_labels`，显示任务 ID、完整来源历史区间和每项成功查询的观测时间；切换左侧模型或固定历史截止时间不会改变回放延迟的目标和轮询。

“实时”表示目标部署的近期平均延迟，每 30 秒刷新，不表示最近一条请求的延迟。默认 `VITE_PROMETHEUS_SCRAPE_INTERVAL_SECONDS=15`、`VITE_REPLAY_LATENCY_WINDOW_SECONDS=60`；应将前者改为真实采集间隔，窗口自动取配置值与采集间隔 4 倍中的较大值。开始后先等待至少两次采集间隔，初期使用不越过 `started_at` 的较短窗口，再逐步增长到配置窗口。无样本、NaN、Inf 保留原意，不替换成 0；低流量时短窗口可能没有有效延迟数据。修改配置后重新构建。

查询仍走已有 `/api/prometheus/query?query=...`，例如 `rate(vllm:time_to_first_token_seconds_sum{model_name="目标模型"}[1m] @ 观测Unix秒) / rate(vllm:time_to_first_token_seconds_count{model_name="目标模型"}[1m] @ 观测Unix秒)`。指标后端只需原样透传完整 query，缓存键包含完整 query；无需新增接口或额外透传 `time` 参数。Prometheus 必须支持并启用范围选择器的 `@` 修饰符，且保留对应时刻的指标。各项指标应存在与右侧曲线相同的真实部署标签；不存在的指标或标签会返回空值或错误。

未创建/未打流时显示等待，不查询回放延迟；暂停、等待在途请求完成和取消过程中仍持续观测。任务终态后将最终观测时间固定为 `finished_at + 2 × 采集间隔`，等待额外 30 秒缓存余量并取得一轮无查询错误的结果后停止轮询，成功空结果也属于一次成功查询，不能据此证明样本完整。结束后的数值是该固定窗口的近期平均，不是整个任务的平均。失败项保留本任务最近成功值及时间，并明确标记查询失败；新任务或目标部署变化会清空旧值。顶部“刷新指标”也刷新新增区域。

刷新页面先沿用现有任务恢复机制，再重新查询回放延迟；终态任务按同一固定时刻查询，不会误用刷新当天的延迟。演示模式只显示明确标注的模拟值。

最终观测时间向上取整到 Unix 整秒，确保不足一秒的任务也能经过完整的采样等待。新增验证：`npm test` 共 43 项通过，生产构建通过；`scripts/replay-latency-check.cjs` 使用模拟 HTTP 验证未打流等待、短窗口、目标部署筛选、原有卡片隔离、单项错误保留时间、暂停/继续、慢指标期间取消、终态固定时刻恢复、切换新任务清空、手动刷新、中英文与 320px 布局。原有 `scripts/latency-check.cjs`、`scripts/replay-pause-check.cjs` 回归通过，尚未使用真实后端指标验证。

此功能无需修改 Benchmark。当前 Benchmark 主要返回 `model_name`，不能自动隔离同模型的多个部署或业务流量；新增卡片与右侧曲线均可能包含其他流量。若需要更精确的部署定位，Benchmark 应在现有 `target.metrics_labels` 返回真实部署标签，且这些标签必须同时存在于负载和五项延迟指标上。若要求严格只统计本次回放，需专用部署或后端提供任务级指标；只添加一个指标中不存在的 `replay_id` 标签无法实现隔离。真实五项指标、采集间隔、代理缓存与 PromQL 支持仍需部署联调确认。

### 回放缓存观测（2026-10-15）

“回放实时延迟”下方新增“回放缓存观测”：三张卡片（KV Cache 使用率、前缀缓存命中率、命中 token/s），一张全宽 KV 趋势图和两张并排的命中趋势图，手机端纵向排列。原有负载和两组延迟观测保持各自规则。区域显示目标模型、部署筛选标签、任务 ID/状态、完整来源历史和成功观测时间。趋势默认使用相对时间，横轴从实际 `started_at` 的 0 起算；取消“相对时间”可查看绝对时间，tooltip 始终保留上海时间。首个真实采样点可以晚于 0，不补造起点数据。

统计口径：

- KV 保留返回序列的全部真实身份标签（例如 instance、pod、engine、role），每条序列单独绘制，纵轴固定 0–100%。卡片由趋势区间结果推导并标明实例：回放中取各实例曲线最后有效点的最大值（“当前实例最大值”，与曲线右端一致，闸门失败时回退到前一个有效点并显示真实样本时间）；任务结束后取回放期间的实例峰值（“回放期间实例峰值”，即曲线最高点）。不相加，也不将未加权平均说成部署总使用率。没有实例标签的单条序列仍可显示，具体身份需采集端提供。
- 前缀缓存命中率为 `100 * sum(rate(hits[窗口])) / sum(rate(queries[窗口]))`，按部署汇总计数率，不平均实例命中率。分母为 0 时显示空值；分母大于 0 且命中为 0 才显示真实 0%。hits 与 queries 必须来自同一计数体系、相同单位和相同工作节点范围。
- 命中 token/s 为 `sum(rate(hits[窗口]))`，**只有确认 hits 计数单位是 token 后才启用**。不同 vLLM 版本可能按缓存块或请求计数，不能将 blocks/s 或 requests/s 标为 token/s，也不按固定 block size 擅自换算。配置 blocks/requests 时可看对应单位的命中率，token/s 保持不可用。

在 `.env.local` 配置（修改后重新执行 `npm run dev`）：

```dotenv
# 默认指标名，KV 按 0~1 缩放；当前部署已确认 hits/queries 都按 token 计数。
VITE_REPLAY_CACHE_CONFIG='{"counterUnit":"tokens"}'
# 其他部署的计数单位未确认时，可显式禁用命中两项：
# VITE_REPLAY_CACHE_CONFIG='{"counterUnit":"unknown"}'
```

完整可选配置示例（以下单位和标签须按真实部署核对，不能视为已确认）：

```dotenv
VITE_REPLAY_CACHE_CONFIG='{"kvMetric":"vllm:kv_cache_usage_perc","kvUnit":"ratio","hitsMetric":"vllm:prefix_cache_hits_total","queriesMetric":"vllm:prefix_cache_queries_total","counterUnit":"tokens","windowSeconds":60,"labels":{"role":"decode"}}'
```

`kvUnit` 支持 `ratio`（0–1，显示时乘 100）或 `percent`（0–100）；名称带 `_perc` 不能证明是 0–100。较旧版本可能用 `vllm:gpu_cache_usage_perc`，须显式改 `kvMetric`，前端不自动混用新旧指标。当前部署的 `counterUnit` 已确认为 `tokens`，默认启用命中率和命中 token/s；也支持显式 `unknown`（不查询命中两项）、`blocks`、`requests`。窗口取配置与真实采集间隔 4 倍的较大值，采集间隔共用 `VITE_PROMETHEUS_SCRAPE_INTERVAL_SECONDS`。`labels` 仅供缓存指标附加精确筛选，例如排除重复计数的 proxy；不能覆盖任务目标的 model_name 或部署标签，否则显示冲突错误。配置格式见 `.env.example`。

KV 从实际打流开始观测，PromQL 用 `timestamp` 排除回放前 gauge 和超过两次采集间隔的陈旧样本。收到带小数的 `started_at` 时，若尚未到首个可查询整秒，下一整秒即发起查询，不额外等待一轮 30 秒刷新；等待期间相对横轴也从 0 显示。命中两项等待一个完整窗口，趋势第一点为 `ceil(started_at + 窗口)`，每个点都不会读取回放前计数。短任务的结束补采范围不足完整窗口时，命中指标保持空值并明确提示，不混入回放前流量。KV 不受此窗口等待限制。

每轮最多新增 5 条 query_range；显式配置未知单位时仅查询 KV 的一条。命中率/token 卡片用 `start=end=观测Unix秒` 的单点区间查询，趋势用完整区间，终态卡片仍按原任务的固定时刻求值；KV 卡片不再单独查询，由趋势区间结果推导（回放中取最后有效点、终态取全程峰值），与曲线严格一致。所有查询使用相同的无 `@` 表达式，避免旧即时查询代理返回 `HTTP 400 · Invalid query syntax`。区间请求透传 query/start/end/step，步长不小于采集间隔，趋势约最多 301 点/序列。长任务会降采样，窄峰可能漏采（终态峰值同样受网格量化影响）；Prometheus 保留期、超时或最大区间限制仍可能影响恢复范围。空缺点绘为断点，空响应/NaN/Inf 显示空值；超范围百分比显示单位/计数器错误，不强行裁成 100%。

后端模式新增“缓存计数单位”选择器；核对真实指标定义后，可以为当前任务选择 token、缓存块或请求，无需重新构建。选择仅用于当前页面的任务观测，新任务或刷新页面后回到构建配置；长期默认值仍通过 `VITE_REPLAY_CACHE_CONFIG.counterUnit` 配置。未知单位保持命中两项禁用；blocks/requests 可展示命中率，仍不展示 token/s。

页面刷新先恢复原任务，再查询原 `started_at` 起的完整趋势，不重新创建任务。左侧模型/时间选择不改变缓存观测目标。暂停、draining、cancelling 仍观测；终态固定在 `ceil(finished_at + 2 × 采集间隔)`，留 30 秒缓存余量并取得一轮无查询错误响应后停止，成功空结果也会停止，不能据此认定样本完整。结束后的命中卡片是固定窗口的近期值，不是任务累计值；KV 卡片是回放全程的实例峰值。缺少 finished_at 时继续轮询。单项卡片/趋势失败独立保留本任务最近成功数据及时间；新任务/目标变化清空旧数据，顶部“刷新指标”可重新查询。

**后端与部署要求（本次不修改 Benchmark）：**

1. 缓存观测使用已有 `GET /api/prometheus/query_range`，透传完整 PromQL、start/end/step，支持 `start=end` 的单点求值，缓存键包含完整参数。返回标准 Prometheus matrix JSON；支持 `timestamp`、`time`、`rate` 和向量匹配。缓存查询不依赖 `@`；其他回放延迟查询的 `@` 要求见上节。无需新增缓存专用接口，指标查询不携带 Benchmark 凭据。
2. Prometheus 采集实际 vLLM 的 KV gauge 和同单位 hits/queries counter，保留所需历史。确认命中率分母定义、计数单位、采集间隔、指标版本、前缀缓存是否启用；缺少指标需在 vLLM/exporter 侧补充，单改 Benchmark 无法生成 KV 数据。`rate` 处理计数器重置；空响应不等于“不支持缓存”。
3. Benchmark 当前主要返回 `target.metrics_labels.model_name`。同模型多部署时，需在现有公共任务响应（`app/benchmark/api.py` 组装目标标签的位置）补充真实 deployment/namespace/job 等标签，并在创建/状态/活动响应保持一致；这些标签须存在于全部相关指标。本项目只记录要求，未修改 Benchmark 文件。
4. 在采集端或 Prometheus 去除 HA 副本、重复 scrape target、proxy/worker 重复计数，或用缓存 labels 筛选唯一采集路径；前端不猜测去重。命中两项对筛选后的序列求和。严格只统计本次回放需专用部署或任务级指标，当前数据可能包含其他业务流量，不添加不存在的 replay_id 标签。

验证使用模拟 HTTP，未向真实部署发流；实际指标名和标签仍需与部署一致。`node scripts/replay-cache-check.cjs` 默认验证 token 计数下的全部三项、刷新恢复、paused 状态显示与取消、终态固定历史查询，以及页面内 token/blocks/unknown 单位切换。显式以 unknown 单位构建后，以 `CHECK_CACHE_TOKENS=0` 运行同脚本可验证单位未确认时的空态。

本次 `npm test` 51 项通过，构建/浏览器检查均通过；原有延迟及暂停按钮浏览器回归通过。另验证了自定义指标前缀、30 秒去重、blocks/requests 单位禁用 token/s、单项错误隔离、空结果清除、相对时间 tooltip、中英文及 320px 布局。新区域与回放延迟使用各自的 React key，避免切换模式/任务时重复挂载；图表不随约 2 秒一次的进度轮询重绘。

再次审查修复：顶部“刷新指标”同时重新查询右侧回放负载曲线，已停止轮询的终态任务也可刷新，仍使用原任务时间；同一任务的模型或部署标签更新时，负载、回放延迟与缓存观测清空旧数据，未完成的旧查询不会覆盖新目标。缓存趋势中的孤立样本显示采样点，避免短任务或停采间隙导致有数据却看不到曲线；缓存卡片首次查询失败时显示“查询失败 · 查看详情”。新增 `node scripts/replay-observation-review-check.cjs`，用模拟 HTTP 验证部署更新、旧响应隔离、首次失败空态、单点曲线、终态手动刷新和页面刷新后的原任务时间恢复。手动刷新仍遵守已有 30 秒指标缓存，实际更新还受后端缓存与采集间隔影响。

KV 卡片改为从趋势结果推导（2026-10-16）：此前卡片单独发 `start=end` 的单点查询，采集缺口触发新鲜度闸门时会清空卡片（曲线同一时刻仍在正常显示），且终态冻结在 `finished_at + 2 × 采集间隔` 的排空后快照，回放结束后常显示 0%。现在卡片直接取趋势区间查询结果：回放中显示各实例曲线最后有效点的最大值（“当前实例最大值”，观测时间为真实样本时间，闸门失败只回退到前一个有效点），任务结束后显示回放全程实例峰值（“回放期间实例峰值”，与曲线最高点一致）；每轮 query_range 由 6 条减为 5 条。命中率/token 卡片、轮询节奏与空值语义不变。`npm test` 56 项通过，全部回放浏览器检查通过。

### 模型列表可加载，但指标提示 404

`BACKEND_URL` 决定请求发往哪台看板服务器，接口路径决定由该服务器哪个路由处理。早期版本模型列表来自 LiteLLM，能加载列表只证明其透传路由可达。当前列表直接查询 Prometheus，但仍应检查每个失败指标请求的实际路径。默认代理不移除 `/api`，通常应将 BACKEND_URL 填为 `http://<BACKEND_IP>:<BACKEND_PORT>`，不要再追加 `/api`。若后端本身安装在子路径，应按实际部署调整代理，不能直接套用此默认配置。

已确认真实后端使用 `prometheus`。早期接口说明中的 `promethues` 拼写有误，会导致 `API route not found`。若自己的 .env.local 仍有旧值，必须修改，否则它会覆盖更新后的代码默认值：

```dotenv
VITE_PROMETHEUS_API_PREFIX=/api/prometheus
```

停止旧服务，再执行 `npm run dev`，刷新页面。这个脚本会重新构建；单独重启 `npm run preview` 不会更新产物中的 VITE_ 变量。生产环境修改这些变量后也必须重新构建并部署，且静态服务器的 `/api` 代理仍须配置。连接设置会显示当前构建使用的路由与当前模型的指标标签。

可直接在浏览器打开看板后端的 `http://<BACKEND_IP>:<BACKEND_PORT>/api/prometheus/query?query=up`。Prometheus 查询不需要 LiteLLM 认证。若正确拼写的路径直接访问仍出现 `API route not found`，请核对看板后端版本与反向代理；修改模型名或 PromQL 不会修复路由 404。若直接访问成功、前端失败，则在 Network 中比较路径，并检查是否仍运行旧构建、是否指向另一服务。

旧看板提供的 `vite.config.js` 将 `/api` 原样代理到 `http://localhost:3000`，没有 rewrite；代理本身不定义或修正 Prometheus 路由。5173 是旧前端地址，并非 API 后端端口，新项目可直接使用同样的 3000 目标。

同机联调可配置：

```dotenv
BACKEND_URL=http://127.0.0.1:3000
VITE_PROMETHEUS_API_PREFIX=/api/prometheus
BACKEND_PROXY_DEBUG=true
```

修改后停止新服务并重新运行 `npm run dev`。终端会显示当前 mode、实际加载的代理目标以及每个请求的上游 HTTP 状态，日志不输出查询参数或认证头；联调结束可关闭 debug。如果新旧前端表现不同，比较 `localhost:3000`、`127.0.0.1:3000`、旧 5173 和新 5174 的同一路径 `?query=up`。localhost 可能解析到 IPv6，127.0.0.1 则固定为 IPv4；若它们实际连接到不同服务，响应才会不同。debug 显示的目标不符合 .env.local 时，还应检查运行目录、进程环境变量，以及 `.env.production` / `.env.production.local` 中的覆盖值：本项目 npm run dev 使用 build + preview，默认为 production mode。

当前 Vite 的 preview 默认继承 server.proxy，本项目另将 preview.proxy 显式设为同一对象便于核对；显式配置本身不能证明已修复生产环境的 404。如果正确目标上的简单查询成功，而某条业务 PromQL 返回 404，应复制旧前端成功查询的完整 URL 参数，在新前端执行同一查询，并查看后端路由日志，而不是继续更换接口前缀。

### Prometheus 模型列表与回放名称

模型下拉框直接从 `count by (model_name) (vllm:num_requests_running)` 的 vector 标签生成。Prometheus 必须已配置采集各 vLLM 的 `/metrics`；前端通过看板后端查询，不直接访问 vLLM。不需要新增后端接口。值为 0 的空闲模型仍保留，同名 engine/role 合并为一个选项。

新增或重命名的模型在 Prometheus 采集后，点击“刷新列表”即可获取；前后端均有 30 秒缓存，因此可能需要等待 TTL 到期。该列表反映当前已采集且仍有效的序列，停止采集或过期的旧模型不会因为历史范围较长就自动出现在列表中。

五张延迟卡和两条负载曲线都直接使用所选名称匹配 `model_name`。回放请求默认也把该名称作为 `model_id`。如果回放后端仍要求 LiteLLM 别名，需要显式配置：

```dotenv
VITE_MODEL_METRICS_MAP='{"qwen-service":"Qwen/Qwen3-32B-v2"}'
```

此时下拉框显示 `Qwen/Qwen3-32B-v2`，指标也筛选该名称，回放请求提交 `qwen-service`。映射用于明确回放目标，不修改指标模型列表；多个别名映射到同一指标名称时，前端阻止自动回放，需先修正为唯一对应关系。连接设置显示实际的 model_name 和回放 model_id。

路由成功但指标为空时，再核对 vLLM 是否已被采集、时间范围、实际指标名和模型标签。五张延迟卡片的 rate 窗口跟随历史查询范围；若 scrape interval 大于所选窗口或窗口内没有请求，Prometheus 可能返回空结果或 `NaN`。这些问题与 `API route not found` 是不同层次。

## 待联调的约定

- 模型发现：`src/data.ts` 的 `fetchModels` / `parseModelVector`，从即时查询的 `model_name` 标签生成下拉项；`adaptModels` 保留为旧 LiteLLM 适配函数，首页不再调用它。回放后端需能识别该模型名，或配置一对一的 `VITE_MODEL_METRICS_MAP`。
- 指标清单和 PromQL 在 `src/data.ts` 的 `loadQueries`、`metricQueries`。TTFT/E2E/ITL/QT 使用 `rate(_sum[窗口]) / rate(_count[窗口])`，TPOT 使用上述解码耗时与生成 token 的特殊比值，共五条独立即时 query。模型标签来自当前下拉框，窗口来自历史查询范围；指标名可用 `VITE_PROMETHEUS_METRIC_NAMES` 覆盖。卡片数值是 Prometheus 即时查询在该回溯窗口内的 rate 结果，不是 query_range 曲线的前端平均。
- 负载曲线：`sum by (model_name) (vllm:num_requests_running{model_name="所选模型"})` 和对应的 `num_requests_waiting`，在 Prometheus 汇总全部 engine 和 role。历史与回放各展示一条处理曲线、一条等待曲线；回放返回的部署标签仍用于筛选目标。前端直接绘制总值，不再平均。DeepSeek 的 proxy/prefill/decode 总和表示各阶段负载总和；若 proxy 和 worker 同时记录同一请求，该值不等于去重后的用户请求数。该口径不依赖 `VITE_MIXED_LATENCY_ROLE_MODELS`，普通模型同样汇总全部 engine。
- 回放创建默认 `POST /api/replays`，请求体 `{ model_id, start_time, end_time, speed }`，Unix 秒，左闭右开。`speed` 为正数或精确字符串 `"burst"`；界面选择 `∞` 时发送 `"burst"`，数字选项仍发送 number。返回 `{ replay_id, status, started_at?, request_count?, target?: { metrics_labels } }`。
- 状态接口默认 `GET /api/replays/{id}`，返回 `{ status, started_at?, finished_at?, request_count?, sent_count?, completed_count?, failed_count?, skipped_count?, progress?, error?, target?: { metrics_labels } }`。状态支持 queued/preparing/running/draining/cancelling/succeeded/failed/cancelled；取消按钮依据 `cancellable` 启用，接受取消后继续轮询直到终态。`finished_at` 为全部请求处理完成时间。创建、状态、活动、取消路径分别通过 VITE_REPLAY_CREATE_PATH / VITE_REPLAY_STATUS_PATH / VITE_REPLAY_ACTIVE_PATH / VITE_REPLAY_CANCEL_PATH 配置。
- 接口尚未与真实部署的 LiteLLM、SpendLogs 和 Prometheus 完成联调；已使用当前 Benchmark HTTP 接口及模拟数据做隔离验证。创建回放响应缺少 replay_id 会明确报错。未知实际开始时间时，前端不会用点击时间替代。

切换模型会清空历史选区，但保留已创建任务的模型。两个图窗使用相同纵轴上限；回放窗口可切换相对时间，历史窗口仍保留绝对时间。相对横轴从实际回放开始的 0 起算，使用数值轴；不足一分钟显示秒，较长区间显示分:秒或时:分:秒，tooltip 同时保留实际时刻。该开关只影响显示，不改变查询或回放参数。每次只创建一个活动任务。

## 当前 Benchmark 对接检查与缺口

2026-10-15 按拉取后的 `D:\ai_workspace\Benchmark` 当前提交 `ef22cd2`（包含 `60e2cd0` 的 burst 实现）复核：创建、状态、活动任务、幂等和基础计数字段兼容，当前 Benchmark 已原生支持数字倍速和 `speed: "burst"`，但本地配置尚未接入独立 Benchmark，兼容补丁中的其余能力也未全部合入。以下为此次检查时的状态，调整配置或移植缺失能力后应重新验证。

| 缺口 | 当前行为及影响 | 补齐方式 |
| --- | --- | --- |
| 独立回放地址未配置 | 前端 `.env.local` 仅设置 `BACKEND_URL=http://127.0.0.1:3000`，未设置 `REPLAY_BACKEND_URL`，因此回放请求也发往 3000。 | 将 `REPLAY_BACKEND_URL` 设置为 Vite/生产代理能够访问的 Benchmark 地址；指标继续使用原 `BACKEND_URL`。 |
| 任务响应缺少 `revision` | Benchmark 已原样返回创建时的数字倍速或 `"burst"`，但公共响应没有递增版本号；前端不能按版本号拒绝迟到的旧响应。 | 将兼容补丁中的任务版本能力移植到当前 Benchmark。 |
| `view=status` 未提供轻量响应 | 活动/状态接口忽略该参数，隔离验证中两者均返回注入的全部 1,000 条 `results`；约每 2 秒的轮询会反复下载结果文本，任务越大响应越重。 | 移植兼容补丁中的轻量响应能力，使 `?view=status` 省略 `results`，保留原完整查询接口。 |
| 后端实际指标标签映射未实现 | 公共响应直接用目标模型名作为 `model_name`；隔离验证配置 `BENCHMARK_MODEL_METRICS_MAP={"alias":"real-model"}` 后仍返回 alias。LiteLLM 别名与指标名不同时，未配置映射的曲线查询可能为空。 | 当前可配置前端一对一 `VITE_MODEL_METRICS_MAP`；或移植后端映射能力，由任务返回实际指标标签。 |
| 取消与调度提交存在竞态 | `app/benchmark/core.py` 在取消检查和线程池提交之间未使用同一把锁；在该间隙插入真实 HTTP 取消后，接口已返回 202/cancelling，调度线程仍提交了一个请求。状态更新也缺少取消中/终态保护。 | 移植兼容补丁中的原子提交与状态保护，使取消受理与提交共用锁；已提交的请求仍等待处理结束。 |
| 没有暂停/继续接口 | 隔离验证中 `/pause`、`/resume` 均返回 404，任务没有暂停能力字段。前端已移除暂停/继续按钮，不再调用这两条接口。 | 参考 [暂停补丁](integration/benchmark-pause.patch) 移植接口与调度能力，不能直接套用旧补丁。 |
| burst 未及时进入 draining | `run_replay` 的突发循环等待所有在途请求结束后才退出；隔离验证中 total=2、sent=2、completed=0 时仍返回 running，`dispatch_finished` 尚未置位。前端会继续显示“回放中”，通常观察不到独立的等待响应阶段。 | 最后一个请求提交后即设置 draining/dispatch_finished，再等待在途响应；终态仍以全部处理结束为准。 |

当前 Benchmark 已精确识别 `speed: "burst"`，内部使用突发调度并在公共任务响应中继续返回 `"burst"`。突发模式取消历史请求间隔，按 `BENCHMARK_MAX_WORKERS` 并发上限持续提交请求；它不会绕过线程池或上游容量限制。

两个服务与 Vite 同机时，前端 `.env.local` 可按下面配置；部署到不同机器或容器时，地址应改为代理实际可访问的地址。修改后重新运行 `npm run dev`：

```dotenv
BACKEND_URL=http://127.0.0.1:3000
REPLAY_BACKEND_URL=http://127.0.0.1:8088
VITE_REPLAY_AUTH_MODE=manual
```

Benchmark 不提供 `/api/prometheus/query` 和 `/api/prometheus/query_range`，这两个接口继续由已有看板后端实现。创建请求中的 `model_id` 同时作为源模型和目标模型，因此它必须能够匹配 SpendLogs 中的源模型和 LiteLLM 可用模型；实际名称需用部署数据确认。

隔离验证覆盖创建、幂等重试、进度条更新、刷新重建曲线、无本地记录时恢复活动任务、普通取消、五种数字倍速及 `∞`。当前 Benchmark 的完整兼容性脚本在指标映射断言处失败；逐项隔离验证另确认上述轻量响应、暂停/继续、取消竞态、版本号和 burst 状态缺口。Vite 双后端分流与认证透传检查通过。验证使用临时任务库、本地 HTTP 和模拟工作线程，不发送真实推理流量，也未验证真实部署的数据链路。

`integration/benchmark-replay.patch` 基于较早的 Benchmark 版本，不能直接应用到当前 `main`。需要从补丁中选择尚未合入的能力并移植到当前代码，完成代码审查和隔离验证后再重启服务或重建镜像；不要直接执行 `git apply`。

后端完整契约可从本项目前端目录执行 `python scripts/benchmark-replay-check.py D:/ai_workspace/Benchmark` 验证。该脚本使用临时状态库和模拟执行，不发送真实推理请求；只有检查通过的后端版本才能视为满足完整契约。

## 限制

回放接口已按独立 Benchmark 的响应字段接入，真实部署仍需配置地址、认证并联调。前端状态和活动查询使用 `?view=status`，应用兼容补丁后的 Benchmark 不携带逐请求 `results`；原完整结果查询保持兼容。共享实例曲线包含其他流量，不能仅凭 model_name 区分回放来源。生产环境需要配置可区分部署的指标标签。花费卡、投机解码和模型实例树未在首版接入。

## 已完成验证

TypeScript 与生产构建通过；37 项解析、接口配置、缓存、模型映射、时间轴、时区、回放响应适配及曲线失败恢复测试通过，包含 DeepSeek 延迟混合 role 单行、NaN 分片跳过、engine 均值，以及历史/回放负载求和与目标部署筛选。浏览器验证覆盖拖拽选区、模型切换、固定回放模型、手机宽度、相对时间秒刻度和 tooltip、切回绝对时间、运行时错误，以及使用模拟 HTTP 响应的后端路径、NaN 显示和包含倍速的四字段回放请求。scripts/backend-check.cjs 验证历史与回放窗口各只有一条处理曲线、一条等待曲线，tooltip 保留求和后的总值。scripts/latency-check.cjs 另验证五条独立延迟 query、当前模型和历史范围过滤、旧响应隔离、慢历史查询隔离、部分失败详情与空样本。scripts/replay-progress-check.cjs 验证 Bearer 认证、创建计数、准备/零总数、慢曲线不阻塞 2 秒进度刷新、失败时保留数据、中英文、取消中、失败达到 100%、终态停止与 320px 布局。scripts/proxy-check.cjs 使用本地模拟服务验证双后端分流、自定义路径与认证头透传。上述浏览器验证使用模拟响应，尚未连接真实后端。



## 倍速、取消与刷新恢复

创建前选择 0.5× / 1× / 2× / 5× / 10× / `∞`，默认 1×。数字倍速缩放请求发送间隔；选择 `∞` 时前端仍只发送原有四个字段，其中 `speed` 为字符串 `"burst"`，后端忽略历史请求间隔并尽快提交所选区间的全部请求。线程池并发仍受后端上限约束，因此 `∞` 表示取消历史节奏。创建后的任务参数固定，不能运行中改速。状态原样返回 `speed`；旧后端未知倍速显示“倍速未知”，不默认显示原速。

前端类型为 `ReplaySpeed = number | 'burst'`，这只扩展允许的值，原有数字请求格式不变。选择框、确认弹窗和任务摘要均将 `burst` 显示为 `∞`；刷新恢复和未确认请求的幂等重试保留原值。演示模式立即进入 draining，已发送数等于总数，随后等待模拟处理完成。

真实打流需要后端同步支持。当前 `D:\ai_workspace\Benchmark` 的 `main` 已保留数字倍速原有解析行为，精确识别 `"burst"`，并在幂等指纹和公共任务响应中保留突发模式。调度器不再等待历史请求间隔，而是在并发槽位空闲时继续提交；全部请求处理结束后才进入终态。部署仍需包含这版实现并在更新后重启服务或重建镜像。

进入后端模式并有认证后，先请求 `GET /api/replays/active?view=status`；有活动任务则恢复，没有则用本地保存的最后 ID 请求 `GET /api/replays/{replay_id}?view=status`，覆盖刷新期间刚完成的情况。恢复失败阻止创建，可手动重试。创建遇到 `409 + active_task` 时展示该任务。恢复已知任务只 GET，不重新打流，也不需要重新填写倍速或幂等键。

页面刷新不会取消后端打流；曲线可能短暂为空，随后从实际开始时间重新查询并恢复已有曲线。正常情况下，任务状态和进度约每 2 秒更新，回放曲线每 30 秒更新；页面隐藏时暂停查询，重新可见时立即补查。演示模式的任务仅在当前页面运行，刷新后会重置。

恢复任务和曲线所需的响应字段如下，均由后端返回，前端自动读取：

| 字段 | 用途 |
| --- | --- |
| `replay_id`、`status` | 确认任务身份及状态，继续查询该任务进度。 |
| `model_id` 或 `target_model`、`source_model` | 恢复目标及源模型；未返回 `source_model` 时前端按同一模型处理。 |
| `start_time`、`end_time` | 原历史选区的 Unix 秒时间戳，用于恢复左侧历史窗口。 |
| `speed` | 创建时固定的正数或 `"burst"`；前端分别恢复为数字倍速或 `∞`。 |
| `started_at` | 实际打流开始时间，Unix 秒；回放曲线从此处开始，不使用原历史选区的起点。尚未实际开始时可以省略。 |
| `target.metrics_labels` | 实际 Prometheus 模型和部署标签，优先用于筛选回放曲线；未提供时使用前端模型映射或模型名。 |
| `progress.ready`、`progress.total`、`progress.completed` | 展示准备状态、“已完成 / 总请求”和进度条；兼容旧字段 `request_count`、`completed_count`。 |
| `finished_at` | 任务结束时间，Unix 秒；用于确定尾部曲线范围和停止曲线轮询。 |

两条回放曲线继续通过已有看板后端的 `GET /api/prometheus/query_range` 获取。每次分别查询处理和等待曲线，参数由前端自动生成：

| 参数 | 取值 |
| --- | --- |
| `query` | 下方 PromQL；任务提供其他部署标签时，一并加入筛选条件。 |
| `start` | 任务实际打流开始时间 `started_at`，Unix 秒。 |
| `end` | 运行中为 `max(started_at + 30, 当前 Unix 秒)`；结束后为 `finished_at + 30`。 |
| `step` | `max(5, ceil((end-start)/60))`，单位秒，约 60 个采样点。 |

```promql
sum by (model_name) (vllm:num_requests_running{model_name="实际指标模型名"})
sum by (model_name) (vllm:num_requests_waiting{model_name="实际指标模型名"})
```

这里恢复的是从实际开始时间到当前查询终点的整段指标，而不是只查询刷新后的新点。任务结束后，前端在当前时间超过 `finished_at + 60` 且当轮两条查询均无错误时停止曲线轮询。曲线能否完整恢复取决于任务接口返回的时间和标签是否正确，以及 Prometheus 是否仍保留相应时段的数据；共享实例的指标也可能包含其他流量。完整任务响应契约见 [回放接口文档](docs/replay-api.md)。

取消按钮仅在 `cancellable=true` 启用。`202` 进入 cancelling 后继续更新；`409 + task` 更新实际终态。旧轮询响应不能撤销取消或降低计数。已经提交给工作线程的请求仍可完成，进度不强制填满。

## 暂停/继续契约与取消流程（2026-10-14）

前端曾提供“暂停回放 / 继续回放”按钮，**已于 2026-10-16 移除**：前端不再发起 pause/resume 请求，回放进行中只有“取消回放”入口。仍保留对 `paused` 状态的识别——若后端已实现下述契约（或经 API 手动暂停），页面会如实显示“已暂停”、继续观测进度与曲线，并可取消；恢复打流需通过后端 API 调用 resume。以下契约、字段与补丁说明保留，供后端实现和手动调用参考。

暂停是停止提交新的回放请求；线程池中已经提交的请求（包括排队等待线程执行的请求）继续执行。因此暂停后，已有请求仍可能开始执行或完成，“已完成 / 总请求”和实例曲线仍可能变化。前端持续约 2 秒查询进度、30 秒查询曲线；这与后台调度是否暂停相互独立。

| 操作 | 前端请求 | 后端响应与行为 |
| --- | --- | --- |
| 暂停 | `POST /api/replays/{replay_id}/pause`，无需请求体 | `200` 返回 `status=paused` 的轻量任务；停止新调度提交。重复暂停返回同一任务，不重置暂停起点。 |
| 继续 | `POST /api/replays/{replay_id}/resume`，无需请求体 | `200` 返回原任务的 `queued` 或 `running` 状态；保留未发请求的剩余间隔，不补发暂停期间的流量。重复继续在 queued/running/draining 返回当前任务。 |
| 当前状态不允许操作 | 同上 | `409` 返回 `{"error":"...","task":{...}}`；前端按实际任务状态更新并显示错误。 |
| 任务不存在 / 认证无效 | 同上 | `404` / `401` JSON 错误；前端显示失败，继续尝试查询任务，不假装已暂停。 |

所有任务响应（创建、状态、活动任务、控制和冲突中的 task）补充如下字段。暂停和继续沿用原任务 ID、模型、倍速、计数、`started_at`，不创建新任务、不清空曲线，也不需要创建接口的 `Idempotency-Key`。

```json
{
  "status": "paused",
  "pausable": false,
  "resumable": true,
  "cancellable": true,
  "paused_at": 1791964800.25,
  "paused_seconds": 12.5,
  "revision": 42
}
```

`paused_at` 是当前暂停起点的 Unix 秒时间戳，继续时为 null；`paused_seconds` 是已结束的暂停累计秒数，不含当前尚未结束的暂停。`pausable` 仅在 queued/running 且仍有未提交请求时为 true；`resumable` 仅在 paused 为 true。preparing 尚在准备请求、draining 已全部提交、cancelling 和终态不支持暂停。暂停仍属于活动任务，会阻止新建回放；刷新后从 active 恢复为“已暂停”，需通过 API 继续恢复打流。manual 认证仍需刷新后重新填写密钥，proxy 模式自动认证；后端进程重启不支持继续暂停任务，会标记 failed。

前端可通过 `.env.local` 自定义这两条路径；Vite 的后端分流与代理认证也覆盖它们。修改后重新启动前端，生产部署需要重新构建；默认同源反向代理的 `/api/replays` 前缀已经包含它们。

```dotenv
VITE_REPLAY_PAUSE_PATH=/api/replays/{id}/pause
VITE_REPLAY_RESUME_PATH=/api/replays/{id}/resume
```

需要 Benchmark 修改的位置及原因（本次仅在本仓库提供补丁）：

| Benchmark 文件 / 函数 | 必要改动 |
| --- | --- |
| `app/benchmark/api.py`：`Handler.do_POST` | 新增 pause/resume 路由、状态校验、重复请求处理；cancel 唤醒暂停的调度线程；使用与调度提交相同的锁。 |
| `app/benchmark/api.py`：`ACTIVE_STATUSES`、`CANCELLABLE_STATUSES`、`public_job` | 将 paused 纳入活动/可取消集合；返回 pausable/resumable、暂停时间及累计时长，保持轻量任务格式。 |
| `app/benchmark/core.py`：`run_replay` | Condition 等待暂停/继续/取消，单调时钟扣除暂停时长，保留剩余调度间隔；最后一次提交与 draining 状态切换原子完成。 |
| `app/benchmark/core.py`：`register_job`、`initialize_state_db`、`update_job` | paused 阻止新任务、重启时标记失败、阻止后台状态更新撤销暂停或取消。 |

[暂停补丁](integration/benchmark-pause.patch) 依赖 [兼容补丁](integration/benchmark-replay.patch) 中的状态保护与轻量响应能力。两份补丁基于较早的 Benchmark 版本，旧版临时副本的验证结果不代表可以直接应用到当前 `ef22cd2`。后端维护方应先移植缺失的基础能力，再移植暂停逻辑，同时保留当前数字倍速和 burst 调度分支；不要直接执行旧 `git apply` 命令。

移植完成并通过后端隔离检查后再重启 Benchmark；Docker 需重建并部署后端镜像。保持当前 Benchmark 不变时，原有回放/普通取消仍可用，但不能暂停，取消与调度竞态也仍存在：取消受理后仍可能额外提交请求，严格保证需要后端修复，前端无法替代。

点击“取消回放”的完整流程：

1. 前端发送 `POST /api/replays/{replay_id}/cancel` 和回放认证头，期间禁用重复取消；请求失败时显示错误，不能据此认为后端已停止。
2. Benchmark 设置取消事件，返回 `202` 和 `status=cancelling`；修复竞态后，受理取消与提交共用锁，受理后不再向线程池提交新请求。这是在取消后端打流任务，曲线查询继续进行。
3. 已提交的请求继续执行，后端等待其结束或超时；前端继续读取最新计数，所以可能暂时显示“正在取消”。暂停中的任务也必须唤醒，才能完成取消收尾。
4. 后端返回 `status=cancelled`、`finished_at`；前端停止任务状态轮询，保留实际进度和已有曲线，不强制到 100%。曲线仍按原规则补查尾部指标。重复取消 cancelling 返回 202；任务已经结束返回 `409 + task`，前端展示实际终态。

验证：`npm test`、`npm run build`、`node scripts/proxy-check.cjs`。启动 4173 预览服务后运行 `node scripts/replay-latency-check.cjs` 与 `node scripts/replay-cache-check.cjs`，其中以后端直接返回 `paused` 状态验证“已暂停”显示与暂停期间持续观测；`replay-pause-check.cjs` 已随按钮移除删除。后端补丁验证命令 `python scripts/benchmark-pause-check.py <已应用两份补丁的Benchmark目录>` 使用临时状态库、真实本地 HTTP 接口和模拟工作线程，不发送真实推理请求。

浏览器仅持久化任务 ID、非敏感任务快照、历史窗口和显示偏好；待确认创建参数与幂等键存入 sessionStorage，刷新后通过“重试原创建请求”复用原请求，不生成新键。认证值不写入浏览器存储。`VITE_REPLAY_STORAGE_SCOPE` 用于隔离同一前端地址下的不同回放环境。

待确认创建只属于后端模式；切到演示模式不会消费或清除后端幂等记录。首次创建收到明确拒绝的 JSON 响应（如 400/422）后允许修改参数重新提交；网络结果未知时继续保留原请求，后续一次拒绝不能证明此前没有创建任务。恢复同一源/目标模型的任务时，历史查询使用任务已确认的指标名，并保留回放逻辑别名。回放指标查询失败时保留该曲线上次成功的数据；成功返回空数据时更新为空。图表工具栏仅提供横向选择与清除，清除会同步时间输入和回放按钮。

### 刷新后的认证值如何填写

认证值来自 **Benchmark 服务实际运行时配置的 `BENCHMARK_API_KEY`**，通常在 Benchmark 项目根目录的 `.env` 或部署环境变量中设置。它是保护创建、状态、活动任务及取消接口的独立密钥，不使用 LiteLLM 的 `LITELLM_MASTER_KEY`。只在前端填写任意新值不会生效，必须与后端的实际密钥一致；模板中的 `replace-with-a-long-random-secret` 应在部署时替换为实际密钥。

默认 `VITE_REPLAY_AUTH_MODE=manual`，页面刷新后按以下步骤填写：

1. 点击右上角“连接设置”或恢复提示中的“填写认证”。
2. “认证头”选择 `Authorization`；当前 Benchmark 不接受 `x-api-key` 或 `x-litellm-key`。
3. “认证值”填写 `Bearer`、一个空格、实际 `BENCHMARK_API_KEY`，不要加尖括号或引号，也不要填写 `BENCHMARK_API_KEY=`。页面不会自动添加 `Bearer` 前缀。
4. 点击“应用设置”，前端重新查询活动任务并恢复状态、进度和曲线，不重新创建任务。

例如，**仅说明格式的假密钥**为 `benchmark-example-key` 时，页面填写：

```text
Bearer benchmark-example-key
```

手动模式只把认证值保存在页面内存，不写入 localStorage/sessionStorage，因此每次刷新需要再次填写同一个密钥；不需要生成新的密钥。空值或错误密钥不能完成任务恢复，后端缺少或错误认证返回 HTTP 401。刷新本身不取消后端打流。

### 认证是否必需，以及如何免手动填写

**Benchmark 回放任务接口的认证必需；是否需要在页面手动填写取决于认证模式。** Prometheus 指标接口本身不需要 Benchmark 密钥，已有本地任务快照可用于重新查询曲线，但不能替代对最新任务状态的确认。

| 使用方式 | 是否需要页面填写认证值 |
| --- | --- |
| 演示模式 | 不需要，任务和数据在浏览器中模拟。 |
| 历史指标查询及 Prometheus 曲线查询 | 不需要 Benchmark 密钥，指标查询不携带该认证。 |
| 后端回放，`manual` 模式 | 需要，创建/恢复/进度查询/取消都使用该认证；刷新后重新填写。 |
| 后端回放，`proxy` 模式 | 不需要页面填写，但服务端代理必须注入与 Benchmark 一致的密钥。 |

需要刷新后自动恢复时，在前端未提交的 `.env.local` 中配置，并重新运行 `npm run dev`：

```dotenv
VITE_REPLAY_AUTH_MODE=proxy
REPLAY_BACKEND_URL=http://127.0.0.1:8088
BENCHMARK_API_KEY=实际Benchmark密钥
```

这里的 `BENCHMARK_API_KEY` 为与 Benchmark 一致的原始密钥，不加 `Bearer`；地址示例假设 Benchmark 与 Vite 同机。Vite 服务端仅向回放路由注入 `Authorization: Bearer 实际密钥`，密钥不进入浏览器构建，也不附加到 Prometheus 请求。仅在前端 `.env.local` 设置密钥、却继续使用 `manual` 模式，不会自动认证。Vite 绑定本机回环地址。生产静态站点必须在已有受控、带访问认证的同源反向代理中对回放路由注入该头；构建参数不会自动创建生产代理或用户会话，不能把携带服务密钥的代理公开成无认证接口。

当前 Benchmark 已原生返回数字或 burst 的 `speed`；递增 `revision`、轻量状态、取消与提交的原子互斥、后端 `BENCHMARK_MODEL_METRICS_MAP` 仍需按当前代码移植，旧兼容补丁仅作为参考。具体影响见“当前 Benchmark 对接检查与缺口”。浏览器刷新不停止后端任务；Benchmark 进程重启仍会使活动任务失败，未增加断点续跑。

验证命令：`npm run build`、`npm test`、`node scripts/replay-recovery-check.cjs`、`node scripts/replay-edge-check.cjs`、`node scripts/replay-progress-check.cjs`、`node scripts/proxy-check.cjs`。浏览器检查默认使用本地 4173 预览服务。后端隔离验证：`python scripts/benchmark-replay-check.py D:/ai_workspace/Benchmark`，只使用临时任务库和本地模拟请求，不访问真实模型。
