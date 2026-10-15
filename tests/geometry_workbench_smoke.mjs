import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const serial=++id;const timer=setTimeout(()=>reject(Error(method+' timeout')),12000);pending.set(serial,{resolve,reject,timer});ws.send(JSON.stringify({id:serial,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let storage;
try{
    await evaluate('saveCurrentPage()');
    await call('Page.reload',{ignoreCache:true});await wait(1600);
    storage=await evaluate(`({mode:localStorage.getItem('badnotes_geometry_mode'),snap:localStorage.getItem('badnotes_geometry_snap')})`);
    await evaluate(`(()=>{if(innerWidth<1700)badnotesWindow.toggleMaximize();window.geometryOriginalSave=saveCurrentPage;saveCurrentPage=async()=>{};triggerAutoSave=()=>{};currentNotebook=null;currentStroke=null;historyStack=[];redoStack=[];strokes=[];currentTool='pen';_setZoomInternal(1);panX=0;panY=0;invalidateStrokeCache();redrawCanvas(true);GeometryWorkbench.open();})()`);
    const ui=await evaluate(`({buttons:document.querySelectorAll('[data-geometry-shape]').length,enabled:!!GeometryWorkbench,errors:document.querySelector('#geometryPanel').hidden})`);assert.equal(ui.buttons,26);assert.equal(ui.errors,false);
    const types=await evaluate(`GeometryDetector.catalog.map(([id])=>id).filter(id=>!['auto','polyline'].includes(id))`);
    const results=[];
    for(const type of types){
        const position=await evaluate(`(()=>{const engine=GeometryDetector;engine.mode=${JSON.stringify(type)};engine.setEnabled(true);document.getElementById('geometryPanel').hidden=true;strokes=[];historyStack=[];redoStack=[];invalidateStrokeCache();redrawCanvas(true);return{x:innerWidth*.43,y:innerHeight*.3};})()`);
        const {x,y}=position;
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
        await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+150,y:y+110,button:'left',buttons:1});
        await wait(30);
        const preview=await evaluate('!!currentStroke?.geometryDraft');assert(preview,type+' live preview');
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+150,y:y+110,button:'left',buttons:0,clickCount:1});
        const committed=await evaluate(`(()=>{const type=strokes[0]?.geometryType,serialized=JSON.parse(JSON.stringify(strokes[0]));undo();const undone=strokes.length===0;redo();return{type,undone,redone:strokes.length===1,points:serialized.points.length,finite:serialized.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),draft:serialized.geometryDraft};})()`);
        assert.equal(committed.type,type);assert(committed.undone&&committed.redone&&committed.finite);assert.equal(committed.draft,undefined);results.push(type);
    }
    const automatic=[];
    for(const type of['line','rectangle','circle','ellipse','triangle','hexagon','star','heart','rounded-rectangle']){
        const points=await evaluate(`(()=>{GeometryDetector.mode='auto';GeometryDetector.setEnabled(true);currentTool='pen';strokes=[];historyStack=[];redoStack=[];invalidateStrokeCache();redrawCanvas(true);const shape=GeometryDetector.createShape(${JSON.stringify(type)},{x:innerWidth*.4,y:innerHeight*.3},{x:innerWidth*.4+180,y:innerHeight*.3+(${JSON.stringify(type)}==='rectangle'||${JSON.stringify(type)}==='ellipse'?100:180)});return GeometryDetector.resample(shape.points,72);})()`);
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',...points[0]});await wait(20);await call('Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',buttons:1,clickCount:1});
        for(const point of points.slice(1))await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',buttons:0,clickCount:1});
        const result=await evaluate(`({type:strokes[0]?.geometryType,geometric:strokes[0]?.isGeometric,points:strokes[0]?.points})`);if(result.type!==type)console.log(JSON.stringify({failed:type,result}));assert.equal(result.type,type,type+' native-input auto recognition');assert(result.geometric);automatic.push(type);
    }
    await evaluate(`(()=>{strokes=[];historyStack=[];redoStack=[];GeometryDetector.mode='auto';GeometryDetector.setEnabled(true);currentTool='pen';invalidateStrokeCache();redrawCanvas(true);})()`);
    for(const points of [[{x:800,y:500},{x:1000,y:500}],[{x:965,y:480},{x:1000,y:500},{x:965,y:520}]]){
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',...points[0]});await call('Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',buttons:1,clickCount:1});
        for(const point of points.slice(1))await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',buttons:0,clickCount:1});
    }
    const multiArrow=await evaluate(`(()=>{const arrow=strokes.length===1&&strokes[0].geometryType==='arrow';undo();const undoHead=strokes.length===1&&strokes[0].geometryType==='line';redo();return{arrow,undoHead,redo:strokes.length===1&&strokes[0].geometryType==='arrow'};})()`);assert(Object.values(multiArrow).every(Boolean),JSON.stringify(multiArrow));
    const rendered=await evaluate(`(()=>{strokes=[];for(let i=0;i<24;i++){const type=GeometryDetector.catalog.filter(([id])=>!['auto','polyline'].includes(id))[i][0];strokes.push(GeometryDetector.createShape(type,{x:390+i%6*160,y:180+Math.floor(i/6)*150},{x:510+i%6*160,y:280+Math.floor(i/6)*150},{id:100+i,color:'#ffffff',size:2}));}invalidateStrokeCache();redrawCanvas(true);GeometryWorkbench.open();document.querySelector('.geometry-inspector').open=true;GeometryWorkbench.sync();return{shapes:strokes.length};})()`);
    await wait(300);const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/badnotes-geometry-workbench.png',Buffer.from(shot.data,'base64'));
    const edits=await evaluate(`(()=>{const old=strokes.at(-1).points.map(p=>({...p}));document.getElementById('geometryWidth').value='220';document.getElementById('geometryHeight').value='140';document.getElementById('geometryRotation').value='30';document.querySelector('[data-geometry-edit="apply"]').click();const changed=JSON.stringify(strokes.at(-1).points)!==JSON.stringify(old);undo();const restored=JSON.stringify(strokes.at(-1).points)===JSON.stringify(old);redo();document.querySelector('[data-geometry-edit="duplicate"]').click();return{changed,restored,duplicate:strokes.length===25};})()`);assert(edits.changed&&edits.restored&&edits.duplicate);
    const renderPath=await evaluate(`(()=>{const commands=[];const saved=window.Path2D;window.Path2D=class{moveTo(...p){commands.push(['move',...p]);}lineTo(...p){commands.push(['line',...p]);}bezierCurveTo(){commands.push(['curve']);}};try{getVectorPenPath(GeometryDetector.createShape('rectangle',{x:0,y:0},{x:100,y:50}));const crisp=!commands.some(c=>c[0]==='curve');commands.length=0;getVectorPenPath(GeometryDetector.createShape('double-arrow',{x:0,y:0},{x:100,y:0}));return{crisp,moves:commands.filter(c=>c[0]==='move').length};}finally{window.Path2D=saved;}})()`);assert(renderPath.crisp);assert.equal(renderPath.moves,3);
    const saved=await evaluate(`(async()=>{API.put=async()=>{};currentNotebook={id:'geometry-memory-test',pages:['geometry-memory-page']};pages=[{id:'geometry-memory-page',width:1100,height:1600,strokes:[]}];currentPageIndex=0;await geometryOriginalSave();const serialized=JSON.parse(JSON.stringify(pages[0].strokes));return{count:serialized.length,metadata:serialized.every(s=>s.isGeometric&&s.geometryType&&s.points.length>1),noPaths:serialized.every(s=>!s._bezierPath)};})()`);assert(saved.metadata&&saved.noPaths);assert.equal(saved.count,25);
    console.log(JSON.stringify({passed:true,ui,directShapes:results,automatic,edits,renderPath,rendered,saved}));
}finally{
    if(storage)await evaluate(`(()=>{const data=${JSON.stringify(storage)};for(const[key,value]of Object.entries(data)){const name='badnotes_geometry_'+key;if(value===null)localStorage.removeItem(name);else localStorage.setItem(name,value);}})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1600);ws.close();
}
