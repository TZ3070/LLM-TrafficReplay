# TrafficReplay

React + TypeScript + ECharts 前端。默认演示模式；演示曲线和回放任务均为模拟数据。

这是纯前端工程，不包含看板后端、请求档案、回放调度器或 Prometheus/vLLM/LiteLLM 服务。Vite 仅用于本地开发、构建和预览，以及将本地 API 请求代理到已有看板后端。GitHub 保存源码，不会代替后端执行流量回放。

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

创建回放：左侧刷选 / 时间输入 → App.selection
        → POST /api/replays { model_id, start_time, end_time }
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
| src/chartTime.ts、src/time.ts | Unix 秒与图表坐标、相对时间、上海时间输入/显示之间的转换 |
| vite.config.mjs | 本地同源请求到看板后端的代理 |

演示模式使用 demoModels、固定卡片值和 demoLoad，不调用真实模型。demoLoad 一次生成整个窗口的模拟点；演示任务固定 45 秒完成、每 3 秒刷新，与历史选区时长无关。后端模式每 30 秒轮询，实际状态与时间均来自后端，没有 45 秒自动完成规则。

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
VITE_PROMETHEUS_API_PREFIX=/api/prometheus
VITE_MODEL_METRICS_MAP='{}'
VITE_REPLAY_CREATE_PATH=/api/replays
VITE_REPLAY_STATUS_PATH=/api/replays/{id}
```

地址填写另一台电脑能访问的看板后端地址，不是 Prometheus、LiteLLM 或 vLLM 地址。后端位于其他机器时，不应填写 127.0.0.1。修改连接配置后重启 `npm run dev`。页面选择“后端”，先确认 Prometheus 模型列表与历史指标。只有需要认证的回放接口才在连接设置中填写所需认证头和值；模型列表和指标查询无需 LiteLLM 认证。

后续同步源码：`git pull`、`npm ci`，然后重新启动。自己的 .env.local 不进入 Git，因此不会被其他电脑的连接配置替换。

scripts/test.cjs 支持 npm test；浏览器检查脚本目前默认使用 Windows Chrome 路径和 4173 端口，其他电脑运行这些可选检查前需要按实际浏览器与预览端口调整。日常启动页面不依赖这些脚本。

## 后端连接

将 `.env.example` 复制为 `.env.local`，配置 `BACKEND_URL=http://<BACKEND_IP>:<BACKEND_PORT>`，重启服务。页面选择“后端”即可查询 Prometheus 模型列表和指标；回放接口需要认证时在右上角设置中配置认证头和值。凭据只保存在内存中。生产部署通过反向代理将 `/api` 路由到看板后端。

`BACKEND_URL` 用于 Vite 本地代理，不会将后端地址写入生产页面。生产部署需将 `npm run build` 生成的 dist/ 放到静态服务，并配置 `/api` 反向代理；不能只把 dist/ 放到 GitHub Pages 后期望其自动连接后端。

模型列表和即时卡片使用 `/api/prometheus/query`，负载曲线使用 `/api/prometheus/query_range`。Prometheus 前缀可通过 `VITE_PROMETHEUS_API_PREFIX` 配置；均使用以 `/api/` 开头的同源路径。旧的 `VITE_MODEL_INFO_PATH` 仅保留兼容配置，首页已不调用 LiteLLM 模型列表接口。指标按 30 秒刷新，隐藏页面暂停；历史截止时间固定后不自动刷新。同一 Prometheus URL 在前端缓存并去重 30 秒，429 后共享退避 60 秒。不同指标查询使用 allSettled 隔离失败，保留 NaN 和 Inf。

首页五张延迟卡片 TTFT、E2E、ITL、TPOT、QT 都使用即时 `GET /api/prometheus/query`，每张卡独立发送一条 PromQL。TTFT/E2E/ITL/QT 使用 rate(_sum)/rate(_count)；TPOT 使用解码耗时率除以生成 token 率减请求率，减法置于分母括号内。各表达式未加外层 avg。响应中的同模型、同 role 的 engine 延迟在前端求算术平均，PD 的 prefill/decode 保留为独立行；单条已聚合的结果直接取值，NaN/Inf 保留且参与运算。表达式内核为 `rate(<metric>_sum{model_name="当前模型"}[<历史范围>]) / rate(<metric>_count{model_name="当前模型"}[<历史范围>])`；例如选择 12 小时，窗口就是 `[12h]`。后端接收完整 query，在看板后端的 TTL 缓存中按 URL 缓存，再请求 `${PROMETHEUS_TARGET}/api/v1/query`。因此这些卡片没有值时，应先看 Network 中的 query、HTTP 响应和 `data.result`，再区分路由错误、指标名错误、模型标签不匹配和窗口内没有样本。

