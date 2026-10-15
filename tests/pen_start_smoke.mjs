import assert from 'node:assert/strict';
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find(t => t.title === 'BadNotes');
assert(target);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let serial = 0;
const pending = new Map();
ws.onmessage = ({data}) => {
    const result = JSON.parse(data), item = pending.get(result.id);
    if (!item) return;
    pending.delete(result.id); clearTimeout(item.timer);
    result.error ? item.reject(new Error(JSON.stringify(result.error))) : item.resolve(result.result);
};
const call = (method, params = {}) => new Promise((resolve,reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method+' timed out')); },10000);
    pending.set(id,{resolve,reject,timer}); ws.send(JSON.stringify({id,method,params}));
});
const evaluate = async expression => {
    const result = await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
};
try {
    await call('Page.reload',{ignoreCache:true});
    await new Promise(resolve => setTimeout(resolve,1800));
    const result = await evaluate(`(async () => {
        await saveCurrentPage(); currentNotebook = null;
        strokes = []; images = []; zoom = window.zoom = 2; panX = panY = 0;
        currentTool = 'pen'; currentColor = '#000000'; currentSize = baseBrushSize = 4;
        dynamicBrushEnabled = true; settings.pressureMultiplier = 1;
        invalidateStrokeCache(false); redrawCanvas(true);
        const rect = canvas.getBoundingClientRect();
        const event = (x,y) => ({pointerId:999,clientX:rect.left+x*zoom,clientY:rect.top+y*zoom,
            pressure:.5,preventDefault(){},stopPropagation(){}});
        startDrawing(event(100,100));
        const initialSize = currentStroke.points[0].size;
        draw(event(102,100)); draw(event(109,112));
        const prefix = currentStroke.points.slice();
        const bounds = !!currentStroke.liveStartBounds;
        const startTime = performance.now();
        for(let i=0;i<1000;i++) draw(event(110+i*.15,112+Math.sin(i/10)*10));
        const cost = performance.now()-startTime;
        const liveTip = {...currentStroke.livePoint};
        stopDrawing();
        const committed = strokes.at(-1);
        startDrawing(event(200,200)); stopDrawing();
        const dotPoints = strokes.at(-1).points.length;
        startDrawing({...event(300,300),timeStamp:100});
        draw({...event(303,302),timeStamp:110,pointerType:'pen',buttons:1,
            getCoalescedEvents:()=>[
                {...event(310,290),timeStamp:90,pointerType:'pen',buttons:1},
                {...event(301,301),timeStamp:105,pointerType:'pen',buttons:1}
            ]});
        const contactOnly = currentStroke.points.map(p=>[p.x,p.y]);
        stopDrawing();
        startDrawing({...event(415,405),timeStamp:200});
        draw({...event(400,400),timeStamp:200,pointerType:'pen',buttons:1,
            getCoalescedEvents:()=>[{...event(400,400),timeStamp:200,pointerType:'pen',buttons:1}]});
        const correctedDot = {...currentStroke.points[0]};
        draw({...event(400,398),timeStamp:205,pointerType:'pen',buttons:1});
        const correctedContact = currentStroke.points.map(p=>[p.x,p.y]);
        stopDrawing();
        return {initialSize,nextSize:prefix[1].size,bounds,first:committed.points[0],
            tip:committed.points.at(-1),liveTip,cost,dotPoints,contactOnly,correctedDot,correctedContact,
            leakedPreview: 'liveStartBounds' in committed};
    })()`);
    assert.equal(result.initialSize,result.nextSize);
    assert(result.bounds,'Only the short prefix should be redrawn');
    assert.deepEqual([result.first.x,result.first.y],[100,100]);
    assert.deepEqual([result.tip.x,result.tip.y],[result.liveTip.x,result.liveTip.y]);
    assert.equal(result.dotPoints,1);
    assert.equal(result.leakedPreview,false);
    assert.deepEqual(result.contactOnly,[[300,300],[301,301],[303,302]],'Old coalesced coordinates must never create a start hook');
    assert.deepEqual([result.correctedDot.x,result.correctedDot.y],[400,400],'Same-time correction must relocate the dot, not draw a hook');
    assert.deepEqual(result.correctedContact,[[400,400],[400,398]],'No stale pointerdown coordinate may remain in the stroke');
    console.log(JSON.stringify({passed:true,...result}));
} finally {
    await call('Page.reload',{ignoreCache:true}); ws.close();
}
