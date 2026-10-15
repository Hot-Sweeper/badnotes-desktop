// Real Electron UI: preview fidelity, persistence, accessibility and native
// touch. Document writes are blocked; original preferences restored in finally.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0,touchActive=false,emulated=false;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}).catch(e=>{throw Error(e.message+' in '+expression.slice(0,120));});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async()=>{for(let i=0;i<60;i++){if(await evaluate('!!(window.AppearanceSettings && typeof currentNotebook!=="undefined" && currentNotebook && pages.length && typeof closeSettingsModal==="function")'))return;await wait(100);}throw Error('App not ready');};
const reload=async()=>{await call('Page.reload',{ignoreCache:true});await wait(1000);await ready();};
const isolate=()=>evaluate(`(()=>{
    saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
    const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Appearance tests cannot write notes');return originalFetch(url,options);};
    for(const method of ['put','post','delete'])API[method]=async()=>{throw Error('Appearance tests cannot write notes');};
    window.appearanceData=JSON.stringify({book:currentNotebook.id,books:notebooks.map(n=>[n.id,n.color,n.icon]),pages});
    window.appearancePalette=JSON.stringify(customPalette);
    window.appearanceRGB=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return[...x.getImageData(0,0,1,1).data].slice(0,3);};
    window.appearanceToken=key=>appearanceRGB(getComputedStyle(document.documentElement).getPropertyValue(key).trim());
})()`);
const lum=rgb=>rgb.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const expected={light:{paper:[255,255,255],surround:[228,225,235],shelf:[240,237,245],surface:[251,250,255]},dark:{paper:[39,36,46],surround:[17,16,22],shelf:[27,25,34],surface:[48,44,58]},oled:{paper:[0,0,0],surround:[0,0,0],shelf:[13,11,17],surface:[25,21,31]}};
let originalStorage;const reports=[];
try {
    await ready();await evaluate('closeSettingsModal();saveCurrentPage()');
    originalStorage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await reload();await isolate();await evaluate('openSettingsModal()');
    assert.deepEqual(await evaluate('[document.getElementById("accentChoicesLabel").textContent,document.getElementById("saveSettingsBtn").textContent,document.querySelector(".settings-live-status").textContent]'),['Interface tone','Done','Changes save automatically']);
    assert.deepEqual(await evaluate(`[document.querySelectorAll('.theme-choice').length,document.querySelectorAll('.accent-choice').length]`),[3,6]);
    for(const mode of ['light','dark','oled']) {
        for(const accent of ['iris','rose','lagoon','ocean','sage','amber']) {
            await evaluate(`(()=>{AppearanceSettings.selectMode('${mode}');AppearanceSettings.selectAccent('${accent}');const record=PageThumbnails.records.get(pages[currentPageIndex]?.id);if(record&&!record.visible){record.visible=true;PageThumbnails.refreshAppearance();}})()`);await wait(350);
            const state=await evaluate(`(()=>{
                const root=getComputedStyle(document.documentElement),cached=getCanvasThemePalette(),button=document.querySelector('.theme-choice[aria-checked="true"]');
                const mini=getComputedStyle(button.querySelector('.appearance-mini'));
                const oldCamera=[panX,panY];panX=panY=150;redrawCanvas(true);const surround=[...ctx.getImageData(Math.round(40*baseDPR),Math.round(40*baseDPR),1,1).data].slice(0,3);[panX,panY]=oldCamera;redrawCanvas(true);
                const thumbnail=PageThumbnails.records.get(pages[currentPageIndex]?.id),previewPaper=thumbnail&&[...thumbnail.canvas.getContext('2d').getImageData(3,3,1,1).data].slice(0,3);
                return{mode:settings.theme,accent:settings.accentTheme,hidden:document.getElementById('settingsTheme').value,stored:JSON.parse(localStorage.getItem('badnotes_settings')),savedTheme:localStorage.getItem('badnotes-theme'),surround,previewPaper,
                    surfaces:['.floating-toolbar','#sidebar','#pageNav','#settingsModalContent'].map(q=>({q,color:appearanceRGB(getComputedStyle(document.querySelector(q)).backgroundColor)})),
                    roles:Object.fromEntries(['paper','surround','shelf','surface','accent','accent-soft','action-solid','text','muted'].map(k=>[k,appearanceToken('--ui-'+k)])),
                    preview:Object.fromEntries(['paper','surround','shelf','surface','accent','soft'].map(k=>[k,appearanceRGB(mini.getPropertyValue('--preview-'+k))])),
                    checked:[document.querySelectorAll('.theme-choice[aria-checked="true"]').length,document.querySelectorAll('.accent-choice[aria-checked="true"]').length],
                    stops:[document.querySelectorAll('.theme-choice[tabindex="0"]').length,document.querySelectorAll('.accent-choice[tabindex="0"]').length],
                    colorUnchanged:JSON.stringify(customPalette)===appearancePalette,dataUnchanged:JSON.stringify({book:currentNotebook.id,books:notebooks.map(n=>[n.id,n.color,n.icon]),pages})===appearanceData,
                    brand:root.getPropertyValue('--brand-purple').trim(),cached:cached===getCanvasThemePalette(),bounds:button.getBoundingClientRect().height};
            })()`);
            assert.equal(state.mode,mode);assert.equal(state.accent,accent);assert.equal(state.hidden,mode);assert.equal(state.stored.theme,mode);assert.equal(state.savedTheme,mode);assert.equal(state.stored.accentTheme,accent);
            assert.deepEqual(state.checked,[1,1]);assert.deepEqual(state.stops,[1,1]);assert(state.dataUnchanged);assert(state.colorUnchanged);assert(state.cached);assert.equal(state.brand,'#7640fd');assert(state.bounds>=44);
            for(const [key,value]of Object.entries(expected[mode])){if(accent==='iris'||key==='paper'&&mode!=='dark')assert.deepEqual(state.roles[key],value);assert.deepEqual(state.preview[key],state.roles[key]);}
            // The generated colors preserve linear luminance exactly; the
            // native 8-bit pixel readback introduces a small rounding error.
            for(const [key,value]of Object.entries(expected[mode]))assert(Math.abs(lum(state.roles[key])-lum(value))<(mode==='light'?.004:.001),JSON.stringify({mode,accent,key,error:Math.abs(lum(state.roles[key])-lum(value))}));
            assert.deepEqual(state.previewPaper,state.roles.paper,'Thumbnail paper matches the live paper token');
            assert.deepEqual(state.preview.accent,state.roles.accent);assert.deepEqual(state.preview.soft,state.roles['accent-soft']);
            assert.deepEqual(state.surround,state.roles.surround,'Live canvas surround follows the tone');
            // Frosted chrome retains its semantic base color. Native alpha
            // unpremultiplication can round a channel by one 8-bit step.
            for(const surface of state.surfaces){const target=state.roles[surface.q==='#sidebar'||surface.q==='#pageNav'?'shelf':'surface'];assert(surface.color.every((n,i)=>Math.abs(n-target[i])<=1),surface.q+' follows tone');}
            const ratios={accent:contrast(state.roles.accent,state.roles['accent-soft']),solid:contrast([255,255,255],state.roles['action-solid']),text:contrast(state.roles.text,state.roles.surface),muted:contrast(state.roles.muted,state.roles.surface)};
            for(const [key,ratio]of Object.entries(ratios))assert(ratio>=4.5,JSON.stringify({mode,accent,key,ratio}));
            reports.push({mode,accent,ratios});
        }
        await evaluate(`AppearanceSettings.selectAccent('iris');`);await wait(200);
        const rect=await evaluate(`(()=>{const r=document.getElementById('settingsModalContent').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()`);
        const shot=await call('Page.captureScreenshot',{format:'png',clip:{...rect,scale:1.5}});await writeFile('/tmp/badnotes-appearance-'+mode+'.png',Buffer.from(shot.data,'base64'));
    }
    await evaluate(`AppearanceSettings.selectAccent('lagoon')`);await wait(220);
    const accentShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-appearance-lagoon.png',Buffer.from(accentShot.data,'base64'));
    // Keep all theme cards visible and comfortable accent targets in a narrow
    // desktop window. Restore metrics before testing physical pointer mapping.
    await call('Emulation.setDeviceMetricsOverride',{width:400,height:850,deviceScaleFactor:1,mobile:false});emulated=true;await wait(220);
    const narrow=await evaluate(`(()=>{const group=document.getElementById('accentChoices'),body=document.querySelector('#settingsModal .modal-body');return{bodyOverflow:body.scrollWidth-body.clientWidth,columns:getComputedStyle(group).gridTemplateColumns.split(' ').length,overflow:[...document.querySelectorAll('.theme-choice,.accent-choice')].map(b=>b.scrollWidth-b.clientWidth),targets:[...document.querySelectorAll('.accent-choice')].map(b=>({height:b.getBoundingClientRect().height,min:getComputedStyle(b).minHeight}))};})()`);
    assert.equal(narrow.columns,2);assert(narrow.bodyOverflow<=1);assert(narrow.overflow.every(n=>n<=1),JSON.stringify(narrow));assert(narrow.targets.every(n=>n.height>=43.5&&n.min==='44px'),JSON.stringify(narrow));
    assert(await evaluate(`(()=>{const modal=document.getElementById('settingsModal'),r=document.getElementById('settingsModalContent').getBoundingClientRect();return[...document.querySelectorAll('.panel-toggle-btn')].every(b=>{const q=b.getBoundingClientRect(),x=q.x+q.width/2,y=q.y+q.height/2;return x<r.left||x>r.right||y<r.top||y>r.bottom||modal.contains(document.elementFromPoint(x,y));});})()`),'Shelf arrows must not float above Settings');
    const narrowShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-appearance-narrow.png',Buffer.from(narrowShot.data,'base64'));
    await call('Emulation.clearDeviceMetricsOverride');emulated=false;await wait(220);
    // Tone changes repaint the surround, without re-rasterizing ink or resetting previews.
    await evaluate(`window.appearanceCache=getCanvasThemePalette();window.appearanceRedraws=0;window.appearanceInvalidations=0;window.appearanceOriginalRedraw=redrawCanvas;window.appearanceOriginalInvalidate=window.invalidateStrokeRasterCache;redrawCanvas=()=>appearanceRedraws++;window.invalidateStrokeRasterCache=()=>appearanceInvalidations++;AppearanceSettings.selectAccent('ocean');`);
    assert.deepEqual(await evaluate('[appearanceRedraws,appearanceInvalidations,appearanceCache===getCanvasThemePalette()]'),[1,0,false]);
    await evaluate('redrawCanvas=appearanceOriginalRedraw;window.invalidateStrokeRasterCache=appearanceOriginalInvalidate;');
    await wait(350);
    await evaluate(`window.appearancePreviewSource=PageThumbnails.records.get(pages[currentPageIndex]?.id)?.snapshot?.canvas;AppearanceSettings.selectAccent('sage')`);await wait(350);
    assert(await evaluate(`(()=>{const r=PageThumbnails.records.get(pages[currentPageIndex]?.id);return r.snapshot.canvas===appearancePreviewSource&&!r.dirty&&!r.paperDirty;})()`),'Paper recoloring must reuse the finished ink/image/text layer');
    // Native keyboard radio behavior, including Home/End and no drawing shortcuts.
    await evaluate(`document.querySelector('[data-theme-choice="oled"]').focus();`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home'});
    assert.equal(await evaluate('settings.theme'),'light');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
    assert.equal(await evaluate('settings.theme'),'dark');assert.equal(await evaluate('document.activeElement.dataset.themeChoice'),'dark');
    // Real native finger selection, same rounded contact state as hover.
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:30,y:80,button:'none',buttons:0});await evaluate('document.activeElement.blur()');
    const target=await evaluate(`(()=>{const r=document.querySelector('[data-theme-choice="oled"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:7,...target,radiusX:8,radiusY:8,force:.7}]});touchActive=true;await wait(200);
    assert.deepEqual(await evaluate(`(()=>{const b=document.querySelector('[data-theme-choice="oled"]'),s=getComputedStyle(b);return[b.classList.contains('touch-feedback'),s.cornerShape,s.getPropertyValue('-webkit-tap-highlight-color')];})()`),[true,'superellipse(2)','rgba(0, 0, 0, 0)']);
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});touchActive=false;await wait(220);
    assert.equal(await evaluate('settings.theme'),'oled');assert.equal(await evaluate('document.querySelectorAll(".touch-feedback").length'),0);
    await evaluate(`AppearanceSettings.selectAccent('lagoon');closeSettingsModal();`);
    await reload();await isolate();await evaluate('openSettingsModal()');
    assert.deepEqual(await evaluate('[settings.theme,settings.accentTheme,document.querySelector(".accent-choice[aria-checked=true]").dataset.accentChoice]'),['oled','lagoon','lagoon']);
    // Save/reopen preserves both selections; reset removes custom token overrides.
    await evaluate('saveSettingsFromModal();openSettingsModal()');
    assert.deepEqual(await evaluate('[settings.theme,settings.accentTheme,document.getElementById("settingsTheme").value]'),['oled','lagoon','oled']);
    // Every drawing control and pen binding applies and persists before Done.
    const live=await evaluate(`(()=>{
        const set=(id,value)=>{const c=document.getElementById(id);if(c.type==='checkbox')c.checked=value;else c.value=value;c.dispatchEvent(new Event(c.type==='range'?'input':'change',{bubbles:true}));};
        window.appearanceInvalidations=0;const original=window.invalidateStrokeRasterCache;window.invalidateStrokeRasterCache=()=>appearanceInvalidations++;
        set('smoothnessSlider',145);set('minDistanceSlider',3.5);set('settingsPressureMultiplier',2.1);set('settingsDynamicBrush',true);set('settingsFingerDraw',true);set('settingsCrosshairRotated',true);set('settingsEraserMode','lasso');set('settingsBarrelMode','radial');
        window.invalidateStrokeRasterCache=original;
        return{stored:JSON.parse(localStorage.getItem('badnotes_settings')),smoothness:settings.smoothness,minDistance:settings.minDistance,pressure:settings.pressureMultiplier,dynamic:dynamicBrushEnabled,toolbar:document.getElementById('dynamicBrushToggle').checked,finger:fingerDrawingEnabled,crosshair:settings.crosshairRotated,upper:getEraserButtonMode(),lower:getBarrelButtonMode(),radial:document.getElementById('barrelMenuSection').style.display,invalidations:appearanceInvalidations};
    })()`);
    assert.equal(live.smoothness,145);assert.equal(live.stored.smoothness,145);assert.equal(live.minDistance,3.5);assert.equal(live.pressure,2.1);assert(live.dynamic&&live.toolbar&&live.finger&&live.crosshair);assert.equal(live.upper,'lasso');assert.equal(live.lower,'radial');assert.equal(live.radial,'block');assert.equal(live.invalidations,0);
    await evaluate('closeSettingsModal();openSettingsModal()');assert.deepEqual(await evaluate('[+document.getElementById("smoothnessSlider").value,+document.getElementById("settingsPressureMultiplier").value]'),[145,2.1]);
    await evaluate('resetSettingsToDefault()');
    assert.deepEqual(await evaluate('[settings.theme,settings.accentTheme,document.documentElement.style.getPropertyValue("--ui-accent"),document.querySelector(".theme-choice[aria-checked=true]").dataset.themeChoice]'),['dark','iris','','dark']);
    console.log(JSON.stringify({passed:true,reports,nativeTouch:true,keyboard:true,persistence:true,saveAndReset:true,noToneInkInvalidation:true,live}));
} finally {
    if(emulated)await call('Emulation.clearDeviceMetricsOverride');
    if(touchActive)await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await ready();
    if(originalStorage)await evaluate(`(()=>{const original=${JSON.stringify(originalStorage)};for(const key of Object.keys(localStorage))if(!(key in original))localStorage.removeItem(key);for(const [key,value]of Object.entries(original))localStorage.setItem(key,value);closeSettingsModal();})()`);
    await reload();ws.close();
}
