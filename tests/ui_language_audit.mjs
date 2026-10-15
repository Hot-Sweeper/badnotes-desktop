// All editor sheets/popovers, all modes/tones, desktop and compact layouts.
// Local fixtures, zero provider requests/document writes, restore preferences.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {connect,wait} from './helpers/cdp.mjs';
const c=await connect(),{call,evaluate}=c;let storage,emulated=false;
const requests=[],errors=[];c.on('Network.requestWillBeSent',e=>requests.push(e.request.url));c.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails));
const key=(key,shift=false)=>call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers:shift?8:0});
const listeners=async()=>{const r=await call('Runtime.evaluate',{expression:'document',returnByValue:false});return (await call('DOMDebugger.getEventListeners',{objectId:r.result.objectId})).listeners.length;};
const reports=[];
try{
    await evaluate(`(()=>{if(!currentNotebook||/fixture|^alias-|^bitmap-|^controls-|^polish-|^cursor-/.test(currentNotebook.id))throw Error('Not a real notebook');return saveCurrentPage();})()`);
    storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Network.enable');await call('Runtime.enable');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    assert(!requests.some(url=>url.includes('/katex@')),'The ordinary editor never preloads assistant math');
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};saveSettings=async()=>{};
        const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('UI audit cannot write notes or call a provider');return original(url,o);};API.put=API.post=API.delete=async()=>{throw Error('UI audit cannot write notes');};
        pages=[{id:'ui-audit-page',width:800,height:1100,template:'grid',strokes:[],images:[],textFields:[],handwrittenTextFields:[]}];currentNotebook={id:'ui-audit-fixture',name:'Design audit',color:'#7640fd',icon:'book',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);renderNotebookList();renderPageList();
        window.closeAuditSurfaces=()=>{for(const id of ['newNotebookModal','settingsModal','recycleBinModal'])hideModal(id);AIHelper.closePrompt();AIHelper.closeResponse();BrushSizeWorkbench.close();PaletteWorkbench.close();HandwrittenTextField.toggleSettingsPanel(false);document.querySelector('#geometryPanel')?.setAttribute('hidden','');document.getElementById('contextMenu')?.classList.remove('visible');Toolbox.close();};
        GeometryWorkbench.open();BrushSizeWorkbench.open();PaletteWorkbench.open();HandwrittenTextField.toggleSettingsPanel(true);document.getElementById('toolboxBtn').click();AIHelper.showPrompt();closeAuditSurfaces();
        window.auditSurface=(selector)=>{const node=document.querySelector(selector);if(!node)throw Error('Missing '+selector);const r=node.getBoundingClientRect(),s=getComputedStyle(node),root=getComputedStyle(document.documentElement);return{selector,bounds:[r.x,r.y,r.width,r.height],text:s.color,background:s.backgroundColor,radius:s.borderRadius,corner:s.cornerShape,blur:s.backdropFilter,tokenText:root.getPropertyValue('--ui-text').trim(),tokenAccent:root.getPropertyValue('--ui-accent').trim(),horizontalOverflow:node.scrollWidth>node.clientWidth+2};};
    })()`);await wait(300);
    const baseline=await listeners();
    for(let i=0;i<40;i++)await evaluate(`AIHelper.showPrompt();document.querySelector('.ai-prompt-overlay').click();AIHelper.showPrompt();AIHelper.closePrompt();`);
    assert.equal(await listeners(),baseline,'Dismissing/reopening assistant prompts cannot leak keyboard listeners');
    await evaluate(`document.getElementById('toolboxBtn').focus();AIHelper.showPrompt();`);await wait(100);
    assert.equal(await evaluate('document.activeElement.id'),'aiPromptInput',JSON.stringify(await evaluate(`({active:document.activeElement.outerHTML,dialog:document.querySelector('#ai-prompt-dialog').outerHTML,focused:document.hasFocus(),session:DialogFocus.active,css:getComputedStyle(document.querySelector('#ai-prompt-dialog')).display})`)));await key('Tab',true);
    assert(await evaluate(`document.getElementById('ai-prompt-dialog').contains(document.activeElement)`));
    await key('Escape');assert.equal(await evaluate('DialogFocus.active'),false);assert.equal(await evaluate('document.activeElement.id'),'toolboxBtn');
    await evaluate(`HandwrittenTextField.toggleSettingsPanel(true);const slider=document.getElementById('tf-lineHeight');slider.value='1.23';slider.dispatchEvent(new Event('input',{bubbles:true}));`);
    assert.equal(await evaluate(`document.querySelector('#tf-lineHeight').parentElement.querySelector('.tf-value').textContent`),'1.23');
    assert.equal(await evaluate(`document.querySelector('#lineheight-ticks option').value`),'0.585','Updating the line-height readout never destroys its datalist');
    const inputIsolation=await evaluate(`(()=>{
        HandwrittenTextField.createTextField(50,50);SimpleTextField.createTextField(100,100);
        const input=document.getElementById('tf-lineHeight');input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
        const key=new KeyboardEvent('keypress',{key:'a',bubbles:true,cancelable:true});input.dispatchEvent(key);
        const paste=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:()=> 'Should stay in the control'}});input.dispatchEvent(paste);
        const result={handwriting:HandwrittenTextField.getTextFields()[0].text,plain:SimpleTextField.getTextFields()[0].text,keyPrevented:key.defaultPrevented,pastePrevented:paste.defaultPrevented};
        HandwrittenTextField.setTextFields([]);SimpleTextField.setTextFields([]);return result;
    })()`);
    assert.deepEqual(inputIsolation,{handwriting:'',plain:'',keyPrevented:false,pastePrevented:false},'Controls must not type or paste into selected notes underneath');
    await evaluate('closeAuditSurfaces()');
    for(const mode of ['light','dark','oled']){
        for(const tone of ['iris','rose','lagoon','ocean','sage','amber']){
            await evaluate(`applyTheme('${mode}');AppearanceSettings.selectAccent('${tone}');`);await wait(40);
            const surfaces=[];
            const visit=async(expression,selector)=>{
                await evaluate('closeAuditSurfaces();'+expression);await wait(35);const state=await evaluate(`auditSurface(${JSON.stringify(selector)})`);
                assert(state.bounds[2]>0&&state.bounds[3]>0,JSON.stringify(state));assert(!state.horizontalOverflow,JSON.stringify(state));
                assert(state.bounds[0]>=-1&&state.bounds[1]>=-1&&state.bounds[0]+state.bounds[2]<=await evaluate('innerWidth')+1&&state.bounds[1]+state.bounds[3]<=await evaluate('innerHeight')+1,JSON.stringify(state));
                assert.equal(state.corner,'superellipse(2)','Rectangular sheets use continuous corners');surfaces.push(state);
            };
            await visit('showModal("newNotebookModal")','#newNotebookModal .modal');
            await visit('notebookEditingId=currentNotebook.id;showModal("newNotebookModal")','#newNotebookModal .modal');
            for(const tab of ['appearance','drawing','buttons','toolbar'])await visit(`openSettingsModal();document.querySelector('[data-settings-tab="${tab}"]').click()`,'#settingsModalContent');
            await visit('showRecycleBin()','#recycleBinModal .modal');
            await visit('GeometryWorkbench.open()','#geometryPanel');
            await visit('BrushSizeWorkbench.open()','#brushSizePanel');
            await visit('PaletteWorkbench.open()','#palettePanel');
            await visit('HandwrittenTextField.toggleSettingsPanel(true)','#textfield-settings-panel');
            await visit(`showContextMenu(innerWidth*.5,innerHeight*.4,0,0)`,'.context-menu');
            await visit(`document.getElementById('toolboxBtn').click();document.querySelector('[data-category="tools"]').click()`,'#toolboxDrawer');
            await visit(`document.getElementById('toolboxBtn').click();document.querySelector('[data-category="toys"]').click()`,'#toolboxDrawer');
            await visit('AIHelper.showPrompt()','.ai-prompt-content');
            await visit('AIHelper.showResponse('+JSON.stringify('## An explanation\n\nAn answer with **clear emphasis**.\n\n- First step\n- Second step\n\n```js\nconst result = 42;\n```')+',"general")','.ai-modal-content');
            assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ai-modal-body')).color`),await evaluate(`getComputedStyle(document.querySelector('.ai-modal-title')).color`));
            assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ai-modal-append')).display`),'none','No append action without an active text field');
            assert.equal(await evaluate(`document.querySelectorAll('#toolboxDrawer .toolbox-item-icon svg').length`),await evaluate(`document.querySelectorAll('#toolboxDrawer [data-tool-type]').length`));
            assert(!await evaluate(`/[\\p{Extended_Pictographic}]/u.test(document.querySelector('#toolboxDrawer').textContent+document.querySelector('#ai-prompt-dialog').textContent)`),'UI uses icons, not emoji');
            if(tone==='iris'){const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-ui-audit-'+mode+'-assistant.png',Buffer.from(shot.data,'base64'));}
            reports.push({mode,tone,surfaces:surfaces.map(s=>({selector:s.selector,text:s.text,background:s.background,radius:s.radius,blur:s.blur}))});
        }
    }
    await evaluate('closeAuditSurfaces();AIHelper.showPrompt()');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});emulated=true;await wait(150);
    for(const selector of ['.ai-prompt-content','.ai-modal-content']){
        if(selector==='.ai-modal-content')await evaluate(`AIHelper.closePrompt();AIHelper.showResponse('A compact answer.','quick')`);
        const state=await evaluate(`auditSurface('${selector}')`);assert(state.bounds[0]>=0&&state.bounds[0]+state.bounds[2]<=391&&!state.horizontalOverflow,JSON.stringify(state));
    }
    const compact=[];
    for(const [expression,selector]of [
        ['showModal("newNotebookModal")','#newNotebookModal .modal'],
        ['openSettingsModal()','#settingsModalContent'],
        ['showRecycleBin()','#recycleBinModal .modal'],
        ['GeometryWorkbench.open()','#geometryPanel'],
        ['BrushSizeWorkbench.open()','#brushSizePanel'],
        ['PaletteWorkbench.open()','#palettePanel'],
        ['HandwrittenTextField.toggleSettingsPanel(true)','#textfield-settings-panel'],
        ['Toolbox.open()','#toolboxDrawer']
    ]){
        await evaluate('closeAuditSurfaces();'+expression);await wait(60);
        const state=await evaluate(`auditSurface(${JSON.stringify(selector)})`);compact.push(state.selector);
        assert(state.bounds[0]>=-1&&state.bounds[1]>=-1&&state.bounds[0]+state.bounds[2]<=391&&state.bounds[1]+state.bounds[3]<=845&&!state.horizontalOverflow,JSON.stringify(state));
    }
    await call('Emulation.clearDeviceMetricsOverride');emulated=false;await evaluate('closeAuditSurfaces()');
    // Dirty old buffers and decoded sources are evicted at a notebook boundary.
    const memory=await evaluate(`(()=>{const old=[...PageThumbnails.records.values()][0],snapshot=old.snapshot;window.imageCache.set('retired-image',new Image());pages=[{id:'ui-audit-replacement',width:800,height:1100,template:'blank',strokes:[],images:[]}];currentNotebook.pages=pages.map(p=>p.id);loadPage(0);renderPageList();return{oldCanvas:old.canvas.width,oldLive:old.live.width,oldSnapshot:snapshot?.canvas.width??0,retiredImage:window.imageCache.has('retired-image')};})()`);
    assert.deepEqual(memory,{oldCanvas:0,oldLive:0,oldSnapshot:0,retiredImage:false});
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log(JSON.stringify({passed:true,combinations:reports.length,surfacesPerCombination:reports[0].surfaces.length,compact,inputIsolation,documentListeners:baseline,leakFreeReopens:80,memory}));
}finally{
    if(emulated)await call('Emulation.clearDeviceMetricsOverride');
    await evaluate('window.closeAuditSurfaces?.()').catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);c.close();
}
