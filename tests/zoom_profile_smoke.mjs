// Run against the local development Electron with --remote-debugging-port=9222.
// Native Chromium touch input exercises pointer capture and finger-up ordering.
// Test pages exist only in renderer memory; reload restores the user's page.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const page = JSON.parse(await readFile(new URL('../data/notebooks/4f5bd6ff/40d455dd.json', import.meta.url), 'utf8'));
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find(target => target.title === 'BadNotes');
assert(target, 'BadNotes development window must be running');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let serial = 0;
const pending = new Map();
socket.onmessage = event => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(JSON.stringify(response.error)));
    else request.resolve(response.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const touches = distance => [
    { id: 1, x: 700 - distance / 2, y: 400, radiusX: 5, radiusY: 5, force: 0.5 },
    { id: 2, x: 700 + distance / 2, y: 400, radiusX: 5, radiusY: 5, force: 0.5 },
];
const input = (type, touchPoints) => call('Input.dispatchTouchEvent', { type, touchPoints });
const penInput = (type, x, contact, pressure = contact ? 0.5 : 0) => call('Input.dispatchMouseEvent', {
    type, x, y: 500, pointerType: 'pen', button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: contact ? 1 : 0, force: pressure,
});
const reset = async () => {
    await input('touchCancel', []).catch(() => {});
    await evaluate('zoom = window.zoom = 1; panX = panY = 0; redrawCanvas(true); window.__cameraFrames = [];');
};
const state = (pivotX = 700, pivotY = 400) => evaluate(`({zoom, panX, panY, anchor:(${pivotX} - canvas.getBoundingClientRect().left - panX)/zoom, anchorY:(${pivotY} - canvas.getBoundingClientRect().top - panY)/zoom})`);

try {
    await evaluate('saveCurrentPage()');
    await call('Page.reload',{ignoreCache:true});
    await wait(1800);
    await evaluate('badnotesDirectInput({type:"touch-source",direct:false});currentNotebook=null;');
    if (process.env.BADNOTES_DIRECT_VECTOR) await evaluate(`drawNativeInkSnapshot=function(view){
        for(const stroke of strokes){if(stroke&&(stroke.isFill||stroke.type==='fill')&&(!stroke.bounds||rectIntersect(stroke.bounds,view)))drawStroke(stroke);}
        drawVectorStrokeCommands(view);
    }`);
    const results = [];
    for (const dense of [false,true]) {
        await evaluate(`strokes=${dense ? JSON.stringify(page.strokes) : '[]'}; images=[]; currentPageTemplate='dotted';
            baseWidth=1100;baseHeight=1600;isPinching=false;endGesturePreview(false);invalidateStrokeCache(false);
            redrawCanvas(true);`);
        if(process.env.BADNOTES_MINIFY_PROFILE&&dense)await evaluate(`(async()=>{beginStrokeCacheBuild(2);for(let i=0;i<200&&!strokeCacheValid;i++)await new Promise(r=>setTimeout(r,20));})()`);
        if(!process.env.BADNOTES_COLD_ZOOM) await evaluate(`(async()=>{for(let i=0;i<100;i++){
            if(!strokes.length||vectorStrokeCommandsCache?.commands)break;
            await new Promise(resolve=>setTimeout(resolve,20));
        }beginGesturePreview();isPinching=true;})()`);
        else await evaluate('beginGesturePreview();isPinching=true;');
        for (const level of process.env.BADNOTES_MINIFY_PROFILE ? [.03,.1,.3] : process.env.BADNOTES_RAPID_ZOOM ? [1,4] : [.3,1,2,4,8,24]) {
            const result = await evaluate(`(async()=>{
                let last=null;const gaps=[],costs=[];
                const rapid=${!!process.env.BADNOTES_RAPID_ZOOM};
                const frameCount=rapid?120:24;
                for(let i=0;i<frameCount;i++){
                    const now=await new Promise(requestAnimationFrame);
                    zoom=window.zoom=${level}*(rapid?Math.exp(Math.sin(i*Math.PI/30)*1.5):Math.pow(1.01,i));
                    panX=700-550*zoom;panY=400-800*zoom;
                    const start=performance.now();redrawCanvas(true);const cost=performance.now()-start;
                    if(last!==null){gaps.push(now-last);costs.push(cost);}last=now;
                }
                gaps.sort((a,b)=>a-b);costs.sort((a,b)=>a-b);
                return {median:gaps[Math.floor(gaps.length*.5)],p95:gaps[Math.floor(gaps.length*.95)],
                    cpu:costs[Math.floor(costs.length*.95)],maxFrame:gaps.at(-1),maxCPU:costs.at(-1),
                    cacheReady:!!vectorStrokeCommandsCache?.commands,dots:_dotGridColumns*_dotGridRows};
            })()`);
            results.push({dense,level,...result});
        }
        await evaluate('isPinching=false;endGesturePreview(false)');
    }
    console.log(JSON.stringify(results));
} finally {
    await evaluate('currentNotebook=null;isPinching=false;endGesturePreview(false)').catch(()=>{});
    await call('Page.reload',{ignoreCache:true});
    socket.close();
}
