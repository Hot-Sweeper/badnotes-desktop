// Check the unobstructed ink discs and single-ring selection in every mode.
// Restore preferences and reload the real document even if an assertion fails.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let storage;const report=[];
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Page.reload',{ignoreCache:true});await wait(1500);
    await evaluate(`saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const originalFetch=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Selection test cannot write notes');return originalFetch(url,o);};`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:100});
    for(const theme of ['light','dark','oled']){
        for(const color of ['#ffffff','#6c5ce7']){
            await evaluate(`AppearanceSettings.selectMode('${theme}');setColor('${color}');`);await wait(220);
            const state=await evaluate(`(()=>{const b=document.querySelector('.color-preset.active'),s=getComputedStyle(b),r=b.getBoundingClientRect();return{theme:settings.theme,color:b.dataset.color,selected:b.getAttribute('aria-pressed'),shadow:s.boxShadow,outline:s.outlineColor,width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),gap:parseFloat(getComputedStyle(b.parentElement).gap),marks:b.querySelectorAll('svg').length,badge:getComputedStyle(b.querySelector('.color-key-badge')).opacity,round:s.borderRadius,rect:r.toJSON()};})()`);
            assert.equal(state.selected,'true');assert.equal(state.shadow,'none');assert.equal(state.marks,0);assert.equal(state.badge,'0');assert.notEqual(state.outline,'rgba(0, 0, 0, 0)');assert(state.width>0&&state.width<=1.5);assert(state.gap>state.width+state.offset);assert.equal(state.round,'50%');
            const clip=await evaluate(`(()=>{const r=document.getElementById('colorPresets').getBoundingClientRect();return{x:r.left-10,y:r.top-12,width:r.width+20,height:r.height+24,scale:2};})()`);
            const shot=await call('Page.captureScreenshot',{format:'png',clip});await writeFile(`/tmp/badnotes-selection-${theme}-${color.slice(1)}.png`,Buffer.from(shot.data,'base64'));report.push(state);
        }
    }
    await evaluate(`document.querySelector('.floating-toolbar').classList.add('palette-key-hints')`);await wait(150);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.color-preset.active .color-key-badge')).opacity`),'1');
    assert.equal(await evaluate(`document.querySelector('.color-preset.active .color-key-badge').textContent`),'6');
    console.log(JSON.stringify({passed:true,states:report}));
}finally{
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1500);ws.close();
}
