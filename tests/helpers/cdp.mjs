export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function connect(target){
    target ||= (await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
    const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
    let serial=0;const pending=new Map(),listeners=new Map();
    ws.onmessage=e=>{
        const m=JSON.parse(e.data),p=pending.get(m.id);
        if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
        else for(const listener of listeners.get(m.method)||[])listener(m.params);
    };
    const call=(method,params={})=>new Promise((resolve,reject)=>{
        const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},30000);
        pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
    });
    const evaluate=async expression=>{
        const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
        if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
    };
    return{target,call,evaluate,on(method,listener){if(!listeners.has(method))listeners.set(method,new Set());listeners.get(method).add(listener);},close(){ws.close();}};
}
