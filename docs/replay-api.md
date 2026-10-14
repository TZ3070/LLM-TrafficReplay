# TrafficReplay 流量回放接口对接文档

本文依据当前前端 `src/App.tsx`、`src/replay.ts`、`src/data.ts` 和 `src/types.ts` 编写。回放接口已适配独立 Benchmark 后端，指标接口使用已有看板后端；真实部署地址与认证仍需联调，文档不表示已连接真实服务。

## 1. 功能与接口范围

用户选择一个模型，在历史处理/等待曲线中拖选区间，再确认回放。前端提交模型、历史开始时间、历史结束时间及倍速。后端查询完整请求档案，按照原始请求间隔除以倍速，将这段流量重新发送给该模型当前优化后的部署。

创建任务采用异步方式：接口返回任务 ID，后台继续检索、调度和发送请求。前端通过状态接口获取实际打流时间，再使用已有 Prometheus 接口查询回放后的曲线。

| 接口 | 方法 | 用途 | 对接范围 |
| --- | --- | --- | --- |
| `/api/replays` | POST | 创建回放任务，返回任务 ID | Benchmark 提供 |
| `/api/replays/active?view=status` | GET | 恢复当前活动任务 | Benchmark 提供 |
| `/api/replays/{id}/cancel` | POST | 请求取消任务 | Benchmark 提供 |
| `/api/replays/{id}/pause`、`/resume` | POST | 暂停/继续任务 | 前端已接入，Benchmark 需新增 |
| `/api/replays/{id}` | GET | 查询状态、计数、实际开始/结束时间、目标指标标签 | Benchmark 提供 |
| `/api/prometheus/query_range` | GET | 查询历史及回放后的处理/等待曲线 | 使用已有接口 |
| `/api/prometheus/query` | GET | 模型发现及五项即时延迟查询 | 使用已有接口 |

前端已支持倍速、活动任务恢复、进度、取消、暂停/继续及刷新后的曲线重建；暂停/继续需要后端实现第 13 节的契约，没有完整任务列表。手动认证刷新后重新输入密钥即可恢复，服务端代理认证模式可自动恢复。

```mermaid
sequenceDiagram
    participant F as 前端
    participant B as Benchmark 回放后端
    participant Q as 已有看板后端
    participant A as 请求档案
    participant M as 同模型优化后的部署
    participant P as Prometheus
    F->>B: POST /api/replays（模型、历史开始/结束时间）
    B-->>F: 202（replay_id、queued）
    B->>A: 按模型和历史时间检索完整请求
    B->>M: 按原始时间间隔按所选倍速发送请求
    M-->>B: 推理响应/流式响应结束
    P->>M: 周期采集 /metrics
    F->>B: GET /api/replays/{id}
    B-->>F: 状态、实际时间、计数、目标标签
    F->>Q: GET /api/prometheus/query_range
    Q->>P: /api/v1/query_range
    P-->>Q: 原样 matrix JSON
    Q-->>F: 原样 matrix JSON
```

## 2. 公共约定

### 2.1 地址与时间

- 看板后端：`http://<DASHBOARD_BACKEND_IP>:<DASHBOARD_BACKEND_PORT>`。
- LiteLLM：`http://<LITELLM_IP>:<LITELLM_PORT>`；vLLM：`http://<VLLM_IP>:<VLLM_PORT>`。这些打流地址和服务凭据由后端维护。
- Prometheus：`http://<PROMETHEUS_IP>:<PROMETHEUS_PORT>`，由已有看板后端代理。
- 浏览器请求同源 `/api/...`；本地由 Vite 代理，生产由静态服务反向代理。
- 所有接口时间字段为 JSON number，单位为 Unix **秒**。本次契约使用整数秒，不传 JavaScript 毫秒，也不传日期文本。
- 回放档案过滤区间为 `[start_time, end_time)`：包含开始，不包含结束。后端可保留档案原始时间的毫秒精度来调度请求，不必将请求时间取整。
- 页面按 `Asia/Shanghai` 展示和解释输入；时间戳本身无时区歧义。

