// Page selection/reorder must preserve DOM/GPU buffers and fully rendered ink.
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
let originalTheme,originalStorage;const reports=[];
try{
    await evaluate('saveCurrentPage()');originalStorage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await evaluate(`localStorage.setItem('badnotes_sidebarCollapsed','false');localStorage.setItem('badnotes_pageNavCollapsed','false');`);
    await mouse('mouseReleased',0,0);await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');originalTheme=await evaluate('settings.theme');
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        AppearanceSettings.selectAccent('iris'); // Pixel expectations below are for the canonical Iris palette.
        pages=['dotted','grid','lined'].map((template,i)=>({id:'stable-page-'+i,width:800,height:600,template,images:[],strokes:Array.from({length:12},(_,n)=>({id:i*100+n,tool:'pen',size:5,color:n%2?'#ff6b6b':'#ffffff',points:Array.from({length:80},(_,p)=>({x:80+p*7,y:120+n*25+Math.sin(p*.14)*15}))}))}));
        currentNotebook={id:'stability-fixture',name:'Stable previews',color:'#7640fd',icon:'book',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);_setZoomInternal(1);panX=panY=0;renderNotebookList();renderPageList();
        API.put=async()=>({success:true});const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Stability fixtures cannot write notes');return originalFetch(url,options);};
        window.dimensionWrites=[];for(const key of ['width','height']){const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);Object.defineProperty(HTMLCanvasElement.prototype,key,{...descriptor,set(value){if(this.closest('#pageList'))dimensionWrites.push({key,same:this[key]===value,live:this.className});descriptor.set.call(this,value);}});}
        window.stableNodes=new Map();window.captureNodes=()=>{stableNodes=new Map([...PageThumbnails.records].map(([id,r])=>[id,{paper:r.paper,canvas:r.canvas,live:r.live,pixels:r.canvas.toDataURL()}]));};
        window.checkNodes=()=>[...PageThumbnails.records].every(([id,r])=>{const old=stableNodes.get(id);return old?.paper===r.paper&&old.canvas===r.canvas&&old.live===r.live;});
    })()`);await wait(400);
    const navigationPriority=await evaluate(`(async()=>{const snapshots=new Map([...PageThumbnails.records].map(([id,r])=>[id,r.canvas.toDataURL()]));beginGesturePreview();isPinching=true;PageThumbnails.dirty();await new Promise(r=>setTimeout(r,180));const stable=[...PageThumbnails.records].every(([id,r])=>r.canvas.toDataURL()===snapshots.get(id)),deferred=[...PageThumbnails.records].some(([id,r])=>r.visible&&r.dirty);isPinching=false;endGesturePreview(false,false);return{stable,deferred};})()`);
    assert(navigationPriority.stable&&navigationPriority.deferred,'Camera navigation must retain completed thumbnails and defer unchanged content work');await wait(400);
    for(const theme of ['light','dark','oled']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});`);await wait(400);
        const color=await evaluate(`(()=>{const r=PageThumbnails.records.get('stable-page-0'),s=getComputedStyle(r.paper),main=ctx.getImageData(Math.round((panX+20*zoom)*baseDPR),Math.round((panY+20*zoom)*baseDPR),1,1).data;return{preview:[...r.canvas.getContext('2d').getImageData(3,3,1,1).data],main:[...main],fill:s.backgroundColor,outline:s.outlineWidth};})()`);
        assert.deepEqual(color.preview,color.main);assert.deepEqual(color.preview,theme==='light'?[255,255,255,255]:theme==='dark'?[39,36,46,255]:[0,0,0,255]);if(theme==='oled')assert(parseFloat(color.outline)>0&&parseFloat(color.outline)<=1.5);else assert.equal(color.outline,'0px');
        await evaluate('captureNodes();dimensionWrites=[];renderPageList();');assert.equal(await evaluate('checkNodes()'),true);
        assert.equal(await evaluate(`[...PageThumbnails.records].every(([id,r])=>r.canvas.toDataURL()===stableNodes.get(id).pixels)`),true);await wait(300);assert.equal(await evaluate('dimensionWrites.length'),0,'Routine updates must not reset displayed buffers');
        // Native click switches pages while preserving every preview layer.
        const p=await evaluate(`(()=>{const r=document.querySelector('#pageList .page-thumb[data-index="1"]').getBoundingClientRect();return{x:r.left+r.width*.3,y:r.top+r.height*.3};})()`);
        await mouse('mousePressed',p.x,p.y);await mouse('mouseReleased',p.x,p.y);await wait(80);assert.equal(await evaluate('currentPageIndex'),1);assert.equal(await evaluate('checkNodes()'),true);
        await evaluate('movePage(0,2)');await wait(300);assert.equal(await evaluate('checkNodes()'),true);assert.deepEqual(await evaluate('pages.map(p=>p.id)'),['stable-page-1','stable-page-2','stable-page-0']);assert.equal(await evaluate('dimensionWrites.length'),0);
        // Updating committed content during drawing must retain the live ink.
        const live=await evaluate(`(async()=>{const r=PageThumbnails.records.get(pages[currentPageIndex].id);currentStroke={tool:'pen',size:5,color:'#ff6b6b',points:[{x:300,y:220},{x:400,y:260}]};isDrawing=true;PageThumbnails.live();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const before=r.live.toDataURL();PageThumbnails.dirty();await new Promise(r=>setTimeout(r,150));const retained=r.live.toDataURL()===before;isDrawing=false;currentStroke=null;PageThumbnails.live();return{retained,ref:r.liveStroke!==null};})()`);assert(live.retained);
        await wait(250);assert.equal(await evaluate('dimensionWrites.length'),0);
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-exact-page-'+theme+'.png',Buffer.from(shot.data,'base64'));reports.push({theme,color,stable:true,noBufferResets:true,live});
        await evaluate('movePage(2,0);currentPageIndex=0;loadPage(0);renderPageList();');await wait(250);
    }
    console.log(JSON.stringify({passed:true,navigationPriority,reports}));
}finally{await evaluate(`isDrawing=false;currentStroke=null;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);await mouse('mouseReleased',0,0);if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);if(originalStorage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(originalStorage)}))localStorage.setItem(k,v);})()`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
