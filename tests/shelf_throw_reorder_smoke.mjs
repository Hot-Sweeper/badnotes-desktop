// Real Chromium mouse/touch gestures; ordering is persisted only to mock APIs.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),15000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const mouse=(type,x,y)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
let touchActive=false;
const touch=async(type,x,y)=>{await call('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{id:6,x,y,radiusX:5,radiusY:5,force:.5}]});touchActive=type!=='touchEnd'&&type!=='touchCancel';};
const point=(selector,index)=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}+'[data-index="${index}"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
const reports=[];let storage;
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);
    await call('Page.bringToFront');
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        pages=[400,600,500].map((height,i)=>({id:'shelf-page-'+i,width:800,height,template:'dotted',strokes:[],images:[]}));
        currentNotebook={id:'shelf-book-0',name:'Shelf fixture',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};
        notebooks=[currentNotebook,...[1,2].map(i=>({id:'shelf-book-'+i,name:'Fixture '+i,pages:[],trash:[],contentTrash:[]}))];
        currentPageIndex=0;loadPage(0);window.orderWrites=[];
        API.put=async(url,body)=>{orderWrites.push({url,body:structuredClone(body)});return{success:true};};
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Shelf fixtures must not write real notes');return originalFetch(url,options);};
        renderNotebookList();renderPageList();document.getElementById('pageList').scrollTop=0;
        window.shelfInputEvents=[];
        for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{shelfInputEvents.push({type,buttons:e.buttons,pointer:e.pointerType,id:e.pointerId,target:e.target.className,time:performance.now()});shelfInputEvents=shelfInputEvents.slice(-30);},{capture:true});
        window.addEventListener('blur',()=>shelfInputEvents.push({type:'blur',time:performance.now()}));
    })()`);await wait(350);
    for(const [selector,state,model,prefix]of[['.page-thumb','pageDrag','pages','shelf-page-'],['.notebook-item','notebookDrag','notebooks','shelf-book-']]){
        for(const scenario of ['mouse-down','mouse-up','escape','touch-down']){
            const from=scenario==='mouse-up'?1:0,to=scenario==='mouse-up'?0:1;
            const source=await point(selector,from),target=await point(selector,to),cx=await evaluate('innerWidth/2');
            const isTouch=scenario==='touch-down';
            if(isTouch)await touch('touchStart',source.x,source.y);else await mouse('mousePressed',source.x,source.y);
            await wait(500);assert.equal(await evaluate(state+'.active'),true,JSON.stringify({selector,scenario,source,diagnostics:await evaluate(`({active:${state}.active,pressing:${state}.pressing,holding:!!${state}.holdTimer,target:document.elementFromPoint(${source.x},${source.y})?.className,input:shelfInputEvents})`)}));
            if(isTouch)await touch('touchMove',target.x,target.y);else await mouse('mouseMoved',target.x,target.y);
            await wait(20);
            // Throw sideways at the chosen new vertical slot, outside the shelf.
            for(const x of [cx+60,cx+30,cx]){if(isTouch)await touch('touchMove',x,target.y);else await mouse('mouseMoved',x,target.y);await wait(16);}
            assert.equal(await evaluate(state+'.dropIndex'),to);
            if(scenario==='escape')await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
            if(isTouch)await touch('touchEnd');else await mouse('mouseReleased',cx,target.y);
            await wait(75);
            const result=await evaluate(`(()=>{const slot=document.querySelector(${JSON.stringify(selector)}+'.spring-return-slot');return{order:${model}.map(p=>p.id),slot:slot?.dataset.index,activePage:pages[currentPageIndex].id,activeBook:currentNotebook.id,clones:document.querySelectorAll('.spring-returning').length};})()`);
            const expected=scenario==='mouse-down'||scenario==='touch-down'?[prefix+'1',prefix+'0',prefix+'2']:[prefix+'0',prefix+'1',prefix+'2'];
            assert.deepEqual(result.order,expected);assert.equal(Number(result.slot),scenario==='escape'?from:to);assert.equal(result.clones,1);
            assert.equal(result.activePage,'shelf-page-0');assert.equal(result.activeBook,'shelf-book-0');
            await wait(1700);assert.equal(await evaluate(`document.querySelectorAll('.spring-returning,.spring-return-slot').length`),0);
            reports.push({selector,scenario,...result});
        }
    }
    const writes=await evaluate('orderWrites');assert(writes.some(w=>w.url==='/api/notebooks/order'&&w.body.order[0]==='shelf-book-1'));
    assert(writes.some(w=>w.url==='/api/notebooks/shelf-book-0'&&w.body.pages[0]==='shelf-page-1'));
    console.log(JSON.stringify({passed:true,reports,persistedOrders:writes.length}));
}finally{await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await mouse('mouseReleased',0,0);if(touchActive)await touch('touchCancel');if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