示例时间：`1791770400` 对应上海时间 `2026-10-12 10:00:00`；`1791771000` 对应 `2026-10-12 10:10:00`。

### 2.2 请求头与认证

创建接口发送：

```http
Content-Type: application/json
Idempotency-Key: <UUID>
```

若在页面“连接设置”输入了认证值，POST 和状态 GET 会携带所选的一种认证头：

```http
Authorization: Bearer <TOKEN>
```

或 `x-api-key: <KEY>`，或 `x-litellm-key: <KEY>`。页面只发送选中的一种；没有填写认证值则不发送。后端按自己的认证规则校验，并建立到 LiteLLM/vLLM 的调用权限。

连接设置默认选择 `Authorization`。独立 Benchmark 仅接受 `Authorization: Bearer <BENCHMARK_API_KEY>`；认证值需手动填写 `Bearer ` 加服务端密钥实际值，不带尖括号，前端不会自动补前缀。LiteLLM Master Key 由 Benchmark 后端维护。

Prometheus 查询不携带这些认证头。`Idempotency-Key` 只随创建 POST 发送。

回放成功响应为直接 JSON 对象，不能包装成 `{ "data": { ... } }`。任务状态接口建议返回 `Cache-Control: no-store`，不要套用 Prometheus 的 30 秒查询缓存。前端单次 HTTP 请求超时为 **20 秒**。

## 3. 创建回放任务

### 3.1 请求

```http
POST /api/replays
```

```json
{
  "model_id": "DeepSeek-R1",
  "start_time": 1791770400,
  "end_time": 1791771000,
  "speed": 1
}
```

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `model_id` | string | 是 | 所选逻辑模型；默认就是下拉框中的 Prometheus `model_name`，配置映射时为回放别名 |
| `start_time` | number | 是 | 历史区间开始，Unix 整数秒 |
| `end_time` | number | 是 | 历史区间结束，Unix 整数秒，必须大于开始 |
| `speed` | number | 前端始终发送 | 有限正数；控件提供 0.5、1、2、5、10，默认 1 |

当前前端发送这四个字段，不发送目标 IP、部署实例或完整请求内容。倍速只缩放发送间隔，不修改推理耗时；1× 表示原速。后端必须将逻辑模型解析为优化后的目标路由，并在任务创建时保存目标快照，避免任务运行期间配置变化导致打流目标漂移。

### 3.2 响应

推荐返回 `202 Accepted`，表示任务已受理，执行尚未完成。当前前端也能解析其他正常的 2xx JSON 响应。

```json
{
  "replay_id": "replay-20261012-0001",
  "model_id": "DeepSeek-R1",
  "source_model": "DeepSeek-R1",
  "target_model": "DeepSeek-R1",
  "start_time": 1791770400,
  "end_time": 1791771000,
  "speed": 1,
  "status": "queued",
  "cancellable": true,
  "revision": 1,
  "target": {
    "metrics_labels": {
      "model_name": "DeepSeek-R1",
      "deployment": "deepseek-optimized"
    }
  }
}
```

| 字段 | 类型 | 对接要求 | 含义 |
| --- | --- | --- | --- |
| `speed` | number | 返回创建时固定倍速 | 有限正数，恢复时不依赖控件当前值 |
| `cancellable` | boolean | 返回是否可取消 | cancelling 和终态为 false |
| `revision` | number | 推荐返回递增版本 | 拒绝迟到的旧快照 |
| `replay_id` | string | 必须返回非空任务 ID | 后续状态 GET 的路径参数；不能改名为 `id` 或 `task_id` |
| `status` | string | 应返回 | 使用第 5 节中的固定英文状态；通常是 `queued` 或 `preparing` |
| `started_at` | number | 实际发送开始后才返回 | 第一个回放请求实际发出的时间，Unix 秒 |
| `request_count` | number | 数量确定后返回 | 本任务实际纳入回放的总请求数；尚未确定时省略 |
| `target.metrics_labels` | object | 可选，推荐返回 | Prometheus 中定位优化后目标部署的标签，值均为字符串 |

