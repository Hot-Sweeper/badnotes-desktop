// ============== Drawing ==============
        // High resolution canvas for crisp sharp lines on high-DPI displays
        let baseDPR = Math.max(1, window.devicePixelRatio || 1);
        let viewportWidth = window.innerWidth;
        let viewportHeight = window.innerHeight;
        let canvasResizeObserver = null;
        let lastCanvasInteractionAt = 0;
        let settledSharpRedrawTimer = null;
        let nativeInkSnapshot = null;
        let nativeInkPrimePending = false;
        let nativeStrokeBounds = new WeakMap();
        let nativeInkBoundsCache = null;
        // Rendering bounds, not the sampled hit-test bounds: every point and
        // Bezier control point contributes, so loops, pressure and end caps
        // cannot be clipped. Warm these alongside the cooperative path build.
        function getNativeStrokeBounds(stroke) {
            const points = stroke.points;
            if (!points?.length) return null;
            const cached=nativeStrokeBounds.get(stroke);
            if (cached && cached.points===points && cached.count===points.length && cached.size===stroke.size &&
                cached.controls===stroke._bezierCP && cached.hitBounds && cached.hitBounds===stroke.bounds) return cached.bounds;
            if (stroke.isShape && !['line','rectangle','circle'].includes(stroke.tool)) return null;
            if (stroke.tool !== 'pen' && !stroke.isGeometric && !stroke.isFill &&
                !(stroke.isShape && ['line','rectangle','circle'].includes(stroke.tool))) return null;
            let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,size=Number(stroke.size)||5;
            const include = p => {
                left=Math.min(left,p.x);top=Math.min(top,p.y);
                right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);
                size=Math.max(size,Number(p.size)||0);
            };
            for (const point of points) include(point);
            if (stroke.isShape && stroke.tool === 'circle') {
                const first=points[0],last=points.at(-1),radius=Math.hypot(last.x-first.x,last.y-first.y);
                include({x:first.x-radius,y:first.y-radius});include({x:first.x+radius,y:first.y+radius});
            } else if (!stroke.isShape && points.length>2 &&
                (stroke.isGeometric ? stroke.geometryCurve : !stroke.isFill)) {
                const controls=stroke._bezierCP || getRealtimePenControlPoints(points);
                if (controls) {
                    stroke._bezierCP=controls;
                    for (const point of controls.firstControlPoints) include(point);
                    for (const point of controls.secondControlPoints) include(point);
                }
            }
            const pad=size*2+2;
            const bounds=Number.isFinite(left+top+right+bottom+pad)
                ? {x:left-pad,y:top-pad,w:right-left+pad*2,h:bottom-top+pad*2} : null;
            nativeStrokeBounds.set(stroke,{bounds,points,count:points.length,size:stroke.size,controls:stroke._bezierCP,hitBounds:stroke.bounds});
            return bounds;
        }
        function getNativeInkBounds() {
            if (nativeInkBoundsCache?.version===strokeCacheVersion) return nativeInkBoundsCache.bounds;
            let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,bounds=null;
            for (const stroke of strokes) {
                if (!stroke?.points?.length) continue;
                const b=getNativeStrokeBounds(stroke);
                // Unrecognized renderers retain the original full coverage.
                if (!b) {nativeInkBoundsCache={version:strokeCacheVersion,bounds:null};return null;}
                left=Math.min(left,b.x);top=Math.min(top,b.y);
                right=Math.max(right,b.x+b.w);bottom=Math.max(bottom,b.y+b.h);
            }
            if (Number.isFinite(left)) bounds={x:left,y:top,w:right-left,h:bottom-top};
            nativeInkBoundsCache={version:strokeCacheVersion,bounds};
            return bounds;
        }
        function releaseNativeInkSnapshot(){
            const old=nativeInkSnapshot;nativeInkSnapshot=null;
            if(!old)return;
            invalidateBitmapSampling(old.surface);
            old.surface.width=old.surface.height=0;
        }
        const inkSamplingPyramids=new WeakMap();
        // A bilinear sample cannot average dozens of source pixels when ink
        // is zoomed far out. Half-size, area-averaged levels preserve thin
        // strokes before the final subpixel filter, without replaying paths.
        function getInkSamplingLevel(source,scale,revision=strokeCacheVersion) {
            let pyramid=inkSamplingPyramids.get(source);
            if(!pyramid||pyramid.version!==revision){releaseInkSamplingPyramid(source);pyramid={version:revision,levels:[source]};inkSamplingPyramids.set(source,pyramid);}
            const sourceWidth=source.naturalWidth||source.width,sourceHeight=source.naturalHeight||source.height;
            const desired=Math.max(0,Math.floor(Math.log2(1/Math.max(scale,1e-6))));
            for(let level=pyramid.levels.length;level<=desired;level++){
                const previous=pyramid.levels[level-1],w=previous.naturalWidth||previous.width,h=previous.naturalHeight||previous.height;if(w<=1&&h<=1)break;
                const surface=document.createElement('canvas');surface.width=Math.max(1,Math.ceil(w/2));surface.height=Math.max(1,Math.ceil(h/2));
                const context=surface.getContext('2d');context.imageSmoothingEnabled=true;
                // An aligned 2:1 bilinear reduction integrates each 2x2 texel
                // footprint. Repeating it is bounded to 1/3 source pixel area.
                context.imageSmoothingQuality='low';context.drawImage(previous,0,0,surface.width,surface.height);pyramid.levels.push(surface);
            }
            const surface=pyramid.levels[Math.min(desired,pyramid.levels.length-1)];
            return{surface,x:(surface.naturalWidth||surface.width)/sourceWidth,y:(surface.naturalHeight||surface.height)/sourceHeight,filtered:surface!==source};
        }
        const invertedBitmapSurfaces=new WeakMap();
        function releaseInkSamplingPyramid(source){
            const pyramid=inkSamplingPyramids.get(source);
            if(!pyramid)return;
            inkSamplingPyramids.delete(source);
            // These levels are derived pixels, never document/source data.
            // Free their GPU backing immediately instead of waiting for GC
            // after every glyph edit or native-ink snapshot rebuild.
            for(let i=1;i<pyramid.levels.length;i++){
                const level=pyramid.levels[i],inverted=invertedBitmapSurfaces.get(level);
                if(inverted){inverted.width=inverted.height=0;invertedBitmapSurfaces.delete(level);}
                level.width=level.height=0;
            }
        }
        function invalidateBitmapSampling(source){
            releaseInkSamplingPyramid(source);
            const inverted=invertedBitmapSurfaces.get(source);
            if(inverted)inverted.width=inverted.height=0;
            invertedBitmapSurfaces.delete(source);
        }
        function invertedBitmapSurface(source){
            let surface=invertedBitmapSurfaces.get(source);if(surface)return surface;
            surface=document.createElement('canvas');surface.width=source.naturalWidth||source.width;surface.height=source.naturalHeight||source.height;
            const context=surface.getContext('2d');context.filter='invert(1)';context.drawImage(source,0,0);
            invertedBitmapSurfaces.set(source,surface);return surface;
        }
        function primeBitmapSampling(source,inverted=false){
            const pyramid=inkSamplingPyramids.get(source);if(!pyramid)return;
            if(inverted)pyramid.inverted=true;
            if(pyramid.bitmapPrimePending||pyramid.bitmapPrimed&&pyramid.inversionPrimed===!!pyramid.inverted)return;
            pyramid.bitmapPrimePending=true;let level=0;
            const next=deadline=>{
                if(inkSamplingPyramids.get(source)!==pyramid)return;
                // Warm one level between interactions, never queue a large
                // image pyramid into a pen/pinch frame's remaining budget.
                if(isDrawing||gesturePreviewActive||isPinching||isPanning||isWheelZooming||deadline.timeRemaining()<3){requestIdleCallback(next,{timeout:300});return;}
                const sample=getInkSamplingLevel(source,2**-level++,source);
                if(pyramid.inverted)invertedBitmapSurface(sample.surface);
                const size=Math.max(sample.surface.naturalWidth||sample.surface.width,sample.surface.naturalHeight||sample.surface.height);
                if(size>32)requestIdleCallback(next,{timeout:300});
                else{pyramid.bitmapPrimePending=false;pyramid.bitmapPrimed=true;pyramid.inversionPrimed=!!pyramid.inverted;}
            };
            requestIdleCallback(next,{timeout:300});
        }
        const sampledImageSources=new WeakSet();
        function drawFilteredBitmap(context,source,x,y,width,height) {
            const sw=source.naturalWidth||source.width,sh=source.naturalHeight||source.height;if(!sw||!sh)return;
            if(source.tagName==='IMG'&&!sampledImageSources.has(source)){
                sampledImageSources.add(source);source.addEventListener('load',()=>invalidateBitmapSampling(source));
            }
            const matrix=context.getTransform();
            const density=Math.max(Math.hypot(matrix.a,matrix.b)*Math.abs(width)/sw,Math.hypot(matrix.c,matrix.d)*Math.abs(height)/sh);
            // Image/glyph pixels have their own lifetime. New pen strokes must
            // not invalidate or rebuild unrelated image/font mip levels.
            const sample=getInkSamplingLevel(source,density,source);
            primeBitmapSampling(source,context.filter==='invert(1)');
            context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
            // Image inversion is immutable for each source level. Reapplying
            // a canvas filter every pinch frame creates expensive temporary
            // render passes, particularly with several scanned documents.
            let surface=sample.surface;
            if(context.filter==='invert(1)'){surface=invertedBitmapSurface(surface);context.filter='none';}
            context.drawImage(surface,x,y,width,height);context.restore();
        }
        function primeInkSamplingLevels(source) {
            const version=strokeCacheVersion;
            let level=1;
            const next=deadline=>{
                if(!strokeCacheValid||version!==strokeCacheVersion||source!==strokeCacheCanvas)return;
                if(isDrawing||gesturePreviewActive||isPinching||isPanning||isPointerPanning||isWheelZooming||window.ViewLimits?.animating||deadline.timeRemaining()<3){requestIdleCallback(next,{timeout:300});return;}
                getInkSamplingLevel(source,2**-level++);
                const pyramid=inkSamplingPyramids.get(source),last=pyramid.levels.at(-1);
                if(Math.max(last.width,last.height)>32)requestIdleCallback(next,{timeout:100});
            };
            requestIdleCallback(next,{timeout:100});
        }

        // Debug-only FPS/MS overlay (toggle with Ctrl+Shift+F or query ?debugHud=1)
        (function setupPerfHud() {
            const storageKey = 'bn-debug-hud';
            const isRequested = () => localStorage.getItem(storageKey) === 'true' || new URLSearchParams(location.search).get('debugHud') === '1';
            let hudNode = null;
            let enabled = false;
            let rafId = null;
            let last = 0;
            let lastSample = 0;
            let frames = 0;
            let fps = 0;
            let ms = 0;

            function ensureNode() {
                if (hudNode) return true;
                if (!document.body) return false;
                hudNode = document.createElement('div');
                hudNode.id = 'bn-perf-hud';
                hudNode.style.cssText = 'position:fixed;top:10px;right:10px;padding:6px 10px;font:12px/16px system-ui,-apple-system,sans-serif;background:rgba(0,0,0,0.65);color:#0f0;border:1px solid rgba(0,255,0,0.3);border-radius:6px;pointer-events:none;z-index:9999;backdrop-filter:blur(4px);';
                hudNode.textContent = '0 fps | 0.0 ms';
                document.body.appendChild(hudNode);
                return true;
            }

            function loop() {
                const now = performance.now();
                const delta = now - last;
                ms = delta;
                frames += 1;
                if (now - lastSample >= 500) {
                    fps = (frames * 1000) / (now - lastSample);
                    frames = 0;
                    lastSample = now;
                }
                if (hudNode) {
                    hudNode.textContent = `${fps.toFixed(0)} fps | ${ms.toFixed(1)} ms`;
                }
                last = now;
                rafId = requestAnimationFrame(loop);
            }

            function mount() {
                if (enabled) return;
                if (!ensureNode()) {
                    window.addEventListener('DOMContentLoaded', mount, { once: true });
                    return;
                }
                enabled = true;
                hudNode.style.display = 'block';
                last = performance.now();
                lastSample = last;
                frames = 0;
                fps = 0;
                ms = 0;
                rafId = requestAnimationFrame(loop);
            }

            function destroy() {
                if (!enabled) return;
                enabled = false;
                if (rafId) cancelAnimationFrame(rafId);
                rafId = null;
                if (hudNode) hudNode.style.display = 'none';
            }

            function toggle() {
                const next = !enabled;
                localStorage.setItem(storageKey, next ? 'true' : 'false');
                return next ? mount() : destroy();
            }

            window.BadNotesPerfHUD = { toggle, mount, destroy, shouldEnable: isRequested };

            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
                    e.preventDefault();
                    toggle();
                }
            });

            if (isRequested()) {
                mount();
            }
        })();

        function setupCanvas() {
            // OPTIMIZATION: Camera/Viewport Model
            // Canvas is securely fixed to viewport size to prevent OOM.
            // Zoom/Pan is handled via Context Transforms, not CSS Transforms on canvas.

            // Update physical canvas size (buffer) to match Viewport
            const canvasContainer = document.getElementById('canvasContainer');
            const markCanvasInteraction = () => {
                lastCanvasInteractionAt = performance.now();
                scheduleSettledHighZoomRedraw();
            };
            ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'].forEach((type) => {
                canvasContainer.addEventListener(type, markCanvasInteraction, { capture: true, passive: true });
            });
            const viewport = canvasContainer.getBoundingClientRect();
            // The canvas can initialize while a notebook/page panel is hidden.
            // Never let that transient 0×0 (or 1×1) measurement become the
            // permanent backing-store size; use the window as a safe fallback.
            viewportWidth = Math.max(1, Math.round(viewport.width || window.innerWidth));
            viewportHeight = Math.max(1, Math.round(viewport.height || window.innerHeight));
            updateBufferSize(viewportWidth, viewportHeight);

            // Set CSS size to match window
            canvasWrapper.style.width = viewportWidth + 'px';
            canvasWrapper.style.height = viewportHeight + 'px';
            canvasWrapper.style.transform = 'none'; // Remove legacy CSS transform

            // Listen to resize
            window.addEventListener('resize', handleWindowResize);
            if (typeof ResizeObserver !== 'undefined') {
                canvasResizeObserver?.disconnect();
                canvasResizeObserver = new ResizeObserver(handleWindowResize);
                canvasResizeObserver.observe(canvasContainer);
            }
            watchDevicePixelRatio();
            // Also re-measure after first paint: some layout transitions don't
            // emit a window resize, but do reveal the canvas container.
            requestAnimationFrame(handleWindowResize);

            // Listen to theme changes to invalidate stroke cache (colors may differ)
            window.addEventListener('themeChanged', handleThemeChange);

            drawTemplate();
        }

        function handleWindowResize() {
             const rect = document.getElementById('canvasContainer').getBoundingClientRect();
             if (rect.width <= 0 || rect.height <= 0) return;
             const nextDPR = Math.max(1, window.devicePixelRatio || 1);
             const dprChanged = Math.abs(nextDPR - baseDPR) > 0.001;
             if (dprChanged) {
                 baseDPR = nextDPR;
                 strokeCacheValid = false;
                 sceneCacheValid = false;
             }
             const nextWidth = Math.max(1, Math.round(rect.width));
             const nextHeight = Math.max(1, Math.round(rect.height));
             const nextBufferWidth = Math.round(nextWidth * baseDPR);
             const nextBufferHeight = Math.round(nextHeight * baseDPR);
             if (nextWidth === viewportWidth && nextHeight === viewportHeight &&
                 canvas.width === nextBufferWidth && canvas.height === nextBufferHeight && !dprChanged) return;
             viewportWidth = nextWidth;
             viewportHeight = nextHeight;
             canvasWrapper.style.width = viewportWidth + 'px';
             canvasWrapper.style.height = viewportHeight + 'px';
             updateBufferSize(viewportWidth, viewportHeight);
             if (dprChanged) scheduleStrokeCachePrime();
             redrawCanvas();
        }

        function watchDevicePixelRatio() {
            if (typeof window.matchMedia !== 'function') return;
            const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            const onResolutionChange = () => {
                media.removeEventListener?.('change', onResolutionChange);
                media.removeListener?.(onResolutionChange);
                handleWindowResize();
                watchDevicePixelRatio();
            };
            if (media.addEventListener) media.addEventListener('change', onResolutionChange, { once: true });
            else media.addListener?.(onResolutionChange);
        }

        // Theme changed - invalidate stroke cache to re-render with correct colors
        function handleThemeChange(event) {
            if(!event?.detail?.rasterInvalidated)invalidateStrokeRasterCache();
            sceneCacheValid = false;
            redrawCanvas();
        }

        function updateBufferSize(width, height) {
            const dpr = baseDPR;

            // Resize buffer to physical pixels
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);

            // CSS Style stays 100% via stylesheet or explicit
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';

            activeCanvas.width = Math.round(width * dpr);
            activeCanvas.height = Math.round(height * dpr);
            activeCanvas.style.width = width + 'px';
            activeCanvas.style.height = height + 'px';

            // Reset context properties after resize (canvas clear resets state)
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            activeCtx.lineCap = 'round';
            activeCtx.lineJoin = 'round';
        }

        function clearActiveCanvas() {
            activeCtx.save();
            activeCtx.setTransform(1, 0, 0, 1, 0, 0);
            activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
            activeCtx.restore();
        }

        // Legacy function kept for API compatibility but modified
        function updateCanvasResolution() {
            // No-op in Camera model. Resolution is always window.devicePixelRatio.
            // We triggered redrawCanvas on zoom instead.
        }

        let gridShiftX = 0;
        let gridShiftY = 0;
        let redrawPending = false;
        let redrawFrame = 0;

        // ============== PERFORMANCE: Pan-Only Fast Path ==============\n        // Track if only pan changed (not zoom or content) for fast redraw\n        let lastRenderedPanX = 0;\n        let lastRenderedPanY = 0;\n        let lastRenderedZoom = 1;\n        let isPanOnlyMode = false; // True during active panning gesture\n        \n        // Full scene rendered to offscreen canvas for instant pan\n        let sceneCache = null;\n        let sceneCacheCtx = null;\n        let sceneCacheValid = false;\n        let sceneCacheZoom = 1;\n        \n        function initSceneCache() {\n            if (!sceneCache) {\n                sceneCache = document.createElement('canvas');\n                sceneCacheCtx = sceneCache.getContext('2d', { alpha: false });\n            }\n            // Make cache larger than viewport to allow panning without redraw\n            const padding = 500; // Extra pixels on each side\n            const w = (window.innerWidth + padding * 2) * baseDPR;\n            const h = (window.innerHeight + padding * 2) * baseDPR;\n            if (sceneCache.width !== w || sceneCache.height !== h) {\n                sceneCache.width = w;\n                sceneCache.height = h;\n                sceneCacheValid = false;\n            }\n        }\n        \n        // ============== PERFORMANCE: Stroke Caching System ==============\n        // Pre-render static strokes to offscreen canvas for massive performance gains\n        // OPTIMIZED: Lower threshold to 50 strokes for better pan/zoom responsiveness

        let strokeCacheCanvas = null;
        let strokeCacheCtx = null;
        let strokeCacheValid = false;
        let strokeCacheVersion = 0; // Incremented when strokes change
        let lastCachedStrokeCount = 0;
        let lastCachedStrokeVersion = -1;
        let lastCachedZoom = 1; // Track zoom level cache was built at
        let lastStrokeCacheTheme = null;
        let strokeCachePrimeTimer = null;
        let strokeCacheBuildId = 0;
        let strokeCacheBuildSurface = null;
        function releasePendingStrokeCacheBuild() {
            if (!strokeCacheBuildSurface) return;
            strokeCacheBuildSurface.width=strokeCacheBuildSurface.height=0;
            strokeCacheBuildSurface=null;
        }

        // Derived vector batches reduce per-stroke Canvas calls without
        // flattening or replacing the editable stroke data. Keep batches in
        // chronological chunks so shapes/colors retain their original order.
        const VECTOR_BATCH_MAX_STROKES = 64;
        const VECTOR_INDEX_CELL_SIZE = 32;
        const VECTOR_INDEX_MAX_CELLS_PER_COMMAND = 64;
        let vectorStrokeCommandsCache = null;
        let vectorStrokeBuildId = 0;

        // Initialize stroke cache canvas
        function initStrokeCache() {
            if (!strokeCacheCanvas) {
                strokeCacheCanvas = document.createElement('canvas');
                strokeCacheCtx = strokeCacheCanvas.getContext('2d', { alpha: true });
                // Cap initial size to prevent huge allocations on big pages
                const maxDim = 4096;
                const initW = Math.min(Math.ceil(baseWidth * baseDPR), maxDim);
                const initH = Math.min(Math.ceil(baseHeight * baseDPR), maxDim);
                strokeCacheCanvas.width = initW;
                strokeCacheCanvas.height = initH;
                strokeCacheCtx.lineCap = 'round';
                strokeCacheCtx.lineJoin = 'round';
            }
        }

        // Invalidate stroke cache when strokes change
        function invalidateStrokeCache(geometryChanged = true) {
            releaseNativeInkSnapshot();
            strokeCacheValid = false;
            strokeCacheVersion++;
            strokeCacheBuildId++;
            releasePendingStrokeCacheBuild();
            vectorStrokeBuildId++;
            vectorStrokeCommandsCache = null;
            scheduleStrokeCachePrime();
            if (!geometryChanged) return;
            nativeStrokeBounds = new WeakMap();
            // Clear cached bezier control points (points may have changed)
            for (const s of strokes) {
                if (!s) continue;
                if (s._bezierCP) delete s._bezierCP;
                if (s._bezierPath) delete s._bezierPath;
                if (s._fillPath) delete s._fillPath;
            }
        }

        // Theme changes affect cached pixels, not stroke geometry or vector
        // paths. Keep the geometry cache intact and rebuild only raster ink.
        function invalidateStrokeRasterCache() {
            releaseNativeInkSnapshot();
            strokeCacheValid = false;
            strokeCacheBuildId++;
            releasePendingStrokeCacheBuild();
            scheduleStrokeCachePrime();
        }

        // Expose cache invalidation globally for use by other modules
        window.invalidateStrokeCache = invalidateStrokeCache;
        window.invalidateStrokeRasterCache = invalidateStrokeRasterCache;

        function isBatchableVectorPenStroke(stroke) {
            return !!stroke && stroke.tool === 'pen' && !stroke.isShape && !stroke.geometryFill && !stroke.geometryDashed &&
                !stroke.isFill && stroke.type !== 'fill' && stroke.points?.length >= 1 &&
                stroke.points.every(point => point.size === undefined || Number(point.size) === Number(stroke.size));
        }

        function getVectorPenPath(stroke) {
            if (stroke._bezierPath) return stroke._bezierPath;
            if (typeof Path2D === 'undefined') return null;

            const points = stroke.points;
            const path = new Path2D();
            path.moveTo(points[0].x, points[0].y);
            if (stroke.isGeometric && !stroke.geometryCurve) {
                for(let i=1;i<points.length;i++) {
                    if(points[i].break)path.moveTo(points[i].x,points[i].y);
                    else path.lineTo(points[i].x,points[i].y);
                }
            } else if (points.length === 1) {
                // A zero-length segment with a round cap is the same dot as
                // the individual circle renderer, and can share pen batches.
                path.lineTo(points[0].x, points[0].y);
            } else if (points.length === 2) {
                path.lineTo(points[1].x, points[1].y);
            } else {
                const controlPoints = stroke._bezierCP || getRealtimePenControlPoints(points);
                if (!controlPoints) return null;
                stroke._bezierCP = controlPoints;
                for (let i = 0; i < points.length - 1; i++) {
                    path.bezierCurveTo(
                        controlPoints.firstControlPoints[i].x,
                        controlPoints.firstControlPoints[i].y,
                        controlPoints.secondControlPoints[i].x,
                        controlPoints.secondControlPoints[i].y,
                        points[i + 1].x,
                        points[i + 1].y
                    );
                }
            }
            Object.defineProperty(stroke, '_bezierPath', {
                value: path,
                writable: true,
                configurable: true,
                enumerable: false
            });
            return path;
        }

        // Build the vector refinement cache cooperatively. A synchronous pass
        // over thousands of strokes can freeze the UI exactly when a user
        // stops zooming; each idle slice now does a small bounded amount of
        // path and index work, and the bitmap remains visible until complete.
        function startVectorStrokeCommandBuild() {
            const buildId = ++vectorStrokeBuildId;
            const buildVersion = strokeCacheVersion;
            const buildStrokes = strokes.slice();
            const state = {
                id: buildId,
                version: buildVersion,
                source: buildStrokes,
                cursor: 0,
                commands: [],
                batch: null,
                cells: new Map(),
                oversized: [],
                cellSize: VECTOR_INDEX_CELL_SIZE
            };
            vectorStrokeCommandsCache = { version: buildVersion, building: true };

            const addIndexEntry = (command) => {
                const index = state.commands.length;
                command.order = index;
                state.commands.push(command);
                const bounds = command.bounds;
                if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
                    state.oversized.push(index);
                    return;
                }
                const minX = Math.floor(bounds.x / state.cellSize);
                const minY = Math.floor(bounds.y / state.cellSize);
                const maxX = Math.floor((bounds.x + bounds.w) / state.cellSize);
                const maxY = Math.floor((bounds.y + bounds.h) / state.cellSize);
                const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
                if (cellCount > VECTOR_INDEX_MAX_CELLS_PER_COMMAND) {
                    state.oversized.push(index);
                    return;
                }
                for (let cellX = minX; cellX <= maxX; cellX++) {
                    for (let cellY = minY; cellY <= maxY; cellY++) {
                        const key = `${cellX},${cellY}`;
                        let bucket = state.cells.get(key);
                        if (!bucket) state.cells.set(key, bucket = []);
                        bucket.push(index);
                    }
                }
            };

            const flushBatch = () => {
                if (!state.batch) return;
                const batch = state.batch;
                state.batch = null;
                if (batch.count === 1) {
                    const stroke = batch.firstStroke;
                    addIndexEntry({ kind: 'stroke', stroke, bounds: getNativeStrokeBounds(stroke) || stroke.bounds || null });
                } else if (batch.count > 1) {
                    addIndexEntry(batch);
                }
            };

            const scheduleSlice = () => {
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(renderSlice, { timeout: 80 });
                } else {
                    setTimeout(() => requestAnimationFrame(renderSlice), 0);
                }
            };

            const finish = () => {
                flushBatch();
                if (state.id !== vectorStrokeBuildId || state.version !== strokeCacheVersion) return;
                vectorStrokeCommandsCache = {
                    version: buildVersion,
                    commands: state.commands,
                    spatialIndex: {
                        cells: state.cells,
                        oversized: state.oversized,
                        cellSize: state.cellSize,
                        commandCount: state.commands.length
                    }
                };
                redrawCanvas();
            };

            const renderSlice = (deadline) => {
                if (state.id !== vectorStrokeBuildId || state.version !== strokeCacheVersion) return;
                const moving = gesturePreviewActive || isPinching || isPanning || isPointerPanning || isWheelZooming || window.ViewLimits?.animating;
                if (isDrawing || (moving && (!deadline || deadline.timeRemaining() < 3))) {
                    setTimeout(scheduleSlice, moving ? 16 : 80);
                    return;
                }

                const sliceStart = performance.now();
                // Finish batching in genuinely spare time even if a gesture
                // started during loading; never starve the cache until release.
                const budget = moving ? .5 : 2;
                while (state.cursor < state.source.length && performance.now() - sliceStart < budget) {
                    const stroke = state.source[state.cursor++];
                    if (stroke?.points?.length) {
                        if (!stroke.bounds) stroke.bounds=computeStrokeBounds(stroke);
                        getNativeStrokeBounds(stroke);
                    }
                    if (!stroke || stroke.isFill || stroke.type === 'fill') continue;
                    if (!isBatchableVectorPenStroke(stroke)) {
                        flushBatch();
                        if (stroke.points?.length > 0 && !stroke.bounds) stroke.bounds = computeStrokeBounds(stroke);
                        addIndexEntry({ kind: 'stroke', stroke, bounds: getNativeStrokeBounds(stroke) || stroke.bounds || null });
                        continue;
                    }

                    const styleKey = `${stroke.color || ''}|${Number(stroke.size) || 1}`;
                    if (state.batch && (state.batch.styleKey !== styleKey || state.batch.count >= VECTOR_BATCH_MAX_STROKES)) flushBatch();
                    if (!state.batch) {
                        state.batch = {
                            kind: 'path-batch',
                            path: new Path2D(),
                            styleKey,
                            color: stroke.color,
                            size: Number(stroke.size) || 1,
                            count: 0,
                            firstStroke: stroke,
                            members: [],
                            bounds: null
                        };
                    }
                    const path = getVectorPenPath(stroke);
                    if (!path) {
                        flushBatch();
                        if (!stroke.bounds) stroke.bounds = computeStrokeBounds(stroke);
                        addIndexEntry({ kind: 'stroke', stroke, bounds: getNativeStrokeBounds(stroke) || stroke.bounds || null });
                        continue;
                    }
                    state.batch.path.addPath(path);
                    state.batch.count++;
                    state.batch.members.push(stroke);
                    if (!stroke.bounds) stroke.bounds = computeStrokeBounds(stroke);
                    const renderBounds=getNativeStrokeBounds(stroke)||stroke.bounds;
                    if (renderBounds) {
                        if (!state.batch.bounds) state.batch.bounds = { ...renderBounds };
                        else {
                            const left = Math.min(state.batch.bounds.x, renderBounds.x);
                            const top = Math.min(state.batch.bounds.y, renderBounds.y);
                            const right = Math.max(state.batch.bounds.x + state.batch.bounds.w, renderBounds.x + renderBounds.w);
                            const bottom = Math.max(state.batch.bounds.y + state.batch.bounds.h, renderBounds.y + renderBounds.h);
                            state.batch.bounds = { x: left, y: top, w: right - left, h: bottom - top };
                        }
                    }
                }

                if (state.cursor < state.source.length) scheduleSlice();
                else finish();
            };

            scheduleSlice();
        }

        function getVisibleVectorCommandIndices(index, visibleRect) {
            const minX = Math.floor(visibleRect.x / index.cellSize);
            const minY = Math.floor(visibleRect.y / index.cellSize);
            const maxX = Math.floor((visibleRect.x + visibleRect.w) / index.cellSize);
            const maxY = Math.floor((visibleRect.y + visibleRect.h) / index.cellSize);
            const queryCellCount = (maxX - minX + 1) * (maxY - minY + 1);
            if (queryCellCount > 256) return null;

            const candidates = new Set(index.oversized);
            for (let cellX = minX; cellX <= maxX; cellX++) {
                for (let cellY = minY; cellY <= maxY; cellY++) {
                    const bucket = index.cells.get(`${cellX},${cellY}`);
                    if (!bucket) continue;
                    for (const commandIndex of bucket) candidates.add(commandIndex);
                }
            }

            return Array.from(candidates).sort((a, b) => a - b);
        }

        function drawVectorStrokeCommands(visibleRect, targetCtx = ctx) {
            if (!vectorStrokeCommandsCache || vectorStrokeCommandsCache.version !== strokeCacheVersion) {
                if (typeof Path2D !== 'undefined' && Path2D.prototype.addPath) {
                    startVectorStrokeCommandBuild();
                } else {
                    vectorStrokeCommandsCache = { version: strokeCacheVersion, commands: null, spatialIndex: null };
                }
            }

            const commands = vectorStrokeCommandsCache.commands;
            // A cache under construction is not an empty document. Keep ink
            // visible until the replacement command list is ready.
            if (vectorStrokeCommandsCache.building) {
                drawStrokesIndividually(visibleRect, targetCtx);
                return;
            }
            if (!commands) {
                drawStrokesIndividually(visibleRect, targetCtx);
                return;
            }

            const commandIndices = vectorStrokeCommandsCache.spatialIndex
                ? getVisibleVectorCommandIndices(vectorStrokeCommandsCache.spatialIndex, visibleRect)
                : null;
            const candidateCount = commandIndices ? commandIndices.length : commands.length;
            for (let candidate = 0; candidate < candidateCount; candidate++) {
                const command = commands[commandIndices ? commandIndices[candidate] : candidate];
                if (command.bounds && !rectIntersect(command.bounds, visibleRect)) continue;
                if (command.kind === 'stroke') {
                    const stroke = command.stroke;
                    if (stroke.points?.length > 0 && !stroke.bounds) stroke.bounds = computeStrokeBounds(stroke);
                    if (command.bounds && !rectIntersect(command.bounds, visibleRect)) continue;
                    drawStrokeToContext(stroke, targetCtx);
                    continue;
                }

                // At high zoom, cull strokes inside a partially visible batch
                // instead of sending a page-spanning path to the rasterizer.
                const bounds = command.bounds;
                const batchFullyVisible = bounds && bounds.x >= visibleRect.x && bounds.y >= visibleRect.y &&
                    bounds.x + bounds.w <= visibleRect.x + visibleRect.w &&
                    bounds.y + bounds.h <= visibleRect.y + visibleRect.h;
                let visiblePath=command.path;
                if (!batchFullyVisible) {
                    const memberIndices=[];
                    const visibleMembers = command.members.filter((stroke,index) => {
                        const bounds=getNativeStrokeBounds(stroke)||stroke.bounds;
                        const visible=!bounds||rectIntersect(bounds,visibleRect);
                        if(visible)memberIndices.push(index);
                        return visible;
                    });
                    // Don't explode a mostly visible batch into thousands of
                    // separate draw calls just because one edge is clipped.
                    // The canvas/GPU clips a cached Path2D efficiently itself.
                    if (visibleMembers.length <= command.members.length / 4) {
                      for (const stroke of visibleMembers) {
                        drawStrokeToContext(stroke, targetCtx);
                      }
                      continue;
                    }
                    if (visibleMembers.length<command.members.length) {
                        // Preserve one merged stroke and its original order,
                        // but do not tessellate offscreen glyphs/curves. A
                        // partially visible large batch was sending the whole
                        // page-spanning path to the GPU for every rebuild.
                        const key=memberIndices.join(',');
                        const paths=command.visiblePaths||(command.visiblePaths=new Map());
                        visiblePath=paths.get(key);
                        if (!visiblePath) {
                            visiblePath=new Path2D();
                            for(const stroke of visibleMembers) visiblePath.addPath(getVectorPenPath(stroke));
                        }
                        paths.delete(key);paths.set(key,visiblePath);
                        // A tiny per-batch LRU retains GPU path identities for
                        // repeated views without an unbounded geometry cache.
                        while(paths.size>2)paths.delete(paths.keys().next().value);
                    }
                }

                targetCtx.save();
                targetCtx.globalAlpha = 1;
                targetCtx.globalCompositeOperation = 'source-over';
                targetCtx.strokeStyle = getThemedColor(command.color);
                targetCtx.lineWidth = command.size;
                targetCtx.lineCap = 'round';
                targetCtx.lineJoin = 'round';
                targetCtx.stroke(visiblePath);
                targetCtx.restore();
            }
        }

        // New pen/shape strokes are always topmost. If the snapshot still
        // exactly represents the existing strokes, append this one stroke
        // instead of invalidating and replaying the entire document.
        function appendStrokeToCache(stroke) {
            const rasterReady = strokeCacheValid && strokeCacheCanvas && strokeCacheCtx &&
                lastCachedStrokeCount === strokes.length - 1 &&
                lastCachedStrokeVersion === strokeCacheVersion;
            const vectorReady = vectorStrokeCommandsCache && !vectorStrokeCommandsCache.building &&
                vectorStrokeCommandsCache.version === strokeCacheVersion &&
                Array.isArray(vectorStrokeCommandsCache.commands) && !stroke.isFill && stroke.type !== 'fill';
            const snapshotReady = nativeInkSnapshot && nativeInkSnapshot.version === strokeCacheVersion &&
                !stroke.isFill && stroke.type !== 'fill';
            if (!rasterReady && !vectorReady && !snapshotReady) return false;

            if (rasterReady) {
                strokeCacheCtx.save();
                const scale = lastCachedZoom * baseDPR;
                strokeCacheCtx.setTransform(scale, 0, 0, scale, 0, 0);
                drawStrokeToContext(stroke, strokeCacheCtx);
                strokeCacheCtx.restore();
            }

            strokeCacheVersion++;
            if (snapshotReady) {
                const snapshot=nativeInkSnapshot,bounds=getNativeStrokeBounds(stroke);
                const sampling=snapshot.zoom*snapshot.dpr;
                if (snapshot.cropped && (!bounds || bounds.x<snapshot.paintX || bounds.y<snapshot.paintY ||
                    bounds.x+bounds.w>snapshot.paintX+snapshot.surface.width/sampling ||
                    bounds.y+bounds.h>snapshot.paintY+snapshot.surface.height/sampling)) {
                    // A new stroke can occupy formerly transparent coverage.
                    // Do not mark a clipped incremental update as complete.
                    releaseNativeInkSnapshot();
                } else {
                    drawStrokeToContext(stroke, snapshot.context);
                    snapshot.version = strokeCacheVersion;
                }
            }
            strokeCacheBuildId++;
            releasePendingStrokeCacheBuild();
            vectorStrokeBuildId++;
            if (vectorReady) {
                if (!stroke.bounds && stroke.points?.length) stroke.bounds = computeStrokeBounds(stroke);
                const cache = vectorStrokeCommandsCache;
                const index = cache.commands.length;
                cache.commands.push({ kind: 'stroke', stroke, bounds: getNativeStrokeBounds(stroke) || stroke.bounds || null, order: index });
                cache.version = strokeCacheVersion;
                if (cache.spatialIndex) {
                    cache.spatialIndex.oversized.push(index);
                    cache.spatialIndex.commandCount = cache.commands.length;
                }
            } else {
                vectorStrokeCommandsCache = null;
            }
            if (rasterReady) {
                lastCachedStrokeCount = strokes.length;
                lastCachedStrokeVersion = strokeCacheVersion;
            } else {
                scheduleStrokeCachePrime();
            }
            if (rasterReady && strokeCachePrimeTimer) {
                clearTimeout(strokeCachePrimeTimer);
                strokeCachePrimeTimer = null;
            }
            return true;
        }

        function drawStrokesIndividually(visibleRect, targetCtx = ctx) {
            for (const stroke of strokes) {
                if (!stroke || stroke.isFill || stroke.type === 'fill') continue;
                if (stroke.points?.length > 0 && !stroke.bounds) stroke.bounds = computeStrokeBounds(stroke);
                if (stroke.bounds && !rectIntersect(stroke.bounds, visibleRect)) continue;
                drawStrokeToContext(stroke, targetCtx);
            }
        }

        // Cache only the nearby viewport, at the exact camera zoom/DPR. Pan
        // translates these native pixels without magnifying a page-sized cache.
        function drawNativeInkSnapshot(view, cameraX, cameraY, shiftX, shiftY, paint = true) {
            if (strokes.length === 0) {
                releaseNativeInkSnapshot();
                return;
            }
            const theme = settings.theme || (isDarkMode ? 'dark' : 'light');
            let snapshot = nativeInkSnapshot;
            const fits = snapshot && snapshot.version === strokeCacheVersion && snapshot.zoom >= zoom &&
                snapshot.dpr === baseDPR && snapshot.theme === theme &&
                (snapshot.completeInk || (view.x >= snapshot.x && view.y >= snapshot.y &&
                view.x + view.w <= snapshot.x + snapshot.w && view.y + view.h <= snapshot.y + snapshot.h));
            if (!fits) {
                const padding = 320 / zoom;
                const x = view.x - padding, y = view.y - padding;
                const w = view.w + padding * 2, h = view.h + padding * 2;
                // Reserve 75% more sampling density, not fewer pixels. Pinch
                // frames may downsample this buffer but never magnify it.
                const density = zoom * 1.75;
                const surface = snapshot?.surface || document.createElement('canvas');
                // Setting even an unchanged canvas dimension destroys its GPU
                // backing store. Bucket dimensions to absorb floating-point
                // rounding, and reuse the allocation across rapid zooms.
                const sampling=density*baseDPR;
                const fullWidth=Math.ceil(w*sampling/64)*64,fullHeight=Math.ceil(h*sampling/64)*64;
                const ink=getNativeInkBounds();
                // Empty viewport coverage need not allocate millions of
                // transparent texels. Keep the logical padded region for
                // cache hits, but rasterize only its conservative ink bounds.
                // Align to the original texel/mip lattice, not world pixels.
                // Include the elastic stretch below the 20% resting limit.
                const tile=Math.max(64,2**Math.floor(Math.log2(density/.15))),bleed=64;
                const inkStartX=ink?Math.floor(((ink.x-x)*sampling-bleed)/tile)*tile:0;
                const inkStartY=ink?Math.floor(((ink.y-y)*sampling-bleed)/tile)*tile:0;
                const inkEndX=ink?Math.ceil(((ink.x+ink.w-x)*sampling+bleed)/tile)*tile:fullWidth;
                const inkEndY=ink?Math.ceil(((ink.y+ink.h-y)*sampling+bleed)/tile)*tile:fullHeight;
                // If all the ink costs less than the old padded viewport,
                // keep it complete. Expanding into transparent world space
                // then needs no raster rebuild, even across a long zoom-out.
                const completeInk=!!ink && (inkEndX-inkStartX)*(inkEndY-inkStartY)<=fullWidth*fullHeight &&
                    inkEndX-inkStartX<=Math.max(8192,fullWidth) && inkEndY-inkStartY<=Math.max(8192,fullHeight);
                const offsetX=completeInk?inkStartX:Math.max(0,Math.min(fullWidth,inkStartX));
                const offsetY=completeInk?inkStartY:Math.max(0,Math.min(fullHeight,inkStartY));
                const endX=completeInk?inkEndX:Math.max(offsetX,Math.min(fullWidth,inkEndX));
                const endY=completeInk?inkEndY:Math.max(offsetY,Math.min(fullHeight,inkEndY));
                const width=Math.max(64,endX-offsetX),height=Math.max(64,endY-offsetY);
                const paintX=x+offsetX/sampling,paintY=y+offsetY/sampling;
                if (surface.width !== width) surface.width = width;
                if (surface.height !== height) surface.height = height;
                const context = surface.getContext('2d');
                releaseInkSamplingPyramid(surface);
                context.setTransform(1,0,0,1,0,0);
                context.clearRect(0,0,surface.width,surface.height);
                context.setTransform(sampling, 0, 0, sampling, -x * sampling-offsetX, -y * sampling-offsetY);
                const region = completeInk?{x:paintX,y:paintY,w:width/sampling,h:height/sampling}:{x,y,w,h};
                for (const stroke of strokes) {
                    if (!stroke || !(stroke.isFill || stroke.type === 'fill')) continue;
                    if (stroke.bounds && !rectIntersect(stroke.bounds, region)) continue;
                    drawStrokeToContext(stroke, context);
                }
                drawVectorStrokeCommands(region, context);
                snapshot = nativeInkSnapshot = {surface, context, x,y,w,h,paintX,paintY,completeInk,cropped:completeInk||width<fullWidth||height<fullHeight,zoom:density,dpr:baseDPR,theme,version:strokeCacheVersion};
            }
            if (!paint) return;
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            const ratio = zoom / snapshot.zoom;
            const sample=getInkSamplingLevel(snapshot.surface,ratio);
            ctx.imageSmoothingQuality = sample.filtered?'high':'low';
            ctx.setTransform(ratio,0,0,ratio, (cameraX + (snapshot.paintX + shiftX) * zoom) * baseDPR,
                (cameraY + (snapshot.paintY + shiftY) * zoom) * baseDPR);
            // Only sample the nearby visible region, not the full padded
            // multi-megapixel surface on every display frame.
            const sampling = snapshot.zoom * baseDPR;
            const sourceX = Math.max(0,(view.x-snapshot.paintX)*sampling);
            const sourceY = Math.max(0,(view.y-snapshot.paintY)*sampling);
            const sourceW = Math.min(snapshot.surface.width,(view.x+view.w-snapshot.paintX)*sampling)-sourceX;
            const sourceH = Math.min(snapshot.surface.height,(view.y+view.h-snapshot.paintY)*sampling)-sourceY;
            if (sourceW>0&&sourceH>0) ctx.drawImage(sample.surface,sourceX*sample.x,sourceY*sample.y,sourceW*sample.x,sourceH*sample.y,sourceX,sourceY,sourceW,sourceH);
            ctx.restore();
        }

        function primeNativeInkSnapshot(view, cameraX, cameraY, shiftX, shiftY) {
            if (strokes.length === 0) return;
            const snapshot = nativeInkSnapshot;
            const ready = snapshot && snapshot.version === strokeCacheVersion && snapshot.zoom >= zoom &&
                snapshot.dpr === baseDPR && (snapshot.completeInk || (view.x >= snapshot.x && view.y >= snapshot.y &&
                view.x + view.w <= snapshot.x + snapshot.w && view.y + view.h <= snapshot.y + snapshot.h));
            if (nativeInkPrimePending || ready) return;
            nativeInkPrimePending = true;
            const expectedZoom = zoom, expectedVersion = strokeCacheVersion;
            requestIdleCallback(() => {
                nativeInkPrimePending = false;
                if (isDrawing || gesturePreviewActive || isPanning || isPinching || isWheelZooming ||
                    window.ViewLimits?.animating ||
                    zoom !== expectedZoom || strokeCacheVersion !== expectedVersion) return;
                drawNativeInkSnapshot(view, cameraX, cameraY, shiftX, shiftY, false);
            });
        }

        // DEFERRED HIGH-RES CACHE REBUILD
        // Rebuilds cache at higher resolution ONLY when user stops interacting
        let pendingHighResRebuild = null;
        let highResRebuildTimer = null;

        function scheduleHighResRebuild(targetZoom) {
            if (strokes.length === 0) return;
            pendingHighResRebuild = targetZoom;

            // Cancel any existing timer
            if (highResRebuildTimer) {
                clearTimeout(highResRebuildTimer);
            }

            // Wait 150ms of inactivity before rebuilding
            highResRebuildTimer = setTimeout(() => {
                highResRebuildTimer = null;
                if (pendingHighResRebuild) {
                    if (isPinching || isPanning || isPointerPanning || isWheelZooming || isDrawing) {
                        // Keep deferring while the user is actively navigating.
                        scheduleHighResRebuild(pendingHighResRebuild);
                    } else {
                        const targetZoom = pendingHighResRebuild;
                        pendingHighResRebuild = null;
                        executeHighResRebuild(targetZoom);
                    }
                }
            }, 150);
        }

        function scheduleSettledHighZoomRedraw() {
            if (zoom / Math.max(0.01, lastCachedZoom) <= 1.1) return;
            if (settledSharpRedrawTimer) clearTimeout(settledSharpRedrawTimer);
            settledSharpRedrawTimer = setTimeout(() => {
                if (performance.now() - lastCanvasInteractionAt < 100 || isDrawing ||
                    gesturePreviewActive || isPinching || isPanning || isPointerPanning || isWheelZooming) {
                    scheduleSettledHighZoomRedraw();
                    return;
                }
                settledSharpRedrawTimer = null;
                redrawCanvas();
            }, 110);
        }

        function executeHighResRebuild(targetZoom) {
            if (strokes.length === 0) return;
            beginStrokeCacheBuild(targetZoom);
        }

        function getStrokeCacheZoom(targetZoom) {
            const dpr = baseDPR;
            const requestedZoom = Math.max(0.05, Number(targetZoom) || 1);
            const maxSide = 8192;
            const maxPixels = 16 * 1024 * 1024;
            const requestedPixels = Math.max(1, baseWidth * baseHeight * requestedZoom * requestedZoom * dpr * dpr);
            const scale = Math.min(
                1,
                maxSide / (Math.max(baseWidth, baseHeight) * requestedZoom * dpr),
                Math.sqrt(maxPixels / requestedPixels)
            );
            return requestedZoom * scale;
        }

        function beginStrokeCacheBuild(targetZoom = zoom) {
            if (strokes.length === 0) return;
            const dpr = baseDPR;
            const cacheZoom = getStrokeCacheZoom(targetZoom);

            if (strokeCacheValid && lastCachedStrokeCount === strokes.length &&
                lastCachedStrokeVersion === strokeCacheVersion &&
                lastCachedZoom >= cacheZoom * .999) return;

            const buildId = ++strokeCacheBuildId;
            releasePendingStrokeCacheBuild();
            const buildVersion = strokeCacheVersion;
            const buildStrokes = strokes.slice();
            const cacheW = Math.max(1, Math.ceil(baseWidth * cacheZoom * dpr));
            const cacheH = Math.max(1, Math.ceil(baseHeight * cacheZoom * dpr));
            const buildCanvas = document.createElement('canvas');
            const buildCtx = buildCanvas.getContext('2d', { alpha: true });
            strokeCacheBuildSurface=buildCanvas;
            let allocated=false;

            let phase = 0;
            let index = 0;
            const scheduleSlice = () => {
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(renderSlice, { timeout: 40 });
                } else {
                    setTimeout(() => requestAnimationFrame(renderSlice), 0);
                }
            };
            const renderSlice = () => {
                if (buildId !== strokeCacheBuildId || buildVersion !== strokeCacheVersion) return;
                if (isDrawing || gesturePreviewActive || isPinching || isPanning || isPointerPanning || isWheelZooming || window.ViewLimits?.animating) {
                    scheduleSlice();
                    return;
                }
                // Do not reserve a full-page GPU surface for a build that is
                // still waiting for input to stop (and may be cancelled).
                if (!allocated) {
                    allocated=true;buildCanvas.width=cacheW;buildCanvas.height=cacheH;
                    buildCtx.lineCap='round';buildCtx.lineJoin='round';
                    buildCtx.setTransform(cacheZoom*dpr,0,0,cacheZoom*dpr,0,0);
                }

                const sliceStart = performance.now();
                while (phase < 2 && performance.now() - sliceStart < 2) {
                    if (index >= buildStrokes.length) {
                        phase++;
                        index = 0;
                        continue;
                    }
                    const stroke = buildStrokes[index++];
                    const isFill = !!stroke && (stroke.isFill || stroke.type === 'fill');
                    if (stroke && (phase === 0 ? isFill : !isFill)) {
                        drawStrokeToContext(stroke, buildCtx);
                    }
                }

                if (phase < 2) {
                    scheduleSlice();
                    return;
                }

                if (buildId !== strokeCacheBuildId || buildVersion !== strokeCacheVersion ||
                    buildStrokes.length !== strokes.length) {
                    if (strokeCacheBuildSurface===buildCanvas) releasePendingStrokeCacheBuild();
                    return;
                }
                const retired=strokeCacheCanvas;
                strokeCacheCanvas = buildCanvas;
                strokeCacheCtx = buildCtx;
                strokeCacheBuildSurface=null;
                if (retired&&retired!==buildCanvas) {
                    invalidateBitmapSampling(retired);
                    retired.width=retired.height=0;
                }
                strokeCacheValid = true;
                lastCachedStrokeCount = buildStrokes.length;
                lastCachedStrokeVersion = buildVersion;
                lastCachedZoom = cacheZoom;
                lastStrokeCacheTheme = settings.theme || (isDarkMode ? 'dark' : 'light');
                primeInkSamplingLevels(buildCanvas);
                if (!vectorStrokeCommandsCache || vectorStrokeCommandsCache.version !== strokeCacheVersion) {
                    startVectorStrokeCommandBuild();
                }
                redrawCanvas();
            };

            scheduleSlice();
        }

        // Reusable temp canvas for highlighter (avoid creating per stroke per frame!)
        let highlighterTempCanvas = null;
        let highlighterTempCtx = null;

        function getHighlighterTempCanvas(targetCtx = null) {
            if (!highlighterTempCanvas) {
                highlighterTempCanvas = document.createElement('canvas');
                highlighterTempCtx = highlighterTempCanvas.getContext('2d', { alpha: true });
            }
            const targetCanvas = targetCtx?.canvas || canvas;
            if (highlighterTempCanvas.width !== targetCanvas.width || highlighterTempCanvas.height !== targetCanvas.height) {
                highlighterTempCanvas.width = targetCanvas.width;
                highlighterTempCanvas.height = targetCanvas.height;
            }
            return { canvas: highlighterTempCanvas, ctx: highlighterTempCtx };
        }

        // Throttle redraws to once per animation frame to prevent redundant full-canvas work
        function redrawCanvas(force = false) {
            if (force) {
                if (redrawFrame) cancelAnimationFrame(redrawFrame);
                redrawFrame = 0;
                redrawPending = false;
                return _redrawCanvas();
            }

            if (redrawPending) return;
            redrawPending = true;
            redrawFrame = requestAnimationFrame(() => {
                redrawFrame = 0;
                redrawPending = false;
                _redrawCanvas();
            });
        }

        // ============== PERFORMANCE: Optimized Pan/Zoom ==============
        // Camera model: canvas is fixed, we move the viewport over it
        // Strokes are in world coordinates, transformed by context matrix

        // No-op functions kept for API compatibility with event handlers
        function enterPanFastPath() {
            // Stroke cache handles performance now
        }

        function updatePanFastPath() {
            // Just do immediate redraw - stroke cache makes it fast
            redrawCanvas(true);
        }

        function exitPanFastPath() {
            // No-op, redraw already happened
        }

        function rebuildStrokeCacheNow() {
            beginStrokeCacheBuild(zoom);
        }

        function scheduleStrokeCachePrime() {
            if (strokeCachePrimeTimer) clearTimeout(strokeCachePrimeTimer);
            if (strokes.length === 0) {
                strokeCachePrimeTimer = null;
                return;
            }
            strokeCachePrimeTimer = setTimeout(() => {
                strokeCachePrimeTimer = null;
                if (isDrawing || gesturePreviewActive || isPinching || isPanning || isPointerPanning || isWheelZooming) {
                    scheduleStrokeCachePrime();
                    return;
                }
                rebuildStrokeCacheNow();
            }, 350);
        }

        // Keep notebook dots as vector geometry. A bitmap pattern is cheaper
        // to create, but Canvas scales its tiny tile during zoom and makes the
        // paper visibly blurry. The cached path is resolution-independent.
        let _dotGridPath = null;
        let _dotGridColumns = 0;
        let _dotGridRows = 0;
        const DOT_GRID_SPACING = 24;
        const DOT_GRID_RADIUS = 1.5;
        const MAX_CACHED_DOT_COUNT = 50000;
        const dotGridPaths = new Map();
        let dotGridCachedCount = 0;
        const dotGridTiles = new Map();

        function dotGridTile(columns,rows){
            const key=`${columns}:${rows}`;
            if(dotGridTiles.has(key))return dotGridTiles.get(key);
            const tile=new Path2D();
            for(let x=0;x<columns;x++)for(let y=0;y<rows;y++){
                tile.moveTo(x*DOT_GRID_SPACING+DOT_GRID_RADIUS,y*DOT_GRID_SPACING);
                tile.arc(x*DOT_GRID_SPACING,y*DOT_GRID_SPACING,DOT_GRID_RADIUS,0,Math.PI*2);
            }
            dotGridTiles.set(key,tile);return tile;
        }

        function getDotGridPath(columns, rows) {
            if (_dotGridPath && columns === _dotGridColumns && rows === _dotGridRows) {
                return _dotGridPath;
            }
            if (columns * rows > MAX_CACHED_DOT_COUNT || typeof Path2D === 'undefined') return null;

            const key = `${columns}:${rows}`;
            const cached = dotGridPaths.get(key);
            if (cached) {
                dotGridPaths.delete(key);dotGridPaths.set(key,cached);
                _dotGridPath=cached;_dotGridColumns=columns;_dotGridRows=rows;
                return cached;
            }

            const path = new Path2D();
            if(Path2D.prototype.addPath){
                // Native copies of an exact 8×8 vector tile replace thousands
                // of JS→Canvas arc calls. Partial edge tiles preserve precisely
                // the same dot count and coordinates; no rasterized pattern.
                for(let x=0;x<columns;x+=8)for(let y=0;y<rows;y+=8){
                    path.addPath(dotGridTile(Math.min(8,columns-x),Math.min(8,rows-y)),{e:x*DOT_GRID_SPACING,f:y*DOT_GRID_SPACING});
                }
            }else{
                for (let x = 0; x < columns; x++) {
                    for (let y = 0; y < rows; y++) {
                        path.moveTo(x * DOT_GRID_SPACING + DOT_GRID_RADIUS, y * DOT_GRID_SPACING);
                        path.arc(x * DOT_GRID_SPACING, y * DOT_GRID_SPACING, DOT_GRID_RADIUS, 0, Math.PI * 2);
                    }
                }
            }
            _dotGridPath = path;
            _dotGridColumns = columns;
            _dotGridRows = rows;
            // Bound the TOTAL retained geometry, not just each entry. Keep
            // exact paths for neighboring zoom buckets without building the
            // same circles again on every back-and-forth pinch.
            while(dotGridPaths.size && (dotGridCachedCount+columns*rows>MAX_CACHED_DOT_COUNT || dotGridPaths.size>=32)){
                const oldest=dotGridPaths.keys().next().value;
                const [oldColumns,oldRows]=oldest.split(':').map(Number);
                dotGridCachedCount-=oldColumns*oldRows;dotGridPaths.delete(oldest);
            }
            dotGridPaths.set(key,path);dotGridCachedCount+=columns*rows;
            return path;
        }

        function drawPaperEdgeShadow(width,height) {
            const transform=ctx.getTransform();
            const left=transform.e/baseDPR,top=transform.f/baseDPR+2;
            const right=left+width*transform.a/baseDPR,bottom=top+height*transform.d/baseDPR;
            const radius=12;
            // No edge on screen means no shadow work at all. Small gradient
            // strips avoid a blurred page-sized intermediate surface at zoom.
            if(right < -radius || left > viewportWidth+radius || bottom < -radius || top > viewportHeight+radius ||
                (left < -radius && top < -radius && right > viewportWidth+radius && bottom > viewportHeight+radius))return;
            const alpha=settings.theme==='light' ? .10 : .25;
            ctx.save();ctx.setTransform(baseDPR,0,0,baseDPR,0,0);
            const paint=(x,y,w,h,gradient)=>{
                const x0=Math.max(0,x),y0=Math.max(0,y),x1=Math.min(viewportWidth,x+w),y1=Math.min(viewportHeight,y+h);
                if(x1<=x0 || y1<=y0)return;
                gradient.addColorStop(0,`rgba(0,0,0,${alpha})`);gradient.addColorStop(.35,`rgba(0,0,0,${alpha*.45})`);gradient.addColorStop(1,'rgba(0,0,0,0)');
                ctx.fillStyle=gradient;ctx.fillRect(x0,y0,x1-x0,y1-y0);
            };
            paint(left-radius,top,radius,bottom-top,ctx.createLinearGradient(left,0,left-radius,0));
            paint(right,top,radius,bottom-top,ctx.createLinearGradient(right,0,right+radius,0));
            paint(left,top-radius,right-left,radius,ctx.createLinearGradient(0,top,0,top-radius));
            paint(left,bottom,right-left,radius,ctx.createLinearGradient(0,bottom,0,bottom+radius));
            for(const [x,y,dx,dy]of [[left,top,-1,-1],[right,top,0,-1],[left,bottom,-1,0],[right,bottom,0,0]]) {
                paint(x+dx*radius,y+dy*radius,radius,radius,ctx.createRadialGradient(x,y,0,x,y,radius));
            }
            ctx.restore();
        }

        function drawTemplate(wOverride, hOverride, shiftX, shiftY) {
            const w = wOverride !== undefined ? wOverride : baseWidth;
            const h = hOverride !== undefined ? hOverride : baseHeight;
            const sx = (gridShiftX + (shiftX || 0));
            const sy = (gridShiftY + (shiftY || 0));

            const palette=getCanvasThemePalette();
            const {surround:infinityBg,paper:pageBg,grid:gridLineColor,dots:dotColor}=palette;

            // Draw background fill for the entire viewport first
            ctx.save();
            ctx.setTransform(baseDPR, 0, 0, baseDPR, 0, 0);
            ctx.fillStyle = infinityBg;
            // Width/height are CSS pixels under the DPR transform; canvas.width
            // and canvas.height are already physical pixels and overdraw the
            // viewport by DPR² on scaled displays.
            ctx.fillRect(0, 0, viewportWidth, viewportHeight);
            ctx.restore();
            drawPaperEdgeShadow(w,h);

            // Now draw the "Page" area
            const template = currentPageTemplate || currentNotebook?.template || 'blank';

            ctx.fillStyle = pageBg;
            ctx.fillRect(0, 0, w, h);
            if(palette.edge!=='transparent'){
                ctx.save();ctx.strokeStyle=palette.edge;ctx.lineWidth=1/zoom;
                ctx.strokeRect(0,0,w,h);ctx.restore();
            }

            // PERFORMANCE: Compute visible viewport in world coords for grid culling
            // Only draw grid lines/dots that are actually on screen
            const vpLeft = Math.max(0, -panX / zoom - (shiftX || 0));
            const vpTop = Math.max(0, -panY / zoom - (shiftY || 0));
            const vpRight = Math.min(w, vpLeft + viewportWidth / zoom);
            const vpBottom = Math.min(h, vpTop + viewportHeight / zoom);

            if (template === 'lined') {
                ctx.strokeStyle = gridLineColor;
                ctx.lineWidth = 1;
                const spacing = 32;
                const baseOff = (80 + sy) % spacing;
                const safeOff = baseOff < 0 ? baseOff + spacing : baseOff;
                // Clamp to visible rows
                const firstY = Math.max(safeOff, Math.floor((vpTop - safeOff) / spacing) * spacing + safeOff);

                ctx.beginPath();
                for (let y = firstY; y <= vpBottom; y += spacing) {
                    ctx.moveTo(vpLeft, y);
                    ctx.lineTo(vpRight, y);
                }
                ctx.stroke();
            } else if (template === 'grid') {
                ctx.strokeStyle = gridLineColor;
                ctx.lineWidth = 1;
                const gridSize = 24;
                const offX = sx % gridSize;
                const safeOffX = offX < 0 ? offX + gridSize : offX;
                const offY = sy % gridSize;
                const safeOffY = offY < 0 ? offY + gridSize : offY;
                // Clamp to visible columns/rows
                const firstX = Math.max(safeOffX, Math.floor((vpLeft - safeOffX) / gridSize) * gridSize + safeOffX);
                const firstY = Math.max(safeOffY, Math.floor((vpTop - safeOffY) / gridSize) * gridSize + safeOffY);

                ctx.beginPath();
                for (let x = firstX; x <= vpRight; x += gridSize) {
                    ctx.moveTo(x, vpTop);
                    ctx.lineTo(x, vpBottom);
                }
                for (let y = firstY; y <= vpBottom; y += gridSize) {
                    ctx.moveTo(vpLeft, y);
                    ctx.lineTo(vpRight, y);
                }
                ctx.stroke();
            } else if (template === 'dotted') {
                const offX = ((sx % DOT_GRID_SPACING) + DOT_GRID_SPACING) % DOT_GRID_SPACING || DOT_GRID_SPACING;
                const offY = ((sy % DOT_GRID_SPACING) + DOT_GRID_SPACING) % DOT_GRID_SPACING || DOT_GRID_SPACING;
                // Submit nearby dots only, not every dot on the page at huge
                // zoom. Round counts into small buckets to reuse the path.
                const firstColumn = Math.max(0, Math.floor((vpLeft - offX - DOT_GRID_RADIUS) / DOT_GRID_SPACING));
                const firstRow = Math.max(0, Math.floor((vpTop - offY - DOT_GRID_RADIUS) / DOT_GRID_SPACING));
                const visibleColumns = Math.max(0, Math.ceil((vpRight - offX + DOT_GRID_RADIUS) / DOT_GRID_SPACING) - firstColumn + 1);
                const visibleRows = Math.max(0, Math.ceil((vpBottom - offY + DOT_GRID_RADIUS) / DOT_GRID_SPACING) - firstRow + 1);
                const columns = Math.min(Math.ceil(w / DOT_GRID_SPACING) + 1, Math.ceil(visibleColumns / 8) * 8);
                const rows = Math.min(Math.ceil(h / DOT_GRID_SPACING) + 1, Math.ceil(visibleRows / 8) * 8);
                let path = getDotGridPath(columns, rows);

                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, w, h);
                ctx.clip();
                ctx.beginPath();
                ctx.rect(vpLeft, vpTop, Math.max(0, vpRight - vpLeft), Math.max(0, vpBottom - vpTop));
                ctx.clip();
                ctx.fillStyle = dotColor;

                if (path) {
                    // Translate the cached page-local vector grid to preserve
                    // the same grid phase when a page is resized.
                    ctx.translate(offX + firstColumn * DOT_GRID_SPACING, offY + firstRow * DOT_GRID_SPACING);
                    ctx.fill(path);
                } else if (typeof Path2D !== 'undefined') {
                    // Very large custom pages: build only visible vector dots,
                    // thinning the grid (never rasterizing it) if necessary.
                    const visibleColumns = Math.max(1, Math.ceil((vpRight - vpLeft) / DOT_GRID_SPACING));
                    const visibleRows = Math.max(1, Math.ceil((vpBottom - vpTop) / DOT_GRID_SPACING));
                    const stride = Math.max(1, Math.ceil(Math.sqrt((visibleColumns * visibleRows) / MAX_CACHED_DOT_COUNT)));
                    const spacing = DOT_GRID_SPACING * stride;
                    const phaseX = ((sx % spacing) + spacing) % spacing || spacing;
                    const phaseY = ((sy % spacing) + spacing) % spacing || spacing;
                    const firstX = Math.max(phaseX, Math.floor((vpLeft - phaseX) / spacing) * spacing + phaseX);
                    const firstY = Math.max(phaseY, Math.floor((vpTop - phaseY) / spacing) * spacing + phaseY);
                    const visiblePath = new Path2D();
                    for (let x = firstX; x <= vpRight; x += spacing) {
                        for (let y = firstY; y <= vpBottom; y += spacing) {
                            visiblePath.moveTo(x + DOT_GRID_RADIUS, y);
                            visiblePath.arc(x, y, DOT_GRID_RADIUS, 0, Math.PI * 2);
                        }
                    }
                    ctx.fill(visiblePath);
                } else {
                    // Legacy fallback: still draw actual canvas circles, so
                    // browser zoom never scales a low-resolution dot tile.
                    const firstX = Math.max(offX, Math.floor((vpLeft - offX) / DOT_GRID_SPACING) * DOT_GRID_SPACING + offX);
                    const firstY = Math.max(offY, Math.floor((vpTop - offY) / DOT_GRID_SPACING) * DOT_GRID_SPACING + offY);
                    ctx.beginPath();
                    for (let x = firstX; x <= vpRight; x += DOT_GRID_SPACING) {
                        for (let y = firstY; y <= vpBottom; y += DOT_GRID_SPACING) {
                            ctx.moveTo(x + DOT_GRID_RADIUS, y);
                            ctx.arc(x, y, DOT_GRID_RADIUS, 0, Math.PI * 2);
                        }
                    }
                    ctx.fill();
                }
                ctx.restore();
            }

            // Draw font atlas grid if this is a font atlas page
            if (typeof FontBook !== 'undefined' && FontBook.isFontAtlas()) {
                FontBook.drawFontAtlas(ctx, w, h);
            }
        }

        function _redrawCanvas() {
            window.syncToolboxViewport?.();
            if(window.DragMotion?.paintImage())return;
            if(window.LassoWorkbench?.paintDrag())return;
            const renderStart = window.__badNotesPerfEnabled ? performance.now() : 0;
            const activeTheme = settings.theme || (isDarkMode ? 'dark' : 'light');
            if (strokeCacheValid && lastStrokeCacheTheme !== activeTheme) {
                invalidateStrokeRasterCache();
            }
            // 1. Clear Active Canvas (transparent overlay)
            activeCtx.setTransform(baseDPR, 0, 0, baseDPR, 0, 0);
            // Camera preview clears this overlay once when it begins. Sending
            // another full-resolution transparent clear on every camera frame
            // needlessly dirtied a second QHD surface for the compositor.
            if (!gesturePreviewActive || isDrawing || isResizeReady || isPageResizing) {
                activeCtx.clearRect(0, 0, viewportWidth, viewportHeight);
            }

            // Note: main ctx clear is skipped — drawTemplate fills entire canvas with background

            // 2. Determine "Realtime" Temporary Metrics
            let effectiveW = baseWidth;
            let effectiveH = baseHeight;
            let shiftX = 0;
            let shiftY = 0;
            let effectivePanX = panX;
            let effectivePanY = panY;

            if (isPageResizing && window.tempResize) {
                effectiveW = window.tempResize.w;
                effectiveH = window.tempResize.h;
                shiftX = window.tempResize.shiftX;
                shiftY = window.tempResize.shiftY;
                effectivePanX -= shiftX * zoom;
                effectivePanY -= shiftY * zoom;
            }

            // 3. Render Page Background (with Grid)
            const dpr = baseDPR;
            ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, effectivePanX * dpr, effectivePanY * dpr);

            drawTemplate(effectiveW, effectiveH, shiftX, shiftY);

            // Apply Content Shift for content (Images & Strokes)
            ctx.translate(shiftX, shiftY);

            // PERFORMANCE: Compute visible rect early so images and strokes can cull
            const containerW = viewportWidth;
            const containerH = viewportHeight;
            const viewLeft = -effectivePanX / zoom - shiftX;
            const viewTop = -effectivePanY / zoom - shiftY;
            const viewRight = viewLeft + containerW / zoom;
            const viewBottom = viewTop + containerH / zoom;
            const margin = 100 / zoom;
            const visibleRect = {
                x: viewLeft - margin,
                y: viewTop - margin,
                w: (viewRight - viewLeft) + margin * 2,
                h: (viewBottom - viewTop) + margin * 2
            };
            // The culling margin does not need its own native texture pixels.
            const inkView={x:viewLeft-2/zoom,y:viewTop-2/zoom,w:containerW/zoom+4/zoom,h:containerH/zoom+4/zoom};

            // 3.5. Render Images (with viewport culling)
            const imageCache = window.imageCache || (window.imageCache = new Map());

            if (typeof images !== 'undefined') {
                for (const imgData of images) {
                    // Viewport cull: skip images entirely outside visible area
                    if (!imgData.isPlaceholder) {
                        const imgBounds = { x: imgData.x, y: imgData.y, w: imgData.width, h: imgData.height };
                        if (!rectIntersect(imgBounds, visibleRect)) continue;
                    }
                    // Handle scan placeholder with loading animation
                    if (imgData.isPlaceholder) {
                        ctx.save();
                        ctx.translate(imgData.x + imgData.width/2, imgData.y + imgData.height/2);
                        ctx.rotate(imgData.rotation || 0);

                        // Draw placeholder background
                        ctx.fillStyle = isDarkMode ? 'rgba(30, 35, 45, 0.9)' : 'rgba(240, 242, 245, 0.9)';
                        ctx.strokeStyle = isDarkMode ? 'rgba(88, 166, 255, 0.5)' : 'rgba(55, 120, 200, 0.5)';
                        ctx.lineWidth = 2 / zoom;
                        ctx.setLineDash([8 / zoom, 4 / zoom]);
                        ctx.beginPath();
                        ctx.roundRect(-imgData.width/2, -imgData.height/2, imgData.width, imgData.height, 8 / zoom);
                        ctx.fill();
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Draw loading spinner
                        const spinnerRadius = Math.min(imgData.width, imgData.height) * 0.08;
                        const spinnerTime = (Date.now() % 1000) / 1000;
                        const spinnerAngle = spinnerTime * Math.PI * 2;

                        ctx.strokeStyle = isDarkMode ? 'rgba(88, 166, 255, 0.3)' : 'rgba(55, 120, 200, 0.3)';
                        ctx.lineWidth = 3 / zoom;
                        ctx.beginPath();
                        ctx.arc(0, 0, spinnerRadius, 0, Math.PI * 2);
                        ctx.stroke();

                        // Different color for uploading vs processing
                        const spinnerColor = imgData.isPending
                            ? (isDarkMode ? '#a371f7' : '#8b5cf6')  // Purple for uploading
                            : (isDarkMode ? '#58a6ff' : '#3778c8'); // Blue for processing
                        ctx.strokeStyle = spinnerColor;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        ctx.arc(0, 0, spinnerRadius, spinnerAngle, spinnerAngle + Math.PI * 0.75);
                        ctx.stroke();

                        // Draw status text with progress
                        const fontSize = Math.min(imgData.width, imgData.height) * 0.04;
                        ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
                        ctx.fillStyle = isDarkMode ? '#8b949e' : '#666';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        const progress = imgData.progress || 0;
                        const statusText = imgData.isPending
                            ? (progress > 0 ? `Uploading... ${progress}%` : 'Uploading from phone...')
                            : 'Processing scan...';
                        ctx.fillText(statusText, 0, spinnerRadius * 2.5);

                        // Draw progress bar
                        if (imgData.isPending) {
                            const barWidth = imgData.width * 0.4;
                            const barHeight = 4 / zoom;
                            const barY = spinnerRadius * 4;

                            // Background bar
                            ctx.fillStyle = isDarkMode ? 'rgba(48, 54, 61, 0.8)' : 'rgba(200, 200, 200, 0.8)';
                            ctx.beginPath();
                            ctx.roundRect(-barWidth/2, barY, barWidth, barHeight, barHeight/2);
                            ctx.fill();

                            // Progress fill (determinate if progress > 0, else animated)
                            if (progress > 0) {
                                const fillWidth = barWidth * (progress / 100);
                                ctx.fillStyle = spinnerColor;
                                ctx.beginPath();
                                ctx.roundRect(-barWidth/2, barY, fillWidth, barHeight, barHeight/2);
                                ctx.fill();
                            } else {
                                // Animated fill (indeterminate)
                                const animProgress = (Date.now() % 1500) / 1500;
                                const fillWidth = barWidth * 0.3;
                                const fillX = -barWidth/2 + (barWidth - fillWidth) * animProgress;
                                ctx.fillStyle = spinnerColor;
                                ctx.beginPath();
                                ctx.roundRect(fillX, barY, fillWidth, barHeight, barHeight/2);
                                ctx.fill();
                            }
                        }

                        ctx.restore();

                        // Request animation frame for spinner
                        if (!window._scanPlaceholderAnimating) {
                            window._scanPlaceholderAnimating = true;
                            const animatePlaceholder = () => {
                                if (images && images.some(img => img.isPlaceholder)) {
                                    redrawCanvas();
                                    requestAnimationFrame(animatePlaceholder);
                                } else {
                                    window._scanPlaceholderAnimating = false;
                                }
                            };
                            requestAnimationFrame(animatePlaceholder);
                        }
                        continue;
                    }

                    let img = imageCache.get(imgData.id);
                    if (!img) {
                        img = new Image();
                        img.onload = () => redrawCanvas();
                        img.src = imgData.dataUrl;
                        imageCache.set(imgData.id, img);
                    } else if (img.complete) {
                        ctx.save();
                        // Transform reference point to center of image
                        ctx.translate(imgData.x + imgData.width/2, imgData.y + imgData.height/2);
                        ctx.rotate(imgData.rotation || 0);

                        // Smart image inversion based on theme:
                        // - Dark mode + inverted: show inverted
                        // - Dark mode + normal: show normal
                        // - Light mode + inverted: show normal (cancel out)
                        // - Light mode + normal: show normal
                        const shouldInvert = isDarkMode ? imgData.inverted : false;
                        if (shouldInvert) {
                            ctx.filter = 'invert(1)';
                        }

                        drawFilteredBitmap(ctx,img, -imgData.width/2, -imgData.height/2, imgData.width, imgData.height);

                        // Reset filter
                        ctx.filter = 'none';

                        // Draw lock animation (clean shine swoop)
                        if (imgData._lockAnimProgress !== undefined && imgData._lockAnimProgress !== null) {
                            const p = imgData._lockAnimProgress;
                            // Ease out for smooth deceleration
                            const easedP = 1 - Math.pow(1 - p, 3);

                            const w = imgData.width;
                            const h = imgData.height;

                            // Single clean diagonal shine
                            const sheenWidth = w * 0.15;
                            const totalTravel = w + h + sheenWidth * 2;
                            const offset = -sheenWidth + totalTravel * easedP;

                            // Create diagonal gradient
                            const gradient = ctx.createLinearGradient(
                                -w/2 + offset - sheenWidth, -h/2,
                                -w/2 + offset + sheenWidth, h/2
                            );

                            const alpha = Math.sin(p * Math.PI) * 0.5;
                            gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
                            gradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`);
                            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

                            ctx.fillStyle = gradient;
                            ctx.fillRect(-w/2, -h/2, w, h);
                        }

                        // Draw lock indicator for locked images
                        // Only show lock icon when hovering for cleaner look
                        if (imgData.locked && imgData.isHovered) {
                            const lockSize = Math.min(imgData.width, imgData.height) * 0.035;
                            const lx = imgData.width / 2 - lockSize * 2.5;
                            const ly = -imgData.height / 2 + lockSize * 2.5;

                            // Lock background circle
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                            ctx.beginPath();
                            ctx.arc(lx, ly, lockSize * 1.4, 0, Math.PI * 2);
                            ctx.fill();

                            // Lock body
                            ctx.fillStyle = '#fff';
                            ctx.fillRect(lx - lockSize * 0.5, ly - lockSize * 0.1, lockSize, lockSize * 0.7);

                            // Lock shackle
                            ctx.strokeStyle = '#fff';
                            ctx.lineWidth = lockSize * 0.25;
                            ctx.beginPath();
                            ctx.arc(lx, ly - lockSize * 0.1, lockSize * 0.35, Math.PI, 0);
                            ctx.stroke();
                        }

                        ctx.restore();
                    }
                }
            }



            // 4. Render Strokes - coverage-preserving cached sampling.
            // Moving and settled frames share the same filtered source levels.
            // visibleRect already computed above before image rendering

            const strokeCount = strokes.length;
            // Use stroke cache for static strokes - INCLUDING while drawing!
            // During drawing, the cache is still valid (current stroke is on activeCanvas)
            // Skip during page resize or active highlighter (which modifies stroke colors live)
            const isHighlighterDrawing = isDrawing && currentTool === 'highlighter';
            // Reuse the device-resolution snapshot for every frame while its
            // content is valid, not just during gesture preview. The active
            // stroke is rendered on activeCanvas, above this static layer.
            // Live highlighter blending and erasing operate against the
            // existing pixels, so keep those two previews on the vector path.
            // Pen and shape previews live on activeCanvas above the static cache.
            const cacheConflictingPreview = isDrawing &&
                (currentTool === 'highlighter' || currentTool === 'eraser');
            // Never magnify a capped page bitmap, including during pure pan.
            // Movement must not change the rendering quality of stationary ink.
            const cacheHasNativeResolution = lastCachedZoom >= zoom * .999;
            // A pinch also uses native ink: never enlarge the page bitmap.
            const useStrokeCache = strokeCacheValid && !cacheConflictingPreview && cacheHasNativeResolution;
            if (!cacheConflictingPreview && !isDrawing && !gesturePreviewActive && !isPinching && !isWheelZooming) {
                primeNativeInkSnapshot(inkView, effectivePanX, effectivePanY, shiftX, shiftY);
            }
            if (strokeCacheValid && !cacheHasNativeResolution && !isDrawing &&
                !gesturePreviewActive && !isPinching && !isPanning && !isPointerPanning && !isWheelZooming) {
                scheduleHighResRebuild(zoom);
            }

            if (useStrokeCache) {
                initStrokeCache();

                // CRITICAL: Only rebuild cache when content changes, NOT when zoom changes
                // During zoom gestures, we scale the existing cache (fast)
                // The cache is primed while idle and remains stable through the gesture.
                const contentChanged = !strokeCacheValid ||
                    lastCachedStrokeCount !== strokeCount ||
                    lastCachedStrokeVersion !== strokeCacheVersion;
                const gestureActive = gesturePreviewActive || isPinching || isPanning || isPointerPanning || isWheelZooming;

                const maxCachePixels = 4096;

                // PERFORMANCE: Only rebuild if content changed
                // Zoom changes are handled by SCALING the existing cache (fast!)
                // We schedule a high-res rebuild for when user stops interacting
                if (contentChanged) {
                    // Content changed - must rebuild at CURRENT cache zoom level
                    // Use lastCachedZoom if valid, otherwise use 1x for fast initial build
                    const buildZoom = Math.min(lastCachedZoom > 0 ? lastCachedZoom : 1,
                        maxCachePixels / (Math.max(baseWidth, baseHeight) * dpr));
                    const cacheW = Math.ceil(baseWidth * buildZoom * dpr);
                    const cacheH = Math.ceil(baseHeight * buildZoom * dpr);

                    if (strokeCacheCanvas.width !== cacheW || strokeCacheCanvas.height !== cacheH) {
                        strokeCacheCanvas.width = cacheW;
                        strokeCacheCanvas.height = cacheH;
                    }

                    strokeCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
                    strokeCacheCtx.clearRect(0, 0, cacheW, cacheH);
                    strokeCacheCtx.setTransform(buildZoom * dpr, 0, 0, buildZoom * dpr, 0, 0);

                    // Draw all strokes to cache
                    for (const stroke of strokes) {
                        if (!stroke || !(stroke.isFill || stroke.type === 'fill')) continue;
                        drawStrokeToContext(stroke, strokeCacheCtx);
                    }
                    for (const stroke of strokes) {
                        if (!stroke || (stroke.isFill || stroke.type === 'fill')) continue;
                        drawStrokeToContext(stroke, strokeCacheCtx);
                    }

                    strokeCacheValid = true;
                    lastCachedStrokeCount = strokeCount;
                    lastCachedStrokeVersion = strokeCacheVersion;
                    lastCachedZoom = buildZoom;
                    lastStrokeCacheTheme = settings.theme || (isDarkMode ? 'dark' : 'light');

                }

                const zoomRatio = zoom / lastCachedZoom;

                // A page-sized raster cache can hit its memory cap at extreme
                // zoom. Keep the bitmap path during active input for smooth
                // motion, then render vectors once the camera/pointer settles.
                const inputSettled = performance.now() - lastCanvasInteractionAt >= 100;
                const useHighResOverlay = zoomRatio > 1.1 && inputSettled &&
                    !gestureActive && !isDrawing;
                if (zoomRatio > 1.1 && !useHighResOverlay) scheduleSettledHighZoomRedraw();

                // Restore native sharpness after a zoom settles. During the
                // gesture the existing raster is only scaled; the rebuild is
                // deferred until input has been idle for 150 ms.
                if (!gestureActive && getStrokeCacheZoom(zoom) > lastCachedZoom * 1.1) {
                    scheduleHighResRebuild(zoom);
                }

                // Always draw the cache first (this is fast - just blit scaled image)
                ctx.save();
                const cacheScale = zoom / lastCachedZoom;
                const sample=getInkSamplingLevel(strokeCacheCanvas,cacheScale);
                ctx.imageSmoothingEnabled=true;
                ctx.imageSmoothingQuality=sample.filtered?'high':'low';
                // Preserve fractional camera motion. Pixel snapping produced
                // visible stair-stepping near the end of a slow inertial coast.
                const panXInt = effectivePanX * dpr;
                const panYInt = effectivePanY * dpr;
                ctx.setTransform(cacheScale, 0, 0, cacheScale, panXInt, panYInt);
                ctx.drawImage(sample.surface, 0, 0, strokeCacheCanvas.width, strokeCacheCanvas.height);
                ctx.restore();

                if (useHighResOverlay) {
                    // HIGH-RES OVERLAY: Clear visible area and re-render visible strokes at full res
                    ctx.save();
                    ctx.setTransform(baseDPR, 0, 0, baseDPR, 0, 0);

                    // Clear only the visible viewport area (in screen space)
                    ctx.clearRect(0, 0, containerW, containerH);

                    // Redraw template for visible area
                    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panXInt, panYInt);
                    drawTemplate(effectiveW, effectiveH, shiftX, shiftY);
                    ctx.translate(shiftX, shiftY);

                    // Draw images in visible area
                    if (typeof images !== 'undefined') {
                        for (const imgData of images) {
                            if (imgData.isPlaceholder) continue;
                            const imgBounds = {
                                x: imgData.x,
                                y: imgData.y,
                                w: imgData.width,
                                h: imgData.height
                            };
                            if (!rectIntersect(imgBounds, visibleRect)) continue;

                            let img = imageCache.get(imgData.id);
                            if (img && img.complete) {
                                ctx.save();
                                ctx.translate(imgData.x + imgData.width/2, imgData.y + imgData.height/2);
                                ctx.rotate(imgData.rotation || 0);
                                const shouldInvert = isDarkMode ? imgData.inverted : false;
                                if (shouldInvert) ctx.filter = 'invert(1)';
                                drawFilteredBitmap(ctx,img, -imgData.width/2, -imgData.height/2, imgData.width, imgData.height);
                                ctx.filter = 'none';
                                ctx.restore();
                            }
                        }
                    }

                    // Draw ONLY visible strokes at full resolution
                    for (const stroke of strokes) {
                        if (!stroke || !(stroke.isFill || stroke.type === 'fill')) continue;
                        if (stroke.bounds && !rectIntersect(stroke.bounds, visibleRect)) continue;
                        drawStroke(stroke);
                    }
                    drawVectorStrokeCommands(visibleRect);

                    ctx.restore();
                }

                ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, effectivePanX * dpr, effectivePanY * dpr);
                ctx.translate(shiftX, shiftY);
            } else if (!cacheConflictingPreview) {
                drawNativeInkSnapshot(inkView, effectivePanX, effectivePanY, shiftX, shiftY);
            } else {
                // Direct rendering for small pages or during drawing
                for (const stroke of strokes) {
                    if (!stroke || !(stroke.isFill || stroke.type === 'fill')) continue;
                    if (stroke.points?.length > 0 && !stroke.bounds) {
                        stroke.bounds = computeStrokeBounds(stroke);
                    }
                    if (stroke.bounds && !rectIntersect(stroke.bounds, visibleRect)) continue;
                    drawStroke(stroke);
                }

                if (isHighlighterDrawing) drawStrokesIndividually(visibleRect);
                else drawVectorStrokeCommands(visibleRect);
            }

            // 4.5. Draw Image Selection Handles
            if (typeof drawImageSelectionHandles === 'function') {
                drawImageSelectionHandles(ctx);
            }

            // 4.6. Draw Lasso Path and Selection Handles
            if (typeof drawLassoPath === 'function') {
                drawLassoPath(ctx);
            }
            if (typeof drawLassoSelectionHandles === 'function') {
                drawLassoSelectionHandles(ctx);
            }

            // 4.7. Draw Handwritten Text Fields
            if (typeof HandwrittenTextField !== 'undefined') {
                HandwrittenTextField.draw(ctx);
            }

            // 4.8. Draw Simple Text Fields
            if (typeof SimpleTextField !== 'undefined') {
                SimpleTextField.draw(ctx);
            }

            // 5. Draw Resize Handles (UI Layer)
            // Restore context for UI elements (remove content shift)
            ctx.translate(-shiftX, -shiftY);

            drawResizeHandles(activeCtx, effectiveW, effectiveH, effectivePanX, effectivePanY);

            // 6. Reset Active Context (UI/Cursor layer) to match Camera
            activeCtx.setTransform(zoom * dpr, 0, 0, zoom * dpr, effectivePanX * dpr, effectivePanY * dpr);
            activeCtx.translate(shiftX, shiftY);

            if (window.__badNotesPerfEnabled) {
                const stats = window.__badNotesRenderStats || (window.__badNotesRenderStats = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 });
                stats.lastMs = performance.now() - renderStart;
                stats.totalMs += stats.lastMs;
                stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
                stats.count += 1;
            }
        }

        // ============== Resize Handles ==============
        let isPageResizing = false;
        let isResizeReady = false; // "Hold to enable" state
        let resizeTimeout = null;
        let pageResizeDirection = null;

        // Track resize trigger start position to detect movement
        let resizeTriggerStartX = null;
        let resizeTriggerStartY = null;
        const RESIZE_MOVEMENT_THRESHOLD = 15; // Cancel if moved more than 15px

        let pageResizeStartWidth = 0;
        let pageResizeStartHeight = 0;
        let pageResizeStartX = 0; // Pointer screen pos
        let pageResizeStartY = 0;

        // For shifting content (Top/Left resize)
        let pageResizeStartContentShiftX = 0;
        let pageResizeStartContentShiftY = 0;

        function drawResizeHandles(ctx, wVal, hVal, panXVal, panYVal) {
             const w = wVal !== undefined ? wVal : baseWidth;
             const h = hVal !== undefined ? hVal : baseHeight;
             const pX = panXVal !== undefined ? panXVal : panX;
             const pY = panYVal !== undefined ? panYVal : panY;

             // Only draw if we are resizing or ready to resize (grabber valid)
             if (!isResizeReady && !isPageResizing) return;

             // Reset transform to Screen Space for UI drawing
             const dpr = baseDPR;
             ctx.save();
             ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

             const rightEdge = (w * zoom) + pX;
             const bottomEdge = (h * zoom) + pY;
             const leftEdge = pX;
             const topEdge = pY;

             const canvasW = canvas.width / dpr;
             const canvasH = canvas.height / dpr;

             // Visual style
             const colors=getSelectionThemePalette();
             const outline=getSelectionStroke(ctx,leftEdge,topEdge,rightEdge,bottomEdge);
             ctx.strokeStyle = outline;
             ctx.lineWidth = 2;
             ctx.fillStyle = colors.surface;

             // Helper drawing function
             const drawGrip = (x, y, vertical) => {
                 ctx.save();
                 ctx.fillStyle = outline;
                 ctx.beginPath();
                 if (vertical) {
                      ctx.roundRect(x - 3, y - 20, 6, 40, 3);
                 } else {
                      ctx.roundRect(x - 20, y - 3, 40, 6, 3);
                 }
                 ctx.fill();ctx.restore();
             };

             // Right
             if (rightEdge < canvasW && rightEdge > 0) {
                 ctx.beginPath(); ctx.moveTo(rightEdge, topEdge); ctx.lineTo(rightEdge, bottomEdge); ctx.stroke();
                 drawGrip(rightEdge, (topEdge + bottomEdge)/2, true);
             }
             // Bottom
             if (bottomEdge < canvasH && bottomEdge > 0) {
                 ctx.beginPath(); ctx.moveTo(leftEdge, bottomEdge); ctx.lineTo(rightEdge, bottomEdge); ctx.stroke();
                 drawGrip((leftEdge + rightEdge)/2, bottomEdge, false);
             }
             // Left
             if (leftEdge > 0 && leftEdge < canvasW) {
                 ctx.beginPath(); ctx.moveTo(leftEdge, topEdge); ctx.lineTo(leftEdge, bottomEdge); ctx.stroke();
                 drawGrip(leftEdge, (topEdge + bottomEdge)/2, true);
             }
             // Top
             if (topEdge > 0 && topEdge < canvasH) {
                 ctx.beginPath(); ctx.moveTo(leftEdge, topEdge); ctx.lineTo(rightEdge, topEdge); ctx.stroke();
                 drawGrip((leftEdge + rightEdge)/2, topEdge, false);
             }

             // Corners
             const cornerRadius = 6;
             const drawCorner = (x,y) => {
                 ctx.beginPath(); ctx.arc(x, y, cornerRadius, 0, Math.PI*2);
                 ctx.fillStyle = colors.surface; ctx.fill(); ctx.stroke();
             };

             if (rightEdge > 0 && bottomEdge > 0) drawCorner(rightEdge, bottomEdge); // BR
             if (leftEdge > 0 && topEdge > 0) drawCorner(leftEdge, topEdge); // TL
             if (rightEdge > 0 && topEdge > 0) drawCorner(rightEdge, topEdge); // TR
             if (leftEdge > 0 && bottomEdge > 0) drawCorner(leftEdge, bottomEdge); // BL

             // Phantom Preview removed ("Realtime" handled by overrides above)

             ctx.restore();
        }

        function getResizeDirection(px, py) {
            const rightEdge = (baseWidth * zoom) + panX;
            const bottomEdge = (baseHeight * zoom) + panY;
            const leftEdge = panX;
            const topEdge = panY;
            // Smaller tolerance (12px instead of 20px) to reduce accidental triggers
            const tol = 12;

            const nearRight = Math.abs(px - rightEdge) < tol;
            const nearLeft = Math.abs(px - leftEdge) < tol;
            const nearBottom = Math.abs(py - bottomEdge) < tol;
            const nearTop = Math.abs(py - topEdge) < tol;

            // Corners
            if (nearRight && nearBottom) return 'br';
            if (nearLeft && nearTop) return 'tl';
            if (nearRight && nearTop) return 'tr';
            if (nearLeft && nearBottom) return 'bl';

            // Edges
            const inY = py > topEdge - tol && py < bottomEdge + tol;
            const inX = px > leftEdge - tol && px < rightEdge + tol;

            if (nearRight && inY) return 'right';
            if (nearLeft && inY) return 'left';
            if (nearBottom && inX) return 'bottom';
            if (nearTop && inX) return 'top';

            return null;
        }

        function checkResizeStart(e) {
            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const dir = getResizeDirection(px, py);

            // Allow re-grabbing handles if they are already visible/ready
            if (isResizeReady && dir) {
                beginResizeDrag(e, dir);
                return true;
            }

            if (dir) {
                // HOLD TO ENABLE LOGIC
                // Start timer and track start position
                if (resizeTimeout) clearTimeout(resizeTimeout);

                // Store start position for movement detection
                resizeTriggerStartX = px;
                resizeTriggerStartY = py;

                resizeTimeout = setTimeout(() => {
                    // Time's up! Enable Drag Mode and Auto-Start
                    isResizeReady = true;
                    beginResizeDrag(e, dir);

                    // Force redraw for handles
                    redrawCanvas();

                    // Haptic feedback - longer vibration to indicate resize mode
                    if (window.navigator?.vibrate) window.navigator.vibrate([20, 50, 20]);
                    canvas.style.cursor = getCursorForDir(dir);

                    // Clear tracking
                    resizeTriggerStartX = null;
                    resizeTriggerStartY = null;

                }, 800); // 800ms hold - longer to prevent accidental triggers

                return false; // Not resizing YET, let it fall through to drawing
            }
            return false;
        }

        function cancelResizeTrigger() {
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
                resizeTimeout = null;
            }
            resizeTriggerStartX = null;
            resizeTriggerStartY = null;
        }

        // Check if pointer moved too much during resize hold wait
        function checkResizeMovement(e) {
            if (resizeTriggerStartX === null || resizeTriggerStartY === null) return;
            if (!resizeTimeout) return;

            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const dx = Math.abs(px - resizeTriggerStartX);
            const dy = Math.abs(py - resizeTriggerStartY);

            // If moved more than threshold, cancel resize trigger
            if (dx > RESIZE_MOVEMENT_THRESHOLD || dy > RESIZE_MOVEMENT_THRESHOLD) {
                cancelResizeTrigger();
            }
        }

        // Called when timer fires (or immediately if already ready)
        function beginResizeDrag(e, dir) {
            isPageResizing = true;
            pageResizeDirection = dir;

            const rect = canvas.getBoundingClientRect();
            pageResizeStartX = e.clientX - rect.left;
            pageResizeStartY = e.clientY - rect.top;

            pageResizeStartWidth = baseWidth;
            pageResizeStartHeight = baseHeight;

            // For Content Shifting (Top/Left)
            pageResizeStartContentShiftX = 0;
            pageResizeStartContentShiftY = 0;

            canvas.setPointerCapture(e.pointerId);
        }

        function handleResizeMove(e) {
            if (!isPageResizing) return false;

            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const dx = (px - pageResizeStartX) / zoom;
            const dy = (py - pageResizeStartY) / zoom;

            let newW = pageResizeStartWidth;
            let newH = pageResizeStartHeight;
            let shiftX = 0;
            let shiftY = 0;

            // Horizontal
            if (['right', 'tr', 'br'].includes(pageResizeDirection)) {
                newW = Math.max(100, pageResizeStartWidth + dx);
            }
            if (['left', 'tl', 'bl'].includes(pageResizeDirection)) {
                // Dragging left means width increases by -dx
                const potentialW = pageResizeStartWidth - dx;
                if (potentialW >= 100) {
                    newW = potentialW;
                    shiftX = -dx;
                }
            }

            // Vertical
            if (['bottom', 'bl', 'br'].includes(pageResizeDirection)) {
                newH = Math.max(100, pageResizeStartHeight + dy);
            }
            if (['top', 'tl', 'tr'].includes(pageResizeDirection)) {
                const potentialH = pageResizeStartHeight - dy;
                if (potentialH >= 100) {
                    newH = potentialH;
                    shiftY = -dy;
                }
            }

            // "Realtime" Mode - Preview changes applied in redrawCanvas
            window.tempResize = { x: 0, y: 0, w: newW, h: newH, shiftX: shiftX, shiftY: shiftY };

            redrawCanvas();
            return true;
        }

        function handleResizeEnd(e) {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = null;

            if (isPageResizing) {
                isPageResizing = false;
                isResizeReady = false;
                canvas.style.cursor = 'default';

                // Commit the changes from window.tempResize
                if (window.tempResize) {
                    const { w, h, shiftX, shiftY } = window.tempResize;

                    // 1. Update Grid
                    baseWidth = w;
                    baseHeight = h;

                    // 2. Update Grid Offsets
                    gridShiftX += shiftX;
                    gridShiftY += shiftY;

                    // 3. Update Pan to keep visual continuity
                    panX -= shiftX * zoom;
                    panY -= shiftY * zoom;

                    // 4. Update Stroke Coordinates
                    if (shiftX !== 0 || shiftY !== 0) {
                        applyShift(shiftX, shiftY);
                    }

                    if (pages[currentPageIndex]) {
                        pages[currentPageIndex].width = baseWidth;
                        pages[currentPageIndex].height = baseHeight;
                    }

                    // Cleaning
                    window.tempResize = null;

                    saveCurrentPage();
                    showToast('Page Layout Updated', 'success');
                    redrawCanvas();
                }

                return true;
            }
            return false;
        }

        function applyShift(dx, dy) {
             strokes.forEach(s => {
                 s.points.forEach(p => { p.x += dx; p.y += dy; });
                 if(s.bounds) { s.bounds.x += dx; s.bounds.y += dy; }
             });
             // Shift history
             historyStack.forEach(h => {
                 if(h.stroke && h.stroke.points) {
                     // Only if not already shifted (check ref equality?)
                     // Just strictly shift everything in history if it's not a live stroke?
                     // Risk of double shifting if history contains reference to live stroke.
                     // Simple check: is it in strokes?
                     const isLive = strokes.includes(h.stroke);
                     if (!isLive) {
                         h.stroke.points.forEach(p => { p.x += dx; p.y += dy; });
                     }
                 }
             });
        }

        function getCursorForDir(dir) {
            if(!dir) return 'default';
            if(dir.includes('t') && dir.includes('l')) return 'nw-resize';
            if(dir.includes('t') && dir.includes('r')) return 'ne-resize';
            if(dir.includes('b') && dir.includes('l')) return 'sw-resize';
            if(dir.includes('b') && dir.includes('r')) return 'se-resize';
            if(dir.includes('t') || dir.includes('b')) return 'ns-resize';
            return 'ew-resize';
        }

        function updateResizeCursor(e) {
            if (isPageResizing) return;

            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const dir = getResizeDirection(px, py);
            const cursor = getCursorForDir(dir);

            if (cursor !== 'default') {
                canvas.style.cursor = cursor;
            } else {
                updateCanvasToolCursor();
            }
        }

        // Apply tool cursors inline so they take precedence over generic canvas CSS.
        function updateCanvasToolCursor() {
            if (!canvas) return;
            const cursors = {
                pen: 'crosshair', highlighter: 'crosshair', lasso: 'crosshair',
                eraser: 'none', select: 'default', lasso:'crosshair', pan: 'grab', text: 'text',
                image: 'copy', line: 'crosshair', rectangle: 'crosshair',
                circle: 'crosshair', arrow: 'crosshair'
            };
            canvas.style.cursor = cursors[currentTool] || 'crosshair';
        }

        function computeStrokeBounds(stroke) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const pts = stroke.points;
            if (!pts || pts.length === 0) return {x:0, y:0, w:0, h:0};

            // Sample for speed if too many points? No, correctness first.
            const step = pts.length > 100 ? 5 : 1;
            for (let i=0; i<pts.length; i+=step) {
                const p = pts[i];
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            // Add stroke width
            const margin = (stroke.size || 5) * 2;
            return {
                x: minX - margin,
                y: minY - margin,
                w: (maxX - minX) + margin*2,
                h: (maxY - minY) + margin*2
            };
        }

        function rectIntersect(r1, r2) {
            return !(r2.x > r1.x + r1.w ||
                     r2.x + r2.w < r1.x ||
                     r2.y > r1.y + r1.h ||
                     r2.y + r2.h < r1.y);
        }

        // Track already-recolored strokes during a single highlighter gesture
        let highlighterRecoloredSet = new Set();
        let highlighterTextFieldChanges = new Map(); // fieldId -> { before: charColors[], after: charColors[] }

        // Real-time recolor - doesn't push history, just mutates
        function applyHighlighterRecolorRealtime(point, radius, color) {
            const radiusSq = radius * radius;
            let anyChanged = false;

            // Check strokes
            for (let i = 0; i < strokes.length; i++) {
                if (highlighterRecoloredSet.has(i)) continue;
                const stroke = strokes[i];
                if (!stroke || stroke.isFill || stroke.type === 'fill') continue;
                if (stroke.tool === 'highlighter' || stroke.tool === 'eraser') continue;
                if (!stroke.points || stroke.points.length === 0) continue;

                // Quick bounds check
                if (!stroke.bounds) stroke.bounds = computeStrokeBounds(stroke);
                const b = stroke.bounds;
                if (point.x < b.x - radius || point.x > b.x + b.w + radius ||
                    point.y < b.y - radius || point.y > b.y + b.h + radius) continue;

                // Check if point hits stroke
                let hit = false;
                const pts = stroke.points;
                for (let p = 0; p < pts.length - 1 && !hit; p++) {
                    if (getSqSegDist(point, pts[p], pts[p+1]) <= radiusSq) hit = true;
                }
                if (pts.length === 1) {
                    const dx = pts[0].x - point.x, dy = pts[0].y - point.y;
                    if (dx*dx + dy*dy <= radiusSq) hit = true;
                }

                if (hit) {
                    stroke.color = color;
                    highlighterRecoloredSet.add(i);
                    anyChanged = true;
                }
            }

            // Check handwritten text fields
            if (typeof HandwrittenTextField !== 'undefined') {
                const textFields = HandwrittenTextField.getTextFields();
                for (const field of textFields) {
                    const result = recolorTextFieldAtPoint(field, point, radius, color);
                    if (result.changed) anyChanged = true;
                }
            }

            return anyChanged;
        }

        // Recolor handwritten text field characters at a point
        function recolorTextFieldAtPoint(field, point, radius, color) {
            if (!field || !field.text) return { changed: false };

            // Use HandwrittenTextField's getCharacterBounds for accurate hit testing
            if (typeof HandwrittenTextField !== 'undefined' && HandwrittenTextField.getCharacterBounds) {
                const charBounds = HandwrittenTextField.getCharacterBounds(field);
                let changed = false;

                if (!field.charColors) field.charColors = [];

                // Store before state for undo
                const fieldId = field.id;
                if (!highlighterTextFieldChanges.has(fieldId)) {
                    highlighterTextFieldChanges.set(fieldId, {
                        before: [...(field.charColors || [])],
                        field: field
                    });
                }

                for (const cb of charBounds) {
                    if (cb.width === 0) continue; // Skip newlines and skipped spaces

                    // Check if marker point is directly within character bounds (no radius expansion)
                    if (point.x >= cb.x && point.x <= cb.x + cb.width &&
                        point.y >= cb.y && point.y <= cb.y + cb.height) {
                        if (field.charColors[cb.index] !== color) {
                            field.charColors[cb.index] = color;
                            changed = true;
                        }
                    }
                }

                return { changed };
            }

            // Fallback if HandwrittenTextField not available
            return { changed: false };
        }

        // Final commit with history
        function applyHighlighterRecolor(highlighterStroke) {
            if (!highlighterStroke || !highlighterStroke.points || highlighterStroke.points.length === 0) return false;

            const markerColor = highlighterStroke.color;
            if (!markerColor) return false;

            const markerRadius = Math.max(1, (highlighterStroke.size || 12) * 0.15);
            const markerRadiusSq = markerRadius * markerRadius;
            const rawMarkerBounds = computeStrokeBounds(highlighterStroke);
            const markerBounds = {
                x: rawMarkerBounds.x - markerRadius,
                y: rawMarkerBounds.y - markerRadius,
                w: rawMarkerBounds.w + markerRadius * 2,
                h: rawMarkerBounds.h + markerRadius * 2
            };

            const markerPoints = [];
            const markerStep = highlighterStroke.points.length > 120 ? 2 : 1;
            for (let i = 0; i < highlighterStroke.points.length; i += markerStep) {
                markerPoints.push(highlighterStroke.points[i]);
            }
            if (markerPoints.length === 1 && highlighterStroke.points.length > 1) {
                markerPoints.push(highlighterStroke.points[highlighterStroke.points.length - 1]);
            }

            const strokeIndices = [];
            const beforeStrokes = [];
            const afterStrokes = [];

            for (let i = 0; i < strokes.length; i++) {
                const stroke = strokes[i];
                if (!stroke) continue;
                if (stroke.isFill || stroke.type === 'fill') continue;
                if (stroke.tool === 'highlighter' || stroke.tool === 'eraser') continue;
                if (!stroke.points || stroke.points.length === 0) continue;

                if (!stroke.bounds) {
                    stroke.bounds = computeStrokeBounds(stroke);
                }
                if (stroke.bounds && !rectIntersect(stroke.bounds, markerBounds)) continue;

                const pts = stroke.points;
                const pointStep = pts.length > 120 ? 3 : (pts.length > 60 ? 2 : 1);
                const strokePoints = [];
                for (let p = 0; p < pts.length; p += pointStep) {
                    strokePoints.push(pts[p]);
                }
                if (strokePoints.length === 1 && pts.length > 1) {
                    strokePoints.push(pts[pts.length - 1]);
                }
                let hit = false;

                if (markerPoints.length === 1) {
                    const mp = markerPoints[0];
                    for (let p = 0; p < strokePoints.length; p++) {
                        const dx = strokePoints[p].x - mp.x;
                        const dy = strokePoints[p].y - mp.y;
                        if (dx * dx + dy * dy <= markerRadiusSq) {
                            hit = true;
                            break;
                        }
                    }
                } else {
                    // Check stroke points against marker segments
                    for (let p = 0; p < strokePoints.length && !hit; p++) {
                        const point = strokePoints[p];
                        for (let m = 1; m < markerPoints.length; m++) {
                            if (getSqSegDist(point, markerPoints[m - 1], markerPoints[m]) <= markerRadiusSq) {
                                hit = true;
                                break;
                            }
                        }
                    }

                    // Check marker points against stroke segments (extra forgiving)
                    for (let m = 0; m < markerPoints.length && !hit; m++) {
                        const point = markerPoints[m];
                        for (let s = 1; s < strokePoints.length; s++) {
                            if (getSqSegDist(point, strokePoints[s - 1], strokePoints[s]) <= markerRadiusSq) {
                                hit = true;
                                break;
                            }
                        }
                    }
                }

                if (hit) {
                    strokeIndices.push(i);
                    beforeStrokes.push(structuredClone(stroke));
                    const updated = structuredClone(stroke);
                    updated.color = markerColor;
                    afterStrokes.push(updated);
                    strokes[i] = updated;
                }
            }

            // Also include any real-time recolored strokes not captured by full-stroke check
            for (const idx of highlighterRecoloredSet) {
                if (!strokeIndices.includes(idx)) {
                    const stroke = strokes[idx];
                    if (stroke) {
                        strokeIndices.push(idx);
                        // We don't have the before state, but we need it for undo
                        // Since real-time already changed color, create a pseudo-before
                        const before = structuredClone(stroke);
                        // We can't know original color, so this is a limitation
                        beforeStrokes.push(before);
                        afterStrokes.push(structuredClone(stroke));
                    }
                }
            }

            // Build text field history entries
            const textFieldChanges = [];
            for (const [fieldId, data] of highlighterTextFieldChanges) {
                textFieldChanges.push({
                    fieldId,
                    before: data.before,
                    after: [...(data.field.charColors || [])]
                });
            }

            if (strokeIndices.length > 0 || textFieldChanges.length > 0) {
                historyStack.push({
                    type: 'transform',
                    strokeIndices,
                    beforeStrokes,
                    afterStrokes,
                    textFieldChanges
                });
                redoStack = [];
                invalidateStrokeCache(false);

                // Clear tracking for next stroke
                highlighterRecoloredSet.clear();
                highlighterTextFieldChanges.clear();

                return true;
            }

            // Clear tracking
            highlighterRecoloredSet.clear();
            highlighterTextFieldChanges.clear();

            return false;
        }

        function expandCanvas(direction, amount = 500) {
            let shiftX = 0;
            let shiftY = 0;

            if (direction === 'bottom') {
                baseHeight += amount;
            } else if (direction === 'right') {
                baseWidth += amount;
            } else if (direction === 'top') {
                baseHeight += amount;
                shiftY = amount;
            } else if (direction === 'left') {
                baseWidth += amount;
                shiftX = amount;
            }

            // Use helper to resize everything
            updateCanvasDimensions(baseWidth, baseHeight);

            // Shift strokes if needed
            if (shiftX !== 0 || shiftY !== 0) {
                strokes.forEach(stroke => {
                    stroke.points.forEach(p => {
                        p.x += shiftX;
                        p.y += shiftY;
                    });
                });

                // Also shift history stack to keep undo/redo working correctly
                historyStack.forEach(action => {
                    if (action.stroke && action.stroke.points) {
                        // Check if we haven't already shifted this stroke (if it's in strokes array)
                        // But strokes in history might be references to the same objects in strokes array.
                        // If they are references, they are already shifted.
                        // If they are copies (e.g. removed strokes), we need to shift them.
                        // Let's assume they are references for now or check if they are in the strokes array.
                        const isInStrokes = strokes.some(s => s.id === action.stroke.id);
                        if (!isInStrokes) {
                             action.stroke.points.forEach(p => {
                                p.x += shiftX;
                                p.y += shiftY;
                            });
                        }
                    }
                });

                // Shift redo stack as well
                redoStack.forEach(action => {
                    if (action.stroke && action.stroke.points) {
                        const isInStrokes = strokes.some(s => s.id === action.stroke.id);
                        if (!isInStrokes) {
                             action.stroke.points.forEach(p => {
                                p.x += shiftX;
                                p.y += shiftY;
                            });
                        }
                    }
                });
            }

            // Update page data
            if (pages[currentPageIndex]) {
                pages[currentPageIndex].width = baseWidth;
                pages[currentPageIndex].height = baseHeight;
            }

            // Re-render everything from vector data
            redrawCanvas();

            showToast(`Page expanded ${direction}`, 'success');
            saveCurrentPage();
        }

        // Local cubic segments can be rendered as soon as each sample arrives.
        // A shared tangent rounds the first join; bounded causal handles keep
        // later live work independent of the already-drawn stroke length.
        function getRealtimePenControlPoints(points) {
            if (!points || points.length < 2) return null;
            const firstControlPoints = [];
            const secondControlPoints = [];
            for (let i = 0; i < points.length - 1; i++) {
                const start = points[i];
                const end = points[i + 1];
                const controls = getRealtimePenSegmentControls(i > 0 ? points[i - 1] : null,
                    start, end, i === 0 ? points[i + 2] : null, i === 1);
                firstControlPoints.push(controls.first);
                secondControlPoints.push(controls.second);
            }
            return { firstControlPoints, secondControlPoints };
        }

        function getRealtimePenSegmentControls(previous, start, end, next = null, initialSecond = false) {
            const incomingX = previous ? start.x - previous.x : end.x - start.x;
            const incomingY = previous ? start.y - previous.y : end.y - start.y;
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy);
            const incomingLength = Math.hypot(incomingX, incomingY);
            // Limit handles on unevenly spaced samples so a tiny movement
            // following a long one cannot produce a loop or hooked cap.
            const incomingScale = incomingLength > 0 ? Math.min(1, length / incomingLength) / 3 : 0;
            const controls = {
                first: { x: start.x + incomingX * incomingScale, y: start.y + incomingY * incomingScale },
                second: { x: end.x - dx / 3, y: end.y - dy / 3 }
            };
            const bisector = (ax, ay, bx, by) => {
                const a = Math.hypot(ax, ay), b = Math.hypot(bx, by);
                if (a < 1e-8 || b < 1e-8) return {x:0,y:0};
                const x = ax / a + bx / b, y = ay / a + by / b;
                const magnitude = Math.hypot(x, y);
                const factor = magnitude > 1e-8 ? Math.min(a,b) / (3 * magnitude) : 0;
                return {x:x*factor,y:y*factor};
            };
            if (!previous && next) {
                const tangent = bisector(dx,dy,next.x-end.x,next.y-end.y);
                controls.second = {x:end.x-tangent.x,y:end.y-tangent.y};
            } else if (initialSecond && previous) {
                const tangent = bisector(incomingX,incomingY,dx,dy);
                controls.first = {x:start.x+tangent.x,y:start.y+tangent.y};
            }
            return controls;
        }

        function getPenSampleSize(pressure, fallback) {
            return dynamicBrushEnabled && pressure > 0
                ? baseBrushSize * .3 + pressure * baseBrushSize * 2 * (settings.pressureMultiplier || 1)
                : fallback;
        }

        function getPenContactSamples(event, stroke) {
            const coalesced = event.getCoalescedEvents?.() || [];
            const samples = coalesced.length ? [...coalesced] : [event];
            // Chromium can include samples from before pointerdown in the
            // first move batch. Replaying those connects contact to old hover
            // coordinates, producing the characteristic backwards start hook.
            if (samples.at(-1) !== event && Number.isFinite(event.timeStamp) &&
                (!Number.isFinite(samples.at(-1)?.timeStamp) || samples.at(-1).timeStamp < event.timeStamp)) {
                samples.push(event);
            }
            return samples.filter(sample => {
                if (sample.pointerType === 'pen' && (sample.buttons & 33) === 0) return false;
                if (!Number.isFinite(sample.timeStamp)) return true;
                if (Number.isFinite(stroke.liveSampleTime) && sample.timeStamp <= stroke.liveSampleTime) return false;
                stroke.liveSampleTime = sample.timeStamp;
                return true;
            });
        }

        function getCorrectedPenContactSample(event, stroke) {
            if (stroke.points.length !== 1 || !Number.isFinite(stroke.liveSampleTime)) return null;
            const samples = event.getCoalescedEvents?.() || [];
            // Wayland/Chromium may dispatch pointerdown at the last hover
            // position, followed by the true contact coordinate at exactly
            // that same timestamp. This is a correction, not a new segment.
            return samples.find(sample => sample.pointerType === 'pen' &&
                (sample.buttons & 33) !== 0 && sample.timeStamp === stroke.liveSampleTime) || null;
        }

        function drawPenStartPreview(stroke, points) {
            const controls = getRealtimePenControlPoints(points);
            const hull = [...points, ...(controls?.firstControlPoints || []), ...(controls?.secondControlPoints || [])];
            const padding = Math.max(stroke.size, ...points.map(p => p.size || stroke.size)) * 2 + 2 / zoom;
            const rect = {x:Math.min(...hull.map(p=>p.x))-padding,y:Math.min(...hull.map(p=>p.y))-padding,
                right:Math.max(...hull.map(p=>p.x))+padding,bottom:Math.max(...hull.map(p=>p.y))+padding};
            const old = stroke.liveStartBounds;
            const x = Math.min(rect.x, old?.x ?? rect.x), y = Math.min(rect.y, old?.y ?? rect.y);
            activeCtx.clearRect(x,y,Math.max(rect.right,old?.right ?? rect.right)-x,
                Math.max(rect.bottom,old?.bottom ?? rect.bottom)-y);
            renderSmoothStroke({...stroke,points},true,null,activeCtx);
            stroke.liveStartBounds = rect;
        }

        function drawStroke(stroke) {
            drawStrokeToContext(stroke, ctx);
        }

        function getHighlighterBlendMode() {
            const resolvedTheme = settings?.theme || (typeof isDarkMode !== 'undefined' && isDarkMode ? 'dark' : 'light');
            const isDarkTheme = resolvedTheme === 'dark' || resolvedTheme === 'oled';
            return {
                composite: isDarkTheme ? 'screen' : 'multiply',
                alpha: isDarkTheme ? 0.6 : 0.5
            };
        }

        // PERFORMANCE: Draw stroke to any context (for caching)
        function drawStrokeToContext(stroke, targetCtx) {
            if (!stroke) return;
            if (!stroke.points || stroke.points.length === 0) return;

            // Apply theme-aware color (white↔black swap in light mode)
            const themedColor = getThemedColor(stroke.color);

            targetCtx.strokeStyle = themedColor;
            targetCtx.lineWidth = stroke.size;
            targetCtx.lineCap = 'round';
            targetCtx.lineJoin = 'round';
            if(stroke.isGeometric && !stroke.isFill) {
                const path=getVectorPenPath(stroke);
                if(path){targetCtx.save();targetCtx.globalCompositeOperation='source-over';if(stroke.geometryFill){targetCtx.globalAlpha=(stroke.opacity??1)*.15;targetCtx.fillStyle=themedColor;targetCtx.fill(path);}targetCtx.globalAlpha=stroke.opacity??1;if(stroke.geometryDashed)targetCtx.setLineDash([Math.max(6,stroke.size*4),Math.max(4,stroke.size*2.5)]);targetCtx.stroke(path);targetCtx.restore();return;}
            }

            // Handle single point (dot)
            if (stroke.points.length === 1 && !stroke.isShape) {
                const p = stroke.points[0];
                if (stroke.tool === 'highlighter') {
                    const { composite, alpha } = getHighlighterBlendMode();
                    targetCtx.save();
                    targetCtx.globalCompositeOperation = composite;
                    targetCtx.globalAlpha = alpha;
                    targetCtx.fillStyle = themedColor;
                    targetCtx.beginPath();
                    targetCtx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
                    targetCtx.fill();
                    targetCtx.restore();
                } else {
                    targetCtx.fillStyle = themedColor;
                    targetCtx.globalAlpha = 1;
                    targetCtx.beginPath();
                    targetCtx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
                    targetCtx.fill();
                }
                return;
            }

            // Handle shapes
            if (stroke.isShape) {
                targetCtx.globalAlpha = 1;
                const startPoint = stroke.points[0];
                const endPoint = stroke.points[stroke.points.length - 1];

                targetCtx.beginPath();

                switch (stroke.tool) {
                    case 'line':
                        targetCtx.moveTo(startPoint.x, startPoint.y);
                        targetCtx.lineTo(endPoint.x, endPoint.y);
                        break;

                    case 'rectangle':
                        const width = endPoint.x - startPoint.x;
                        const height = endPoint.y - startPoint.y;
                        targetCtx.rect(startPoint.x, startPoint.y, width, height);
                        break;

                    case 'circle':
                        const radius = Math.sqrt(
                            Math.pow(endPoint.x - startPoint.x, 2) +
                            Math.pow(endPoint.y - startPoint.y, 2)
                        );
                        targetCtx.arc(startPoint.x, startPoint.y, radius, 0, Math.PI * 2);
                        break;

                    case 'arrow':
                        drawArrowStrokeToCtx(targetCtx, startPoint.x, startPoint.y, endPoint.x, endPoint.y);
                        break;
                }

                // Fill if this is a fill stroke
                if (stroke.isFill && stroke.fillColor) {
                    targetCtx.fillStyle = getThemedColor(stroke.fillColor);
                    targetCtx.fill(stroke.fillRule || 'evenodd');
                } else {
                    targetCtx.stroke();
                }
            } else if (stroke.isFill && stroke.points && stroke.points.length > 2) {
                // Fill a freehand closed path
                if (!stroke._fillPath && typeof Path2D !== 'undefined') {
                    const fillPath = stroke.isGeometric && stroke.geometryCurve ? new Path2D(getVectorPenPath(stroke)) : new Path2D();
                    if(!(stroke.isGeometric&&stroke.geometryCurve)){
                        fillPath.moveTo(stroke.points[0].x, stroke.points[0].y);
                        for (let i = 1; i < stroke.points.length; i++) fillPath.lineTo(stroke.points[i].x, stroke.points[i].y);
                    }
                    fillPath.closePath();
                    Object.defineProperty(stroke, '_fillPath', { value: fillPath, writable: true, configurable: true, enumerable: false });
                }
                targetCtx.fillStyle = getThemedColor(stroke.fillColor || stroke.color);
                if (stroke._fillPath) {
                    targetCtx.fill(stroke._fillPath, stroke.fillRule || 'evenodd');
                } else {
                    targetCtx.beginPath();
                    targetCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
                    for (let i = 1; i < stroke.points.length; i++) targetCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
                    targetCtx.closePath();
                    targetCtx.fill(stroke.fillRule || 'evenodd');
                }
            } else if (stroke.tool === 'highlighter') {
                // OPTIMIZED: Highlighter with reusable temp canvas
                // Use tight bounding box to avoid clearing/blitting the entire canvas
                const { canvas: tempCanvas, ctx: tempCtx } = getHighlighterTempCanvas(targetCtx);

                const currentTransform = targetCtx.getTransform();
                const points = stroke.points;
                if (!points || points.length < 2) return;

                // Compute tight pixel-space bounds for this stroke
                const pad = (stroke.size || 10) * 2;
                let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
                for (let i = 0; i < points.length; i++) {
                    const px = currentTransform.a * points[i].x + currentTransform.e;
                    const py = currentTransform.d * points[i].y + currentTransform.f;
                    if (px < sMinX) sMinX = px;
                    if (px > sMaxX) sMaxX = px;
                    if (py < sMinY) sMinY = py;
                    if (py > sMaxY) sMaxY = py;
                }
                const padPx = pad * Math.abs(currentTransform.a);
                const cx = Math.max(0, Math.floor(sMinX - padPx));
                const cy = Math.max(0, Math.floor(sMinY - padPx));
                const cw = Math.min(tempCanvas.width, Math.ceil(sMaxX + padPx)) - cx;
                const ch = Math.min(tempCanvas.height, Math.ceil(sMaxY + padPx)) - cy;

                if (cw <= 0 || ch <= 0) return;

                // Clear only the tight region
                tempCtx.setTransform(1, 0, 0, 1, 0, 0);
                tempCtx.clearRect(cx, cy, cw, ch);
                tempCtx.setTransform(currentTransform);

                tempCtx.lineCap = 'round';
                tempCtx.lineJoin = 'round';
                tempCtx.strokeStyle = getThemedColor(stroke.color);
                tempCtx.lineWidth = stroke.size;

                if (!stroke._bezierPath && typeof Path2D !== 'undefined') {
                    const path = new Path2D();
                    path.moveTo(points[0].x, points[0].y);
                    if (points.length === 2) {
                        path.lineTo(points[1].x, points[1].y);
                    } else {
                    // PERF: Cache bezier control points for finalized highlighter strokes
                    let controlPoints;
                    if (stroke._bezierCP) {
                        controlPoints = stroke._bezierCP;
                    } else {
                        controlPoints = getBezierControlPoints(points);
                        if (controlPoints) stroke._bezierCP = controlPoints;
                    }
                    if (controlPoints) {
                        const { firstControlPoints, secondControlPoints } = controlPoints;
                        for (let i = 0; i < points.length - 1; i++) {
                            path.bezierCurveTo(
                                firstControlPoints[i].x, firstControlPoints[i].y,
                                secondControlPoints[i].x, secondControlPoints[i].y,
                                points[i + 1].x, points[i + 1].y
                            );
                        }
                    } else {
                        for (let i = 1; i < points.length; i++) {
                            path.lineTo(points[i].x, points[i].y);
                        }
                    }
                    }
                    Object.defineProperty(stroke, '_bezierPath', { value: path, writable: true, configurable: true, enumerable: false });
                }
                if (stroke._bezierPath) {
                    tempCtx.stroke(stroke._bezierPath);
                } else {
                    tempCtx.beginPath();
                    tempCtx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) tempCtx.lineTo(points[i].x, points[i].y);
                    tempCtx.stroke();
                }

                // Blit only the tight region
                const { composite, alpha } = getHighlighterBlendMode();
                targetCtx.save();
                targetCtx.setTransform(1, 0, 0, 1, 0, 0);
                targetCtx.globalCompositeOperation = composite;
                targetCtx.globalAlpha = alpha;
                targetCtx.drawImage(tempCanvas, cx, cy, cw, ch, cx, cy, cw, ch);
                targetCtx.restore();
            } else if (stroke.tool === 'eraser') {
                // Render eraser strokes for Pixel mode
                targetCtx.globalCompositeOperation = 'destination-out';
                renderSmoothStroke(stroke, false, null, targetCtx);
                targetCtx.globalCompositeOperation = 'source-over';
            } else {
                // Pen strokes - use optimal bezier curves for smooth rendering
                renderSmoothStroke(stroke, false, null, targetCtx);
            }

            targetCtx.globalAlpha = 1;
            targetCtx.globalCompositeOperation = 'source-over';
        }

        // Helper for arrow that accepts context
        function drawArrowStrokeToCtx(targetCtx, fromX, fromY, toX, toY) {
            const headLength = 15;
            const angle = Math.atan2(toY - fromY, toX - fromX);

            targetCtx.moveTo(fromX, fromY);
            targetCtx.lineTo(toX, toY);
            targetCtx.lineTo(
                toX - headLength * Math.cos(angle - Math.PI / 6),
                toY - headLength * Math.sin(angle - Math.PI / 6)
            );
            targetCtx.moveTo(toX, toY);
            targetCtx.lineTo(
                toX - headLength * Math.cos(angle + Math.PI / 6),
                toY - headLength * Math.sin(angle + Math.PI / 6)
            );
        }

        function drawArrowStroke(ctx, fromX, fromY, toX, toY) {
            drawArrowStrokeToCtx(ctx, fromX, fromY, toX, toY);
        }

        function getCanvasPoint(e) {
            // Rect is just the viewport now (since canvas is fixed 100vw/100vh)
            const rect = canvas.getBoundingClientRect();

            // Screen Coordinates relative to canvas (viewport)
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            // Map to World Coordinates:
            // World = (Screen - Pan) / Zoom
            const x = (screenX - panX) / zoom;
            const y = (screenY - panY) / zoom;

            return {
                x: x,
                y: y,
                pressure: e.pressure || 0.5
            };
        }

        function startDrawing(e) {
            if(window.GeometryWorkbench?.start(e))return;
            // Cancel any pending long-press context menu (fixes "dot trigger" bug)
            if (typeof cancelLongPress === 'function') {
                cancelLongPress();
            }

            // Handle eraser modes
            if (currentTool === 'eraser') {
                e.preventDefault();
                e.stopPropagation();
                isDrawing = true;
                drawingPointerId = e.pointerId;
                eraserModified = false;
                lastEraserRun = -Infinity;
                canvas.setPointerCapture(e.pointerId);
                const point = getCanvasPoint(e);
                eraserModified = handleEraserModes(point);
                // Draw initial cursor
                clearActiveCanvas();
                drawEraserCursor(point.x, point.y, currentSize * 3);
                return;
            }

            isDrawing = true;
            drawingPointerId = e.pointerId;
            const point = getCanvasPoint(e);
            lastX = point.x;
            lastY = point.y;

            // Initialize smooth point for iOS-style drawing
            smoothPoint = { x: point.x, y: point.y };
            smoothPointInitialized = true;

            // Calculate brush size with full 4096 pressure levels
            let brushSize = currentSize;
            if (currentTool === 'pen') {
                brushSize = getPenSampleSize(point.pressure,currentSize);
            } else if (dynamicBrushEnabled && point.pressure > 0) {
                // Use full pressure range (0 to 1 maps from 4096 levels)
                const pressureFactor = point.pressure; // Already normalized 0-1
                const multiplier = settings.pressureMultiplier || 1.0;
                brushSize = baseBrushSize * 0.5 + (pressureFactor * baseBrushSize * 2.5 * multiplier);
            }

            currentStroke = {
                id: Date.now(),
                tool: currentTool,
                color: currentTool === 'eraser' ? '#000000' : currentColor,
                size: currentTool === 'highlighter' ? brushSize * 4 : brushSize,
                points: [{ ...point, size: brushSize }],
                liveSampleTime: Number.isFinite(e.timeStamp) ? e.timeStamp : undefined,
                isShape: ['line', 'rectangle', 'circle', 'arrow'].includes(currentTool)
            };

            // A tap is a valid one-point mark. Show it immediately, without
            // depending on minDistance or waiting for a move event.
            if (currentTool === 'pen') {
                clearActiveCanvas();
                activeCtx.save();
                activeCtx.globalAlpha = 1;
                activeCtx.globalCompositeOperation = 'source-over';
                activeCtx.fillStyle = getThemedColor(currentStroke.color);
                activeCtx.beginPath();
                activeCtx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
                activeCtx.fill();
                activeCtx.restore();
                currentStroke.livePoint = { x: point.x, y: point.y, size: brushSize };
                currentStroke.livePreviousPoint = null;
            }

            // For highlighter, start an offscreen buffer to prevent self-overlap
            if (currentTool === 'highlighter') {
                // Clear tracking from previous stroke
                highlighterRecoloredSet.clear();
                highlighterTextFieldChanges.clear();

                currentStroke.tempCanvas = document.createElement('canvas');
                currentStroke.tempCanvas.width = canvas.width;
                currentStroke.tempCanvas.height = canvas.height;
                currentStroke.tempCtx = currentStroke.tempCanvas.getContext('2d');
                currentStroke.tempCtx.lineCap = 'round';
                currentStroke.tempCtx.lineJoin = 'round';
            }
        }

        let lastEraserRun = 0;
        const ERASER_THROTTLE = 32; // ~30fps for better performance
        let eraserModified = false; // Track if eraser modified anything this stroke

        function handleEraserModes(point) {
            const now = performance.now();
            if (now - lastEraserRun < ERASER_THROTTLE) return false;
            lastEraserRun = now;

            if (eraserMode === 'object') {
                // Find and remove entire stroke that contains this point
                const hitStroke = findStrokeAtPoint(point.x, point.y);
                if (hitStroke) {
                    strokes = strokes.filter(s => s.id !== hitStroke.id);
                    invalidateStrokeCache(false);
                    historyStack.push({ type: 'remove', stroke: hitStroke });
                    redoStack = [];
                    redrawCanvas();
                    saveCurrentPage();
                    return true;
                }
            } else if (eraserMode === 'point') {
                // Eraser is 3x the brush size for easier erasing
                const radius = currentSize * 3;
                let modified = false;
                let newStrokesList = [];

                for (let i = 0; i < strokes.length; i++) {
                    const stroke = strokes[i];
                    if (stroke.isShape) {
                        newStrokesList.push(stroke);
                        continue;
                    }

                    // Bounding box check optimization
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for(const p of stroke.points) {
                        minX = Math.min(minX, p.x);
                        maxX = Math.max(maxX, p.x);
                        minY = Math.min(minY, p.y);
                        maxY = Math.max(maxY, p.y);
                    }

                    // Check if this is a very small stroke (dot-like)
                    const strokeWidth = maxX - minX;
                    const strokeHeight = maxY - minY;
                    const isDotLike = strokeWidth < radius && strokeHeight < radius;

                    // For dot-like strokes, check if center is within eraser
                    if (isDotLike) {
                        const centerX = (minX + maxX) / 2;
                        const centerY = (minY + maxY) / 2;
                        if (Math.hypot(centerX - point.x, centerY - point.y) <= radius) {
                            modified = true;
                            continue; // Skip adding this stroke (erase it)
                        }
                    }

                    if (point.x + radius < minX || point.x - radius > maxX ||
                        point.y + radius < minY || point.y - radius > maxY) {
                        newStrokesList.push(stroke);
                        continue;
                    }

                    const splitResult = splitStrokeAtCircle(stroke, point, radius);
                    if (splitResult.modified) {
                        modified = true;
                        // Only edited fragments inherit stale geometry. Keep
                        // every untouched stroke's expensive path/control cache.
                        for (const fragment of splitResult.newStrokes) {
                            delete fragment.bounds;delete fragment._bezierCP;
                            delete fragment._bezierPath;delete fragment._fillPath;
                        }
                        newStrokesList.push(...splitResult.newStrokes);
                    } else {
                        newStrokesList.push(stroke);
                    }
                }

                if (modified) {
                    strokes = newStrokesList;
                    invalidateStrokeCache(false);
                    redrawCanvas();
                    if (window.saveTimeout) clearTimeout(window.saveTimeout);
                    window.saveTimeout = setTimeout(saveCurrentPage, 500);
                    return true;
                }
            }
            return false;
        }

        function splitStrokeAtCircle(stroke, center, radius) {
            const points = stroke.points;

            // Handle single-point strokes (dots) - check if the point is inside eraser
            if (points.length === 1) {
                const p = points[0];
                // Use the point's size/pressure to determine its radius
                const pointRadius = (p.size || stroke.size || 2) / 2;
                const dist = Math.hypot(p.x - center.x, p.y - center.y);
                // Erase if center of dot is within eraser radius
                if (dist <= radius + pointRadius) {
                    return { modified: true, newStrokes: [] }; // Delete the dot
                }
                return { modified: false };
            }

            if (points.length < 2) return { modified: false };

            let newStrokes = [];
            let currentPoints = [];
            let modified = false;

            // Check if the first point is outside
            if (Math.hypot(points[0].x - center.x, points[0].y - center.y) > radius) {
                currentPoints.push(points[0]);
            } else {
                modified = true;
            }

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i+1];
                if(p2.break){
                    if(currentPoints.length>=2)newStrokes.push({...stroke,id:Date.now()+Math.random(),points:[...currentPoints]});
                    currentPoints=[{...p2,break:false}];
                    continue;
                }

                // Quick segment bounding box check
                const minX = Math.min(p1.x, p2.x);
                const maxX = Math.max(p1.x, p2.x);
                const minY = Math.min(p1.y, p2.y);
                const maxY = Math.max(p1.y, p2.y);

                if (minX > center.x + radius || maxX < center.x - radius ||
                    minY > center.y + radius || maxY < center.y - radius) {
                    // Segment is completely outside
                    if (currentPoints.length === 0 ||
                        Math.abs(currentPoints[currentPoints.length-1].x - p1.x) > 0.01 ||
                        Math.abs(currentPoints[currentPoints.length-1].y - p1.y) > 0.01) {
                        currentPoints.push({ ...p1, size: p1.size, pressure: p1.pressure });
                    }
                    currentPoints.push({ ...p2, size: p2.size, pressure: p2.pressure });
                    continue;
                }

                const intersections = getLineCircleIntersections(p1, p2, center, radius);

                // Sort intersections by distance from p1 to ensure correct order
                intersections.sort((a, b) => Math.hypot(a.x - p1.x, a.y - p1.y) - Math.hypot(b.x - p1.x, b.y - p1.y));

                const subPoints = [p1, ...intersections, p2];

                for (let j = 0; j < subPoints.length - 1; j++) {
                    const a = subPoints[j];
                    const b = subPoints[j+1];
                    const midX = (a.x + b.x) / 2;
                    const midY = (a.y + b.y) / 2;

                    if (Math.hypot(midX - center.x, midY - center.y) > radius) {
                        // Segment is outside
                        if (currentPoints.length === 0 ||
                            Math.abs(currentPoints[currentPoints.length-1].x - a.x) > 0.01 ||
                            Math.abs(currentPoints[currentPoints.length-1].y - a.y) > 0.01) {
                            currentPoints.push({ ...a, size: p1.size, pressure: p1.pressure });
                        }
                        currentPoints.push({ ...b, size: p2.size, pressure: p2.pressure });
                    } else {
                        // Segment is inside
                        modified = true;
                        if (currentPoints.length > 0) {
                            if (currentPoints.length >= 2) { // Only save valid strokes
                                newStrokes.push({
                                    ...stroke,
                                    id: Date.now() + Math.random(),
                                    points: [...currentPoints]
                                });
                            }
                            currentPoints = [];
                        }
                    }
                }
            }

            if (currentPoints.length >= 2) {
                newStrokes.push({
                    ...stroke,
                    id: Date.now() + Math.random(),
                    points: [...currentPoints]
                });
            }

            return { modified, newStrokes };
        }

        function getLineCircleIntersections(p1, p2, center, radius) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const fx = p1.x - center.x;
            const fy = p1.y - center.y;

            const a = dx * dx + dy * dy;
            const b = 2 * (fx * dx + fy * dy);
            const c = (fx * fx + fy * fy) - radius * radius;

            let discriminant = b * b - 4 * a * c;

            if (discriminant < 0) return [];

            discriminant = Math.sqrt(discriminant);
            const t1 = (-b - discriminant) / (2 * a);
            const t2 = (-b + discriminant) / (2 * a);

            const intersections = [];

            if (t1 >= 0 && t1 <= 1) {
                intersections.push({
                    x: p1.x + t1 * dx,
                    y: p1.y + t1 * dy
                });
            }

            if (t2 >= 0 && t2 <= 1) {
                intersections.push({
                    x: p1.x + t2 * dx,
                    y: p1.y + t2 * dy
                });
            }

            return intersections;
        }

        function findStrokeAtPoint(x, y, threshold = 10) {
            // Search in reverse order (top to bottom)
            for (let i = strokes.length - 1; i >= 0; i--) {
                const stroke = strokes[i];
                if (stroke.isShape) {
                    // Simple bounding box check for shapes
                    const start = stroke.points[0];
                    const end = stroke.points[stroke.points.length - 1];
                    const minX = Math.min(start.x, end.x) - threshold;
                    const maxX = Math.max(start.x, end.x) + threshold;
                    const minY = Math.min(start.y, end.y) - threshold;
                    const maxY = Math.max(start.y, end.y) + threshold;
                    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                        return stroke;
                    }
                } else {
                    // Check distance to stroke path
                    for (let j=0;j<stroke.points.length;j++) {
                        const pt=stroke.points[j];
                        const dist = Math.sqrt(Math.pow(pt.x - x, 2) + Math.pow(pt.y - y, 2));
                        if (dist < threshold + (stroke.size || 5)) {
                            return stroke;
                        }
                        if(j>0&&!pt.break){const previous=stroke.points[j-1],dx=pt.x-previous.x,dy=pt.y-previous.y,t=Math.max(0,Math.min(1,((x-previous.x)*dx+(y-previous.y)*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(x-previous.x-t*dx,y-previous.y-t*dy)<threshold+(stroke.size||5))return stroke;}
                    }
                }
            }
            return null;
        }

        function draw(e) {
            if(isDrawing && window.GeometryWorkbench?.update(e))return;
            if (!isDrawing || !currentStroke) {
                // Handle eraser modes while moving (if mouse is down but not drawing a stroke)
                if (isDrawing && currentTool === 'eraser') {
                    e.preventDefault();
                    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
                    const events = coalesced.length ? [...coalesced, e] : [e];
                    for (const event of events) {
                        const pt = getCanvasPoint(event);
                        if (handleEraserModes(pt)) {
                            eraserModified = true;
                        }
                    }
                    // Update cursor position with last point - 3x size
                    const lastPt = getCanvasPoint(e);
                    clearActiveCanvas();
                    drawEraserCursor(lastPt.x, lastPt.y, currentSize * 3);
                }
                return;
            }

            // Get coalesced events for higher precision
            if (currentTool === 'pen') {
                const correction = getCorrectedPenContactSample(e,currentStroke);
                if (correction) {
                    const original = currentStroke.points[0];
                    const corrected = getCanvasPoint(correction);
                    const padding = original.size * 2 + 2 / zoom;
                    currentStroke.liveStartBounds = {x:original.x-padding,y:original.y-padding,
                        right:original.x+padding,bottom:original.y+padding};
                    Object.assign(original,corrected,{size:getPenSampleSize(corrected.pressure,currentStroke.size)});
                    currentStroke.livePoint = {x:original.x,y:original.y,size:original.size};
                    currentStroke.livePreviousPoint = null;
                    drawPenStartPreview(currentStroke,currentStroke.points);
                    lastX = original.x; lastY = original.y;
                }
            }
            const events = currentTool === 'pen'
                ? getPenContactSamples(e,currentStroke)
                : (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]);

            // Process all events
            for (const event of events) {
                const rawPoint = getCanvasPoint(event);

                // Draw the live pen path incrementally. Re-solving the full
                // spline and clearing the whole overlay on every pointer event
                // made long strokes quadratic in total work.
                if (currentTool === 'pen' && !currentStroke.isShape) {
                    const previousLive = currentStroke.livePoint || rawPoint;
                    const incomingLive = currentStroke.livePreviousPoint;
                    const liveSize = getPenSampleSize(rawPoint.pressure,currentStroke.size);
                    const dxLive = rawPoint.x - previousLive.x;
                    const dyLive = rawPoint.y - previousLive.y;
                    if (dxLive * dxLive + dyLive * dyLive > 0.0001) {
                        if (currentStroke.points.length < 3) {
                            // Refine just the first two segments as soon as the
                            // third sample exists. The tip stays at rawPoint;
                            // longer strokes retain their constant-time append.
                            drawPenStartPreview(currentStroke,[...currentStroke.points,{...rawPoint,size:liveSize}]);
                        } else {
                        activeCtx.save();
                        activeCtx.globalAlpha = 1;
                        activeCtx.globalCompositeOperation = 'source-over';
                        activeCtx.strokeStyle = getThemedColor(currentStroke.color);
                        activeCtx.lineWidth = (previousLive.size + liveSize) / 2;
                        activeCtx.lineCap = 'round';
                        activeCtx.lineJoin = 'round';
                        activeCtx.beginPath();
                        activeCtx.moveTo(previousLive.x, previousLive.y);
                        const controls = getRealtimePenSegmentControls(incomingLive, previousLive, rawPoint);
                        activeCtx.bezierCurveTo(
                            controls.first.x,
                            controls.first.y,
                            controls.second.x,
                            controls.second.y,
                            rawPoint.x,
                            rawPoint.y
                        );
                        activeCtx.stroke();
                        activeCtx.restore();
                        }
                        currentStroke.livePreviousPoint = previousLive;
                    }
                    currentStroke.livePoint = { x: rawPoint.x, y: rawPoint.y, size: liveSize };
                }

                // Handle eraser modes continuously
                if (currentTool === 'eraser') {
                    if (handleEraserModes(rawPoint)) {
                        eraserModified = true;
                    }
                    lastX = rawPoint.x;
                    lastY = rawPoint.y;
                    // Draw cursor with 3x size
                    clearActiveCanvas();
                    drawEraserCursor(lastX, lastY, currentSize * 3);
                    continue;
                }

                const pts = currentStroke.points;

                // Calculate distance from last point
                let dist = 0;
                if (pts.length > 0) {
                    const last = pts[pts.length - 1];
                    dist = Math.sqrt((rawPoint.x - last.x) ** 2 + (rawPoint.y - last.y) ** 2);
                }

                // Pen geometry follows the actual hardware samples. The live
                // preview already uses these samples; storing filtered points
                // made the finished stroke visibly catch up on pointer-up.
                // The finalized path is smoothed spatially by the Bézier spline.
                let ultraSmooth;
                if (currentTool === 'pen') {
                    ultraSmooth = { x: rawPoint.x, y: rawPoint.y };
                    smoothPoint.x = rawPoint.x;
                    smoothPoint.y = rawPoint.y;
                    smoothPointInitialized = true;
                } else {
                    // Non-pen tools retain the configured temporal smoothing.
                    if (!smoothPointInitialized) {
                        smoothPoint = { x: rawPoint.x, y: rawPoint.y };
                        smoothingBuffer = [];
                        smoothPointInitialized = true;
                    }
                    const lerpFactor = getSmoothLerpFactor();
                    smoothPoint.x += (rawPoint.x - smoothPoint.x) * lerpFactor;
                    smoothPoint.y += (rawPoint.y - smoothPoint.y) * lerpFactor;
                    ultraSmooth = getSmoothedBufferPoint(smoothPoint);
                }

                // Calculate distance from last recorded point to ultra-smooth point
                let smoothDist = 0;
                if (pts.length > 0) {
                    const last = pts[pts.length - 1];
                    smoothDist = Math.sqrt((ultraSmooth.x - last.x) ** 2 + (ultraSmooth.y - last.y) ** 2);
                }

                // Skip if smooth point hasn't moved enough
                // Keep pen samples closer than half a screen pixel so the
                // saved curve and live ink remain visually identical, even
                // while zoomed in. Other tools keep their configured spacing.
                const minPointDistance = currentTool === 'pen'
                    ? 0
                    : settings.minDistance;
                if (pts.length > 0 && (currentTool === 'pen'
                    ? smoothDist < 0.01
                    : smoothDist < minPointDistance)) continue;

                // Use the ultra-smoothed point
                let point = { x: ultraSmooth.x, y: ultraSmooth.y };

                // Dynamic brush size based on pressure
                if (currentTool === 'pen') {
                    point.size = getPenSampleSize(rawPoint.pressure,currentStroke.size);
                } else if (dynamicBrushEnabled && rawPoint.pressure > 0) {
                    const pressureFactor = rawPoint.pressure;
                    const multiplier = settings.pressureMultiplier || 1.0;
                    point.size = baseBrushSize * 0.3 + (pressureFactor * baseBrushSize * 2 * multiplier);
                } else {
                    point.size = currentStroke.size;
                }
                point.pressure = rawPoint.pressure || 0.5;

                pts.push(point);
                lastX = point.x;
                lastY = point.y;
            }

            // Connect the live preview to the actual input sample. Smoothing
            // belongs in the curve between samples, not as a visible lag behind
            // the pen tip.
            const rawCursorPoint = getCanvasPoint(e);
            let currentCursorPoint = { x: rawCursorPoint.x, y: rawCursorPoint.y };

            if (dynamicBrushEnabled && rawCursorPoint.pressure > 0) {
                const multiplier = settings.pressureMultiplier || 1.0;
                currentCursorPoint.size = baseBrushSize * 0.3 + (rawCursorPoint.pressure * baseBrushSize * 2 * multiplier);
            } else {
                currentCursorPoint.size = currentStroke.size;
            }

            if (currentStroke.isShape) {
                // Clear active canvas only - O(1)
                clearActiveCanvas();
                drawShapePreview(currentStroke, currentStroke.points[currentStroke.points.length - 1]);
            } else if (currentTool === 'eraser') {
                // Draw eraser cursor - 3x size for eraser
                clearActiveCanvas();
                drawEraserCursor(lastX, lastY, currentSize * 3);
            } else if (currentTool === 'highlighter' && currentStroke.tempCtx) {
                // Highlighter: REAL-TIME recoloring with visual effects
                const tempCtx = currentStroke.tempCtx;
                const markerColor = currentStroke.color;
                const markerRadius = Math.max(1, (currentStroke.size || 12) * 0.15);

                if (!currentStroke.tempInitialized) {
                    tempCtx.setTransform(activeCtx.getTransform());
                    tempCtx.lineCap = 'round';
                    tempCtx.lineJoin = 'round';
                    currentStroke.tempInitialized = true;
                    currentStroke.lastDrawnIndex = 0;
                    currentStroke.lastRecolorIndex = 0;
                    currentStroke.particles = []; // For trail effect
                }

                const pts = currentStroke.points;

                // REAL-TIME RECOLOR: Apply recolor for new points
                if (pts.length > 0) {
                    const recolorStart = currentStroke.lastRecolorIndex || 0;
                    for (let i = recolorStart; i < pts.length; i++) {
                        const changed = applyHighlighterRecolorRealtime(pts[i], markerRadius, markerColor);
                        if (changed) {
                            invalidateStrokeCache(false);
                        }
                    }
                    currentStroke.lastRecolorIndex = pts.length;
                }

                // Add particles for trail effect
                if (currentCursorPoint) {
                    const particle = {
                        x: currentCursorPoint.x + (Math.random() - 0.5) * markerRadius,
                        y: currentCursorPoint.y + (Math.random() - 0.5) * markerRadius,
                        size: markerRadius * (0.3 + Math.random() * 0.4),
                        alpha: 0.6 + Math.random() * 0.3,
                        life: 1.0,
                        vx: (Math.random() - 0.5) * 2,
                        vy: (Math.random() - 0.5) * 2
                    };
                    currentStroke.particles.push(particle);
                    // Limit particles
                    if (currentStroke.particles.length > 30) {
                        currentStroke.particles.shift();
                    }
                }

                // Decay/update particles
                for (let i = currentStroke.particles.length - 1; i >= 0; i--) {
                    const p = currentStroke.particles[i];
                    p.life -= 0.08;
                    p.alpha *= 0.92;
                    p.size *= 0.96;
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.life <= 0 || p.alpha < 0.05) {
                        currentStroke.particles.splice(i, 1);
                    }
                }

                // Draw to temp canvas (trail visualization)
                if (pts.length >= 2) {
                    const startIndex = Math.max(1, (currentStroke.lastDrawnIndex || 0) + 1);
                    tempCtx.strokeStyle = getThemedColor(markerColor);
                    for (let i = startIndex; i < pts.length; i++) {
                        const p0 = pts[i - 1];
                        const p1 = pts[i];
                        tempCtx.lineWidth = p1.size || currentStroke.size;
                        tempCtx.beginPath();
                        tempCtx.moveTo(p0.x, p0.y);
                        tempCtx.lineTo(p1.x, p1.y);
                        tempCtx.stroke();
                    }
                    currentStroke.lastDrawnIndex = pts.length - 1;
                }

                // Redraw main canvas to show recolored strokes
                redrawCanvas();

                // Draw visual effects on active canvas
                clearActiveCanvas();
                activeCtx.save();

                // Draw glowing trail particles
                const themedColor = getThemedColor(markerColor);
                for (const p of currentStroke.particles) {
                    activeCtx.globalAlpha = p.alpha * 0.7;
                    activeCtx.fillStyle = themedColor;
                    activeCtx.shadowColor = themedColor;
                    activeCtx.shadowBlur = p.size * 2;
                    activeCtx.beginPath();
                    activeCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    activeCtx.fill();
                }
                activeCtx.shadowBlur = 0;

                // Draw main cursor glow
                if (currentCursorPoint) {
                    const cursorSize = currentCursorPoint.size || currentStroke.size;

                    // Outer glow
                    activeCtx.globalAlpha = 0.3;
                    activeCtx.fillStyle = themedColor;
                    activeCtx.shadowColor = themedColor;
                    activeCtx.shadowBlur = cursorSize * 1.5;
                    activeCtx.beginPath();
                    activeCtx.arc(currentCursorPoint.x, currentCursorPoint.y, cursorSize * 1.2, 0, Math.PI * 2);
                    activeCtx.fill();

                    // Inner bright core
                    activeCtx.globalAlpha = 0.8;
                    activeCtx.shadowBlur = cursorSize;
                    activeCtx.beginPath();
                    activeCtx.arc(currentCursorPoint.x, currentCursorPoint.y, cursorSize * 0.6, 0, Math.PI * 2);
                    activeCtx.fill();

                    // Connecting trail line
                    if (pts.length > 0) {
                        const lastPt = pts[pts.length - 1];
                        activeCtx.globalAlpha = 0.5;
                        activeCtx.strokeStyle = themedColor;
                        activeCtx.lineWidth = cursorSize * 0.8;
                        activeCtx.lineCap = 'round';
                        activeCtx.shadowBlur = cursorSize;
                        activeCtx.beginPath();
                        activeCtx.moveTo(lastPt.x, lastPt.y);
                        activeCtx.lineTo(currentCursorPoint.x, currentCursorPoint.y);
                        activeCtx.stroke();
                    }
                }

                activeCtx.restore();

                // DEBUG: show hit-test radius as red circle (drawn on top of everything)
                if (currentCursorPoint) {
                    activeCtx.save();
                    activeCtx.globalAlpha = 1;
                    activeCtx.shadowBlur = 0;
                    activeCtx.strokeStyle = 'red';
                    activeCtx.lineWidth = 2;
                    activeCtx.beginPath();
                    activeCtx.arc(currentCursorPoint.x, currentCursorPoint.y, markerRadius, 0, Math.PI * 2);
                    activeCtx.stroke();
                    // Also draw a slightly larger dashed circle for visibility
                    activeCtx.setLineDash([4, 4]);
                    activeCtx.strokeStyle = 'white';
                    activeCtx.lineWidth = 1;
                    activeCtx.beginPath();
                    activeCtx.arc(currentCursorPoint.x, currentCursorPoint.y, markerRadius + 2, 0, Math.PI * 2);
                    activeCtx.stroke();
                    activeCtx.setLineDash([]);
                    activeCtx.restore();
                }
            } else if (currentTool === 'pen') {
                // Pen segments were appended above; leave the live path on the
                // overlay rather than replaying it from the beginning per event.
            } else {
                // Clear active canvas only - O(1)
                clearActiveCanvas();
                // Render confirmed points plus bezier curve to current cursor position
                renderSmoothStroke(currentStroke, true, currentCursorPoint, activeCtx);
            }
        }

        // Render stroke with smooth bezier curves, optionally connecting to cursor position
        // Uses optimal cubic bezier control points for iPad-like real-time smooth bending
        function renderSmoothStroke(stroke, fast = false, cursorPoint = null, targetCtx = ctx) {
            let points = stroke.points;

            if (points.length < 1) return;

            // FAST LOD: Simple step-based simplification when zoomed out
            // Only apply during full redraws (!fast) with many points
            if (!fast && stroke.tool !== 'pen' && points.length > 30 && zoom < 1) {
                // At zoom 0.5 → step 2, at zoom 0.25 → step 4, etc.
                const step = Math.min(8, Math.max(1, Math.floor(1 / zoom)));
                if (step > 1) {
                    const simplified = [points[0]];
                    for (let i = step; i < points.length - 1; i += step) {
                        simplified.push(points[i]);
                    }
                    simplified.push(points[points.length - 1]);
                    points = simplified;
                }
            }

            const isHighlighter = stroke.tool === 'highlighter';
            const { composite, alpha } = isHighlighter
                ? getHighlighterBlendMode()
                : { composite: 'source-over', alpha: 1 };

            targetCtx.save();
            targetCtx.lineCap = 'round';
            targetCtx.lineJoin = 'round';
            targetCtx.globalCompositeOperation = composite;
            targetCtx.globalAlpha = alpha;
            targetCtx.strokeStyle = getThemedColor(stroke.color);

            // Handle single point - just draw a dot
            if (points.length === 1 && !cursorPoint) {
                const p = points[0];
                targetCtx.beginPath();
                targetCtx.arc(p.x, p.y, (p.size || stroke.size) / 2, 0, Math.PI * 2);
                targetCtx.fillStyle = getThemedColor(stroke.color);
                targetCtx.fill();
                targetCtx.restore();
                return;
            }

            // If we have a cursor point for real-time connection, add it temporarily
            let allPoints = cursorPoint ? [...points, cursorPoint] : points;

            if (allPoints.length === 2) {
                targetCtx.lineWidth = ((allPoints[0].size || stroke.size) + (allPoints[1].size || stroke.size)) / 2;
                targetCtx.beginPath();
                targetCtx.moveTo(allPoints[0].x, allPoints[0].y);
                targetCtx.lineTo(allPoints[1].x, allPoints[1].y);
                targetCtx.stroke();
                targetCtx.restore();
                return;
            }

            // Use optimal cubic bezier control points for smooth real-time bending
            // This creates the iPad-like effect where curves smoothly adjust as you draw
            // PERF: Cache control points for finalized strokes (no LOD, no cursor)
            let controlPoints;
            const canCacheBezier = !fast && !cursorPoint && allPoints === stroke.points;
            if (canCacheBezier && stroke._bezierCP) {
                controlPoints = stroke._bezierCP;
            } else {
                controlPoints = stroke.tool === 'pen'
                    ? getRealtimePenControlPoints(allPoints)
                    : getBezierControlPoints(allPoints);
                if (canCacheBezier && controlPoints) {
                    stroke._bezierCP = controlPoints;
                }
            }

            if (!controlPoints) {
                // Fallback to simple line if control points fail
                targetCtx.lineWidth = stroke.size;
                targetCtx.beginPath();
                targetCtx.moveTo(allPoints[0].x, allPoints[0].y);
                for (let i = 1; i < allPoints.length; i++) {
                    targetCtx.lineTo(allPoints[i].x, allPoints[i].y);
                }
                targetCtx.stroke();
                targetCtx.restore();
                return;
            }

            // Path2D keeps finalized pen geometry resolution-independent and
            // avoids replaying thousands of Bézier commands on each pan/zoom
            // frame. The context transform still rasterizes it at native DPR.
            const hasDynamicSize = dynamicBrushEnabled && allPoints[0]?.size !== undefined;
            if (canCacheBezier && !hasDynamicSize && typeof Path2D !== 'undefined') {
                if (!stroke._bezierPath) {
                    const path = new Path2D();
                    path.moveTo(allPoints[0].x, allPoints[0].y);
                    for (let i = 0; i < allPoints.length - 1; i++) {
                        const endPoint = allPoints[i + 1];
                        path.bezierCurveTo(
                            controlPoints.firstControlPoints[i].x,
                            controlPoints.firstControlPoints[i].y,
                            controlPoints.secondControlPoints[i].x,
                            controlPoints.secondControlPoints[i].y,
                            endPoint.x,
                            endPoint.y
                        );
                    }
                    Object.defineProperty(stroke, '_bezierPath', {
                        value: path,
                        writable: true,
                        configurable: true,
                        enumerable: false
                    });
                }
                targetCtx.lineWidth = stroke.size;
                targetCtx.stroke(stroke._bezierPath);
                targetCtx.restore();
                return;
            }

            const { firstControlPoints, secondControlPoints } = controlPoints;

            if (hasDynamicSize) {
                // Draw segments with varying width using cubic bezier
                for (let i = 0; i < allPoints.length - 1; i++) {
                    const p0 = allPoints[i];
                    const p1 = allPoints[i + 1];
                    const cp1 = firstControlPoints[i];
                    const cp2 = secondControlPoints[i];

                    // Average size for this segment
                    const segmentSize = ((p0.size || stroke.size) + (p1.size || stroke.size)) / 2;
                    targetCtx.lineWidth = segmentSize;

                    targetCtx.beginPath();
                    targetCtx.moveTo(p0.x, p0.y);
                    targetCtx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p1.x, p1.y);
                    targetCtx.stroke();
                }
            } else {
                // Uniform width - draw as one continuous path with cubic beziers
                targetCtx.lineWidth = stroke.size;
                targetCtx.beginPath();
                targetCtx.moveTo(allPoints[0].x, allPoints[0].y);

                for (let i = 0; i < allPoints.length - 1; i++) {
                    const cp1 = firstControlPoints[i];
                    const cp2 = secondControlPoints[i];
                    const endPoint = allPoints[i + 1];

                    targetCtx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
                }

                targetCtx.stroke();
            }

            targetCtx.restore();
        }

        function drawShapePreview(stroke, endPoint) {
            const startPoint = stroke.points[0];
            activeCtx.strokeStyle = getThemedColor(stroke.color);
            activeCtx.lineWidth = stroke.size;
            activeCtx.globalAlpha = 1;
            activeCtx.setLineDash([]);

            activeCtx.beginPath();

            switch (stroke.tool) {
                case 'line':
                    activeCtx.moveTo(startPoint.x, startPoint.y);
                    activeCtx.lineTo(endPoint.x, endPoint.y);
                    break;

                case 'rectangle':
                    const width = endPoint.x - startPoint.x;
                    const height = endPoint.y - startPoint.y;
                    activeCtx.rect(startPoint.x, startPoint.y, width, height);
                    break;

                case 'circle':
                    const radius = Math.sqrt(
                        Math.pow(endPoint.x - startPoint.x, 2) +
                        Math.pow(endPoint.y - startPoint.y, 2)
                    );
                    activeCtx.arc(startPoint.x, startPoint.y, radius, 0, Math.PI * 2);
                    break;

                case 'arrow':
                    drawArrow(activeCtx, startPoint.x, startPoint.y, endPoint.x, endPoint.y);
                    break;
            }

            activeCtx.stroke();
        }

        function drawEraserCursor(x, y, radius) {
            activeCtx.beginPath();
            activeCtx.arc(x, y, radius, 0, Math.PI * 2);

            // Radial gradient: transparent inside -> white edge
            const gradient = activeCtx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0.9)');

            activeCtx.fillStyle = gradient;
            activeCtx.fill();

            // Thin border for contrast
            activeCtx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            activeCtx.lineWidth = 1;
            activeCtx.stroke();
        }

        function drawArrow(ctx, fromX, fromY, toX, toY) {
            const headLength = 15;
            const angle = Math.atan2(toY - fromY, toX - fromX);

            // Line
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);

            // Arrowhead
            ctx.lineTo(
                toX - headLength * Math.cos(angle - Math.PI / 6),
                toY - headLength * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(toX, toY);
            ctx.lineTo(
                toX - headLength * Math.cos(angle + Math.PI / 6),
                toY - headLength * Math.sin(angle + Math.PI / 6)
            );
        }

        function stopDrawing(e) {
            if (!isDrawing) return;
            if (e && drawingPointerId !== null && e.pointerId !== drawingPointerId) return;
            if(window.GeometryWorkbench?.finish(e))return;

            // Store the exact release point. The spatial Bézier renderer keeps
            // the final segment smooth without introducing a lagging straight
            // tail of interpolated points.
            if (currentStroke && e && currentStroke.tool !== 'eraser' && currentStroke.points?.length) {
                const endpoint = getCanvasPoint(e);
                const lastPoint = currentStroke.points[currentStroke.points.length - 1];
                const dx = endpoint.x - lastPoint.x;
                const dy = endpoint.y - lastPoint.y;
                if (dx * dx + dy * dy > 0.0001) {
                    endpoint.size = lastPoint.size || currentStroke.size;
                    endpoint.pressure = endpoint.pressure > 0 ? endpoint.pressure : (lastPoint.pressure || 0.5);
                    if (currentStroke.tool === 'pen' && currentStroke.livePoint) {
                        const start = currentStroke.livePoint;
                        const previous = currentStroke.livePreviousPoint;
                        activeCtx.save();
                        activeCtx.globalAlpha = 1;
                        activeCtx.globalCompositeOperation = 'source-over';
                        activeCtx.strokeStyle = getThemedColor(currentStroke.color);
                        activeCtx.lineWidth = (start.size + endpoint.size) / 2;
                        activeCtx.lineCap = 'round';
                        activeCtx.lineJoin = 'round';
                        activeCtx.beginPath();
                        activeCtx.moveTo(start.x, start.y);
                        const controls = getRealtimePenSegmentControls(previous, start, endpoint);
                        activeCtx.bezierCurveTo(
                            controls.first.x,
                            controls.first.y,
                            controls.second.x,
                            controls.second.y,
                            endpoint.x,
                            endpoint.y
                        );
                        activeCtx.stroke();
                        activeCtx.restore();
                        currentStroke.livePreviousPoint = start;
                        currentStroke.livePoint = { x: endpoint.x, y: endpoint.y, size: endpoint.size };
                    }
                    currentStroke.points.push(endpoint);
                }
            }

            isDrawing = false;
            drawingPointerId = null;
            smoothPointInitialized = false; // Reset for next stroke
            smoothingBuffer = []; // Reset smoothing buffer for next stroke

            // Keep document serialization out of the pen-up input handler.
            if (currentTool === 'eraser') {
                clearActiveCanvas();
                if (window.saveTimeout) {
                    clearTimeout(window.saveTimeout);
                    window.saveTimeout = null;
                    triggerAutoSave();
                }
                return;
            }

            if (!currentStroke) {
                clearActiveCanvas();
                return;
            }

            if (currentStroke.points.length > 0) {
                // Clean up temp canvas reference before saving
                if (currentStroke.tempCanvas) {
                    delete currentStroke.tempCanvas;
                    delete currentStroke.tempCtx;
                }

                if (currentStroke.tool === 'highlighter') {
                    const recolored = applyHighlighterRecolor(currentStroke);
                    clearActiveCanvas();
                    if (recolored) {
                        redrawCanvas();
                        triggerAutoSave();
                    }
                } else {
                    delete currentStroke.livePoint;
                    delete currentStroke.livePreviousPoint;
                    delete currentStroke.liveStartBounds;
                    delete currentStroke.liveSampleTime;
                    // Apply geometry detection if enabled
                    let finalStroke = currentStroke;
                    if (window.GeometryDetector && window.GeometryDetector.isEnabled()) {
                        finalStroke = window.GeometryDetector.processStroke(currentStroke);
                    }

                    const arrowGroup=window.GeometryDetector?.joinArrowGroup?.(strokes,currentStroke);
                    if(arrowGroup){
                        const before={strokes:arrowGroup.remove.map(index=>({index,item:structuredClone(strokes[index])})),images:[]};
                        strokes=strokes.filter((_,index)=>!arrowGroup.remove.includes(index));strokes.splice(arrowGroup.index,0,arrowGroup.stroke);
                        historyStack.push({type:'lasso-edit',before,after:{strokes:[{index:arrowGroup.index,item:structuredClone(arrowGroup.stroke)}],images:[]}});invalidateStrokeCache(false);
                        window.dispatchEvent(new CustomEvent('geometryRecognized',{detail:{type:'arrow',confidence:.9}}));
                    }else{
                        strokes.push(finalStroke);
                        if (!appendStrokeToCache(finalStroke)) invalidateStrokeCache(false);
                        historyStack.push({ type: 'add', stroke: finalStroke });
                    }
                    redoStack = [];

                    // Commit the main layer in this input turn, then remove
                    // the live overlay. No blank cache-rebuild frame in between.
                    redrawCanvas(true);
                    clearActiveCanvas();

                    // Snapshot after interaction settles, not during pen-up.
                    triggerAutoSave();
                }
            }

            currentStroke = null;
        }

        // Ramer-Douglas-Peucker simplification
        function simplifyPoints(points, tolerance) {
            if (points.length <= 2) return points;

            const sqTolerance = tolerance * tolerance;

            // Find the point with the maximum distance
            let maxSqDist = 0;
            let index = 0;
            const end = points.length - 1;

            for (let i = 1; i < end; i++) {
                const sqDist = getSqSegDist(points[i], points[0], points[end]);
                if (sqDist > maxSqDist) {
                    maxSqDist = sqDist;
                    index = i;
                }
            }

            // If max distance is greater than epsilon, recursively simplify
            if (maxSqDist > sqTolerance) {
                const left = simplifyPoints(points.slice(0, index + 1), tolerance);
                const right = simplifyPoints(points.slice(index), tolerance);
                return left.slice(0, left.length - 1).concat(right);
            } else {
                return [points[0], points[end]];
            }
        }

        function getSqSegDist(p, p1, p2) {
            let x = p1.x, y = p1.y;
            let dx = p2.x - x, dy = p2.y - y;

            if (dx !== 0 || dy !== 0) {
                const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
                if (t > 1) {
                    x = p2.x;
                    y = p2.y;
                } else if (t > 0) {
                    x += dx * t;
                    y += dy * t;
                }
            }

            dx = p.x - x;
            dy = p.y - y;
            return dx * dx + dy * dy;
        }

// ============== History ==============
        function undo() {
            if (historyStack.length === 0) return;
            window.PaintFill?.cancel();window.HistoryMotion?.finish();
            const action = historyStack.pop();
            const motion=action.stroke&&['add','remove'].includes(action.type)?window.HistoryMotion?.prepare(action.stroke):null;
            if(action.type==='lasso-edit') {
                window.LassoWorkbench.restore(action,'before');redoStack.push(action);
            } else if (action.type === 'add') {
                strokes = strokes.filter(s => s.id !== action.stroke.id);
                invalidateStrokeCache(false);
                redoStack.push(action);
            } else if (action.type === 'remove') {
                strokes.push(action.stroke);
                invalidateStrokeCache(false);
                redoStack.push(action);
            } else if (action.type === 'transform') {
                // Restore strokes to before state
                for (let i = 0; i < action.strokeIndices.length; i++) {
                    const idx = action.strokeIndices[i];
                    if (idx < strokes.length) {
                        strokes[idx] = structuredClone(action.beforeStrokes[i]);
                    }
                }
                // Restore text field charColors
                if (action.textFieldChanges && typeof HandwrittenTextField !== 'undefined') {
                    const textFields = HandwrittenTextField.getTextFields();
                    for (const change of action.textFieldChanges) {
                        const field = textFields.find(f => f.id === change.fieldId);
                        if (field) {
                            field.charColors = [...change.before];
                        }
                    }
                }
                invalidateStrokeCache();
                // Clear lasso selection to avoid stale state
                if (typeof clearLassoSelection === 'function') {
                    clearLassoSelection();
                }
                redoStack.push(action);
            } else if (action.type === 'image-add') {
                // Undo image add = remove it
                images = images.filter(img => img.id !== action.image.id);
                if (typeof selectedImage !== 'undefined' && selectedImage && selectedImage.id === action.image.id) {
                    if (typeof deselectImage === 'function') deselectImage();
                    else selectedImage = null;
                }
                redoStack.push(action);
            } else if (action.type === 'image-remove') {
                // Undo image remove = add it back
                images.push(structuredClone(action.image));
                redoStack.push(action);
            } else if (action.type === 'image-transform') {
                // Undo image transform = restore to before state
                const img = images.find(i => i.id === action.imageId);
                if (img) {
                    Object.assign(img, structuredClone(action.before));
                }
                if (typeof selectedImage !== 'undefined' && selectedImage && selectedImage.id === action.imageId) {
                    Object.assign(selectedImage, structuredClone(action.before));
                }
                redoStack.push(action);
            }
            redrawCanvas(true);
            if(motion)window.HistoryMotion.play(action.stroke,action.type==='remove',motion);
            triggerAutoSave();
        }

        function redo() {
            if (redoStack.length === 0) return;
            window.PaintFill?.cancel();window.HistoryMotion?.finish();
            const action = redoStack.pop();
            const motion=action.stroke&&['add','remove'].includes(action.type)?window.HistoryMotion?.prepare(action.stroke):null;
            if(action.type==='lasso-edit') {
                window.LassoWorkbench.restore(action,'after');historyStack.push(action);
            } else if (action.type === 'add') {
                strokes.splice(Math.min(action.index??strokes.length,strokes.length),0,action.stroke);
                invalidateStrokeCache(false);
                historyStack.push(action);
            } else if (action.type === 'remove') {
                strokes = strokes.filter(s => s.id !== action.stroke.id);
                invalidateStrokeCache(false);
                historyStack.push(action);
            } else if (action.type === 'transform') {
                // Restore strokes to after state
                for (let i = 0; i < action.strokeIndices.length; i++) {
                    const idx = action.strokeIndices[i];
                    if (idx < strokes.length) {
                        strokes[idx] = structuredClone(action.afterStrokes[i]);
                    }
                }
                // Restore text field charColors to after state
                if (action.textFieldChanges && typeof HandwrittenTextField !== 'undefined') {
                    const textFields = HandwrittenTextField.getTextFields();
                    for (const change of action.textFieldChanges) {
                        const field = textFields.find(f => f.id === change.fieldId);
                        if (field) {
                            field.charColors = [...change.after];
                        }
                    }
                }
                invalidateStrokeCache();
                // Clear lasso selection to avoid stale state
                if (typeof clearLassoSelection === 'function') {
                    clearLassoSelection();
                }
                historyStack.push(action);
            } else if (action.type === 'image-add') {
                // Redo image add = add it back
                images.push(structuredClone(action.image));
                historyStack.push(action);
            } else if (action.type === 'image-remove') {
                // Redo image remove = remove it again
                images = images.filter(img => img.id !== action.image.id);
                if (typeof selectedImage !== 'undefined' && selectedImage && selectedImage.id === action.image.id) {
                    if (typeof deselectImage === 'function') deselectImage();
                    else selectedImage = null;
                }
                historyStack.push(action);
            } else if (action.type === 'image-transform') {
                // Redo image transform = restore to after state
                const img = images.find(i => i.id === action.imageId);
                if (img) {
                    Object.assign(img, structuredClone(action.after));
                }
                if (typeof selectedImage !== 'undefined' && selectedImage && selectedImage.id === action.imageId) {
                    Object.assign(selectedImage, structuredClone(action.after));
                }
                historyStack.push(action);
            }
            redrawCanvas(true);
            if(motion)window.HistoryMotion.play(action.stroke,action.type==='add',motion);
            triggerAutoSave();
        }

        // ============== Zoom & Pan ==============
        // Internal zoom setter - no redraw, for batching with pan
        function _setZoomInternal(newZoom, pivotX = null, pivotY = null, elastic = false) {
            const oldZoom = zoom;
            const newZoomClamped = elastic==='settling'?Math.max(.15,Math.min(520,newZoom)):
                window.ViewLimits?ViewLimits.zoom(newZoom,elastic):Math.max(.2,Math.min(400,newZoom));

            if (pivotX !== null && pivotY !== null) {
                // Zoom around pivot point (touch center)
                // Pivot is in SCREEN coordinates relative to viewport
                const rect = canvas.getBoundingClientRect();

                const pivotRelX = pivotX - rect.left;
                const pivotRelY = pivotY - rect.top;
                window.ViewLimits?.setPivot(pivotRelX,pivotRelY);

                // Adjust pan to keep pivot point stationary
                const worldPivotX = (pivotRelX - panX) / oldZoom;
                const worldPivotY = (pivotRelY - panY) / oldZoom;

                panX = pivotRelX - worldPivotX * newZoomClamped;
                panY = pivotRelY - worldPivotY * newZoomClamped;
            }

            zoom = newZoomClamped;
            window.zoom = newZoomClamped; // Keep window.zoom in sync for other modules
            const zoomDisplay = document.getElementById('zoomValue');
            const zoomLabel = Math.round(zoom * 100) + '%';
            if (zoomDisplay.textContent !== zoomLabel) zoomDisplay.textContent = zoomLabel;
        }

        // Gestures are already frame-batched by their input handlers. Redraw at
        // the real camera resolution each frame; scaling a viewport bitmap made
        // zoom look soft and exposed blank/cropped edges on zoom-out.
        let gesturePreviewActive = false;
        let gesturePreviewFrame = 0;
        function beginGesturePreview() {
            window.ViewLimits?.cancel();
            if (!gesturePreviewActive) clearActiveCanvas();
            gesturePreviewActive = true;
        }

        function updateGesturePreview(alreadyFrameBatched = false) {
            if (!gesturePreviewActive) beginGesturePreview();
            // Pointer gestures are already sampled once per display frame by
            // 09_events. Do not queue a second RAF or pinch becomes one frame
            // behind the fingers and can feel as if updates were lost.
            if (alreadyFrameBatched) {
                if (gesturePreviewFrame) {
                    cancelAnimationFrame(gesturePreviewFrame);
                    gesturePreviewFrame = 0;
                }
                redrawCanvas(true);
                return;
            }
            // Touchpads/tablets may deliver several camera updates per frame.
            // Keep the latest camera state, but render it only once per display
            // frame so a large vector page cannot queue redundant full redraws.
            if (gesturePreviewFrame) return;
            gesturePreviewFrame = requestAnimationFrame(() => {
                gesturePreviewFrame = 0;
                redrawCanvas(true);
            });
        }

        function endGesturePreview(render = true, settle = true) {
            if (!gesturePreviewActive) return;
            gesturePreviewActive = false;
            if (gesturePreviewFrame) {
                cancelAnimationFrame(gesturePreviewFrame);
                gesturePreviewFrame = 0;
            }
            // Render the settled camera immediately at native device resolution.
            if (render) redrawCanvas(true);
            if(settle)window.ViewLimits?.settle();
        }

        window._beginGesturePreview = beginGesturePreview;
        window._updateGesturePreview = updateGesturePreview;
        window._endGesturePreview = endGesturePreview;

        // Expose internal zoom function for gesture control (no redraw, for CSS transform batching)
        window._setZoomInternal = _setZoomInternal;
        window.executeHighResRebuild = executeHighResRebuild;

        function setZoom(newZoom, pivotX = null, pivotY = null) {
            _setZoomInternal(newZoom, pivotX, pivotY);
            // Force immediate redraw for instant response
            redrawCanvas(true);
        }

        function setPan(x, y) {
            const limited=window.ViewLimits?ViewLimits.pan(x,y):{x,y};
            panX = limited.x;
            panY = limited.y;
            // Force immediate redraw for instant response
            redrawCanvas(true);
        }

        function updateCanvasTransform() {
            // In Camera model, we DO NOT use CSS transforms on the wrapper.
            // We only need to ensure any overlay elements (if added later) are positioned correctly.
            // For now, this is a no-op for the main canvas rendering.
        }

// ============== Touch Gestures ==============
        function getTouchDistance(t1, t2) {
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function getTouchCenter(t1, t2) {
            return {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2
            };
        }

        function clampValue(value, min, max) {
            return Math.max(min, Math.min(max, value));
        }

        function handleTouchStart(e) {
            // Palm rejection: check ALL touches — if pen is active, was recently used,
            // or any touch has a palm-like contact area, block entire gesture
            if (shouldRejectTouchList(e.touches)) {
                if (e.cancelable) {
                    e.preventDefault();
                }
                return;
            }

            touches = Array.from(e.touches);

            // 2-finger pinch/zoom/pan
            if (touches.length === 2) {
                e.preventDefault();
                beginGesturePreview();
                isPinching = true;
                isPanning = true;

                // Cancel any pending page resize trigger - zooming/panning is NOT resize
                cancelResizeTrigger();

                if (isDrawing && drawingPointerId !== null) {
                    if (fingerDrawingEnabled) {
                         isDrawing = false;
                         drawingPointerId = null;
                         currentStroke = null;
                         activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
                    }
                }

                isPointerPanning = false;
                panningPointerId = null;

                lastTouchDistance = getTouchDistance(touches[0], touches[1]);
                lastTouchCenter = getTouchCenter(touches[0], touches[1]);
            }
        }

        function handleTouchMove(e) {
            // Palm rejection: check ALL touches — abort gesture if palm detected
            if (shouldRejectTouchList(e.touches)) {
                // Reset gesture state to prevent partial gestures
                isPinching = false;
                isPanning = false;
                return;
            }

            touches = Array.from(e.touches);

            if (touches.length === 2) {
                e.preventDefault();

                // Check for image pinch (scale/rotate selected image)
                if (typeof selectedImage !== 'undefined' && selectedImage && typeof handleImagePinch === 'function') {
                    if (handleImagePinch(touches[0], touches[1])) {
                        return; // Image is handling the pinch
                    }
                }

                // ALWAYS do pinch/pan when 2 fingers are moving
                const newDistance = getTouchDistance(touches[0], touches[1]);
                const newCenter = getTouchCenter(touches[0], touches[1]);

                // Use internal zoom setter (no redraw) to batch zoom+pan in single redraw
                if (lastTouchDistance > 0) {
                    const scale = newDistance / lastTouchDistance;
                    const newZoom = zoom * scale;
                    // Preserve the world point under the previous midpoint;
                    // the translation below then carries it to the new one.
                    _setZoomInternal(newZoom, lastTouchCenter.x, lastTouchCenter.y);
                }

                // Direct 1:1 pan - camera moves, strokes stay fixed in world space
                panX += newCenter.x - lastTouchCenter.x;
                panY += newCenter.y - lastTouchCenter.y;

                lastTouchDistance = newDistance;
                lastTouchCenter = newCenter;

                updateGesturePreview();
            }
        }

        function handleTouchEnd(e) {
            // End image pinch if active
            if (typeof handleImagePinchEnd === 'function') {
                handleImagePinchEnd();
            }

            if (e.touches.length < 2) {
                isPinching = false;
                isPanning = false;
                lastTouchDistance = 0;
                endGesturePreview();

            }

            if (e.touches.length === 0) {
                stopDrawing();
            }
            touches = Array.from(e.touches);
        }

        // Mouse wheel zoom
        let wheelZoomTimer = null;
        let wheelPanTimer = null;
        let isWheelZooming = false;
        function handleWheel(e) {
            if (isDrawing) return;

            // Chromium/Electron maps trackpad pinch to Ctrl+wheel. Use a
            // proportional exponential scale for smooth, device-independent zoom.
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = Math.max(-0.35, Math.min(0.35, -e.deltaY * 0.006));
                beginGesturePreview();
                isWheelZooming = true;
                _setZoomInternal(zoom * Math.exp(delta), e.clientX, e.clientY, true);
                if(window.ViewLimits){const p=ViewLimits.pan(panX,panY,zoom,true);panX=p.x;panY=p.y;}
                updateGesturePreview();

                // Schedule cache rebuild after wheel stops
                if (wheelZoomTimer) clearTimeout(wheelZoomTimer);
                wheelZoomTimer = setTimeout(() => {
                    isWheelZooming = false;
                    endGesturePreview();
                    wheelZoomTimer = null;
                }, 200);
                return;
            }

            // Linux two-finger touchpad scroll is normally a regular wheel event.
            // Pan by its smooth pixel delta; normalize line/page-based devices.
            const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
                : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewportHeight : 1;
            const dx = e.deltaX * unit;
            const dy = e.deltaY * unit;
            if (Math.abs(dx) + Math.abs(dy) > 0) {
                e.preventDefault();
                if (!isPinching && !isPointerPanning) isPanning = true;
                panX -= dx;
                panY -= dy;
                if(window.ViewLimits){const p=ViewLimits.pan(panX,panY,zoom,true);panX=p.x;panY=p.y;}
                redrawCanvas();
                if (wheelPanTimer) clearTimeout(wheelPanTimer);
                wheelPanTimer = setTimeout(() => {
                    wheelPanTimer = null;
                    if (!isPinching && !isPointerPanning) {isPanning = false;window.ViewLimits?.settle();}
                }, 120);
            }
        }
