#!/bin/sh
# 容器启动时按运行时环境变量生成 /etc/nginx/conf.d/default.conf。
# 不使用官方 /etc/nginx/templates 的自动 envsubst 机制：回放后端回落、认证注入、
# 缺变量 fail-fast 都需要条件逻辑；且显式变量列表可避免 nginx 运行时变量
# （$uri、$host 等）被整体替换成空串。
# 本脚本由官方 nginx 镜像 entrypoint 按文件名顺序自动执行，无需修改 CMD。
set -e

if [ -z "${BACKEND_URL:-}" ]; then
    echo "[dashboard] 缺少 BACKEND_URL 环境变量（看板指标后端地址），容器退出。" >&2
    exit 1
fi

# 未配置独立回放后端时，回放路径与指标走同一后端（对齐 Vite 代理的回落逻辑）。
REPLAY_BACKEND_URL="${REPLAY_BACKEND_URL:-$BACKEND_URL}"

AUTH_DIRECTIVE=""
if [ "${VITE_REPLAY_AUTH_MODE:-manual}" = "proxy" ]; then
    if [ -z "${BENCHMARK_API_KEY:-}" ]; then
        echo "[dashboard] VITE_REPLAY_AUTH_MODE=proxy 需要配置 BENCHMARK_API_KEY，容器退出。" >&2
        exit 1
    fi
    # 整行指令在 shell 中拼好再注入模板；envsubst 单遍替换不会递归展开嵌套变量。
    AUTH_DIRECTIVE="proxy_set_header Authorization \"Bearer ${BENCHMARK_API_KEY}\";"
fi

# 回放路径前缀转成 nginx 正则片段：转义全部正则元字符（对齐 vite.config.mjs 的转义）。
# 分四步无歧义替换，GNU sed 与 busybox sed（alpine 镜像）行为一致。
REPLAY_PATH_PREFIX="${REPLAY_PATH_PREFIX:-/api/replays}"
REPLAY_PATH_REGEX=$(printf '%s' "$REPLAY_PATH_PREFIX" | sed \
    -e 's#\\#\\\\#g' -e 's#\]#\\&#g' -e 's#\[#\\&#g' -e 's#[.+*^$(){}|?]#\\&#g')

TEMPLATE=/etc/nginx/dashboard/default.conf.template
TARGET=/etc/nginx/conf.d/default.conf

envsubst '${BACKEND_URL} ${REPLAY_BACKEND_URL} ${REPLAY_PATH_REGEX} ${AUTH_DIRECTIVE}' \
    < "$TEMPLATE" > "$TARGET"

echo "[dashboard] nginx 配置已生成: /api,/health -> ${BACKEND_URL}; 回放(${REPLAY_PATH_PREFIX}) -> ${REPLAY_BACKEND_URL}; 认证=${VITE_REPLAY_AUTH_MODE:-manual}"
