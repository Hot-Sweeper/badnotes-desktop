/**
 * GestureRecognizer - Multi-touch gesture recognition
 * Handles pinch-zoom, pan, rotation, and custom gestures
 */
class GestureRecognizer extends EventEmitter {
    constructor() {
        super();

        this.element = null;
        this.isActive = false;

        // Gesture state
        this.gestureState = {
            type: null,
            active: false,
            startTime: 0,
        };

        // Touch tracking
        this.touches = new Map();
        this.initialTouches = new Map();

        // Pinch/Zoom state
        this.pinchState = {
            active: false,
            initialDistance: 0,
            initialScale: 1,
            currentScale: 1,
            centerX: 0,
            centerY: 0,
        };

        // Pan state
        this.panState = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
        };

        // Rotation state
        this.rotationState = {
            active: false,
            initialAngle: 0,
            currentAngle: 0,
        };

        // Tap detection
        this.tapState = {
            count: 0,
            lastTime: 0,
            lastX: 0,
            lastY: 0,
            timeout: null,
        };

        // Thresholds
        this.thresholds = {
            tapMaxDuration: 300,
            tapMaxDistance: 10,
            doubleTapMaxDelay: 300,
            pinchMinDistance: 10,
            panMinDistance: 5,
            rotateMinAngle: 0.1,
        };

