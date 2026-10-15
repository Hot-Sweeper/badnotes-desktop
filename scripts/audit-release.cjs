// Defense in depth: publishing must never include a real data/profile directory.
const { execFileSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = files.filter(file => /(^|\/)(data|node_modules|\.venv|venv|__pycache__|Archive|copilot_only)(\/|$)/.test(file) ||
  /(^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example' || /\.(?:pem|key|p12|pfx|pyc)$/.test(file));
if (forbidden.length) { console.error('Forbidden public files:', forbidden); process.exit(1); }
console.log(`Public-source inventory checked: ${files.length} files; no private data/environment directories.`);
