const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../static/js/ui/MotionPhysics.js');
// Drift/spring collision time is integrated within the frame, not clamped.
const travel=hz=>{let s={position:100,velocity:2400,target:null},peak=100;for(let i=0;i<hz*2;i++){s=P.glide(s.position,s.velocity,1/hz,0,300,s.target);peak=Math.max(peak,s.position);}return{...s,peak};};
const reference=travel(120);
for(const hz of[30,60,120,240]){const s=travel(hz);assert(s.peak>300,'Incoming momentum stretches the boundary');assert(Math.abs(s.position-300)<.01);assert(Math.abs(s.position-reference.position)<1e-4);assert(Math.abs(s.velocity-reference.velocity)<1e-4);}
const outgoing=P.glide(305,2400,1/120,0,300);assert(outgoing.position>305&&outgoing.velocity>0,'Boundary release does not reset velocity');
// Run the real camera-limit module with visible shelves, including all four
// edges, small pages, huge pages, zoom springs and an interruptible release.
function fixture(){
    let time=0,serial=0;const frames=new Map(),panels={sidebar:{offsetWidth:200,classList:{contains:()=>false}},pageNav:{offsetWidth:240,classList:{contains:()=>false}},canvasContainer:{}};
    const s={MotionPhysics:P,innerWidth:1200,innerHeight:900,viewportWidth:1200,viewportHeight:900,baseWidth:800,baseHeight:1100,zoom:1,panX:200,panY:0,
        canvas:{getBoundingClientRect:()=>({left:0,top:0})},document:{getElementById:id=>panels[id],addEventListener(){}},
        ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},matchMedia:()=>({matches:false}),performance:{now:()=>time},
        requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);},addEventListener(){},redrawCanvas(){},
        _setZoomInternal(value){s.zoom=value;}};
    s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/ui/ViewLimits.js'),'utf8'),s);
    const tick=(dt=1000/120)=>{time+=dt;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(time));};tick();
    return{s,tick,frames};
}
const{s,tick,frames}=fixture(),V=s.ViewLimits;
for(const zoom of[.2,1,4,400]){
    const b=V.bounds(zoom),w=s.baseWidth*zoom,h=s.baseHeight*zoom,peek=Math.min(28,760*.04,w*.12);
    assert(Math.abs(b.x[0]+w-200-peek)<1e-8);assert(Math.abs(960-b.x[1]-peek)<1e-8);
    const py=Math.min(28,900*.04,h*.12);assert(Math.abs(b.y[0]+h-py)<1e-8);assert(Math.abs(900-b.y[1]-py)<1e-8);
}
s.panX=V.bounds().x[1]+5;s.panY=100;const oldX=s.panX;
const rawEdge=V.bounds().x[1]+220,rawVelocity={x:1,y:0,scale:0,pivotX:500,pivotY:400};
const projected=V.projectRelease(rawVelocity,{rawX:rawEdge,rawY:100,rawZoom:1,worldX:0,worldY:0});
assert(Math.abs(projected.x-1/9)<1e-8,'Release keeps the rubber-band camera velocity, not the faster finger velocity');
// During a moving pinch the near edge itself moves with scale. Verify the
// projected velocity against the derivative of the actual rendered mapping.
{
    const f=fixture(),c=f.s,limits=c.ViewLimits,rawX=limits.bounds().x[0]-220,rawY=100,pivotX=700,pivotY=400;
    const worldX=pivotX-rawX,worldY=pivotY-rawY,contact={rawX,rawY,rawZoom:1,worldX,worldY},input={x:.3,y:-.2,scale:.002,pivotX,pivotY};
    const initial=limits.pan(rawX,rawY,1,true);c.panX=initial.x;c.panY=initial.y;
    const projected=limits.projectRelease(input,contact),startX=c.panX,startY=c.panY,dt=.001,nextZoom=Math.exp(input.scale*dt);
    const next=limits.pan(pivotX+input.x*dt-worldX*nextZoom,pivotY+input.y*dt-worldY*nextZoom,nextZoom,true);
    assert(Math.abs(projected.x-((next.x-startX)/dt+(pivotX-startX)*input.scale))<1e-5);
    assert(Math.abs(projected.y-((next.y-startY)/dt+(pivotY-startY)*input.scale))<1e-5);
}
assert(V.settle({x:2400,y:500,scale:0}));tick();assert(s.panX>oldX,'Fast outward release continues before turning back');assert(s.panY>100,'The other axis keeps its momentum');
for(let i=0;i<500&&V.animating;i++)tick();assert(!V.animating&&!V.outside());assert(Math.abs(s.panX-V.bounds().x[1])<.01);
s.zoom=.18;s.panX=400;s.panY=200;V.setPivot(500,400);const before=s.zoom;
assert(V.settle({x:0,y:0,scale:-.4}));tick();assert(s.zoom<before,'Zoom boundary spring retains incoming scale velocity');
for(let i=0;i<500&&V.animating;i++)tick();assert(!V.animating&&!V.outside());assert(Math.abs(s.zoom-.2)<1e-8);
s.panX=V.bounds().x[1]+10;V.settle({x:1500});assert(frames.size);V.cancel();assert(!V.animating);const stopped=s.panX;tick();assert.equal(s.panX,stopped);
// Pinch midpoint translation is no longer erased just because scale changed.
const events=fs.readFileSync(path.join(__dirname,'../static/js/modules/09_events.js'),'utf8');
assert(!events.includes('release.zoomGesture ? 0 : release.x'));
assert.match(events,/ViewLimits\.settle\(\{x:velocityX\*1000,y:velocityY\*1000,scale:zoomVelocity\*1000\}\)/);
console.log('Camera momentum: edge slivers, frame-independent damping, moving pinch, velocity-preserving spring and interruption passed.');
