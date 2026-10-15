/**
 * HPPenHandler - HP Pen specific button and gesture handling
 * Features:
 * - Eraser button -> Activate eraser tool
 * - Barrel button -> Swap to secondary color
 * - 100% pressure -> Activate lasso selection mode
 */
class HPPenHandler extends EventEmitter {
    constructor() {
        super();

        // Color configuration (primary and secondary like Photoshop)
        this.colors = {
            primary: '#ffffff',    // Current drawing color
            secondary: '#ff4444',  // Secondary color (swapped with barrel button)
        };

        // Button states
        this.buttonState = {
            tip: false,           // Pen touching surface
            barrel: false,        // Side button
            eraser: false,        // Eraser end or button 32
            wasBarrelPressed: false,
            wasEraserPressed: false,
        };

        // Tool state
        this.previousTool = null;
        this.previousColor = null;
        this.isUsingSecondaryColor = false;

        // Pressure selection mode
        this.pressureSelection = {
            enabled: true,
            threshold: 0.98,      // 98%+ pressure activates selection
            isActive: false,
            path: [],
            startPoint: null,
            activationDelay: 150, // ms to hold at max pressure
            pressureStartTime: 0,
        };

        // Configuration
        this.config = {
            eraserButtonEnabled: true,
            barrelButtonEnabled: true,
            pressureSelectionEnabled: true,
            hapticFeedback: false,
        };

        // Bind methods
        this._handlePointerDown = this._handlePointerDown.bind(this);
        this._handlePointerMove = this._handlePointerMove.bind(this);
        this._handlePointerUp = this._handlePointerUp.bind(this);
    }

    /**
     * Initialize HP Pen handling
     */
    init(app) {
        this.app = app;

        // Get colors from toolbar if available
        if (app.toolbar) {
            this.colors.primary = app.toolbar.currentColor || '#ffffff';
        }

        // Load saved secondary color
        const savedSecondary = localStorage.getItem('hp_pen_secondary_color');
        if (savedSecondary) {
            this.colors.secondary = savedSecondary;
        }

        // Hook into pointer handler
        if (app.pointerHandler) {
            app.pointerHandler.on('pointerdown', this._handlePointerDown);
            app.pointerHandler.on('pointermove', this._handlePointerMove);
            app.pointerHandler.on('pointerup', this._handlePointerUp);
        }

        this.emit('initialized');
    }

    /**
     * Handle pointer down
     */
    _handlePointerDown(data) {
        if (data.type !== 'pen') return;

        // Check button states
        const buttons = data.buttons || 0;

        // Eraser button (button 32 or pointerType becomes 'eraser')
        const isEraserButton = (buttons & 32) !== 0 || data.originalEvent?.pointerType === 'eraser';

        // Barrel button (button 2 - right click equivalent)
        const isBarrelButton = (buttons & 2) !== 0;

        // Handle eraser button
        if (isEraserButton && this.config.eraserButtonEnabled) {
            this._activateEraser();
        }

        // Handle barrel button - swap to secondary color
        if (isBarrelButton && this.config.barrelButtonEnabled) {
            this._swapToSecondaryColor();
        }

        // Check for pressure selection activation
        if (this.config.pressureSelectionEnabled && data.pressure >= this.pressureSelection.threshold) {
            this.pressureSelection.pressureStartTime = Date.now();
            this.pressureSelection.startPoint = { x: data.x, y: data.y };
        }

        // Update button state
        this.buttonState.tip = true;
        this.buttonState.barrel = isBarrelButton;
        this.buttonState.eraser = isEraserButton;
    }

    /**
     * Handle pointer move
     */
    _handlePointerMove(data) {
        if (data.current?.type !== 'pen') return;

        const current = data.current;
        const buttons = current.buttons || 0;

        // Check for barrel button press/release during stroke
        const isBarrelButton = (buttons & 2) !== 0;

        if (isBarrelButton && !this.buttonState.wasBarrelPressed && this.config.barrelButtonEnabled) {
            this._swapToSecondaryColor();
            this.buttonState.wasBarrelPressed = true;
        } else if (!isBarrelButton && this.buttonState.wasBarrelPressed) {
            // Barrel released - swap back to primary
            this._swapToPrimaryColor();
            this.buttonState.wasBarrelPressed = false;
        }

        // Check for eraser button press during stroke
        const isEraserButton = (buttons & 32) !== 0;
        if (isEraserButton && !this.buttonState.wasEraserPressed && this.config.eraserButtonEnabled) {
            this._activateEraser();
            this.buttonState.wasEraserPressed = true;
        }

        // Pressure selection mode
        if (this.config.pressureSelectionEnabled) {
            this._handlePressureSelection(current);
        }

        this.buttonState.barrel = isBarrelButton;
        this.buttonState.eraser = isEraserButton;
    }

