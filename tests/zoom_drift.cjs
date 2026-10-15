const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../static/js/modules/09_events.js'),'utf8');
const begin = source.indexOf('            const driftStep =');
const end = source.indexOf('            // Canvas pointer events',begin);
assert(begin >= 0 && end > begin);
function run(scale, frameMs) {
    let callback, now = 0;
    const state = {zoom:2,panX:35,panY:-18,panInertiaActive:false,panInertiaFrame:0,
        isPanning:false,isPinching:false,canvas:{getBoundingClientRect:()=>({left:0,top:0})},
        performance:{now:()=>now},cancelPanInertia(){},_beginGesturePreview(){},
        _endGesturePreview(){},_updateGesturePreview(){},redrawCanvas(){},
        window:{},requestAnimationFrame(fn){callback=fn;return 1;}};
    state._setZoomInternal = value => { state.zoom = value; };
    const context = vm.createContext(state);
    vm.runInContext(source.slice(begin,end)+'; globalThis.start = startPanInertia;',context);
    const x = (700-state.panX)/state.zoom, y = (400-state.panY)/state.zoom;
    assert(context.start({x:0,y:0,scale,pivotX:700,pivotY:400,zoomGesture:true}));
    for(let frames=0;callback&&frames<3000;frames++) {
        now += frameMs; const step = callback; callback = null; step(now);
        if(frames===0 && frameMs<.2) {
            const initialVelocity = Math.log(state.zoom/2)/frameMs;
            assert(Math.abs(initialVelocity/scale-.55)<.01,'Coast should begin at the gentler time-stretched velocity');
        }
        assert(Math.abs((700-state.panX)/state.zoom-x)<1e-8,'Zoom must preserve its horizontal world anchor');
        assert(Math.abs((400-state.panY)/state.zoom-y)<1e-8,'Zoom must preserve its vertical world anchor');
    }
    assert.equal(state.panInertiaActive,false);
    const originalStopMs=Math.log1p(Math.abs(scale)*.025/.000006)/.025;
    assert(now >= originalStopMs/.55 - .001,'Coast should last longer, not just travel farther');
    return state.zoom/2;
}
const inward = run(.001,1000/120), outward = run(-.001,1000/120);
assert(inward > 1.015 && inward < 1.04,'Slower coast must not increase the original controlled zoom travel');
const originalTravel=.001/.025-(.000006/(.025*.025))*Math.log1p(.001*.025/.000006);
assert(Math.abs(Math.log(inward)-originalTravel)<1e-8,'Time stretching must preserve the original glide distance');
assert(outward < 1 && Math.abs(inward*outward-1)<1e-8);
assert(Math.abs(run(.001,1000/60)-inward)<1e-8,'Glide must be refresh-rate independent');
assert(Math.abs(run(.001,.1)-inward)<1e-8,'Smooth initial velocity must retain the same final travel');
console.log(JSON.stringify({passed:true,gentleZoomGlidePercent:(inward-1)*100,anchorStable:true}));
