/**
 * PenTool - Main drawing pen with pressure sensitivity
 * Supports various pen types and customization
 */
class PenTool extends BaseTool {
    constructor(options = {}) {
        super('pen', {
            color: '#ffffff',
            size: 1.5,
            opacity: 1,
            pressureEnabled: true,
            tiltEnabled: true,
            smoothing: true,
            smoothingFactor: 0.3,
            ...options,
        });

        // Pen-specific settings
        this.penType = options.penType || 'ballpoint'; // ballpoint, fountain, brush, marker
        this.minSize = 0.5;
        this.maxSizeMultiplier = 3;

        // PERFORMANCE: Stroke stabilization with circular buffer
        this.stabilization = {
            enabled: true,
            amount: 5, // Number of points to average
            bufferX: new Float32Array(10), // Pre-allocated typed arrays
            bufferY: new Float32Array(10),
            index: 0,
            count: 0,
        };
    }

    /**
     * Handle pointer down
     */
    onPointerDown(pointerData) {
        // PERFORMANCE: Reset circular buffer instead of creating new array
        this.stabilization.index = 0;
        this.stabilization.count = 0;
        super.onPointerDown(pointerData);
    }

    /**
     * Create a point with pen-specific processing
     */
    createPoint(pointerData, processed) {
        let point = super.createPoint(pointerData, processed);

        // Apply stabilization
        if (this.stabilization.enabled) {
            point = this.stabilizePoint(point);
        }

        // Calculate size based on pressure and pen type
        point.size = this.calculatePointSize(processed.pressure);

        return point;
    }

    /**
     * Stabilize point position
     * PERFORMANCE: Uses circular buffer to avoid array shift
     */
    stabilizePoint(point) {
        const stab = this.stabilization;
        const amount = stab.amount;

        // Add to circular buffer
        stab.bufferX[stab.index] = point.x;
        stab.bufferY[stab.index] = point.y;
        stab.index = (stab.index + 1) % amount;
        if (stab.count < amount) stab.count++;

        // Average positions from circular buffer
        let avgX = 0, avgY = 0;
        const count = stab.count;
        for (let i = 0; i < count; i++) {
            avgX += stab.bufferX[i];
            avgY += stab.bufferY[i];
        }

        point.x = avgX / count;
        point.y = avgY / count;

        return point;
    }

    /**
     * Calculate point size based on pressure
     */
    calculatePointSize(pressure) {
        const baseSize = this.settings.size;

        switch (this.penType) {
            case 'ballpoint':
                // Slight pressure variation
                return baseSize * (0.8 + pressure * 0.4);

            case 'fountain':
                // More dramatic pressure variation
                return baseSize * (0.5 + pressure * 1.5);

            case 'brush':
                // Large pressure variation
                return baseSize * (0.3 + pressure * 2.7);

            case 'marker':
                // Consistent size
                return baseSize;

            default:
                return baseSize * pressure;
        }
    }

    /**
     * Create stroke with pen-specific properties
     */
    createStroke() {
        return {
            ...super.createStroke(),
            penType: this.penType,
            minSize: this.minSize,
        };
    }

    /**
     * Called when tool is activated
     */
    onActivate() {
        this.stabilization.buffer = [];
    }

    /**
     * Called when tool is deactivated
     */
    onDeactivate() {
        this.stabilization.buffer = [];
    }

    /**
     * Set pen type
     * @param {string} type - Pen type
     */
    setPenType(type) {
        this.penType = type;
        this.emit('penTypeChanged', type);
    }

    /**
     * Set stabilization amount
     * @param {number} amount - Number of points to average
     */
    setStabilization(amount) {
        this.stabilization.amount = Math.max(1, Math.min(20, amount));
        this.stabilization.buffer = [];
    }

    /**
     * Get cursor style
     */
    getCursor() {
        return 'crosshair';
    }
}


/**
 * HighlighterTool - Semi-transparent highlighting
 */
class HighlighterTool extends BaseTool {
    constructor(options = {}) {
        super('highlighter', {
            color: 'rgba(255, 235, 59, 0.4)',
            size: 20,
            opacity: 0.4,
            pressureEnabled: false, // Consistent width
            tiltEnabled: false,
            smoothing: true,
            smoothingFactor: 0.5,
            ...options,
        });

        // Highlighter colors
        this.presetColors = [
            'rgba(255, 235, 59, 0.4)', // Yellow
            'rgba(76, 175, 80, 0.4)',  // Green
            'rgba(33, 150, 243, 0.4)', // Blue
            'rgba(233, 30, 99, 0.4)',  // Pink
            'rgba(255, 152, 0, 0.4)',  // Orange
            'rgba(156, 39, 176, 0.4)', // Purple
        ];
    }

