# TrafficReplay

React + TypeScript + ECharts 前端。默认演示模式；演示曲线和回放任务均为模拟数据。

这是纯前端工程，不包含看板后端、请求档案、回放调度器或 Prometheus/vLLM/LiteLLM 服务。Vite 仅用于本地开发、构建和预览，以及将本地 API 请求代理到已有看板后端。GitHub 保存源码，不会代替后端执行流量回放。

页面时间统一按 Asia/Shanghai 显示，时间输入按 UTC+08:00 转换为 Unix 秒级时间戳，不依赖浏览器时区。历史查询支持 15 分钟、30 分钟、1 小时、6 小时、12 小时、24 小时、7 天，可配合截止时间查询更早的区间。各范围保持约 60 个点；7 天的查询步长为 10080 秒。跨日图表显示日期与时间。真实数据覆盖范围取决于 Prometheus 保留时间，请求回放覆盖范围取决于后端请求档案。

## 数据来源与流向

```text
模型配置：LiteLLM → 看板后端 /api/litellm/model/info
                  → data.ts / adaptModels → App.models → 模型下拉框

历史曲线：vLLM /metrics → Prometheus → 看板后端 /api/prometheus/query_range
                      → data.ts / parseMatrix → App.history → 左侧 LoadChart

即时卡片：Prometheus → 看板后端 /api/prometheus/query
                   → data.ts / parseVector → App.metrics → 顶部指标卡

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
| src/apiConfig.ts | 接口路径配置、LiteLLM 逻辑模型名到 vLLM 指标标签的显式映射 |
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
Set-Location 'C:\Users\Chisato\Documents\Codex\2026-10-10\xian-z\outputs\llm-dashboard'
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
VITE_MODEL_INFO_PATH=/api/litellm/model/info
VITE_MODEL_METRICS_MAP='{}'
VITE_REPLAY_CREATE_PATH=/api/replays
VITE_REPLAY_STATUS_PATH=/api/replays/{id}
```

地址填写另一台电脑能访问的看板后端地址，不是 Prometheus、LiteLLM 或 vLLM 地址。后端位于其他机器时，不应填写 127.0.0.1。修改连接配置后重启 `npm run dev`。页面选择“后端”，在连接设置中填写所需认证头和值，再确认模型列表、历史指标和回放接口可用。

后续同步源码：`git pull`、`npm ci`，然后重新启动。自己的 .env.local 不进入 Git，因此不会被其他电脑的连接配置替换。

scripts/test.cjs 支持 npm test；浏览器检查脚本目前默认使用 Windows Chrome 路径和 4173 端口，其他电脑运行这些可选检查前需要按实际浏览器与预览端口调整。日常启动页面不依赖这些脚本。

## 后端连接

将 `.env.example` 复制为 `.env.local`，配置 `BACKEND_URL=http://<BACKEND_IP>:<BACKEND_PORT>`，重启服务。页面选择“后端”，在右上角连接设置中配置认证头和值。凭据只保存在内存中。生产部署通过反向代理将 `/api` 路由到看板后端。

`BACKEND_URL` 用于 Vite 本地代理，不会将后端地址写入生产页面。生产部署需将 `npm run build` 生成的 dist/ 放到静态服务，并配置 `/api` 反向代理；不能只把 dist/ 放到 GitHub Pages 后期望其自动连接后端。

默认路径为 `/api/prometheus/query`、`/api/prometheus/query_range` 和 `/api/litellm/model/info`。Prometheus 前缀可通过 `VITE_PROMETHEUS_API_PREFIX` 配置，模型路径可通过 `VITE_MODEL_INFO_PATH` 配置；均使用以 `/api/` 开头的同源路径。指标按 30 秒刷新，隐藏页面暂停；历史截止时间固定后不自动刷新。同一 Prometheus URL 在前端缓存并去重 30 秒，429 后共享退避 60 秒。不同指标查询使用 allSettled 隔离失败，保留 NaN 和 Inf。

### 模型列表可加载，但指标提示 404

`BACKEND_URL` 决定请求发往哪台看板服务器，接口路径决定由该服务器哪个路由处理。能加载模型列表只证明 LiteLLM 透传路由可达，不能证明 Prometheus 路由存在。默认代理不移除 `/api`，通常应将 BACKEND_URL 填为 `http://<BACKEND_IP>:<BACKEND_PORT>`，不要再追加 `/api`。若后端本身安装在子路径，应按实际部署调整代理，不能直接套用此默认配置。

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

### 模型列表与指标模型名的对应关系

