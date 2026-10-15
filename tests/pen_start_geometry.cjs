const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/modules/03_canvas_core.js'), 'utf8');
const begin = source.indexOf('        function getRealtimePenControlPoints(');
const end = source.indexOf('        function drawPenStartPreview(', begin);
assert(begin >= 0 && end > begin);
const context = vm.createContext({dynamicBrushEnabled:true,baseBrushSize:4,settings:{pressureMultiplier:1}});
vm.runInContext(source.slice(begin,end),context);
const points = [{x:0,y:0},{x:2,y:0},{x:9,y:12}];
const original = JSON.stringify(points);
const controls = context.getRealtimePenControlPoints(points);
assert.equal(JSON.stringify(points),original,'Actual contact and tip positions must stay unchanged');
assert.notEqual(controls.secondControlPoints[0].y,0,'The first segment must curve into the next');
for (const axis of ['x','y']) {
    const incoming = points[1][axis]-controls.secondControlPoints[0][axis];
    const outgoing = controls.firstControlPoints[1][axis]-points[1][axis];
    assert(Math.abs(incoming-outgoing)<1e-10,'The first join must have a continuous tangent');
}
for (const endPoint of [{x:100.001,y:0},{x:100,y:0},{x:99,y:0},{x:100,y:1}]) {
    const start = {x:100,y:0};
    const c = context.getRealtimePenSegmentControls({x:0,y:0},start,endPoint);
    const length = Math.hypot(endPoint.x-start.x,endPoint.y-start.y);
    assert(Math.hypot(c.first.x-start.x,c.first.y-start.y)<=length/3+1e-10,'Handle must not overshoot tiny samples');
    assert(Object.values(c).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
}
assert.equal(context.getRealtimePenControlPoints([{x:1,y:1}]),null,'A tap remains a dot');
assert.equal(context.getPenSampleSize(.5,4),5.2,'Initial and moving pressure must use the same width');
assert.equal(context.getPenSampleSize(0,4),4);
const sample = (timeStamp,x,buttons=1) => ({timeStamp,x,pointerType:'pen',buttons});
const stroke = {liveSampleTime:100};
const move = {...sample(110,10),getCoalescedEvents:()=>[
    sample(90,-10),sample(100,-5),sample(102,2,0),sample(104,4),sample(103,3),sample(108,8)]};
assert.deepEqual(Array.from(context.getPenContactSamples(move,stroke),p=>p.x),[4,8,10],
    'Pre-contact, hover and out-of-order samples must not pull the stroke backwards');
assert.equal(stroke.liveSampleTime,110);
assert.equal(context.getPenContactSamples(move,stroke).length,0,'Replayed batches must not duplicate ink');
const contactStroke = {liveSampleTime:100,points:[{x:15,y:5}]};
assert.equal(context.getCorrectedPenContactSample(move,contactStroke).x,-5,
    'The matching contact timestamp identifies the corrected coordinate');
assert.equal(context.getCorrectedPenContactSample(move,{...contactStroke,points:[{},{}]}),null,
    'A started stroke must never be reanchored');
console.log('Pen start geometry: curved entry, continuous first join, bounded handles, exact endpoints and pressure sizing passed.');
