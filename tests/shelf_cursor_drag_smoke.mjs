// Native mouse and pen input, with fixture-only persistence.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const input=(pointerType,type,x,y,button='left')=>call('Input.dispatchMouseEvent',{pointerType,type,x,y,button,buttons:type==='mouseReleased'?0:button==='right'?2:1,clickCount:1});
const point=(selector,index)=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}+'[data-index="${index}"]').getBoundingClientRect();return{x:r.left+r.width*.35,y:r.top+r.height*.4};})()`);
const reports=[];
let storage;
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        pages=[400,600,500].map((height,i)=>({id:'cursor-page-'+i,width:800,height,template:'dotted',strokes:[],images:[]}));
        currentNotebook={id:'cursor-book-0',name:'Cursor fixture',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};
        notebooks=[currentNotebook,...[1,2].map(i=>({id:'cursor-book-'+i,name:'Fixture '+i,pages:[],trash:[],contentTrash:[]}))];
        currentPageIndex=0;loadPage(0);window.orderWrites=[];window.clickedBook=null;window.editedBook=null;
        selectNotebook=id=>{clickedBook=id;};openNotebookEditor=id=>{editedBook=id;};
        API.put=async(url,body)=>{orderWrites.push({url,body:structuredClone(body)});return{success:true};};
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Cursor fixtures cannot write notes');return originalFetch(url,options);};
        renderNotebookList();renderPageList();document.getElementById('pageList').scrollTop=0;
        window.cursorPointerTypes=[];window.cursorEvents=[];window.lastCursorPointerId=null;document.addEventListener('pointerdown',e=>{cursorPointerTypes.push(e.pointerType);lastCursorPointerId=e.pointerId;},{capture:true});
        for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{cursorEvents.push({type,buttons:e.buttons,id:e.pointerId,pointer:e.pointerType,target:e.target.className,time:performance.now()});cursorEvents=cursorEvents.slice(-30);},{capture:true});
        window.addEventListener('blur',()=>cursorEvents.push({type:'blur',time:performance.now()}));
    })()`);await wait(350);
    const controls=await evaluate(`(()=>{const e=document.querySelector('.window-titlebar-controls'),r=e.getBoundingClientRect();return{right:getComputedStyle(e).right,edgeGap:innerWidth-r.right};})()`);
    assert.equal(controls.right,'8px');assert(Math.abs(controls.edgeGap-8)<1);
    // Check the no-wait contract in a single renderer turn, without counting
    // debugger round-trip latency as UI latency. Native capture is tested below.
    const synchronousPickup=await evaluate(`(()=>{
        const container=document.createElement('div'),item=document.createElement('div');item.className='cursor-test-item';item.dataset.index='0';container.append(item);document.body.append(container);container.style.display='none';
        const state={active:false};let starts=0,moves=0;
        bindShelfCursorDrag(container,'.cursor-test-item',state,{begin:()=>{starts++;clearTimeout(state.holdTimer);state.holdTimer=null;state.active=true;},move:()=>moves++,finish:()=>{state.active=false;state.pressing=false;}});
        const result=[];for(const [i,pointerType]of ['mouse','pen'].entries()){
            const pointerId=500+i;item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType,pointerId,button:0,buttons:1,clientX:0,clientY:0}));
            const pending=!state.active&&!!state.holdTimer;
            document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerType,pointerId,buttons:1,clientX:24,clientY:0}));
            result.push({pointerType,pending,pickedImmediately:state.active&&!state.holdTimer});
            document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType,pointerId,button:0,buttons:0,clientX:24,clientY:0}));
        }container.remove();return{result,starts,moves};})()`);
    assert(synchronousPickup.result.every(r=>r.pending&&r.pickedImmediately));assert.equal(synchronousPickup.starts,2);
    // No movement: a normal click/tap still selects; right-click never picks up.
    for(const pointer of ['mouse','pen']){
        const page=await point('.page-thumb',1);await input(pointer,'mousePressed',page.x,page.y);await input(pointer,'mouseReleased',page.x,page.y);await wait(80);
        assert.equal(await evaluate('currentPageIndex'),1);assert.equal(await evaluate('pageDrag.active'),false);
        await evaluate('currentPageIndex=0;loadPage(0);renderPageList();');
        const book=await point('.notebook-item',1);await input(pointer,'mousePressed',book.x,book.y);await input(pointer,'mouseReleased',book.x,book.y);await wait(80);
        assert.equal(await evaluate('clickedBook'),'cursor-book-1');await evaluate('clickedBook=null;');
        await input(pointer,'mousePressed',book.x,book.y,'right');await wait(500);assert.equal(await evaluate('notebookDrag.active||notebookDrag.pressing'),false);await input(pointer,'mouseReleased',book.x,book.y,'right');
    }
    const edit=await evaluate(`(()=>{const r=document.querySelector('.notebook-edit').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await input('mouse','mousePressed',edit.x,edit.y);await input('mouse','mouseReleased',edit.x,edit.y);await wait(80);
    assert.equal(await evaluate('editedBook'),'cursor-book-0');assert.equal(await evaluate('notebookDrag.active||notebookDrag.pressing'),false);
    for(const [selector,state,model,prefix]of[['.page-thumb','pageDrag','pages','cursor-page-'],['.notebook-item','notebookDrag','notebooks','cursor-book-']]){
        for(const pointer of ['mouse','pen']){
            for(const axis of ['horizontal','vertical']){
                const from=axis==='horizontal'?0:1,to=axis==='horizontal'?1:0;
                const source=await point(selector,from),target=await point(selector,to);
                await input(pointer,'mousePressed',source.x,source.y);
                await input(pointer,'mouseMoved',source.x+(axis==='horizontal'?24:0),source.y+(axis==='vertical'?24:0));
                const picked=await evaluate(`({active:${state}.active,captured:${state}.el?.hasPointerCapture(lastCursorPointerId),timer:!!${state}.holdTimer})`);
                assert(picked.active&&picked.captured&&!picked.timer,JSON.stringify({selector,pointer,axis,picked,events:await evaluate('cursorEvents')}));
                await input(pointer,'mouseMoved',target.x,target.y);await input(pointer,'mouseMoved',1100,target.y);await wait(120);
                await input(pointer,'mouseReleased',1100,target.y);await wait(75);
                const result=await evaluate(`({order:${model}.map(p=>p.id),active:${state}.active,slot:document.querySelector(${JSON.stringify(selector)}+'.spring-return-slot')?.dataset.index})`);
                assert.deepEqual(result.order,axis==='horizontal'?[prefix+'1',prefix+'0',prefix+'2']:[prefix+'0',prefix+'1',prefix+'2']);
                assert.equal(result.active,false);assert.equal(Number(result.slot),to);await wait(1700);
                assert.equal(await evaluate(`document.querySelectorAll('.spring-returning,.spring-return-slot').length`),0);
                reports.push({selector,pointer,axis,...result});
            }
            // Held pen pickup transfers implicit capture from the child to
            // the whole item. That transfer must not cancel the gesture.
            const held=await point(selector,0);await input(pointer,'mousePressed',held.x,held.y);await wait(550);
            assert.equal(await evaluate(state+'.active'),true);
            await input(pointer,'mouseMoved',held.x+24,held.y);await input(pointer,'mouseMoved',1100,held.y);
            assert.equal(await evaluate(state+'.active'),true,'Capture transfer must retain a held drag');
            await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await input(pointer,'mouseReleased',1100,held.y);await wait(1700);
        }
        // Escape cancels a quick cursor pickup and permits the next interaction.
        const p=await point(selector,0);await input('mouse','mousePressed',p.x,p.y);await input('mouse','mouseMoved',p.x+24,p.y);
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await input('mouse','mouseReleased',p.x+24,p.y);await wait(1700);
        assert.equal(await evaluate(state+'.active'),false);assert.deepEqual(await evaluate(model+'.map(p=>p.id)'),[prefix+'0',prefix+'1',prefix+'2']);
    }
    const types=await evaluate('cursorPointerTypes');assert(types.includes('mouse')&&types.includes('pen'));
    console.log(JSON.stringify({passed:true,controls,synchronousPickup,quickClicks:true,editButton:true,rightButtonIgnored:true,reports,pointerTypes:[...new Set(types)]}));
}finally{await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);for(const pointerType of ['mouse','pen'])await input(pointerType,'mouseReleased',0,0);if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
