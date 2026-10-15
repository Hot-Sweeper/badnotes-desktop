/**
 * PointerHandler - Unified pointer input handling
 * Handles mouse, touch, and pen/stylus input with full pressure support
 */
class PointerHandler extends EventEmitter {
    constructor() {
        super();

        this.element = null;
        this.isActive = false;

        // Active pointers tracking
        this.activePointers = new Map();
        this.primaryPointer = null;

        // Pointer state
        this.pointerState = {
            isDown: false,
            isPen: false,
            isMouse: false,
            isTouch: false,
            pressure: 0,
            tiltX: 0,
            tiltY: 0,
            twist: 0,
            width: 1,
            height: 1,
        };

        // Palm rejection
        this.palmRejectionEnabled = true;
        this.palmRejectionDelay = 400; // ms — block palm touches for 400ms after pen lifts
        this.recentPenTime = 0;

        // Coalesced events for high refresh rate
        this.useCoalescedEvents = true;

        // PERFORMANCE: Object pool for pointer data to reduce GC pressure
        this._pointerDataPool = [];
        this._poolSize = 32; // Pre-allocate pool
        for (let i = 0; i < this._poolSize; i++) {
            this._pointerDataPool.push(this._createEmptyPointerData());
        }

        // PERFORMANCE: Cached bounding rect (updated on resize)
        this._cachedRect = null;
        this._rectCacheTime = 0;
        this._rectCacheDuration = 100; // ms - update rect cache every 100ms max

        // Bound handlers
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerCancel = this._onPointerCancel.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
    }

    /**
     * PERFORMANCE: Create empty pointer data object for pooling
     */
    _createEmptyPointerData() {
        return {
            id: 0,
            type: '',
            x: 0,
            y: 0,
            clientX: 0,
            clientY: 0,
            pressure: 0,
            tiltX: 0,
            tiltY: 0,
            twist: 0,
            width: 1,
            height: 1,
            isPrimary: false,
            button: 0,
            buttons: 0,
            timestamp: 0,
            originalEvent: null,
        };
    }

    /**
     * PERFORMANCE: Get pooled object or create new one
     */
    _getPooledPointerData() {
        return this._pointerDataPool.pop() || this._createEmptyPointerData();
    }

    /**
     * PERFORMANCE: Return object to pool
     */
    _releasePointerData(data) {
        if (this._pointerDataPool.length < this._poolSize * 2) {
            data.originalEvent = null; // Clear reference to avoid memory leak
            this._pointerDataPool.push(data);
        }
    }

    /**
     * PERFORMANCE: Get cached or fresh bounding rect
     */
    _getElementRect() {
        const now = performance.now();
        if (!this._cachedRect || (now - this._rectCacheTime) > this._rectCacheDuration) {
            this._cachedRect = this.element.getBoundingClientRect();
            this._rectCacheTime = now;
        }
        return this._cachedRect;
    }

    /**
     * Invalidate rect cache (call on resize)
     */
    invalidateRectCache() {
        this._cachedRect = null;
    }

    /**
     * Initialize pointer handling on an element
     * @param {HTMLElement} element - Target element
     */
    init(element) {
        this.element = element;

        // Pointer events
        element.addEventListener('pointerdown', this._onPointerDown);
        element.addEventListener('pointermove', this._onPointerMove);
        element.addEventListener('pointerup', this._onPointerUp);
        element.addEventListener('pointercancel', this._onPointerCancel);
        element.addEventListener('pointerleave', this._onPointerLeave);

        // Prevent context menu on right-click/long-press
        element.addEventListener('contextmenu', this._onContextMenu);

        // Prevent default touch behaviors
        element.style.touchAction = 'none';
        element.style.userSelect = 'none';
        element.style.webkitUserSelect = 'none';

        this.isActive = true;
        this.emit('initialized');
    }

    /**
     * Destroy pointer handling
     */
    destroy() {
        if (!this.element) return;

        this.element.removeEventListener('pointerdown', this._onPointerDown);
        this.element.removeEventListener('pointermove', this._onPointerMove);
        this.element.removeEventListener('pointerup', this._onPointerUp);
        this.element.removeEventListener('pointercancel', this._onPointerCancel);
        this.element.removeEventListener('pointerleave', this._onPointerLeave);
        this.element.removeEventListener('contextmenu', this._onContextMenu);

        this.element = null;
        this.isActive = false;
        this.activePointers.clear();
    }

