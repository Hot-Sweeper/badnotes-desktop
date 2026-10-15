import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
let serial=0;const pending=new Map();
ws.onmessage=event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
    await evaluate('saveCurrentPage()');
    await call('Page.reload',{ignoreCache:true});await wait(1800);
    await evaluate(`(()=>{if(innerWidth<1700)badnotesWindow.toggleMaximize();})()`);await wait(200);
    const brand=await evaluate(`(()=>{const header=document.querySelector('#sidebar .sidebar-header'),image=header.querySelector('img'),title=header.querySelector('h1');return{visible:getComputedStyle(header).display!=='none',title:title.textContent,logo:image.complete&&image.naturalWidth>0,headerHeight:header.getBoundingClientRect().height,below:document.getElementById('newNotebookBtn').getBoundingClientRect().top>=header.getBoundingClientRect().bottom};})()`);
    assert(brand.visible&&brand.logo&&brand.below);assert.equal(brand.title,'BadNotes');assert(brand.headerHeight<65);
    const alignment=await evaluate(`(()=>{const a=document.getElementById('newNotebookBtn').getBoundingClientRect(),b=document.getElementById('addPageBtn').getBoundingClientRect();return Math.abs(a.top-b.top);})()`);
    assert(alignment<.1,'Notebook and page buttons align vertically');
    const controls=await evaluate(`(()=>{document.documentElement.classList.remove('window-controls-visible');const panel=document.querySelector('.window-titlebar-controls'),s=getComputedStyle(panel),r=panel.getBoundingClientRect();return{visible:s.visibility==='visible'&&s.opacity==='1'&&s.pointerEvents==='auto',buttons:panel.querySelectorAll('button').length,top:r.top,bottom:r.bottom};})()`);
    assert(controls.visible);assert.equal(controls.buttons,3);
    assert(Math.abs(controls.top-4)<.1,'Window controls sit at the top edge');
    assert(controls.bottom<=40);
    for(const theme of ['light','dark']){
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        const styles=await evaluate(`(()=>{const a=getComputedStyle(document.getElementById('newNotebookBtn')),b=getComputedStyle(document.getElementById('addPageBtn'));return ['backgroundColor','color','borderRadius','borderColor','height','fontSize','fontWeight'].map(key=>({key,a:a[key],b:b[key]}));})()`);
        for(const style of styles)assert.equal(style.a,style.b,theme+' matching '+style.key);
        const shot=await call('Page.captureScreenshot',{format:'png',clip:await evaluate(`(()=>{const sidebar=document.getElementById('sidebar').getBoundingClientRect();return{x:Math.max(0,sidebar.x),y:sidebar.y,width:sidebar.width,height:200,scale:1.5};})()`)});
        await writeFile('/tmp/badnotes-shelf-header-'+theme+'.png',Buffer.from(shot.data,'base64'));
    }
    const point=await evaluate(`(()=>{const r=document.getElementById('newNotebookBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});await wait(150);
    assert.equal(await evaluate(`document.getElementById('newNotebookModal').classList.contains('show')`),true,'Button opens new notebook dialog');
    await evaluate(`hideModal('newNotebookModal')`);
    const narrow=await evaluate(`(()=>{const shelf=document.getElementById('sidebar'),page=document.getElementById('pageNav'),original=[shelf.style.cssText,page.style.cssText];shelf.style.transition='none';page.style.transition='none';shelf.style.width='190px';page.style.width='160px';const brand=document.querySelector('.sidebar-brand').getBoundingClientRect(),s=shelf.getBoundingClientRect(),label=document.querySelector('.page-nav-label').getBoundingClientRect(),buttons=document.querySelector('.window-titlebar-controls').getBoundingClientRect();const fits=brand.right<=s.right-15&&label.right<buttons.left;[shelf.style.cssText,page.style.cssText]=original;return fits;})()`);
    assert(narrow,'Brand and controls fit narrow shelves');
    console.log(JSON.stringify({passed:true,brand,matchingButtons:true,alignment,controls,narrow,newNotebookDialog:true}));
}finally{await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
