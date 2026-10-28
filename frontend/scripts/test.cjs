const fs = require('fs');
const ts = require('typescript');
const path = require('path');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  module._compile(output, filename);
};
for (const filename of fs.readdirSync('tests').filter(name => name.endsWith('.test.ts'))) require(path.resolve('tests', filename));
