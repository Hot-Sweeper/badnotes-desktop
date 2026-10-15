import assert from 'node:assert/strict';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);let id=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const evaluate=expression=>new Promise((resolve,reject)=>{const serial=++id;pending.set(serial,{resolve:result=>{if(result.exceptionDetails)reject(Error(JSON.stringify(result.exceptionDetails)));else resolve(result.result.value);},reject});ws.send(JSON.stringify({id:serial,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
try{
    for(let i=0;i<50;i++){if(await evaluate('!!currentNotebook'))break;await new Promise(r=>setTimeout(r,100));}
    const result=await evaluate(`(()=>{
        const serialized=JSON.stringify(ModularToolbar.getConfig()),stored=localStorage.getItem('badnotes_toolbar_config');
        const actions=ModularToolbar.getConfig().find(section=>section.id==='actions');
        actions.items.push({type:'button',id:'gestureControlBtn',icon:'gestureControl',title:'Old saved webcam button'});
        ModularToolbar.render();
        const find=(items,id)=>items.some(item=>item.id===id||item.items&&find(item.items,id));
        return{noButton:!document.getElementById('gestureControlBtn'),migratedOldLayout:!find(ModularToolbar.getConfig(),'gestureControlBtn'),layoutPreserved:JSON.stringify(ModularToolbar.getConfig())===serialized,storedLayoutUnchanged:localStorage.getItem('badnotes_toolbar_config')===stored,
            noWebcamModule:typeof GestureControl==='undefined',noTrackingLibrary:typeof Hands==='undefined',noTrackingRequests:!performance.getEntriesByType('resource').some(resource=>/mediapipe|28_gesture_control/.test(resource.name)),noWebcamOverlays:!document.querySelector('#gesturePreviewContainer,.gesture-hand-cursor'),touchBridgePreserved:typeof badnotesDirectInput==='function',fingerDrawingTogglePreserved:!!document.getElementById('fingerDrawBtn'),themeTogglePreserved:!!document.getElementById('themeToggleBtn')};
    })()`);assert(Object.values(result).every(Boolean),JSON.stringify(result));console.log(JSON.stringify({passed:true,...result}));
    await evaluate('if(innerWidth<1700)badnotesWindow.toggleMaximize()');
}finally{ws.close();}
