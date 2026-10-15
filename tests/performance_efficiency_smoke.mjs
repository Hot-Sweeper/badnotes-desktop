// Pixel parity, bounded derived buffers, idle work and on-demand tool/gesture
// updates. All document writes are blocked and all preferences are restored.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const metrics=async()=>Object.fromEntries((await call('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
const direct=events=>evaluate(`badnotesDirectInput(${JSON.stringify({type:'direct-touch',penContact:false,events})})`);
let storage;const report={};
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const originalFetch=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Efficiency fixtures cannot write notes');return originalFetch(url,o);};API.put=API.post=async()=>{throw Error('No fixture saves');};`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:150});await wait(3500);
    await evaluate(`(()=>{window.clockDetailMutations=0;window.clockEfficiencyObserver=new MutationObserver(entries=>clockDetailMutations+=entries.length);clockEfficiencyObserver.observe(document.getElementById('digitalClockDetails'),{subtree:true,childList:true,characterData:true,attributes:true});})()`);
    await call('Performance.enable');const before=await metrics();await wait(5000);const after=await metrics();
    report.idle={scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskMs:(after.TaskDuration-before.TaskDuration)*1000,nodesAdded:after.Nodes-before.Nodes,detailMutations:await evaluate('clockDetailMutations')};
    assert.equal(report.idle.detailMutations,0,'Closed timetable must not rebuild hidden content');assert(report.idle.nodesAdded<=0,'Idle ticks must not add discarded DOM nodes (GC may reclaim older nodes)');
    await evaluate('clockEfficiencyObserver.disconnect()');
    report.grid=await evaluate(`(()=>{
        let changed=0,maxDelta=0,cases=0;
        for(const[cols,rows]of[[129,79],[16,16],[7,5],[64,48]]){
            const old=new Path2D();for(let x=0;x<cols;x++)for(let y=0;y<rows;y++){old.moveTo(x*24+1.5,y*24);old.arc(x*24,y*24,1.5,0,Math.PI*2);}
            const next=getDotGridPath(cols,rows);
            for(const z of [.2,.333,1,3.17,24,400]){
                const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=400;a.height=b.height=300;
                for(const[c,p]of[[a,old],[b,next]]){const context=c.getContext('2d');context.setTransform(z*1.4,0,0,z*1.4,-37.15,-18.27);context.fill(p);}
                const x=a.getContext('2d').getImageData(0,0,400,300).data,y=b.getContext('2d').getImageData(0,0,400,300).data;
                for(let i=0;i<x.length;i++)if(x[i]!==y[i]){changed++;maxDelta=Math.max(maxDelta,Math.abs(x[i]-y[i]));}cases++;a.width=b.width=0;
            }
        }return{changed,maxDelta,cases,cachedDots:dotGridCachedCount};
    })()`);assert.equal(report.grid.changed,0);assert(report.grid.cachedDots<=50000);
    report.buffers=await evaluate(`(()=>{
        const source=document.createElement('canvas');source.width=1024;source.height=768;const context=source.getContext('2d');
        context.fillStyle='#c5429a';context.fillRect(0,0,1024,768);context.strokeStyle='#fff';context.lineWidth=3;context.beginPath();context.moveTo(10,20);context.bezierCurveTo(50,700,850,-400,1000,720);context.stroke();
        const render=()=>{const c=document.createElement('canvas');c.width=256;c.height=192;drawFilteredBitmap(c.getContext('2d'),source,0,0,256,192);return c;};
        const before=render(),pyramid=inkSamplingPyramids.get(source),levels=pyramid.levels.slice(1);
        const inverse=invertedBitmapSurface(levels[0]);let releasedBytes=levels.reduce((n,c)=>n+c.width*c.height*4,0)+inverse.width*inverse.height*4;
        invalidateBitmapSampling(source);const after=render(),a=before.getContext('2d').getImageData(0,0,256,192).data,b=after.getContext('2d').getImageData(0,0,256,192).data;
        let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
        const result={releasedBytes,zeroSized:levels.every(c=>c.width===0&&c.height===0)&&inverse.width===0&&inverse.height===0,sourceWidth:source.width,sourceHeight:source.height,changed};
        invalidateBitmapSampling(source);source.width=before.width=after.width=0;return result;
    })()`);assert(report.buffers.zeroSized&&report.buffers.releasedBytes>0);assert.equal(report.buffers.sourceWidth,1024);assert.equal(report.buffers.sourceHeight,768);assert.equal(report.buffers.changed,0);
    await evaluate(`(()=>{currentNotebook=null;strokes=[];images=[];HandwrittenTextField.setTextFields([]);SimpleTextField.setTextFields([]);baseWidth=2500;baseHeight=2000;_setZoomInternal(1);panX=panY=0;redrawCanvas(true);Toolbox.placeTool('ruler',200,240);})()`);await wait(500);
    report.nativeBuffer=await evaluate(`(()=>{
        strokes=[{tool:'pen',size:4,color:'#fff',points:[{x:20,y:20},{x:480,y:360}]}];invalidateStrokeCache(false);
        drawNativeInkSnapshot({x:0,y:0,w:500,h:400},0,0,0,0,false);
        const old=nativeInkSnapshot.surface,sample=getInkSamplingLevel(old,.2),levels=inkSamplingPyramids.get(old).levels.slice(1);
        const releasedBytes=old.width*old.height*4+levels.reduce((n,c)=>n+c.width*c.height*4,0);
        invalidateStrokeCache(false);const released=old.width===0&&old.height===0&&levels.every(c=>c.width===0&&c.height===0);
        strokes=[];invalidateStrokeCache(false);redrawCanvas(true);return{releasedBytes,released};
    })()`);assert(report.nativeBuffer.released&&report.nativeBuffer.releasedBytes>1000000);
    report.thumbnailJob=await evaluate(`(()=>{
        const record=PageThumbnails.records.values().next().value;if(!record)return{skipped:true};
        const old=record.canvas.width,surfaces=Array.from({length:3},()=>{const c=document.createElement('canvas');c.width=500;c.height=700;return c;});
        record.job={work:surfaces[0],content:surfaces[1],ink:surfaces[2]};PageThumbnails.dirty(record.page.id);
        return{released:surfaces.every(c=>c.width===0&&c.height===0),committedIntact:record.canvas.width===old,releasedBytes:3*500*700*4};
    })()`);if(!report.thumbnailJob.skipped)assert(report.thumbnailJob.released&&report.thumbnailJob.committedIntact);
    const oldPose=await evaluate(`(()=>{const e=document.querySelector('[data-tool-type=ruler]');return{left:parseFloat(e.style.left),top:parseFloat(e.style.top)};})()`);
    assert.deepEqual(oldPose,{left:200,top:240});
    report.toolPose=await evaluate(`(()=>{_setZoomInternal(1.5);panX=-100;panY=-50;redrawCanvas(true);const e=document.querySelector('[data-tool-type=ruler]');return{left:parseFloat(e.style.left),top:parseFloat(e.style.top),transform:e.style.transform};})()`);
    assert.equal(report.toolPose.left,200);assert.equal(report.toolPose.top,310);assert.match(report.toolPose.transform,/scale\(1\.5\)/);
    await evaluate(`window.savedEfficiencyRAF=requestAnimationFrame;window.efficiencyRAFs=0;requestAnimationFrame=function(fn){efficiencyRAFs++;return savedEfficiencyRAF(fn);};`);
    await wait(600);report.rulerIdleRAFs=await evaluate('efficiencyRAFs');assert.equal(report.rulerIdleRAFs,0,'A static ruler must not poll the camera at refresh rate');
    await evaluate(`requestAnimationFrame=savedEfficiencyRAF;Toolbox.removeTool(document.querySelector('[data-tool-type=ruler]').id);badnotesDirectInput({type:'cancel'});badnotesDirectInput({type:'touch-source',direct:true});badnotesDirectInput({type:'pen-contact',contact:false});fingerDrawingEnabled=false;penIsActive=false;lastPenEventTime=-10000;ViewLimits.cancel();_setZoomInternal(1);panX=panY=0;redrawCanvas(true);`);
    for(const count of [1,2]){
        const points=Array.from({length:count},(_,i)=>({id:91+i,phase:'down',x:650+i*150,y:500}));await direct(points);await wait(250);
        await evaluate(`efficiencyRAFs=0;requestAnimationFrame=function(fn){efficiencyRAFs++;return savedEfficiencyRAF(fn);};`);await wait(400);
        const rafs=await evaluate('efficiencyRAFs');assert.equal(rafs,0,'Resting '+count+' finger camera contact must not run recurring RAFs');report['stationary'+count+'FingerRAFs']=rafs;
        await evaluate('requestAnimationFrame=savedEfficiencyRAF');await direct(points.map(p=>({...p,phase:'up'})));await wait(100);
    }
    console.log(JSON.stringify({passed:true,...report}));
}finally{
    await evaluate(`if(window.savedEfficiencyRAF)requestAnimationFrame=savedEfficiencyRAF;window.clockEfficiencyObserver?.disconnect();window.badnotesDirectInput?.({type:'cancel'});window.ViewLimits?.cancel();`).catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
