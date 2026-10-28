// Exercise the real startup script and template; the envsubst shim expands only its explicit variable list.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve('test-results/nginx-metrics');
fs.mkdirSync(root, { recursive: true });
const portable = value => value.replace(/\\/g, '/');
const shell = process.env.CHECK_SH_PATH || (process.platform === 'win32' ? 'D:/dev/Git/usr/bin/sh.exe' : '/bin/sh');
const script = fs.readFileSync('docker/nginx/15-generate-default-conf.sh', 'utf8')
  .replace('TEMPLATE=/etc/nginx/dashboard/default.conf.template', `TEMPLATE="${portable(path.resolve('docker/nginx/default.conf.template'))}"`)
  .replace('TARGET=/etc/nginx/conf.d/default.conf', `TARGET="${portable(path.join(root, 'default.conf'))}"`);
const scriptPath = path.join(root, 'generate.sh');
fs.writeFileSync(scriptPath, script.replace(/\r\n/g, '\n'));
fs.writeFileSync(path.join(root, 'envsubst'), `#!/bin/sh\nexec node "${portable(path.join(root, 'envsubst.cjs'))}" "$@"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(root, 'envsubst.cjs'), `
const fs = require('node:fs');
const allowed = new Set([...process.argv[2].matchAll(/\\$\\{([A-Z_]+)\\}/g)].map(match => match[1]));
const text = fs.readFileSync(0, 'utf8').replace(/\\$\\{([A-Z_]+)\\}/g, (original, key) => allowed.has(key) ? process.env[key] || '' : original);
process.stdout.write(text);
`);
const base = {
  ...process.env, PATH: [root, path.dirname(shell), path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
  MSYS2_ENV_CONV_EXCL: 'REPLAY_PATH_REGEX',
  BACKEND_URL: 'http://prod-metrics:3000', REPLAY_BACKEND_URL: 'http://benchmark:8088',
  VITE_REPLAY_AUTH_MODE: 'proxy', BENCHMARK_API_KEY: 'benchmark-test-token',
  REPLAY_PATH_PREFIX: '/api/replays', PROMETHEUS_PATH_PREFIX: '/api/prometheus',
  REPLAY_PROMETHEUS_PATH_PREFIX: '/api/replay-prometheus',
  REPLAY_PROMETHEUS_URL: 'http://gray-prometheus:9090/prom/',
  REPLAY_PROMETHEUS_BEARER_TOKEN: 'gray-test-token',
};
const generate = overrides => {
  const result = spawnSync(shell, [portable(scriptPath)], { env: { ...base, ...overrides }, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { ...result, config: result.status === 0 ? fs.readFileSync(path.join(root, 'default.conf'), 'utf8') : '' };
};
const normal = generate({});
assert.equal(normal.status, 0, normal.stderr);
for (const endpoint of ['query', 'query_range']) {
  assert(normal.config.includes(`location = /api/replay-prometheus/${endpoint} {`));
  assert(normal.config.includes(`proxy_pass http://gray-prometheus:9090/prom/api/v1/${endpoint};`));
}
assert(normal.config.includes('proxy_set_header Authorization "Bearer gray-test-token";'));
assert(normal.config.includes('proxy_set_header Authorization "Bearer benchmark-test-token";'));
assert(normal.config.includes('location ~ ^/api/replays(?:$|/)'));
assert(normal.config.includes('proxy_pass http://prod-metrics:3000;'));
assert(normal.config.includes('$uri') && normal.config.includes('$remote_addr'));
assert(!/\$\{[A-Z_]+\}/.test(normal.config), 'all configured placeholders must be expanded');
const missing = generate({ REPLAY_PROMETHEUS_URL: '', REPLAY_PROMETHEUS_BEARER_TOKEN: '' });
assert.equal(missing.status, 0, missing.stderr);
assert.equal((missing.config.match(/return 503/g) || []).length, 2);
assert(missing.config.includes('proxy_pass http://prod-metrics:3000;'));
const legacy = generate({ REPLAY_PROMETHEUS_URL: '', REPLAY_PROMETHEUS_PATH_PREFIX: '/api/prometheus' });
assert.equal(legacy.status, 0, legacy.stderr);
assert(!legacy.config.includes('location = /api/prometheus/query'));
assert.notEqual(generate({ REPLAY_PROMETHEUS_PATH_PREFIX: '/api/prometheus' }).status, 0);
assert.notEqual(generate({ REPLAY_PROMETHEUS_URL: 'http://gray-prometheus:9090/?query=up' }).status, 0);
console.log('PASS: production nginx template generation, gray native API routes, separate tokens, preserved nginx variables, missing-gray 503 and legacy routes');
