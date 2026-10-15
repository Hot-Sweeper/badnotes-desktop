// Palette coherence, readable chrome and shared native paper colors.
// All document and persistence changes below are isolated in memory.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const luminance=rgb=>rgb.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
const expected={light:{paper:[255,255,255],shelf:[240,237,245],surface:[251,250,255],surround:[228,225,235]},dark:{paper:[39,36,46],shelf:[27,25,34],surface:[48,44,58],surround:[17,16,22]},oled:{paper:[0,0,0],shelf:[13,11,17],surface:[25,21,31],surround:[0,0,0]}};
let originalTheme;const reports=[];
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');originalTheme=await evaluate('settings.theme');
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};saveSettings=()=>{};API.put=async()=>({success:true});
        const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Palette fixtures cannot write notes');return originalFetch(url,options);};
        pages=['dotted','grid'].map((template,i)=>({id:'palette-page-'+i,width:800,height:1100,template,images:[],strokes:['#ffffff','#ff6b6b','#4d96ff','#6bcb77'].map((color,n)=>({id:i*10+n,tool:'pen',size:5,color,points:Array.from({length:75},(_,p)=>({x:100+p*8,y:190+n*150+Math.sin(p*.075)*60}))}))}));
        currentNotebook={id:'palette-fixture',name:'Ideas & sketches',color:'#7640fd',icon:'book',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook,{id:'palette-other',name:'Project notebook',color:'#ce83ad',icon:'leaf',pages:[]}];currentPageIndex=0;loadPage(0);renderNotebookList();renderPageList();
        const left=document.getElementById('sidebar').getBoundingClientRect().right,right=document.getElementById('pageNav').getBoundingClientRect().left;
        _setZoomInternal(Math.min((right-left-160)/baseWidth,(innerHeight-180)/baseHeight));panX=(left+right-baseWidth*zoom)/2;panY=(innerHeight-baseHeight*zoom)/2;redrawCanvas(true);
        GeometryWorkbench.open();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));BrushSizeWorkbench.open();BrushSizeWorkbench.close();
        window.paletteRGB=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return[...x.getImageData(0,0,1,1).data].slice(0,3);};
        window.paletteToken=key=>paletteRGB(getComputedStyle(document.documentElement).getPropertyValue(key).trim());
        window.paletteStyle=q=>{const e=document.querySelector(q);if(!e)throw Error('Missing palette surface '+q);const s=getComputedStyle(e);return{q,background:paletteRGB(s.backgroundColor),text:paletteRGB(s.color),blur:s.backdropFilter,border:s.borderColor,shadow:s.boxShadow};};
    })()`);
    for(const theme of ['light','dark','oled']){
        await evaluate(`applyTheme(${JSON.stringify(theme)});renderNotebookList();`);await wait(450);
        const state=await evaluate(`(()=>{const r=PageThumbnails.records.get('palette-page-0'),cached=getCanvasThemePalette();redrawCanvas(true);return{roles:Object.fromEntries(['surround','shelf','paper','surface','field','text','secondary','muted','accent','accent-soft'].map(role=>[role,paletteToken('--ui-'+role)])),surfaces:['.floating-toolbar','#recycleBinBtn','#toolboxBtn','.digital-clock','.panel-toggle-btn','#brushSizePanel','#geometryPanel','#settingsModal .modal','#newNotebookModal .modal','#recycleBinModal .modal'].map(paletteStyle),preset:paletteStyle('.brush-size-preset[aria-pressed="true"]'),shelves:['#sidebar','#pageNav'].map(paletteStyle),preview:[...r.canvas.getContext('2d').getImageData(3,3,1,1).data].slice(0,3),main:[...ctx.getImageData(Math.round((panX+20*zoom)*baseDPR),Math.round((panY+20*zoom)*baseDPR),1,1).data].slice(0,3),surround:[...ctx.getImageData(Math.round((panX-40)*baseDPR),Math.round((panY-40)*baseDPR),1,1).data].slice(0,3),cached:cached===getCanvasThemePalette(),outline:getComputedStyle(r.paper).outlineWidth,ink:strokes.map(s=>s.color),resolvedInk:strokes.map(s=>getThemedColor(s.color)),aliases:paletteToken('--bg-secondary'),primary:paletteRGB(getComputedStyle(document.getElementById('saveSettingsBtn')).color)};})()`);
        for(const [role,color]of Object.entries(expected[theme]))assert.deepEqual(state.roles[role],color);
        state.surfaces.forEach(s=>{assert.deepEqual(s.background,expected[theme].surface,s.q+' must use shared surface');assert.equal(s.blur,'none',s.q+' must stay crisp');});
        state.shelves.forEach(s=>assert.deepEqual(s.background,expected[theme].shelf));assert.deepEqual(state.aliases,expected[theme].surface);
        assert.deepEqual(state.preset.background,state.roles['accent-soft']);assert.deepEqual(state.preset.text,state.roles.accent);
        assert.deepEqual(state.main,expected[theme].paper);assert.deepEqual(state.preview,state.main);assert.deepEqual(state.surround,expected[theme].surround);assert(state.cached,'Zoom redraw must reuse the cached palette');
        assert.deepEqual(state.ink,['#ffffff','#ff6b6b','#4d96ff','#6bcb77']);assert.deepEqual(state.resolvedInk,[theme==='light'?'#000000':'#ffffff','#ff6b6b','#4d96ff','#6bcb77']);assert.deepEqual(state.primary,[255,255,255]);
        const ratios={};for(const text of ['text','secondary','muted'])for(const surface of ['surface','shelf']){const key=text+' / '+surface;ratios[key]=contrast(state.roles[text],state.roles[surface]);assert(ratios[key]>=4.5,JSON.stringify({theme,key,ratio:ratios[key]}));}
        ratios.accent=contrast(state.roles.accent,state.roles['accent-soft']);assert(ratios.accent>=4.5);
        if(theme==='oled')assert(parseFloat(state.outline)>0);else{assert.equal(state.outline,'0px');assert(luminance(state.roles.paper)>luminance(state.roles.shelf));assert(luminance(state.roles.shelf)>luminance(state.roles.surround));}
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:700,y:100,button:'none',buttons:0});
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-palette-'+theme+'.png',Buffer.from(shot.data,'base64'));
        await evaluate('BrushSizeWorkbench.open()');await wait(250);const panel=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-palette-brush-'+theme+'.png',Buffer.from(panel.data,'base64'));await evaluate('BrushSizeWorkbench.close()');
        await evaluate('openSettingsModal()');await wait(250);const settings=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-palette-settings-'+theme+'.png',Buffer.from(settings.data,'base64'));await evaluate('closeSettingsModal()');
        reports.push({theme,roles:state.roles,ratios,sharedSurface:true,exactPaper:true,cachedPalette:true,inkUnchanged:true});
    }
    console.log(JSON.stringify({passed:true,reports}));
}finally{
    await evaluate(`BrushSizeWorkbench.close();closeSettingsModal();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
