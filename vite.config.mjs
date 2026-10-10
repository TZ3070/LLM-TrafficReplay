import { defineConfig, loadEnv } from 'vite';
import ts from 'typescript';
import { minify } from 'terser';

export default defineConfig(({ mode }) => {
  // BACKEND_URL 仅由本地 Vite 读取；浏览器只看到同源 /api。
  // VITE_ 前缀配置会进入前端构建产物，因此只放接口路径，不放服务密钥。
  const env = loadEnv(mode, process.cwd(), '');
  // 同一套无 rewrite 的代理用于源码开发和预览；后端收到完整的 /api 路径。
  // 当前 Vite 默认也会继承代理，这里显式声明便于与旧看板的配置对照。
  const proxyOptions = { target: env.BACKEND_URL, changeOrigin: true };
  if (env.BACKEND_PROXY_DEBUG === 'true' && env.BACKEND_URL) {
    // 可选联调日志：显示实际读取的目标和上游状态，不记录查询参数或认证头。
    const target = new URL(env.BACKEND_URL);
    const destination = target.origin + target.pathname.replace(/\/$/, '');
    console.info(`[backend-proxy] mode=${mode} target=${destination}`);
    proxyOptions.configure = proxy => {
      proxy.on('proxyRes', (response, request) => {
        console.info(`[backend-proxy] ${request.method} ${request.url?.split('?')[0]} -> ${destination} HTTP ${response.statusCode}`);
      });
    };
  }
  const backendProxy = env.BACKEND_URL ? {
    '/api': { ...proxyOptions },
    '/health': { ...proxyOptions }
  } : undefined;
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
