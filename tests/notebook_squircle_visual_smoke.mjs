// Native UI corner geometry and exact notebook pickup/release continuity.
// Fixtures and order writes stay in memory; reload restores actual notebooks.
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
const point=index=>evaluate(`(()=>{const r=document.querySelector('#notebookList .notebook-item[data-index="${index}"]').getBoundingClientRect();return{x:r.left+r.width*.35,y:r.top+r.height*.45};})()`);
const reports=[];let originalTheme;
const squircle=corner=>corner==='squircle'||corner==='superellipse(2)';
const circle=corner=>corner==='round'||corner==='superellipse(1)';
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);originalTheme=await evaluate('settings.theme');await call('Page.bringToFront');
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        pages=[{id:'squircle-page-a',width:800,height:1100,template:'grid',strokes:[],images:[]},{id:'squircle-page-b',width:800,height:600,template:'dotted',strokes:[],images:[]}];
        currentNotebook={id:'squircle-book-a',name:'Project notebook',color:'#7640fd',icon:'book',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};
        notebooks=[currentNotebook,{id:'squircle-book-b',name:'Second notebook',color:'#dd6aaf',icon:'leaf',pages:[],trash:[],contentTrash:[]}];currentPageIndex=0;loadPage(0);
        API.put=async()=>{await new Promise(r=>setTimeout(r,450));return{success:true};};
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Squircle fixtures cannot write real notes');return originalFetch(url,options);};
        window.surfaceStyle=el=>{const s=getComputedStyle(el);return{backgroundColor:s.backgroundColor,borderColor:s.borderColor,borderRadius:s.borderRadius,cornerShape:s.cornerShape,boxShadow:s.boxShadow,padding:s.padding,gap:s.gap,fontSize:s.fontSize,color:s.color};};
        const create=DragMotion.create;
        DragMotion.create=(element,x,y,rect)=>{
            if(!element.classList.contains('notebook-item'))return create(element,x,y,rect);
            const source=notebookDrag.el,expected=surfaceStyle(source),cover=source.querySelector('.notebook-cover'),coverStyle=surfaceStyle(cover),label=source.querySelector('.notebook-name').getBoundingClientRect(),sr=source.getBoundingClientRect();
            const edit=getComputedStyle(source.querySelector('.notebook-edit')).opacity,result=create(element,x,y,rect),r=element.getBoundingClientRect(),name=element.querySelector('.notebook-name').getBoundingClientRect();
            window.bookPickup={expected,actual:surfaceStyle(element),rect:[r.x,r.y,r.width,r.height],expectedRect:[rect.x,rect.y,rect.width,rect.height],coverStyle,cloneCoverStyle:surfaceStyle(element.querySelector('.notebook-cover')),edit,cloneEdit:getComputedStyle(element.querySelector('.notebook-edit')).opacity,nameOffset:[name.x-r.x,name.y-r.y],sourceNameOffset:[label.x-sr.x,label.y-sr.y]};return result;
        };renderNotebookList();renderPageList();
    })()`);await wait(350);
    const styles=await evaluate(`(()=>{const selectors=['#newNotebookBtn','#addPageBtn','.tool-btn','#settingsModal .modal','#newNotebookModal .modal','.notebook-cover','.page-paper'];return{supports:CSS.supports('corner-shape','squircle'),surfaces:selectors.map(selector=>({selector,corner:getComputedStyle(document.querySelector(selector)).cornerShape})),circles:[...document.querySelectorAll('.color-preset,#recycleBinBtn,#toolboxBtn,.floating-toolbar')].map(el=>getComputedStyle(el).cornerShape),pages:[...document.querySelectorAll('.page-paper')].map(el=>({radius:getComputedStyle(el).borderRadius,border:getComputedStyle(el).borderTopWidth,corner:getComputedStyle(el).cornerShape})),grips:document.querySelectorAll('.page-grip').length};})()`);
    assert(styles.supports);assert(styles.surfaces.every(s=>squircle(s.corner)),JSON.stringify(styles));assert(styles.circles.every(circle));assert.equal(styles.grips,0);assert(styles.pages.every(p=>p.radius==='22px'&&p.border==='0px'&&squircle(p.corner)));
    assert.deepEqual(await evaluate(`['#newNotebookBtn','#addPageBtn','#notebookList .notebook-item'].map(q=>getComputedStyle(document.querySelector(q)).borderRadius)`),['18px','18px','22px']);
    for(const theme of ['light','dark']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});renderNotebookList();renderPageList();document.getElementById('notebookList').scrollTop=0;`);await wait(300);
        const index=theme==='light'?0:1,p=await point(index);await mouse('mouseMoved',p.x,p.y);await wait(200);await mouse('mousePressed',p.x,p.y);await wait(550);
        const pickup=await evaluate('bookPickup');
        const normalize=shadow=>shadow.startsWith('rgba(0, 0, 0, 0)')?'none':shadow.replace(/, rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/,'');
        assert.deepEqual({...pickup.actual,boxShadow:normalize(pickup.actual.boxShadow)},pickup.expected);
        assert.deepEqual(pickup.cloneCoverStyle,pickup.coverStyle);assert.equal(pickup.edit,pickup.cloneEdit);
        pickup.rect.forEach((v,i)=>assert(Math.abs(v-pickup.expectedRect[i])<.15,JSON.stringify(pickup)));
        pickup.nameOffset.forEach((v,i)=>assert(Math.abs(v-pickup.sourceNameOffset[i])<.15,JSON.stringify(pickup)));
        const target=await point(theme==='light'?1:0);await mouse('mouseMoved',target.x,target.y);await mouse('mouseMoved',800,target.y);await wait(120);await mouse('mouseReleased',800,target.y);await wait(65);
        const returning=await evaluate(`(()=>{const c=document.querySelector('.spring-returning'),slot=document.querySelector('#notebookList .spring-return-slot');return{order:notebooks.map(b=>b.id),active:!!c,slotHidden:slot&&getComputedStyle(slot).opacity==='0',corner:c&&getComputedStyle(c).cornerShape,coverMatches:c&&c.querySelector('.notebook-cover').style.cssText===slot?.querySelector('.notebook-cover').style.cssText,clip:c&&getComputedStyle(c).clipPath};})()`);
        assert(returning.active&&returning.slotHidden&&returning.coverMatches);assert(squircle(returning.corner));assert.equal(returning.clip,'none');assert.deepEqual(returning.order,theme==='light'?['squircle-book-b','squircle-book-a']:['squircle-book-a','squircle-book-b']);
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-squircles-'+theme+'.png',Buffer.from(shot.data,'base64'));await wait(1700);
        assert.equal(await evaluate(`document.querySelectorAll('.spring-returning,.spring-return-slot').length`),0);reports.push({theme,pickup,returning});
    }
    console.log(JSON.stringify({passed:true,styles,reports}));
}finally{if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
