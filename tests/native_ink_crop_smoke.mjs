// Compare cropped native ink to the original full transparent surface at the
// same texel lattice. Fixtures block writes and restore every preference.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../static/js/modules/03_canvas_core.js',import.meta.url),'utf8');
const start=source.indexOf('        function drawNativeInkSnapshot('),end=source.indexOf('        function primeNativeInkSnapshot(',start);
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes'),ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));let storage;
try {
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('No crop fixture writes');return original(url,o);};API.put=API.post=async()=>{throw Error('No crop fixture writes');};currentNotebook=null;clearLassoSelection();images=[];HandwrittenTextField.setTextFields([]);SimpleTextField.setTextFields([]);isResizeReady=isPageResizing=false;
        strokes=[{tool:'pen',color:'#ff4455',size:2,points:[{x:-20,y:30},{x:60,y:10},{x:25,y:100},{x:100,y:75}]},
        {tool:'pen',color:'#4499ff',size:3,points:[{x:15,y:25,size:2},{x:20,y:90,size:12},{x:140,y:50,size:5}]},
        {tool:'pen',isGeometric:true,geometryCurve:true,color:'#55bb77',size:2,points:[{x:110,y:10},{x:80,y:90},{x:30,y:40},{x:110,y:10}]},
        {tool:'line',isShape:true,color:'#dd77ff',size:4,points:[{x:-40,y:20},{x:155,y:110}]},
        {tool:'circle',isShape:true,color:'#ffaa22',size:2,points:[{x:65,y:70},{x:92,y:80}]},
        {tool:'pen',isFill:true,color:'#ffcc33',points:[{x:0,y:20},{x:20,y:10},{x:15,y:40}]}];
        dynamicBrushEnabled=true;invalidateStrokeCache(true);window.parityTarget=null;
    })()`);
    await evaluate('window.croppedNative='+source.slice(start,end).trim().replace(/\bctx\b/g,'parityTarget')+';');
    // Independent reference: the previous full padded surface, same sampling
    // density, ordering, camera and mip filter (not a differently rasterized vector).
    await evaluate(`window.fullNative=function(view,cameraX,cameraY,shiftX,shiftY){
        const padding=320/zoom,x=view.x-padding,y=view.y-padding,w=view.w+padding*2,h=view.h+padding*2,density=zoom*1.75,sampling=density*baseDPR;
        const surface=document.createElement('canvas');surface.width=Math.ceil(w*sampling/64)*64;surface.height=Math.ceil(h*sampling/64)*64;const c=surface.getContext('2d');c.setTransform(sampling,0,0,sampling,-x*sampling,-y*sampling);
        const region={x,y,w,h};for(const stroke of strokes)if(stroke.isFill||stroke.type==='fill')drawStrokeToContext(stroke,c);drawVectorStrokeCommands(region,c);
        const ratio=zoom/density,sample=getInkSamplingLevel(surface,ratio);parityTarget.save();parityTarget.imageSmoothingEnabled=true;parityTarget.imageSmoothingQuality=sample.filtered?'high':'low';parityTarget.setTransform(ratio,0,0,ratio,(cameraX+(x+shiftX)*zoom)*baseDPR,(cameraY+(y+shiftY)*zoom)*baseDPR);
        const sx=Math.max(0,(view.x-x)*sampling),sy=Math.max(0,(view.y-y)*sampling),sw=Math.min(surface.width-sx,view.w*sampling),sh=Math.min(surface.height-sy,view.h*sampling);
        parityTarget.drawImage(sample.surface,sx*sample.x,sy*sample.y,sw*sample.x,sh*sample.y,sx,sy,sw,sh);parityTarget.restore();invalidateBitmapSampling(surface);surface.width=surface.height=0;
    };`);
    const parity=await evaluate(`(()=>{const results=[];
        for(const z of [.2,.7,2,5])for(const theme of ['light','dark','oled']){
            settings.theme=theme;isDarkMode=theme!=='light';_setZoomInternal(z);releaseNativeInkSnapshot();const w=900,h=600,x=130.23,y=95.37,view={x:-x/zoom,y:-y/zoom,w:w/zoom,h:h/zoom};
            const surfaces=[document.createElement('canvas'),document.createElement('canvas')];for(const c of surfaces){c.width=Math.ceil(w*baseDPR);c.height=Math.ceil(h*baseDPR);}
            parityTarget=surfaces[0].getContext('2d');fullNative(view,x,y,0,0);parityTarget=surfaces[1].getContext('2d');croppedNative(view,x,y,0,0);
            const a=surfaces[0].getContext('2d').getImageData(0,0,surfaces[0].width,surfaces[0].height).data,b=surfaces[1].getContext('2d').getImageData(0,0,surfaces[1].width,surfaces[1].height).data;let changed=0,maxDelta=0,alphaError=0,alphaEnergy=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));if(i%4===3){alphaError+=Math.abs(a[i]-b[i]);alphaEnergy+=a[i];}}
            results.push({zoom:z,theme,changed,maxDelta,alphaError:alphaError/Math.max(1,alphaEnergy),nativePixels:nativeInkSnapshot.surface.width*nativeInkSnapshot.surface.height,complete:nativeInkSnapshot.completeInk});for(const c of surfaces)c.width=c.height=0;
        }
        // Moving through transparent coverage must not rebuild or invent ink.
        const old=nativeInkSnapshot;const c=document.createElement('canvas');c.width=400;c.height=300;parityTarget=c.getContext('2d');croppedNative({x:2000,y:2000,w:100,h:100},-10000,-10000,0,0);const empty=c.getContext('2d').getImageData(0,0,400,300).data.every(v=>v===0);c.width=c.height=0;
        const reused=nativeInkSnapshot===old;
        const added={tool:'pen',color:'#ffffff',size:3,points:[{x:800,y:800},{x:810,y:810}]};strokes.push(added);const appended=appendStrokeToCache(added);return{results,empty,reused,appended,newOutsideSnapshotInvalidated:nativeInkSnapshot===null};
    })()`);
    assert(parity.results.every(r=>r.alphaError<.002),'Native crop must preserve visible ink coverage: '+JSON.stringify(parity));assert(parity.empty&&parity.reused,'Empty world space reuses complete ink without a blit');assert(parity.appended&&parity.newOutsideSnapshotInvalidated,'An appended stroke outside cropped pixels must invalidate, never disappear');
    await evaluate(`(()=>{strokes=Array.from({length:64},(_,i)=>{const x=100+i%16*95,y=100+Math.floor(i/16)*110;return{id:'subset-'+i,tool:'pen',color:'#ff4466',size:2,points:[{x,y},{x:x+20,y:y-20},{x:x+45,y:y+25},{x:x+65,y:y+5}]};});invalidateStrokeCache(true);startVectorStrokeCommandBuild();window.untrimmedVector=eval('('+drawVectorStrokeCommands.toString().replace('if (visibleMembers.length<command.members.length)','if (false)')+')');})();`);
    for(let i=0;i<100&&!await evaluate('!!vectorStrokeCommandsCache?.commands');i++)await wait(20);
    const subsets=await evaluate(`(()=>{const results=[];for(const z of [.5,1,2])for(const theme of ['light','dark']){
        settings.theme=theme;isDarkMode=theme!=='light';const width=Math.ceil(600*baseDPR),height=Math.ceil(500*baseDPR),view={x:270,y:60,w:600/z,h:500/z};const surfaces=[document.createElement('canvas'),document.createElement('canvas')];for(let i=0;i<2;i++){const c=surfaces[i];c.width=width;c.height=height;const context=c.getContext('2d');context.setTransform(z*baseDPR,0,0,z*baseDPR,-view.x*z*baseDPR+.23,-view.y*z*baseDPR+.37);(i?drawVectorStrokeCommands:untrimmedVector)(view,context);}
        const a=surfaces[0].getContext('2d').getImageData(0,0,width,height).data,b=surfaces[1].getContext('2d').getImageData(0,0,width,height).data;let changed=0,error=0,energy=0,maxAlphaDelta=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;if(i%4===3){error+=Math.abs(a[i]-b[i]);energy+=a[i];maxAlphaDelta=Math.max(maxAlphaDelta,Math.abs(a[i]-b[i]));}}results.push({zoom:z,theme,changed,alphaError:error/Math.max(1,energy),maxAlphaDelta});for(const c of surfaces)c.width=c.height=0;
    }return results;})()`);
    assert(subsets.every(r=>r.alphaError<.002),'Subsetting must not change visible merged ink: '+JSON.stringify(subsets));
    console.log(JSON.stringify({passed:true,...parity,subsets}));
} finally {
    await evaluate('isPinching=false;endGesturePreview(false,false);ViewLimits.cancel()').catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