    /**
     * Create stroke with highlighter blend mode
     */
    createStroke() {
        return {
            ...super.createStroke(),
            blendMode: 'multiply',
            isHighlighter: true,
        };
    }

    /**
     * Draw highlighter stroke
     */
    drawStroke(ctx, stroke) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        StrokeRenderer.render(ctx, stroke);

        ctx.restore();
    }

    /**
     * Set preset color by index
     */
    setPresetColor(index) {
        if (index >= 0 && index < this.presetColors.length) {
            this.settings.color = this.presetColors[index];
            this.emit('colorChanged', this.settings.color);
        }
    }

    getCursor() {
        return 'crosshair';
    }
}


/**
 * EraserTool - Erase strokes or parts of strokes
 */
class EraserTool extends BaseTool {
    constructor(options = {}) {
        super('eraser', {
            size: 20,
            ...options,
        });

        // Eraser modes
        this.mode = options.mode || 'stroke'; // 'stroke' or 'pixel'

        // Erased strokes for undo
        this.erasedStrokes = [];

        // Eraser cursor
        this.cursorCanvas = null;

        // PERFORMANCE: Throttle cursor updates
        this._lastCursorX = 0;
        this._lastCursorY = 0;
        this._cursorThreshold = 2; // Only update if moved more than 2px
    }

    onActivate() {
        this.createCursorCanvas();
    }

    /**
     * Create custom cursor canvas
     */
    createCursorCanvas() {
        this.cursorCanvas = document.createElement('canvas');
        this.cursorCanvas.width = this.settings.size * 2;
        this.cursorCanvas.height = this.settings.size * 2;

        const ctx = this.cursorCanvas.getContext('2d');
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.settings.size, this.settings.size, this.settings.size - 1, 0, Math.PI * 2);
        ctx.stroke();
    }

    /**
     * Handle pointer down - start erasing
     */
    onPointerDown(pointerData) {
        if (!this.isActive) return;

        this.isDrawing = true;
        this.erasedStrokes = [];

        this.eraseAtPoint(pointerData.x, pointerData.y);
        this.drawEraserCursor(pointerData.x, pointerData.y);
    }

    /**
     * Handle pointer move - continue erasing
     */
    onPointerMove(data) {
        if (!this.isActive) return;

        // Draw cursor
        const current = data.current;
        this.drawEraserCursor(current.x, current.y);

        if (!this.isDrawing) return;

        // Erase at all coalesced points
        for (const point of data.points) {
            this.eraseAtPoint(point.x, point.y);
        }
    }

    /**
     * Handle pointer up - finish erasing
     */
    onPointerUp(pointerData) {
        if (!this.isActive || !this.isDrawing) return;

        this.isDrawing = false;

        // Add to history
        if (this.erasedStrokes.length > 0) {
            HistoryManager.pushErase(this.erasedStrokes, CanvasManager.currentPageId);
        }

        this.erasedStrokes = [];
        RenderEngine.clearUI();
    }

    /**
     * Erase at a specific point
     */
    eraseAtPoint(x, y) {
        const eraserRadius = this.settings.size / 2;

        if (this.mode === 'stroke') {
            // Find and remove entire strokes that intersect
            const strokesToRemove = [];

            // PERFORMANCE: Use spatial grid for O(1) lookup instead of scanning all strokes
            const candidates = (CanvasManager.getStrokesNearPoint)
                ? CanvasManager.getStrokesNearPoint(x, y, eraserRadius + 20)
                : CanvasManager.strokes;

            for (const stroke of candidates) {
                if (this.strokeIntersectsCircle(stroke, x, y, eraserRadius)) {
                    strokesToRemove.push(stroke);
                }
            }

            for (const stroke of strokesToRemove) {
                this.erasedStrokes.push(stroke);
                CanvasManager.removeStroke(stroke.id, false);
            }
        } else {
            // Pixel mode - would need to split strokes
            // More complex implementation
        }
    }

    /**
     * Check if stroke intersects with eraser circle
     * PERFORMANCE: Uses squared distance comparison to avoid sqrt, and fast-path bounding box check
     */
    strokeIntersectsCircle(stroke, cx, cy, radius) {
        if (!stroke.points) return false;

        // PERFORMANCE: Fast bounding box check first
        if (stroke.bounds) {
            const b = stroke.bounds;
            const expandedRadius = radius + (stroke.size || 3);
            if (cx + expandedRadius < b.x || cx - expandedRadius > b.x + b.width ||
                cy + expandedRadius < b.y || cy - expandedRadius > b.y + b.height) {
                return false;
            }
        }

        const strokeSize = stroke.size || 3;
        const threshold = radius + strokeSize;
        const thresholdSq = threshold * threshold;

        // PERFORMANCE: Use squared distance to avoid sqrt
        const points = stroke.points;
        const len = points.length;
        for (let i = 0; i < len; i++) {
            const point = points[i];
            const dx = point.x - cx;
            const dy = point.y - cy;
            const distSq = dx * dx + dy * dy;

            if (distSq <= thresholdSq) {
                return true;
            }
        }

        return false;
    }

    /**
     * Draw eraser cursor
     * PERFORMANCE: Throttled to avoid excessive UI canvas redraws
     */
    drawEraserCursor(x, y) {
        // PERFORMANCE: Skip if cursor hasn't moved enough
        const dx = x - this._lastCursorX;
        const dy = y - this._lastCursorY;
        if (dx * dx + dy * dy < this._cursorThreshold * this._cursorThreshold) {
            return;
        }
        this._lastCursorX = x;
        this._lastCursorY = y;

        RenderEngine.clearUI();
        RenderEngine.drawUI((ctx) => {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, this.settings.size / 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        });
    }

    /**
     * Set eraser mode
     */
    setMode(mode) {
        this.mode = mode;
        this.emit('modeChanged', mode);
    }

    getCursor() {
        return 'none';
    }
}


