/**
 * ViewportManager - Handles zoom, pan, and canvas viewport transformations
 * Supports smooth animations and gesture-based navigation
 */
class ViewportManager extends EventEmitter {
    constructor() {
        super();

        // Viewport state
        this.state = {
            zoom: 1,
            panX: 0,
            panY: 0,
            rotation: 0,
        };

        // Limits
        this.limits = {
            minZoom: 0.1,
            maxZoom: 10,
            zoomStep: 0.1,
        };

        // Container dimensions
        this.containerWidth = 0;
        this.containerHeight = 0;

        // Canvas dimensions
        this.canvasWidth = 1920;
        this.canvasHeight = 1080;

        // Animation state
        this.animation = {
            active: false,
            startTime: 0,
            duration: 300,
            startState: null,
            endState: null,
            frameId: null,
        };

        // References
        this.wrapper = null;
        this.container = null;
    }

    /**
     * Initialize viewport manager
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
        this.wrapper = document.getElementById('canvas-wrapper');
        this.container = document.getElementById('canvas-container');

        if (options.canvasWidth) this.canvasWidth = options.canvasWidth;
        if (options.canvasHeight) this.canvasHeight = options.canvasHeight;

        // Get initial container size
        this.updateContainerSize();

        // Set up event listeners
        this._setupEventListeners();

        // Center canvas initially
        this.centerCanvas(false);

        this.emit('initialized');
    }

    /**
     * Set up event listeners
     */
    _setupEventListeners() {
        // Gesture events
        GestureRecognizer.on('pinch', (data) => this._handlePinch(data));
        GestureRecognizer.on('pan', (data) => this._handlePan(data));
        GestureRecognizer.on('zoom', (data) => this._handleZoom(data));
        GestureRecognizer.on('doubletap', (data) => this._handleDoubleTap(data));

        // Keyboard shortcuts
        KeyboardHandler.on('zoomIn', () => this.zoomIn());
        KeyboardHandler.on('zoomOut', () => this.zoomOut());
        KeyboardHandler.on('zoomReset', () => this.resetZoom());
        KeyboardHandler.on('zoomFit', () => this.fitToScreen());
    }

    /**
     * Update container size
     * @param {number} width - Container width
     * @param {number} height - Container height
     */
    updateContainerSize(width, height) {
        if (this.container) {
            const rect = this.container.getBoundingClientRect();
            this.containerWidth = width || rect.width;
            this.containerHeight = height || rect.height;
        }
    }

    /**
     * Apply current viewport transform
     */
    _applyTransform() {
        if (!this.wrapper) return;

        const transform = `
            translate(${this.state.panX}px, ${this.state.panY}px)
            scale(${this.state.zoom})
            rotate(${this.state.rotation}deg)
        `;

        this.wrapper.style.transform = transform;

        // Update state
        AppState.set('viewport', { ...this.state });

        this.emit('transform', this.state);
    }

    /**
     * Zoom in
     * @param {number} amount - Zoom amount (default: step)
     * @param {Object} center - Zoom center point
     */
    zoomIn(amount, center) {
        amount = amount || this.limits.zoomStep;
        this.setZoom(this.state.zoom + amount, center);
    }

    /**
     * Zoom out
     * @param {number} amount - Zoom amount (default: step)
     * @param {Object} center - Zoom center point
     */
    zoomOut(amount, center) {
        amount = amount || this.limits.zoomStep;
        this.setZoom(this.state.zoom - amount, center);
    }

    /**
     * Set zoom level
     * @param {number} zoom - New zoom level
     * @param {Object} center - Zoom center point
     * @param {boolean} animate - Whether to animate
     */
    setZoom(zoom, center, animate = true) {
        const newZoom = Math.max(this.limits.minZoom,
                                 Math.min(this.limits.maxZoom, zoom));

        if (newZoom === this.state.zoom) return;

        // Calculate zoom center
        if (center) {
            // Adjust pan to zoom around center point
            const zoomRatio = newZoom / this.state.zoom;

            this.state.panX = center.x - (center.x - this.state.panX) * zoomRatio;
            this.state.panY = center.y - (center.y - this.state.panY) * zoomRatio;
        }

        this.state.zoom = newZoom;

        if (animate) {
            this._applyTransform();
        } else {
            this._applyTransform();
        }

        // Update zoom display
        this._updateZoomDisplay();

        this.emit('zoom', { zoom: newZoom, center });
    }

