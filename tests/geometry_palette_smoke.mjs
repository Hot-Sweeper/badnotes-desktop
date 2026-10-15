import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
let serial=0;const pending=new Map();
ws.onmessage=event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const click=async selector=>{const point=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),r=element.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden control');return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});};
let preferences;
try{
    await evaluate('saveCurrentPage()');
    await call('Page.reload',{ignoreCache:true});await wait(1600);
    preferences=await evaluate(`({mode:localStorage.getItem('badnotes_geometry_mode'),snap:localStorage.getItem('badnotes_geometry_snap')})`);
    await evaluate(`(()=>{if(innerWidth<1700)badnotesWindow.toggleMaximize();GeometryDetector.mode='arrow';GeometryDetector.setEnabled(false);})()`);await wait(300);
    await click('#geometryToggleBtn');
    assert.equal(await evaluate('GeometryDetector.enabled'),false,'Browsing does not enable geometry');
    assert.equal(await evaluate(`document.querySelectorAll('#geometryPanel [data-geometry-shape][aria-pressed="true"]').length`),0,'Off mode has no misleading active shape');
    assert.equal(await evaluate(`document.querySelector('[data-geometry-category="lines"]').getAttribute('aria-selected')`),'true','Reopen at current shape category');
    await click('[data-geometry-shape="arrow"]');
    assert.equal(await evaluate(`GeometryDetector.enabled&&GeometryDetector.mode==='arrow'&&document.querySelector('#geometryEnabled').checked`),true);
    const reachable=[];
    for(const category of ['shapes','lines','polygons','symbols']){
        await click(`[data-geometry-category="${category}"]`);
        reachable.push(...await evaluate(`Array.from(document.querySelectorAll('.geometry-shapes button')).filter(b=>!b.hidden).map(b=>b.dataset.geometryShape)`));
    }
    assert.equal(new Set(reachable).size,25,'Every manual shape is reachable');
    await click('.geometry-search-toggle');
    await evaluate(`(()=>{const input=document.querySelector('.geometry-search');input.value='circle';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.geometry-shapes button')).filter(b=>!b.hidden).map(b=>b.dataset.geometryShape)`),['circle','semicircle']);
    await evaluate(`(()=>{const input=document.querySelector('.geometry-search');input.value='no-such-shape';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await evaluate(`document.querySelector('.geometry-empty').hidden`),false);
    await click('.geometry-search-toggle');
    for(const[id,key]of[['geometrySnap','snap'],['geometryFill','fill'],['geometryDashed','dashed']]){
        const before=await evaluate(`GeometryDetector.${key}`);await click('#'+id);assert.equal(await evaluate(`GeometryDetector.${key}`),!before);await click('#'+id);
    }
    assert.equal(await evaluate(`(()=>{const original={fill:GeometryDetector.fill,dashed:GeometryDetector.dashed};GeometryDetector.fill=true;GeometryDetector.dashed=true;GeometryWorkbench.sync();const result=document.getElementById('geometryFill').checked&&document.getElementById('geometryDashed').checked;Object.assign(GeometryDetector,original);GeometryWorkbench.sync();return result;})()`),true,'All style switches synchronize from engine state');
    await click('#geometryEnabled');assert.equal(await evaluate('GeometryDetector.enabled'),false);
    await click('#geometryEnabled');assert.equal(await evaluate(`GeometryDetector.enabled&&currentTool==='pen'`),true);
    await click('[data-geometry-shape="auto"]');assert.equal(await evaluate(`GeometryDetector.mode`),'auto');
    await click('[data-geometry-category="shapes"]');
    // Keyboard tab navigation and search remain usable without the pointer.
    await evaluate(`document.querySelector('[data-geometry-category="shapes"]').focus()`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    assert.equal(await evaluate(`document.activeElement.dataset.geometryCategory`),'lines');
    await click('[data-geometry-category="shapes"]');
    const bounds=await evaluate(`(()=>{const r=document.getElementById('geometryPanel').getBoundingClientRect(),dock=document.getElementById('geometryToggleBtn').getBoundingClientRect();return{height:r.height,width:r.width,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,aboveDock:r.bottom<dock.top,scroll:document.querySelector('.geometry-body').scrollHeight>document.querySelector('.geometry-body').clientHeight};})()`);
    assert(bounds.inside&&bounds.aboveDock);assert(bounds.height<600,'Compact rather than full-height palette');
    for(const theme of ['dark','light']){
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await wait(200);
        const shot=await call('Page.captureScreenshot',{format:'png',clip:await evaluate(`(()=>{const r=document.getElementById('geometryPanel').getBoundingClientRect();return{x:Math.max(0,r.x-12),y:Math.max(0,r.y-12),width:r.width+24,height:r.height+24,scale:1.5};})()`)});
        await writeFile('/tmp/badnotes-geometry-palette-'+theme+'.png',Buffer.from(shot.data,'base64'));
    }
    await call('Emulation.setDeviceMetricsOverride',{width:480,height:600,deviceScaleFactor:1,mobile:false});await wait(200);
    assert.equal(await evaluate(`(()=>{const r=document.getElementById('geometryPanel').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`),true,'Small window is contained');
    await call('Emulation.clearDeviceMetricsOverride');await wait(100);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await evaluate(`document.getElementById('geometryPanel').hidden&&document.activeElement.id==='geometryToggleBtn'`),true);
    console.log(JSON.stringify({passed:true,reachableManualShapes:new Set(reachable).size,bounds,switches:true,search:true,keyboard:true,smallWindow:true}));
}finally{
    await call('Emulation.clearDeviceMetricsOverride');
    if(preferences)await evaluate(`(()=>{for(const[key,value]of Object.entries(${JSON.stringify(preferences)})){const name='badnotes_geometry_'+key;if(value===null)localStorage.removeItem(name);else localStorage.setItem(name,value);}})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1600);ws.close();
}
