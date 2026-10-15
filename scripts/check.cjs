const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let failed = 0, count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(name);
    else if (/\.(?:js|cjs|mjs)$/.test(name)) {
      count++;
      const result = spawnSync(process.execPath, ['--check', name], { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) { console.error(result.stderr); failed++; }
    }
  }
}
for (const dir of ['electron', 'static/js', 'scripts', 'tests']) walk(dir);
console.log(`${count} JavaScript files checked; ${failed} syntax failures.`);
process.exit(failed ? 1 : 0);
