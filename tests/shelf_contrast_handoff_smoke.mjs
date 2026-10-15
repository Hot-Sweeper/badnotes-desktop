// Verify real thumbnail pixels and the exact compositor handoff, not only the
// final state after an opacity transition could have hidden a flash.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const luminance=rgb=>rgb.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const reports=[];let originalTheme;
try{
    await evaluate('saveCurrentPage()');
    // A failed native-input test can leave Chromium's synthetic button held
    // across renderer reloads. Never let that state leak into these fixtures.
    for(const pointerType of ['mouse','pen'])await call('Input.dispatchMouseEvent',{type:'mouseReleased',pointerType,x:0,y:0,button:'left',buttons:0,clickCount:1});
    await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');originalTheme=await evaluate('settings.theme');
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        pages=[{id:'contrast-page-a',width:800,height:1100,template:'dotted',strokes:[{id:887,tool:'pen',size:8,color:'#ff6b6b',points:[{x:100,y:150},{x:300,y:350},{x:600,y:150}]}],images:[]},{id:'contrast-page-b',width:800,height:1100,template:'grid',strokes:[],images:[]}];
        currentNotebook={id:'contrast-fixture',name:'Notebook contrast',color:'#7640fd',icon:'book',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);
        API.put=async()=>({success:true});const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Contrast fixtures cannot write notes');return originalFetch(url,options);};renderNotebookList();
    })()`);await wait(350);
    for(const theme of ['light','dark','oled']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});renderNotebookList();`);await wait(450);
        const surfaces=await evaluate(`(()=>{const record=PageThumbnails.records.get('contrast-page-a'),rgb=css=>css.match(/[0-9.]+/g).map(Number),style=getComputedStyle(record.paper);return{left:rgb(getComputedStyle(document.querySelector('#sidebar')).backgroundColor),right:rgb(getComputedStyle(document.querySelector('#pageNav')).backgroundColor),paper:rgb(style.backgroundColor),pixels:[...record.canvas.getContext('2d').getImageData(3,3,1,1).data],border:style.borderTopWidth,outline:style.outlineWidth,dirty:record.dirty};})()`);
        assert.deepEqual(surfaces.left,surfaces.right);assert.deepEqual(surfaces.pixels.slice(0,3),surfaces.paper.slice(0,3));assert.equal(surfaces.border,'0px');assert.equal(surfaces.dirty,false);
        const contrast=(luminance(surfaces.paper)+.05)/(luminance(surfaces.right)+.05);
        if(theme==='oled'){assert.deepEqual(surfaces.paper.slice(0,3),[0,0,0]);assert(parseFloat(surfaces.outline)>0&&parseFloat(surfaces.outline)<=1.5);}
        else{assert(luminance(surfaces.paper)>luminance(surfaces.right));assert(contrast>1.05);assert.equal(surfaces.outline,'0px');}
        assert.deepEqual(surfaces.paper.slice(0,3),theme==='light'?[255,255,255]:theme==='dark'?[39,36,46]:[0,0,0]);
        const handoffs=[];
        for(const kind of ['page','notebook']){
            const result=await evaluate(`(async()=>{
                const node=document.querySelector(${JSON.stringify(kind==='page'?'#pageList .page-thumb':'#notebookList .notebook-item')}),r=node.getBoundingClientRect(),clone=DragMotion.${kind==='page'?'clonePage':'cloneNotebook'}(node);document.body.append(clone);
                const sourceNumber=node.querySelector('.page-number'),cloneNumber=clone.querySelector('.page-number');
                const badgeMatches=!sourceNumber||['color','backgroundColor'].every(k=>getComputedStyle(sourceNumber)[k]===getComputedStyle(cloneNumber)[k]);
                const motion=DragMotion.create(clone,r.left+r.width/2,r.top+r.height/2,r);motion.move(r.left+r.width/2+50,r.top+r.height/2+60);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));motion.release(true);
                const samples=[];let tracking=false;const observer=new MutationObserver(()=>{if(node.classList.contains('spring-return-slot'))tracking=true;else if(tracking&&!clone.isConnected){const s=getComputedStyle(node);samples.push({opacity:s.opacity,transition:s.transition,clonePresent:clone.isConnected});}});observer.observe(node,{attributes:true,attributeFilter:['class']});
                await DragMotion.settle(clone,node);const frameOpacity=[];for(let i=0;i<16;i++){await new Promise(r=>requestAnimationFrame(r));frameOpacity.push(getComputedStyle(node).opacity);}observer.disconnect();
                return{samples,frameOpacity,badgeMatches,guardCleaned:!node.classList.contains('spring-return-landed'),transient:document.querySelectorAll('.spring-return-slot,.spring-returning').length};})()`);
        assert(result.samples.length>0);assert(result.samples.every(s=>s.opacity==='1'&&!s.clonePresent));assert(result.frameOpacity.every(o=>o==='1'));assert(result.badgeMatches);assert(result.guardCleaned);assert.equal(result.transient,0);assert.equal(await evaluate('pageDrag.active||notebookDrag.active'),false);handoffs.push({kind,...result});
        }
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-shelf-contrast-'+theme+'.png',Buffer.from(shot.data,'base64'));
        reports.push({theme,surfaces,contrast,handoffs});
    }
    console.log(JSON.stringify({passed:true,reports}));
}finally{if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