任务没有开始时省略 `started_at`，不要填写按钮点击时间或预计开始时间。不要为未知总请求数填写 `0`；`0` 表示确实没有请求。

### 3.3 幂等语义

前端在相同模型、时间与倍速条件的创建失败后重试时复用 `Idempotency-Key`。创建成功后再次进行回放会生成新键。

后端需要实现以下行为，不能仅接收请求头后忽略它：

| 情况 | 后端行为 |
| --- | --- |
| 相同键、相同有效参数 | 返回原任务 ID；不能再创建任务或再打一次流 |
| 相同键、不同有效参数 | 返回 `409 Conflict` |
| 不同键、相同请求体 | 可以作为新的实验创建任务，受后端并发策略约束 |

幂等记录、任务创建和调度入队要避免并发重复；可采用数据库唯一约束和事务/可靠队列。幂等记录应覆盖客户端重试期及任务运行期，不能沿用 30 秒指标缓存 TTL。

如果 POST 在浏览器 20 秒超时前没有返回，但后端已经创建了任务，下一次同键请求必须仍返回这个任务。创建接口应尽快返回，不应等待数分钟/数小时的回放全部结束。

## 4. 查询任务状态

### 4.1 请求

```http
GET /api/replays/replay-20261012-0001
```

`{id}` 为创建响应的 `replay_id`；前端插入路径前会进行 URL 编码。没有请求体，不需要传历史时间或再次传模型。

### 4.2 运行中响应

```json
{
  "replay_id": "replay-20261012-0001",
  "model_id": "DeepSeek-R1",
  "source_model": "DeepSeek-R1",
  "target_model": "DeepSeek-R1",
  "start_time": 1791770400,
  "end_time": 1791771000,
  "speed": 1,
  "status": "running",
  "cancellable": true,
  "revision": 24,
  "started_at": 1791774000,
  "request_count": 1200,
  "sent_count": 600,
  "completed_count": 560,
  "target": {
    "metrics_labels": {
      "model_name": "DeepSeek-R1",
      "deployment": "deepseek-optimized"
    }
  }
}
```

### 4.3 完成响应

```json
{
  "replay_id": "replay-20261012-0001",
  "model_id": "DeepSeek-R1",
  "source_model": "DeepSeek-R1",
  "target_model": "DeepSeek-R1",
  "start_time": 1791770400,
  "end_time": 1791771000,
  "speed": 1,
  "status": "succeeded",
  "cancellable": false,
  "revision": 60,
  "started_at": 1791774000,
  "finished_at": 1791774620,
  "request_count": 1200,
  "sent_count": 1200,
  "completed_count": 1200,
  "target": {
    "metrics_labels": {
      "model_name": "DeepSeek-R1",
      "deployment": "deepseek-optimized"
    }
  }
}
```

| 字段 | 类型 | 对接要求 | 含义 |
| --- | --- | --- | --- |
| `status` | string | 每次必填 | 当前状态；未知状态会触发前端错误 |
| `replay_id` | string | 必须返回 | 创建、恢复和状态校验使用同一任务 ID |
| `model_id` / `target_model` | string | 必须返回其一 | 固定目标模型 |
| `source_model` | string | 推荐返回 | 原始请求来源模型，省略时回退目标模型 |
| `start_time` / `end_time` | number | 必须返回 | 恢复原历史区间 |
| `speed` / `cancellable` / `revision` | number / boolean / number | 与创建响应保持一致 | 固定倍速、取消能力及快照版本 |
| `started_at` | number | 开始后每次返回 | 必须保持实际开始时间一致，不能在后续响应中省略 |
| `finished_at` | number | 终态且工作已结束时返回 | 成功时为最后一个请求响应处理完毕的时间；失败/取消时为任务实际停止且在途请求已结束或被终止的时间 |
| `request_count` | number | 确定后每次返回 | 纳入回放的总数 |
| `sent_count` | number | 开始计数后每次返回 | 已发出的唯一原始请求数；内部重试次数不重复累计 |
| `completed_count` | number | 开始计数后每次返回 | 已结束处理的请求数，建议包含已取得最终结果的成功、错误或超时请求 |
| `target.metrics_labels` | object | 与创建响应保持一致 | 定位目标部署；建议每次返回 |

