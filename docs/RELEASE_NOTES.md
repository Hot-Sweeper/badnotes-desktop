# First public alpha

BadNotes is now open source: a local-first handwriting notebook app with a purple-and-pink interface.

## Included

- Ink, highlighters, erasing, lasso transforms, geometry, images, and handwritten text
- Notebook covers and emblems, resizable pages, live previews, and recoverable trash
- Light, dark, and OLED themes with six interface tones
- Momentum-driven navigation and drag-and-drop
- Optional bring-your-own-key AI assistance and an opt-in calendar feed
- Native packaged backend: no separate Python or Node installation needed

## Downloads

- Windows x64: `.exe` installer
- Linux x64: `.AppImage` and `.deb`
- macOS Apple Silicon and Intel: architecture-specific `.dmg` and `.zip`
- `SHA256SUMS.txt`: checksums for the files above

## Please read before testing

This is an **alpha**, not a stable release. Back up important notes. Windows/macOS pen hardware and desktop integration need real-device testing. Geometry auto-recognition is heuristic, not guaranteed. Builds are unsigned, and macOS builds are not notarized; OS security prompts or blocks are expected.

Notes are stored in your OS app-data directory. Older source-tree `data/` folders are not migrated automatically. Close both apps and back up the complete old data folder before copying it to the new location. No personal notes, keys, fonts, or images are included in this repository or its packages.

The desktop backend is loopback-only and session-authenticated. LAN phone scanning is not enabled. Calendar recurrence expansion and all-day events are not supported by the initial calendar parser. Optional AI requests use your provider account and can incur costs.

See README.md for setup, data locations, and limitations. Please report bugs with OS, version, device model, and reproduction steps using synthetic notes.
