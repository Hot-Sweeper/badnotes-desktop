const test = require('node:test');
const assert = require('node:assert/strict');
const { mapTouches } = require('../electron/direct-touch.cjs');
test('touch mapping accounts for display, content origin, and preserves IDs', () => {
  const input = [{ id: 8, phase: 'move', x: .25, y: .5 }];
  assert.deepEqual(mapTouches(input, { bounds: { x: 1000, y: 200, width: 2000, height: 1200 } },
    { x: 1100, y: 240 }), [{ id: 8, phase: 'move', x: 400, y: 560 }]);
  assert.deepEqual(input, [{ id: 8, phase: 'move', x: .25, y: .5 }]);
});

test('moved, resized, fractional-scale and browser-zoomed windows map to viewport pixels', () => {
  const display = { bounds: { x: -200, y: 40, width: 2057, height: 1286 } };
  for (const bounds of [
    { x: 308, y: 163, width: 1440, height: 960 },
    { x: 527.142857, y: 241.428571, width: 1114.285714, height: 771.428571 },
    { x: -200, y: 40, width: 2057.142857, height: 1285.714286 },
  ]) for (const viewport of [
    { width: Math.round(bounds.width), height: Math.round(bounds.height) },
    { width: Math.round(bounds.width / 1.25), height: Math.round(bounds.height / 1.25) },
  ]) {
    const points = [{ id: 1, phase: 'down', x: 310, y: 260 }, { id: 2, phase: 'move', x: 680, y: 500 }, { id: 3, phase: 'up', x: -30, y: -40 }];
    const raw = points.map(point => ({ ...point,
      x: (bounds.x + point.x * bounds.width / viewport.width - display.bounds.x) / display.bounds.width,
      y: (bounds.y + point.y * bounds.height / viewport.height - display.bounds.y) / display.bounds.height,
    }));
    const mapped = mapTouches(raw, display, bounds, viewport);
    mapped.forEach((point, index) => {
      assert(Math.abs(point.x - points[index].x) < 1e-8);
      assert(Math.abs(point.y - points[index].y) < 1e-8);
      assert.equal(point.id, points[index].id);
      assert.equal(point.phase, points[index].phase);
    });
  }
});