卡片的评估时刻是现在，修改历史截止时间不会把即时 query 的评估时刻移到过去；它只调整左侧 query_range。拖拽回放子区间也不改变延迟卡的回溯长度。模型或历史范围切换时清空旧卡片并重新查询，旧模型尚未完成的响应不会覆盖新模型数据。历史曲线与即时卡片并发加载，卡片独立显示加载、空样本、NaN 和可展开的查询错误。首页只查询这五项延迟指标，整个历史查询刷新共发 2 条区间曲线和 5 条即时指标请求；首次模型发现另发 1 条，页面每 30 秒刷新指标。模型列表通过“刷新列表”按钮更新，同样受 30 秒缓存限制，不持续轮询。

默认指标名已按旧看板提供的表达式配置：TTFT `vllm:time_to_first_token_seconds`、E2E `vllm:e2e_request_latency_seconds`、ITL `vllm:inter_token_latency_seconds`、QT `vllm:request_queue_time_seconds`。TPOT 为 `rate(vllm:request_decode_time_seconds_sum[窗口]) / (rate(vllm:request_generation_tokens_sum[窗口]) - rate(vllm:request_generation_tokens_count[窗口]))`，三项均附加当前模型筛选。分母为 0 时保留 Prometheus 返回的 NaN/Inf，不替换为 0。

例如部署的 ITL 名称为其他指标时，在 .env.local 中配置 `VITE_PROMETHEUS_METRIC_NAMES='{"itl":{"sum":"custom:itl_sum","count":"custom:itl_count"}}'`，修改后重新构建。示例中的 custom 名称仅说明格式，不能直接用于真实部署。TPOT 覆盖配置必须包含 decodeSum、generationTokensSum、generationTokensCount 三个完整指标名，例如 `{"tpot":{"decodeSum":"vllm:request_decode_time_seconds_sum","generationTokensSum":"vllm:request_generation_tokens_sum","generationTokensCount":"vllm:request_generation_tokens_count"}}`。

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
- 回放创建默认 `POST /api/replays`，请求体 `{ model_id, start_time, end_time }`，Unix 秒，左闭右开。返回 `{ replay_id, status, started_at?, request_count?, target?: { metrics_labels } }`。
- 状态接口默认 `GET /api/replays/{id}`，返回 `{ status, started_at?, finished_at?, request_count?, sent_count?, completed_count?, target?: { metrics_labels } }`。状态支持 queued/preparing/running/draining/succeeded/failed/cancelled。`finished_at` 为全部请求处理完成时间。两个回放路径可通过 VITE_REPLAY_CREATE_PATH / VITE_REPLAY_STATUS_PATH 配置。
- 接口尚未接真实后端；创建回放响应缺少 replay_id 会明确报错。未知实际开始时间时，前端不会用点击时间替代。

切换模型会清空历史选区，但保留已创建任务的模型。两个图窗使用相同纵轴上限；回放窗口可切换相对时间，历史窗口仍保留绝对时间。相对横轴从实际回放开始的 0 起算，使用数值轴；不足一分钟显示秒，较长区间显示分:秒或时:分:秒，tooltip 同时保留实际时刻。该开关只影响显示，不改变查询或回放参数。每次只创建一个活动任务。

## 限制

回放状态接口为拟定契约，需后端实现。共享实例曲线包含其他流量，不能仅凭 model_name 区分回放来源。生产环境需要配置可区分部署的指标标签。花费卡、投机解码和模型实例树未在首版接入。

## 已完成验证

TypeScript 与生产构建通过；23 项解析、接口配置、缓存、模型映射、时间轴及时区测试通过。浏览器验证覆盖拖拽选区、模型切换、固定回放模型、手机宽度、相对时间秒刻度和 tooltip、切回绝对时间、运行时错误，以及使用模拟 HTTP 响应的后端路径、NaN 显示和三字段回放请求。scripts/latency-check.cjs 另验证五条独立延迟 query、当前模型和历史范围过滤、旧响应隔离、慢历史查询隔离、部分失败详情与空样本，以及 PD 角色独立显示、engine 均值、模型重命名后的列表更新和成功空结果清理。尚未连接真实后端。

