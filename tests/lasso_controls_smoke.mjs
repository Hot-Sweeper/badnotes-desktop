// Selection chrome and accessible controls; fixture writes never reach disk.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const key=async name=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,text:name==='Enter'?'\r':undefined,windowsVirtualKeyCode:{ArrowRight:39,ArrowLeft:37,Home:36,End:35,Enter:13,Escape:27}[name]});await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:{ArrowRight:39,ArrowLeft:37,Home:36,End:35,Enter:13,Escape:27}[name]});};
let appearance;
try {
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1600);await call('Page.bringToFront');
    appearance=await evaluate('[settings.theme,settings.accentTheme,localStorage.getItem("badnotes_settings"),localStorage.getItem("badnotes-theme")]');
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};currentNotebook=null;API.put=API.post=async()=>null;
        window.fetch=async()=>{throw Error('Fixture cannot write or fetch documents');};
        pages=[{id:'controls-page',width:1300,height:950,template:'grid',strokes:[],images:[]}];currentPageIndex=0;loadPage(0);
        currentTool='lasso';images=[];currentStroke=null;_setZoomInternal(1);panX=0;panY=0;clearLassoSelection();historyStack=[];redoStack=[];
        window.controlsSelect=()=>{strokes=[{id:'controls-ink',tool:'pen',color:'#ffffff',size:3,points:[{x:800,y:500},{x:840,y:440},{x:900,y:540},{x:1000,y:490}]}];lassoSelection.strokes=[0];lassoSelection.originalStrokes=[structuredClone(strokes[0])];calculateSelectionBounds();lassoMode=false;lassoPath=[{x:740,y:410},{x:1040,y:420},{x:1060,y:590},{x:740,y:600}];lassoSelection.path=structuredClone(lassoPath);multiLassoSelections=[{path:structuredClone(lassoPath),bounds:calculatePathBounds(lassoPath)}];LassoWorkbench.sync();invalidateStrokeCache();redrawCanvas(true);};controlsSelect();
    })()`);
    const paths=await evaluate(`(()=>{const calls={},context=new Proxy({},{get:(o,key)=>o[key]||((...args)=>{calls[key]=(calls[key]||0)+1;}),set:(o,key,value)=>(o[key]=value,true)}),regions=multiLassoSelections;
        drawLassoPath(context);const committed=calls.stroke||0;
        lassoMode=true;drawLassoPath(context);const live=(calls.stroke||0)-committed;const preserved=multiLassoSelections===regions&&regions.length===1;
        lassoMode=false;currentTool='ai-select';lassoPath=[];drawLassoPath(context);const ai=(calls.stroke||0)-live-committed;currentTool='lasso';controlsSelect();
        return{committed,live,ai,preserved};})()`);
    assert.deepEqual(paths,{committed:0,live:1,ai:1,preserved:true});
    const corners=await evaluate(`(()=>{const result=[];for(const name of ['rotateNW','rotateNE','rotateSE','rotateSW']){
        controlsSelect();historyStack=[];redoStack=[];const handle=getLassoHandles()[name],b=lassoSelection.bounds,cx=b.centerX,cy=b.centerY,target={x:cx-(handle.y-cy),y:cy+(handle.x-cx)},event=(x,y)=>{const r=canvas.getBoundingClientRect();return{pointerId:774,pointerType:'mouse',clientX:r.left+panX+x*zoom,clientY:r.top+panY+y*zoom};};
        const hit=getLassoHandleAt(handle.x,handle.y),touch=getLassoHandleAt(handle.x+20/zoom,handle.y,'touch');handleLassoPointerDown(event(handle.x,handle.y),handle.x,handle.y);const rotating=lassoSelection.isRotating;handleLassoPointerMove(event(target.x,target.y),target.x,target.y);handleLassoPointerUp(event(target.x,target.y));const point=strokes[0].points[0],turned=Math.abs(point.x-(cx-(500-cy)))<.001&&Math.abs(point.y-(cy+(800-cx)))<.001;undo();result.push({name,hit,touch,rotating,turned,undo:strokes[0].points[0].x===800&&strokes[0].points[0].y===500});
        }controlsSelect();return result;})()`);
    assert(corners.every(c=>c.hit===c.name&&c.touch===c.name&&c.rotating&&c.turned&&c.undo),JSON.stringify(corners));
    const controls=await evaluate(`(()=>{const menu=document.getElementById('lassoActionMenu');return{role:menu.getAttribute('role'),name:menu.getAttribute('aria-label'),buttons:[...menu.querySelectorAll('button')].map(b=>({action:b.dataset.lassoAction,label:b.getAttribute('aria-label'),icon:!!b.querySelector('svg[aria-hidden="true"]'),text:b.querySelector('span')?.textContent,width:b.offsetWidth,height:b.offsetHeight})),pasteDisabled:menu.querySelector('[data-lasso-action="paste"]').disabled};})()`);
    assert.equal(controls.role,'toolbar');assert.equal(controls.buttons.length,7);assert(controls.pasteDisabled);assert(controls.buttons.every(b=>b.label&&b.icon&&b.text&&b.width>=44&&b.height>=44),JSON.stringify(controls));
    await evaluate(`document.querySelector('[data-lasso-action="copy"]').focus()`);await key('ArrowRight');await key('ArrowRight');
    assert.equal(await evaluate('document.activeElement.dataset.lassoAction'),'duplicate','Keyboard navigation skips disabled Paste');
    await key('Home');await key('Enter');assert.equal(await evaluate('document.querySelector("[data-lasso-action=paste]").disabled'),false,'Native Enter copies and enables Paste');
    const feedback=await evaluate(`(()=>{const b=document.querySelector('[data-lasso-action="copy"]'),r=b.getBoundingClientRect(),event=type=>new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:775,clientX:r.left+r.width/2,clientY:r.top+r.height/2});b.dispatchEvent(event('pointerdown'));const during=b.classList.contains('touch-feedback'),tap=getComputedStyle(b).webkitTapHighlightColor;b.dispatchEvent(event('pointerup'));return{during,after:b.classList.contains('touch-feedback'),tap};})()`);
    assert(feedback.during&&!feedback.after);assert.equal(feedback.tap,'rgba(0, 0, 0, 0)');
    const modes=[];
    await evaluate(`AppearanceSettings.selectAccent('iris')`);
    for(const mode of ['light','dark','oled']){
        const colors=await evaluate(`(()=>{applyTheme(${JSON.stringify(mode)});controlsSelect();LassoWorkbench.sync();const palette=getSelectionThemePalette(),record={stops:[],fills:[],capsules:0},context=new Proxy({},{get:(o,key)=>key==='createLinearGradient'?()=>({addColorStop:(n,color)=>record.stops.push(color)}):key==='roundRect'?()=>record.capsules++:key==='fill'?()=>record.fills.push(o.fillStyle):o[key]||(()=>{}),set:(o,key,value)=>(o[key]=value,true)});isResizeReady=true;drawResizeHandles(context,800,600,60,80);isResizeReady=false;return{mode:settings.theme,accent:getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim(),selection:palette,record,menuAccent:getComputedStyle(document.getElementById('lassoActionMenu')).getPropertyValue('--ui-accent').trim(),menuColor:getComputedStyle(document.getElementById('lassoActionMenu')).backgroundColor,legacyLoopVisible:lassoMode};})()`);
        assert.equal(colors.selection.accent,mode==='light'?'#7640fd':'#c39cf8');assert.equal(colors.selection.highlight,mode==='light'?'#9a4cfd':'#edd3fd');assert.equal(colors.menuAccent,colors.selection.accent);assert.equal(colors.record.capsules,4);assert(colors.record.stops.every(c=>[colors.selection.accent,colors.selection.highlight].includes(c)));assert(colors.record.fills.filter(c=>typeof c==='string').every(c=>c===colors.selection.surface));modes.push(colors);await wait(60);
        const image=await call('Page.captureScreenshot',{format:'png',clip:{x:600,y:275,width:640,height:400,scale:1}});await writeFile('/tmp/badnotes-lasso-controls-'+mode+'.png',Buffer.from(image.data,'base64'));
        await evaluate('clearLassoSelection();isResizeReady=true;redrawCanvas(true)');await wait(60);const pageImage=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-page-resize-'+mode+'.png',Buffer.from(pageImage.data,'base64'));await evaluate('isResizeReady=false;controlsSelect()');
    }
    const tones=[];
    for(const mode of ['light','dark','oled'])for(const accent of ['rose','lagoon','ocean','sage','amber']){
        const state=await evaluate(`(()=>{
            applyTheme('${mode}');controlsSelect();AppearanceSettings.selectAccent('${accent}');
            const palette=getSelectionThemePalette(),style=getComputedStyle(document.documentElement),record={strokes:[],fills:[],stops:[]};
            const context=new Proxy({},{get:(o,key)=>key==='createLinearGradient'?()=>({addColorStop:(n,color)=>record.stops.push(color)}):key==='stroke'?()=>record.strokes.push(o.strokeStyle):key==='fill'?()=>record.fills.push(o.fillStyle):o[key]||(()=>{}),set:(o,key,v)=>(o[key]=v,true)});
            drawLassoSelectionHandles(context);const lasso=record.stops.slice();record.strokes=[];selectedImage={id:'tone-image',x:100,y:100,width:200,height:160,rotation:0};drawImageSelectionHandles(context);selectedImage=null;const image=record.strokes.slice();record.stops=[];isResizeReady=true;drawResizeHandles(context,600,700,20,30);isResizeReady=false;
            return{mode:settings.theme,accent:settings.accentTheme,palette,expected:AppearanceSettings.palette('${mode}','${accent}'),uiAccent:style.getPropertyValue('--ui-accent').trim(),menuAccent:getComputedStyle(document.getElementById('lassoActionMenu')).getPropertyValue('--ui-accent').trim(),lasso,image,page:record.stops,error:getCanvasThemePalette().ui.error};
        })()`);
        assert.equal(state.palette.accent,state.expected['--selection-accent']);assert.equal(state.palette.highlight,state.expected['--selection-highlight']);assert.equal(state.palette.surface,state.expected['--selection-surface']);assert.equal(state.menuAccent,state.palette.accent);assert(state.lasso.includes(state.palette.accent));assert(state.image.length>4&&state.image.every(c=>c===state.palette.accent||c===state.error));assert(state.page.includes(state.palette.accent));tones.push({mode,accent});
    }
    await evaluate(`document.querySelector('[data-lasso-action="copy"]').focus()`);await key('Escape');assert.equal(await evaluate('hasLassoSelection()'),false);assert.equal(await evaluate('document.activeElement===canvas'),true);
    console.log(JSON.stringify({passed:true,paths,corners,controls,feedback,modes,tones}));
}finally{
    if(appearance)await evaluate(`settings.accentTheme=${JSON.stringify(appearance[1])};applyTheme(${JSON.stringify(appearance[0])})`);
    if(appearance)await evaluate(`(()=>{const settingsRaw=${JSON.stringify(appearance[2])},themeRaw=${JSON.stringify(appearance[3])};if(settingsRaw===null)localStorage.removeItem('badnotes_settings');else localStorage.setItem('badnotes_settings',settingsRaw);if(themeRaw===null)localStorage.removeItem('badnotes-theme');else localStorage.setItem('badnotes-theme',themeRaw);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1400);ws.close();
}