    /**
     * Handle pointer up
     */
    _handlePointerUp(data) {
        if (data.type !== 'pen') return;

        // Complete pressure selection if active
        if (this.pressureSelection.isActive) {
            this._completePressureSelection();
        }

        // Restore previous tool if was using eraser temporarily
        if (this.buttonState.wasEraserPressed && this.previousTool) {
            this._restorePreviousTool();
        }

        // Restore primary color if was using secondary
        if (this.isUsingSecondaryColor) {
            this._swapToPrimaryColor();
        }

        // Reset button states
        this.buttonState.tip = false;
        this.buttonState.barrel = false;
        this.buttonState.eraser = false;
        this.buttonState.wasBarrelPressed = false;
        this.buttonState.wasEraserPressed = false;

        // Reset pressure selection
        this.pressureSelection.pressureStartTime = 0;
        this.pressureSelection.startPoint = null;
    }

    /**
     * Activate eraser tool
     */
    _activateEraser() {
        if (!this.app) return;

        // Store current tool
        if (this.app.currentTool?.name !== 'eraser') {
            this.previousTool = this.app.currentTool?.name || 'pen';
            this.previousColor = this.colors.primary;
        }

        // Switch to eraser
        this.app.selectTool('eraser');

        this.emit('eraserActivated');
    }

    /**
     * Restore previous tool
     */
    _restorePreviousTool() {
        if (!this.app || !this.previousTool) return;

        this.app.selectTool(this.previousTool);
        this.previousTool = null;

        this.emit('toolRestored');
    }

    /**
     * Swap to secondary color (barrel button)
     */
    _swapToSecondaryColor() {
        if (!this.app || this.isUsingSecondaryColor) return;

        // Store current primary color
        this.colors.primary = this.app.toolbar?.currentColor || this.colors.primary;

        // Apply secondary color
        this.app.stateManager?.set('currentColor', this.colors.secondary);

        if (this.app.currentTool) {
            this.app.currentTool.setOption('color', this.colors.secondary);
        }

        if (this.app.toolbar) {
            this.app.toolbar.setColor(this.colors.secondary);
        }

        this.isUsingSecondaryColor = true;

        this.emit('colorSwapped', {
            from: this.colors.primary,
            to: this.colors.secondary,
            isSecondary: true
        });
    }

    /**
     * Swap back to primary color
     */
    _swapToPrimaryColor() {
        if (!this.app || !this.isUsingSecondaryColor) return;

        // Restore primary color
        this.app.stateManager?.set('currentColor', this.colors.primary);

        if (this.app.currentTool) {
            this.app.currentTool.setOption('color', this.colors.primary);
        }

        if (this.app.toolbar) {
            this.app.toolbar.setColor(this.colors.primary);
        }

        this.isUsingSecondaryColor = false;

        this.emit('colorSwapped', {
            from: this.colors.secondary,
            to: this.colors.primary,
            isSecondary: false
        });
    }

    /**
     * Handle pressure-based selection mode
     */
    _handlePressureSelection(current) {
        const pressure = current.pressure || 0;

        // Check if pressure threshold reached
        if (pressure >= this.pressureSelection.threshold) {
            // Check if held long enough
            if (this.pressureSelection.pressureStartTime > 0) {
                const heldTime = Date.now() - this.pressureSelection.pressureStartTime;

                if (heldTime >= this.pressureSelection.activationDelay && !this.pressureSelection.isActive) {
                    // Activate selection mode
                    this._startPressureSelection(current);
                }
            }

            // If selection mode active, add to path
            if (this.pressureSelection.isActive) {
                this.pressureSelection.path.push({ x: current.x, y: current.y });
                this._drawSelectionPath();
            }
        } else {
            // Pressure dropped below threshold
            if (this.pressureSelection.isActive) {
                // Continue selection even with lower pressure once activated
                this.pressureSelection.path.push({ x: current.x, y: current.y });
                this._drawSelectionPath();
            }
        }
    }

    /**
     * Start pressure selection mode
     */
    _startPressureSelection(point) {
        if (!this.app) return;

        // Store current tool
        this.previousTool = this.app.currentTool?.name || 'pen';

        // Clear any current stroke
        if (this.app.currentTool) {
            this.app.currentTool.cancelStroke?.();
        }

        this.pressureSelection.isActive = true;
        this.pressureSelection.path = [{ x: point.x, y: point.y }];

        // Visual feedback
        this._showSelectionModeIndicator();

        this.emit('pressureSelectionStarted');
    }

