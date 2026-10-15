import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),15000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let originalTheme;
const mouse=(type,x,y)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
async function flick(selector){
    const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),b=document.getElementById('recycleBinBtn').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,bx:b.left+b.width/2,by:b.top+b.height/2};})()`);
    await mouse('mousePressed',p.x,p.y);await wait(500);
    await mouse('mouseMoved',p.x-40,p.y+20);await wait(35);
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(selector.includes('page-thumb')?'/tmp/badnotes-page-pickup.png':'/tmp/badnotes-notebook-pickup.png',Buffer.from(shot.data,'base64'));
    for(const distance of [450,380,310,240]){await mouse('mouseMoved',p.bx+distance,p.by);await wait(16);}
    const held=await evaluate(`(()=>{const el=document.querySelector('.picked-up'),m=new DOMMatrix(getComputedStyle(el).transform),type=pageDrag.active?'page':'notebook',sampler=(pageDrag.active?pageDrag:notebookDrag).motion.sampler;return{tilt:m.b,plan:!!DragMotion.resolve(${p.bx+240},${p.by},sampler,type),outside:!isOverRecycleBin(${p.bx+240},${p.by},type),velocity:sampler.velocity(),type};})()`);
    // Tilt is sampled diagnostically: an occluded window may skip a RAF while
    // native input still arrives. Exact tilted suction continuity has its own
    // assertion in trash_catch_smoke, independent of compositor scheduling.
    assert(held.plan&&held.outside,JSON.stringify(held));
    await mouse('mouseReleased',p.bx+240,p.by);await wait(1000);return held;
}
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');originalTheme=await evaluate('settings.theme');
    const clockFallback=await evaluate(`(async()=>{const live=await Promise.race([new Promise(r=>requestAnimationFrame(()=>r(true))),new Promise(r=>setTimeout(()=>r(false),180))]);if(!live){requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),8);cancelAnimationFrame=clearTimeout;}return !live;})()`);
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};saveNotebookOrder=async()=>{};
        currentNotebook={id:'throw-fixture',name:'Throw fixture',template:'grid',pages:['throw-a','throw-b'],trash:[],contentTrash:[]};notebooks=[currentNotebook];
        pages=[{id:'throw-a',width:800,height:600,template:'grid',strokes:[],images:[]},{id:'throw-b',width:800,height:600,template:'dotted',strokes:[],images:[]}];currentPageIndex=0;loadPage(0);_setZoomInternal(1);panX=panY=0;applyTheme('light');
        window.trashCalls=[];window.failStash=false;
        window.fetch=async(url,options={})=>{trashCalls.push([url,options.method||'GET']);return{ok:!failStash,json:async()=>failStash?{error:'Fixture simulated persistence failure'}:{success:true}};};
        API.put=async()=>({success:true});API.post=async()=>({id:'replacement',width:800,height:600,strokes:[],images:[]});
        loadNotebooks=async()=>{notebooks=[];renderNotebookList();};renderNotebookList();renderPageList();document.getElementById('pageList').scrollTop=0;document.getElementById('sidebar').classList.remove('collapsed');document.getElementById('pageNav').classList.remove('collapsed');
    })()`);await wait(200);
    const holdGuard=await evaluate(`(async()=>{const results=[];for(const[selector,state]of[['.page-thumb',pageDrag],['.notebook-item',notebookDrag]]){
        const target=document.querySelector(selector),r=target.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const send=(type,dy=0)=>{const t=new Touch({identifier:881,target,clientX:x,clientY:y+dy});target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]}));};
        send('touchstart');await new Promise(r=>setTimeout(r,250));const shortHoldDidNotDrag=!state.active;send('touchmove',24);await new Promise(r=>setTimeout(r,450));const scrollCancelledPickup=!state.active&&!state.holdTimer;send('touchend',24);
        send('touchstart');await new Promise(r=>setTimeout(r,500));const deliberateHoldDidDrag=state.active;send('touchcancel');results.push({selector,shortHoldDidNotDrag,scrollCancelledPickup,deliberateHoldDidDrag});
    }return results;})()`);assert(holdGuard.every(r=>r.shortHoldDidNotDrag&&r.scrollCancelledPickup&&r.deliberateHoldDidDrag),JSON.stringify(holdGuard));
    const cancelPoint=await evaluate(`(()=>{const r=document.querySelector('.page-thumb').getBoundingClientRect(),b=document.getElementById('recycleBinBtn').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,bx:b.left+b.width/2,by:b.top+b.height/2};})()`);
    await mouse('mousePressed',cancelPoint.x,cancelPoint.y);await wait(500);await mouse('mouseMoved',cancelPoint.bx,cancelPoint.by);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await mouse('mouseReleased',cancelPoint.bx,cancelPoint.by);await wait(250);
    assert.equal(await evaluate('currentNotebook.trash.length'),0,'Escape cancels even while directly over the bin');assert.equal(await evaluate('pages.length'),2);
    const page=await flick('.page-thumb[data-index="1"]');assert.equal(await evaluate(`currentNotebook.trash[0]?.id`),'throw-b');assert.equal(await evaluate('pages.length'),1);
    // A large selected stroke moves with a single draw transform. Its points
    // and the background cache do not get rewritten every display frame.
    await evaluate(`(()=>{
        images=[];currentTool='lasso';clearLassoSelection();strokes=[{id:901,tool:'pen',size:4,color:'#ff6b6b',points:Array.from({length:12000},(_,i)=>({x:600+i/100,y:400+Math.sin(i/100)*12}))},{id:902,tool:'pen',size:3,color:'#ffffff',points:[{x:950,y:400},{x:1100,y:400}]}];historyStack=[];redoStack=[];
        lassoSelection.strokes=[0];lassoSelection.originalStrokes=[structuredClone(strokes[0])];lassoSelection.path=[{x:580,y:365},{x:740,y:365},{x:740,y:435},{x:580,y:435}];multiLassoSelections=[{path:structuredClone(lassoSelection.path),bounds:calculatePathBounds(lassoSelection.path)}];calculateSelectionBounds();invalidateStrokeCache();redrawCanvas(true);
        window.dragEvent=(x,y)=>{const r=canvas.getBoundingClientRect();return{pointerId:771,pointerType:'pen',clientX:r.left+panX+x*zoom,clientY:r.top+panY+y*zoom};};handleLassoPointerDown(dragEvent(660,400),660,400);window.previewVersion=strokeCacheVersion;
    })()`);
    const performanceResult=await evaluate(`(async()=>{const durations=[];for(let i=1;i<=24;i++){handleLassoPointerMove(dragEvent(660+i*3,400+i),660+i*3,400+i);await new Promise(r=>requestAnimationFrame(r));const t=performance.now();LassoWorkbench.paintDrag();durations.push(performance.now()-t);}return{pointUnchanged:strokes[0].points[0].x===600,outlineRetained:lassoSelection.path.length===4,cacheStable:strokeCacheVersion===previewVersion,centerX:lassoSelection.bounds.centerX,meanMs:durations.reduce((a,b)=>a+b,0)/durations.length,maxMs:Math.max(...durations)};})()`);
    assert(performanceResult.pointUnchanged&&performanceResult.outlineRetained&&performanceResult.cacheStable,JSON.stringify(performanceResult));
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-lasso-drag-live.png',Buffer.from(shot.data,'base64'));
    await evaluate(`handleLassoPointerUp(dragEvent(732,424))`);
    const outline=await evaluate(`({point:strokes[0].points[0].x,path:lassoSelection.path[0].x,region:multiLassoSelections[0].path[0].x,actions:historyStack.length})`);assert.equal(outline.point,672);assert.equal(outline.path,652);assert.equal(outline.region,652);assert.equal(outline.actions,1);
    await evaluate(`(()=>{undo();redo();clearLassoSelection();lassoSelection.strokes=[0];lassoSelection.originalStrokes=[structuredClone(strokes[0])];calculateSelectionBounds();const b=lassoSelection.bounds;handleLassoPointerDown(dragEvent(b.centerX,b.centerY),b.centerX,b.centerY);})()`);
    await evaluate(`(async()=>{const b=document.getElementById('recycleBinBtn').getBoundingClientRect(),r=canvas.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;for(const d of[370,300,230,160]){handleLassoPointerMove({pointerId:771,pointerType:'pen',clientX:x+d,clientY:y},(x+d-r.left-panX)/zoom,(y-r.top-panY)/zoom);await new Promise(r=>setTimeout(r,16));}handleLassoPointerUp({pointerId:771,pointerType:'pen',clientX:x+160,clientY:y});})()`);await wait(850);
    const selectedThrow=await evaluate(`(()=>{const archived=currentNotebook.contentTrash[0]?.strokes[0]?.item,removed=strokes.length===1,pose=archived?.points[0].x===672;undo();const undone=strokes.length===2&&strokes.some(s=>s.id===901&&s.points[0].x===672);redo();return{removed,pose,undone,redone:strokes.length===1};})()`);assert(Object.values(selectedThrow).every(Boolean),JSON.stringify(selectedThrow));
    // Failure cannot discard ink. This also checks ordinary direct drops.
    await evaluate(`(()=>{failStash=true;undo();clearLassoSelection();lassoSelection.strokes=[0];lassoSelection.originalStrokes=[structuredClone(strokes[0])];calculateSelectionBounds();const b=lassoSelection.bounds;handleLassoPointerDown(dragEvent(b.centerX,b.centerY),b.centerX,b.centerY);const r=document.getElementById('recycleBinBtn').getBoundingClientRect(),e={pointerId:771,pointerType:'pen',clientX:r.left+r.width/2,clientY:r.top+r.height/2};handleLassoPointerUp(e);})()`);await wait(250);assert.equal(await evaluate('strokes.length'),2);await evaluate('failStash=false;clearLassoSelection();redrawCanvas(true)');
    const imageDrag=await evaluate(`(async()=>{
        const texture=document.createElement('canvas');texture.width=texture.height=32;texture.getContext('2d').fillStyle='#ff0000';texture.getContext('2d').fillRect(0,0,32,32);const dataUrl=texture.toDataURL(),bitmap=new Image();bitmap.src=dataUrl;await bitmap.decode();window.imageCache.set('throw-image',bitmap);
        images=[{id:'throw-image',dataUrl,x:600,y:400,width:120,height:120,rotation:0}];selectedImage=null;historyStack=[];redoStack=[];redrawCanvas(true);
        handleImagePointerDown(dragEvent(660,460),660,460);handleImagePointerMove(dragEvent(700,490),700,490);redrawCanvas(true);
        const r=canvas.getBoundingClientRect(),pixel=(context,x,y)=>[...context.getImageData(Math.round((panX+x*zoom)*baseDPR),Math.round((panY+y*zoom)*baseDPR),1,1).data];
        const background=pixel(ctx,625,425),floating=pixel(activeCtx,700,490),version=strokeCacheVersion;
        handleImagePointerMove(dragEvent(720,500),720,500);redrawCanvas(true);const cacheStable=strokeCacheVersion===version;
        handleImagePointerUp(dragEvent(720,500));redrawCanvas(true);const committed=images[0].x===660&&images[0].y===440;undo();const undoPose=images[0].x===600;redo();return{background,floating,cacheStable,committed,undoPose,redoPose:images[0].x===660};
    })()`);
    assert(imageDrag.background[0]>200&&imageDrag.background[1]>200,'No image ghost left at pickup position');assert(imageDrag.floating[0]>200&&imageDrag.floating[1]<20&&imageDrag.floating[3]>200,'Moved image is drawn sharply on the active layer');assert(imageDrag.cacheStable&&imageDrag.committed&&imageDrag.undoPose&&imageDrag.redoPose,JSON.stringify(imageDrag));
    await evaluate(`(async()=>{const image=images[0];selectedImage=null;handleImagePointerDown(dragEvent(image.x+60,image.y+60),image.x+60,image.y+60);const b=document.getElementById('recycleBinBtn').getBoundingClientRect(),r=canvas.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;for(const d of[370,300,230,160]){handleImagePointerMove({pointerId:771,pointerType:'pen',clientX:x+d,clientY:y},(x+d-r.left-panX)/zoom,(y-r.top-panY)/zoom);redrawCanvas(true);await new Promise(r=>setTimeout(r,16));}handleImagePointerUp({pointerId:771,pointerType:'pen',clientX:x+160,clientY:y});})()`);await wait(850);
    assert.equal(await evaluate('images.length'),0,'Image momentum throw reaches the bin');assert.equal(await evaluate(`currentNotebook.contentTrash[0].images[0].item.x`),660,'Image trash stores its pre-throw pose');await evaluate('undo()');assert.equal(await evaluate('images[0].x'),660,'Thrown image can be undone');
    const notebook=await flick('.notebook-item');assert(await evaluate(`trashCalls.some(([url,method])=>url==='/api/notebooks/throw-fixture/trash'&&method==='POST')`));
    assert.equal(await evaluate(`trashCalls.some(([,method])=>method==='DELETE')`),false,'No permanent deletion requests');assert.equal(await evaluate(`document.querySelectorAll('.trash-genie,.picked-up').length`),0,'Transient visuals clean up');
    console.log(JSON.stringify({passed:true,clockFallback,holdGuard,page,performanceResult,outline,selectedThrow,imageDrag,notebook}));
}finally{await mouse('mouseReleased',800,80);await evaluate('LassoWorkbench.cancel();imageManipulation.isDragging=false;');if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
