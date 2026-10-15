// Static toy surfaces and removed-tool lifetimes. Native inputs; no note writes.
// Optional visual baseline: BADNOTES_TOOL_BASELINE=1 BADNOTES_TOOL_SOURCE=/path/to/old/32_toolbox.js.
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
const baseline=!!process.env.BADNOTES_TOOL_BASELINE;
const cpuRate=Number(process.env.BADNOTES_CPU_RATE||1);
const source=process.env.BADNOTES_TOOL_SOURCE&&await readFile(process.env.BADNOTES_TOOL_SOURCE,'utf8');
const fixtureSource=(source||await readFile(new URL('../static/js/modules/32_toolbox.js',import.meta.url),'utf8'))
    .replace('const Toolbox = (() => {','window.smokeToolbox = (() => {')
    .replaceAll('function draw() {','ctx._smokeDraw = draw; function draw() {');
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const key=async value=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:value});await call('Input.dispatchKeyEvent',{type:'keyUp',key:value});await wait(50);};
const metrics=async()=>Object.fromEntries((await call('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
let storage;const report={baseline,cpuRate};
async function snapshot(name,type){
    // Canvas readback can switch Chromium's text raster backend. Repaint the
    // unchanged state after readback in both versions for a like-for-like
    // pixel comparison; native feedback/cadence is measured separately.
    await evaluate(`(()=>{const c=document.querySelector('[data-tool-type="${type}"] canvas'),ctx=c.getContext('2d');ctx.getImageData(0,0,1,1);ctx.getImageData(0,0,1,1);ctx._smokeDraw();})()`);
    const png=await evaluate(`document.querySelector('[data-tool-type="${type}"] canvas').toDataURL()`),path='/tmp/badnotes-toy-'+name+'.png';
    if(baseline){await writeFile(path,Buffer.from(png.split(',')[1],'base64'));return;}
    let reference;
    try{reference='data:image/png;base64,'+(await readFile(path)).toString('base64');}
    catch(error){if(error.code!=='ENOENT')throw error;(report.pixels??={})[name]={skipped:'No local pre-change reference; generate with BADNOTES_TOOL_BASELINE=1'};return;}
    const match=await evaluate(`(async()=>{const img=new Image();img.src=${JSON.stringify(reference)};await img.decode();const c=document.querySelector('[data-tool-type="${type}"] canvas'),old=document.createElement('canvas');old.width=img.naturalWidth;old.height=img.naturalHeight;old.getContext('2d').drawImage(img,0,0);if(old.width!==c.width||old.height!==c.height)return{size:false};const a=old.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let changed=0,maxDelta=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){changed++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}old.width=0;return{size:true,changed,maxDelta};})()`);
    if(match.changed)await writeFile('/tmp/badnotes-toy-'+name+'-actual.png',Buffer.from(png.split(',')[1],'base64'));
    // Old-renderer repeat runs also differ by seven 1/255 channel steps after
    // native canvas readback. Allow only that tiny raster rounding, not changes
    // to geometry, colors, text placement, density or button feedback.
    assert.equal(match.size,true,name);assert(match.maxDelta<=1&&match.changed<=100,name+': '+JSON.stringify(match));(report.pixels??={})[name]=match;
}
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(fixtureSource);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:150});
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Tool fixtures cannot write notes');return original(url,o);};API.put=API.post=async()=>{throw Error('No fixture writes');};currentNotebook=null;strokes=[];images=[];HandwrittenTextField.setTextFields([]);SimpleTextField.setTextFields([]);_setZoomInternal(1);panX=panY=0;redrawCanvas(true);smokeToolbox.placeTool('calculator',150,180);smokeToolbox.placeTool('gameboy',550,180);window.toolPaintCounts={calculator:0,gameboy:0};for(const type of ['calculator','gameboy']){const c=document.querySelector('[data-tool-type="'+type+'"] canvas'),ctx=c.getContext('2d'),clear=ctx._clearFull;ctx._clearFull=function(...args){toolPaintCounts[type]++;return clear.apply(this,args);};}})()`);await wait(600);
    await snapshot('calculator-initial','calculator');await snapshot('gameboy-menu','gameboy');
    await call('Emulation.setCPUThrottlingRate',{rate:cpuRate});
    await call('Performance.enable');await evaluate('toolPaintCounts.calculator=toolPaintCounts.gameboy=0');const before=await metrics();await wait(1500);const after=await metrics();
    report.idle={paints:await evaluate('toolPaintCounts'),scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskMs:(after.TaskDuration-before.TaskDuration)*1000};
    if(!baseline&&!source)assert.deepEqual(report.idle.paints,{calculator:0,gameboy:0});
    for(const value of ['7','+','8','Enter'])await key(value);await wait(160);await snapshot('calculator-result','calculator');
    await key('Escape');await key('ArrowDown');await wait(150);await snapshot('gameboy-menu-next','gameboy');
    // Pen presses a real calculator key: original 100ms feedback must remain.
    const button=await evaluate(`(()=>{const c=document.querySelector('[data-tool-type="calculator"] canvas'),r=c.getBoundingClientRect(),w=288,h=528,pad=parseInt(c.dataset.pad);const bw=(w-8-10-12)/5,bh=(h-(56+Math.round(h*.18)+16)-4-10-40)/9;return{x:r.left+(pad+9+(bw+3)+bw/2)/(w+pad*2)*r.width,y:r.top+(pad+56+Math.round(h*.18)+16+7*(bh+5)+bh/2)/(h+pad*2)*r.height};})()`);
    const beforePen=await evaluate('toolPaintCounts.calculator');await call('Input.dispatchMouseEvent',{type:'mousePressed',...button,pointerType:'pen',button:'left',buttons:1,clickCount:1});await wait(30);
    report.penPaints=await evaluate('toolPaintCounts.calculator')-beforePen;assert(report.penPaints>0);await call('Input.dispatchMouseEvent',{type:'mouseReleased',...button,pointerType:'pen',button:'left',buttons:0,clickCount:1});await wait(160);await snapshot('calculator-released','calculator');
    // Backing density still follows page zoom/pinning, not a stretched bitmap.
    report.resolution=await evaluate(`(()=>{const c=document.querySelector('[data-tool-type="calculator"] canvas');return{width:c.width,height:c.height};})()`);
    await evaluate('_setZoomInternal(2);redrawCanvas(true)');await wait(140);const grown=await evaluate(`(()=>{const c=document.querySelector('[data-tool-type="calculator"] canvas');return{width:c.width,height:c.height};})()`);
    assert(grown.width>report.resolution.width);report.grown=grown;
    if(!baseline&&!source){
        await evaluate('toolPaintCounts.calculator=toolPaintCounts.gameboy=0;panX+=80;panY+=60;redrawCanvas(true)');await wait(160);
        report.panPaints=await evaluate('toolPaintCounts');assert.deepEqual(report.panPaints,{calculator:0,gameboy:0},'Moving static tools only updates their compositor pose');
    }
    report.discarded=await evaluate(`(()=>{const surfaces=[...document.querySelectorAll('.toy-canvas')],bytes=surfaces.reduce((n,c)=>n+c.width*c.height*4,0);smokeToolbox.removeTool(document.querySelector('[data-tool-type="calculator"]').id);smokeToolbox.removeTool(document.querySelector('[data-tool-type="gameboy"]').id);toolPaintCounts.calculator=toolPaintCounts.gameboy=0;return{bytes,released:surfaces.every(c=>c.width===0&&c.height===0)};})()`);await wait(1000);report.afterClose=await evaluate('toolPaintCounts');if(!baseline&&!source){assert.deepEqual(report.afterClose,{calculator:0,gameboy:0});assert(report.discarded.released);}
    if(!baseline&&!source){
        await call('HeapProfiler.collectGarbage');const listeners=(await metrics()).JSEventListeners;
        for(let i=0;i<8;i++){await evaluate(`smokeToolbox.placeTool('calculator',150,180);smokeToolbox.placeTool('gameboy',550,180);`);await wait(25);await evaluate(`for(const e of document.querySelectorAll('.toolbox-canvas-item'))smokeToolbox.removeTool(e.id);`);}
        await wait(250);await call('HeapProfiler.collectGarbage');report.listenerGrowth=(await metrics()).JSEventListeners-listeners;assert.equal(report.listenerGrowth,0,'Repeated open/close must not retain keyboard or tool listeners');
    }
    console.log(JSON.stringify({passed:true,...report}));
}finally{
    await call('Emulation.setCPUThrottlingRate',{rate:1});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
