// Geometry from the running desktop bridge, normalized hardware frames through
// the production mapper, then the real camera router. Never write fixture ink.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run=promisify(execFile);
const {mapTouches}=createRequire(import.meta.url)('../electron/direct-touch.cjs');
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let initialMaximized=false;
let originalBounds=null,resized=false;
const reports=[];
try{
    await call('Page.bringToFront');await evaluate('saveCurrentPage()');
    initialMaximized=await evaluate(`document.documentElement.classList.contains('window-maximized')`);
    // Camera-only fixture: page content/data on disk remain unchanged.
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};currentNotebook=null;fingerDrawingEnabled=false;badnotesDirectInput({type:'cancel'});badnotesDirectInput({type:'touch-source',direct:true});})()`);
    for(const mode of ['windowed','maximized','restored','moved','resized']){
        if(mode==='windowed'&&initialMaximized)await evaluate('badnotesWindow.toggleMaximize()');
        if(mode==='maximized'||mode==='restored')await evaluate('badnotesWindow.toggleMaximize()');
        if(mode==='moved'){
            const g=await evaluate('badnotesTouch.geometry()');originalBounds={...g.bounds};
            await run('/usr/bin/python',[new URL('./kwin_move_window.py',import.meta.url).pathname,String(g.bounds.pid),g.bounds.windowId,'410','110']);
        }
        if(mode==='resized'){await evaluate(`(()=>{badnotesWindow.startResize('se',0,0);badnotesWindow.resizeTo(-180,-120);badnotesWindow.endResize();})()`);resized=true;}
        await wait(500);
        const geometry=await evaluate('badnotesTouch.geometry()');assert(geometry,'Actual desktop geometry available');
        if(mode!=='maximized')assert(geometry.bounds.x>0&&geometry.bounds.y>0,'Windowed origin must not be Electron’s fake (0,0)');
        if(mode==='moved')assert(Math.abs(geometry.bounds.x-410)<1&&Math.abs(geometry.bounds.y-110)<1,'Desktop observer tracks window movement');
        assert.equal(geometry.viewport.width,await evaluate('innerWidth'));
        const rect=await evaluate(`(()=>{const r=canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()`);
        const cx=rect.x+rect.width*.5,cy=rect.y+rect.height*.5;
        const send=async events=>{
            const raw=events.map(e=>({...e,x:(geometry.bounds.x+e.x*geometry.bounds.width/geometry.viewport.width-geometry.display.bounds.x)/geometry.display.bounds.width,y:(geometry.bounds.y+e.y*geometry.bounds.height/geometry.viewport.height-geometry.display.bounds.y)/geometry.display.bounds.height}));
            const mapped=mapTouches(raw,geometry.display,geometry.bounds,geometry.viewport);
            await evaluate(`badnotesDirectInput(${JSON.stringify({type:'direct-touch',penContact:false,events:mapped})})`);
        };
        const reset=()=>evaluate(`(()=>{badnotesDirectInput({type:'cancel'});zoom=window.zoom=1;panX=panY=0;redrawCanvas(true);})()`);
        await reset();
        await send([{id:7,phase:'down',x:cx,y:cy}]);
        await send([{id:7,phase:'move',x:cx+48,y:cy+32}]);await wait(35);
        const pan=await evaluate('({panX,panY})');assert(Math.abs(pan.panX-48)<.1&&Math.abs(pan.panY-32)<.1,JSON.stringify({mode,pan}));
        await send([{id:7,phase:'up',x:cx+48,y:cy+32}]);
        await reset();
        const anchor=()=>evaluate(`({x:(${cx}-canvas.getBoundingClientRect().left-panX)/zoom,y:(${cy}-canvas.getBoundingClientRect().top-panY)/zoom,zoom})`);
        const start=await anchor();
        await send([{id:8,phase:'down',x:cx-60,y:cy},{id:9,phase:'down',x:cx+60,y:cy}]);
        for(const distance of [140,190,230,170,120,210]){
            await send([{id:8,phase:'move',x:cx-distance/2,y:cy},{id:9,phase:'move',x:cx+distance/2,y:cy}]);await wait(15);
            const now=await anchor();assert(Math.abs(now.x-start.x)<.15&&Math.abs(now.y-start.y)<.15,JSON.stringify({mode,start,now}));
        }
        const final=await anchor();assert(final.zoom>1.1);
        await send([{id:8,phase:'up',x:cx-105,y:cy},{id:9,phase:'up',x:cx+105,y:cy}]);await reset();
        const controls=await evaluate(`(()=>{const r=document.querySelector('.window-titlebar-controls').getBoundingClientRect();return{top:r.top,bottom:r.bottom};})()`);
        assert(Math.abs(controls.top-4)<.1&&controls.bottom<=36.1);
        reports.push({mode,bounds:geometry.bounds,viewport:geometry.viewport,pan,pinchAnchorError:{x:final.x-start.x,y:final.y-start.y},zoom:final.zoom,controls});
    }
    console.log(JSON.stringify({passed:true,reports}));
}finally{
    await evaluate(`badnotesDirectInput({type:'cancel'})`);
    if(resized)await evaluate(`(()=>{badnotesWindow.startResize('se',0,0);badnotesWindow.resizeTo(180,120);badnotesWindow.endResize();})()`);
    if(originalBounds)await run('/usr/bin/python',[new URL('./kwin_move_window.py',import.meta.url).pathname,String(originalBounds.pid),originalBounds.windowId,String(originalBounds.x),String(originalBounds.y)]);
    await wait(200);await call('Page.reload',{ignoreCache:true});await wait(1800);
    if(initialMaximized)await evaluate('badnotesWindow.toggleMaximize()');
    ws.close();
}