    /**
     * Draw selection path
     */
    _drawSelectionPath() {
        if (!window.RenderEngine) return;

        const path = this.pressureSelection.path;
        if (path.length < 2) return;

        RenderEngine.clearUI();
        RenderEngine.drawUI((ctx) => {
            // Draw dashed selection line
            ctx.strokeStyle = '#6c5ce7';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);

            ctx.beginPath();
            ctx.moveTo(path[0].x, path[0].y);

            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i].x, path[i].y);
            }

            // Draw line back to start (closing the lasso)
            if (path.length > 2) {
                ctx.lineTo(path[0].x, path[0].y);
            }

            ctx.stroke();
            ctx.setLineDash([]);

            // Fill with semi-transparent color
            ctx.fillStyle = 'rgba(108, 92, 231, 0.1)';
            ctx.fill();

            // Draw start point indicator
            ctx.fillStyle = '#6c5ce7';
            ctx.beginPath();
            ctx.arc(path[0].x, path[0].y, 6, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /**
     * Complete pressure selection
     */
    _completePressureSelection() {
        if (!this.pressureSelection.isActive) return;

        const path = this.pressureSelection.path;

        if (path.length > 3) {
            // Close the path
            path.push(path[0]);

            // Find elements inside selection
            const selectedElements = this._findElementsInPath(path);

            if (selectedElements.length > 0) {
                // Update app state with selection
                if (this.app?.stateManager) {
                    this.app.stateManager.set('selection', {
                        active: true,
                        elements: selectedElements.map(e => e.id),
                        bounds: this._calculateBounds(selectedElements),
                    });
                }

                // Draw final selection
                this._drawFinalSelection(selectedElements);

                this.emit('pressureSelectionComplete', { elements: selectedElements });
            }
        }

        // Reset state
        this.pressureSelection.isActive = false;
        this.pressureSelection.path = [];

        // Restore previous tool
        if (this.previousTool) {
            setTimeout(() => {
                this.app?.selectTool(this.previousTool);
                this.previousTool = null;
            }, 100);
        }
    }

    /**
     * Find elements inside selection path
     */
    _findElementsInPath(path) {
        if (!window.CanvasManager) return [];

        const elements = [];

        for (const stroke of CanvasManager.strokes) {
            if (this._isStrokeInPath(stroke, path)) {
                elements.push(stroke);
            }
        }

        return elements;
    }

    /**
     * Check if stroke is inside path
     */
    _isStrokeInPath(stroke, path) {
        if (!stroke.points || stroke.points.length === 0) return false;

        let insideCount = 0;
        for (const point of stroke.points) {
            if (this._isPointInPolygon(point.x, point.y, path)) {
                insideCount++;
            }
        }

        // If more than half the points are inside, consider it selected
        return insideCount > stroke.points.length / 2;
    }

    /**
     * Point in polygon test
     */
    _isPointInPolygon(x, y, polygon) {
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    /**
     * Calculate bounding box
     */
    _calculateBounds(elements) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const element of elements) {
            if (element.points) {
                for (const point of element.points) {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                }
            }
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }

    /**
     * Draw final selection with handles
     */
    _drawFinalSelection(elements) {
        const bounds = this._calculateBounds(elements);
        if (!bounds || !window.RenderEngine) return;

        RenderEngine.clearUI();
        RenderEngine.drawUI((ctx) => {
            // Selection rectangle
            ctx.strokeStyle = '#6c5ce7';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(bounds.x - 10, bounds.y - 10, bounds.width + 20, bounds.height + 20);
            ctx.setLineDash([]);

            // Resize handles
            const handleSize = 10;
            const handles = [
                { x: bounds.x - 10, y: bounds.y - 10 },
                { x: bounds.x + bounds.width / 2, y: bounds.y - 10 },
                { x: bounds.x + bounds.width + 10, y: bounds.y - 10 },
                { x: bounds.x - 10, y: bounds.y + bounds.height / 2 },
                { x: bounds.x + bounds.width + 10, y: bounds.y + bounds.height / 2 },
                { x: bounds.x - 10, y: bounds.y + bounds.height + 10 },
                { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 10 },
                { x: bounds.x + bounds.width + 10, y: bounds.y + bounds.height + 10 },
            ];

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#6c5ce7';
            ctx.lineWidth = 2;

            for (const handle of handles) {
                ctx.beginPath();
                ctx.rect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
                ctx.fill();
                ctx.stroke();
            }
        });
    }

    /**
     * Show selection mode visual indicator
     */
    _showSelectionModeIndicator() {
        // Show toast or visual indicator
        if (window.Toast) {
            Toast.info('✂️ Selection Mode', { duration: 1500 });
        }
    }

    /**
     * Set primary color
     */
    setPrimaryColor(color) {
        this.colors.primary = color;
        this.emit('primaryColorChanged', color);
    }

    /**
     * Set secondary color
     */
    setSecondaryColor(color) {
        this.colors.secondary = color;
        localStorage.setItem('hp_pen_secondary_color', color);
        this.emit('secondaryColorChanged', color);
    }

    /**
     * Swap primary and secondary colors (like pressing X in Photoshop)
     */
    swapColors() {
        const temp = this.colors.primary;
        this.colors.primary = this.colors.secondary;
        this.colors.secondary = temp;

        // Update current color
        if (this.app?.stateManager) {
            this.app.stateManager.set('currentColor', this.colors.primary);
        }

        if (this.app?.toolbar) {
            this.app.toolbar.setColor(this.colors.primary);
        }

        this.emit('colorsSwapped', this.colors);
    }

    /**
     * Get current colors
     */
    getColors() {
        return { ...this.colors };
    }

    /**
     * Enable/disable pressure selection
     */
    setPressureSelectionEnabled(enabled) {
        this.config.pressureSelectionEnabled = enabled;
    }

    /**
     * Set pressure threshold for selection
     */
    setPressureThreshold(threshold) {
        this.pressureSelection.threshold = Math.max(0.8, Math.min(1.0, threshold));
    }
}

// Global instance
window.HPPenHandler = new HPPenHandler();