/**
 * LassoTool - Free-form selection tool
 */
class LassoTool extends BaseTool {
    constructor(options = {}) {
        super('lasso', {
            color: '#6c5ce7',
            ...options,
        });

        this.selectionPath = [];
        this.selectedElements = [];
    }

    onPointerDown(pointerData) {
        if (!this.isActive) return;

        this.isDrawing = true;
        this.selectionPath = [{ x: pointerData.x, y: pointerData.y }];
        this.selectedElements = [];
    }

    onPointerMove(data) {
        if (!this.isActive || !this.isDrawing) return;

        const current = data.current;
        this.selectionPath.push({ x: current.x, y: current.y });

        // Draw selection path
        RenderEngine.clearUI();
        RenderEngine.drawUI((ctx) => {
            ctx.strokeStyle = this.settings.color;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(this.selectionPath[0].x, this.selectionPath[0].y);

            for (let i = 1; i < this.selectionPath.length; i++) {
                ctx.lineTo(this.selectionPath[i].x, this.selectionPath[i].y);
            }

            ctx.stroke();
            ctx.setLineDash([]);
        });
    }

    onPointerUp(pointerData) {
        if (!this.isActive || !this.isDrawing) return;

        this.isDrawing = false;

        // Close the path
        if (this.selectionPath.length > 2) {
            this.selectionPath.push(this.selectionPath[0]);
        }

        // Find elements inside lasso
        this.selectedElements = this.findElementsInLasso();

        // Clear lasso path, draw selection
        RenderEngine.clearUI();

        if (this.selectedElements.length > 0) {
            this.drawSelectionBounds();
            this.emit('selection', { elements: this.selectedElements });

            // Update app state
            AppState.set('selection', {
                active: true,
                elements: this.selectedElements.map(e => e.data.id),
                bounds: this.getSelectionBounds(),
            });
        }

        this.selectionPath = [];
    }

    /**
     * Find elements inside the lasso path
     * PERFORMANCE: Pre-calculate polygon bounds for fast rejection
     */
    findElementsInLasso() {
        const elements = [];

        // PERFORMANCE: Calculate lasso bounding box for fast rejection
        const path = this.selectionPath;
        const pathLen = path.length;
        if (pathLen < 3) return elements;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < pathLen; i++) {
            const p = path[i];
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        this._lassoBounds = { minX, minY, maxX, maxY };

        // Check strokes
        const strokes = CanvasManager.strokes;
        const strokeCount = strokes.length;
        for (let i = 0; i < strokeCount; i++) {
            const stroke = strokes[i];
            if (this.isStrokeInLasso(stroke)) {
                elements.push({ type: 'stroke', data: stroke });
            }
        }

        // Check other elements...

        return elements;
    }

