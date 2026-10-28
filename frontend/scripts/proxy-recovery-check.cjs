// Build an isolated proxy-auth fixture; the server token must never appear in assets.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve('test-results/proxy-auth');
const secret='test-only-server-token-never-in-browser';
(async()=>{
  const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--configLoader','native','--outDir','test-results/proxy-auth'],{env:{...process.env,VITE_REPLAY_AUTH_MODE:'proxy',BENCHMARK_API_KEY:secret},stdio:'inherit'});
  assert.equal(build.status,0);
  for(const name of fs.readdirSync(path.join(root,'assets')))assert(!fs.readFileSync(path.join(root,'assets',name),'utf8').includes(secret),'server token leaked into build');
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const file=pathname.startsWith('/assets/')?path.join(root,'assets',path.basename(pathname)):path.join(root,'index.html');
    response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const script of ['scripts/replay-recovery-check.cjs','scripts/replay-edge-check.cjs']){
      const child=spawn(process.execPath,[script],{env:{...process.env,CHECK_PROXY:'1',CHECK_BASE_URL:`http://127.0.0.1:${server.address().port}`},stdio:'inherit'});
      const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
      assert.equal(status,0,script);
    }
    console.log('PASS: automatic refresh recovery with proxy auth and no service token in browser assets');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
