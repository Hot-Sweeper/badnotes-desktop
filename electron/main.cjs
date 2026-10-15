const { app, BrowserWindow, dialog, ipcMain, shell, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { mapTouches } = require('./direct-touch.cjs');

const root = path.resolve(__dirname, '..');
const inputRoot = app.isPackaged ? path.join(process.resourcesPath, 'input') : __dirname;
let address;
const sessionToken = randomBytes(32).toString('hex');
let backendReady;
let backendError = '';
let backend;
let mainWindow;
let resizeSession = null;
let touchReader;
let touchSource = { type: 'touch-source', direct: false };
let penContactSource = null;
let penButtonSource = null;
let geometryReader;
let windowGeometry = null;
let rendererViewport = null;
const wayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland' && !process.argv.includes('--ozone-platform=x11');

function touchGeometry() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererViewport) return null;
  if (wayland) return windowGeometry && { bounds: windowGeometry, display: windowGeometry.touchDisplay, viewport: rendererViewport };
  return {
    bounds: mainWindow.getContentBounds(),
    display: screen.getAllDisplays().find(display => display.internal) || screen.getPrimaryDisplay(),
    viewport: rendererViewport,
  };
}

function effectiveTouchSource() {
  return { ...touchSource, direct: Boolean(touchSource.direct && touchGeometry()),
    ...(!touchGeometry() ? { reason: 'waiting-for-window-geometry' } : {}) };
}

function publishTouchSource() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('badnotes-direct:input', effectiveTouchSource());
}

function startGeometryReader() {
  if (!wayland) return;
  geometryReader = spawn(process.env.BADNOTES_INPUT_PYTHON || 'python3', [path.join(inputRoot, 'window_geometry.py'), String(process.pid)], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let pending = '';
  geometryReader.stdout.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      let packet;
      try { packet = JSON.parse(line); } catch { continue; }
      const validRect = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
      if (packet?.type !== 'window-geometry' || packet.pid !== process.pid || !validRect(packet) || !validRect(packet.touchDisplay?.bounds)) continue;
      const moved = windowGeometry && ['x', 'y', 'width', 'height'].some(key => windowGeometry[key] !== packet[key]);
      windowGeometry = packet;
      if (moved && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('badnotes-direct:input', { type: 'cancel' });
      publishTouchSource();
    }
  });
  const stopped = () => {
    windowGeometry = null;
    // Fall back to native input, never guess a Wayland window's position.
    publishTouchSource();
  };
  geometryReader.on('error', stopped);
  geometryReader.on('exit', stopped);
  geometryReader.stderr.on('data', chunk => console.error('Window geometry:', chunk.toString()));
}

function startTouchReader() {
  if (process.platform !== 'linux') return;
  touchReader = spawn(process.env.BADNOTES_INPUT_PYTHON || 'python3', [path.join(inputRoot, 'direct_touch.py')], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let pending = '';
  touchReader.stdout.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      let packet;
      try { packet = JSON.parse(line); } catch { continue; }
      if (!packet || !mainWindow || mainWindow.isDestroyed()) continue;
      if (packet.type === 'touch-source') {
        touchSource = packet;
        packet = effectiveTouchSource();
      }
      if (packet.type === 'pen-contact') penContactSource = packet;
      if (packet.type === 'pen-buttons') penButtonSource = packet;
      if (packet.type === 'direct-touch') {
        const geometry = touchGeometry();
        if (!touchSource.direct || !geometry || !mainWindow.isFocused() || mainWindow.isMinimized()) continue;
        packet = { ...packet, events: mapTouches(packet.events, geometry.display, geometry.bounds, geometry.viewport) };
      } else if (!mainWindow.isFocused() && ['pen-contact', 'pen-buttons'].includes(packet.type)) continue;
      mainWindow.webContents.send('badnotes-direct:input', packet);
    }
  });
  const stopped = () => {
    touchSource = { type: 'touch-source', direct: false, reason: 'reader-stopped' };
    penContactSource = null;
    penButtonSource = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('badnotes-direct:input', touchSource);
  };
  touchReader.on('error', stopped);
  touchReader.on('exit', stopped);
  touchReader.stderr.on('data', chunk => console.error('Direct touchscreen:', chunk.toString()));
}

