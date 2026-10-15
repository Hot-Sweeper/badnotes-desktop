// Native hover, stylus, touch and keyboard recovery of the top clock.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const mouse=(type,x,y,pointerType='mouse')=>call('Input.dispatchMouseEvent',{type,x,y,pointerType,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'||type==='mouseMoved'?0:1,clickCount:1});
const state=()=>evaluate(`(()=>{const c=document.getElementById('digitalClock'),r=c.getBoundingClientRect();return{embedded:c.classList.contains('is-embedded'),expanded:c.getAttribute('aria-expanded'),top:r.top,bottom:r.bottom,width:r.width,height:r.height,zone:!document.querySelector('.clock-reveal-zone').hidden,time:document.getElementById('digitalClockTime').textContent,blur:getComputedStyle(c).backdropFilter};})()`);
const click=async(selector,pointerType='pen')=>{const p=await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await mouse('mousePressed',p.x,p.y,pointerType);await mouse('mouseReleased',p.x,p.y,pointerType);await wait(100);};
let storage;const report={};
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Page.reload',{ignoreCache:true});await wait(1000);
    await evaluate(`saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const originalFetch=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Clock test cannot write notes');return originalFetch(url,o);};`);
    await mouse('mouseMoved',500,150);report.shown=await state();assert(!report.shown.embedded);
    await wait(3100);report.idle=await state();assert(report.idle.embedded&&report.idle.zone);assert(report.idle.bottom>3&&report.idle.bottom<8,JSON.stringify(report.idle));assert.notEqual(report.shown.time,report.idle.time);
    await wait(1100);assert((await state()).embedded,'The one-second clock tick must not wake the pill');
    await mouse('mouseMoved',500,200);assert((await state()).embedded,'Canvas interaction must not wake the pill');
    const width=await evaluate('innerWidth');await mouse('mouseMoved',width/2,14);await wait(500);report.hover=await state();assert(!report.hover.embedded&&report.hover.top>=6);assert.match(report.hover.blur,/blur/);assert.equal(report.hover.width,report.shown.width,'Idle rendering must not change the island silhouette');
    await wait(3300);assert(!(await state()).embedded,'Hover must keep the clock available');
    await mouse('mouseMoved',500,200);await wait(3500);assert((await state()).embedded);
    const shot=await call('Page.captureScreenshot',{format:'png',clip:{x:width/2-110,y:0,width:220,height:70,scale:2}});await writeFile('/tmp/badnotes-clock-embedded.png',Buffer.from(shot.data,'base64'));
    // A touch on the recovery area reveals, without accidentally opening it.
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:width/2,y:14,radiusX:6,radiusY:6,force:.5}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(500);report.touch=await state();assert(!report.touch.embedded);assert.equal(report.touch.expanded,'false');
    await click('#digitalClockTime');report.pen=await state();assert.equal(report.pen.expanded,'true');await mouse('mouseMoved',500,200);await wait(3500);assert(!(await state()).embedded,'Open timetable must never auto-hide');
    await click('#addColorBtn');await evaluate('PaletteWorkbench.close()');assert.equal((await state()).expanded,'false');await mouse('mouseMoved',500,200);await wait(3500);assert((await state()).embedded);
    // Keyboard users can still tab/focus the tucked-away clock.
    await evaluate(`document.getElementById('digitalClock').focus()`);await wait(500);assert(!(await state()).embedded);
    for(const key of ['Enter','Escape']){await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});await wait(100);assert.equal((await state()).expanded,key==='Enter'?'true':'false');}
    await mouse('mouseMoved',500,200);await wait(3500);report.keyboard=await state();assert(report.keyboard.embedded);assert.equal(report.keyboard.width,report.shown.width,'Opening/closing must retain the original compact clock width');
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await evaluate(`getComputedStyle(document.getElementById('digitalClock')).transitionDuration`),'0s');
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('windowTitlebar')).getPropertyValue('-webkit-app-region')`),'drag');
    console.log(JSON.stringify({passed:true,...report}));
}finally{
    await call('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1500);ws.close();
}
