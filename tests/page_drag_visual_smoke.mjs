// Verify continuity at the exact DOM swap, not just after pickup has settled.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const mouse=(type,x,y)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
const point=index=>evaluate(`(()=>{const r=document.querySelector('#pageList .page-thumb[data-index="${index}"]').getBoundingClientRect();return{x:r.left+r.width*.35,y:r.top+r.height*.4};})()`);
const reports=[];let originalTheme,storage;
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);originalTheme=await evaluate('settings.theme');
    await call('Page.bringToFront');
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        pages=[{id:'visual-a',width:800,height:600,template:'grid',strokes:[{id:451,tool:'pen',color:'#7640fd',size:10,points:[{x:100,y:100},{x:400,y:300},{x:700,y:120}]}],images:[]},{id:'visual-b',width:800,height:1000,template:'dotted',strokes:[],images:[]}];
        currentNotebook={id:'page-visual-fixture',name:'Visual fixture',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);
        API.put=async()=>{await new Promise(r=>setTimeout(r,450));return{success:true};};
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Visual fixtures cannot write real notes');return originalFetch(url,options);};
        const create=DragMotion.create;
        DragMotion.create=(element,x,y,rect)=>{
            const source=pageDrag.el,paper=source.querySelector('.page-paper'),before=getComputedStyle(paper),sourceCanvases=[...source.querySelectorAll('canvas')].map(c=>c.toDataURL());
            const expected={border:before.borderColor,radius:before.borderRadius,shadow:before.boxShadow,background:before.backgroundColor};
            const result=create(element,x,y,rect),r=element.getBoundingClientRect(),s=getComputedStyle(element.querySelector('.page-paper'));
            window.pickupCheck={rect:[r.x,r.y,r.width,r.height],expectedRect:[rect.x,rect.y,rect.width,rect.height],expected,actual:{border:s.borderColor,radius:s.borderRadius,shadow:s.boxShadow,background:s.backgroundColor},overflow:getComputedStyle(element).overflow,sourceOpacity:getComputedStyle(source).opacity,bitmapMatches:[...element.querySelectorAll('canvas')].every((c,i)=>c.toDataURL()===sourceCanvases[i])};
            return result;
        };
    })()`);await wait(350);
    for(const theme of ['light','dark']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});renderPageList();document.getElementById('pageList').scrollTop=0;`);await wait(350);
        const p=await point(0);await mouse('mousePressed',p.x,p.y);await wait(550);
        const pickup=await evaluate('pickupCheck');assert(pickup.bitmapMatches);assert.equal(pickup.sourceOpacity,'0');assert.equal(pickup.overflow,'visible');
        // Chromium pads a one-shadow list with an invisible second shadow when
        // interpolating to the lifted two-shadow list; it adds no visible pixels.
        const appearance={...pickup.actual,shadow:pickup.actual.shadow.replace(/, rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/,'')};assert.deepEqual(appearance,pickup.expected);
        pickup.rect.forEach((value,i)=>assert(Math.abs(value-pickup.expectedRect[i])<.1,JSON.stringify(pickup)));
        const held=await evaluate(`(()=>{const c=pageDrag.clone,s=getComputedStyle(c.querySelector('.page-paper'));return{width:c.offsetWidth,height:c.offsetHeight,sourceWidth:pageDrag.el.offsetWidth,sourceHeight:pageDrag.el.offsetHeight,radius:s.borderRadius,border:s.borderColor,shadow:s.boxShadow};})()`);
        assert.equal(held.width,held.sourceWidth);assert.equal(held.height,held.sourceHeight);assert.equal(held.radius,pickup.expected.radius);assert.equal(held.border,pickup.expected.border);
        await wait(180);const settledLift=await evaluate(`getComputedStyle(pageDrag.clone.querySelector('.page-paper')).boxShadow`);assert.notEqual(settledLift,pickup.expected.shadow,'Shadow eases up after pickup instead of switching at the handoff');
        const target=await point(1);await mouse('mouseMoved',target.x,target.y);await mouse('mouseMoved',1100,target.y);await wait(120);
        await mouse('mouseReleased',1100,target.y);await wait(60);
        const release=await evaluate(`(()=>{const c=document.querySelector('.spring-returning'),slot=document.querySelector('#pageList .page-thumb.spring-return-slot'),source=c?.querySelector('canvas'),destination=slot?.querySelector('canvas');return{order:pages.map(p=>p.id),returning:!!c,slotHidden:slot&&getComputedStyle(slot).opacity==='0',bitmapSeeded:source&&destination&&source.toDataURL()===destination.toDataURL(),border:c&&getComputedStyle(c.querySelector('.page-paper')).borderColor,targetBorder:slot&&getComputedStyle(slot.querySelector('.page-paper')).borderColor};})()`);
        assert(release.returning&&release.slotHidden&&release.bitmapSeeded,JSON.stringify(release));assert.deepEqual(release.order,['visual-b','visual-a']);assert.equal(release.border,release.targetBorder);
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-page-drag-continuity-'+theme+'.png',Buffer.from(shot.data,'base64'));
        await wait(1700);assert.equal(await evaluate(`document.querySelectorAll('.spring-returning,.spring-return-slot').length`),0);
        reports.push({theme,pickup,held,release});
        // Restore the fixture order for the dark-mode pickup comparison.
        if(theme==='light')await evaluate('movePage(0,1)');
    }
    // An unselected page has a different border/shadow and hidden controls.
    // Its cancel/return must preserve those too, without selecting it.
    const inactive=await point(0);await mouse('mousePressed',inactive.x,inactive.y);await wait(550);
    const inactivePickup=await evaluate('pickupCheck');assert(inactivePickup.bitmapMatches);assert.equal(inactivePickup.actual.border,inactivePickup.expected.border);assert.equal(inactivePickup.actual.radius,inactivePickup.expected.radius);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await mouse('mouseReleased',inactive.x,inactive.y);await wait(1700);
    assert.equal(await evaluate('pages[currentPageIndex].id'),'visual-a');assert.equal(await evaluate(`document.querySelectorAll('.spring-returning,.spring-return-slot').length`),0);
    // A list rebuild reuses sharp previews synchronously, even if idle rendering
    // has not run yet. No blank sheet is exposed after the clone is removed.
    const cache=await evaluate(`(()=>{const before=new Map([...PageThumbnails.records].map(([id,r])=>[id,r.canvas.toDataURL()]));renderPageList();return[...PageThumbnails.records].filter(([,r])=>r.visible).every(([id,r])=>r.canvas.toDataURL()===before.get(id));})()`);assert(cache);
    console.log(JSON.stringify({passed:true,reports,inactivePickup,cachePreserved:cache}));
}finally{await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await mouse('mouseReleased',0,0);if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
