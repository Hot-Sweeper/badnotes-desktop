/**
 * CanvasManager - Main canvas orchestration
 * Manages canvas state, elements, and rendering coordination
 */
class CanvasManager extends EventEmitter {
    constructor() {
        super();

        this.container = null;
        this.wrapper = null;
        this.mainCanvas = null;
        this.previewCanvas = null;
        this.uiCanvas = null;

        // Canvas state
        this.width = 1920;
        this.height = 1080;
        this.dpr = window.devicePixelRatio || 1;

        // Elements on canvas
        this.elements = new Map();
        this.strokes = [];
        this.images = [];
        this.textBoxes = [];
        this.shapes = [];

        // Current page data
        this.currentPageId = null;

        // Background settings
        this.background = {
            color: '#ffffff',
            template: 'blank',
            paperMode: 'light',
        };

        // Render state
        this.needsRender = true;
        this.isInitialized = false;

        // PERFORMANCE: Cached viewport bounds for culling
        this._cachedVisibleBounds = null;
        this._lastBoundsCalc = 0;

        // PERFORMANCE: Offscreen stroke cache - avoids re-rendering all strokes every frame
        this._strokeCache = null;
        this._strokeCacheCtx = null;
        this._strokeCacheDirty = true;

        // PERFORMANCE: Spatial grid for fast spatial lookups (eraser, hit-testing)
        this._gridCellSize = 200;
        this._spatialGrid = new Map();
        this._strokeById = new Map(); // stroke.id -> stroke reference for O(1) lookup
    }

    /**
     * Initialize canvas manager
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
        this.container = document.getElementById('canvas-container');
        this.wrapper = document.getElementById('canvas-wrapper');
        this.mainCanvas = document.getElementById('main-canvas');
        this.previewCanvas = document.getElementById('preview-canvas');
        this.uiCanvas = document.getElementById('ui-canvas');

        // Set dimensions
        this.width = options.width || 1920;
        this.height = options.height || 1080;

        // Initialize canvas sizes
        this._setupCanvasSizes();

        // Initialize render engine
        RenderEngine.init({
            main: this.mainCanvas,
            preview: this.previewCanvas,
            ui: this.uiCanvas,
        });

        // Set up render callbacks
        RenderEngine.on('redraw', (ctx) => this._render(ctx));
        RenderEngine.on('redrawRegion', (ctx, region) => this._renderRegion(ctx, region));

        // Handle window resize
        window.addEventListener('resize', () => this._handleResize());

        // Subscribe to events
        this._setupEventListeners();

        // Listen for zoom to update resolution
        if (typeof ViewportManager !== 'undefined') {
            ViewportManager.on('zoom', this._onZoom.bind(this));
        }

        this.isInitialized = true;
        this.requestRender();

        this.emit('initialized');
    }

    /**
     * Handle zoom change (debounced)
     */
    _onZoom() {
        if (this._zoomTimer) clearTimeout(this._zoomTimer);
        this._zoomTimer = setTimeout(() => {
            this._setupCanvasSizes();
            this.requestRender();
        }, 100);
    }

    /**
     * Set up canvas sizes for high DPI
     */
    _setupCanvasSizes() {
        this.dpr = window.devicePixelRatio || 1;

        // Get zoom level for crisp rendering
        let zoom = 1;
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            zoom = ViewportManager.state.zoom;
        }

        // PERFORMANCE FIX: Cap the effective DPR to prevent OOM on high zoom
        // Dynamic Resolution Scaling
        let effectiveDpr = this.dpr * zoom;

        // Maximum pixels we want to allocate (e.g., ~50 megapixels)
        // A 4k screen is ~8MP. 50MP gives plenty of headroom for zoom without crashing.
        const MAX_PIXELS = 50 * 1000 * 1000;
        const currentPixels = (this.width * this.height) * (effectiveDpr * effectiveDpr);

        if (currentPixels > MAX_PIXELS) {
            // Scale down DPR to fit within memory budget
            effectiveDpr = Math.sqrt(MAX_PIXELS / (this.width * this.height));
            console.warn(`[Performance] Limiting Canvas DPR to ${effectiveDpr.toFixed(2)} to save memory (Max: ${MAX_PIXELS / 1000000}MP)`);
        }

