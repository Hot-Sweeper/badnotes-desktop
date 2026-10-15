# Contributing

Small, focused changes are welcome. BadNotes values clear controls, responsive ink,
and motion that follows the user's input. Avoid adding background work to idle tools.

1. Follow the source setup in README.md.
2. Work on a branch and keep real notebooks and keys outside the repository.
3. Run `npm run check`, `npm test`, and Python tests:
   - Linux/macOS: `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`
   - Windows: `.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'`
4. For canvas changes, test dense pages, undo/redo, page switching, zoom, and all three themes.
5. Describe the change, verification performed, and any platform limitations in your pull request.

The `.mjs` browser smoke checks require a separate test instance with synthetic data
and a loopback DevTools endpoint on port 9222. Some simulate pointer input or change
notes: never run them against your daily notebook profile.

Build packages on their native OS and CPU architecture. Screenshots must contain
synthetic notes only. Do not contribute third-party art or fonts without a license.