正常计数应满足 `0 <= completed_count <= sent_count <= request_count`，且已确定的计数不倒退。内部重试等额外诊断计数可另加字段，不要改变上述计数的语义。建议全部成功才使用 `succeeded`；部分失败时如何判定任务结果需要后端确定并保持一致。

创建和状态响应使用同一个适配器。优先读取 `progress.total/completed/sent/skipped`，兼容顶层计数字段；`progress.ready=false`、`total=null` 表示还在准备。未知或省略的字段不清空已知数据，后端仍建议每次返回完整的已知快照。时间/计数未知时应省略顶层字段，不使用 `0` 表示未知。

模型名称下方显示完成数量、总数、进度条、百分比、发送数量、失败/跳过数量和最近成功接收时间。比例由 `completed / total` 计算；总数未知或为零时不显示百分比，也不强制以任务结束将进度填为 100%。

前端展示 `failed_count`、`skipped_count` 和任务 `error`。返回 `200` 和 `status: "failed"` 会显示任务失败与具体原因；已完成数量包含失败请求，100% 不代表任务成功。不要用 HTTP `500` 代替可正常读取的任务失败状态。

## 5. 状态和执行规则

| 状态 | 页面文字 | 后端含义 |
| --- | --- | --- |
| `queued` | 等待开始 | 已入队，等待执行 |
| `preparing` | 准备请求 | 检索档案、核对路由、准备调度 |
| `running` | 回放中 | 已开始发流，仍有请求尚未发送 |
| `paused` | 已暂停 | 停止新调度提交，已提交请求可继续完成；仍为活动任务 |
| `draining` | 等待处理完成 | 请求发送完毕，等待在途推理/流式响应结束 |
| `cancelling` | 正在取消 | 等待已提交请求结束；前端继续查询，取消按钮禁用 |
| `succeeded` | 已完成 | 任务成功结束 |
| `failed` | 失败 | 任务执行失败，执行工作已终止 |
| `cancelled` | 已取消 | 任务被取消，执行工作已终止 |

Benchmark 典型过程为 `preparing → queued → running → draining → succeeded`；失败和取消可从非终态进入。终态不能再退回运行状态。

后端以档案中的原始请求到达时间计算调度偏移。例如历史区间 `[10:00:00, 10:10:00)` 内两个请求分别在 `10:00:05`、`10:00:08` 到达，应保留 3 秒间隔。建议以首个纳入回放的请求为调度零点：若首个请求实际于 `11:00:00` 发出，第二个应计划于 `11:00:03` 发出，`started_at` 就是 `11:00:00`。

这会省略选区起点到首个请求之间的空闲时间；当前前端没有“保留起始空闲”开关。请求间的内部空闲间隔应保留，发送采用并发调度，不能等待前一个推理完成后再发送下一个请求。若限速/并发上限导致无法维持原始节奏，应记录该偏差供实验解释。

历史流量和当前路由均以同一个逻辑模型匹配。模型改名后，后端需维护历史档案名称与当前服务名称的对应关系。Prometheus 保存的是指标，不含完整推理请求；回放必须依赖已有请求档案中的请求时间、请求体、路由所需信息，以及原请求使用的流式/非流式等配置。调用凭据由后端选取当前有效配置。

