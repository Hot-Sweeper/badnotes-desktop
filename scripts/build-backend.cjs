const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const python = process.env.BADNOTES_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) throw Error('Create .venv and install requirements-build.txt first. See README.md.');
const args = ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'badnotes-backend',
  '--distpath', 'build/backend', '--workpath', 'build/pyinstaller', '--specpath', 'build', '--paths', root,
  '--add-data', `${path.join(root, 'static')}:static`, '--add-data', `${path.join(root, 'templates')}:templates`, '--collect-data', 'tzdata',
  '--collect-all', 'cv2', '--hidden-import', 'app', 'scripts/backend.py'];
const result = spawnSync(python, args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const licenses = spawnSync(python, ['scripts/collect-licenses.py'], { cwd: root, stdio: 'inherit' });
process.exit(licenses.status ?? 1);
