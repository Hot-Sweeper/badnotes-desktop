const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/modules/32_toolbox.js'), 'utf8');
const start = source.indexOf('    function createToyPainter(');
const end = source.indexOf('    // Helper to convert pointer event', start);
assert(start > 0 && end > start);
let serial = 0, frames = new Map();
const context = {requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); }};
vm.createContext(context);vm.runInContext(source.slice(start, end), context);
const tick = () => { const work = [...frames.values()];frames.clear();work.forEach(fn => fn()); };
const state = {};let paints = 0, densityChanged = false, feedback = 0;
const stop = context.createToyPainter({_needsResolution: () => densityChanged}, state,
    () => { paints++;densityChanged = false;if (feedback > 0) feedback--; }, () => feedback > 0);
assert.equal(paints, 1);tick();assert.equal(paints, 2);assert.equal(frames.size, 0);
for (let i = 0; i < 100; i++) state._requestPaint();
assert.equal(frames.size, 1);tick();assert.equal(paints, 3);assert.equal(frames.size, 0);
for (let i = 0; i < 100; i++) state._onScaleChanged();
assert.equal(frames.size, 0, 'Camera panning does not repaint static pixels');
densityChanged = true;state._onScaleChanged();tick();assert.equal(paints, 4);
feedback = 6;state._requestPaint();for (let i = 0; i < 6; i++) tick();
assert.equal(paints, 10);assert.equal(frames.size, 0, 'Exactly six original feedback frames');
state._requestPaint();stop();assert.equal(frames.size, 0);
state._requestPaint();state._onScaleChanged();tick();assert.equal(paints, 10);
assert.match(source, /pressedBtn = -1;[\s\S]*?state\._requestPaint\?\.\(\);\s*\}, 100\)/,
    'Calculator keeps its original 100ms release feedback');
console.log('Tool painter: coalescing, idle sleep, density wake, six-frame feedback and disposal passed.');