    /**
     * Handle pointer down
     */
    _onPointerDown(event) {
        // Check for palm rejection BEFORE capturing pointer
        if (this._shouldRejectAsPalm(event)) {
            return;
        }

        // Capture pointer for tracking outside element
        this.element.setPointerCapture(event.pointerId);

        // Track this pointer
        const pointerData = this._extractPointerData(event);
        this.activePointers.set(event.pointerId, pointerData);

        // Set as primary if first pointer or pen
        if (!this.primaryPointer || event.pointerType === 'pen') {
            this.primaryPointer = event.pointerId;
        }

        // Update state
        this.pointerState.isDown = true;
        this.pointerState.isPen = event.pointerType === 'pen';
        this.pointerState.isMouse = event.pointerType === 'mouse';
        this.pointerState.isTouch = event.pointerType === 'touch';

        // Track pen usage for palm rejection
        if (event.pointerType === 'pen') {
            this.recentPenTime = Date.now();
        }

        // Emit event
        this.emit('pointerdown', pointerData);

        // Also emit draw start for primary pointer
        if (event.pointerId === this.primaryPointer) {
            this.emit('drawstart', pointerData);
        }
    }

    /**
     * Handle pointer move
     */
    _onPointerMove(event) {
        // Check for palm rejection
        if (this._shouldRejectAsPalm(event)) {
            return;
        }

        // Use coalesced events for better accuracy at high refresh rates
        let events = [event];
        if (this.useCoalescedEvents && event.getCoalescedEvents) {
            const coalesced = event.getCoalescedEvents();
            if (coalesced.length > 0) {
                events = coalesced;
            }
        }

        // Process all coalesced events
        const points = events.map(e => this._extractPointerData(e));

        // Update active pointer
        const lastPoint = points[points.length - 1];
        this.activePointers.set(event.pointerId, lastPoint);

        // Emit events
        this.emit('pointermove', {
            current: lastPoint,
            points: points,
            coalesced: points.length > 1,
            predicted: this._getPredictedPoints(event)
        });

        // Emit draw event for primary pointer when down
        if (this.pointerState.isDown && event.pointerId === this.primaryPointer) {
            this.emit('draw', {
                current: lastPoint,
                points: points,
                predicted: this._getPredictedPoints(event)
            });
        }
    }

    /**
     * Get predicted points from event
     */
    _getPredictedPoints(event) {
        if (event.getPredictedEvents) {
            const predicted = event.getPredictedEvents();
            if (predicted.length > 0) {
                return predicted.map(e => this._extractPointerData(e));
            }
        }
        return [];
    }

    /**
     * Handle pointer up
     */
    _onPointerUp(event) {
        // Release pointer capture
        try {
            this.element.releasePointerCapture(event.pointerId);
        } catch (e) {
            // Ignore if already released
        }

        const pointerData = this._extractPointerData(event);

        // Remove from active pointers
        this.activePointers.delete(event.pointerId);

        // Emit events
        this.emit('pointerup', pointerData);

        // Emit draw end for primary pointer
        if (event.pointerId === this.primaryPointer) {
            this.emit('drawend', pointerData);
            this.primaryPointer = null;
        }

        // Update state
        if (this.activePointers.size === 0) {
            this.pointerState.isDown = false;
            this.pointerState.isPen = false;
            this.pointerState.isMouse = false;
            this.pointerState.isTouch = false;
        }
    }

    /**
     * Handle pointer cancel
     */
    _onPointerCancel(event) {
        const pointerData = this._extractPointerData(event);

        this.activePointers.delete(event.pointerId);

        this.emit('pointercancel', pointerData);

        if (event.pointerId === this.primaryPointer) {
            this.emit('drawcancel', pointerData);
            this.primaryPointer = null;
        }

        if (this.activePointers.size === 0) {
            this.pointerState.isDown = false;
        }
    }

    /**
     * Handle pointer leave
     */
    _onPointerLeave(event) {
        // Only emit hover leave if not drawing
        if (!this.pointerState.isDown) {
            this.emit('pointerleave', this._extractPointerData(event));
        }
    }

    /**
     * Handle context menu
     */
    _onContextMenu(event) {
        event.preventDefault();

        // Emit right-click event
        this.emit('contextmenu', {
            x: event.clientX,
            y: event.clientY,
        });
    }