    /**
     * Reset zoom to 100%
     * @param {boolean} animate - Whether to animate
     */
    resetZoom(animate = true) {
        if (animate) {
            this._animateTo({ zoom: 1 });
        } else {
            this.state.zoom = 1;
            this._applyTransform();
        }
        this._updateZoomDisplay();
    }

    /**
     * Fit canvas to screen
     * @param {boolean} animate - Whether to animate
     */
    fitToScreen(animate = true) {
        const padding = 40;
        const scaleX = (this.containerWidth - padding * 2) / this.canvasWidth;
        const scaleY = (this.containerHeight - padding * 2) / this.canvasHeight;
        const zoom = Math.min(scaleX, scaleY, 1);

        const targetState = {
            zoom,
            panX: (this.containerWidth - this.canvasWidth * zoom) / 2,
            panY: (this.containerHeight - this.canvasHeight * zoom) / 2,
        };

        if (animate) {
            this._animateTo(targetState);
        } else {
            Object.assign(this.state, targetState);
            this._applyTransform();
        }

        this._updateZoomDisplay();
    }

    /**
     * Center canvas in viewport
     * @param {boolean} animate - Whether to animate
     */
    centerCanvas(animate = true) {
        const targetState = {
            panX: (this.containerWidth - this.canvasWidth * this.state.zoom) / 2,
            panY: (this.containerHeight - this.canvasHeight * this.state.zoom) / 2,
        };

        if (animate) {
            this._animateTo(targetState);
        } else {
            Object.assign(this.state, targetState);
            this._applyTransform();
        }
    }

    /**
     * Pan the canvas
     * @param {number} deltaX - X delta
     * @param {number} deltaY - Y delta
     */
    pan(deltaX, deltaY) {
        this.state.panX += deltaX;
        this.state.panY += deltaY;
        this._applyTransform();

        this.emit('pan', { deltaX, deltaY, panX: this.state.panX, panY: this.state.panY });
    }

    /**
     * Set pan position
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {boolean} animate - Whether to animate
     */
    setPan(x, y, animate = true) {
        if (animate) {
            this._animateTo({ panX: x, panY: y });
        } else {
            this.state.panX = x;
            this.state.panY = y;
            this._applyTransform();
        }
    }

    /**
     * Set rotation
     * @param {number} angle - Rotation angle in degrees
     * @param {boolean} animate - Whether to animate
     */
    setRotation(angle, animate = true) {
        if (animate) {
            this._animateTo({ rotation: angle });
        } else {
            this.state.rotation = angle;
            this._applyTransform();
        }
    }

    /**
     * Animate to a new state
     * @param {Object} targetState - Target state values
     */
    _animateTo(targetState) {
        // Cancel any existing animation
        if (this.animation.frameId) {
            cancelAnimationFrame(this.animation.frameId);
        }

        this.animation.active = true;
        this.animation.startTime = performance.now();
        this.animation.startState = { ...this.state };
        this.animation.endState = { ...this.state, ...targetState };

        const animate = (currentTime) => {
            const elapsed = currentTime - this.animation.startTime;
            const progress = Math.min(1, elapsed / this.animation.duration);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);

            // Interpolate values
            for (const key in this.animation.endState) {
                if (this.animation.startState[key] !== undefined) {
                    this.state[key] = this.animation.startState[key] +
                        (this.animation.endState[key] - this.animation.startState[key]) * eased;
                }
            }

            this._applyTransform();

            if (progress < 1) {
                this.animation.frameId = requestAnimationFrame(animate);
            } else {
                this.animation.active = false;
                this.emit('animationComplete', this.state);
            }
        };

