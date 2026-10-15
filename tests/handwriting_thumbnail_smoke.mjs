import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),15000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let originalTheme,originalStorage;
try{
    await evaluate('saveCurrentPage()');originalStorage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');await call('Page.reload',{ignoreCache:true});await wait(1800);
    for(let i=0;i<50;i++){if(await evaluate('HandwrittenTextField.hasFontData()'))break;await wait(100);}
    assert(await evaluate('HandwrittenTextField.hasFontData()'),'The real handwritten font has loaded');
    originalTheme=await evaluate('settings.theme');
    const source=await evaluate(`(async()=>{for(const book of [...notebooks].sort((a,b)=>(b.name==='Mathe Kurs')-(a.name==='Mathe Kurs'))){const data=await API.get('/api/notebooks/'+book.id);const page=data.pages.find(p=>p.handwrittenTextFields?.length);if(!page)continue;window.previewSource=structuredClone(page);return{fields:page.handwrittenTextFields.length,chars:page.handwrittenTextFields.reduce((sum,f)=>sum+f.text.length,0)};}throw Error('No saved handwriting fixture found');})()`);assert(source.fields&&source.chars);
    await evaluate(`(()=>{saveCurrentPage=async()=>{};triggerAutoSave=()=>{PageThumbnails.dirty();};currentNotebook=null;const originalFetch=fetch;window.fetch=(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('Preview tests must not write real notes');return originalFetch(url,options);};})()`);
    const parity=[];
    for(const theme of ['dark','light'])for(const zoomLevel of [.3,7]){
        const result=await evaluate(`(()=>{
            applyTheme(${JSON.stringify(theme)});_setZoomInternal(${zoomLevel});panX=panY=0;
            const page=previewSource,fields=structuredClone(page.handwrittenTextFields),width=900,scale=width/page.width,height=Math.ceil(page.height*scale);
            const make=()=>{const c=document.createElement('canvas');c.width=width;c.height=height;const context=c.getContext('2d');context.scale(scale,scale);return{c,context};};
            const reference=make(),preview=make();HandwrittenTextField.setTextFields(fields);HandwrittenTextField.draw(reference.context);
            const dataBefore=JSON.stringify(fields);HandwrittenTextField.drawPreview(preview.context,fields);const unchanged=dataBefore===JSON.stringify(fields);
            const a=reference.context.getImageData(0,0,width,height).data,b=preview.context.getImageData(0,0,width,height).data;
            let diff=0,pixelsA=0,pixelsB=0,overlap=0;for(let i=0;i<a.length;i+=4){diff+=Math.abs(a[i+3]-b[i+3]);const aa=a[i+3]>35,bb=b[i+3]>35;if(aa)pixelsA++;if(bb)pixelsB++;if(aa&&bb)overlap++;}
            return{meanAlphaError:diff/(width*height),overlap:2*overlap/(pixelsA+pixelsB),pixelsA,pixelsB,unchanged};
        })()`);assert(result.pixelsA>100,'Real handwritten glyphs rendered');assert(result.overlap>.78,JSON.stringify(result));assert(result.meanAlphaError<4,JSON.stringify(result));assert(result.unchanged,'Preview must not mutate handwriting/cache state');parity.push({theme,zoomLevel,...result});
    }
    const layout=await evaluate(String.raw`(()=>{
        const settings=HandwrittenTextField.getSettings(),sample={...structuredClone(previewSource.handwrittenTextFields[0]),x:10,y:10,width:120,autoWidth:false,text:'Mathe Kurs\n123\t456',charColors:['#ff6b6b','#ffffff']};
        const c=document.createElement('canvas');c.width=300;c.height=400;HandwrittenTextField.drawPreview(c.getContext('2d'),[sample]);
        const pixels=c.getContext('2d').getImageData(0,0,300,400).data;let red=0,black=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>30){if(pixels[i]>pixels[i+1]+30)red++;if(pixels[i]<15&&pixels[i+1]<15&&pixels[i+2]<15)black++;}
        return{red,black,settingsUnchanged:JSON.stringify(settings)===JSON.stringify(HandwrittenTextField.getSettings())};
    })()`);assert(layout.red&&layout.black&&layout.settingsUnchanged,'Per-character colors survive and white ink inverts in light mode');
    await evaluate(`(()=>{
        currentNotebook={id:'text-preview-fixture',name:'Handwritten preview',template:previewSource.template,pages:[previewSource.id]};pages=[structuredClone(previewSource)];currentPageIndex=0;loadPage(0);_setZoomInternal(1);panX=panY=0;renderPageList();document.getElementById('pageList').scrollTop=0;
    })()`);await wait(650);
    const integration=await evaluate(`(()=>{const record=PageThumbnails.records.get(previewSource.id),expected=document.createElement('canvas');expected.width=record.canvas.width;expected.height=record.canvas.height;const context=expected.getContext('2d'),scale=expected.width/previewSource.width;context.scale(scale,scale);HandwrittenTextField.drawPreview(context,previewSource.handwrittenTextFields);const overlay=context.getImageData(0,0,expected.width,expected.height).data,actual=record.canvas.getContext('2d').getImageData(0,0,expected.width,expected.height).data;let sampled=0,matched=0;for(let i=0;i<overlay.length;i+=4)if(overlay[i+3]>128){sampled++;if(actual[i]<140&&actual[i+1]<140&&actual[i+2]<140)matched++;}return{sampled,matched,match:matched/sampled,resolution:record.canvas.width};})()`);assert(integration.sampled>30&&integration.match>.85,JSON.stringify(integration));
    const before=await evaluate(`PageThumbnails.records.get(previewSource.id).version`);await evaluate(`window.dispatchEvent(new Event('handwrittenPreviewChanged'))`);assert(await evaluate(`PageThumbnails.records.get(previewSource.id).version`)>before,'Late font/settings changes refresh previews');
    await wait(200);const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-handwriting-thumbnail-fixed.png',Buffer.from(shot.data,'base64'));
    console.log(JSON.stringify({passed:true,source,parity,layout,integration}));
}finally{if(originalTheme)await evaluate(`applyTheme(${JSON.stringify(originalTheme)})`);if(originalStorage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(originalStorage)}))localStorage.setItem(k,v);})()`);await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();}