        // Hard cap DPR to reasonable limit (e.g., 4x is usually indistinguishable from higher)
        effectiveDpr = Math.min(effectiveDpr, 4.0);

        const displayWidth = this.width;
        const displayHeight = this.height;

        // Set canvas display size
        this.wrapper.style.width = `${displayWidth}px`;
        this.wrapper.style.height = `${displayHeight}px`;

        // Set each canvas size
        [this.mainCanvas, this.previewCanvas, this.uiCanvas].forEach(canvas => {
            canvas.width = displayWidth * effectiveDpr;
            canvas.height = displayHeight * effectiveDpr;
            canvas.style.width = `${displayWidth}px`;
            canvas.style.height = `${displayHeight}px`;

            const ctx = canvas.getContext('2d');
            ctx.scale(effectiveDpr, effectiveDpr);
        });

        // PERFORMANCE: Resize/rebuild stroke cache to match canvas dimensions
        this._initStrokeCache(displayWidth, displayHeight, effectiveDpr);
    }

    /**
     * Handle window resize
     */
    _handleResize() {
        // Get container size
        const containerRect = this.container.getBoundingClientRect();

        // Update DPR if changed
        const newDpr = window.devicePixelRatio || 1;
        // Always update if zoom might have changed or dpr changed
        this.dpr = newDpr;
        this._setupCanvasSizes();

        // Update viewport
        if (typeof ViewportManager !== 'undefined') {
             ViewportManager.updateContainerSize(containerRect.width, containerRect.height);
        }

        this.requestRender();
        this.emit('resize', { width: containerRect.width, height: containerRect.height });
    }

    /**
     * Set up event listeners
     */
    _setupEventListeners() {
        // Stroke events from history
        EventBus.on('stroke:add', ({ stroke, pageId }) => {
            if (pageId === this.currentPageId) {
                this.addStroke(stroke, false);
            }
        });

        EventBus.on('stroke:remove', ({ stroke, pageId }) => {
            if (pageId === this.currentPageId) {
                this.removeStroke(stroke.id, false);
            }
        });
    }

    /**
     * Set current page
     * @param {string} pageId - Page ID
     * @param {Object} pageData - Page data
     */
    async setPage(pageId, pageData) {
        this.currentPageId = pageId;

        // Clear current elements
        this.strokes = [];
        this.images = [];
        this.textBoxes = [];
        this.shapes = [];
        this.elements.clear();

        // Load page data
        if (pageData) {
            // Set background
            if (pageData.background) {
                this.setBackground(pageData.background);
            }

            // Load strokes
            if (pageData.strokes) {
                this.strokes = pageData.strokes;
                pageData.strokes.forEach(stroke => {
                    this._cacheStrokeProperties(stroke); // Cache bounds immediately
                    this.elements.set(stroke.id, { type: 'stroke', data: stroke });
                });
            }

            // Load images
            if (pageData.images) {
                this.images = pageData.images;
                pageData.images.forEach(image => {
                    this.elements.set(image.id, { type: 'image', data: image });
                });
            }

            // Load text boxes
            if (pageData.textBoxes) {
                this.textBoxes = pageData.textBoxes;
                pageData.textBoxes.forEach(textBox => {
                    this.elements.set(textBox.id, { type: 'textBox', data: textBox });
                });
            }

            // Load shapes
            if (pageData.shapes) {
                this.shapes = pageData.shapes;
                pageData.shapes.forEach(shape => {
                    this.elements.set(shape.id, { type: 'shape', data: shape });
                });
            }
        }

        // PERFORMANCE: Rebuild spatial grid and stroke cache for the new page
        this._rebuildSpatialGrid();
        this._strokeCacheDirty = true;

        this.requestRender();
        this.emit('pageLoaded', { pageId, pageData });
    }

    /**
     * Set canvas background
     * @param {Object} background - Background settings
     */
    setBackground(background) {
        this.background = { ...this.background, ...background };

        // Update wrapper data attribute for CSS templates
        this.wrapper.dataset.template = this.background.template;
        this.wrapper.dataset.paperMode = this.background.paperMode;

        this.requestRender();
    }

    /**
     * Add a stroke to the canvas
     * @param {Object} stroke - Stroke data
     * @param {boolean} addToHistory - Whether to add to undo history
     */
    addStroke(stroke, addToHistory = true) {
        // Ensure stroke has an ID
        if (!stroke.id) {
            stroke.id = this._generateId();
        }

        // OPTIMIZATION: Cache geometric properties
        this._cacheStrokeProperties(stroke);

        this.strokes.push(stroke);
        this.elements.set(stroke.id, { type: 'stroke', data: stroke });

        // PERFORMANCE: Add to spatial grid and stroke lookup map
        this._strokeById.set(stroke.id, stroke);
        this._addStrokeToGrid(stroke);

        // PERFORMANCE: Incrementally render new stroke to cache (avoids full rebuild)
        this._renderStrokeToCache(stroke);

        // Add to history
        if (addToHistory) {
            HistoryManager.pushStroke(stroke, this.currentPageId);
        }

        // Mark dirty region for main canvas compositing
        const bounds = stroke.bounds || this._getStrokeBounds(stroke);
        RenderEngine.markDirty(bounds);

        this.emit('strokeAdded', stroke);
    }

    /**
     * Remove a stroke from the canvas
     * @param {string} strokeId - Stroke ID
     * @param {boolean} addToHistory - Whether to add to undo history
     */
    removeStroke(strokeId, addToHistory = true) {
        const index = this.strokes.findIndex(s => s.id === strokeId);
        if (index === -1) return;

        const stroke = this.strokes[index];
        this.strokes.splice(index, 1);
        this.elements.delete(strokeId);

        // PERFORMANCE: Remove from spatial grid and invalidate only the affected cache region
        this._strokeById.delete(strokeId);
        this._removeStrokeFromGrid(stroke);
        const bounds = stroke.bounds || this._getStrokeBounds(stroke);
        this._invalidateCacheRegion(bounds);

        if (addToHistory) {
            HistoryManager.pushErase([stroke], this.currentPageId);
        }

        // Mark dirty region
        RenderEngine.markDirty(bounds);

        this.emit('strokeRemoved', stroke);
    }

    /**
     * Add an image to the canvas
     * @param {Object} imageData - Image data
     */
    addImage(imageData) {
        if (!imageData.id) {
            imageData.id = this._generateId();
        }

        this.images.push(imageData);
        this.elements.set(imageData.id, { type: 'image', data: imageData });

        this.requestRender();
        this.emit('imageAdded', imageData);
    }

    /**
     * Add a text box to the canvas
     * @param {Object} textBox - Text box data
     */
    addTextBox(textBox) {
        if (!textBox.id) {
            textBox.id = this._generateId();
        }

        this.textBoxes.push(textBox);
        this.elements.set(textBox.id, { type: 'textBox', data: textBox });

        this.requestRender();
        this.emit('textBoxAdded', textBox);
    }

    /**
     * Add a shape to the canvas
     * @param {Object} shape - Shape data
     */
    addShape(shape) {
        if (!shape.id) {
            shape.id = this._generateId();
        }

        this.shapes.push(shape);
        this.elements.set(shape.id, { type: 'shape', data: shape });

        this.requestRender();
        this.emit('shapeAdded', shape);
    }

    /**
     * Get element at point
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object|null} Element at point or null
     */
    getElementAtPoint(x, y) {
        // Check in reverse order (top to bottom)

        // Check images first (they're usually on top)
        for (let i = this.images.length - 1; i >= 0; i--) {
            const img = this.images[i];
            if (this._pointInRect(x, y, img.x, img.y, img.width, img.height)) {
                return { type: 'image', data: img };
            }
        }

        // Check text boxes
        for (let i = this.textBoxes.length - 1; i >= 0; i--) {
            const textBox = this.textBoxes[i];
            if (this._pointInRect(x, y, textBox.x, textBox.y, textBox.width, textBox.height)) {
                return { type: 'textBox', data: textBox };
            }
        }

        // Check shapes
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            if (this._pointInShape(x, y, shape)) {
                return { type: 'shape', data: shape };
            }
        }

        // Check strokes — PERFORMANCE: Use spatial grid for fast lookup
        const nearbyStrokes = this.getStrokesNearPoint(x, y, 20);
        for (let i = nearbyStrokes.length - 1; i >= 0; i--) {
            const stroke = nearbyStrokes[i];
            if (this._pointOnStroke(x, y, stroke)) {
                return { type: 'stroke', data: stroke };
            }
        }

        return null;
    }

    /**
     * Get elements in rect
     * @param {Object} rect - {x, y, width, height}
     * @returns {Array} Elements in rect
     */
    getElementsInRect(rect) {
        const elements = [];

        for (const stroke of this.strokes) {
            if (this._strokeIntersectsRect(stroke, rect)) {
                elements.push({ type: 'stroke', data: stroke });
            }
        }

        for (const image of this.images) {
            if (this._rectIntersectsRect(
                { x: image.x, y: image.y, width: image.width, height: image.height },
                rect
            )) {
                elements.push({ type: 'image', data: image });
            }
        }

        for (const textBox of this.textBoxes) {
            if (this._rectIntersectsRect(
                { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height },
                rect
            )) {
                elements.push({ type: 'textBox', data: textBox });
            }
        }

        for (const shape of this.shapes) {
            if (this._shapeIntersectsRect(shape, rect)) {
                elements.push({ type: 'shape', data: shape });
            }
        }

        return elements;
    }

    /**
     * Request a render on next frame
     */
    requestRender() {
        this.needsRender = true;
        RenderEngine.requestRedraw();
    }

    /**
     * Render all elements to context
     * PERFORMANCE: Uses offscreen stroke cache — strokes are composited as a single image
     * instead of re-rendering every stroke every frame. O(1) for strokes instead of O(n).
     */
    _render(ctx) {
        // Draw background
        this._renderBackground(ctx);

        // PERFORMANCE: Composite stroke cache instead of rendering each stroke individually
        // This is the #1 optimization — turns O(n_strokes * n_points) per frame into O(1)
        if (this._strokeCache) {
            if (this._strokeCacheDirty) {
                this._rebuildStrokeCache();
            }
            ctx.drawImage(this._strokeCache, 0, 0, this.width, this.height);
        }

        // Calculate visible bounds for non-stroke elements (shapes, images, text)
        let visibleBounds = this._cachedVisibleBounds;
        const now = performance.now();

        if (!visibleBounds || (now - this._lastBoundsCalc) > 16) {
            this._lastBoundsCalc = now;

            if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
                const vp = ViewportManager.state;
                const containerW = ViewportManager.containerWidth || window.innerWidth;
                const containerH = ViewportManager.containerHeight || window.innerHeight;
                const padding = 100;
                const invZoom = 1 / vp.zoom;

                visibleBounds = {
                    x: (-vp.panX - padding) * invZoom,
                    y: (-vp.panY - padding) * invZoom,
                    width: (containerW + padding * 2) * invZoom,
                    height: (containerH + padding * 2) * invZoom
                };
                this._cachedVisibleBounds = visibleBounds;
            } else {
                visibleBounds = null;
            }
        }

        // Shapes (typically few elements, render directly)
        const shapes = this.shapes;
        const shapeCount = shapes.length;
        for (let i = 0; i < shapeCount; i++) {
            const shape = shapes[i];
            if (visibleBounds && !this._shapeIntersectsRect(shape, visibleBounds)) {
                continue;
            }
            this._renderShape(ctx, shape);
        }

        // Images
        const images = this.images;
        const imageCount = images.length;
        for (let i = 0; i < imageCount; i++) {
            const image = images[i];
            if (visibleBounds && !this._rectIntersectsRectFast(
                image.x, image.y, image.width, image.height, visibleBounds)) {
                continue;
            }
            this._renderImage(ctx, image);
        }

        // Text boxes
        const textBoxes = this.textBoxes;
        const textBoxCount = textBoxes.length;
        for (let i = 0; i < textBoxCount; i++) {
            const textBox = textBoxes[i];
            const height = textBox.height || 50;
            if (visibleBounds && !this._rectIntersectsRectFast(
                textBox.x, textBox.y, textBox.width, height, visibleBounds)) {
                continue;
            }
            this._renderTextBox(ctx, textBox);
        }

        this.needsRender = false;
    }

    /**
     * PERFORMANCE: Fast rect intersection check without object creation
     */
    _rectIntersectsRectFast(ax, ay, aw, ah, b) {
        return !(ax + aw < b.x ||
                 b.x + b.width < ax ||
                 ay + ah < b.y ||
                 b.y + b.height < ay);
    }

    /**
     * Render elements in a specific region
     * PERFORMANCE: Uses stroke cache for region redraws. Renders ALL element types correctly.
     */
    _renderRegion(ctx, region) {
        // Composite stroke cache (already has all strokes rendered)
        if (this._strokeCache) {
            if (this._strokeCacheDirty) {
                this._rebuildStrokeCache();
            }
            ctx.drawImage(this._strokeCache, 0, 0, this.width, this.height);
        }

        // Render shapes in region
        for (let i = 0; i < this.shapes.length; i++) {
            const shape = this.shapes[i];
            if (this._shapeIntersectsRect(shape, region)) {
                this._renderShape(ctx, shape);
            }
        }

        // Render images in region
        for (let i = 0; i < this.images.length; i++) {
            const image = this.images[i];
            if (this._rectIntersectsRectFast(image.x, image.y, image.width, image.height, region)) {
                this._renderImage(ctx, image);
            }
        }

        // Render text boxes in region
        for (let i = 0; i < this.textBoxes.length; i++) {
            const textBox = this.textBoxes[i];
            const height = textBox.height || 50;
            if (this._rectIntersectsRectFast(textBox.x, textBox.y, textBox.width, height, region)) {
                this._renderTextBox(ctx, textBox);
            }
        }
    }

    /**
     * Render background
     */
    _renderBackground(ctx) {
        if (this.background.paperMode === 'light') {
            ctx.fillStyle = this.background.color || '#ffffff';
        } else {
            ctx.fillStyle = '#2d2d4a';
        }
        ctx.fillRect(0, 0, this.width, this.height);

        // Template patterns are handled via CSS
    }

    /**
     * Render a shape
     */
    _renderShape(ctx, shape) {
        ctx.save();
        ctx.strokeStyle = shape.color || '#000000';
        ctx.lineWidth = shape.strokeWidth || 2;
        ctx.fillStyle = shape.fill ? shape.color : 'transparent';

        switch (shape.type) {
            case 'rectangle':
                ctx.beginPath();
                ctx.rect(shape.x, shape.y, shape.width, shape.height);
                if (shape.fill) ctx.fill();
                ctx.stroke();
                break;

            case 'circle':
                ctx.beginPath();
                ctx.ellipse(
                    shape.x + shape.width / 2,
                    shape.y + shape.height / 2,
                    shape.width / 2,
                    shape.height / 2,
                    0, 0, Math.PI * 2
                );
                if (shape.fill) ctx.fill();
                ctx.stroke();
                break;

            case 'line':
                ctx.beginPath();
                ctx.moveTo(shape.x1, shape.y1);
                ctx.lineTo(shape.x2, shape.y2);
                ctx.stroke();
                break;

            // More shapes...
        }

        ctx.restore();
    }

    /**
     * Render an image
     */
    _renderImage(ctx, imageData) {
        if (imageData.imageElement) {
            ctx.drawImage(
                imageData.imageElement,
                imageData.x,
                imageData.y,
                imageData.width,
                imageData.height
            );
        }
    }

    /**
     * Render a text box
     */
    _renderTextBox(ctx, textBox) {
        ctx.save();
        ctx.font = `${textBox.fontSize || 16}px ${textBox.fontFamily || 'sans-serif'}`;
        ctx.fillStyle = textBox.color || '#000000';
        ctx.textAlign = textBox.align || 'left';
        ctx.textBaseline = 'top';

        // Word wrap text
        const lines = this._wrapText(ctx, textBox.text, textBox.width);
        let y = textBox.y;

        for (const line of lines) {
            ctx.fillText(line, textBox.x, y);
            y += (textBox.fontSize || 16) * 1.4;
        }

        ctx.restore();
    }

    /**
     * Word wrap text
     */
    _wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    // Utility methods

    /**
     * Cache stroke properties for performance
     */
    _cacheStrokeProperties(stroke) {
        if (!stroke.points || stroke.points.length === 0) {
            stroke.bounds = { x: 0, y: 0, width: 0, height: 0 };
            return;
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let maxPressure = 0;

        // Use a simple loop for speed
        for (let i = 0; i < stroke.points.length; i++) {
            const point = stroke.points[i];
            const size = (stroke.size || 3) * (point.pressure || 1);

            // Update bounds accounting for stroke width
            const halfSize = size / 2;
            if (point.x - halfSize < minX) minX = point.x - halfSize;
            if (point.y - halfSize < minY) minY = point.y - halfSize;
            if (point.x + halfSize > maxX) maxX = point.x + halfSize;
            if (point.y + halfSize > maxY) maxY = point.y + halfSize;
        }

        stroke.bounds = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }

    _generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    _getStrokeBounds(stroke) {
        if (stroke.bounds) {
            return stroke.bounds;
        }

        // Fallback for uncached strokes
        if (!stroke.points || stroke.points.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        // Compute and cache
        this._cacheStrokeProperties(stroke);
        return stroke.bounds;
    }

    _pointInRect(px, py, rx, ry, rw, rh) {
        return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    }

    _pointOnStroke(x, y, stroke, threshold = 5) {
        if (!stroke.points) return false;

        // PERFORMANCE: Fast bounding box rejection first
        if (stroke.bounds) {
            const b = stroke.bounds;
            if (x < b.x - threshold || x > b.x + b.width + threshold ||
                y < b.y - threshold || y > b.y + b.height + threshold) {
                return false;
            }
        }

        // PERFORMANCE: Use squared distance to avoid sqrt
        const points = stroke.points;
        const len = points.length;
        for (let i = 0; i < len; i++) {
            const point = points[i];
            const dx = x - point.x;
            const dy = y - point.y;
            const distSq = dx * dx + dy * dy;
            const size = (stroke.size || 3) * (point.pressure || 1);
            const limit = size + threshold;
            if (distSq <= limit * limit) {
                return true;
            }
        }
        return false;
    }

    _pointInShape(x, y, shape) {
        // Basic bounding box check for now
        const bounds = this._getShapeBounds(shape);
        return this._pointInRect(x, y, bounds.x, bounds.y, bounds.width, bounds.height);
    }

    _getShapeBounds(shape) {
        switch (shape.type) {
            case 'rectangle':
            case 'circle':
                return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
            case 'line':
                return {
                    x: Math.min(shape.x1, shape.x2),
                    y: Math.min(shape.y1, shape.y2),
                    width: Math.abs(shape.x2 - shape.x1),
                    height: Math.abs(shape.y2 - shape.y1),
                };
            default:
                return { x: 0, y: 0, width: 0, height: 0 };
        }
    }

    _strokeIntersectsRect(stroke, rect) {
        const bounds = this._getStrokeBounds(stroke);
        return this._rectIntersectsRect(bounds, rect);
    }

    _shapeIntersectsRect(shape, rect) {
        const bounds = this._getShapeBounds(shape);
        return this._rectIntersectsRect(bounds, rect);
    }

    _rectIntersectsRect(a, b) {
        return !(a.x + a.width < b.x ||
                 b.x + b.width < a.x ||
                 a.y + a.height < b.y ||
                 b.y + b.height < a.y);
    }

    // ===== PERFORMANCE: Stroke Cache Methods =====

    /**
     * Initialize the offscreen stroke cache canvas
     * @param {number} width - Logical width
     * @param {number} height - Logical height
     * @param {number} dpr - Device pixel ratio
     */
    _initStrokeCache(width, height, dpr) {
        if (!this._strokeCache) {
            this._strokeCache = document.createElement('canvas');
        }
        this._strokeCache.width = width * dpr;
        this._strokeCache.height = height * dpr;
        this._strokeCacheCtx = this._strokeCache.getContext('2d', { alpha: true });
        this._strokeCacheCtx.scale(dpr, dpr);
        this._strokeCacheDirty = true;
    }

    /**
     * Rebuild the entire stroke cache from scratch
     * Called when cache is invalidated (page load, resize, complex erase)
     */
    _rebuildStrokeCache() {
        if (!this._strokeCache || !this._strokeCacheCtx) return;

        const ctx = this._strokeCacheCtx;
        // Use save/restore to clear with identity transform, then restore the scale
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this._strokeCache.width, this._strokeCache.height);
        ctx.restore();

        const strokes = this.strokes;
        const len = strokes.length;

        // Render fills first (they go under regular strokes)
        for (let i = 0; i < len; i++) {
            const stroke = strokes[i];
            if (stroke && (stroke.isFill || stroke.type === 'fill')) {
                StrokeRenderer.render(ctx, stroke);
            }
        }
        // Then regular strokes on top
        for (let i = 0; i < len; i++) {
            const stroke = strokes[i];
            if (stroke && !(stroke.isFill || stroke.type === 'fill')) {
                StrokeRenderer.render(ctx, stroke);
            }
        }

        this._strokeCacheDirty = false;
    }

    /**
     * Incrementally render a single new stroke onto the cache
     * O(1) instead of O(n) — only renders the new stroke, not all strokes
     * @param {Object} stroke - The stroke to render
     */
    _renderStrokeToCache(stroke) {
        if (!this._strokeCache || !this._strokeCacheCtx || !stroke) return;

        // Fills need full rebuild since they should appear below existing strokes
        if (stroke.isFill || stroke.type === 'fill') {
            this._strokeCacheDirty = true;
            return;
        }

        // If cache is already dirty, skip (will be rebuilt on next render)
        if (this._strokeCacheDirty) return;

        // Draw just this one stroke onto the cache — instant!
        StrokeRenderer.render(this._strokeCacheCtx, stroke);
    }

    /**
     * Invalidate only the affected region of the stroke cache
     * Used when a stroke is erased — only re-renders overlapping strokes in that area
     * O(k) where k = strokes in the affected area, not O(n) for all strokes
     * @param {Object} bounds - The region to invalidate {x, y, width, height}
     */
    _invalidateCacheRegion(bounds) {
        if (!this._strokeCache || !this._strokeCacheCtx || !bounds) {
            this._strokeCacheDirty = true;
            return;
        }

        const padding = 5;
        const region = {
            x: bounds.x - padding,
            y: bounds.y - padding,
            width: bounds.width + padding * 2,
            height: bounds.height + padding * 2,
        };

        const ctx = this._strokeCacheCtx;

        // Clear only the affected region of the cache
        ctx.save();
        ctx.beginPath();
        ctx.rect(region.x, region.y, region.width, region.height);
        ctx.clip();
        ctx.clearRect(region.x, region.y, region.width, region.height);

        // Re-render only strokes that overlap this region (using spatial grid)
        const affectedIds = this._getStrokeIdsInRect(region);

        if (affectedIds.size > 0) {
            // Maintain correct z-order: iterate strokes array, render only affected ones
            const strokes = this.strokes;
            const len = strokes.length;

            // First pass: fills
            for (let i = 0; i < len; i++) {
                const stroke = strokes[i];
                if (stroke && affectedIds.has(stroke.id) && (stroke.isFill || stroke.type === 'fill')) {
                    StrokeRenderer.render(ctx, stroke);
                }
            }
            // Second pass: regular strokes
            for (let i = 0; i < len; i++) {
                const stroke = strokes[i];
                if (stroke && affectedIds.has(stroke.id) && !(stroke.isFill || stroke.type === 'fill')) {
                    StrokeRenderer.render(ctx, stroke);
                }
            }
        }

        ctx.restore();
    }

    // ===== PERFORMANCE: Spatial Grid Methods =====

    /**
     * Rebuild the spatial grid from all current strokes
     * Called on page load or when grid needs full reconstruction
     */
    _rebuildSpatialGrid() {
        this._spatialGrid.clear();
        this._strokeById.clear();

        const strokes = this.strokes;
        for (let i = 0; i < strokes.length; i++) {
            const stroke = strokes[i];
            if (stroke && stroke.id) {
                this._strokeById.set(stroke.id, stroke);
                this._addStrokeToGrid(stroke);
            }
        }
    }

    /**
     * Add a stroke to the spatial grid
     * @param {Object} stroke - The stroke to add
     */
    _addStrokeToGrid(stroke) {
        const b = stroke.bounds;
        if (!b) return;

        const cs = this._gridCellSize;
        const startCX = Math.floor(b.x / cs);
        const startCY = Math.floor(b.y / cs);
        const endCX = Math.floor((b.x + b.width) / cs);
        const endCY = Math.floor((b.y + b.height) / cs);

        for (let cx = startCX; cx <= endCX; cx++) {
            for (let cy = startCY; cy <= endCY; cy++) {
                const key = `${cx},${cy}`;
                if (!this._spatialGrid.has(key)) {
                    this._spatialGrid.set(key, new Set());
                }
                this._spatialGrid.get(key).add(stroke.id);
            }
        }
    }

    /**
     * Remove a stroke from the spatial grid
     * @param {Object} stroke - The stroke to remove
     */
    _removeStrokeFromGrid(stroke) {
        const b = stroke.bounds;
        if (!b) return;

        const cs = this._gridCellSize;
        const startCX = Math.floor(b.x / cs);
        const startCY = Math.floor(b.y / cs);
        const endCX = Math.floor((b.x + b.width) / cs);
        const endCY = Math.floor((b.y + b.height) / cs);

        for (let cx = startCX; cx <= endCX; cx++) {
            for (let cy = startCY; cy <= endCY; cy++) {
                const key = `${cx},${cy}`;
                const set = this._spatialGrid.get(key);
                if (set) {
                    set.delete(stroke.id);
                    if (set.size === 0) this._spatialGrid.delete(key);
                }
            }
        }
    }

    /**
     * Get stroke IDs that overlap a given rectangle (using spatial grid)
     * @param {Object} rect - {x, y, width, height}
     * @returns {Set} Set of stroke IDs in the region
     */
    _getStrokeIdsInRect(rect) {
        const cs = this._gridCellSize;
        const startCX = Math.floor(rect.x / cs);
        const startCY = Math.floor(rect.y / cs);
        const endCX = Math.floor((rect.x + rect.width) / cs);
        const endCY = Math.floor((rect.y + rect.height) / cs);
        const ids = new Set();

        for (let cx = startCX; cx <= endCX; cx++) {
            for (let cy = startCY; cy <= endCY; cy++) {
                const key = `${cx},${cy}`;
                const set = this._spatialGrid.get(key);
                if (set) {
                    for (const id of set) ids.add(id);
                }
            }
        }
        return ids;
    }

    /**
     * Get actual stroke objects near a point (for eraser and hit-testing)
     * Uses spatial grid for O(1) average lookup instead of O(n) linear scan
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} radius - Search radius
     * @returns {Array} Array of stroke objects near the point
     */
    getStrokesNearPoint(x, y, radius) {
        const cs = this._gridCellSize;
        const startCX = Math.floor((x - radius) / cs);
        const startCY = Math.floor((y - radius) / cs);
        const endCX = Math.floor((x + radius) / cs);
        const endCY = Math.floor((y + radius) / cs);
        const candidateIds = new Set();

        for (let cx = startCX; cx <= endCX; cx++) {
            for (let cy = startCY; cy <= endCY; cy++) {
                const key = `${cx},${cy}`;
                const set = this._spatialGrid.get(key);
                if (set) {
                    for (const id of set) candidateIds.add(id);
                }
            }
        }

        const result = [];
        for (const id of candidateIds) {
            const stroke = this._strokeById.get(id);
            if (stroke) result.push(stroke);
        }
        return result;
    }

    /**
     * Get page data for saving
     */
    getPageData() {
        return {
            id: this.currentPageId,
            strokes: this.strokes,
            images: this.images.map(img => ({ ...img, imageElement: undefined })),
            textBoxes: this.textBoxes,
            shapes: this.shapes,
            background: this.background,
            width: this.width,
            height: this.height,
        };
    }

    /**
     * Clear all elements
     */
    clear() {
        this.strokes = [];
        this.images = [];
        this.textBoxes = [];
        this.shapes = [];
        this.elements.clear();

        // PERFORMANCE: Clear spatial grid and stroke cache
        this._spatialGrid.clear();
        this._strokeById.clear();
        this._strokeCacheDirty = true;

        this.requestRender();
    }

    /**
     * Export canvas as image
     */
    async toImage(format = 'png', quality = 1) {
        return RenderEngine.toBlob(`image/${format}`, quality);
    }
}

// Global canvas manager instance
window.CanvasManager = new CanvasManager();
