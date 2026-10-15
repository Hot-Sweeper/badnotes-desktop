// The phone companion uses the exact editor palettes. Preview replacements
// free file-backed URLs; no scanning/upload endpoints are invoked by this test.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {connect,wait} from './helpers/cdp.mjs';
const main=await connect();let c,storage;
try{
    await main.evaluate('saveCurrentPage()');storage=await main.evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    // Electron does not support Target.createTarget; visit the local companion
    // in the existing surface, then return to the saved editor in finally.
    await main.call('Page.navigate',{url:'http://127.0.0.1:5001/scan'});c=main;await wait(600);const{call,evaluate}=c;
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await call('Page.bringToFront');await wait(200);
    await evaluate(`(()=>{const original=fetch;fetch=(url,o={})=>{if(o.method&&o.method!=='GET')throw Error('Scanner QA cannot upload images');return original(url,o);};})()`);
    const reports=[];
    for(const mode of ['light','dark','oled'])for(const tone of ['iris','rose','lagoon','ocean','sage','amber']){
        await evaluate(`settings.theme='${mode}';document.documentElement.dataset.theme='${mode}';AppearanceSettings.applyAccent('${mode}','${tone}');`);
        const result=await evaluate(`(()=>{const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body),button=getComputedStyle(document.querySelector('.source-btn'));return{background:body.backgroundColor,text:body.color,button:button.backgroundColor,corner:button.cornerShape,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,expected:root.getPropertyValue('--ui-surround').trim(),brand:document.querySelector('.scanner-brand').textContent};})()`);
        assert.equal(result.corner,'superellipse(2)');assert(!result.overflow,JSON.stringify(result));assert.equal(result.brand,'BadNotes Scan');
        reports.push({mode,tone,...result});
    }
    await evaluate(`settings.theme='light';document.documentElement.dataset.theme='light';AppearanceSettings.applyAccent('light','iris');`);
    const preview=await evaluate(`(async()=>{
        let created=0,revoked=0,reads=0;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,read=FileReader.prototype.readAsDataURL;
        URL.createObjectURL=(...args)=>{created++;return create(...args);};URL.revokeObjectURL=(...args)=>{revoked++;return revoke(...args);};FileReader.prototype.readAsDataURL=function(...args){reads++;return read.apply(this,args);};
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').fillRect(0,0,640,480);
        const blob=await new Promise(r=>canvas.toBlob(r)),file=new File([blob],'preview.png',{type:'image/png'});canvas.width=canvas.height=0;
        for(let i=0;i<12;i++){showOriginal([file]);await previewImg.decode();await new Promise(requestAnimationFrame);}
        const state={created,revoked,reads,dimensions:imageDimensions,url:previewImg.src.startsWith('blob:'),visible:getComputedStyle(previewImg).display!=='none'};
        resetUI();return{...state,revokedAfterReset:revoked,urlReleased:previewURL===null};
    })()`);
    assert.deepEqual(preview.dimensions,{width:640,height:480});assert(preview.url&&preview.visible);assert.equal(preview.reads,0);assert.equal(preview.created,12);assert.equal(preview.revoked,11);assert.equal(preview.revokedAfterReset,12);assert(preview.urlReleased);
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-scanner-audit.png',Buffer.from(shot.data,'base64'));
    console.log(JSON.stringify({passed:true,combinations:reports.length,phoneViewport:[390,844],preview}));
}finally{
    await main.call('Emulation.clearDeviceMetricsOverride').catch(()=>{});
    if(storage)await main.evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await main.call('Page.navigate',{url:'http://127.0.0.1:5001/'});await wait(1800);await main.call('Page.bringToFront');main.close();
}