        this.animation.frameId = requestAnimationFrame(animate);
    }

    /**
     * Handle pinch gesture
     */
    _handlePinch(data) {
        this.setZoom(data.scale, { x: data.centerX, y: data.centerY }, false);
    }

    /**
     * Handle pan gesture
     */
    _handlePan(data) {
        this.pan(data.deltaX, data.deltaY);
    }

    /**
     * Handle wheel zoom
     */
    _handleZoom(data) {
        const newZoom = this.state.zoom * data.scale;
        this.setZoom(newZoom, { x: data.centerX, y: data.centerY }, false);
    }

    /**
     * Handle double tap (zoom toggle)
     */
    _handleDoubleTap(data) {
        if (Math.abs(this.state.zoom - 1) < 0.1) {
            // Zoom in to 2x
            this.setZoom(2, { x: data.x, y: data.y });
        } else {
            // Reset to 1x
            this.resetZoom();
        }
    }

    /**
     * Update zoom display in UI
     */
    _updateZoomDisplay() {
        const zoomLevel = document.getElementById('zoom-level');
        if (zoomLevel) {
            zoomLevel.textContent = `${Math.round(this.state.zoom * 100)}%`;
        }
    }

    /**
     * Convert screen coordinates to canvas coordinates
     * @param {number} screenX - Screen X
     * @param {number} screenY - Screen Y
     * @returns {Object} Canvas coordinates
     */
    screenToCanvas(screenX, screenY) {
        const rect = this.wrapper.getBoundingClientRect();

        // Adjust for pan and zoom
        const x = (screenX - rect.left - this.state.panX) / this.state.zoom;
        const y = (screenY - rect.top - this.state.panY) / this.state.zoom;

        return { x, y };
    }

    /**
     * Convert canvas coordinates to screen coordinates
     * @param {number} canvasX - Canvas X
     * @param {number} canvasY - Canvas Y
     * @returns {Object} Screen coordinates
     */
    canvasToScreen(canvasX, canvasY) {
        const rect = this.wrapper.getBoundingClientRect();

        const x = canvasX * this.state.zoom + this.state.panX + rect.left;
        const y = canvasY * this.state.zoom + this.state.panY + rect.top;

        return { x, y };
    }

    /**
     * Get current viewport bounds in canvas coordinates
     * @returns {Object} Bounds {x, y, width, height}
     */
    getVisibleBounds() {
        const topLeft = this.screenToCanvas(0, 0);
        const bottomRight = this.screenToCanvas(this.containerWidth, this.containerHeight);

        return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
        };
    }

    /**
     * Check if a rect is visible in the viewport
     * @param {Object} rect - {x, y, width, height}
     * @returns {boolean}
     */
    isRectVisible(rect) {
        const bounds = this.getVisibleBounds();

        return !(rect.x + rect.width < bounds.x ||
                 rect.x > bounds.x + bounds.width ||
                 rect.y + rect.height < bounds.y ||
                 rect.y > bounds.y + bounds.height);
    }

    /**
     * Scroll to make a rect visible
     * @param {Object} rect - {x, y, width, height}
     * @param {boolean} animate - Whether to animate
     */
    scrollToRect(rect, animate = true) {
        const bounds = this.getVisibleBounds();
        let panX = this.state.panX;
        let panY = this.state.panY;

        // Adjust pan to bring rect into view
        if (rect.x < bounds.x) {
            panX += (bounds.x - rect.x) * this.state.zoom;
        } else if (rect.x + rect.width > bounds.x + bounds.width) {
            panX -= (rect.x + rect.width - bounds.x - bounds.width) * this.state.zoom;
        }

        if (rect.y < bounds.y) {
            panY += (bounds.y - rect.y) * this.state.zoom;
        } else if (rect.y + rect.height > bounds.y + bounds.height) {
            panY -= (rect.y + rect.height - bounds.y - bounds.height) * this.state.zoom;
        }

        this.setPan(panX, panY, animate);
    }

    /**
     * Get current state
     * @returns {Object} State
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Restore state
     * @param {Object} state - State to restore
     * @param {boolean} animate - Whether to animate
     */
    restoreState(state, animate = true) {
        if (animate) {
            this._animateTo(state);
        } else {
            Object.assign(this.state, state);
            this._applyTransform();
        }
        this._updateZoomDisplay();
    }
}

// Global viewport manager instance
window.ViewportManager = new ViewportManager();
