// Profile a saved image-heavy document without mutating/saving its camera or content.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const cpuRate=Number(process.env.BADNOTES_CPU_RATE||1);
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    for(let i=0;i<60&&!await evaluate('!!currentNotebook&&HandwrittenTextField.hasFontData()');i++)await wait(100);
    if(process.env.BADNOTES_FIXED_VIEWPORT){await call('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1.4,mobile:false});await evaluate('handleWindowResize();redrawCanvas(true);');await wait(300);}
    if(process.env.BADNOTES_BASELINE_GRID)await evaluate(`getDotGridPath=function(columns,rows){
        if(_dotGridPath&&columns===_dotGridColumns&&rows===_dotGridRows)return _dotGridPath;
        if(columns*rows>MAX_CACHED_DOT_COUNT||typeof Path2D==='undefined')return null;
        const path=new Path2D();for(let x=0;x<columns;x++)for(let y=0;y<rows;y++){path.moveTo(x*DOT_GRID_SPACING+DOT_GRID_RADIUS,y*DOT_GRID_SPACING);path.arc(x*DOT_GRID_SPACING,y*DOT_GRID_SPACING,DOT_GRID_RADIUS,0,Math.PI*2);}
        _dotGridPath=path;_dotGridColumns=columns;_dotGridRows=rows;return path;
    };`);
    const scene=await evaluate(`(async()=>{
        let page;for(const book of [...notebooks].sort((a,b)=>(b.name==='WIAS')-(a.name==='WIAS'))){const data=await API.get('/api/notebooks/'+book.id);page=data.pages.find(p=>p.images?.length>=3);if(page)break;}if(!page)throw Error('No image-heavy saved page');
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};API.put=API.post=async()=>{throw Error('No profile writes');};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('No profile writes');return original(url,o);};currentNotebook=null;clearLassoSelection();isResizeReady=isPageResizing=false;
        strokes=structuredClone(page.strokes||[]);images=structuredClone(page.images);baseWidth=page.width;baseHeight=page.height;currentPageTemplate=page.template;SimpleTextField.setTextFields([]);HandwrittenTextField.setTextFields([{id:'profile-font',x:1500,y:150,width:550,fontSize:36,autoWidth:false,text:'Mathe Kurs 123456789 '.repeat(12),color:'#fff'}]);
        window.imageCache??=new Map();for(const item of images){const img=new Image();img.src=item.dataUrl;await img.decode();window.imageCache.set(item.id,img);}
        _setZoomInternal(1.5);panX=20;panY=180;invalidateStrokeCache(false);redrawCanvas(true);return{images:images.length,sourcePixels:images.reduce((n,i)=>n+window.imageCache.get(i.id).naturalWidth*window.imageCache.get(i.id).naturalHeight,0),strokes:strokes.length,width:baseWidth,height:baseHeight,viewportWidth,viewportHeight,dpr:baseDPR};
    })()`);
    console.log(JSON.stringify({loaded:scene,cpuRate}));await wait(1200);
    await call('Emulation.setCPUThrottlingRate',{rate:cpuRate});
    if(process.env.BADNOTES_PROFILE){await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});await call('Profiler.start');}
    const frames=await evaluate(`(async()=>{
        const costs=[],gaps=[];let last,occludedFrames=0;beginGesturePreview();isPinching=true;
        for(let i=0;i<180;i++){const tick=await Promise.race([new Promise(r=>requestAnimationFrame(time=>r({time,raf:true}))),new Promise(r=>setTimeout(()=>r({time:performance.now(),raf:false}),80))]);if(!tick.raf)occludedFrames++;const now=tick.time;_setZoomInternal(.15*Math.exp((Math.sin(i*Math.PI/70)+1)*1.2));panX=20;panY=180;const start=performance.now();redrawCanvas(true);costs.push(performance.now()-start);if(last)gaps.push(now-last);last=now;}
        _setZoomInternal(.3);panX=20;panY=180;redrawCanvas(true);const x=100,y=400,w=500,h=400;window.bitmapReleaseBefore=ctx.getImageData(x,y,w,h).data;
        // Compare raster quality at the same camera. Elastic view-limit settling
        // intentionally moves the camera in large windows and is tested by the
        // interaction/motion tests, not this pixel-parity benchmark.
        isPinching=false;endGesturePreview(true,false);costs.sort((a,b)=>a-b);gaps.sort((a,b)=>a-b);return{medianFrame:gaps[Math.floor(gaps.length*.5)],p95Frame:gaps[Math.floor(gaps.length*.95)],medianCPU:costs[90],p95CPU:costs[171],maxCPU:costs.at(-1),occludedFrames};
    })()`);
    if(process.env.BADNOTES_PROFILE){const{profile}=await call('Profiler.stop'),nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),cost=new Map();profile.samples.forEach((n,i)=>cost.set(n,(cost.get(n)||0)+profile.timeDeltas[i]));console.log(JSON.stringify({hotspots:[...cost].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([id,us])=>({ms:us/1000,...nodes.get(id)}))}));}
    await wait(700);
    const release=await evaluate(`(()=>{const after=ctx.getImageData(100,400,500,400).data;let changed=0,maxDelta=0;for(let i=0;i<after.length;i++){if(after[i]!==bitmapReleaseBefore[i])changed++;maxDelta=Math.max(maxDelta,Math.abs(after[i]-bitmapReleaseBefore[i]));}return{changed,maxDelta};})()`);assert.equal(release.changed,0,JSON.stringify(release));
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-image-font-zoom.png',Buffer.from(shot.data,'base64'));
    console.log(JSON.stringify({passed:true,validBenchmark:frames.occludedFrames===0,scene,cpuRate,baselineGrid:!!process.env.BADNOTES_BASELINE_GRID,frames,release}));
}finally{await call('Emulation.setCPUThrottlingRate',{rate:1});if(process.env.BADNOTES_FIXED_VIEWPORT)await call('Emulation.clearDeviceMetricsOverride');await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
