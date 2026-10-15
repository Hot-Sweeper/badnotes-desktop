# Third-party notices

BadNotes application code is MIT-licensed. Dependencies retain their own licenses.

## Earcut

`static/assets/lib/earcut.min.js` is Mapbox Earcut, distributed under the ISC license:

Copyright (c) 2026, Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

Source: <https://github.com/mapbox/earcut>

## Runtime and build dependencies

Electron includes Chromium and its third-party notices in packaged distributions.
The bundled backend uses Python, Flask, Werkzeug, Jinja2, Waitress, OpenCV, NumPy,
Pillow, Requests, python-dotenv and tzdata, plus their transitive dependencies.
PyInstaller carries a bootloader exception permitting distribution of the resulting
application; its license does not change the license of BadNotes source.

The package build preserves the Python distributions' installed license metadata.
See `requirements-lock.txt` and `package-lock.json` for exact dependency versions.
KaTeX (MIT) is loaded from jsDelivr on demand when displaying AI mathematics.

The calculator is an independent implementation, not an official Texas Instruments
product. Product names and third-party marks remain the property of their owners.