对于流式请求，应等到响应流结束或明确失败才计入 `completed_count`。全部请求发出只能进入 `draining`，不能立即标为完成。后端可以自行设置超时规则，当前前端不会按 45 秒或历史区间长度判定生产任务完成。

## 6. 模型名称与目标指标标签

当前下拉框来自 Prometheus：

```promql
count by (model_name) (vllm:num_requests_running)
```

默认 `model_id` 等于发现的 `model_name`。若 LiteLLM/档案使用逻辑别名，可在 `.env.local` 配置：

```dotenv
VITE_MODEL_METRICS_MAP='{"deepseek-service":"DeepSeek-R1"}'
```

下拉框和历史指标使用 `DeepSeek-R1`；创建请求提交 `model_id: "deepseek-service"`。后端将该别名同时关联到历史档案和当前优化部署。

若优化后的 Prometheus 模型名变为 `DeepSeek-R1-v2`，后端可以返回：

```json
{
  "target": {
    "metrics_labels": {
      "model_name": "DeepSeek-R1-v2",
      "deployment": "deepseek-optimized"
    }
  }
}
```

回放右侧查询优先使用这里的 `model_name`，因此当前前端支持优化部署的指标名称变化。其他标签会追加为等值匹配条件。标签必须真实存在于两项 vLLM 指标中；随意增加 `replay_id`、部署标签或不存在的标签会导致空结果。

不返回标签时，前端使用创建任务时保存的指标模型名，汇总该模型所有匹配序列。若同一模型同时有多个部署，推荐返回能覆盖整套目标部署的标签。DeepSeek PD 部署不应只过滤单一 `role` 或 `engine`，否则只显示一个阶段/分片；应使用可覆盖 proxy/prefill/decode 的共同部署标签。

## 7. 前端如何获取回放曲线

当前前端立即显示创建响应并发起一次状态查询，此后活动任务在上次请求完成后约 **2 秒**再次查询；同一任务不重叠发起状态请求。查询失败保留上次数据和更新时间，按 5/10/20/30 秒退避，429 使用 Retry-After，缺省退避 60 秒。页面隐藏时暂停，恢复前台后立即尝试刷新（仍遵守错误退避）。收到终态后停止状态查询，即使任务没有 `started_at`。

曲线刷新与状态查询分开执行。尚无 `started_at` 时不查询曲线，但已知总数会显示在进度区和图表占位区；总数未知显示正在统计，提前失败/取消显示结束原因。较慢的指标请求不阻塞任务进度更新。

收到实际开始时间后，以它作为固定起点，查询已有 `/api/prometheus/query_range`：

```promql
sum by (model_name) (
  vllm:num_requests_running{
    model_name="DeepSeek-R1",
    deployment="deepseek-optimized"
  }
)
```

```promql
sum by (model_name) (
  vllm:num_requests_waiting{
    model_name="DeepSeek-R1",
    deployment="deepseek-optimized"
  }
)
```

对应请求参数：

```text
start = started_at
end   = 有 finished_at 时：finished_at + 30
        没有 finished_at 时：max(started_at + 30, 当前 Unix 秒)
step  = max(5, ceil((end - start) / 60))
```

两项 gauge 按所有匹配的 role/engine 求和，各展示一条曲线。开始后最少先显示 30 秒窗口；查询结束点可能短暂在未来，真实 Prometheus 的未来区间没有真实样本，前端不会把它变成模拟数据。

后端返回原样 Prometheus matrix，不要将任务响应包装成 Prometheus 格式，也不需要新增“回放曲线接口”。相对时间勾选框只把横轴转换为 `timestamp - started_at`，不修改接口时间参数。

如果后端缓存 `query_range`，缓存键必须包含 `query`、`start`、`end`、`step`。仅以 PromQL 为键会混淆同模型的历史窗口和回放窗口。当前前端自身按完整 URL 去重并缓存 30 秒。

