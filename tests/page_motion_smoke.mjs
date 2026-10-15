import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),15000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let originalTheme;
const mouse=(type,x,y)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
const position=index=>evaluate(`(()=>{const r=document.querySelector('.page-thumb[data-index="${index}"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top};})()`);
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);originalTheme=await evaluate('settings.theme');
    const clockFallback=await evaluate(`(async()=>{const frames=await Promise.race([new Promise(r=>requestAnimationFrame(()=>r(true))),new Promise(r=>setTimeout(()=>r(false),180))]);if(!frames){requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),8);cancelAnimationFrame=clearTimeout;}return !frames;})()`);
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        currentNotebook={id:'page-motion-fixture',name:'Page motion',template:'grid',pages:['motion-a','motion-b','motion-c'],trash:[],contentTrash:[]};notebooks=[currentNotebook];
        pages=[{id:'motion-a',width:800,height:600,template:'grid',strokes:[],images:[]},{id:'motion-b',width:800,height:1100,template:'dotted',strokes:[],images:[]},{id:'motion-c',width:800,height:600,template:'grid',strokes:[],images:[]}];currentPageIndex=0;loadPage(0);_setZoomInternal(1);panX=panY=0;applyTheme('light');
        window.creationCalls=[];API.put=async()=>({success:true});API.post=async(url,body)=>{creationCalls.push({url,body});return{id:'motion-new',width:960,height:540,template:body.template,strokes:[],images:[]};};
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Animation fixtures must not write actual notes');return originalFetch(url,options);};
        renderNotebookList();renderPageList();document.getElementById('pageList').scrollTop=0;
    })()`);await wait(200);
    const origin=await position(0),chosen=await position(1);await mouse('mousePressed',origin.x,origin.y);await wait(500);
    await mouse('mouseMoved',chosen.x,chosen.y);await wait(20);
    for(const x of[1150,1100,1050]){await mouse('mouseMoved',x,chosen.y);await wait(16);}
    await evaluate(`(()=>{window.returnTrace=[];const sample=()=>{const clone=document.querySelector('.spring-returning');if(clone){const matrix=new DOMMatrix(clone.style.transform);returnTrace.push({x:matrix.m41,opacity:getComputedStyle(clone).opacity});}if(returnTrace.length<200)requestAnimationFrame(sample);};requestAnimationFrame(sample);})()`);
    await mouse('mouseReleased',1050,chosen.y);await wait(70);
    const returning=await evaluate(`(()=>{const clone=document.querySelector('.spring-returning'),slot=document.querySelector('.spring-return-slot');return{active:!!clone,velocity:clone?._releaseMotion.vx,opaque:clone&&getComputedStyle(clone).opacity==='1',slotHidden:slot&&getComputedStyle(slot).opacity==='0',interactive:slot&&getComputedStyle(slot).pointerEvents!=='none',order:pages.map(p=>p.id)};})()`);
    assert(returning.active&&returning.velocity<0&&returning.opaque&&returning.slotHidden&&returning.interactive,JSON.stringify(returning));assert.deepEqual(returning.order,['motion-b','motion-a','motion-c'],'A sideways throw keeps the chosen vertical slot');assert.equal(await evaluate('pages[currentPageIndex].id'),'motion-a');
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-page-spring-return.png',Buffer.from(shot.data,'base64'));await wait(1600);
    const settled=await evaluate(`({clones:document.querySelectorAll('.spring-returning').length,hiddenSlots:document.querySelectorAll('.spring-return-slot').length,trace:returnTrace})`);
    assert.equal(settled.clones,0);assert.equal(settled.hiddenSlots,0);assert(settled.trace.length>3&&settled.trace.every(p=>p.opacity==='1'),'Return stays solid instead of fading out');assert(settled.trace.some(p=>p.x>origin.left+1),'Physical spring overshoots and settles around its slot');
    // Reordering still lands in the chosen shelf slot rather than going home.
    const from=await position(0),to=await position(1);await mouse('mousePressed',from.x,from.y);await wait(500);await mouse('mouseMoved',to.x,to.y);await mouse('mouseReleased',to.x,to.y);await wait(1700);
    assert.deepEqual(await evaluate('pages.map(p=>p.id)'),['motion-a','motion-b','motion-c']);
    // Return to the order needed by the creation assertions below.
    await evaluate('movePage(0,1)');
    assert.deepEqual(await evaluate('pages.map(p=>p.id)'),['motion-b','motion-a','motion-c']);assert.equal(await evaluate('pages[currentPageIndex].id'),'motion-a');
    const created=await evaluate(`(async()=>{await addPage();const thumb=document.querySelector('.page-thumb[data-index="'+currentPageIndex+'"]'),paper=thumb.querySelector('.page-paper');return{id:pages[currentPageIndex].id,order:pages.map(p=>p.id),aspect:paper.style.aspectRatio,animation:paper.getAnimations().some(a=>a.playState==='running'),mainReveal:canvas.getAnimations().some(a=>a.playState==='running'),calls:creationCalls.length};})()`);
    assert.equal(created.id,'motion-new');assert.equal(created.aspect,'960 / 540');assert(created.animation&&created.mainReveal,'The new sheet and native canvas reveal animate immediately');assert.equal(created.calls,1);assert.deepEqual(created.order,['motion-b','motion-a','motion-new','motion-c']);
    const interruption=await evaluate(`(()=>{canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',pointerId:987,button:0,buttons:0,bubbles:true}));return{mainFinished:canvas.getAnimations().every(a=>a.playState!=='running'),paperFinished:document.querySelector('.page-thumb[data-index="'+currentPageIndex+'"] .page-paper').getAnimations().every(a=>a.playState!=='running')};})()`);assert(interruption.mainFinished&&interruption.paperFinished,'New-page animation never blocks the first drawing input');
    await wait(350);const thumbnail=await evaluate(`(()=>{const r=PageThumbnails.records.get('motion-new');return{width:r.canvas.width,height:r.canvas.height,aspect:r.paper.style.aspectRatio};})()`);assert(Math.abs(thumbnail.width/thumbnail.height-960/540)<.02);
    const animatedResolution=await evaluate(`(async()=>{DragMotion.animatePageAdded('motion-new',new Map());await new Promise(r=>setTimeout(r,50));const r=PageThumbnails.records.get('motion-new');return{width:r.canvas.width,layout:r.paper.clientWidth,scale:new DOMMatrix(getComputedStyle(r.paper).transform).a};})()`);assert(animatedResolution.width>=animatedResolution.layout*1.99,'Entrance scaling cannot lower thumbnail backing resolution');
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const reduced=await evaluate(`(()=>{canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,buttons:0}));DragMotion.animatePageAdded('motion-new',new Map());const paper=document.querySelector('.page-thumb[data-index="'+currentPageIndex+'"] .page-paper'),animations=paper.getAnimations().filter(a=>a.playState==='running');return{respected:matchMedia('(prefers-reduced-motion: reduce)').matches,opacityOnly:animations.every(a=>a.effect.getKeyframes().every(frame=>!frame.transform||frame.transform==='none'))};})()`);assert(reduced.respected&&reduced.opacityOnly);
    await call('Emulation.setEmulatedMedia',{features:[]});
    console.log(JSON.stringify({passed:true,clockFallback,returning,settled:{frames:settled.trace.length,overshoot:true},created,interruption,thumbnail,animatedResolution,reduced}));
}finally{await call('Emulation.setEmulatedMedia',{features:[]});await evaluate('LassoWorkbench.cancel();imageManipulation.isDragging=false;');if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
