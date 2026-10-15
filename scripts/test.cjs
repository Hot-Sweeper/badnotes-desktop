const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.cjs')).sort();
let failed = 0;
for (const file of tests) {
  console.log(`\n${file}`);
  const result = spawnSync(process.execPath, [path.join(root, 'tests', file)], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0 || result.error) failed++;
}
console.log(`\n${tests.length - failed}/${tests.length} JavaScript test programs passed.`);
process.exit(failed ? 1 : 0);