收到实际开始/结束时间时立即刷新一次曲线，运行时曲线独立每 30 秒刷新。前端在有 `finished_at`、当前时间超过 `finished_at + 60`，且当轮两条指标查询没有错误时，停止该任务的曲线轮询。这个条件只预留采集与缓存余量，不验证数据完整；空结果也可能满足停止条件。后端不能省略终态的 `finished_at`，否则曲线仍会持续轮询；状态查询已按终态独立停止。

任务在首个请求发送前就失败/取消时，后端应如实省略 `started_at`；前端停止状态查询且不创建曲线查询，不需要伪造开始时间。

其他现有监测继续工作：延迟卡仍按左侧当前查询模型，通过五条即时 PromQL 获取；其回溯窗口跟随历史范围。它们没有自动限定到 `replay_id`、目标部署标签或任务实际区间，不能直接当作本次回放独立的优化前后延迟报告。右侧曲线若来自共享部署，也可能包含其他业务流量；只返回部署标签无法区分同部署中的回放流量。

## 8. 错误响应

沿用已有后端格式；`details` 最多 200 字符：

```json
{
  "error": "Invalid replay time range",
  "details": "end_time must be greater than start_time"
}
```

以下为建议后端采用的状态码；真实服务若已有约定，应在联调时对齐：

| HTTP 状态 | 用途 |
| --- | --- |
| 400 | 缺字段、类型错误、非法时间、结束不晚于开始 |
| 401 / 403 | 未认证或无该模型/任务的访问权限 |
| 404 | 模型或任务不存在；需区别于接口路径不存在 |
| 409 | 幂等键冲突，或触发后端设定的活动任务冲突策略 |
| 422 | 档案已过期、超出回放范围或确实没有可回放请求 |
| 429 | 超出请求/任务限流；前端按服务及 Retry-After 分别退避，缺省 60 秒 |
| 503 | 当前没有可用的目标路由或执行服务 |
| 504 | 接口依赖服务超时；已受理任务后执行超时应通过任务状态返回 |
| 500 | 接口自身无法正常处理 |

业务任务失败仍允许状态接口返回 `200` 和 `status: "failed"`。HTTP 错误表示此次接口访问失败，与任务的执行状态是两件事。前端支持秒数或 HTTP 日期形式的 `Retry-After`，且回放与指标的限流退避相互独立。

## 9. 后端实现步骤

1. 校验四个请求字段、调用权限、可回放范围和幂等键。
2. 解析逻辑模型到历史档案筛选条件、当前优化部署路由及目标指标标签，固定到任务记录。
3. 持久化任务与幂等关系，可靠入队，尽快返回 `202` 和任务 ID。
4. 后台按档案原始请求时间检索 `[start_time, end_time)` 中的请求，确定 `request_count`。
5. 并发调度，将原始请求到达间隔除以 speed；首个请求发出时记录 `started_at`。
6. 发送完毕转为 `draining`，收集响应结束/错误/超时结果并持续更新计数。
7. 工作结束后记录终态和 `finished_at`；GET 始终返回任务的完整已知状态。

Benchmark 当前全服务只允许一个活动任务，没有用户隔离；其他后端实现也必须提供原子的活动任务约束。

## 10. 前端配置与联调

`.env.local`：

```dotenv
BACKEND_URL=http://<DASHBOARD_BACKEND_IP>:<DASHBOARD_BACKEND_PORT>
REPLAY_BACKEND_URL=http://<BENCHMARK_IP>:<BENCHMARK_PORT>
VITE_PROMETHEUS_API_PREFIX=/api/prometheus
VITE_REPLAY_CREATE_PATH=/api/replays
VITE_REPLAY_STATUS_PATH=/api/replays/{id}
VITE_REPLAY_ACTIVE_PATH=/api/replays/active
VITE_REPLAY_CANCEL_PATH=/api/replays/{id}/cancel
VITE_REPLAY_PAUSE_PATH=/api/replays/{id}/pause
VITE_REPLAY_RESUME_PATH=/api/replays/{id}/resume
VITE_MODEL_METRICS_MAP='{}'
```