        // Bound handlers
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);
        this._onWheel = this._onWheel.bind(this);

        // PERFORMANCE: Cached element rect
        this._cachedRect = null;
        this._rectCacheTime = 0;
    }

    /**
     * PERFORMANCE: Get cached or fresh bounding rect
     */
    _getElementRect() {
        const now = performance.now();
        if (!this._cachedRect || (now - this._rectCacheTime) > 100) {
            this._cachedRect = this.element.getBoundingClientRect();
            this._rectCacheTime = now;
        }
        return this._cachedRect;
    }

    /**
     * Initialize gesture recognition on an element
     * @param {HTMLElement} element - Target element
     */
    init(element) {
        this.element = element;

        // Touch events for multi-touch gestures
        element.addEventListener('touchstart', this._onTouchStart, { passive: false });
        element.addEventListener('touchmove', this._onTouchMove, { passive: false });
        element.addEventListener('touchend', this._onTouchEnd, { passive: false });
        element.addEventListener('touchcancel', this._onTouchEnd, { passive: false });

        // Wheel event for mouse zoom
        element.addEventListener('wheel', this._onWheel, { passive: false });

        this.isActive = true;
        this.emit('initialized');
    }

    /**
     * Destroy gesture recognition
     */
    destroy() {
        if (!this.element) return;

        this.element.removeEventListener('touchstart', this._onTouchStart);
        this.element.removeEventListener('touchmove', this._onTouchMove);
        this.element.removeEventListener('touchend', this._onTouchEnd);
        this.element.removeEventListener('touchcancel', this._onTouchEnd);
        this.element.removeEventListener('wheel', this._onWheel);

        this.element = null;
        this.isActive = false;
        this._cachedRect = null;
    }

    /**
     * Handle touch start
     * PERFORMANCE: Uses cached rect
     */
    _onTouchStart(event) {
        // Palm rejection: block all gestures if pen is active or was recently used
        if (this._isPalmRejected(event.touches)) {
            if (event.cancelable) event.preventDefault();
            return;
        }

        const rect = this._getElementRect();

        // Store all touches
        for (const touch of event.changedTouches) {
            const touchData = {
                id: touch.identifier,
                startX: touch.clientX - rect.left,
                startY: touch.clientY - rect.top,
                currentX: touch.clientX - rect.left,
                currentY: touch.clientY - rect.top,
                startTime: Date.now(),
            };

            this.touches.set(touch.identifier, touchData);
            this.initialTouches.set(touch.identifier, { ...touchData });
        }

        // Detect gesture type based on touch count
        if (this.touches.size === 2) {
            this._initTwoFingerGesture();
            event.preventDefault();
        }
    }

    /**
     * Handle touch move
     * PERFORMANCE: Uses cached rect
     */
    _onTouchMove(event) {
        // Palm rejection: abort gesture if palm detected mid-gesture
        if (this._isPalmRejected(event.touches)) {
            this._endTwoFingerGesture();
            this._endAllGestures();
            this.touches.clear();
            this.initialTouches.clear();
            return;
        }

        const rect = this._getElementRect();

        // Update touch positions
        for (const touch of event.changedTouches) {
            const touchData = this.touches.get(touch.identifier);
            if (touchData) {
                touchData.currentX = touch.clientX - rect.left;
                touchData.currentY = touch.clientY - rect.top;
            }
        }

        // Process gestures
        if (this.touches.size === 2) {
            this._processTwoFingerGesture();
            event.preventDefault();
        } else if (this.touches.size === 1 && this.panState.active) {
            this._processPan();
        }
    }

    /**
     * Handle touch end
     */
    _onTouchEnd(event) {
        // Palm rejection: suppress tap detection if pen was recently active
        const palmRejected = this._isPalmRejected(event.touches);

        const endTime = Date.now();

        for (const touch of event.changedTouches) {
            const touchData = this.touches.get(touch.identifier);

            if (touchData) {
                // Check for tap — but only if NOT palm-rejected
                const duration = endTime - touchData.startTime;
                const distance = this._distance(
                    touchData.startX, touchData.startY,
                    touchData.currentX, touchData.currentY
                );

                if (!palmRejected &&
                    duration < this.thresholds.tapMaxDuration &&
                    distance < this.thresholds.tapMaxDistance) {
                    this._handleTap(touchData);
                }

                this.touches.delete(touch.identifier);
                this.initialTouches.delete(touch.identifier);
            }
        }

        // End gestures if no more touches
        if (this.touches.size < 2) {
            this._endTwoFingerGesture();
        }

        if (this.touches.size === 0) {
            this._endAllGestures();
        }
    }

    /**
     * Handle wheel event (mouse zoom)
     */
    _onWheel(event) {
        event.preventDefault();

        const rect = this.element.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Determine zoom direction
        const delta = event.deltaY > 0 ? -1 : 1;
        const zoomFactor = 1 + (delta * 0.1);

        // Ctrl+wheel = zoom, otherwise scroll/pan
        if (event.ctrlKey || event.metaKey) {
            this.emit('zoom', {
                scale: zoomFactor,
                centerX: x,
                centerY: y,
                source: 'wheel',
            });
        } else {
            // Pan
            this.emit('pan', {
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                source: 'wheel',
            });
        }
    }

    /**
     * Initialize two-finger gesture
     */
    _initTwoFingerGesture() {
        const touchArray = Array.from(this.touches.values());
        const touch1 = touchArray[0];
        const touch2 = touchArray[1];

        // Calculate initial distance and center
        this.pinchState.initialDistance = this._distance(
            touch1.currentX, touch1.currentY,
            touch2.currentX, touch2.currentY
        );

        this.pinchState.centerX = (touch1.currentX + touch2.currentX) / 2;
        this.pinchState.centerY = (touch1.currentY + touch2.currentY) / 2;
        this.pinchState.initialScale = AppState.get('viewport.zoom') || 1;
        this.pinchState.active = true;

        // Calculate initial rotation angle
        this.rotationState.initialAngle = this._angle(
            touch1.currentX, touch1.currentY,
            touch2.currentX, touch2.currentY
        );
        this.rotationState.active = true;

        this.gestureState.type = 'pinch';
        this.gestureState.active = true;
        this.gestureState.startTime = Date.now();

        this.emit('gesturestart', {
            type: 'pinch',
            centerX: this.pinchState.centerX,
            centerY: this.pinchState.centerY,
        });
    }

    /**
     * Process two-finger gesture
     */
    _processTwoFingerGesture() {
        const touchArray = Array.from(this.touches.values());
        const touch1 = touchArray[0];
        const touch2 = touchArray[1];

        // Calculate current distance
        const currentDistance = this._distance(
            touch1.currentX, touch1.currentY,
            touch2.currentX, touch2.currentY
        );

        // Calculate center movement
        const currentCenterX = (touch1.currentX + touch2.currentX) / 2;
        const currentCenterY = (touch1.currentY + touch2.currentY) / 2;

        // Calculate scale
        const scale = currentDistance / this.pinchState.initialDistance;
        this.pinchState.currentScale = this.pinchState.initialScale * scale;

        // Calculate rotation
        const currentAngle = this._angle(
            touch1.currentX, touch1.currentY,
            touch2.currentX, touch2.currentY
        );
        const rotation = currentAngle - this.rotationState.initialAngle;
        this.rotationState.currentAngle = rotation;

        // Calculate pan
        const panX = currentCenterX - this.pinchState.centerX;
        const panY = currentCenterY - this.pinchState.centerY;

        // Emit pinch/zoom event
        if (Math.abs(currentDistance - this.pinchState.initialDistance) > this.thresholds.pinchMinDistance) {
            this.emit('pinch', {
                scale: this.pinchState.currentScale,
                centerX: currentCenterX,
                centerY: currentCenterY,
                deltaScale: scale,
            });
        }

        // Emit rotation event
        if (Math.abs(rotation) > this.thresholds.rotateMinAngle) {
            this.emit('rotate', {
                angle: rotation,
                centerX: currentCenterX,
                centerY: currentCenterY,
            });
        }

        // Emit pan event
        if (Math.abs(panX) > this.thresholds.panMinDistance ||
            Math.abs(panY) > this.thresholds.panMinDistance) {
            this.emit('pan', {
                deltaX: panX,
                deltaY: panY,
                centerX: currentCenterX,
                centerY: currentCenterY,
                source: 'touch',
            });
        }

        // Update center for next frame
        this.pinchState.centerX = currentCenterX;
        this.pinchState.centerY = currentCenterY;
    }

    /**
     * End two-finger gesture
     */
    _endTwoFingerGesture() {
        if (!this.pinchState.active) return;

        this.emit('gestureend', {
            type: 'pinch',
            scale: this.pinchState.currentScale,
            rotation: this.rotationState.currentAngle,
        });

        this.pinchState.active = false;
        this.rotationState.active = false;
        this.gestureState.active = false;
    }

    /**
     * Handle tap
     */
    _handleTap(touchData) {
        const now = Date.now();
        const timeSinceLastTap = now - this.tapState.lastTime;
        const distanceFromLastTap = this._distance(
            touchData.currentX, touchData.currentY,
            this.tapState.lastX, this.tapState.lastY
        );

        // Check for double tap
        if (timeSinceLastTap < this.thresholds.doubleTapMaxDelay &&
            distanceFromLastTap < this.thresholds.tapMaxDistance) {
            this.tapState.count++;

            if (this.tapState.count === 2) {
                // Double tap
                clearTimeout(this.tapState.timeout);
                this.emit('doubletap', {
                    x: touchData.currentX,
                    y: touchData.currentY,
                });
                this.tapState.count = 0;
            }
        } else {
            // Single tap (delayed to wait for potential double tap)
            this.tapState.count = 1;

            clearTimeout(this.tapState.timeout);
            this.tapState.timeout = setTimeout(() => {
                if (this.tapState.count === 1) {
                    this.emit('tap', {
                        x: touchData.currentX,
                        y: touchData.currentY,
                    });
                }
                this.tapState.count = 0;
            }, this.thresholds.doubleTapMaxDelay);
        }

        this.tapState.lastTime = now;
        this.tapState.lastX = touchData.currentX;
        this.tapState.lastY = touchData.currentY;
    }

    /**
     * End all gestures
     */
    _endAllGestures() {
        this.panState.active = false;
        this.gestureState.active = false;
        this.gestureState.type = null;
    }

    /**
     * Process single-finger pan
     */
    _processPan() {
        const touch = Array.from(this.touches.values())[0];
        if (!touch) return;

        const deltaX = touch.currentX - this.panState.currentX;
        const deltaY = touch.currentY - this.panState.currentY;

        this.emit('pan', {
            deltaX,
            deltaY,
            x: touch.currentX,
            y: touch.currentY,
            source: 'touch',
        });

        this.panState.currentX = touch.currentX;
        this.panState.currentY = touch.currentY;
    }

    /**
     * Palm rejection — delegates to global palm rejection from core module
     * Checks if any touch in the list should be blocked (pen active, recent pen, or large contact area)
     * @param {TouchList} touchList
     * @returns {boolean} true if gesture should be BLOCKED
     */
    _isPalmRejected(touchList) {
        const pr = window._badnotesPalmRejection;
        if (!pr) return false;
        return pr.shouldRejectList(touchList);
    }

    /**
     * Calculate distance between two points
     */
    _distance(x1, y1, x2, y2) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    /**
     * Calculate angle between two points
     */
    _angle(x1, y1, x2, y2) {
        return Math.atan2(y2 - y1, x2 - x1);
    }

    /**
     * Check if a gesture is active
     */
    isGestureActive() {
        return this.gestureState.active;
    }

    /**
     * Get current gesture type
     */
    getGestureType() {
        return this.gestureState.type;
    }
}

// Global gesture recognizer instance
window.GestureRecognizer = new GestureRecognizer();
