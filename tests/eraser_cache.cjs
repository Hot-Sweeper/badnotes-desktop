const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/modules/03_canvas_core.js', 'utf8');
const handler = source.slice(source.indexOf('function handleEraserModes(point)'), source.indexOf('function splitStrokeAtCircle('));
let now = 100;
const calls = [];
const context = {
    performance: { now: () => now }, lastEraserRun: -Infinity, ERASER_THROTTLE: 32,
    eraserMode: 'point', currentSize: 3, strokes: [], historyStack: [], redoStack: [],
    window: {}, setTimeout: () => 1, clearTimeout() {}, saveCurrentPage() {},
    redrawCanvas: () => calls.push('redraw'),
    invalidateStrokeCache: geometry => calls.push(geometry === false ? 'cache' : 'geometry'),
    findStrokeAtPoint: () => context.strokes[0],
    splitStrokeAtCircle: stroke => ({ modified: true, newStrokes: [{ ...stroke, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }] }] })
};
vm.createContext(context); vm.runInContext(handler, context);
context.strokes = [{ id: 1, points: [{ x: 10, y: 10 }] }];
assert.equal(context.handleEraserModes({ x: 10, y: 10 }), true);
assert.equal(context.strokes.length, 0);
assert.deepEqual(calls, ['cache', 'redraw']);
now += 40; calls.length = 0;
const untouched={id:3,points:[{x:400,y:400},{x:450,y:450}],_bezierCP:{},_bezierPath:{}};
context.strokes = [{ id: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], _bezierCP:{},_bezierPath: {} },untouched];
assert.equal(context.handleEraserModes({ x: 50, y: 0 }), true);
assert.deepEqual(calls, ['cache', 'redraw']);
assert(!context.strokes[0]._bezierCP&&!context.strokes[0]._bezierPath,'Edited fragments cannot inherit stale geometry');
assert.equal(context.strokes[1],untouched);assert(untouched._bezierCP&&untouched._bezierPath,'Unchanged dense-page geometry remains cached');
now += 40; calls.length = 0; context.eraserMode = 'object';
assert.equal(context.handleEraserModes({ x: 0, y: 0 }), true);
assert.equal(context.strokes.length, 1);
assert.deepEqual(calls, ['cache', 'redraw']);
assert.equal(context.historyStack.length, 1);
assert(source.includes('lastEraserRun = -Infinity;'));
assert(source.includes('coalesced.length ? [...coalesced, e] : [e]'));
console.log('Eraser cache invalidation: dot, split stroke, object and input fallback passed.');
