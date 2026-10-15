import assert from 'node:assert/strict';
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();
ws.onmessage=({data})=>{const r=JSON.parse(data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>reject(Error(method+' timeout')),10000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const original=await evaluate("localStorage.getItem('badnotes_panel_widths')");
const collapsed=await evaluate("({badnotes_sidebarCollapsed:localStorage.getItem('badnotes_sidebarCollapsed'),badnotes_pageNavCollapsed:localStorage.getItem('badnotes_pageNavCollapsed')})");
try{
    await evaluate("(async()=>{await saveCurrentPage();localStorage.setItem('badnotes_sidebarCollapsed','false');localStorage.setItem('badnotes_pageNavCollapsed','false')})()");await call('Page.reload',{ignoreCache:true});await wait(1800);
    await call('Page.bringToFront');
    await evaluate(`window.__resizeTrace=[];for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>window.__resizeTrace.push({type,target:e.target.id,x:e.clientX,button:e.button,resizing:isResizing}),true)`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:800,y:100});await wait(200);
    const ui=await evaluate(`({arrows:!!document.getElementById('prevPageBtn')||!!document.getElementById('nextPageBtn'),
        add:document.getElementById('addPageBtn').textContent.trim(),
        numberInside:!!document.querySelector('.page-paper .page-number'),
        pencilOpacity:getComputedStyle(document.querySelector('.notebook-edit')).opacity})`);
    assert.equal(ui.arrows,false);assert.equal(ui.add,'New page');assert(ui.numberInside);assert.equal(ui.pencilOpacity,'0');
    const results=[];
    for(const [panel,grip,direction] of [['sidebar','sidebarResize',1],['pageNav','pageNavResize',-1]]){
        const before=await evaluate(`(()=>{const panel=document.getElementById('${panel}'),grip=document.getElementById('${grip}'),r=grip.getBoundingClientRect();return {width:panel.getBoundingClientRect().width,x:r.left+r.width/2,y:150,hit:document.elementFromPoint(r.left+r.width/2,150)?.id}})()`);
        assert.equal(before.hit,grip,'Resize handle must receive the pointer');
        await call('Input.dispatchMouseEvent',{type:'mousePressed',x:before.x,y:before.y,button:'left',buttons:1});
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x+direction*40,y:before.y,buttons:1});await wait(40);
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:before.x+direction*40,y:before.y,button:'left',buttons:0});
        const after=await evaluate(`document.getElementById('${panel}').getBoundingClientRect().width`);
        const trace=await evaluate('window.__resizeTrace');
        assert(Math.abs(after-before.width-40)<2,'Pointer resizing must follow the drag: '+JSON.stringify({panel,before,after,trace}));results.push({panel,width:after});
    }
    await call('Page.reload',{ignoreCache:true});await wait(1800);
    for(const item of results)assert(Math.abs(await evaluate(`document.getElementById('${item.panel}').getBoundingClientRect().width`)-item.width)<2,'Panel width must survive reload');
    console.log(JSON.stringify({passed:true,ui,results}));
}finally{
    await evaluate(original===null?"localStorage.removeItem('badnotes_panel_widths')":`localStorage.setItem('badnotes_panel_widths',${JSON.stringify(original)})`);
    await evaluate(`for(const [key,value]of Object.entries(${JSON.stringify(collapsed)})){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}`);
    await call('Page.reload',{ignoreCache:true});ws.close();
}
