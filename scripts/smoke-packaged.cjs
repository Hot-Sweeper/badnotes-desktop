// Verify the real packaged Electron shell, frozen backend, and renderer together.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const candidates = process.platform === 'win32' ? ['dist/win-unpacked/BadNotes.exe'] : process.platform === 'darwin'
  ? ['dist/mac-arm64/BadNotes.app/Contents/MacOS/BadNotes', 'dist/mac/BadNotes.app/Contents/MacOS/BadNotes', 'dist/mac-x64/BadNotes.app/Contents/MacOS/BadNotes']
  : ['dist/linux-unpacked/badnotes-desktop'];
const executable = candidates.map(file => path.join(root, file)).find(file => fs.existsSync(file));
if (!executable) throw Error('Packaged app not found. Build a native package first.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'badnotes-packaged-smoke-'));
const args = [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'];
if (process.platform === 'linux') args.push('--ozone-platform=x11');
const child = spawn(executable, args, { env: { ...process.env, BADNOTES_SMOKE_TEST: '1', BADNOTES_DATA_DIR: path.join(profile, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', socket;
const watchdog = setTimeout(() => {
  console.error('Packaged smoke timed out:', log);
  socket?.close(); child.kill(); process.exitCode = 1;
}, 150000);
const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
child.once('error', error => { console.error(error); process.exitCode = 1; });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk.toString()).slice(-20000); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    let port;
    for (let i = 0; i < 900; i++) {
      if (child.exitCode !== null) throw Error(`Packaged app exited early (${child.exitCode}): ${log}`);
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log);
      if (match) { port = Number(match[1]); break; }
      await wait(100);
    }
    assert(port, 'No local DevTools port: ' + log);
    let target;
    for (let i = 0; i < 600; i++) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:'));
      if (target) break;
      if (child.exitCode !== null) throw Error('App exited during backend startup: ' + log);
      await wait(100);
    }
    assert(target, 'Workspace never loaded: ' + log);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let serial = 0;
    const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); pending.delete(message.id); };
    const evaluate = expression => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, message => message.error || message.result.exceptionDetails ? reject(Error(JSON.stringify(message))) : resolve(message.result.result.value));
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    let ready = false;
    for (let i = 0; i < 300; i++) {
      ready = await evaluate("document.getElementById('app')?.style.display === 'flex' && document.getElementById('loading')?.style.display === 'none'");
      if (ready) break;
      await wait(100);
    }
    assert(ready, 'Packaged workspace did not become ready: ' + log);
    const result = await evaluate("(async()=>({health:(await fetch('/api/health')).status,geometry:!!window.GeometryDetector,preload:typeof badnotesWindow.close==='function',nodeDisabled:typeof require==='undefined'}))()");
    assert.deepEqual(result, { health: 200, geometry: true, preload: true, nodeDisabled: true });
    await evaluate('badnotesWindow.close()');
    const code = await Promise.race([exited, wait(10000).then(() => { throw Error('Packaged app did not close'); })]);
    assert.equal(code, 0);
    console.log('Packaged desktop startup and clean shutdown passed:', JSON.stringify(result));
  } finally {
    clearTimeout(watchdog);
    socket?.close();
    if (child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
