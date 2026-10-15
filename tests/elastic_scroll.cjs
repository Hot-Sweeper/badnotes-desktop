const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../static/js/ui/MotionPhysics.js');
const rate=(v,x)=>16+12*Math.tanh((Math.abs(v)+16*Math.abs(x))/2200);
for(const raw of[-1000,-180,-40,0,40,180,1000])assert(Math.abs(P.unRubber(P.rubber(raw))-raw)<1e-8,'Catching a bounce preserves the visible contact position');
for(const hz of[30,60,120,240]){
    const samples=Array.from({length:10},(_,i)=>({time:i*1000/hz,position:i*1000/hz}));
    assert(Math.abs(P.sampleVelocity(samples,samples.at(-1).time)-1000)<1e-8);
    assert(Math.abs(P.sampleVelocity(samples,samples.at(-1).time+200))<.01,'Pausing before lift removes stale velocity');
}
const trajectory=(speed,hz)=>{let s={position:190,velocity:speed,target:null,omega:null},peak=190;for(let i=0;i<hz*2;i++){s=P.glide(s.position,s.velocity,1/hz,0,200,s.target,3.8,140,{omega:s.omega??rate,damping:.82});peak=Math.max(peak,s.position);}return{...s,peak};};
const reference=trajectory(2500,120);
for(const hz of[30,60,120,240]){const s=trajectory(2500,hz);assert(Math.abs(s.position-reference.position)<1e-4);assert(Math.abs(s.velocity-reference.velocity)<1e-4);assert(Math.abs(s.position-200)<.01);}
assert(trajectory(2500,120).peak-200>(trajectory(500,120).peak-200)*2,'A stronger throw produces a stronger physical edge arrival');
assert(trajectory(5500,240).peak<320,'Impact stiffness contains high-energy overshoot without a hard clamp');
{
    let s={position:190,velocity:2500,target:null,omega:null};
    for(const dt of[.016,.014,.15,.02,.2,.1,.5,1])s=P.glide(s.position,s.velocity,dt,0,200,s.target,3.8,140,{omega:s.omega??rate,damping:.82});
    assert(Math.abs(s.position-200)<.01&&Math.abs(s.velocity)<.1,'Slow frames integrate elapsed time rather than stretching the return');
}

function fixture(){
    let time=0,serial=0;const frames=new Map(),timers=new Map(),media={matches:false};
    const surface=id=>({id,scrollTop:0,scrollHeight:2000,clientHeight:400,isConnected:true,listeners:new Map(),classList:{add(){}},setPointerCapture(){},style:{values:new Map(),getPropertyValue(k){return this.values.get(k)||'';},setProperty(k,v){this.values.set(k,v);}},addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}});
    const shelves={notebookList:surface('notebookList'),pageList:surface('pageList')},doc=surface('document');doc.getElementById=id=>shelves[id];
    const s={MotionPhysics:P,document:doc,notebookDrag:{active:false},pageDrag:{active:false},matchMedia:()=>media,performance:{now:()=>time},
        requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);},setTimeout(fn,ms){timers.set(++serial,{fn,at:time+ms});return serial;},clearTimeout(id){timers.delete(id);},addEventListener(){}};
    s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/js/ui/ElasticScroll.js'),'utf8'),s);
    const send=(target,type,props={})=>{const e={type,pointerType:'touch',pointerId:1,clientX:10,clientY:100,timeStamp:time,target:{closest:()=>null},preventDefault(){},...props};for(const fn of target.listeners.get(type)||[])fn(e);};
    const advance=(ms,hz=120)=>{const end=time+ms;while(time<end-.00001){time=Math.min(end,time+1000/hz);const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);for(const[id,t]of[...timers])if(t.at<=time){timers.delete(id);t.fn();}}};
    return{s,shelves,doc,send,advance,frames,media,pose:e=>s.ElasticScroll.snapshot(e)};
}
function pull(interval){const f=fixture(),e=f.shelves.notebookList;f.send(e,'pointerdown');for(const y of[120,150,190]){f.advance(interval);f.send(f.doc,'pointermove',{clientY:y});}const held=f.pose(e);f.send(f.doc,'pointerup',{clientY:190});const release=f.pose(e);assert.equal(release.offset,held.offset,'Lifting causes no coordinate-space jump');let peak=release.offset;for(let i=0;i<180;i++){f.advance(1000/120);peak=Math.max(peak,f.pose(e).offset);}assert(!f.pose(e).animating&&Math.abs(f.pose(e).offset)<.05);assert.equal(f.frames.size,0,'Settled shelves consume no animation frames');return{peak,release,held};}
const slow=pull(160),fast=pull(12);assert(fast.release.velocity<slow.release.velocity-100);assert(fast.peak>slow.peak+1,'Held distance alone does not determine the release animation');
{
    const f=fixture(),e=f.shelves.pageList;f.send(e,'pointerdown');for(const y of[120,150,190]){f.advance(12);f.send(f.doc,'pointermove',{clientY:y});}f.send(f.doc,'pointerup',{clientY:190});f.advance(24);const before=f.pose(e);f.send(e,'pointerdown',{pointerId:2,clientY:200});const caught=f.pose(e);assert.equal(caught.offset,before.offset);assert(!caught.animating&&caught.contact);f.advance(20);f.send(f.doc,'pointermove',{pointerId:2,clientY:210});assert(Math.abs(f.pose(e).offset-caught.offset)<8,'A resumed pull remains continuous');f.send(f.doc,'pointercancel',{pointerId:2});f.advance(1300);assert(!f.pose(e).animating);
}
{
    const f=fixture(),e=f.shelves.notebookList;e.scrollTop=300;f.send(e,'scroll');f.send(e,'wheel',{deltaMode:0,deltaY:20});f.advance(16);f.send(e,'wheel',{deltaMode:0,deltaY:20});assert.equal(e.scrollTop,340);f.advance(400);assert.equal(e.scrollTop,340,'Pixel streams do not receive a second kinetic coast');assert(!f.pose(e).animating);
    e.scrollTop=0;f.send(e,'scroll');f.send(e,'wheel',{deltaMode:0,deltaY:-25});f.advance(20);f.send(e,'wheel',{deltaMode:0,deltaY:-25});assert(f.pose(e).animating&&f.pose(e).velocity<0,'Wheel-edge spring immediately carries stream velocity');f.advance(1200);assert(!f.pose(e).animating&&Math.abs(f.pose(e).offset)<.05);
    const before=f.pose(e);f.send(e,'wheel',{deltaMode:0,deltaY:30,ctrlKey:true});assert.equal(f.pose(e).position,before.position,'Ctrl-wheel remains available to its existing action');
    f.media.matches=true;f.send(e,'wheel',{deltaMode:1,deltaY:-4});assert.equal(f.pose(e).offset,0);assert.equal(f.frames.size,0,'Reduced motion does not start elastic animation');
}
console.log(JSON.stringify({passed:true,slow:{releaseVelocity:slow.release.velocity,peak:slow.peak},fast:{releaseVelocity:fast.release.velocity,peak:fast.peak},frameIndependent:true,interruptionContinuous:true,noDoubleWheelCoast:true,idleFrames:0}));
