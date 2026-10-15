// Real direct-touch routing; renderer-only fixtures, original preferences restored.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes'),ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let storage;const report={};
const pose=()=>evaluate('({zoom,panX,panY,bounds:ViewLimits.bounds(),outside:ViewLimits.outside(),animating:ViewLimits.animating})');
const pair=(phase,x,y,distance=160)=>[0,1].map(i=>({id:91+i,phase,x:x+(i?1:-1)*distance/2,y}));
const direct=events=>evaluate(`badnotesDirectInput(${JSON.stringify({type:'direct-touch',penContact:false,events})})`);
async function reset(expression){await evaluate(`badnotesDirectInput({type:'cancel'});cancelCanvasInertia();ViewLimits.cancel();_setZoomInternal(1);${expression};redrawCanvas(true);`);await wait(60);}
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('No camera fixture writes');return original(url,o);};API.put=API.post=async()=>{throw Error('No camera fixture writes');};currentNotebook=null;strokes=[];images=[];HandwrittenTextField.setTextFields([]);SimpleTextField.setTextFields([]);baseWidth=800;baseHeight=1100;clearLassoSelection();isResizeReady=isPageResizing=false;fingerDrawingEnabled=false;penIsActive=false;lastPenEventTime=-10000;badnotesDirectInput({type:'touch-source',direct:true});badnotesDirectInput({type:'pen-contact',contact:false});_setZoomInternal(1);panX=panY=100;redrawCanvas(true);})()`);await wait(250);
    const center=await evaluate(`(()=>{const b=ViewLimits.bounds(),r=canvas.getBoundingClientRect();return{x:r.left+(b.x[0]+800-28+b.x[1]+28)/2,y:r.top+viewportHeight*.4};})()`);
    // Two-finger movement reaches a 28px visible sliver, not the old centered clamp.
    await reset('panX=ViewLimits.bounds().x[0]+180;panY=100');await direct(pair('down',center.x,center.y));
    for(let i=1;i<=9;i++){await wait(14);await direct(pair('move',center.x-i*20,center.y));}await wait(130);
    const held=await pose();await direct(pair('up',center.x-180,center.y));await wait(100);
    const edge=await pose();assert(Math.abs(edge.panX-edge.bounds.x[0])<1,'Only the recoverable sliver remains visible');assert(!edge.outside);report.edge={held,rest:edge,visiblePixels:28};
    // A moving pinch carries both scale and translation into its release.
    await reset(`panX=${center.x}-canvas.getBoundingClientRect().left-400;panY=${center.y}-canvas.getBoundingClientRect().top-500`);
    await direct(pair('down',center.x,center.y));
    for(let i=1;i<=8;i++){await wait(14);await direct(pair('move',center.x+i*8,center.y,160+i*8));}await wait(10);
    const pinch=await pose(),pivot=center.x+64,world=(pivot-(await evaluate('canvas.getBoundingClientRect().left'))-pinch.panX)/pinch.zoom;
    await direct(pair('up',pivot,center.y,224));await wait(100);const gliding=await pose();
    const movedWorld=(pivot-(await evaluate('canvas.getBoundingClientRect().left'))-gliding.panX)/gliding.zoom;
    assert(gliding.zoom>pinch.zoom,'Scale continues from measured release velocity');assert(movedWorld<world-1,'Translation is retained during a zoom release');report.pinch={contact:pinch,gliding,worldShift:movedWorld-world};await wait(800);
    // A fast outward release continues briefly before the spring reverses it.
    await reset('panX=ViewLimits.bounds().x[1]-30;panY=100');await direct(pair('down',center.x,center.y));
    for(let i=1;i<=8;i++){await wait(14);await direct(pair('move',center.x+i*12,center.y));}await wait(9);const outgoing=await pose();
    await direct(pair('up',center.x+96,center.y));
    const bounce=await evaluate(`(async()=>{let peak=panX;for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);peak=Math.max(peak,panX);}return{peak,panX,animating:ViewLimits.animating};})()`);
    assert(bounce.peak>outgoing.panX+.2,'Incoming velocity is not zeroed at the boundary');await wait(1200);const settled=await pose();assert(!settled.outside&&!settled.animating);assert(Math.abs(settled.panX-settled.bounds.x[1])<.2);report.bounce={release:outgoing,trajectory:bounce,rest:settled};
    console.log(JSON.stringify({passed:true,...report}));
}finally{
    await evaluate('badnotesDirectInput({type:"cancel"});cancelCanvasInertia();ViewLimits.cancel()').catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
