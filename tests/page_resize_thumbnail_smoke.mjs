import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),15000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let originalTheme,originalStorage;
try{
    await evaluate('saveCurrentPage()');originalStorage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);
    originalTheme=await evaluate('settings.theme');
    const compositorClockFallback=await evaluate(`(async()=>{const frames=await Promise.race([new Promise(resolve=>requestAnimationFrame(()=>resolve(true))),new Promise(resolve=>setTimeout(()=>resolve(false),180))]);if(!frames){window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;}return !frames;})()`);
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>PageThumbnails.dirty();
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Resize fixtures must not write actual notes');return originalFetch(url,options);};
        currentNotebook={id:'resize-preview-fixture',name:'Live resize preview',template:'grid',pages:['resize-page','unchanged-page']};
        pages=[{id:'resize-page',width:800,height:600,template:'grid',gridShiftX:0,gridShiftY:0,strokes:[{id:98765,tool:'pen',size:10,color:'#ff6b6b',points:[{x:120,y:120},{x:360,y:120}]}],images:[],textFields:[],handwrittenTextFields:[]},
            {id:'unchanged-page',width:800,height:1100,template:'dotted',strokes:[],images:[]}];
        currentPageIndex=0;loadPage(0);applyTheme('light');_setZoomInternal(1);panX=panY=0;historyStack=[];redoStack=[];renderPageList();document.getElementById('pageList').scrollTop=0;
        window.resizeTestSample=()=>{const r=PageThumbnails.records.get('resize-page'),p=isPageResizing&&tempResize||{w:baseWidth,h:baseHeight,shiftX:0,shiftY:0},scale=r.canvas.width/p.w;
            const x=Math.round((200+(p.shiftX||0))*scale),y=Math.round((120+(p.shiftY||0))*scale),pixel=[...r.canvas.getContext('2d').getImageData(x,y,1,1).data];
            return{aspect:r.paper.style.aspectRatio,width:r.canvas.width,height:r.canvas.height,worldWidth:p.w,worldHeight:p.h,pixel,savedWidth:pages[0].width,savedHeight:pages[0].height,nextAspect:PageThumbnails.records.get('unchanged-page').paper.style.aspectRatio};};
    })()`);await wait(350);
    assert(await evaluate(`!!PageThumbnails.records.get('resize-page').snapshot`),'Visible preview has a reusable page-local content layer');
    const cases=[];
    for(const [direction,dx,dy,w,h] of [['right',400,0,1200,600],['bottom',0,300,800,900],['tl',-120,-80,920,680],['br',240,200,1040,800],['left',180,0,620,600]]){
        const instant=await evaluate(`(()=>{isPageResizing=true;pageResizeDirection=${JSON.stringify(direction)};pageResizeStartWidth=800;pageResizeStartHeight=600;pageResizeStartX=pageResizeStartY=0;const rect=canvas.getBoundingClientRect();handleResizeMove({clientX:rect.left+${dx},clientY:rect.top+${dy}});return resizeTestSample();})()`);
        assert.equal(instant.aspect,`${w} / ${h}`,'CSS aspect follows pointer synchronously before pen-up');
        assert.equal(instant.savedWidth,800);assert.equal(instant.savedHeight,600);
        await wait(55);const preview=await evaluate('resizeTestSample()');
        assert(Math.abs(preview.width/preview.height-w/h)<.015,'Backing canvas follows live geometry: '+JSON.stringify(preview));
        assert(preview.pixel[0]>180&&preview.pixel[1]<170&&preview.pixel[2]<170,'Ink stays at its translated world coordinates, not stretched: '+JSON.stringify(preview));
        assert.equal(preview.nextAspect,'800 / 1100');cases.push({direction,...preview});
    }
    // Cancel transient dimensions without touching saved data, then rapidly
    // coalesce multiple pointer samples and release before the next frame.
    await evaluate(`(()=>{isPageResizing=false;window.tempResize=null;redrawCanvas();})()`);await wait(160);
    assert.equal((await evaluate('resizeTestSample()')).aspect,'800 / 600');
    const coalesced=await evaluate(`(()=>{isPageResizing=true;pageResizeDirection='br';pageResizeStartWidth=800;pageResizeStartHeight=600;pageResizeStartX=pageResizeStartY=0;const rect=canvas.getBoundingClientRect();for(let i=0;i<25;i++)handleResizeMove({clientX:rect.left+i*10,clientY:rect.top+i*5});const before=resizeTestSample();handleResizeEnd({});return{before,after:resizeTestSample()};})()`);
    assert.equal(coalesced.before.aspect,'1040 / 720');assert.equal(coalesced.before.savedWidth,800);
    assert.equal(coalesced.after.savedWidth,1040);assert.equal(coalesced.after.savedHeight,720);
    await wait(180);const committed=await evaluate('resizeTestSample()');assert.equal(committed.aspect,'1040 / 720');assert(committed.pixel[0]>180&&committed.pixel[1]<170);
    // A top-left commit preserves the same ink position as its live preview.
    await evaluate(`(()=>{isPageResizing=true;pageResizeDirection='tl';pageResizeStartWidth=baseWidth;pageResizeStartHeight=baseHeight;pageResizeStartX=pageResizeStartY=0;const rect=canvas.getBoundingClientRect();handleResizeMove({clientX:rect.left-80,clientY:rect.top-50});})()`);await wait(55);
    const beforeLeft=await evaluate('resizeTestSample()');assert(beforeLeft.pixel[1]<170);
    await evaluate('handleResizeEnd({})');await wait(180);
    const afterLeft=await evaluate(`(()=>{const r=PageThumbnails.records.get('resize-page'),scale=r.canvas.width/baseWidth;return{aspect:r.paper.style.aspectRatio,pixel:[...r.canvas.getContext('2d').getImageData(Math.round(280*scale),Math.round(170*scale),1,1).data]};})()`);
    assert.equal(afterLeft.aspect,'1120 / 770');assert(afterLeft.pixel[0]>180&&afterLeft.pixel[1]<170);
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-live-resize-thumbnail.png',Buffer.from(shot.data,'base64'));
    console.log(JSON.stringify({passed:true,compositorClockFallback,cases,coalesced,committed,afterLeft}));
}finally{await evaluate(`isPageResizing=false;window.tempResize=null;`);if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);if(originalStorage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(originalStorage)}))localStorage.setItem(k,v);})()`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
