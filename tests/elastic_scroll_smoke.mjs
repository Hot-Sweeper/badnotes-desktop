// Native shelf input; disposable models, blocked document writes and complete
// preference restoration. Compare equal-distance pulls at different velocities.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes'),ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const touch=(type,p=[])=>call('Input.dispatchTouchEvent',{type,touchPoints:p.map(([id,x,y])=>({id,x,y,radiusX:6,radiusY:6,force:.6}))});
let storage;
try {
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await evaluate(`localStorage.setItem('badnotes_sidebarCollapsed','false');localStorage.setItem('badnotes_pageNavCollapsed','false');`);await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};API.put=API.post=API.delete=async()=>{throw Error('Elastic fixtures cannot write notes');};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Elastic fixtures cannot write notes');return original(url,o);};
        pages=Array.from({length:24},(_,i)=>({id:'elastic-page-'+i,width:800,height:1100,template:'blank',strokes:[],images:[],textFields:[],handwrittenTextFields:[]}));currentNotebook={id:'elastic-fixture',name:'Elastic scrolling',color:'#7640fd',icon:'book',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook,...Array.from({length:39},(_,i)=>({id:'elastic-book-'+i,name:'Notebook '+i,color:'#7640fd',icon:'book',pages:[]}))];currentPageIndex=0;loadPage(0);renderNotebookList();renderPageList();})()`);await wait(300);
    const report=[];
    for(const id of ['notebookList','pageList']){
        const pose=()=>evaluate(`ElasticScroll.snapshot(document.getElementById('${id}'))`);
        const reset=async bottom=>{await evaluate(`(()=>{const e=document.getElementById('${id}');ElasticScroll.cancel(e,true);e.scrollTop=${bottom?'e.scrollHeight-e.clientHeight':'0'};})()`);await wait(70);};
        const point=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+Math.min(340,r.height*.5)};})()`);
        const pull=async(fast,bottom=false)=>{
            await reset(bottom);await touch('touchStart',[[31,point.x,point.y]]);
            const steps=fast?6:20,interval=fast?12:35,sign=bottom?-1:1;
            for(let i=1;i<=steps;i++){await wait(interval);await touch('touchMove',[[31,point.x,point.y+sign*120*i/steps]]);}
            await wait(12);const held=await pose();await touch('touchEnd');
            for(let i=0;i<20&&(await pose()).contact;i++)await wait(4);
            const released=await pose(),curve=await evaluate(`(async()=>{let peak=Math.abs(ElasticScroll.snapshot(document.getElementById('${id}')).offset);const velocities=[];for(let i=0;i<110;i++){await new Promise(requestAnimationFrame);const s=ElasticScroll.snapshot(document.getElementById('${id}'));peak=Math.max(peak,Math.abs(s.offset));velocities.push(s.velocity);if(!s.animating)break;}return{peak,rest:ElasticScroll.snapshot(document.getElementById('${id}')),changedDirection:velocities.some(v=>v>0)&&velocities.some(v=>v<0)};})()`);
            assert(Math.abs(held.offset)>40&&Math.abs(held.offset)<65,JSON.stringify({id,fast,bottom,held}));assert(!released.contact);assert(!curve.rest.animating&&Math.abs(curve.rest.offset)<.05);assert.equal(await evaluate('notebookDrag.active||pageDrag.active'),false,'Scrolling cannot accidentally reorder an item');return{held,released,...curve};
        };
        const slow=await pull(false),fast=await pull(true),bottom=await pull(true,true);
        assert(fast.peak>slow.peak+.3,'Equal-distance pulls react to release speed: '+JSON.stringify({id,slow,fast}));
        assert(bottom.held.offset<0&&bottom.rest.position===bottom.rest.max,'Bottom edge mirrors the top edge and settles exactly');
        await reset(false);
        for(let i=0;i<3;i++){await call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-25});await wait(16);}
        const wheel=await pose();assert(wheel.animating&&Math.abs(wheel.offset)>10,'Wheel edge responds immediately instead of waiting for a fixed idle timeout');await wait(1000);assert(!(await pose()).animating&&Math.abs((await pose()).offset)<.05);
        report.push({id,slow,fast,bottom,wheel});
    }
    console.log(JSON.stringify({passed:true,report}));
} finally {
    await touch('touchCancel').catch(()=>{});await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`).catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
