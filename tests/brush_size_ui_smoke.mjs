// UI and pen integration checks with an isolated document and mocked saves.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
const mouse=(type,x,y,pointerType='mouse')=>call('Input.dispatchMouseEvent',{type,x,y,pointerType,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
const click=async selector=>{const p=await point(selector);await mouse('mousePressed',p.x,p.y);await mouse('mouseReleased',p.x,p.y);await wait(40);};
let originalTheme,toolbarConfig;const reports=[];
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    originalTheme=await evaluate('settings.theme');toolbarConfig=await evaluate(`localStorage.getItem('badnotes_toolbar_config')`);
    await evaluate(`(()=>{
        if(innerWidth<1700)badnotesWindow.toggleMaximize();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};window.settingsSaves=0;saveSettings=()=>settingsSaves++;
        pages=[{id:'brush-page',width:800,height:1100,template:'dotted',strokes:[],images:[]}];currentNotebook={id:'brush-fixture',name:'Brush controls',color:'#7640fd',icon:'pen',pages:['brush-page'],trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);renderNotebookList();
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Brush fixtures cannot write notes');return originalFetch(url,options);};API.put=async()=>({success:true});
        window.brushState=()=>({current:currentSize,base:baseBrushSize,slider:Number(document.getElementById('sizeSlider').value),label:document.querySelector('#brushSizeButton .brush-size-label')?.textContent,numeric:Number(document.getElementById('brushSizeNumber').value),width:Number(document.getElementById('brushSizeSample').getAttribute('stroke-width')),sliders:document.querySelectorAll('#sizeSlider').length,toggles:document.querySelectorAll('#dynamicBrushToggle').length,inline:document.querySelectorAll('.floating-toolbar input[type="range"],.floating-toolbar .dynamic-brush-toggle').length});
    })()`);await wait(300);
    for(const theme of ['light','dark','oled']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});`);await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:900,y:100,button:'none',buttons:0});await wait(200);
        const styles=await evaluate(`(()=>{const s=q=>getComputedStyle(document.querySelector(q));return{round:['#recycleBinBtn','#toolboxBtn','.floating-toolbar','.color-preset'].map(q=>({q,corner:s(q).cornerShape,radius:s(q).borderRadius})),rectangular:['.page-paper','#newNotebookModal .modal'].map(q=>s(q).cornerShape),buttons:['#addPageBtn','#newNotebookBtn'].map(q=>{const r=document.querySelector(q).getBoundingClientRect();return{border:s(q).borderTopWidth,top:r.top,height:r.height,corner:s(q).cornerShape};}),state:brushState()};})()`);
        assert(styles.round.every(s=>s.corner==='superellipse(1)'));assert.equal(styles.round[0].radius,'50%');assert.equal(styles.round[1].radius,'50%');assert.equal(styles.round[2].radius,'9999px');assert(styles.rectangular.every(s=>s==='superellipse(2)'));assert(styles.buttons.every(s=>s.border==='0px'));assert(Math.abs(styles.buttons[0].top-styles.buttons[1].top)<1);assert.equal(styles.state.inline,0);assert.equal(styles.state.base,styles.state.current);
        const shelf=await point('#addPageBtn');await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:shelf.x,y:shelf.y,button:'none',buttons:0});await wait(200);const hover=await evaluate(`(()=>{const s=getComputedStyle(document.getElementById('addPageBtn'));return{border:s.borderTopWidth,lift:new DOMMatrix(s.transform).m42,shadow:s.boxShadow};})()`);assert.equal(hover.border,'0px');assert.equal(hover.lift,0);assert.equal(hover.shadow,'none');
        await click('#brushSizeButton');assert.equal(await evaluate(`document.getElementById('brushSizeButton').getAttribute('aria-expanded')`),'true');
        const position=await evaluate(`(()=>{const p=document.getElementById('brushSizePanel').getBoundingClientRect(),a=document.getElementById('brushSizeButton').getBoundingClientRect();return{left:p.left,right:p.right,top:p.top,bottom:p.bottom,viewport:innerWidth,dock:a.top,corner:getComputedStyle(document.getElementById('brushSizePanel')).cornerShape,track:getComputedStyle(document.querySelector('.brush-pressure-track')).cornerShape};})()`);
        assert(position.left>=11&&position.right<=position.viewport-11&&position.top>=11&&position.bottom<position.dock);assert.equal(position.corner,'superellipse(2)');assert.equal(position.track,'superellipse(1)');
        await click('[data-brush-size="5"]');const preset=await evaluate('brushState()');assert.equal(preset.current,5);assert.equal(preset.base,5);assert.equal(preset.slider,5);assert.equal(preset.width,5);assert.equal(preset.numeric,5);assert.equal(preset.label,'5');
        await evaluate(`(()=>{const range=document.getElementById('sizeSlider');range.value=3.2;range.dispatchEvent(new Event('input',{bubbles:true}));range.focus();})()`);
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await wait(40);assert.equal(await evaluate('currentSize'),3.3);
        await evaluate(`(()=>{const number=document.getElementById('brushSizeNumber');number.value=99;number.dispatchEvent(new Event('input',{bubbles:true}));number.dispatchEvent(new Event('change',{bubbles:true}));})()`);const clamp=await evaluate('brushState()');assert.equal(clamp.current,10);assert.equal(clamp.numeric,10);
        await evaluate(`BrushSizeWorkbench.setSize(1.5);setColor('#ffffff');`);assert.equal(await evaluate(`document.getElementById('brushSizeSample').getAttribute('stroke')`),theme==='light'?'#000000':'#ffffff');
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-brush-panel-'+theme+'.png',Buffer.from(shot.data,'base64'));
        await click('#brushSizeClose');assert.equal(await evaluate(`document.getElementById('brushSizePanel').hidden`),true);assert.equal(await evaluate(`document.activeElement.id`),'brushSizeButton');
        reports.push({theme,styles,position,preset,clamp});
    }
    await click('#brushSizeButton');const beforePressure=await evaluate('dynamicBrushEnabled'),beforeSaves=await evaluate('settingsSaves');await click('#dynamicBrushToggle');assert.equal(await evaluate('dynamicBrushEnabled'),!beforePressure);assert.equal(await evaluate('settings.dynamicBrushEnabled'),!beforePressure);assert.equal(await evaluate('settingsSaves'),beforeSaves+1);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await evaluate(`document.getElementById('brushSizePanel').hidden`),true);
    // Existing barrel-size adjustment writes the old value label directly.
    await evaluate(`currentSize=4.7;baseBrushSize=4.7;document.getElementById('sizeSlider').value=4.7;document.getElementById('sizeValue').textContent='4.7px';`);await wait(30);assert.equal((await evaluate('brushState()')).label,'4.7');
    await evaluate('ModularToolbar.render()');await wait(50);const rerender=await evaluate('brushState()');assert.equal(rerender.current,4.7);assert.equal(rerender.slider,4.7);assert.equal(rerender.sliders,1);assert.equal(rerender.toggles,1);assert.equal(rerender.inline,0);
    await evaluate(`ModularToolbar.toggleSection('size-section',false)`);assert.equal(await evaluate(`!!document.getElementById('brushSizeButton')`),false);assert.equal(await evaluate(`document.querySelectorAll('#sizeSlider').length`),1);
    const hiddenSaves=await evaluate(`(()=>{ModularToolbar.render();ModularToolbar.render();const before=settingsSaves,input=document.getElementById('dynamicBrushToggle');input.checked=!input.checked;input.dispatchEvent(new Event('change',{bubbles:true}));return settingsSaves-before;})()`);assert.equal(hiddenSaves,1,'Hidden sections must not accumulate persistence listeners');
    await evaluate(`ModularToolbar.toggleSection('size-section',true)`);assert.equal(await evaluate(`document.querySelectorAll('#brushSizeButton').length`),1);assert.equal((await evaluate('brushState()')).current,4.7);
    // Clicking outside dismisses, and the geometry and size panels never stack.
    await click('#geometryToggleBtn');assert.equal(await evaluate(`document.getElementById('geometryPanel').hidden`),false);await click('#brushSizeButton');assert.equal(await evaluate(`document.getElementById('geometryPanel').hidden`),true);await click('#themeToggleBtn');assert.equal(await evaluate(`document.getElementById('brushSizePanel').hidden`),true);
    // Keep the drawing-size contract intact after the controls leave the dock.
    await evaluate(`applyTheme('light');BrushSizeWorkbench.setSize(5);dynamicBrushEnabled=false;GeometryDetector.enabled=false;currentTool='pen';_setZoomInternal(1);panX=panY=0;redrawCanvas(true);`);
    const pen=await evaluate(`(()=>{const r=document.getElementById('sidebar').getBoundingClientRect();return{x:r.right+150,y:220};})()`);assert.equal(await evaluate(`document.elementFromPoint(${pen.x},${pen.y})?.id`),'drawingCanvas');await mouse('mousePressed',pen.x,pen.y,'pen');await mouse('mouseMoved',pen.x+40,pen.y+30,'pen');await mouse('mouseReleased',pen.x+40,pen.y+30,'pen');await wait(80);
    const ink=await evaluate(`strokes.map(s=>({size:s.size,points:s.points.length}))`);assert(ink.length&&ink.every(s=>s.size===5),JSON.stringify({ink,pen,diagnostics:await evaluate(`({isDrawing,currentTool,currentSize,geometry:GeometryDetector.enabled,active:document.activeElement?.id,over:document.elementFromPoint(${pen.x},${pen.y})?.id,panX,panY,zoom,width:baseWidth,height:baseHeight})`)}));
    console.log(JSON.stringify({passed:true,reports,rerender,barrelSync:true,sectionHideShow:true,pressure:true,keyboard:true,dismissal:true,ink}));
}finally{
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));if(isDrawing)stopDrawing();`);for(const pointerType of ['mouse','pen'])await mouse('mouseReleased',0,0,pointerType);
    if(toolbarConfig!==undefined)await evaluate(toolbarConfig===null?`localStorage.removeItem('badnotes_toolbar_config')`:`localStorage.setItem('badnotes_toolbar_config',${JSON.stringify(toolbarConfig)})`);
    if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