// Electron/Chromium can otherwise expose a Linux touchscreen as mouse-only.
// Enable native TouchEvents before Chromium initializes its renderer.
app.commandLine.appendSwitch('touch-events', 'enabled');
// Match this identity to the installed .desktop entry so KDE uses its icon
// instead of assigning the generic Electron placeholder in the task manager.
if (process.platform === 'linux') app.setDesktopName('badnotes-desktop.desktop');

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function startBackend() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'badnotes-backend.exe' : 'badnotes-backend')
    : process.env.BADNOTES_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(executable)) throw Error('BadNotes backend is missing. For source installs, create .venv and install requirements-lock.txt.');
  backend = spawn(executable, app.isPackaged ? [] : [path.join(root, 'scripts', 'backend.py')], {
    cwd: app.isPackaged ? app.getPath('userData') : root,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', BADNOTES_DESKTOP: '1', BADNOTES_SESSION_TOKEN: sessionToken,
      BADNOTES_DATA_DIR: process.env.BADNOTES_DATA_DIR || path.join(app.getPath('userData'), 'data'),
      BADNOTES_CONFIG_FILE: path.join(app.getPath('userData'), '.env') },
  });
  backendReady = new Promise((resolve, reject) => {
    let pending = '';
    backend.stdout.on('data', chunk => {
      pending += chunk.toString();
      const lines = pending.split('\n'); pending = lines.pop().slice(-4096);
      for (const line of lines) {
        if (!line.startsWith('BADNOTES_READY ')) continue;
        try {
          const { port } = JSON.parse(line.slice(15));
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid backend port');
          address = `http://127.0.0.1:${port}`;
          resolve();
        } catch (error) { reject(error); }
      }
    });
    backend.stderr.on('data', chunk => { backendError = (backendError + chunk.toString()).slice(-2048); });
    backend.once('error', reject);
    backend.once('exit', code => reject(Error(`BadNotes backend exited (${code}). ${backendError}`)));
  });
}

