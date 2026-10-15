// Real Chromium material/contrast QA over both white and black backdrops.
// Only preferences and disposable DOM fixtures change; no document writes.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const lum=rgb=>rgb.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
let originalStorage;const reports=[];
try {
    await evaluate('closeSettingsModal();saveCurrentPage()');
    originalStorage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Page.reload',{ignoreCache:true});await wait(1600);
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};
        const original=fetch;fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Material tests cannot write notes');return original(url,options);};
        API.put=API.post=API.delete=async()=>{throw Error('Material tests cannot write notes');};
        window.materialData=JSON.stringify({book:currentNotebook.id,pages});
        const plate=document.createElement('div');plate.id='material-test';plate.style='position:fixed;left:400px;top:220px;width:500px;height:64px;z-index:100000;pointer-events:none;background:linear-gradient(to right,#fff 50%,#000 50%);';
        for(const left of [10,270]){const glass=document.createElement('div');glass.className='floating-toolbar';glass.style='position:absolute;left:'+left+'px;top:2px;bottom:auto;width:220px;height:60px;min-width:0;transform:none;padding:0;transition:none;';plate.append(glass);}
        document.body.append(plate);
        window.materialRGB=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return[...x.getImageData(0,0,1,1).data].slice(0,3);};
    })()`);
    for(const mode of ['light','dark','oled'])for(const tone of ['iris','rose','lagoon','ocean','sage','amber']) {
        await evaluate(`AppearanceSettings.selectMode('${mode}');AppearanceSettings.selectAccent('${tone}');`);await wait(100);
        const shot=await call('Page.captureScreenshot',{format:'png',clip:{x:400,y:220,width:500,height:64,scale:1}});
        const pixels=await evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${shot.data}';await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);const sample=(px,py)=>[...x.getImageData(Math.round(px*c.width/500),Math.round(py*c.height/64),1,1).data].slice(0,3);const s=getComputedStyle(document.documentElement);return{white:sample(120,32),black:sample(380,32),top:sample(120,6),text:materialRGB(s.getPropertyValue('--ui-text')),muted:materialRGB(s.getPropertyValue('--ui-muted'))};})()`);
        const ratios=['white','black'].map(bg=>({bg,text:contrast(pixels.text,pixels[bg]),muted:contrast(pixels.muted,pixels[bg])}));
        assert(ratios.every(r=>r.text>=4.5),JSON.stringify({mode,tone,pixels,ratios}));
        assert(pixels.white.some((n,i)=>n!==pixels.black[i]),'The frosting must sample the real backdrop');
        assert(pixels.top.every((n,i)=>Math.abs(n-pixels.white[i])<=1),'No simulated edge lighting or shading: '+JSON.stringify({mode,tone,pixels}));
        reports.push({mode,tone,ratios});
    }
    // Prove real blur, not just a translucent fill: identical striped content
    // appears behind a frosted dock and an unfiltered control of that dock.
    await evaluate(`(()=>{const plate=document.getElementById('material-test');plate.style.background='repeating-linear-gradient(90deg,#fff 0 8px,#000 8px 16px)';plate.lastElementChild.style.setProperty('backdrop-filter','none','important');plate.lastElementChild.style.setProperty('-webkit-backdrop-filter','none','important');})()`);await wait(150);
    const blurShot=await call('Page.captureScreenshot',{format:'png',clip:{x:400,y:220,width:500,height:64,scale:1}});
    const blurProof=await evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${blurShot.data}';await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);const span=offset=>{const values=[];for(let n=60;n<170;n++){const p=x.getImageData(Math.round((offset+n)*c.width/500),Math.round(32*c.height/64),1,1).data;values.push((p[0]+p[1]+p[2])/3);}return Math.max(...values)-Math.min(...values);};return{blurred:span(0),unfiltered:span(260)};})()`);
    assert(blurProof.unfiltered>25&&blurProof.blurred<blurProof.unfiltered*.3,JSON.stringify(blurProof));
    await evaluate(`document.getElementById('material-test').remove();`);
    await evaluate(`(()=>{if(!document.querySelector('.toolbox-drawer')){const probe=document.createElement('div');probe.className='toolbox-drawer';probe.hidden=true;document.body.append(probe);}})()`);
    const structure=await evaluate(`(()=>{
        const style=q=>getComputedStyle(document.querySelector(q));
        const canvas=document.getElementById('canvas')||document.querySelector('#canvasContainer canvas'),ancestors=[];for(let e=canvas;e;e=e.parentElement)ancestors.push({tag:e.tagName,filter:getComputedStyle(e).filter,backdrop:getComputedStyle(e).backdropFilter});
        return{dockRadius:style('#floatingToolbar').borderRadius,dockBlur:style('#floatingToolbar').backdropFilter,clockBlur:style('#digitalClock').backdropFilter,clockFill:style('#digitalClock').backgroundColor,dockFill:style('#floatingToolbar').backgroundColor,circles:['#recycleBinBtn','#toolboxBtn'].map(q=>style(q).borderRadius),circleBlur:['#recycleBinBtn','#toolboxBtn'].map(q=>style(q).backdropFilter),circleFill:['#recycleBinBtn','#toolboxBtn'].map(q=>style(q).backgroundColor),labels:['.zoom-value','.brush-size-label','.top-clock-date'].map(q=>style(q).color),primary:style('#floatingToolbar').getPropertyValue('--ui-text').trim(),menus:['#settingsModalContent','.trash-dialog','.toolbox-drawer','.eraser-modes'].map(q=>({q,blur:style(q).backdropFilter,gradient:style(q).backgroundImage})),shelves:['#sidebar','#pageNav'].map(q=>({blur:style(q).backdropFilter,gradient:style(q).backgroundImage,shadow:style(q).boxShadow})),paper:style('.page-paper').backdropFilter,ancestors,add:['#newNotebookBtn','#addPageBtn'].map(q=>style(q).boxShadow),dataUnchanged:JSON.stringify({book:currentNotebook.id,pages})===materialData};
    })()`);
    assert.equal(structure.dockRadius,'9999px');assert.equal(structure.dockBlur,'blur(16px)');assert(structure.circles.every(r=>r==='50%'));
    assert.equal(structure.clockBlur,structure.dockBlur);assert.equal(structure.clockFill,structure.dockFill);
    assert(structure.circleBlur.every(b=>b===structure.dockBlur));assert(structure.circleFill.every(b=>b===structure.dockFill));assert(structure.menus.every(s=>s.blur==='blur(12px)'&&s.gradient==='none'));
    assert(await evaluate(`(()=>{const root=getComputedStyle(document.documentElement),primary=materialRGB(root.getPropertyValue('--ui-text'));return['.zoom-value','.brush-size-label','.top-clock-date'].every(q=>materialRGB(getComputedStyle(document.querySelector(q)).color).every((n,i)=>Math.abs(n-primary[i])<=1));})()`),'Pill labels use the tested high-contrast primary ink');
    assert(structure.shelves.every(s=>s.blur==='blur(8px)'&&s.gradient==='none'&&!s.shadow.includes('inset')));assert.equal(structure.paper,'none');assert(structure.ancestors.every(s=>s.filter==='none'&&s.backdrop==='none'));assert(structure.add.every(s=>s==='none'));assert(structure.dataUnchanged);
    // Reduced transparency retains depth and palette but turns frosting off.
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('floatingToolbar')).backdropFilter`),'none');
    await call('Emulation.setEmulatedMedia',{features:[]});
    for(const mode of ['light','dark','oled']) {
        await evaluate(`AppearanceSettings.selectMode('${mode}');AppearanceSettings.selectAccent('iris');`);await wait(150);
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-depth-'+mode+'.png',Buffer.from(shot.data,'base64'));
    }
    console.log(JSON.stringify({passed:true,structure,blurProof,contrast:reports}));
} finally {
    await call('Emulation.setEmulatedMedia',{features:[]});
    if(originalStorage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(originalStorage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1600);ws.close();
}
