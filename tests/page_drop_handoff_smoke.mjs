// Delayed persistence must never hold a released page in midair. Disposable
// models, blocked document writes and full preference restoration.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const mouse=(type,x,y)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
const point=index=>evaluate(`(()=>{const r=document.querySelector('#pageList .page-thumb[data-index="${index}"]').getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+r.height*.5};})()`);
let storage;
try {
    await evaluate(`(()=>{if(!currentNotebook||/fixture|^alias-|^bitmap-|^controls-|^polish-|^cursor-/.test(currentNotebook.id))throw Error('Not an actual notebook');return saveCurrentPage();})()`);
    storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await evaluate(`localStorage.setItem('badnotes_pageNavCollapsed','false')`);await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`(()=>{
        triggerAutoSave=()=>{};window.saveCalls=0;saveCurrentPage=async()=>{saveCalls++;await new Promise(r=>setTimeout(r,900));};
        window.orderWrites=[];window.orderInFlight=0;window.maxOrderInFlight=0;window.orderDelay=900;window.failOrder=false;
        API.put=async(url,body)=>{orderInFlight++;maxOrderInFlight=Math.max(maxOrderInFlight,orderInFlight);orderWrites.push({url,body:structuredClone(body)});await new Promise(r=>setTimeout(r,orderDelay));orderInFlight--;return failOrder?null:{success:true};};
        API.post=API.delete=async()=>{throw Error('Handoff fixtures cannot write notes');};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Handoff fixtures cannot write notes');return original(url,o);};
        pages=[600,480,400].map((height,i)=>({id:'handoff-page-'+i,width:800,height,template:'grid',strokes:[{id:i,tool:'pen',color:'#7640fd',size:10,points:[{x:40,y:100},{x:400,y:200},{x:700,y:60}]}],images:[],textFields:[],handwrittenTextFields:[]}));
        currentNotebook={id:'handoff-fixture',name:'Handoff',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);renderPageList();document.getElementById('pageList').scrollTop=0;
        window.pageNodes=new Map([...document.querySelectorAll('#pageList .page-thumb')].map(n=>[n.dataset.pageId,n]));
        window.returnSamples=[];const settle=DragMotion.settle;DragMotion.settle=(clone,destination)=>{const result=settle(clone,destination);const transforms=[];let previous=performance.now();function sample(t){if(!clone.isConnected)return;transforms.push({transform:clone.style.transform,dt:t-previous});previous=t;requestAnimationFrame(sample);}requestAnimationFrame(sample);returnSamples.push({clone,destination,result,transforms});return result;};
    })()`);await wait(350);
    const source=await point(0),target=await point(1),outside=await evaluate('innerWidth*.55');
    await mouse('mousePressed',source.x,source.y);await wait(500);assert(await evaluate('pageDrag.active'));
    await mouse('mouseMoved',target.x,target.y);await mouse('mouseMoved',outside,target.y);await wait(120);
    await evaluate(`PageThumbnails.dirty('handoff-page-0');window.pendingPreviewVersion=PageThumbnails.records.get('handoff-page-0').version;`);
    await mouse('mouseReleased',outside,target.y);await wait(60);
    const release=await evaluate(`({order:pages.map(p=>p.id),active:pages[currentPageIndex].id,returning:document.querySelectorAll('.spring-returning').length,saves:saveCalls,pending:orderInFlight,frames:returnSamples[0]?.transforms.length||0,slotHidden:getComputedStyle(pageNodes.get('handoff-page-0')).opacity,previewDeferred:PageThumbnails.records.get('handoff-page-0').dirty&&PageThumbnails.records.get('handoff-page-0').version===pendingPreviewVersion})`);
    assert.equal(release.returning,1,'The spring starts immediately, while saves are slow: '+JSON.stringify(release));
    assert.deepEqual(release.order,['handoff-page-1','handoff-page-0','handoff-page-2']);assert.equal(release.active,'handoff-page-0');
    assert.equal(release.saves,0,'Order-only changes do not serialize or rewrite ink');assert.equal(release.pending,1);assert.equal(release.slotHidden,'0');assert(release.frames>=2);
    assert(release.previewDeferred,'Queued preview work waits until the spring has landed');
    const moving=await evaluate(`new Set(returnSamples[0].transforms.map(s=>s.transform)).size`);assert(moving>=2);
    await wait(1750);assert.equal(await evaluate(`document.querySelectorAll('.spring-returning,.spring-return-slot').length`),0);
    assert.equal(await evaluate(`PageThumbnails.records.get('handoff-page-0').dirty`),false,'Deferred work resumes after landing');
    // Order-only refresh preserves completed and partial preview jobs; no replay
    // or clear/upload at the release handoff. Unsaved live ink is untouched.
    const preview=await evaluate(`(()=>{const versions=new Map([...PageThumbnails.records].map(([id,r])=>[id,{version:r.version,canvas:r.canvas,job:r.job}]));const ink=strokes;renderPageList({preservePreviews:true});return{unchanged:[...PageThumbnails.records].every(([id,r])=>r.version===versions.get(id).version&&r.canvas===versions.get(id).canvas&&r.job===versions.get(id).job),nodes:[...pageNodes].every(([id,n])=>document.querySelector('[data-page-id="'+id+'"]')===n),ink:strokes===ink};})()`);
    assert(preview.unchanged&&preview.nodes&&preview.ink,JSON.stringify(preview));
    // A second reorder is visually immediate even if its predecessor's disk
    // request is outstanding; persisted orders cannot finish out of order.
    const queued=await evaluate(`(async()=>{orderDelay=400;const first=movePage(1,2),second=movePage(2,0);const immediate=pages.map(p=>p.id);await Promise.all([first,second]);return{immediate,writes:orderWrites.slice(-2),maxInFlight:maxOrderInFlight};})()`);
    assert.deepEqual(queued.immediate,['handoff-page-0','handoff-page-1','handoff-page-2']);assert.equal(queued.maxInFlight,1);assert.deepEqual(queued.writes.at(-1).body.pages,queued.immediate);
    const failure=await evaluate(`(async()=>{orderDelay=1;failOrder=true;let rejected=false;try{await movePage(0,1);}catch{rejected=true;}failOrder=false;await movePage(1,0);return{rejected,order:pages.map(p=>p.id)};})()`);
    assert(failure.rejected,'Null API results must report persistence failure');assert.deepEqual(failure.order,queued.immediate,'A failed save cannot poison the next reorder');
    console.log(JSON.stringify({passed:true,release,moving,preview,queued,failure}));
} finally {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`).catch(()=>{});await mouse('mouseReleased',0,0).catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
