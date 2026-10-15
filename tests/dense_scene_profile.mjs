// Benchmark visible dense ink, not the blank portion of a dense saved page.
// Original documents/preferences are restored; all fixture writes are blocked.
import {readFile} from 'node:fs/promises';
const pagePath=process.env.BADNOTES_DENSE_PAGE||'data/notebooks/4f5bd6ff/40d455dd.json';
const page=JSON.parse(await readFile(new URL('../'+pagePath,import.meta.url),'utf8'));
const cpuRate=Number(process.env.BADNOTES_CPU_RATE||1),copies=Number(process.env.BADNOTES_DENSE_COPIES||1);
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes'),ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),90000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const baselineScripts=new Map(),reply=ws.onmessage;
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const body=baselineScripts.get(new URL(m.params.request.url).pathname);call(body?'Fetch.fulfillRequest':'Fetch.continueRequest',body?{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript; charset=utf-8'}],body:Buffer.from(body).toString('base64')}:{requestId:m.params.requestId}).catch(error=>console.error(error));return;}reply(e);};
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));let storage;
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    if(process.env.BADNOTES_DENSE_BASELINE){baselineScripts.set('/static/js/modules/03_canvas_core.js',await readFile(process.env.BADNOTES_DENSE_BASELINE,'utf8'));const thumbs=await readFile(new URL('../static/js/tools/PageThumbnails.js',import.meta.url),'utf8');baselineScripts.set('/static/js/tools/PageThumbnails.js',thumbs.replace(/        \/\/ Panning\/zooming changes no thumbnail content\.[\s\S]*?(?=        queued=false;const deadline=)/,''));await call('Fetch.enable',{patterns:[...baselineScripts.keys()].map(path=>({urlPattern:'*'+path+'*',requestStage:'Request'}))});}
    await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    if(process.env.BADNOTES_DENSE_PADDING)await evaluate(`drawNativeInkSnapshot=eval('('+drawNativeInkSnapshot.toString().replace('const padding = 320 / zoom','const padding = '+${Number(process.env.BADNOTES_DENSE_PADDING)}+' / zoom')+')');`);
    if(process.env.BADNOTES_DENSE_BATCH)await evaluate(`startVectorStrokeCommandBuild=eval('('+startVectorStrokeCommandBuild.toString().replaceAll('VECTOR_BATCH_MAX_STROKES',${JSON.stringify(String(Number(process.env.BADNOTES_DENSE_BATCH)))})+')');`);
    if(process.env.BADNOTES_DENSE_NO_INK)await evaluate('drawVectorStrokeCommands=function(){};');
    const scene=await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('No dense fixture writes');return original(url,o);};API.put=API.post=async()=>{throw Error('No dense fixture writes');};currentNotebook=null;clearLassoSelection();isResizeReady=isPageResizing=false;HandwrittenTextField.setTextFields([]);SimpleTextField.setTextFields([]);images=[];
        const p=${JSON.stringify(page)};strokes=[];for(let copy=0;copy<${copies};copy++)for(const old of p.strokes){const s=structuredClone(old);s.id='dense-'+copy+'-'+s.id;strokes.push(s);}baseWidth=p.width;baseHeight=p.height;currentPageTemplate='blank';
        let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const s of strokes)for(const p of s.points||[]){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}window.denseFocus={x:(left+right)/2,y:(top+bottom)/2};
        _setZoomInternal(1.5);panX=viewportWidth/2-denseFocus.x*zoom;panY=viewportHeight/2-denseFocus.y*zoom;invalidateStrokeCache(false);redrawCanvas(true);beginStrokeCacheBuild(1.5);return{strokes:strokes.length,points:strokes.reduce((n,s)=>n+s.points.length,0),focus:denseFocus,ink:{left,top,right,bottom},viewport:[viewportWidth,viewportHeight],dpr:baseDPR};})()`);
    for(let i=0;i<150&&!await evaluate('strokeCacheValid&&!!vectorStrokeCommandsCache?.commands');i++)await wait(20);
    await call('Emulation.setCPUThrottlingRate',{rate:cpuRate});
    await evaluate(`window.denseReplays=0;window.denseReplayCosts=[];window.denseReplayOriginal=drawVectorStrokeCommands;drawVectorStrokeCommands=function(...args){const t=performance.now();denseReplays++;const out=denseReplayOriginal(...args);denseReplayCosts.push(performance.now()-t);return out;};`);
    if(process.env.BADNOTES_DENSE_PROFILE){await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:500});await call('Profiler.start');}
    const stages=[];
    for(const mode of ['pan','zoom','repeat']){
        const r=await evaluate(`(async()=>{beginGesturePreview();isPinching=true;let last,stalls=0,hiddenFrames=0;const costs=[],gaps=[];const replays=denseReplays;let peakBytes=0;
            for(let i=0;i<180;i++){const tick=await new Promise(r=>{const frame=requestAnimationFrame(t=>{clearTimeout(timer);r({t,raf:true});}),timer=setTimeout(()=>{cancelAnimationFrame(frame);r({t:performance.now(),raf:false});},100);});if(!tick.raf)stalls++;if(document.hidden)hiddenFrames++;if(last!=null)gaps.push(tick.t-last);last=tick.t;
                const z=${JSON.stringify(mode)}==='pan'?4:${JSON.stringify(mode)}==='zoom'?.5*Math.exp((1+Math.sin(i*Math.PI/90))*1.4):1.2*Math.exp(Math.sin(i*Math.PI/30)*1.1);
                _setZoomInternal(z);panX=viewportWidth/2-denseFocus.x*zoom+Math.sin(i/30)*180;panY=viewportHeight/2-denseFocus.y*zoom+Math.cos(i/40)*100;
                const t=performance.now();redrawCanvas(true);costs.push(performance.now()-t);if(nativeInkSnapshot?.surface)peakBytes=Math.max(peakBytes,nativeInkSnapshot.surface.width*nativeInkSnapshot.surface.height*4);
            }costs.sort((a,b)=>a-b);gaps.sort((a,b)=>a-b);return{mode:${JSON.stringify(mode)},p50CPU:costs[90],p95CPU:costs[171],maxCPU:costs.at(-1),p50Frame:gaps[89],p95Frame:gaps[170],maxFrame:gaps.at(-1),missed120:gaps.filter(t=>t>12.6).length,stalls,hiddenFrames,focused:document.hasFocus(),replays:denseReplays-replays,peakBytes};})()`);stages.push(r);
    }
    if(process.env.BADNOTES_DENSE_PROFILE){const {profile}=await call('Profiler.stop'),nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),cost=new Map();profile.samples.forEach((n,i)=>cost.set(n,(cost.get(n)||0)+profile.timeDeltas[i]));console.log(JSON.stringify({hotspots:[...cost].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,us])=>({ms:us/1000,...nodes.get(id)}))}));}
    const replay=await evaluate(`(()=>{const c=denseReplayCosts.sort((a,b)=>a-b);return{count:c.length,p95:c[Math.floor(c.length*.95)]||0,max:c.at(-1)||0};})()`);
    console.log(JSON.stringify({passed:true,validBenchmark:stages.every(s=>s.hiddenFrames===0&&s.focused),pagePath,copies,cpuRate,baseline:!!process.env.BADNOTES_DENSE_BASELINE,inkSuppressed:!!process.env.BADNOTES_DENSE_NO_INK,batch:process.env.BADNOTES_DENSE_BATCH||64,scene,stages,replay}));
}finally{
    await call('Emulation.setCPUThrottlingRate',{rate:1});await evaluate('isPinching=false;endGesturePreview(false,false);ViewLimits.cancel()').catch(()=>{});
    if(baselineScripts.size)await call('Fetch.disable');
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
