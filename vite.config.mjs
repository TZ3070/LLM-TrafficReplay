import { defineConfig, loadEnv } from 'vite';
import ts from 'typescript';
import { minify } from 'terser';

// 更具体的回放路径先匹配；未配置独立地址时仍走已有看板后端。
export function createBackendProxy(env) {
  if(env.VITE_REPLAY_AUTH_MODE==='proxy' && !env.BENCHMARK_API_KEY?.trim())throw new Error('代理认证模式需要配置服务端 BENCHMARK_API_KEY');
  const proxyOptions = (address,replay=false) => {
    const options = { target:address, changeOrigin:true };
    // 只给回放代理注入密钥；非 VITE_ 配置不会进入浏览器产物。
    if(replay && env.VITE_REPLAY_AUTH_MODE==='proxy')options.headers={Authorization:`Bearer ${env.BENCHMARK_API_KEY.trim()}`};
    if(env.BACKEND_PROXY_DEBUG==='true') {
      const target = new URL(address);
      const destination = target.origin + target.pathname.replace(/\/$/,'');
      console.info(`[backend-proxy] target=${destination}`);
      options.configure = proxy => {
        proxy.on('proxyRes',(response,request)=>{
          console.info(`[backend-proxy] ${request.method} ${request.url?.split('?')[0]} -> ${destination} HTTP ${response.statusCode}`);
        });
      };
    }
    return options;
  };
  const proxy = {};
  const replayAddress=env.REPLAY_BACKEND_URL || env.BACKEND_URL;
  if(replayAddress) {
    const create = env.VITE_REPLAY_CREATE_PATH || '/api/replays';
    const status = env.VITE_REPLAY_STATUS_PATH || '/api/replays/{id}';
    const active = env.VITE_REPLAY_ACTIVE_PATH || '/api/replays/active';
    const cancel = env.VITE_REPLAY_CANCEL_PATH || '/api/replays/{id}/cancel';
    const prefixes = new Set([create,status.split('{id}')[0].replace(/\/+$/,''),active,cancel.split('{id}')[0].replace(/\/+$/,'')]);
    for(const prefix of prefixes) {
      if(!prefix.startsWith('/api/')||/[?#\s\\]/.test(prefix))throw new Error('回放代理路径应以 /api/ 开头，不含查询参数或空格');
      const match = '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?:$|[/?])';
      proxy[match] = proxyOptions(replayAddress,true);
    }
  }
  if(env.BACKEND_URL) {
    proxy['/api'] = proxyOptions(env.BACKEND_URL);
    proxy['/health'] = proxyOptions(env.BACKEND_URL);
  }
  return Object.keys(proxy).length ? proxy : undefined;
}

export default defineConfig(({ mode }) => {
  // BACKEND_URL 仅由本地 Vite 读取；浏览器只看到同源 /api。
  // VITE_ 前缀配置会进入前端构建产物，因此只放接口路径，不放服务密钥。
  const env = loadEnv(mode, process.cwd(), '');
  // 同一套无 rewrite 的代理用于源码开发和预览；后端收到完整的 /api 路径。
  // 当前 Vite 默认也会继承代理，这里显式声明便于与旧看板的配置对照。
  const backendProxy = createBackendProxy(env);
  return {
    resolve: { preserveSymlinks: true },
    // 使用 TypeScript 转译和 Terser 压缩，兼容受限 Windows 下 esbuild 原生路径扫描限制。
    // 类型检查由 npm run build 中的 tsc -b 单独完成。
    plugins: [{
      name: 'typescript-transpile',
      transform(source, id) {
        if (!/\.tsx?$/.test(id)) return;
        return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap: true } }).outputText;
      }
    }, {
      name: 'compress-production-js',
      apply: 'build',
      async renderChunk(code) { const output = await minify(code, { module:true }); return { code:output.code, map:null }; }
    }],
    esbuild: false,
    build: { minify: false },
    server: {
      // 浏览器 /api → Vite 代理 → 已有看板后端 → Prometheus/LiteLLM/回放任务。
      proxy: backendProxy
    },
    // npm run dev 先 build 再启动 preview；生产静态服务器仍须另外配置代理。
    preview: { proxy: backendProxy }
  };
});
