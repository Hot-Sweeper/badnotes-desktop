# Architecture

BadNotes is an Electron shell around a loopback Flask application and a Canvas 2D
workspace. The active renderer entry point is `templates/index.html`, which loads
`static/js/modules/` in order. It still uses shared global state; class-based
modules elsewhere in `static/js/` are not all connected to the live entry point.

## Desktop lifecycle

1. Electron takes a single-instance lock and starts the backend with a random
   per-launch token and an explicit OS user-data directory.
2. The backend binds 127.0.0.1 on an ephemeral port and reports readiness on stdout.
3. Electron verifies the authenticated health endpoint, sets an HttpOnly session
   cookie, and loads the workspace. Renderer Node integration is disabled, with
   context isolation and Chromium sandboxing enabled.
4. The preload exposes narrow window-control and input APIs. Window IPC checks
   that its sender is the main window.
5. Closing the window awaits the current page save. Electron terminates its child
   backend on exit; a stdin watchdog also stops the backend if Electron crashes.

## Storage

`app.py` stores notebook metadata and individual page JSON alongside images,
handwriting profiles, exports, backups, and recoverable notebook trash. Desktop
sessions use `app.getPath('userData')/data`; `BADNOTES_DATA_DIR` overrides it.
Browser-only source development uses the ignored repository `data/` folder.
Nothing from the developer's original data folder is included in releases.

## Rendering and input

`01_core.js` owns shared state and API helpers. `03_canvas_core.js` handles ink,
canvas caches and navigation, while `09_events.js` connects input.
`PageThumbnails.js`, `GeometryEngine.js`, `LassoWorkbench.js`, and the workbenches
in `static/js/tools/` extend the live renderer. Motion helpers are in
`static/js/ui/MotionPhysics.js`, `ElasticScroll.js`, and `ViewLimits.js`.

Windows and macOS use Chromium Pointer Events. Linux can additionally use the
optional raw-input Python helper; KDE/Wayland window geometry observation needs
system PyGObject. Those helpers fail back to native input and never install
system input permissions automatically.

## Packaging and testing

PyInstaller builds a native, one-folder backend containing templates, static
assets, Python and its dependencies. Electron Builder includes that folder as an
extra resource. Each release target is built on its own OS and architecture.
The release matrix covers Linux x64, Windows x64, macOS arm64 and macOS x64.

Run JavaScript syntax and unit checks with `npm run check` and `npm test`.
Python API and input tests use unittest. `scripts/smoke-backend.py` checks a frozen
backend with synthetic notes. `scripts/smoke-desktop.cjs` runs a hidden workspace
with a disposable profile. Interactive `.mjs` checks require their own test app,
not a personal note-taking session.

## Optional network features

AI requests go through the local backend to the user's configured provider.
Calendar requests are disabled until the user supplies an HTTPS iCalendar URL.
KaTeX is downloaded on demand for AI math display. The app is not a shared web
service; cross-origin requests and non-loopback Host headers are rejected.