    /**
     * Extract pointer data from event
     * PERFORMANCE: Uses object pooling and cached rect
     */
    _extractPointerData(event) {
        // PERFORMANCE: Use cached rect instead of calling getBoundingClientRect every time
        const rect = this._getElementRect();

        // PERFORMANCE: Reuse pooled objects to reduce GC
        const data = this._getPooledPointerData();
        data.id = event.pointerId;
        data.type = event.pointerType;
        data.x = event.clientX - rect.left;
        data.y = event.clientY - rect.top;
        data.clientX = event.clientX;
        data.clientY = event.clientY;
        data.pressure = this._normalizePressure(event);
        data.tiltX = event.tiltX || 0;
        data.tiltY = event.tiltY || 0;
        data.twist = event.twist || 0;
        data.width = event.width || 1;
        data.height = event.height || 1;
        data.isPrimary = event.isPrimary;
        data.button = event.button;
        data.buttons = event.buttons;
        data.timestamp = event.timeStamp || performance.now();
        data.originalEvent = event;
        return data;
    }

    /**
     * Normalize pressure value (0-1) with 4096 levels consideration
     */
    _normalizePressure(event) {
        // Pen pressure
        if (event.pointerType === 'pen') {
            // Event pressure is already 0-1, but we want to ensure full range
            let pressure = event.pressure;

            // Some devices report pressure as 0 when hovering
            if (pressure === 0 && event.buttons > 0) {
                pressure = 0.5; // Default pressure if not reported
            }

            // Apply sensitivity curve (can be adjusted in settings)
            const sensitivity = AppState.get('settings.pressureSensitivity') / 100;
            pressure = this._applySensitivityCurve(pressure, sensitivity);

            return pressure;
        }

        // Mouse always has full pressure when button down
        if (event.pointerType === 'mouse') {
            return event.buttons > 0 ? 1 : 0;
        }

        // Touch uses pressure if available, otherwise use touch size
        if (event.pointerType === 'touch') {
            if (event.pressure > 0) {
                return event.pressure;
            }
            // Estimate pressure from touch size
            const size = Math.max(event.width, event.height);
            return Math.min(1, size / 50);
        }

        return event.pressure || 0.5;
    }

    /**
     * Apply sensitivity curve to pressure
     */
    _applySensitivityCurve(pressure, sensitivity) {
        // 0.5 sensitivity = linear
        // < 0.5 = softer curve (need more pressure)
        // > 0.5 = harder curve (less pressure needed)

        if (sensitivity === 0.5) {
            return pressure;
        }

        // Use power curve
        const power = sensitivity < 0.5
            ? 1 + (0.5 - sensitivity) * 2  // 1-2 for soft
            : 1 - (sensitivity - 0.5) * 0.8; // 0.6-1 for hard

        return Math.pow(pressure, power);
    }

    /**
     * Check if touch should be rejected as palm
     */
    _shouldRejectAsPalm(event) {
        if (!this.palmRejectionEnabled) return false;

        // Only reject touch events
        if (event.pointerType !== 'touch') return false;

        // If pen was used recently, reject touch
        if (Date.now() - this.recentPenTime < this.palmRejectionDelay) {
            return true;
        }

        // If a pen is currently active, reject touch
        for (const [id, pointer] of this.activePointers) {
            if (pointer.type === 'pen') {
                return true;
            }
        }

        // Large touch area likely indicates palm
        if (event.width > 40 || event.height > 40) {
            return true;
        }

        return false;
    }

    /**
     * Get current pointer state
     */
    getState() {
        return { ...this.pointerState };
    }

    /**
     * Get all active pointers
     */
    getActivePointers() {
        return new Map(this.activePointers);
    }

    /**
     * Get primary pointer data
     */
    getPrimaryPointer() {
        if (this.primaryPointer === null) return null;
        return this.activePointers.get(this.primaryPointer);
    }

    /**
     * Set palm rejection enabled
     */
    setPalmRejection(enabled) {
        this.palmRejectionEnabled = enabled;
    }

    /**
     * Check if pointer type is pen
     */
    isPen() {
        return this.pointerState.isPen;
    }

    /**
     * Check if pointer type is touch
     */
    isTouch() {
        return this.pointerState.isTouch;
    }

    /**
     * Check if pointer type is mouse
     */
    isMouse() {
        return this.pointerState.isMouse;
    }
}

// Global pointer handler instance
window.PointerHandler = new PointerHandler();
