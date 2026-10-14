# 部署指南

本项目是**纯前端工程**（React + Vite），构建产物为 `dist/` 静态文件。生产部署需要两个部分缺一不可：

1. **静态文件服务**：托管 `dist/`，SPA 任意路由须 fallback 到 `index.html`；
2. **同源反向代理**：`/api`、`/health` → 看板指标后端；回放路径（默认 `/api/replays`）→ Benchmark 回放后端。

浏览器只发同源 `/api` 请求，因此不能把 `dist/` 放到 GitHub Pages 等纯静态托管上期望自动连接后端。代理语义与本地开发的 Vite 代理（`vite.config.mjs` 的 `createBackendProxy`）完全一致：路径不改写、回放路径优先分流、可选认证注入。

> PyCharm 说明：PyCharm 无法"打包"本项目（它是前端工程，构建只能用 `npm run build`）。PyCharm Professional 的 Deployment（SFTP）功能只能作为文件上传工具，见[方式三](#方式三pycharm-deploymentsftp-或-scp手动上传)。

## 架构

```
浏览器 ──同源请求──> nginx 容器（本仓库构建）
                      ├── /              → dist/ 静态文件（SPA fallback 到 index.html）
                      ├── /api /health   → BACKEND_URL（看板指标后端，Prometheus 查询）
                      └── /api/replays*  → REPLAY_BACKEND_URL（Benchmark 回放后端，可省略）
                                          proxy 认证模式时注入 Authorization: Bearer <BENCHMARK_API_KEY>
```

## 部署方式对比

| 方式 | 前置条件 | 日常发版 | VITE_ 改动 | 反向代理维护 |
| --- | --- | --- | --- | --- |
| **Docker 服务器构建（推荐）** | 服务器 Docker | `git pull && docker compose up -d --build` | 自动重建 | 随镜像自带 |
| Docker 离线变体 | 本地 Docker Desktop | build + save + scp + load | 本地重建传镜像 | 随镜像自带 |
| PyCharm SFTP / scp | 服务器已装 nginx | 本地 build + 上传 dist | 本地重 build 再传 | 手工维护 |
| Git + 裸 nginx | 服务器 Node 22 + nginx | pull + npm ci + build + reload | 同上 | 手工维护 |

推荐 Docker：nginx 配置随镜像交付，语义与本地 Vite 代理一致，不依赖服务器手工维护；地址类变量改动**无需重建镜像**。

---

## 方式一：Docker 服务器构建（推荐）

### 首次部署

```bash
# 1. 服务器上克隆仓库
git clone <仓库地址> llm-dashboard && cd llm-dashboard

# 2. 准备环境变量（填 BACKEND_URL 等，说明见文件内注释）
cp deploy.env.example .env && vi .env

# 3. 构建并启动
#    国内服务器 npm 慢时：docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
docker compose up -d --build

# 4. 按下方"验证清单"检查
```

### 日常发版

```bash
git pull && docker compose up -d --build
```

### 变量生效时机

| 变量 | 生效时机 | 说明 |
| --- | --- | --- |
| `BACKEND_URL` | 启动时（必填） | 看板指标后端；只填协议+IP+端口，**不追加 /api** |
| `REPLAY_BACKEND_URL` | 启动时 | 独立 Benchmark 地址；留空回落 `BACKEND_URL` |
| `REPLAY_PATH_PREFIX` | 启动时 | 回放路径前缀，默认 `/api/replays`；须与构建产物一致 |
| `DASHBOARD_PORT` | 启动时 | 宿主机端口，默认 8080 |
| `BENCHMARK_API_KEY` | 启动时 | 仅 proxy 模式需要；注入回放路由认证头 |
| `VITE_REPLAY_AUTH_MODE` | **构建时** | 同时进入前端产物与 nginx 运行环境；改动须 `--build` |
| 其余 `VITE_*`（指标名映射、回放路径等） | **构建时** | 经 Dockerfile 的 ARG 注入；改动须 `--build`，参见 `Dockerfile` 与 `.env.example` |

改动地址类变量后执行 `docker compose up -d` 即生效（无需 `--build`）。

---

## 方式二：Docker 离线变体

服务器访问不了 npm 源或无 Git 权限时，在本地（需 Docker Desktop）构建镜像再传输：

```powershell
# 本地（Windows PowerShell）
docker build -t llm-dashboard .
docker save llm-dashboard | gzip > llm-dashboard.tar.gz
scp llm-dashboard.tar.gz user@server:/opt/
```

```bash
# 服务器（仍需仓库中的 docker-compose.yml 与 .env）
gunzip -c /opt/llm-dashboard.tar.gz | docker load
docker compose up -d
```

---

## 方式三：PyCharm Deployment（SFTP）或 scp 手动上传

不用 Docker 时：本地构建，上传 `dist/`，由服务器上已有的 nginx 托管并配置代理。

1. 本地构建：`npm ci && npm run build`（生成 `dist/`）
2. PyCharm Professional：**Settings → Build, Execution, Deployment → Deployment → `+` → SFTP**，填服务器 SSH 连接
3. **Mappings** 页：本地路径指到 `dist` 目录，部署路径填服务器目录（如 `/var/www/dashboard`）
4. **Tools → Deployment → Upload to ...** 上传（社区版无此功能，改用 WinSCP / FileZilla，或 `scp -r dist/* user@server:/var/www/dashboard/`）

服务器 nginx 参考配置（与 Docker 版语义一致）：

```nginx
server {
    listen 80;
    server_name _;
    root /var/www/dashboard;
    index index.html;
    absolute_redirect off;

    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }
    location = /index.html { add_header Cache-Control "no-cache"; }

    # 回放路由优先；proxy 认证模式在此 location 加：
    #   proxy_set_header Authorization "Bearer <与Benchmark一致的密钥>";
    location ~ ^/api/replays(?:$|/) {
        proxy_pass http://<BENCHMARK_IP>:<BENCHMARK_PORT>;   # 或与 /api 相同的后端
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api  { proxy_pass http://<BACKEND_IP>:<BACKEND_PORT>;  proxy_http_version 1.1; }
    location /health { proxy_pass http://<BACKEND_IP>:<BACKEND_PORT>; proxy_http_version 1.1; }
    location / { try_files $uri $uri/ /index.html; }
}
```

---

## 方式四：Git + 服务器 nginx

服务器安装 Node 22 LTS 后直接在服务器构建（无 Docker）：

```bash
git pull && npm ci && npm run build
# dist/ 交给 nginx 托管，配置同方式三；改 VITE_ 变量后重新 build 并 reload
```

---

## 自定义回放路径

前端可通过 `VITE_REPLAY_*_PATH` 四个变量自定义回放接口路径（构建时注入产物）。Docker 部署时：

1. 四条回放路径（create/status/active/cancel）**须共享同一前缀**（如 `/api/replays`），并使 `.env` 的 `REPLAY_PATH_PREFIX` 与之相同；
2. 构建时传入：`docker compose build --build-arg VITE_REPLAY_CREATE_PATH=/api/replays --build-arg VITE_REPLAY_STATUS_PATH='/api/replays/{id}' ...`（其余三条同理，或扩展 `docker-compose.yml` 的 `build.args`）。

四条路径不共享前缀的场景较少见：须在 `docker/nginx/default.conf.template` 中按前缀手工扩展多个回放 location，重建镜像。

## proxy 认证模式与安全

- `manual`（默认）：认证值在页面右上角设置中输入，仅存内存，刷新后重新输入。
- `proxy`：nginx 对**回放路由**注入 `Authorization: Bearer <BENCHMARK_API_KEY>`，认证自动恢复，浏览器 DevTools 的 Network 面板看不到密钥。
- 构建细节：`vite.config.mjs` 在 proxy 模式构建时会校验 `BENCHMARK_API_KEY` 存在（为本地 Vite 代理设计），Dockerfile 已内置占位值通过校验——**真实密钥只经运行时 `.env` 注入，不要用 `--build-arg` 传入真实密钥**（占位值不进入产物，已验证）。
- 安全要求（对应 README 认证章节）：
  - 密钥只经服务器 `.env` 注入，不提交进 Git（`.dockerignore` 已排除本地 `.env*`，本地 `.env.local` 不会进入构建）；
  - 密钥存在于容器环境变量中（`docker inspect` 可见）→ **服务器必须具备访问控制**（内网 / 防火墙 / VPN）；
  - 认证只注入回放路由，指标路由永不注入；
  - **不能把携带服务密钥的代理公开成无认证接口**；
  - 密钥使用常规 token 字符（避免引号、换行等会破坏 nginx 指令的字符）。

## 验证清单

```bash
# 1. 容器状态应为 healthy
docker compose ps

# 2. 静态页与 SPA fallback
curl -s http://localhost:8080/ | head -1                                 # <!doctype html>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/anything # 200

# 3. 静态资源 404 不应回退到 index.html
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/assets/nope.js  # 404

# 4. 指标代理连通（应返回后端 JSON 而非 404）
curl -s 'http://localhost:8080/api/prometheus/query?query=up'

# 5. 回放代理连通
curl -s http://localhost:8080/api/replays/active

# 6. 抽查生成的 nginx 配置（确认地址替换正确、$uri 等运行时变量保留）
docker compose exec dashboard cat /etc/nginx/conf.d/default.conf
```

浏览器端到端：模型下拉加载（走 `/api/prometheus/query`）→ 创建回放 → 进度更新；proxy 模式下 Network 面板中回放请求应**无** Authorization 请求头且返回 200。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `/api` 请求 404 | `BACKEND_URL` 误追加了 `/api`；只填协议+IP+端口（与本地 `.env.local` 规则相同） |
| 回放请求 401 | 认证模式与密钥不匹配；proxy 模式确认 `BENCHMARK_API_KEY` 与 Benchmark 服务实际配置一致（原始密钥，不加 Bearer） |
| 容器启动即退出 | `docker compose logs dashboard`：缺 `BACKEND_URL`，或 proxy 模式缺 `BENCHMARK_API_KEY`（启动脚本 fail-fast，防止暴露无认证回放接口） |
| 手动 `docker build` 报"代理认证模式需要配置服务端 BENCHMARK_API_KEY" | 传了 `--build-arg VITE_REPLAY_AUTH_MODE=proxy` 的同时改了 `BENCHMARK_API_KEY` 占位值；保持 Dockerfile 默认占位值即可，真实密钥走运行时环境变量 |
| 改了 `.env` 不生效 | 地址类改动 `docker compose up -d` 即可；`VITE_REPLAY_AUTH_MODE` 改动须加 `--build`（其余 `VITE_*` 同理） |
| `/api/replaysfoo` 走了指标后端 | 预期行为：前缀边界 `$|/` 与 Vite 代理一致，仅 `/api/replays` 及其子路径分流 |
| arm64 服务器构建失败 | 构建加 `--platform linux/amd64`，或在 `docker-compose.yml` 的 `build` 下指定 `platform` |
| 后端本身挂在子路径 | 代理路径原样透传；须按实际部署核对后端路由（见 README「常见问题」章节），不能直接套用默认配置 |
