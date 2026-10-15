// Native pickup/drop/throw input with fixture-only recoverable archives.
// Never sends document mutations to the real backend.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const mouse=(type,x,y)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
let originalTheme,originalAccent,mediaOverridden=false;
const pickup=async selector=>{
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);await wait(180);
    const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)?.closest('.page-thumb,.notebook-item')?.className,nav:document.getElementById('pageNav').className};})()`);
    assert(p.hit,JSON.stringify(p));
    await mouse('mousePressed',p.x,p.y);await wait(500);await mouse('mouseMoved',p.x-20,p.y+10);await wait(40);
    assert.equal(await evaluate('pageDrag.active||notebookDrag.active'),true,JSON.stringify({p,state:await evaluate('({page:pageDrag.active,book:notebookDrag.active,pressing:pageDrag.pressing,hold:!!pageDrag.holdTimer,focus:document.hasFocus()})')}));
};
const shot=async path=>{const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'));};
try {
    await mouse('mouseReleased',800,80);
    await evaluate('closeSettingsModal();saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    [originalTheme,originalAccent]=await evaluate('[settings.theme,settings.accentTheme]');
    const clockFallback=await evaluate(`(async()=>{const live=await Promise.race([new Promise(r=>requestAnimationFrame(()=>r(true))),new Promise(r=>setTimeout(()=>r(false),180))]);if(!live){requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),8);cancelAnimationFrame=clearTimeout;}return !live;})()`);
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};saveNotebookOrder=async()=>{};
        currentNotebook={id:'catch-fixture',name:'Catch test',color:'#7640fd',icon:'book',template:'dotted',pages:['catch-a','catch-b','catch-c','catch-d'],trash:[],contentTrash:[]};
        notebooks=[currentNotebook,{id:'catch-other',name:'Closer notebook aim',color:'#3b6abd',icon:'book',pages:[],trash:[]}];
        pages=currentNotebook.pages.map((id,i)=>({id,width:800,height:700,template:'dotted',images:[],strokes:[{id:i+100,tool:'pen',size:4,color:'#ffffff',points:[{x:100,y:100},{x:600,y:520}]}]}));currentPageIndex=0;loadPage(0);renderNotebookList();renderPageList();
        window.catchRequests=[];window.catchArchivedBooks=[];window.failCatchPage=false;
        window.fetch=async(url,options={})=>{catchRequests.push([url,options.method||'GET']);if(String(url).endsWith('/trash')&&options.method==='POST')catchArchivedBooks.push(String(url).split('/')[3]);return{ok:true,json:async()=>({success:true})};};
        API.put=async(url)=>{catchRequests.push([url,'PUT']);return failCatchPage?null:{success:true};};API.post=async(url)=>{catchRequests.push([url,'POST']);return{id:'catch-replacement',width:800,height:700,strokes:[],images:[]};};
        loadNotebooks=async()=>{notebooks=notebooks.filter(n=>!catchArchivedBooks.includes(n.id));renderNotebookList();};
        document.getElementById('sidebar').classList.remove('collapsed');document.getElementById('pageNav').classList.remove('collapsed');
        window.catchBinStyle=()=>{const b=document.getElementById('recycleBinBtn'),s=getComputedStyle(b);return{ready:b.classList.contains('drag-over'),near:b.classList.contains('trash-near'),incoming:b.classList.contains('trash-incoming'),sucking:b.classList.contains('sucking'),progress:Number(s.getPropertyValue('--trash-proximity')),pulse:s.animationName,iconAnimation:getComputedStyle(b.querySelector('svg')).animationName,lid:getComputedStyle(b.querySelector('.trash-lid')).transform,rect:DragMotion.binRect()};};
    })()`);await wait(450);
    const bin=await evaluate(`(()=>{const r=DragMotion.binRect();return{...r,cx:r.left+r.width/2,cy:r.top+r.height/2};})()`);
    const direct={x:bin.cx+110,y:bin.cy-15};
    const zones=await evaluate(`({page:isOverRecycleBin(${direct.x},${direct.y},'page'),book:isOverRecycleBin(${direct.x},${direct.y},'notebook'),pageRadius:DragMotion.catchRadius(DragMotion.binRect(),'page'),bookRadius:DragMotion.catchRadius(DragMotion.binRect(),'notebook')})`);
    assert(zones.page&&!zones.book&&zones.pageRadius>zones.bookRadius+40,JSON.stringify(zones));
    await pickup('.page-thumb[data-index="2"]');await mouse('mouseMoved',direct.x,direct.y);await wait(200);
    const ready=await evaluate('catchBinStyle()');assert(ready.ready&&ready.near&&ready.progress===1,JSON.stringify(ready));assert.equal(ready.pulse,'none');assert.equal(ready.iconAnimation,'none');assert.notEqual(ready.lid,'none');assert.equal(ready.rect.width,bin.width);
    assert(Math.abs(ready.rect.left-bin.left)<.8&&Math.abs(ready.rect.top-bin.top)<.8,'Bin scaling must not move/grow the real hitbox');
    await shot('/tmp/badnotes-trash-page-ready.png');
    await mouse('mouseReleased',direct.x,direct.y);await wait(100);
    const suction=await evaluate(`({strips:document.querySelectorAll('.trash-genie-strip').length,...catchBinStyle()})`);assert.equal(suction.strips,24);assert(suction.incoming&&suction.sucking,'Lid remains receptive throughout the absorption');await shot('/tmp/badnotes-trash-page-suction.png');await wait(650);
    assert.equal(await evaluate('currentNotebook.trash[0].id'),'catch-c');assert.equal(await evaluate('pages.length'),3);assert.equal((await evaluate('catchBinStyle()')).incoming,false);
    // Identical release point does not recycle an entire notebook.
    await pickup('.notebook-item[data-id="catch-other"]');await mouse('mouseMoved',direct.x,direct.y);await wait(200);
    const bookNear=await evaluate('catchBinStyle()');assert(!bookNear.ready&&bookNear.near&&bookNear.progress>0&&bookNear.progress<1,JSON.stringify(bookNear));await shot('/tmp/badnotes-trash-notebook-near.png');await mouse('mouseReleased',direct.x,direct.y);await wait(1700);assert.equal(await evaluate('catchArchivedBooks.length'),0);
    // A true miss keeps its page. A slightly off-center aimed flick is caught.
    const flick=async(verticalOffset,upward=false)=>{
        await pickup('.page-thumb[data-index="1"]');
        let y=bin.cy+verticalOffset;for(const [i,dx]of [390,330,270,210].entries()){y=bin.cy+verticalOffset-(upward?i*40:0);await mouse('mouseMoved',bin.cx+dx,y);await wait(16);}
        const forecast=await evaluate(`({plan:!!DragMotion.resolve(${bin.cx+210},${y},pageDrag.motion.sampler,'page'),direct:isOverRecycleBin(${bin.cx+210},${y},'page'),ready:catchBinStyle().ready,velocity:pageDrag.motion.sampler.velocity(),active:pageDrag.active,client:[pageDrag.clientX,pageDrag.clientY]})`);
        await mouse('mouseReleased',bin.cx+210,y);return forecast;
    };
    const miss=await flick(-310,true);assert(!miss.plan&&!miss.direct&&!miss.ready,JSON.stringify(miss));await wait(1700);assert.equal(await evaluate('pages.length'),3);
    const thrown=await flick(-100);assert(thrown.plan&&!thrown.direct&&thrown.ready,JSON.stringify(thrown));
    const impactFrames=await evaluate(`(async()=>{const frames=[];for(let i=0;i<48;i++){await new Promise(r=>setTimeout(r,16));const b=document.getElementById('recycleBinBtn'),s=getComputedStyle(b);frames.push({x:parseFloat(s.getPropertyValue('--trash-impact-x')),y:parseFloat(s.getPropertyValue('--trash-impact-y')),angle:parseFloat(s.getPropertyValue('--trash-impact-angle')),size:parseFloat(s.getPropertyValue('--trash-impact-scale')),left:DragMotion.binRect().left,pulse:s.animationName});}return frames;})()`);
    assert(Math.min(...impactFrames.map(f=>f.x))<-.5,'A leftward page impact recoils left');assert(Math.max(...impactFrames.map(f=>f.x))>.05,'Directional recoil gently overshoots and settles');assert(Math.min(...impactFrames.map(f=>f.angle))<-.2,'Impact also tilts the bin');assert(Math.min(...impactFrames.map(f=>f.size))<1.12,'Impact compresses the receptive 1.14-scale bin');assert(impactFrames.every(f=>f.left===bin.left&&f.pulse==='none'),'Impact does not move the catch zone or play a generic looping animation');
    await wait(350);assert.equal(await evaluate('pages.length'),2);assert.equal(await evaluate('currentNotebook.trash.length'),2);
    // A strong, almost-horizontal throw from high on the right side should
    // curve into the lower-left bin, without requiring pixel-perfect aim.
    await pickup('.page-thumb[data-index="1"]');
    const highY=bin.cy-850;for(const x of [1900,1820,1740,1660]){await mouse('mouseMoved',x,highY);await wait(14);}
    const arc=await evaluate(`DragMotion.resolve(1660,${highY},pageDrag.motion.sampler,'page')`);assert(arc?.curved,JSON.stringify({arc,debug:arc?null:await evaluate('({velocity:pageDrag.motion?.sampler.velocity(),active:pageDrag.active,focus:document.hasFocus(),client:[pageDrag.clientX,pageDrag.clientY]})')}));assert.equal(await evaluate('catchBinStyle().ready'),true);
    await mouse('mouseReleased',1660,highY);await shot('/tmp/badnotes-trash-strong-throw-ready.png');await wait(120);await shot('/tmp/badnotes-trash-curved-flight.png');await wait(1100);
    assert.equal(await evaluate('pages.length'),1);assert.equal(await evaluate('currentNotebook.trash.length'),3);
    // Failed archival returns the intact page to its shelf, without suction.
    await evaluate('failCatchPage=true');await pickup('.page-thumb');await mouse('mouseMoved',direct.x,direct.y);await wait(180);await mouse('mouseReleased',direct.x,direct.y);await wait(1700);
    assert.equal(await evaluate('pages.length'),1);assert.equal(await evaluate('currentNotebook.trash.length'),3);assert.equal(await evaluate('document.querySelectorAll(".trash-genie,.picked-up,.spring-return-slot").length'),0);await evaluate('failCatchPage=false');
    // A closer notebook drop does work and remains recoverable.
    await pickup('.notebook-item[data-id="catch-other"]');await mouse('mouseMoved',bin.cx+60,bin.cy-10);await wait(180);assert.equal((await evaluate('catchBinStyle()')).ready,true);await mouse('mouseReleased',bin.cx+60,bin.cy-10);await wait(750);
    assert.deepEqual(await evaluate('catchArchivedBooks'),['catch-other']);
    // Tilt/scale must carry into the first suction frame without a jump-cut.
    const pose=await evaluate(`(()=>{const source=DragMotion.clonePage(document.querySelector('.page-thumb'));source.style.left='300px';source.style.top='400px';source.style.transform='rotate(7deg) scale(1.035)';source.style.transformOrigin='40px 70px';document.body.appendChild(source);const m=new DOMMatrix(getComputedStyle(source).transform);window.catchPoseDone=TrashWorkbench.animate(source,${bin.cx},${bin.cy});const row=document.querySelector('.trash-genie-strip'),n=new DOMMatrix(getComputedStyle(row).transform);return{original:[m.a,m.b,m.c,m.d],firstRow:[n.a,n.b,n.c,n.d]};})()`);
    pose.original.forEach((v,i)=>assert(Math.abs(v-pose.firstRow[i])<.0001,JSON.stringify(pose)));await evaluate('catchPoseDone');
    await wait(1000);
    await evaluate(`TrashWorkbench.impact(3000,0,'page')`);await wait(70);const rightward=await evaluate(`parseFloat(getComputedStyle(document.getElementById('recycleBinBtn')).getPropertyValue('--trash-impact-x'))`);assert(rightward>1,'The bin reacts rightward to a rightward impact');await wait(1300);
    await evaluate(`TrashWorkbench.impact(0,-3000,'page')`);await wait(70);const upward=await evaluate(`parseFloat(getComputedStyle(document.getElementById('recycleBinBtn')).getPropertyValue('--trash-impact-y'))`);assert(upward<-1,'The bin reacts upward to an upward impact');await wait(1300);
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});mediaOverridden=true;await evaluate(`TrashWorkbench.impact(-5000,0,'page')`);await wait(100);assert.equal(await evaluate(`document.getElementById('recycleBinBtn').classList.contains('trash-reacting')`),false,'Reduced motion omits recoil');assert.equal(await evaluate(`isOverRecycleBin(${direct.x},${direct.y},'page')`),true,'Reduced motion keeps the generous direct-drop target');await call('Emulation.setEmulatedMedia',{features:[]});mediaOverridden=false;
    assert.equal(await evaluate('document.querySelectorAll(".trash-genie,.picked-up,.trash-incoming,.sucking,.trash-near,.drag-over").length'),0);
    assert.equal(await evaluate('catchRequests.some(([,method])=>method==="DELETE")'),false);
    console.log(JSON.stringify({passed:true,clockFallback,zones,ready,suction,bookNear,miss,thrown,arc,pose,recoil:{left:Math.min(...impactFrames.map(f=>f.x)),bounceBack:Math.max(...impactFrames.map(f=>f.x)),rightward,upward},reducedMotion:true,failureReturnsToShelf:true,onlyRecoverableTrash:true}));
} finally {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await mouse('mouseReleased',800,80);
    if(mediaOverridden)await call('Emulation.setEmulatedMedia',{features:[]});
    if(originalTheme)await evaluate(`settings.accentTheme=${JSON.stringify(originalAccent)};applyTheme(${JSON.stringify(originalTheme)});clearTrashHover()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
