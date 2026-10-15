// Real Chromium finger contact must look exactly like cursor hover.
// Capture-phase click guards keep the user's notebooks/pages unchanged.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0,touchActive=false;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const move=(x,y)=>call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0});
const touch=async(type,x,y)=>{await call('Input.dispatchTouchEvent',{type,touchPoints:type==='touchStart'?[{id:7,x,y,radiusX:8,radiusY:8,force:.7}]:[]});touchActive=type==='touchStart';};
let originalTheme;const reports=[];
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');originalTheme=await evaluate('settings.theme');
    await evaluate(`(()=>{saveSettings=()=>{};window.touchActionClicks={};window.touchActionData=JSON.stringify({book:currentNotebook.id,books:notebooks.map(n=>n.id),pages:pages.map(p=>p.id)});
        window.actionTouchEvents=[];for(const type of ['touchstart','touchend','pointerdown','pointerup','pointercancel'])document.addEventListener(type,e=>actionTouchEvents.push({type,target:e.target.id||e.target.parentElement?.id,prevented:e.defaultPrevented,pointer:e.pointerType}),true);
        for(const id of ['addPageBtn','newNotebookBtn'])document.getElementById(id).addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();touchActionClicks[id]=(touchActionClicks[id]||0)+1;},true);
        window.touchStyle=id=>{const el=document.getElementById(id),s=getComputedStyle(el),fill=getComputedStyle(el,'::before'),extra=getComputedStyle(el,'::after');return{color:s.color,fill:fill.background,opacity:fill.opacity,radius:fill.borderRadius,corner:fill.cornerShape,shadow:s.boxShadow,transform:s.transform,overlay:extra.content,tap:s.getPropertyValue('-webkit-tap-highlight-color'),childTap:getComputedStyle(el.querySelector('span')).getPropertyValue('-webkit-tap-highlight-color'),action:s.touchAction,active:el.classList.contains('touch-feedback')};};
    })()`);
    for(const theme of ['light','dark','oled']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});document.activeElement?.blur();`);await move(800,100);await wait(250);
        for(const id of ['addPageBtn','newNotebookBtn']){
            const rect=await evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()`),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
            await move(x,y);await wait(250);const hover=await evaluate(`touchStyle(${JSON.stringify(id)})`);
            assert.equal(hover.opacity,'1');assert.equal(hover.shadow,'none');assert.equal(hover.transform,'none');assert.equal(hover.radius,'18px');assert.equal(hover.corner,'superellipse(2)');
            await move(800,100);await wait(250);await touch('touchStart',x,y);await wait(250);const pressed=await evaluate(`touchStyle(${JSON.stringify(id)})`);
            assert(pressed.active,JSON.stringify({theme,id,pressed,events:await evaluate('actionTouchEvents')}));for(const key of ['color','fill','opacity','radius','corner','shadow','transform'])assert.equal(pressed[key],hover[key],theme+' '+id+' '+key);
            assert.equal(pressed.overlay,'none');assert.equal(pressed.tap,'rgba(0, 0, 0, 0)');assert.equal(pressed.childTap,pressed.tap);assert.equal(pressed.action,'manipulation');
            const shot=await call('Page.captureScreenshot',{format:'png',clip:{...rect,scale:2}});await writeFile('/tmp/badnotes-touch-'+id+'-'+theme+'.png',Buffer.from(shot.data,'base64'));
            await touch('touchEnd');await wait(250);assert.equal(await evaluate(`touchActionClicks[${JSON.stringify(id)}]`),reports.filter(r=>r.id===id).length+1);
            const released=await evaluate(`touchStyle(${JSON.stringify(id)})`);assert.equal(released.active,false);assert.equal(released.opacity,'0','No sticky touch hover after release');
            reports.push({theme,id,matchingHover:true,rounded:true,nativeTapOverlay:false,clickOnce:true});
        }
    }
    assert.equal(await evaluate(`JSON.stringify({book:currentNotebook.id,books:notebooks.map(n=>n.id),pages:pages.map(p=>p.id)})===touchActionData`),true);
    console.log(JSON.stringify({passed:true,reports,dataUnchanged:true}));
}finally{
    if(touchActive)await touch('touchCancel');
    if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
