import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const palette=JSON.parse(await readFile(new URL('../static/assets/badnotes-palette.json',import.meta.url),'utf8'));
const image=new URL('../static/assets/'+palette.source,import.meta.url).pathname;
for(const[name,sample]of Object.entries(palette.colors)){
    const result=spawnSync('magick',[image,'-format',`%[pixel:p{${sample.pixel.join(',')}}]`,'info:'],{encoding:'utf8'});
    assert.equal(result.status,0);const match=result.stdout.match(/srgba?\((\d+),(\d+),(\d+)/);assert(match);
    assert.deepEqual(match.slice(1,4).map(Number),sample.rgb,name+' exact source pixel');
    assert.equal('#'+sample.rgb.map(value=>value.toString(16).padStart(2,'0')).join(''),sample.hex);
}
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
let serial=0;const pending=new Map();
ws.onmessage=event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const luminance=rgb=>{const v=rgb.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
const contrast=(a,b)=>{const first=luminance(a),second=luminance(b);return(Math.max(first,second)+.05)/(Math.min(first,second)+.05);};
const rgb=color=>color.match(/\d+(?:\.\d+)?/g).slice(0,3).map(Number);
let originalTheme;
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);
    originalTheme=await evaluate('settings.theme');
    const dataBefore=await evaluate(`JSON.stringify({ink:strokes.map(s=>s.color),covers:notebooks.map(n=>n.color)})`);
    await evaluate(`(()=>{if(innerWidth<1700)badnotesWindow.toggleMaximize();GeometryWorkbench.open();GeometryDetector.setEnabled(true);})()`);await wait(200);
    const results=[];
    for(const theme of ['light','dark','oled']){
        await evaluate(`(()=>{setTheme(${JSON.stringify(theme)});redrawCanvas(true);GeometryWorkbench.sync();})()`);await wait(150);
        const state=await evaluate(`(()=>{const root=getComputedStyle(document.documentElement),a=getComputedStyle(document.getElementById('newNotebookBtn')),b=getComputedStyle(document.getElementById('addPageBtn')),primary=getComputedStyle(document.getElementById('createNotebookBtn')),track=getComputedStyle(document.querySelector('#geometryEnabled+.geometry-switch-track')),geometry=getComputedStyle(document.querySelector('.geometry-auto'));return{accent:root.getPropertyValue('--accent').trim(),rgb:root.getPropertyValue('--brand-accent-rgb').trim(),buttonColor:a.color,buttonBackground:a.backgroundImage,matching:a.backgroundImage===b.backgroundImage&&a.color===b.color,primaryBackground:primary.backgroundImage,primaryColor:primary.color,switchBackground:track.backgroundImage,brand:getComputedStyle(document.querySelector('.brand-notes')).backgroundImage,geometryBackground:geometry.backgroundColor};})()`);
        const expected=palette.colors[theme==='light'?'purple':'lilac'];assert.equal(state.accent,expected.hex);assert.equal(state.rgb,'118, 64, 253');assert.deepEqual(rgb(state.buttonColor),expected.rgb);assert(state.matching);
        if(theme==='light')assert(state.buttonBackground.includes('linear-gradient'));else assert.equal(state.buttonBackground,'none','Dark shelf actions have a uniform tint');assert(state.primaryBackground.includes('linear-gradient'));assert.equal(state.primaryColor,'rgb(255, 255, 255)');assert.equal(state.switchBackground,state.primaryBackground);
        assert(contrast(expected.rgb,theme==='light'?[255,255,255]:[30,30,30])>4.5,theme+' readable accent text');
        assert(contrast(palette.colors.purple.rgb,[255,255,255])>4.5,'White text on purple');
        const wash=palette.colors.purple.rgb.map(channel=>255*.9+channel*.1),hoverWash=palette.colors.purple.rgb.map(channel=>255*.8+channel*.2);
        assert(contrast(palette.colors.purple.rgb,wash)>4.5,'Accent text on translucent purple fill');
        assert(contrast(palette.colors['purple-deep'].rgb,hoverWash)>4.5,'Hover text stays readable on stronger fill');
        const fillEnd=palette.colors.purple.rgb.map((c,i)=>c*.75+palette.colors.orchid.rgb[i]*.25);assert(contrast(fillEnd,[255,255,255])>4.5,'Gradient endpoint stays readable');
        const screenshot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-brand-palette-'+theme+'.png',Buffer.from(screenshot.data,'base64'));
        results.push({theme,accent:state.accent,contrast:contrast(expected.rgb,theme==='light'?[255,255,255]:[30,30,30]),gradients:true});
    }
    assert.equal(await evaluate(`JSON.stringify({ink:strokes.map(s=>s.color),covers:notebooks.map(n=>n.color)})`),dataBefore,'UI theming never recolors user ink or covers');
    console.log(JSON.stringify({passed:true,exactSamples:Object.keys(palette.colors).length,themes:results,dataColorsUnchanged:true}));
}finally{
    if(originalTheme)await evaluate(`setTheme(${JSON.stringify(originalTheme)})`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
