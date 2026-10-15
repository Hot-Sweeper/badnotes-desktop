/**
 * RenderEngine - High-performance canvas rendering engine
 * Optimized for 120Hz displays with requestAnimationFrame batching
 */
class RenderEngine extends EventEmitter {
    constructor() {
        super();

        this.canvas = null;
        this.ctx = null;
        this.previewCanvas = null;
        this.previewCtx = null;
        this.uiCanvas = null;
        this.uiCtx = null;

        // Render state
        this.isRendering = false;
        this.renderQueue = [];
        this.frameId = null;
        this.lastFrameTime = 0;
        // Default to uncapped; RAF will follow display refresh (240Hz+ if available)
        this.targetFPS = 0;
        this.frameInterval = 0;

        // Performance tracking
        this.frameCount = 0;
        this.fps = 0;
        this.fpsUpdateTime = 0;

        // Dirty regions for optimized rendering
        this.dirtyRegions = [];
        this.fullRedrawNeeded = true;

        // Off-screen buffer for complex operations
        this.offscreenCanvas = null;
        this.offscreenCtx = null;

        // Layer caching
        this.layerCache = new Map();
    }

    /**
     * Initialize the render engine with canvas elements
     * @param {Object} canvases - Canvas elements
     */
    init(canvases) {
        this.canvas = canvases.main;
        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true, // Reduces latency for pen input
        });

        this.previewCanvas = canvases.preview;
        this.previewCtx = this.previewCanvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
        });

        this.uiCanvas = canvases.ui;
        this.uiCtx = this.uiCanvas.getContext('2d', {
            alpha: true,
        });

        // Create off-screen buffer
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');

        // Set up high-DPI rendering
        this._setupHighDPI();

        // Start render loop
        this._startRenderLoop();

        this.emit('initialized');
    }

    /**
     * Set up high-DPI canvas rendering
     */
    _setupHighDPI() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        // Scale all canvases
        [this.canvas, this.previewCanvas, this.uiCanvas, this.offscreenCanvas].forEach(canvas => {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        });

        // Scale contexts
        [this.ctx, this.previewCtx, this.uiCtx, this.offscreenCtx].forEach(ctx => {
            ctx.scale(dpr, dpr);
        });

        // Store dimensions
        this.width = rect.width;
        this.height = rect.height;
        this.dpr = dpr;

        this.fullRedrawNeeded = true;
    }

    /**
     * Resize canvases
     * @param {number} width - New width
     * @param {number} height - New height
     */
    resize(width, height) {
        const dpr = this.dpr || window.devicePixelRatio || 1;

        [this.canvas, this.previewCanvas, this.uiCanvas, this.offscreenCanvas].forEach(canvas => {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        });

        [this.ctx, this.previewCtx, this.uiCtx, this.offscreenCtx].forEach(ctx => {
            ctx.scale(dpr, dpr);
        });

        this.width = width;
        this.height = height;
        this.fullRedrawNeeded = true;

        this.emit('resize', { width, height });
    }

    /**
     * Start the render loop
     * PERFORMANCE: Optimized timing with high-precision timestamps
     */
    _startRenderLoop() {
        // PERFORMANCE: Use bind once instead of arrow function each frame
        const self = this;

        // PERFORMANCE: Pre-calculate frame budget
        let lastTimestamp = 0;

        function render(timestamp) {
            self.frameId = requestAnimationFrame(render);

            // PERFORMANCE: Use integer math for frame timing when possible
            const deltaTime = timestamp - lastTimestamp;
            // Only gate frames when a target FPS is explicitly set (>0)
            if (self.frameInterval > 0 && deltaTime < self.frameInterval) {
                return;
            }

            lastTimestamp = timestamp;

            // Update FPS counter
            self.frameCount++;
            if (timestamp - self.fpsUpdateTime >= 1000) {
                self.fps = self.frameCount;
                self.frameCount = 0;
                self.fpsUpdateTime = timestamp;
            }

            // Process render queue
            self._processRenderQueue();
        }

        this.frameId = requestAnimationFrame(render);
    }

    /**
     * Stop the render loop
     */
    stop() {
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
    }

    /**
     * Process queued render operations
     */
    _processRenderQueue() {
        if (this.renderQueue.length === 0 && !this.fullRedrawNeeded && this.dirtyRegions.length === 0) {
            return;
        }

        this.isRendering = true;

        // Full redraw if needed
        if (this.fullRedrawNeeded) {
            this._fullRedraw();
            this.fullRedrawNeeded = false;
            this.dirtyRegions = [];
        }
        // Partial updates for dirty regions
        else if (this.dirtyRegions.length > 0) {
            this._redrawDirtyRegions();
            this.dirtyRegions = [];
        }

        // Process queued operations
        while (this.renderQueue.length > 0) {
            const operation = this.renderQueue.shift();
            try {
                operation();
            } catch (error) {
                console.error('Render operation failed:', error);
            }
        }

        this.isRendering = false;
    }

    /**
     * Queue a render operation
     * @param {Function} operation - Render function
     */
    queue(operation) {
        this.renderQueue.push(operation);
    }

    /**
     * Request a full redraw
     */
    requestRedraw() {
        this.fullRedrawNeeded = true;
    }

    /**
     * Mark a region as dirty (needs redraw)
     * PERFORMANCE: With stroke caching, full redraws are cheap (just compositing
     * the cached canvas). Always do full redraw for correctness — proper background
     * color, z-ordering, and all element types rendered.
     * @param {Object} rect - {x, y, width, height}
     */
    markDirty(rect) {
        this.fullRedrawNeeded = true;
    }

    /**
     * Perform a full canvas redraw
     */
    _fullRedraw() {
        this.emit('beforeRedraw');

        // Clear main canvas
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Render all elements
        this.emit('redraw', this.ctx);

        this.emit('afterRedraw');
    }

    /**
     * Redraw only dirty regions
     */
    _redrawDirtyRegions() {
        // Merge overlapping regions
        const mergedRegions = this._mergeRegions(this.dirtyRegions);

        for (const region of mergedRegions) {
            // Save context state
            this.ctx.save();

            // Clip to dirty region
            this.ctx.beginPath();
            this.ctx.rect(region.x, region.y, region.width, region.height);
            this.ctx.clip();

            // Clear region
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(region.x, region.y, region.width, region.height);

            // Emit redraw for this region
            this.emit('redrawRegion', this.ctx, region);

            // Restore context
            this.ctx.restore();
        }
    }

    /**
     * Merge overlapping dirty regions
     */
    _mergeRegions(regions) {
        if (regions.length <= 1) return regions;

        // Simple bounding box merge for now
        // TODO: More sophisticated region merging
        const merged = [];
        const used = new Set();

        for (let i = 0; i < regions.length; i++) {
            if (used.has(i)) continue;

            let current = { ...regions[i] };

            for (let j = i + 1; j < regions.length; j++) {
                if (used.has(j)) continue;

                if (this._regionsOverlap(current, regions[j])) {
                    current = this._mergeTwo(current, regions[j]);
                    used.add(j);
                }
            }

            merged.push(current);
        }

        return merged;
    }

    /**
     * Check if two regions overlap
     */
    _regionsOverlap(a, b) {
        return !(a.x + a.width < b.x ||
                 b.x + b.width < a.x ||
                 a.y + a.height < b.y ||
                 b.y + b.height < a.y);
    }

    /**
     * Merge two regions into one
     */
    _mergeTwo(a, b) {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const right = Math.max(a.x + a.width, b.x + b.width);
        const bottom = Math.max(a.y + a.height, b.y + b.height);

        return { x, y, width: right - x, height: bottom - y };
    }

    // ===== Preview Canvas Methods =====

    /**
     * Clear preview canvas
     */
    clearPreview() {
        this.previewCtx.clearRect(0, 0, this.width, this.height);
    }

    /**
     * Draw on preview canvas
     * @param {Function} drawFn - Drawing function
     */
    drawPreview(drawFn) {
        drawFn(this.previewCtx);
    }

    // ===== UI Canvas Methods =====

    /**
     * Clear UI canvas
     */
    clearUI() {
        this.uiCtx.clearRect(0, 0, this.width, this.height);
    }

    /**
     * Draw on UI canvas
     * @param {Function} drawFn - Drawing function
     */
    drawUI(drawFn) {
        drawFn(this.uiCtx);
    }

    // ===== Utility Methods =====

    /**
     * Convert screen coordinates to canvas coordinates
     * @param {number} x - Screen X
     * @param {number} y - Screen Y
     * @returns {Object} Canvas coordinates
     */
    screenToCanvas(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: x - rect.left,
            y: y - rect.top
        };
    }

    /**
     * Get canvas as data URL
     * @param {string} type - Image type
     * @param {number} quality - Quality (0-1)
     */
    toDataURL(type = 'image/png', quality = 1) {
        return this.canvas.toDataURL(type, quality);
    }

    /**
     * Get canvas as Blob
     * @param {string} type - Image type
     * @param {number} quality - Quality (0-1)
     */
    toBlob(type = 'image/png', quality = 1) {
        return new Promise(resolve => {
            this.canvas.toBlob(resolve, type, quality);
        });
    }

    /**
     * Get current FPS
     */
    getFPS() {
        return this.fps;
    }

    /**
     * Set target FPS
     * @param {number} fps - Target FPS (30, 60, 120)
     */
    setTargetFPS(fps) {
        this.targetFPS = fps;
        this.frameInterval = fps > 0 ? 1000 / fps : 0;
    }

    /**
     * Create a cached layer
     * @param {string} id - Layer ID
     * @param {Function} drawFn - Drawing function
     */
    cacheLayer(id, drawFn) {
        const cache = document.createElement('canvas');
        cache.width = this.canvas.width;
        cache.height = this.canvas.height;
        const cacheCtx = cache.getContext('2d');
        cacheCtx.scale(this.dpr, this.dpr);

        drawFn(cacheCtx);

        this.layerCache.set(id, cache);
    }

    /**
     * Draw cached layer
     * @param {string} id - Layer ID
     */
    drawCachedLayer(id) {
        const cache = this.layerCache.get(id);
        if (cache) {
            this.ctx.drawImage(cache, 0, 0, this.width, this.height);
        }
    }

    /**
     * Invalidate cached layer
     * @param {string} id - Layer ID
     */
    invalidateCache(id) {
        this.layerCache.delete(id);
    }

    /**
     * Clear all caches
     */
    clearAllCaches() {
        this.layerCache.clear();
    }
}

// Global render engine instance
window.RenderEngine = new RenderEngine();