下拉框取 LiteLLM `/model/info` 响应的 `data[].model_name`，同名部署合并为一个逻辑模型。它表示网关别名，不一定等于 vLLM 暴露的 `model_name`，也不一定等于 `litellm_params.model`。目前不会根据 provider 前缀自动推断这个对应关系。

先用已确认的 query 路由查询 `count by (model_name) (vllm:num_requests_running)`，查看 Prometheus 返回的真实标签。若逻辑别名为 `qwen-service`，真实标签为 `Qwen/Qwen3-32B`，则配置：

```dotenv
VITE_MODEL_METRICS_MAP='{"qwen-service":"Qwen/Qwen3-32B"}'
```

这个示例仅说明格式，必须替换为部署的真实名称。映射优先于响应的 `metrics_model_name` / `model_info.metrics_model_name`，未映射时使用响应中的指标名，仍未提供时回退逻辑模型名。映射只影响指标筛选：下拉框和回放请求的 model_id 仍为 `qwen-service`。合并同名实例会保留已有元数据；实例声明的指标名冲突时会明确报错。

如果下拉框本身出现不应有的模型，或字段/分组结构不同，需要拿脱敏的 `/api/litellm/model/info` JSON 样例修改 `adaptModels` 或后端配置；指标名映射不会过滤或重命名列表。不要把 `model_info.id`（实例 ID）直接当成逻辑模型名，除非回放后端明确约定如此。

路由成功但指标为空时，再核对 vLLM 是否已被采集、时间范围、实际指标名和模型标签。当前延迟卡使用 `[1m]` 窗口，若 scrape interval 过长，应增大 `metricQueries` 中的 rate 窗口；缓存指标名也需与部署版本核对。这些问题通常表现为空结果或查询错误，与 `API route not found` 是不同层次。

## 待联调的约定

- 模型配置适配：`src/data.ts` 的 `adaptModels`，目前接受数组或 `{ data: [{ model_name, litellm_params, model_info }] }`，相同名称合并为一个下拉项。可通过 `metrics_model_name`、`model_info.metrics_model_name` 或 `VITE_MODEL_METRICS_MAP` 映射 vLLM 标签。需要实际 JSON 样例确认。
- 指标清单和 PromQL 在 `src/data.ts` 的 `loadQueries`、`metricQueries`。延迟按分片均值平均，计数器先 rate 再 sum；缓存先分别 sum 再相除。prefix cache 指标名称须与当前 vLLM 版本核对。卡片为当前指标，不是所选历史区间的汇总。
- 回放创建默认 `POST /api/replays`，请求体 `{ model_id, start_time, end_time }`，Unix 秒，左闭右开。返回 `{ replay_id, status, started_at?, request_count?, target?: { metrics_labels } }`。
- 状态接口默认 `GET /api/replays/{id}`，返回 `{ status, started_at?, finished_at?, request_count?, sent_count?, completed_count?, target?: { metrics_labels } }`。状态支持 queued/preparing/running/draining/succeeded/failed/cancelled。`finished_at` 为全部请求处理完成时间。两个回放路径可通过 VITE_REPLAY_CREATE_PATH / VITE_REPLAY_STATUS_PATH 配置。
- 接口尚未接真实后端；创建回放响应缺少 replay_id 会明确报错。未知实际开始时间时，前端不会用点击时间替代。

切换模型会清空历史选区，但保留已创建任务的模型。两个图窗使用相同纵轴上限；回放窗口可切换相对时间，历史窗口仍保留绝对时间。相对横轴从实际回放开始的 0 起算，使用数值轴；不足一分钟显示秒，较长区间显示分:秒或时:分:秒，tooltip 同时保留实际时刻。该开关只影响显示，不改变查询或回放参数。每次只创建一个活动任务。

## 限制

回放状态接口为拟定契约，需后端实现。共享实例曲线包含其他流量，不能仅凭 model_name 区分回放来源。生产环境需要配置可区分部署的指标标签。花费卡、投机解码和模型实例树未在首版接入。

## 已完成验证

TypeScript 与生产构建通过；17 项解析、接口配置、缓存、模型映射、时间轴及时区测试通过。浏览器验证覆盖拖拽选区、模型切换、固定回放模型、手机宽度、相对时间秒刻度和 tooltip、切回绝对时间、运行时错误，以及使用模拟 HTTP 响应的后端路径、NaN 显示和三字段回放请求。另用独立构建验证 `/api/prometheus` 前缀、自定义模型列表路径和逻辑别名到指标名映射，回放提交仍保留逻辑模型 ID。尚未连接真实后端。

