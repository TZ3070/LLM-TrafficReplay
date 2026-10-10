import { defineConfig, loadEnv } from 'vite';
import ts from 'typescript';
import { minify } from 'terser';

export default defineConfig(({ mode }) => {
  // BACKEND_URL 仅由本地 Vite 读取；浏览器只看到同源 /api。
  // VITE_ 前缀配置会进入前端构建产物，因此只放接口路径，不放服务密钥。
  const env = loadEnv(mode, process.cwd(), '');
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
      // preview 默认继承 server.proxy；生产静态部署需在服务器上配置对应反向代理。
      proxy: env.BACKEND_URL ? {
        '/api': { target: env.BACKEND_URL, changeOrigin: true },
        '/health': { target: env.BACKEND_URL, changeOrigin: true }
      } : undefined
    }
  };
});
