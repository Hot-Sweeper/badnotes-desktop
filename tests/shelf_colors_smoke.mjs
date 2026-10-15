import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timed out')),10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const luminance=rgb=>rgb.slice(0,3).reduce((sum,n,i)=>{const c=n/255;return sum+(c<=.04045?c/12.92:((c+.055)/1.055)**2.4)*[.2126,.7152,.0722][i];},0);
let saved;
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);
    saved=await evaluate(`({theme:settings.theme,zoom,panX,panY,colors:JSON.stringify({ink:strokes.map(s=>s.color),books:notebooks.map(n=>n.color)})})`);
    const report=[];
    for(const theme of ['dark','light','oled']){
        await evaluate(`(()=>{applyTheme(${JSON.stringify(theme)});_setZoomInternal(.5);panX=80;panY=80;redrawCanvas(true);})()`);await wait(150);
        const state=await evaluate(`(()=>{
            const color=value=>{const c=document.createElement('canvas');c.width=c.height=1;const context=c.getContext('2d');context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
            const style=id=>{const s=getComputedStyle(document.getElementById(id));return{background:color(s.backgroundColor),image:s.backgroundImage,blur:s.backdropFilter,text:color(s.color),shadow:s.boxShadow};};
            const sample=(x,y)=>[...ctx.getImageData(Math.round(x*baseDPR),Math.round(y*baseDPR),1,1).data];
            const a=document.getElementById('newNotebookBtn').getBoundingClientRect(),b=document.getElementById('addPageBtn').getBoundingClientRect();
            return{left:style('sidebar'),right:style('pageNav'),book:style('newNotebookBtn'),page:style('addPageBtn'),surround:sample(4,4),paper:sample(130,130),aligned:Math.abs(a.top-b.top)<.1};
        })()`);
        assert.deepEqual(state.left.background,state.right.background,theme+' equal shelf surfaces');assert.equal(state.left.background[3],255,'Opaque, stable panel color');assert(luminance(state.left.background)>luminance(state.surround),theme+' panels are lighter than the canvas surround');
        assert.equal(state.left.blur,'none');assert.equal(state.right.blur,'none');assert.deepEqual(state.book,state.page,theme+' matching actions');assert(state.aligned,'Keep shelf header alignment');
        if(theme!=='light'){
            assert.equal(state.book.image,'none','No uneven dark gradient');assert.equal(state.book.background[3],255,'No translucent shading');assert.equal(state.book.shadow,'none');
            const contrast=(luminance(state.book.text)+.05)/(luminance(state.book.background)+.05);assert(contrast>4.5,theme+' readable labels');
        }
        const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-shelf-colors-'+theme+'.png',Buffer.from(shot.data,'base64'));report.push({theme,panels:state.left.background,surround:state.surround,button:state.book.background,uniform:theme!=='light'});
    }
    assert.equal(await evaluate(`JSON.stringify({ink:strokes.map(s=>s.color),books:notebooks.map(n=>n.color)})`),saved.colors,'Theme changes do not recolor notebook covers or ink');
    console.log(JSON.stringify({passed:true,report}));
}finally{
    if(saved)await evaluate(`(()=>{applyTheme(${JSON.stringify(saved.theme)});_setZoomInternal(${saved.zoom});panX=${saved.panX};panY=${saved.panY};redrawCanvas(true);})()`);
    ws.close();
}
