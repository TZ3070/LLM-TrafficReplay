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

# 历史保持现有指标后端；灰度由本容器直接代理到原生 Prometheus HTTP API。
PROMETHEUS_PATH_PREFIX="${PROMETHEUS_PATH_PREFIX:-/api/prometheus}"
REPLAY_PROMETHEUS_PATH_PREFIX="${REPLAY_PROMETHEUS_PATH_PREFIX:-/api/replay-prometheus}"
REPLAY_PROMETHEUS_PATH_PREFIX="${REPLAY_PROMETHEUS_PATH_PREFIX%/}"
case "$REPLAY_PROMETHEUS_PATH_PREFIX" in
    /api/*) ;;
    *) echo "[dashboard] 回放指标前缀必须以 /api/ 开头。" >&2; exit 1 ;;
esac
case "$REPLAY_PROMETHEUS_PATH_PREFIX" in
    *[!a-zA-Z0-9_./-]*) echo "[dashboard] 回放指标前缀包含非法字符。" >&2; exit 1 ;;
esac
REPLAY_PROMETHEUS_URL="${REPLAY_PROMETHEUS_URL:-}"
REPLAY_PROMETHEUS_URL="${REPLAY_PROMETHEUS_URL%/}"
REPLAY_PROMETHEUS_AUTHORIZATION=""
if [ -n "${REPLAY_PROMETHEUS_BEARER_TOKEN:-}" ]; then
    case "$REPLAY_PROMETHEUS_BEARER_TOKEN" in
        *[!a-zA-Z0-9._~+/=-]*) echo "[dashboard] 灰度 Prometheus Bearer token 格式无效。" >&2; exit 1 ;;
    esac
    REPLAY_PROMETHEUS_AUTHORIZATION="Bearer ${REPLAY_PROMETHEUS_BEARER_TOKEN}"
fi
if [ -n "$REPLAY_PROMETHEUS_URL" ]; then
    case "$REPLAY_PROMETHEUS_URL" in
        http://*|https://*) ;;
        *) echo "[dashboard] REPLAY_PROMETHEUS_URL 必须是 HTTP(S) 地址。" >&2; exit 1 ;;
    esac
    # 禁止会改变 nginx 指令、变量或上游 URI 语义的字符。
    if printf '%s' "$REPLAY_PROMETHEUS_URL" | LC_ALL=C grep -q '[[:space:];{}"$?@#\\]'; then
        echo "[dashboard] REPLAY_PROMETHEUS_URL 不应包含凭据、查询参数或配置特殊字符。" >&2; exit 1
    fi
    if [ "$REPLAY_PROMETHEUS_PATH_PREFIX" = "${PROMETHEUS_PATH_PREFIX%/}" ]; then
        echo "[dashboard] 灰度指标入口必须与历史指标入口不同。" >&2; exit 1
    fi
fi
replay_metrics_location() {
    replay_metrics_endpoint="$1"
    if [ -n "$REPLAY_PROMETHEUS_URL" ]; then
        replay_metrics_directive="proxy_pass ${REPLAY_PROMETHEUS_URL}/api/v1/${replay_metrics_endpoint};"
    else
        replay_metrics_directive="return 503 '{\"error\":\"REPLAY_PROMETHEUS_URL is not configured\"}';"
    fi
    cat <<EOF
    location = ${REPLAY_PROMETHEUS_PATH_PREFIX}/${replay_metrics_endpoint} {
        default_type application/json;
        ${replay_metrics_directive}
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_read_timeout 310s;
        proxy_send_timeout 310s;
        proxy_set_header Authorization "${REPLAY_PROMETHEUS_AUTHORIZATION}";
        proxy_set_header x-api-key "";
        proxy_set_header x-litellm-key "";
    }
EOF
}
REPLAY_PROMETHEUS_LOCATIONS=""
if [ "$REPLAY_PROMETHEUS_PATH_PREFIX" != "${PROMETHEUS_PATH_PREFIX%/}" ]; then
    REPLAY_PROMETHEUS_LOCATIONS="$(replay_metrics_location query)
$(replay_metrics_location query_range)"
fi

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

# envsubst 只能读取已导出的变量；这里包含脚本计算出的正则和 location 块。
export BACKEND_URL REPLAY_BACKEND_URL REPLAY_PATH_REGEX AUTH_DIRECTIVE REPLAY_PROMETHEUS_LOCATIONS
envsubst '${BACKEND_URL} ${REPLAY_BACKEND_URL} ${REPLAY_PATH_REGEX} ${AUTH_DIRECTIVE} ${REPLAY_PROMETHEUS_LOCATIONS}' \
    < "$TEMPLATE" > "$TARGET"

echo "[dashboard] nginx 配置已生成: /api,/health -> ${BACKEND_URL}; 回放(${REPLAY_PATH_PREFIX}) -> ${REPLAY_BACKEND_URL}; 认证=${VITE_REPLAY_AUTH_MODE:-manual}"
