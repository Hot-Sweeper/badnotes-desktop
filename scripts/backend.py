"""Loopback-only desktop backend, with a parent-lifetime watchdog and ephemeral port."""
import json
import os
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from waitress import create_server
from app import app


def main():
    server = create_server(app, host="127.0.0.1", port=int(os.environ.get("BADNOTES_PORT", "0")),
                           threads=8, expose_tracebacks=False)
    print("BADNOTES_READY " + json.dumps({"port": int(server.effective_port)}), flush=True)

    def watch_parent():
        # Electron keeps stdin open. No orphaned Python server if it crashes.
        sys.stdin.buffer.read()
        os._exit(0)

    if os.environ.get("BADNOTES_DESKTOP") == "1":
        threading.Thread(target=watch_parent, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
