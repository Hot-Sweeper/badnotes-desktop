// Native mouse, stylus and touch UI tests. Only disposable renderer fixtures
// and temporary preferences change; all writes to actual notes are blocked.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes'),ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms)),point=q=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(q)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
const mouse=(type,p,pointerType='mouse')=>call('Input.dispatchMouseEvent',{type,...p,pointerType,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
const click=async(q,type='mouse')=>{const p=await point(q);await mouse('mousePressed',p,type);await mouse('mouseReleased',p,type);await wait(60);};
const touch=(type,p=[])=>call('Input.dispatchTouchEvent',{type,touchPoints:p.map(([id,x,y])=>({id,x,y,radiusX:6,radiusY:6,force:.6}))});
const direct=events=>evaluate(`badnotesDirectInput(${JSON.stringify({type:'direct-touch',penContact:false,events})})`);
let storage;const report={};
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await evaluate(`localStorage.setItem('badnotes_sidebarCollapsed','false');localStorage.setItem('badnotes_pageNavCollapsed','false');`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Interaction fixtures cannot write notes');return original(url,o);};
        API.put=async()=>({success:true});API.post=async()=>({id:'polish-new-page',width:1500,height:2000,template:'grid',strokes:[],images:[]});API.delete=async()=>{throw Error('No deletes');};
        customPalette=['#ffffff','#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#6c5ce7'];currentColor='#ffffff';renderPalette();
        pages=Array.from({length:12},(_,i)=>({id:'polish-page-'+i,width:1500,height:2000,template:'grid',strokes:[],images:[]}));currentNotebook={id:'polish-fixture',name:'Interaction fixture',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};
        notebooks=[currentNotebook,...Array.from({length:29},(_,i)=>({id:'polish-book-'+i,name:'Notebook '+i,color:'#6c5ce7',pages:[]}))];currentPageIndex=0;loadPage(0);renderNotebookList();renderPageList();
        fingerDrawingEnabled=false;penIsActive=false;lastPenEventTime=-10000;
    })()`);await wait(250);
    // Selection survives mouse/stylus/finger and is visibly distinct.
    for(const type of ['mouse','pen']){await click('[data-color="#ff6b6b"]',type);assert.equal(await evaluate('currentColor'),'#ff6b6b');await click('[data-color="#ffffff"]',type);}
    const swatch=await point('[data-color="#6c5ce7"]');await touch('touchStart',[[7,swatch.x,swatch.y]]);await wait(700);await touch('touchEnd');await wait(50);
    assert.equal(await evaluate('customPalette.length'),6,'Holding a swatch cannot delete it');
    await evaluate(`document.querySelector('[data-color="#6c5ce7"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate('customPalette.length'),6);assert.equal(await evaluate('document.getElementById("palettePanel").hidden'),false);await evaluate('PaletteWorkbench.close()');
    // A dropped/cancelled color near the bin must never use its huge page hitbox.
    const from=await point('[data-color="#ff6b6b"]'),bin=await point('#recycleBinBtn');await mouse('mousePressed',from,'pen');await mouse('mouseMoved',{x:from.x,y:from.y-25},'pen');await mouse('mouseMoved',bin,'pen');await mouse('mouseReleased',bin,'pen');await wait(100);
    assert.equal(await evaluate('customPalette.length'),6,'A color drag never silently removes a palette entry');
    report.palette=await evaluate(`(()=>{setColor('#6c5ce7');const b=document.querySelector('.color-preset.active'),s=getComputedStyle(b);return{selected:b.getAttribute('aria-pressed'),outline:s.outlineColor,shadow:s.boxShadow,mark:!!b.querySelector('.palette-selected-mark'),trashCount:JSON.parse(localStorage.getItem('badnotes_deleted_colors')||'[]').length};})()`);assert.equal(report.palette.selected,'true');assert.notEqual(report.palette.outline,'rgba(0, 0, 0, 0)');assert.equal(report.palette.shadow,'none');assert.equal(report.palette.mark,false);
    // Adding colors is a real editor, and overflow remains accessible.
    await click('#addColorBtn','pen');await evaluate(`(()=>{const input=document.querySelector('#palettePanel input[type=text]');input.value='#12abcd';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('[data-palette-save]','pen');
    assert.equal(await evaluate('customPalette.includes("#12abcd")&&currentColor==="#12abcd"'),true);assert.equal(await evaluate('document.querySelectorAll("[data-palette-saved]").length'),7);
    assert.equal(await evaluate('document.querySelector(".color-preset.active").dataset.color'),'#12abcd','Active ink must remain visible even after overflowing the dock');
    const paletteShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-palette-editor.png',Buffer.from(paletteShot.data,'base64'));await evaluate('PaletteWorkbench.close()');
    // Real drag into a constructed circle, then a freehand circle and heart.
    await evaluate(`(()=>{_setZoomInternal(1);panX=60;panY=60;strokes=[GeometryDetector.createShape('circle',{x:450,y:180},{x:650,y:380},{id:'polish-circle',size:4,color:'#ffffff'})];historyStack=[];redoStack=[];invalidateStrokeCache();redrawCanvas(true);})()`);
    const target=await evaluate(`(()=>{const r=canvas.getBoundingClientRect();return{x:r.left+550*zoom+panX,y:r.top+280*zoom+panY};})()`);
    const red=await point('[data-color="#ff6b6b"]');await mouse('mousePressed',red,'pen');await mouse('mouseMoved',{x:red.x,y:red.y-30},'pen');await mouse('mouseMoved',target,'pen');await mouse('mouseReleased',target,'pen');
    report.fill=await evaluate(`(()=>{const pixel=[...ctx.getImageData(Math.round((550*zoom+panX)*baseDPR),Math.round((280*zoom+panY)*baseDPR),1,1).data];return{fills:strokes.filter(s=>s.isFill).length,pixel,palette:customPalette.length,history:historyStack.length,animated:!!document.querySelector('.fill-reveal-overlay')};})()`);assert.equal(report.fill.fills,1);assert.equal(report.fill.history,1);assert.equal(report.fill.palette,7);assert.deepEqual(report.fill.pixel.slice(0,3),[255,107,107]);assert(report.fill.animated);await wait(400);assert.equal(await evaluate('document.querySelectorAll(".fill-reveal-overlay").length'),0);
    report.extraFills=await evaluate(`(()=>{const circle={id:'polish-freehand',tool:'pen',size:3,color:'#fff',points:Array.from({length:65},(_,i)=>({x:750+70*Math.cos(i/64*Math.PI*2),y:450+70*Math.sin(i/64*Math.PI*2)}))};strokes.push(circle);invalidateStrokeCache();redrawCanvas(true);const free=!!PaintFill.drop(750,450,'#4d96ff');PaintFill.cancel();const heart=GeometryDetector.createShape('heart',{x:500,y:500},{x:650,y:650},{id:'polish-heart',size:3,color:'#fff'});strokes.push(heart);invalidateStrokeCache();redrawCanvas(true);const h=!!PaintFill.drop(575,580,'#ff6b6b');PaintFill.cancel();return{free,heart:h,outside:PaintFill.drop(-5,300,'#4d96ff'),openLine:PaintFill.drop(100,100,'#4d96ff')};})()`);assert(report.extraFills.free&&report.extraFills.heart);assert.equal(report.extraFills.outside,false);assert.equal(report.extraFills.openLine,false);
    // Pen undo/redo commits once, even if a compatibility click follows.
    await evaluate(`(()=>{PaintFill.cancel();strokes=[{id:'polish-line',tool:'pen',size:5,color:'#4d96ff',points:[{x:500,y:400},{x:550,y:440},{x:650,y:410},{x:700,y:470}]}];historyStack=[{type:'add',stroke:strokes[0]}];redoStack=[];invalidateStrokeCache();redrawCanvas(true);})()`);
    await click('#undoBtn','pen');assert.deepEqual(await evaluate('[strokes.length,historyStack.length,redoStack.length]'),[0,0,1]);assert(await evaluate('!!document.querySelector(".history-stroke-motion")'));await wait(400);
    await click('#redoBtn','pen');assert.deepEqual(await evaluate('[strokes.length,historyStack.length,redoStack.length]'),[1,1,0]);assert(await evaluate('!!document.querySelector(".history-stroke-motion")'));await wait(400);
    for(const [key,shift]of[['z',false],['Z',true]]){await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:'KeyZ',modifiers:2+(shift?8:0)});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:'KeyZ'});await wait(60);}
    assert.deepEqual(await evaluate('[strokes.length,historyStack.length,redoStack.length]'),[1,1,0]);await wait(400);report.history={penUndo:true,penRedo:true,shiftZ:true,transients:await evaluate('document.querySelectorAll(".history-stroke-motion").length')};
    // New-page presentation is complete in the same task, no stale next-frame
    // ink/resize/selection paint or cleared backing buffer is exposed.
    report.newPage=await evaluate(`(async()=>{await addPage();return{id:pages[currentPageIndex].id,strokes:strokes.length,pending:redrawPending,active:isPageResizing,history:historyStack.length};})()`);assert.equal(report.newPage.id,'polish-new-page');assert.equal(report.newPage.strokes,0);assert.equal(report.newPage.pending,false);assert.equal(report.newPage.active,false);
    // Touch scrolling: coast after release, no accidental pickup/selection,
    // top rubber-band pull and a complete return to rest on both shelves.
    report.scrolling=[];
    for(const id of ['notebookList','pageList']){
        await evaluate(`(()=>{const e=document.getElementById('${id}');ElasticScroll.cancel(e,true);e.scrollTop=0;})()`);await wait(70);
        const p=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+Math.min(260,r.height*.55)};})()`);
        await touch('touchStart',[[11,p.x,p.y]]);for(const dy of [-20,-45,-80,-115]){await wait(18);await touch('touchMove',[[11,p.x,p.y+dy]]);}await touch('touchEnd');
        const released=await evaluate(`({top:document.getElementById('${id}').scrollTop,state:ElasticScroll.snapshot(document.getElementById('${id}')),drag:notebookDrag.active||pageDrag.active})`);await wait(130);const coast=await evaluate(`document.getElementById('${id}').scrollTop`);assert(coast>released.top+10,JSON.stringify({id,released,coast}));assert.equal(released.drag,false);
        await wait(1500);await evaluate(`(()=>{const e=document.getElementById('${id}');ElasticScroll.cancel(e,true);e.scrollTop=0;})()`);await wait(70);
        await touch('touchStart',[[12,p.x,p.y]]);for(const dy of [20,50,90]){await wait(18);await touch('touchMove',[[12,p.x,p.y+dy]]);}const pulled=await evaluate(`ElasticScroll.snapshot(document.getElementById('${id}'))`);assert(pulled.offset>20,JSON.stringify({id,pulled}));await touch('touchEnd');await wait(1000);const settled=await evaluate(`ElasticScroll.snapshot(document.getElementById('${id}'))`);assert(Math.abs(settled.offset)<.1&&!settled.animating,JSON.stringify({id,settled}));
        for(let i=0;i<3;i++){await call('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:-25});await wait(20);}const wheelPull=await evaluate(`ElasticScroll.snapshot(document.getElementById('${id}'))`);assert(wheelPull.offset>30,JSON.stringify({id,wheelPull}));await wait(1100);assert(await evaluate(`Math.abs(ElasticScroll.snapshot(document.getElementById('${id}')).offset)<.1`));
        report.scrolling.push({id,released,coast,pulled,settled,wheelPull});
    }
    report.pickup=[];
    for(const [selector,state]of[['#notebookList .notebook-item','notebookDrag'],['#pageList .page-thumb','pageDrag']]){
        const p=await point(selector);await mouse('mousePressed',p,'pen');await mouse('mouseMoved',{x:p.x+20,y:p.y},'pen');assert.equal(await evaluate(state+'.active'),true,'Pen reorder still starts on deliberate motion');await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await mouse('mouseReleased',{x:p.x+20,y:p.y},'pen');await wait(1700);
        await touch('touchStart',[[13,p.x,p.y]]);await wait(540);assert.equal(await evaluate(state+'.active'),true,'Holding still still picks up a shelf item');await touch('touchCancel');await wait(1700);report.pickup.push({selector,pen:true,touch:true});
    }
    // Production direct-touch camera: soft travel outside the nominal range,
    // then native-resolution return to the exact requested resting limits.
    await evaluate(`badnotesDirectInput({type:'cancel'});badnotesDirectInput({type:'touch-source',direct:true});badnotesDirectInput({type:'pen-contact',contact:false});penIsActive=false;lastPenEventTime=-10000;fingerDrawingEnabled=false;HistoryMotion.finish();strokes=[];images=[];invalidateStrokeCache();`);
    report.camera=[];
    for(const [initial,start,end,bound]of[[.22,300,100,.2],[390,200,250,400]]){
        await evaluate(`ViewLimits.cancel();_setZoomInternal(${initial});panX=700-750*zoom;panY=500-600*zoom;redrawCanvas(true);`);
        const pts=(d,phase)=>[{id:71,phase,x:700-d/2,y:500},{id:72,phase,x:700+d/2,y:500}];await direct(pts(start,'down'));
        for(let i=1;i<=5;i++){await wait(18);await direct(pts(start+(end-start)*i/5,'move'));}await wait(50);const stretched=await evaluate('zoom');assert(bound===.2?stretched<.2&&stretched>.15:stretched>400&&stretched<520,JSON.stringify({initial,stretched}));await direct(pts(end,'up'));await wait(1400);const settled=await evaluate('({zoom,panX,panY,outside:ViewLimits.outside(),animating:ViewLimits.animating})');assert(Math.abs(settled.zoom-bound)<1e-6&&!settled.outside&&!settled.animating,JSON.stringify({initial,stretched,settled}));report.camera.push({initial,stretched,settled});
    }
    await evaluate('ViewLimits.cancel();_setZoomInternal(1);panX=ViewLimits.bounds().x[1]-300;panY=0;redrawCanvas(true);');await direct([{id:81,phase:'down',x:650,y:500}]);for(const x of [800,1100,1500,1900]){await wait(18);await direct([{id:81,phase:'move',x,y:500}]);}await wait(50);const panStretch=await evaluate('({panX,outside:ViewLimits.outside()})');assert(panStretch.outside);await direct([{id:81,phase:'up',x:1900,y:500}]);await wait(1400);report.pan=await evaluate('({panX,panY,outside:ViewLimits.outside(),animating:ViewLimits.animating})');assert(!report.pan.outside&&!report.pan.animating);
    console.log(JSON.stringify({passed:true,...report}));
}finally{
    await touch('touchCancel').catch(()=>{});await evaluate(`window.PaletteWorkbench?.close();window.HistoryMotion?.finish();window.PaintFill?.cancel();window.ViewLimits?.cancel();window.badnotesDirectInput?.({type:'cancel'});document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`).catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
