/**
 * BaseTool - Abstract base class for all drawing tools
 * Provides common functionality for tool implementation
 */
class BaseTool extends EventEmitter {
    constructor(name, options = {}) {
        super();

        this.name = name;
        this.isActive = false;
        this.isDrawing = false;

        // Tool settings
        this.settings = {
            color: options.color || '#ffffff',
            size: options.size || 3,
            opacity: options.opacity || 1,
            pressureEnabled: options.pressureEnabled !== false,
            tiltEnabled: options.tiltEnabled !== false,
            ...options,
        };

        // Current stroke data
        this.currentStroke = null;
        this.points = [];

        // Preview state
        this.previewActive = false;
    }

    /**
     * Activate this tool
     */
    activate() {
        this.isActive = true;
        this.emit('activated', { name: this.name });
        this.onActivate();
    }

    /**
     * Deactivate this tool
     */
    deactivate() {
        this.isActive = false;
        this.cancelStroke();
        this.emit('deactivated', { name: this.name });
        this.onDeactivate();
    }

    /**
     * Called when tool is activated (override in subclass)
     */
    onActivate() {
        // Override in subclass
    }

    /**
     * Called when tool is deactivated (override in subclass)
     */
    onDeactivate() {
        // Override in subclass
    }

    /**
     * Handle pointer down (start of stroke)
     * @param {Object} pointerData - Pointer event data
     */
    onPointerDown(pointerData) {
        if (!this.isActive) return;

        this.isDrawing = true;
        this.points = [];

        // Process pressure/tilt data
        const processed = PenPressure.process(pointerData);

        // Add first point
        const point = this.createPoint(pointerData, processed);
        this.points.push(point);

        // Create stroke object
        this.currentStroke = this.createStroke();
        this.currentStroke.points = [point];

        // Begin preview
        this.previewActive = true;
        this.renderPreview();

        this.emit('strokeStart', { point, stroke: this.currentStroke });
    }

    /**
     * Handle pointer move (during stroke)
     * @param {Object} data - Pointer event data with coalesced points
     */
    onPointerMove(data) {
        if (!this.isActive || !this.isDrawing) return;

        // Process all coalesced points for smooth curves
        const newPoints = [];
        for (const pointerData of data.points) {
            const processed = PenPressure.process(pointerData);
            const point = this.createPoint(pointerData, processed);
            newPoints.push(point);
        }

        // Add points to stroke
        this.points.push(...newPoints);
        this.currentStroke.points.push(...newPoints);

        // Update preview
        this.renderPreview();

        this.emit('strokeUpdate', { points: newPoints, stroke: this.currentStroke });
    }

    /**
     * Handle pointer up (end of stroke)
     * @param {Object} pointerData - Pointer event data
     */
    onPointerUp(pointerData) {
        if (!this.isActive || !this.isDrawing) return;

        // Process final point
        const processed = PenPressure.process(pointerData);
        const point = this.createPoint(pointerData, processed);

        if (point) {
            this.points.push(point);
            this.currentStroke.points.push(point);
        }

        this.isDrawing = false;
        this.previewActive = false;

        // Clear preview
        RenderEngine.clearPreview();

        // Finalize stroke
        let finalStroke = this.finalizeStroke(this.currentStroke);

        // Apply geometry detection if enabled (only for pen/highlighter)
        if (finalStroke && window.GeometryDetector && window.GeometryDetector.isEnabled()) {
            if (this.name === 'pen' || this.name === 'highlighter') {
                finalStroke = window.GeometryDetector.processStroke(finalStroke);
            }
        }

        if (finalStroke && this.isValidStroke(finalStroke)) {
            this.emit('strokeEnd', { stroke: finalStroke });
            this.commitStroke(finalStroke);
        }

        // Reset state
        this.currentStroke = null;
        this.points = [];
        PenPressure.reset();
    }