`REPLAY_BACKEND_URL` 可留空，此时回放仍走 `BACKEND_URL`。独立配置时，Vite 将创建/状态路径优先转发给 Benchmark（支持自定义回放路径），其余 `/api` 请求仍走已有看板后端。两个地址只配置代理，不进入浏览器产物。修改配置后重新运行 `npm run dev`。静态生产部署需在 Web 服务中配置相同的路径分流。使用同源代理无需浏览器跨域；若另行采用跨域部署，后端需允许前端 Origin、GET/POST/OPTIONS，以及 `Content-Type`、`Idempotency-Key` 和所用认证头。

联调顺序：

1. 在页面切换“后端”，确认模型、历史曲线正常。
2. 选取有请求档案的历史区间，确认创建 POST 包含 model_id/start_time/end_time/speed 四字段，响应为直接 JSON 且包含 `replay_id`。
3. 验证状态从排队/准备进入运行，首个真实请求发送后才出现 `started_at`；核对模型确实为当前优化部署。
4. 检查右侧两个 `query_range` 请求的起点为实际打流时间，而非历史 `start_time`，且目标标签能返回数据。
5. 验证全部发出后不会提前完成；在途请求结束后才返回终态与 `finished_at`。
6. 使用同键相同请求重复调用 POST，确认返回同一任务且没有重复发流。
7. 验证失败响应、空档案、认证失败、模型别名映射、终态后停止轮询，以及切换左侧模型不会改变正在观测任务。

目前仓库的浏览器联调脚本使用模拟 HTTP 响应；真实后端、档案检索和原速打流仍需按上述步骤验证。


## 11. 任务恢复、取消与刷新契约

公共任务响应必须包含 replay_id、status、model_id 或 target_model、source_model、start_time、end_time；补充 speed、cancellable、revision、cancel_requested_at 和 target.metrics_labels。创建、状态、active.task、409.active_task、取消以及 409.task 使用同一任务结构。speed 是创建时固定值，revision 随持久化更新递增。

活动查询返回 `{"active":true,"task":{...}}` 或 `{"active":false,"task":null}`。前端只在成功确认没有活动任务后才能新建；401/403/503、未知状态或不完整任务不能当作没有活动任务。

状态与活动查询带 `?view=status`，后端省略全部逐请求 results；不带该参数的接口保持完整结果兼容。旧后端忽略参数也可用，但缺少 speed 时无法恢复真实倍速；前端不凭空显示 1×。任务标签应是实际 Prometheus 标签，LiteLLM 别名可通过后端 BENCHMARK_MODEL_METRICS_MAP 或前端 VITE_MODEL_METRICS_MAP 映射。

刷新先查询 active；无活动任务时再 GET 保存的最后 replay_id，避免任务刚结束而丢失曲线。404 清除失效任务线索，其他失败保留快照并禁用创建。获得 started_at 后重新查询从该时间到现在的指标，再恢复约 2 秒状态和 30 秒曲线轮询。完成任务继续保留 finished_at+30 秒图表范围与 finished_at+60 秒采集余量。

浏览器 localStorage 仅保存非敏感快照、历史窗口、相对时间偏好与数据源；sessionStorage 保存待确认创建请求的参数、签名和幂等键。成功取得任务 ID 后清除待确认记录；创建冲突附带 active_task 时展示该任务。网络失败或响应丢失时保留原操作，用户重试原请求，同键同有效参数返回 200 原任务；新任务返回 202。参数指纹包含 source_model、target_model、start_time、end_time、speed；同键不同有效参数返回 409。正在观测已知任务的刷新过程不 POST 创建。