    /**
     * Check if stroke is inside lasso
     * PERFORMANCE: Uses fast bounding box rejection and early exit
     */
    isStrokeInLasso(stroke) {
        if (!stroke.points || stroke.points.length === 0) return false;

        // PERFORMANCE: Fast bounding box check
        if (stroke.bounds && this._lassoBounds) {
            const b = stroke.bounds;
            const lb = this._lassoBounds;
            if (b.x + b.width < lb.minX || b.x > lb.maxX ||
                b.y + b.height < lb.minY || b.y > lb.maxY) {
                return false;
            }
        }

        // Check if majority of points are inside
        const points = stroke.points;
        const len = points.length;
        const threshold = len * 0.5;
        let insideCount = 0;

        for (let i = 0; i < len; i++) {
            const point = points[i];
            if (this.isPointInPolygon(point.x, point.y, this.selectionPath)) {
                insideCount++;
                // PERFORMANCE: Early exit if we've already hit majority
                if (insideCount > threshold) return true;
            }
        }

        return insideCount > threshold;
    }

    /**
     * Point in polygon test
     */
    isPointInPolygon(x, y, polygon) {
        let inside = false;

        // PERFORMANCE: Cache length and use indexed loop
        const len = polygon.length;
        for (let i = 0, j = len - 1; i < len; j = i++) {
            const pi = polygon[i];
            const pj = polygon[j];
            const yi = pi.y, yj = pj.y;

            if (((yi > y) !== (yj > y)) &&
                (x < (pj.x - pi.x) * (y - yi) / (yj - yi) + pi.x)) {
                inside = !inside;
            }
        }

        return inside;
    }

    /**
     * Get bounding box of selection
     * PERFORMANCE: Use cached bounds when available
     */
    getSelectionBounds() {
        if (this.selectedElements.length === 0) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const element of this.selectedElements) {
            if (element.type === 'stroke') {
                // PERFORMANCE: Use cached bounds if available
                if (element.data.bounds) {
                    const b = element.data.bounds;
                    if (b.x < minX) minX = b.x;
                    if (b.y < minY) minY = b.y;
                    if (b.x + b.width > maxX) maxX = b.x + b.width;
                    if (b.y + b.height > maxY) maxY = b.y + b.height;
                } else if (element.data.points) {
                    const points = element.data.points;
                    const len = points.length;
                    for (let i = 0; i < len; i++) {
                        const point = points[i];
                        if (point.x < minX) minX = point.x;
                        if (point.y < minY) minY = point.y;
                        if (point.x > maxX) maxX = point.x;
                        if (point.y > maxY) maxY = point.y;
                    }
                }
            }
        }

        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    /**
     * Draw selection bounds
     */
    drawSelectionBounds() {
        const bounds = this.getSelectionBounds();
        if (!bounds) return;

        RenderEngine.drawUI((ctx) => {
            ctx.strokeStyle = this.settings.color;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(bounds.x - 5, bounds.y - 5, bounds.width + 10, bounds.height + 10);
            ctx.setLineDash([]);

            // Draw resize handles
            this.drawResizeHandles(ctx, bounds);
        });
    }

    /**
     * Draw resize handles
     */
    drawResizeHandles(ctx, bounds) {
        const handleSize = 8;
        const handles = [
            { x: bounds.x - 5, y: bounds.y - 5 },
            { x: bounds.x + bounds.width / 2, y: bounds.y - 5 },
            { x: bounds.x + bounds.width + 5, y: bounds.y - 5 },
            { x: bounds.x - 5, y: bounds.y + bounds.height / 2 },
            { x: bounds.x + bounds.width + 5, y: bounds.y + bounds.height / 2 },
            { x: bounds.x - 5, y: bounds.y + bounds.height + 5 },
            { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 5 },
            { x: bounds.x + bounds.width + 5, y: bounds.y + bounds.height + 5 },
        ];

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = this.settings.color;
        ctx.lineWidth = 2;

        for (const handle of handles) {
            ctx.beginPath();
            ctx.rect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
            ctx.fill();
            ctx.stroke();
        }
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedElements = [];
        RenderEngine.clearUI();
        AppState.set('selection', { active: false, elements: [], bounds: null });
        this.emit('selectionCleared');
    }

    getCursor() {
        return 'crosshair';
    }
}


// Make tools available globally
window.PenTool = PenTool;
window.HighlighterTool = HighlighterTool;
window.EraserTool = EraserTool;
window.LassoTool = LassoTool;