    /**
     * Handle pointer cancel
     */
    onPointerCancel() {
        this.cancelStroke();
    }

    /**
     * Cancel current stroke
     */
    cancelStroke() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.previewActive = false;
            RenderEngine.clearPreview();
            this.currentStroke = null;
            this.points = [];
            PenPressure.reset();
            this.emit('strokeCancel');
        }
    }

    /**
     * Create a point from pointer data
     * @param {Object} pointerData - Raw pointer data
     * @param {Object} processed - Processed pressure/tilt data
     * @returns {Object} Point object
     */
    createPoint(pointerData, processed) {
        return {
            x: pointerData.x,
            y: pointerData.y,
            pressure: this.settings.pressureEnabled ? processed.pressure : 1,
            tiltX: this.settings.tiltEnabled ? processed.tiltX : 0,
            tiltY: this.settings.tiltEnabled ? processed.tiltY : 0,
            timestamp: pointerData.timestamp,
        };
    }

    /**
     * Create a new stroke object
     * @returns {Object} Stroke object
     */
    createStroke() {
        return {
            id: this.generateId(),
            tool: this.name,
            color: this.settings.color,
            size: this.settings.size,
            opacity: this.settings.opacity,
            points: [],
            timestamp: Date.now(),
        };
    }

    /**
     * Finalize stroke before committing
     * @param {Object} stroke - Stroke to finalize
     * @returns {Object} Finalized stroke
     */
    finalizeStroke(stroke) {
        // Apply smoothing if enabled
        if (this.settings.smoothing) {
            stroke.points = StrokeRenderer.smooth(stroke.points, this.settings.smoothingFactor);
        }

        return stroke;
    }

    /**
     * Check if stroke is valid for committing
     * @param {Object} stroke - Stroke to validate
     * @returns {boolean}
     */
    isValidStroke(stroke) {
        return stroke && stroke.points && stroke.points.length >= 2;
    }

    /**
     * Commit stroke to canvas
     * @param {Object} stroke - Stroke to commit
     */
    commitStroke(stroke) {
        CanvasManager.addStroke(stroke, true);
    }

    /**
     * Render preview of current stroke
     * PERFORMANCE: Uses requestAnimationFrame to batch preview updates
     */
    renderPreview() {
        if (!this.previewActive || !this.currentStroke) return;

        // PERFORMANCE: Batch preview renders with rAF to avoid excessive redraws
        if (!this._previewPending) {
            this._previewPending = true;
            requestAnimationFrame(() => {
                this._previewPending = false;
                if (!this.previewActive || !this.currentStroke) return;

                RenderEngine.clearPreview();
                RenderEngine.drawPreview((ctx) => {
                    this.drawStroke(ctx, this.currentStroke);
                });
            });
        }
    }

    /**
     * Draw a stroke to context (override for custom rendering)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} stroke - Stroke to draw
     */
    drawStroke(ctx, stroke) {
        StrokeRenderer.render(ctx, stroke);
    }

    /**
     * Set tool setting
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     */
    setSetting(key, value) {
        this.settings[key] = value;
        this.emit('settingChanged', { key, value });
    }

    /**
     * Get tool setting
     * @param {string} key - Setting key
     * @returns {any} Setting value
     */
    getSetting(key) {
        return this.settings[key];
    }

    /**
     * Get all settings
     * @returns {Object} All settings
     */
    getSettings() {
        return { ...this.settings };
    }

    /**
     * Update multiple settings
     * @param {Object} settings - Settings to update
     */
    updateSettings(settings) {
        Object.assign(this.settings, settings);
        this.emit('settingsUpdated', this.settings);
    }

    /**
     * Get cursor style for this tool
     * @returns {string} CSS cursor value
     */
    getCursor() {
        return 'crosshair';
    }

    /**
     * Generate unique ID
     * @returns {string}
     */
    generateId() {
        return `${this.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Make available globally
window.BaseTool = BaseTool;
