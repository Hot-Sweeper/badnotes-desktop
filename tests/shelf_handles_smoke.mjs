// Native shelf input and idle chrome. All document writes are disabled and
// temporary shelf/theme preferences are restored before reloading real notes.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let held=false,preferences;
const mouse=(type,x,y)=>{if(type==='mousePressed')held=true;if(type==='mouseReleased')held=false;return call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?(held?'left':'none'):'left',buttons:held?1:0,clickCount:1});};
const key=async name=>{const code=name===' '?32:13;await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name===' '?'Space':'Enter',windowsVirtualKeyCode:code});await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name===' '?'Space':'Enter',windowsVirtualKeyCode:code});};
const sample=async id=>evaluate(`(()=>{const b=document.getElementById(${JSON.stringify(id)}),p=document.getElementById(b.getAttribute('aria-controls')),r=b.getBoundingClientRect(),s=getComputedStyle(b);return{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,awake:b.classList.contains('shelf-handle-awake'),opacity:+s.opacity,background:s.backgroundColor,shadow:s.boxShadow,transform:s.transform,magnet:b.classList.contains('magnetized-ui'),expanded:b.getAttribute('aria-expanded'),collapsed:p.classList.contains('collapsed'),panelWidth:p.offsetWidth,offset:new DOMMatrix(getComputedStyle(p).transform).m41,left:parseFloat(s.left),right:parseFloat(s.right),transition:s.transitionProperty};})()`);
try {
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1700);await call('Page.bringToFront');
    preferences=await evaluate(`Object.fromEntries(['badnotes_sidebarCollapsed','badnotes_pageNavCollapsed','badnotes_panel_widths','badnotes-theme','badnotes_settings'].map(k=>[k,localStorage.getItem(k)]))`);
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};API.put=API.post=async()=>{throw Error('Shelf tests cannot write notes');};const original=fetch;fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('No document writes in shelf test');return original(url,options);};window.shelfPointer=null;document.addEventListener('pointerdown',e=>shelfPointer=e.pointerId,true);for(const id of ['toggleSidebarBtn','togglePageNavBtn']){const b=document.getElementById(id);if(b.getAttribute('aria-expanded')==='false')b.click();}canvas.tabIndex=0;canvas.focus();})()`);
    await mouse('mouseMoved',1000,100);await wait(1700);
    const idle=await Promise.all(['toggleSidebarBtn','togglePageNavBtn'].map(sample));assert(idle.every(s=>!s.awake&&s.opacity<=.23&&s.background==='rgba(0, 0, 0, 0)'&&s.shadow==='none'&&s.transform==='none'&&!s.magnet&&s.width>=44&&s.height>=44),JSON.stringify(idle));
    const image=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-shelf-handles-idle.png',Buffer.from(image.data,'base64'));
    const results=[];
    for(const id of ['toggleSidebarBtn','togglePageNavBtn']){
        const left=id==='toggleSidebarBtn',panelId=left?'sidebar':'pageNav';let s=await sample(id);
        await mouse('mouseMoved',s.x+(left?45:-45),s.y);await wait(280);const near=await sample(id);assert(near.awake&&near.opacity>.98&&near.transform==='none',JSON.stringify(near));
        await mouse('mouseMoved',1000,100);await wait(1700);s=await sample(id);assert(!s.awake);
        // One touch on the faded target acts immediately; no reveal-only tap.
        await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:s.x,y:s.y,id:43,radiusX:6,radiusY:6}]});await wait(90);assert((await sample(id)).awake);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(380);assert.equal((await sample(id)).collapsed,true);
        s=await sample(id);await mouse('mousePressed',s.x,s.y);await mouse('mouseReleased',s.x,s.y);await wait(380);assert.equal((await sample(id)).expanded,'true','Mouse tap toggles once');
        s=await sample(id);await mouse('mousePressed',s.x,s.y);await mouse('mouseMoved',s.x+(left?-70:70),s.y);const drag=await sample(id);
        assert(Math.abs(drag.offset-(left?-70:70))<1,JSON.stringify(drag));assert(Math.abs((left?drag.left:drag.right)-(drag.panelWidth-75))<1,'Arrow tracks the panel without positional interpolation');assert(!/(^|, )all|left|right|transform/.test(drag.transition),JSON.stringify(drag));
        // Another pointer cannot steal or end the captured drag.
        await evaluate(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:999,pointerType:'touch',clientX:0,clientY:0}))`);assert(Math.abs((await sample(id)).offset-drag.offset)<1);
        await evaluate(`document.getElementById(${JSON.stringify(id)}).releasePointerCapture(shelfPointer)`);await mouse('mouseReleased',s.x+(left?-70:70),s.y);await wait(380);assert.equal((await sample(id)).expanded,'true','Capture loss cancels safely');
        const before=await sample(id);await evaluate(`document.getElementById(${JSON.stringify(panelId)}).style.width='${before.panelWidth+36}px'`);await wait(80);const resized=await sample(id);assert(Math.abs((left?resized.left:resized.right)-(resized.panelWidth-5))<1,'ResizeObserver tracks the shelf edge immediately');
        await evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);await key('Enter');await wait(380);assert.equal((await sample(id)).expanded,'false');
        await evaluate(`document.getElementById(${JSON.stringify(panelId)}).style.width='${resized.panelWidth+20}px'`);await wait(80);const hidden=await sample(id);assert.equal(left?hidden.left:hidden.right,10);assert(Math.abs(Math.abs(hidden.offset)-hidden.panelWidth)<1,'Closed resized shelf remains completely offscreen');
        await key(' ');await wait(380);assert.equal((await sample(id)).expanded,'true');
        await evaluate('canvas.focus()');await mouse('mouseMoved',1000,100);await wait(1700);assert(!(await sample(id)).awake,'Shelf fades again after interaction');results.push({id,near,drag,resized,hidden});
    }
    console.log(JSON.stringify({passed:true,idle,results,touchSingleTap:true,keyboard:true,captureCancellation:true}));
}finally {
    await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}).catch(()=>{});await mouse('mouseReleased',1000,100);
    if(preferences)await evaluate(`(()=>{for(const[k,v]of Object.entries(${JSON.stringify(preferences)})){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1500);ws.close();
}
