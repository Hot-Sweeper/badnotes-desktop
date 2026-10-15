"""Exercise the frozen backend with synthetic data, never a real notebook profile."""
import json
import os
from pathlib import Path
import queue
import secrets
import subprocess
import sys
import tempfile
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[1]
binary = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'build/backend/badnotes-backend' / ('badnotes-backend.exe' if os.name == 'nt' else 'badnotes-backend')
with tempfile.TemporaryDirectory(prefix='badnotes-release-smoke-') as directory:
    token = secrets.token_hex(32)
    env = {**os.environ, 'BADNOTES_DATA_DIR': directory, 'BADNOTES_DESKTOP': '1', 'BADNOTES_SESSION_TOKEN': token,
           'BADNOTES_CONFIG_FILE': str(Path(directory) / 'absent.env'), 'BADNOTES_CALENDAR_URL': '', 'BADNOTES_PORT': '0'}
    process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=directory, text=True)
    messages = queue.Queue()
    threading.Thread(target=lambda: messages.put(process.stdout.readline()), daemon=True).start()
    try:
        line = messages.get(timeout=60)
        assert line.startswith('BADNOTES_READY '), repr(line)
        port = json.loads(line[15:])['port']
        base = f'http://127.0.0.1:{port}'

        def request(path, method='GET', data=None, authenticated=True, headers=None):
            req_headers = {'X-BadNotes-Token': token} if authenticated else {}
            if data is not None:
                req_headers['Content-Type'] = 'application/json'
            req_headers.update(headers or {})
            req = Request(base + path, data=json.dumps(data).encode() if data is not None else None, method=method, headers=req_headers)
            try:
                with urlopen(req, timeout=10) as response:
                    return response.status, response.read()
            except HTTPError as error:
                return error.code, error.read()

        assert request('/api/health', authenticated=False)[0] == 403
        assert request('/api/health')[0] == 200
        assert request('/api/health', headers={'Origin': 'https://example.com'})[0] == 403
        assert request('/')[0] == 200
        assert request('/static/js/modules/03_canvas_core.js')[0] == 200
        assert request('/api/timetable')[0] == 200
        status, body = request('/api/notebooks', 'POST', {'name': 'Release smoke', 'color': '#7640fd', 'icon': 'book'})
        assert status == 200, (status, body)
        notebook = json.loads(body)['notebook']
        notebook_id = notebook['id']
        page_id = notebook['pages'][0]
        ink = [{'tool': 'pen', 'color': '#7640fd', 'size': 3, 'points': [{'x': 10, 'y': 20}, {'x': 40, 'y': 60}]}]
        status, body = request(f'/api/notebooks/{notebook_id}/pages/{page_id}', 'PUT', {'strokes': ink, 'width': 900, 'height': 1200})
        assert status == 200, body
        status, body = request(f'/api/notebooks/{notebook_id}/pages/{page_id}')
        assert json.loads(body)['strokes'] == ink
        assert request(f'/api/notebooks/{notebook_id}/trash', 'POST', {'originalIndex': 0})[0] == 200
        assert request(f'/api/trash/notebooks/{notebook_id}/restore', 'POST', {})[0] == 200
        assert request(f'/api/notebooks/{notebook_id}/pages/{page_id}')[0] == 200
        process.stdin.close()
        process.wait(timeout=10)
        assert process.returncode == 0, process.returncode
        print('Frozen backend: authenticated startup, templates/assets, calendar defaults, ink persistence, trash/restore, and parent-exit cleanup passed.')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
