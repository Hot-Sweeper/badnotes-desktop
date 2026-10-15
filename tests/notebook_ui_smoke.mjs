import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=({data})=>{const r=JSON.parse(data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>reject(Error(method+' timed out')),10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);
    const modal=await evaluate(`(()=>{
        showModal('newNotebookModal');
        const title=document.getElementById('newNotebookTitle');title.value='Design journal';title.dispatchEvent(new Event('input'));
        document.querySelector('#colorGrid button:nth-child(3)').click();
        document.querySelector('#newNotebookModal [data-template="dotted"]').click();
        return {name:document.getElementById('newNotebookPreviewTitle').textContent,
            paper:document.getElementById('newNotebookPreviewPaper').textContent,
            color:document.getElementById('newNotebookCover').style.getPropertyValue('--cover-color'),
            selected:document.querySelector('#colorGrid [aria-pressed="true"]').dataset.color,
            covers:document.querySelectorAll('.notebook-cover .cover-emblem').length,
            emojis:/[\u{1F300}-\u{1FAFF}]/u.test(document.getElementById('notebookList').textContent)};
    })()`);
    assert.equal(modal.name,'Design journal');assert(modal.paper.startsWith('Dotted'));assert(modal.color);assert(modal.selected);assert(modal.covers>1);assert.equal(modal.emojis,false);
    await wait(200);const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-notebook-dialog.png',Buffer.from(shot.data,'base64'));
    await evaluate("hideModal('newNotebookModal')");await wait(100);
    const library=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-library-refresh.png',Buffer.from(library.data,'base64'));
    const edited=await evaluate(`(async()=>{
        await saveCurrentPage();currentNotebook=null;
        const fake={id:'ui-edit-test',name:'Before',color:'#4a9eff',pages:['a','b'],icon:'book'};
        notebooks=[fake];API.put=async(url,data)=>({...fake,...data});
        openNotebookEditor(fake.id);
        const heading=document.getElementById('newNotebookHeading').textContent;
        document.querySelector('#notebookIconGrid [data-icon="leaf"]').click();
        document.querySelector('#colorGrid button:nth-child(3)').click();
        await createNotebook('Botany',document.querySelector('#colorGrid .selected').dataset.color,'blank');hideModal('newNotebookModal');
        return {heading,name:fake.name,color:fake.color,icon:fake.icon,pages:fake.pages,editorReset:notebookEditingId===null};
    })()`);
    assert.equal(edited.heading,'Edit notebook');assert.equal(edited.name,'Botany');assert.equal(edited.color,'#355c9b');assert.equal(edited.icon,'leaf');assert.deepEqual(edited.pages,['a','b']);assert(edited.editorReset);
    const reordered=await evaluate(`(async()=>{
        hideModal('newNotebookModal');await saveCurrentPage();
        saveCurrentPage=async()=>{};API.put=async()=>{};
        currentNotebook={id:'ui-memory-test',pages:['a','b','c','d']};
        pages=currentNotebook.pages.map(id=>({id,width:1100,height:1600,strokes:[],images:[]}));currentPageIndex=1;
        renderPageList();
        const list=document.getElementById('pageList');
        const thumb=list.querySelector('[data-index="1"]'),rect=thumb.getBoundingClientRect();
        thumb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:rect.left+40,clientY:rect.top+40}));
        await new Promise(resolve=>setTimeout(resolve,450));
        const lifted=!!pageDrag.clone && pageDrag.clone.querySelector('canvas').width===thumb.querySelector('canvas').width;
        const liftedClone=pageDrag.clone;
        const target=list.querySelector('[data-index="3"]').getBoundingClientRect();
        document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:target.left+40,clientY:target.bottom-20}));
        const marker=!!pageDrag.marker;
        document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,150));
        list.querySelector('[data-index="0"]').click();
        return {order:currentNotebook.pages,index:currentPageIndex,indicator:document.getElementById('pageIndicator').textContent,lifted,marker,cloneRemoved:!!liftedClone && !liftedClone.isConnected};
    })()`);
    assert.deepEqual(reordered.order,['a','c','d','b']);assert.equal(reordered.index,3);assert.equal(reordered.indicator,'4 / 4');
    assert(reordered.lifted);assert.equal(reordered.marker,false);assert(reordered.cloneRemoved);
    console.log(JSON.stringify({passed:true,modal,edited,reordered}));
}finally{await call('Page.reload',{ignoreCache:true});ws.close();}
