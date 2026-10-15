// Real renderer/font checks; all document writes disabled during fixtures.
import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));let theme;
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    theme=await evaluate('settings.theme');
    for(let i=0;i<50&&!await evaluate('HandwrittenTextField.hasFontData()');i++)await wait(100);
    assert(await evaluate('HandwrittenTextField.hasFontData()'));
    // The native gutter does not change width as its color fades.
    await evaluate(`(()=>{window.scrollProbe=document.createElement('div');scrollProbe.style.cssText='position:fixed;left:400px;top:150px;width:150px;height:200px;overflow:auto;z-index:99999;background:var(--app-shelf)';const filler=document.createElement('div');filler.style.height='2000px';scrollProbe.append(filler);document.body.append(scrollProbe);scrollProbe.scrollTop=1;})()`);
    await wait(400);
    const state=()=>evaluate(`({alpha:+getComputedStyle(scrollProbe).getPropertyValue('--scrollbar-visibility'),color:getComputedStyle(scrollProbe).scrollbarColor,width:scrollProbe.clientWidth,top:scrollProbe.scrollTop})`);
    const shown=await state();assert.equal(shown.alpha,1);
    await evaluate('scrollProbe.scrollTop=50');await wait(1280);const fading=await state();assert(fading.alpha>0&&fading.alpha<1,JSON.stringify(fading));
    await wait(400);const hidden=await state();assert.equal(hidden.alpha,0);assert.equal(hidden.width,shown.width);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:548,y:180});await wait(380);const hovered=await state();assert.equal(hovered.alpha,1);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:420,y:180});await wait(1650);assert.equal((await state()).alpha,0);
    await evaluate(`(()=>{scrollProbe.remove();saveCurrentPage=async()=>{};triggerAutoSave=()=>{};currentNotebook=null;API.put=API.post=async()=>{throw Error('No fixture writes');};const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('No fixture writes');return original(url,o);};clearLassoSelection();images=[];strokes=[];SimpleTextField.setTextFields([]);HandwrittenTextField.setTextFields([]);})()`);
    const bitmap=await evaluate(`(()=>{
        const source=document.createElement('canvas');source.width=source.height=1024;const c=source.getContext('2d');c.fillStyle='#fff';for(let y=0;y<1024;y+=2)for(let x=0;x<1024;x+=2)c.fillRect(x,y,1,1);
        const output=document.createElement('canvas');output.width=output.height=64;const ctx=output.getContext('2d');drawFilteredBitmap(ctx,source,0,0,64,64);
        const pixels=ctx.getImageData(0,0,64,64).data,alphas=Array.from(pixels).filter((v,i)=>i%4===3),a=getInkSamplingLevel(source,.0625,source).surface;strokeCacheVersion++;const b=getInkSamplingLevel(source,.0625,source).surface;
        return{min:Math.min(...alphas),max:Math.max(...alphas),independent:a===b};
    })()`);assert(bitmap.min>=63&&bitmap.max<=65&&bitmap.independent,JSON.stringify(bitmap));
    const handwriting=await evaluate(`(()=>{
        const output=document.createElement('canvas');output.width=1200;output.height=900;const c=output.getContext('2d');
        HandwrittenTextField.setTextFields([{id:'bitmap-font',x:20,y:20,width:350,fontSize:60,autoWidth:false,text:'Mathe Kurs 123456789',color:'#fff'}]);c.setTransform(3,0,0,3,0,0);HandwrittenTextField.draw(c);
        const f=HandwrittenTextField.getTextFields()[0],source=f.cacheCanvas,scale=f.cacheScale,hash=f.lastHash,size=[source.width,source.height],sample=getInkSamplingLevel(source,.05,source).surface;
        let stable=true;const costs=[];for(const density of [2,1.4,1,.7,.5,.3,.12,.05,.12,.3,.5,.7,1,1.4,2]){c.setTransform(density,0,0,density,0,0);const start=performance.now();HandwrittenTextField.draw(c);costs.push(performance.now()-start);stable&&=f.cacheCanvas===source&&f.lastHash===hash&&f.cacheScale===scale&&source.width===size[0]&&source.height===size[1];}
        f.text+=' 0';HandwrittenTextField.draw(c);const updated=getInkSamplingLevel(source,.05,source).surface!==sample;
        return{stable,updated,size,scale,peakMs:Math.max(...costs),cursorPositions:f.cursorMap.length,nonPersisted:!Object.keys(f).includes('cacheMaxScale')};
    })()`);assert(handwriting.stable&&handwriting.updated&&handwriting.nonPersisted,JSON.stringify(handwriting));assert(handwriting.cursorPositions>10);
    const sharp=await evaluate(`(()=>{
        const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=1200;a.height=b.height=300;
        const f={id:'wide-font',x:10,y:10,width:12000,fontSize:80,autoWidth:false,text:'Mathe Kurs 123456789 '.repeat(30),color:'#fff'};
        HandwrittenTextField.setTextFields([f]);const ca=a.getContext('2d'),cb=b.getContext('2d');ca.scale(1.4,1.4);cb.scale(1.4,1.4);const start=performance.now();HandwrittenTextField.draw(ca);const ms=performance.now()-start;HandwrittenTextField.drawPreview(cb,HandwrittenTextField.getTextFields());
        const aa=ca.getImageData(0,0,1200,300).data,bb=cb.getImageData(0,0,1200,300).data;let error=0,energy=0;for(let i=3;i<aa.length;i+=4){error+=Math.abs(aa[i]-bb[i]);energy+=aa[i];}return{error,energy,ms,scale:HandwrittenTextField.getTextFields()[0].cacheScale};
    })()`);assert(sharp.energy>1000&&sharp.error===0&&sharp.scale<1.4,JSON.stringify(sharp));
    // Inverted and quarter-turned image preview must equal the main renderer.
    await evaluate(`(async()=>{
        HandwrittenTextField.setTextFields([]);const source=document.createElement('canvas');source.width=600;source.height=320;const c=source.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,600,320);c.fillStyle='#000';c.fillRect(0,0,300,320);c.fillStyle='#f00';c.fillRect(350,30,180,70);
        const url=source.toDataURL(),img=new Image();img.src=url;await img.decode();window.previewImage=img;
        const page={id:'bitmap-page',width:700,height:900,template:'blank',strokes:[],images:[{id:'bitmap-image',x:200,y:220,width:300,height:160,rotation:Math.PI/2,inverted:true,dataUrl:url}],textFields:[],handwrittenTextFields:[]};
        currentNotebook={id:'bitmap-fixture',name:'Bitmap fixture',template:'blank',pages:[page.id]};pages=[page];currentPageIndex=0;baseWidth=page.width;baseHeight=page.height;currentPageTemplate='blank';images=page.images;imageCache.set('bitmap-image',img);renderPageList();document.getElementById('pageList').scrollTop=0;
    })()`);
    const previews=[];
    for(const mode of ['dark','oled','light']){
        await evaluate(`applyTheme(${JSON.stringify(mode)});PageThumbnails.dirty('bitmap-page')`);await wait(600);
        const preview=await evaluate(`(()=>{const record=PageThumbnails.records.get('bitmap-page'),actual=record.canvas,c=document.createElement('canvas');c.width=actual.width;c.height=actual.height;const ctx=c.getContext('2d'),s=c.width/700;ctx.scale(s,s);ctx.fillStyle=getCanvasThemePalette().paper;ctx.fillRect(0,0,700,900);ctx.translate(350,300);ctx.rotate(Math.PI/2);ctx.filter=isDarkMode?'invert(1)':'none';drawFilteredBitmap(ctx,previewImage,-150,-80,300,160);const a=actual.getContext('2d').getImageData(0,0,c.width,c.height).data,b=ctx.getImageData(0,0,c.width,c.height).data;let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i]);return{meanError:error/a.length,resolution:actual.width};})()`);
        assert(preview.meanError<.3,JSON.stringify({mode,...preview}));previews.push({mode,...preview});
    }
    console.log(JSON.stringify({passed:true,scrollbar:{shown,fading,hidden,hovered},bitmap,handwriting,sharp,previews}));
}finally{
    if(theme)await evaluate(`applyTheme(${JSON.stringify(theme)})`).catch(()=>{});
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