待确认操作只在后端模式显示和重试；演示任务不改写该记录。首次请求收到明确拒绝的 JSON 响应（400/401/403/404/405/413/415/422）时清除本次待确认记录，允许修正后以新键创建；5xx、超时和不可解析响应仍保留。已有未确认尝试时，本次重试被拒绝不能证明原尝试没有创建任务，继续保留原键。源模型等于目标模型时，历史恢复沿用任务的实际 model_name；源模型不同则使用源模型映射。回放曲线按查询分别保留失败前的数据，成功空响应会清空对应曲线。

取消接口返回 202 和 cancelling 任务，重复取消仍 202；已终态返回 409 + task；不存在返回 404。cancellable=false 不启用取消按钮。取消不撤回已提交请求，必须继续查询直到终态；计数按实际进展显示，不把取消进度填为 100%。取消提交和调度提交由后端共用锁保护，取消受理后不再提交新请求。前端拒绝旧 revision 和取消前迟到的轮询响应，终态不能被非终态覆盖。

## 12. 刷新认证方式

manual（默认）：页面输入 `Bearer 实际BENCHMARK_API_KEY`，认证只在页面内存，刷新后重新输入并应用设置即恢复任务。

proxy：设置 `VITE_REPLAY_AUTH_MODE=proxy` 和服务端 `BENCHMARK_API_KEY=原始密钥`，Vite 向创建/状态/active/cancel/pause/resume 路由注入 Bearer 头，浏览器不持有服务密钥。该密钥不使用 VITE_ 前缀，不进入构建产物。Vite 仅监听回环地址；生产必须由已有受控且有访问认证的反向代理提供相同路由注入，不能仅发布静态文件就期待此功能生效。

`VITE_REPLAY_ACTIVE_PATH` / `VITE_REPLAY_CANCEL_PATH` 支持自定义同源路径，Vite 分流也同步覆盖这些路径。`VITE_REPLAY_STORAGE_SCOPE` 区分同域不同回放环境，切换环境时应修改后重建。Prometheus query/query_range 继续使用现有后端，不携带 Benchmark 凭据。

浏览器刷新只是恢复观测；后端进程重启仍将活动任务标记 failed，不支持断点续跑。自动恢复不触发真实流量重放，完整结果也不缓存到浏览器。

## 13. 暂停与继续契约

前端已支持 `paused`，但未修改的 Benchmark 不提供暂停接口。所需后端改动及补丁应用顺序见 [README](../README.md#暂停继续与取消流程2026-10-14)。本次只修改 llm-dashboard，不自动修改或部署 Benchmark。

`POST /api/replays/{id}/pause`、`POST /api/replays/{id}/resume` 沿用回放 Bearer 认证，无请求体，不要求创建幂等键。成功返回 200 和轻量公共任务（不含 results）；非法状态返回 409 + task，未知 ID 返回 404。重复暂停不重置起点；重复继续在 queued/running/draining 安全返回当前状态。

公共任务增加 `pausable`、`resumable`、`paused_at`、`paused_seconds`。pausable 仅在 queued/running 且未全部提交时为 true；resumable 仅在 paused 为 true。paused_at 是当前暂停起点的 Unix 秒，继续时 null；paused_seconds 是已经结束的暂停累计秒数。完整任务没有声明能力时，前端禁用按钮，不能根据旧缓存假定能力仍可用。

后端暂停、继续、取消与线程池提交必须使用同一把锁，并用 Condition 唤醒等待调度。暂停停止新的调度提交，不撤回已提交请求或线程池待执行请求；在途完成数量仍增加。继续需用单调时钟扣除暂停时长，保持剩余间隔，不把暂停时间变成补发流量。最后一次提交与 draining 切换必须原子完成，避免任务已经全部提交却暂停。

paused 属于活动和可取消状态，阻止新建任务；刷新通过 active 恢复原任务，保持暂停，不自动继续。进度与 Prometheus 曲线轮询继续，查询起点仍为原 started_at。取消必须通知 Condition，唤醒暂停线程并转为 cancelling；已提交请求结束后才 cancelled。后端进程重启将 paused 标记 failed，不承诺进程级恢复。