async function waitForBackend() {
  let timeout;
  try {
    await Promise.race([backendReady, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(Error('BadNotes backend startup timed out.')), 60000);
    })]);
  } finally { clearTimeout(timeout); }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) {
      throw new Error(`BadNotes server exited with code ${backend.exitCode}`);
    }
    try {
      const response = await fetch(`${address}/api/health`, {
        headers: { 'X-BadNotes-Token': sessionToken },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('BadNotes did not start within 30 seconds.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    frame: false,
    resizable: true,
    title: 'BadNotes',
    icon: path.join(root, 'assets', 'badnotes-icon.png'),
    backgroundColor: '#11131b',
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: process.env.BADNOTES_SMOKE_TEST !== '1',
      offscreen: Boolean(process.env.BADNOTES_README_SCREENSHOT),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const isMainWindow = (event) => mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
  const windowState = () => ({ maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen() });
  const sendWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('badnotes-window:state', windowState());
  };

  ipcMain.handle('badnotes-window:state', event => isMainWindow(event) ? windowState() : null);

  ipcMain.on('badnotes-window:minimize', (event) => {
    if (isMainWindow(event)) mainWindow.minimize();
  });
  ipcMain.on('badnotes-window:toggle-maximize', (event) => {
    if (!isMainWindow(event)) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    sendWindowState();
  });
  ipcMain.on('badnotes-window:close', (event) => {
    if (isMainWindow(event)) mainWindow.close();
  });
  ipcMain.on('badnotes-window:resize-start', (event, data) => {
    if (!isMainWindow(event) || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    const edges = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
    if (!data || !edges.has(data.edge) || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    resizeSession = { edge: data.edge, x: data.x, y: data.y, bounds: mainWindow.getBounds() };
  });
  ipcMain.on('badnotes-window:resize-move', (event, data) => {
    if (!isMainWindow(event) || !resizeSession || !data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    const { edge, x: startX, y: startY, bounds: start } = resizeSession;
    const dx = data.x - startX;
    const dy = data.y - startY;
    const minWidth = 900;
    const minHeight = 640;
    let { x, y, width, height } = start;
    if (edge.includes('e')) width = Math.max(minWidth, start.width + dx);
    if (edge.includes('s')) height = Math.max(minHeight, start.height + dy);
    if (edge.includes('w')) {
      width = Math.max(minWidth, start.width - dx);
      x = start.x + start.width - width;
    }
    if (edge.includes('n')) {
      height = Math.max(minHeight, start.height - dy);
      y = start.y + start.height - height;
    }
    mainWindow.setBounds({ x, y, width, height }, false);
  });
  ipcMain.on('badnotes-window:resize-end', (event) => {
    if (isMainWindow(event)) resizeSession = null;
  });

  mainWindow.on('maximize', sendWindowState);
  ipcMain.handle('badnotes-direct:state', event => {
    if (!isMainWindow(event)) return [];
    return [effectiveTouchSource(), ...(penContactSource ? [penContactSource] : []), ...(penButtonSource ? [penButtonSource] : [])];
  });
  ipcMain.on('badnotes-direct:viewport', (event, viewport) => {
    if (!isMainWindow(event) || !viewport || !['width', 'height'].every(key => Number.isFinite(viewport[key]) && viewport[key] > 0 && viewport[key] < 100000)) return;
    rendererViewport = { width: viewport.width, height: viewport.height };
    publishTouchSource();
  });
  ipcMain.handle('badnotes-direct:geometry', event => isMainWindow(event) ? touchGeometry() : null);
  mainWindow.on('blur', () => mainWindow.webContents.send('badnotes-direct:input', { type: 'cancel' }));
  mainWindow.on('focus', () => {
    publishTouchSource();
    if (penContactSource) mainWindow.webContents.send('badnotes-direct:input', penContactSource);
    if (penButtonSource) mainWindow.webContents.send('badnotes-direct:input', penButtonSource);
  });
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  let closeAfterSave = false;
  let savingBeforeClose = false;
  mainWindow.on('close', (event) => {
    if (closeAfterSave) return;
    event.preventDefault();
    if (savingBeforeClose) return;
    savingBeforeClose = true;
    mainWindow.webContents.executeJavaScript('typeof saveCurrentPage === "function" ? saveCurrentPage() : Promise.resolve()')
      .then(() => {
        closeAfterSave = true;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      })
      .catch(error => {
        savingBeforeClose = false;
        console.error('Could not save before closing BadNotes:', error);
        dialog.showErrorBox('BadNotes could not save', 'Your window has been left open to protect your notes. Please try closing it again.');
      });
  });
  mainWindow.on('closed', () => { resizeSession = null; mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== address) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  mainWindow.once('ready-to-show', () => {
    if (process.env.BADNOTES_SMOKE_TEST !== '1') mainWindow.show();
    sendWindowState();
  });
  mainWindow.loadURL(address);
}

app.whenReady().then(async () => {
  if (!hasSingleInstance) return;
  app.setName('BadNotes');
  app.setAppUserModelId('io.github.hot-sweeper.badnotes');
  try {
    startBackend();
    await waitForBackend();
    await require('electron').session.defaultSession.cookies.set({ url: address, name: 'badnotes-session', value: sessionToken,
      httpOnly: true, sameSite: 'strict', path: '/' });
    createWindow();
    startGeometryReader();
    startTouchReader();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    if (process.env.BADNOTES_SMOKE_TEST === '1') {
      console.error(error);
      app.exit(1);
      return;
    }
    await dialog.showMessageBox({
      type: 'error',
      title: 'BadNotes could not start',
      message: error.message,
      buttons: ['Close'],
    });
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    mainWindow.close();
  }
});

app.on('will-quit', () => {
  if (touchReader && touchReader.exitCode === null) touchReader.stdin.end();
  if (geometryReader && geometryReader.exitCode === null) geometryReader.stdin.end();
  if (backend && backend.exitCode === null) backend.kill('SIGTERM');
});

app.on('window-all-closed', () => app.quit());
