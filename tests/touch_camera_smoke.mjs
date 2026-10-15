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
const pinch = async distances => {
    await input('touchStart', touches(distances[0]));
    for (const distance of distances.slice(1)) {
        await wait(9);
        await input('touchMove', touches(distance));
    }
    await wait(10);
};

try {
    await call('Page.reload', { ignoreCache: true });
    await wait(1800);
    await call('Page.bringToFront');
    await evaluate(`(async () => {
        await saveCurrentPage();
        window.badnotesDirectInput({type:'touch-source', direct:false});
        currentNotebook = null;
        strokes = ${JSON.stringify(page.strokes)};
        images = [];
        baseWidth = ${page.width}; baseHeight = ${page.height};
        currentPageTemplate = 'grid';
        if (${process.env.BADNOTES_TEST_FLAT_UI === '1'}) {
            const diagnosticStyle = document.createElement('style');
            diagnosticStyle.textContent = '#app * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; filter: none !important; }';
            document.head.appendChild(diagnosticStyle);
        }
        fingerDrawingEnabled = false;
        penIsActive = false; lastPenEventTime = -10000;
        invalidateStrokeCache(false); redrawCanvas(true);
        await new Promise(resolve => setTimeout(resolve, 2400));
        window.__cameraFrames = [];
        window.__cameraTouches = [];
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
            document.addEventListener(type, event => window.__cameraTouches.push({
                type, id: event.pointerId, x: event.clientX, time: event.timeStamp,
                target: event.target.id, zoom, isPointerPanning, isPinching
            }), { capture: true });
        }
        const render = _redrawCanvas;
        _redrawCanvas = function () {
            const time = performance.now();
            render();
            window.__cameraFrames.push({ time, cost: performance.now() - time, zoom, panX, panY, phase: window.__cameraPhase, moving: isPanning });
        };
    })()`);

    const quality = await evaluate(`(() => {
        const originalCache = vectorStrokeCommandsCache;
        const originalDrawImage = ctx.drawImage;
        const originalIndividual = drawStrokesIndividually;
        let magnifiedRaster = 0, fallbackFrames = 0;
        ctx.drawImage = function(source, ...args) {
            if (source === strokeCacheCanvas && zoom > lastCachedZoom * 1.001) magnifiedRaster++;
            return originalDrawImage.call(this, source, ...args);
        };
        drawStrokesIndividually = function(rect) { fallbackFrames++; return originalIndividual(rect); };
        zoom = window.zoom = Math.max(8, lastCachedZoom * 2);
        vectorStrokeCommandsCache = {version:strokeCacheVersion,building:true};
        beginGesturePreview();
        isPointerPanning = true;
        redrawCanvas(true);
        const nativeSnapshot = nativeInkSnapshot;
        panX += 7; redrawCanvas(true);
        const reusedNativeSnapshot = nativeSnapshot === nativeInkSnapshot;
        // Allocation has a small rounded-up edge; the actual ink sampling
        // density comes from its world-to-pixel transform, not buffer width.
        const nativePixelRatio = nativeSnapshot.context.getTransform().a / nativeSnapshot.zoom;
        isPinching = true;
        zoom = window.zoom = zoom * 1.1;
        redrawCanvas(true);
        const pinchHasNativeDetail = nativeInkSnapshot.zoom >= zoom;
        isPinching = false;
        const dotCanvas = document.createElement('canvas');
        dotCanvas.width = dotCanvas.height = 32;
        const dotContext = dotCanvas.getContext('2d');
        dotContext.lineWidth = 8; dotContext.lineCap = 'round';
        dotContext.stroke(getVectorPenPath({tool:'pen',size:8,points:[{x:16,y:16}]}));
        const dotPixels = dotContext.getImageData(0,0,32,32).data;
        const batchedDotVisible = dotPixels.some((value,index) => index%4===3 && value>0);
        isPointerPanning = false;
        endGesturePreview(false);
        ctx.drawImage = originalDrawImage;
        drawStrokesIndividually = originalIndividual;
        vectorStrokeCommandsCache = originalCache;
        zoom = window.zoom = 1; panX = panY = 0;
        redrawCanvas(true);
        return {magnifiedRaster,fallbackFrames,reusedNativeSnapshot,nativePixelRatio,dpr:baseDPR,pinchHasNativeDetail,batchedDotVisible};
    })()`);
    assert.equal(quality.magnifiedRaster, 0, 'Pure pan must never magnify a low-resolution page cache');
    assert(quality.fallbackFrames >= 1, 'Building vector cache must render ink, not blank frames');
    assert.equal(quality.reusedNativeSnapshot, true, 'Pan should reuse the sharp viewport without replaying strokes');
    assert(Math.abs(quality.nativePixelRatio - quality.dpr) < .002, 'Viewport ink must use the display native pixel density');
    assert.equal(quality.pinchHasNativeDetail, true, 'Live pinch must retain at least native sampling detail');
    assert.equal(quality.batchedDotVisible, true, 'Dots must remain visible in vector batches');

    // The forced 8x quality probe allocates/rasterizes large GPU buffers.
    // Let its work settle before measuring a separate touch gesture sequence.
    await wait(600);
    await evaluate('window.__cameraFrames = []');

    await reset();
    await evaluate('window.__cameraPhase = "contact"');
    await pinch(Array.from({ length: 19 }, (_, index) => 200 + index * 6));
    const remaining = touches(308).slice(1);
    await input('touchEnd', touches(308).slice(0, 1));
    await wait(12);
    await input('touchMove', [{ ...remaining[0], x: remaining[0].x + 2 }]);
    await input('touchEnd', []);
    await evaluate('window.__cameraPhase = "coast"');
    const released = await state();
    await wait(1300);
    const settled = await state();
    if (!(settled.zoom > released.zoom)) {
        console.error(JSON.stringify({ phase: 'pinch-release', released, settled, cache:await evaluate('({version:strokeCacheVersion, vectorVersion:vectorStrokeCommandsCache?.version,building:vectorStrokeCommandsCache?.building,commands:vectorStrokeCommandsCache?.commands?.length, frames:window.__cameraFrames.slice(-8)})'),recentEvents: await evaluate('window.__cameraTouches.slice(-12)') }));
    }
    assert(settled.zoom > released.zoom, 'Zoom-out finger motion must coast in the same direction');
    assert(settled.zoom / released.zoom < 1.08, 'Zoom drift must stay controlled on a normal pinch');
    assert(Math.abs(settled.anchor - released.anchor) < 0.01, 'Sequential finger lifts must preserve the zoom anchor');
    const frameStats = await evaluate(`(() => {
        const frames = window.__cameraFrames;
        const gaps = frames.slice(1).map((frame, index) => frame.time - frames[index].time).filter(gap => gap > 1 && gap < 100).sort((a,b) => a-b);
        const costs = frames.map(frame => frame.cost).sort((a,b) => a-b);
        const coast = frames.filter(frame => frame.phase === 'coast' && frame.moving);
        const coastGaps = coast.slice(1).map((frame, index) => frame.time - coast[index].time).sort((a,b) => a-b);
        const contact = frames.filter(frame => frame.phase === 'contact');
        const contactGaps = contact.slice(1).map((frame, index) => frame.time - contact[index].time).sort((a,b) => a-b);
        return { medianFrameMs: gaps[Math.floor(gaps.length / 2)], p95FrameMs: gaps[Math.floor(gaps.length * .95)], contactMedianMs: contactGaps[Math.floor(contactGaps.length / 2)], contactP95Ms: contactGaps[Math.floor(contactGaps.length * .95)], coastMedianMs: coastGaps[Math.floor(coastGaps.length / 2)], coastP95Ms: coastGaps[Math.floor(coastGaps.length * .95)], p95DrawMs: costs[Math.floor(costs.length * .95)], frames: frames.length, strokes: strokes.length };
    })()`);

    // Real pinches rarely have a stationary centroid. Scaling while the
    // midpoint travels must follow both fingertips during contact and must
    // not turn the midpoint velocity into sideways drift on finger-up.
    await reset();
    await input('touchStart', touches(200));
    const originalPinchAnchor = await state();
    for (let index = 1; index <= 12; index++) {
        await wait(9);
        await input('touchMove', touches(200 + index * 6).map(point => ({
            ...point, x: point.x + index * 3, y: point.y + index * 2
        })));
        await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))');
        const contact = await state(700 + index * 3, 400 + index * 2);
        assert(Math.abs(contact.anchor - originalPinchAnchor.anchor) < 0.01, 'Moving pinch midpoint must retain its world anchor while touching');
        assert(Math.abs(contact.anchorY - originalPinchAnchor.anchorY) < 0.01, 'Moving pinch midpoint must retain its vertical anchor while touching');
    }
    await input('touchEnd', []);
    const movingPinchRelease = await state(736, 424);
    await wait(1000);
    const movingPinchSettle = await state(736, 424);
    assert(Math.abs(movingPinchSettle.anchor - movingPinchRelease.anchor) < 0.01, 'Zoom release must not inherit horizontal pan momentum');
    assert(Math.abs(movingPinchSettle.anchorY - movingPinchRelease.anchorY) < 0.01, 'Zoom release must not inherit vertical pan momentum');

    await reset();
    await pinch([200, 210, 220, 230, 240, 250, 260, 252, 244, 236, 228, 220]);
    await input('touchEnd', []);
    const reversedRelease = await state();
    await wait(1300);
    const reversedSettle = await state();
    assert(reversedSettle.zoom < reversedRelease.zoom, 'Momentum must follow the final reversal');

    await reset();
    await pinch([200, 210, 220, 230, 240, 250, 260, 252]);
    await input('touchEnd', []);
    const quickRelease = await state();
    await wait(1300);
    const quickSettle = await state();
    assert(quickSettle.zoom < quickRelease.zoom, 'Even a one-packet reversal must not fling in the earlier direction');

    await reset();
    await pinch([200, 210, 220, 230, 240, 250]);
    await wait(150);
    await input('touchEnd', []);
    const pausedRelease = await state();
    await wait(1300);
    const pausedSettle = await state();
    assert(Math.abs(pausedSettle.zoom - pausedRelease.zoom) < 0.00001, 'Holding fingers still before release must stop momentum');

    await reset();
    await input('touchStart', [touches(200)[0]]);
    for (let index = 1; index <= 10; index++) {
        await wait(10);
        await input('touchMove', [{ ...touches(200)[0], x: 600 + index * 10 }]);
    }
    await input('touchEnd', []);
    const panRelease = await state();
    await wait(1300);
    const panSettle = await state();
    assert(panSettle.panX > panRelease.panX, 'One-finger pan must retain its release direction');
    assert(panSettle.panX - panRelease.panX < 500, 'A normal pan must coast a reasonable distance');

    await reset();
    await pinch([200, 210, 220, 230, 240, 250]);
    await input('touchEnd', []);
    await wait(30);
    await input('touchStart', [touches(200)[0]]);
    const interrupted = await state();
    await wait(180);
    const held = await state();
    assert(Math.abs(interrupted.zoom - held.zoom) < 0.00001, 'Touching the canvas must stop a zoom coast immediately');
    await input('touchEnd', []);

    // Writing, then hovering the lifted pen, must allow an immediate fresh
    // finger pan. A palm that was already down during writing stays rejected.
    await reset();
    await penInput('mousePressed', 600, true);
    await penInput('mouseMoved', 620, true);
    const palm = { ...touches(200)[0], radiusX: 50, radiusY: 50 };
    await input('touchStart', [palm]);
    const beforePalm = await state();
    await penInput('mouseReleased', 620, false);
    await penInput('mouseMoved', 625, false, 0.5);
    assert.equal(await evaluate('penIsActive'), false, 'Hover must not reactivate palm rejection');
    await input('touchMove', [{ ...palm, x: 700 }]);
    await wait(20);
    const afterPalm = await state();
    assert.equal(afterPalm.panX, beforePalm.panX, 'A resting palm must remain blocked after pen-up');
    await input('touchEnd', []);
    await input('touchStart', [touches(200)[0]]);
    await input('touchMove', [{ ...touches(200)[0], x: 650 }]);
    await wait(20);
    assert((await state()).panX > afterPalm.panX, 'A fresh finger must pan immediately after writing');
    await input('touchEnd', []);

    await reset();
    await penInput('mousePressed', 600, true);
    await penInput('mouseMoved', 620, true);
    // Some drivers report the next hover without delivering a pen-up first.
    await penInput('mouseMoved', 625, false);
    assert.equal(await evaluate('isDrawing'), false, 'Hover must recover a missing pen-up');
    assert.equal(await evaluate('penIsActive'), false, 'Missing pen-up must not leave touch locked');
    await input('touchStart', [touches(200)[0]]);
    const beforeRecoveryPan = await state();
    await input('touchMove', [{ ...touches(200)[0], x: 650 }]);
    await wait(20);
    assert((await state()).panX > beforeRecoveryPan.panX, 'Recovered pen-up must allow finger panning');
    await input('touchEnd', []);
    await penInput('mouseReleased', 625, false);

    // A finger can land just BEFORE pen-up; its movement after pen-up must
    // work without a lift/re-touch or a cooldown.
    await reset();
    await penInput('mousePressed', 600, true);
    await input('touchStart', [touches(200)[0]]);
    await penInput('mouseReleased', 600, false);
    assert.equal(await evaluate('isPointerPanning'), true, 'Held finger must regain control at pen-up, before moving');
    const overlapPanStart = await state();
    await input('touchMove', [{ ...touches(200)[0], x: 630 }]);
    await wait(25);
    assert((await state()).panX > overlapPanStart.panX, 'A finger overlapping pen-up must recover on its first movement');
    await input('touchEnd', []);

    await reset();
    await penInput('mousePressed', 600, true);
    await input('touchStart', touches(200));
    await penInput('mouseReleased', 600, false);
    assert.equal(await evaluate('isPinching'), true, 'Held pair must regain control at pen-up, before moving');
    await input('touchMove', touches(240));
    await wait(25);
    assert((await state()).zoom > 1.05, 'A pinch overlapping pen-up must work on the first pinch packet');
    await input('touchEnd', []);

    await reset();
    await evaluate(`currentNotebook = {id:'test-memory-only'};
        pages = [{id:'test-memory-only'}]; currentPageIndex = 0;
        window.__testSaves = 0;
        API.put = async (_url, data) => {
            JSON.stringify(data);
            if (data.strokes.some(s => '_bezierPath' in s || '_fillPath' in s || '_bezierCP' in s)) throw Error('Derived stroke cache leaked into save');
            window.__testSaves++; return true;
        };`);
    await penInput('mousePressed', 600, true);
    await input('touchStart', [touches(200)[0]]);
    await penInput('mouseReleased', 600, false);
    assert.equal(await evaluate('window.__testSaves'), 0, 'Heavy document must not serialize synchronously on pen-up');
    assert.equal(await evaluate('isPointerPanning'), true);
    await wait(400);
    assert.equal(await evaluate('window.__testSaves'), 0, 'Autosave must wait while touch navigation is active');
    await input('touchEnd', []);
    await wait(900);
    assert((await evaluate('window.__testSaves')) > 0, 'Autosave must persist after navigation settles');
    await evaluate('currentNotebook = null');

    // Direct hardware handoff: proximity continues, Electron never sends up,
    // but BTN_TOUCH releases and a fresh finger must navigate immediately.
    await reset();
    await evaluate(`badnotesDirectInput({type:'touch-source', direct:true});
        badnotesDirectInput({type:'pen-contact',contact:true,proximity:true});`);
    await penInput('mousePressed', 600, true);
    await penInput('mouseMoved', 625, true);
    const strokeCountBeforeLift = await evaluate('strokes.length');
    await evaluate("badnotesDirectInput({type:'pen-contact',contact:false,proximity:true})");
    assert.equal(await evaluate('isDrawing'), false, 'Hardware tip-up must finish ink without Electron pen-up');
    assert.equal(await evaluate('penIsActive'), false, 'Hover proximity must not block direct touch');
    assert.equal(await evaluate('strokes.length'), strokeCountBeforeLift + 1, 'Tip-up must commit exactly one stroke');
    const directPoint = (id, phase, x, y=400) => evaluate(`badnotesDirectInput({type:'direct-touch',penContact:false,events:[{id:${id},phase:'${phase}',x:${x},y:${y}}]})`);
    await directPoint(71,'down',650);
    const directStart = await state();
    await directPoint(71,'move',700);
    await wait(25);
    assert((await state()).panX > directStart.panX + 40, 'Direct finger pan must work immediately while pen hovers');
    await directPoint(71,'up',700);
    await reset();
    await directPoint(72,'down',600);
    await directPoint(73,'down',800);
    await directPoint(72,'move',580);
    await directPoint(73,'move',820);
    await wait(25);
    assert((await state()).zoom > 1.15, 'Direct hardware fingers must use existing pinch camera');
    await directPoint(72,'up',580);
    await directPoint(73,'up',820);
    await penInput('mouseReleased',625,false);
    await evaluate("badnotesDirectInput({type:'touch-source',direct:false})");

    await reset();
    await evaluate(`strokes=[];currentPageTemplate='dotted';invalidateStrokeCache(false);
        redrawCanvas(true);badnotesDirectInput({type:'touch-source',direct:true});`);
    const directBatch = events => evaluate(`badnotesDirectInput({type:'direct-touch',penContact:false,events:${JSON.stringify(events)}})`);
    const pair = (distance,phase='move') => [
        {id:91,phase,x:700-distance/2,y:400},{id:92,phase,x:700+distance/2,y:400}
    ];
    await directBatch(pair(200,'down'));
    const emptyAnchor = await state();
    for (const distance of [260,180,280,160,300,150,220,200]) {
        await directBatch(pair(distance));
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))');
        const camera = await state();
        assert(Math.abs(camera.anchor-emptyAnchor.anchor)<.01, 'Fast direct pinch reversal must keep horizontal anchor');
        assert(Math.abs(camera.anchorY-emptyAnchor.anchorY)<.01, 'Fast direct pinch reversal must keep vertical anchor');
        assert.equal(await evaluate('nativeInkSnapshot===null'),true,'Dot-only page must not allocate transparent ink viewport');
    }
    const beforeLiftJitter = await state();
    await directBatch([{id:91,phase:'up',x:600,y:400},{id:92,phase:'move',x:880,y:460}]);
    await wait(15);
    const afterLiftJitter = await state();
    assert(Math.abs(afterLiftJitter.panX-beforeLiftJitter.panX)<.01, 'Large finger-lift jitter must not become sideways pan');
    assert(Math.abs(afterLiftJitter.panY-beforeLiftJitter.panY)<.01, 'Large finger-lift jitter must not become vertical pan');
    await directBatch([{id:92,phase:'up',x:880,y:460}]);
    await wait(350);
    const afterEmptyRelease = await state();
    assert(Math.abs(afterEmptyRelease.anchor-emptyAnchor.anchor)<.01, 'Zoom release must not turn into pan inertia');
    await evaluate("badnotesDirectInput({type:'touch-source',direct:false})");

    console.log(JSON.stringify({ passed: true, released, settled, reversedRelease, reversedSettle, panRelease, panSettle, ...frameStats }));
} finally {
    await input('touchCancel', []).catch(() => {});
    await call('Page.reload', { ignoreCache: true });
    socket.close();
}
