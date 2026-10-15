// ============== Gesture Control Module ==============
// HIGH PERFORMANCE webcam hand tracking for zoom and pan
// Uses CSS transforms during gestures for 60fps+ response, redraws only on gesture end

const GestureControl = (function() {
    'use strict';

    // State
    let isEnabled = false;
    let isPreviewVisible = false;
    let camera = null;
    let hands = null;
    let lastFrameTime = 0;

    // DOM Elements
    let videoElement = null;
    let canvasOverlay = null;
    let overlayCtx = null;
    let previewContainer = null;
    let handCursors = [null, null];
    let canvasWrapper = null;

    // Gesture state
    let lastTwoHandDistance = null;
    let lastTwoHandCenter = null;
    let lastSingleHandPos = null;
    let isTwoHandZooming = false;
    let isSingleHandPanning = false;
    let smoothedHands = [null, null];
    let frameCount = 0;

    // CSS Transform state (for instant visual feedback)
    let cssTransformActive = false;
    let gestureStartPanX = 0;
    let gestureStartPanY = 0;
    let gestureStartZoom = 1;
    let gestureDeltaPanX = 0;
    let gestureDeltaPanY = 0;
    let gestureDeltaZoom = 1;
    let gesturePivotX = 0;
    let gesturePivotY = 0;

    // Interpolation for smooth 60fps cursor movement
    let lastHandPositions = [null, null];
    let targetHandPositions = [null, null];
    let interpolationFrame = null;

    // Configuration
    const CONFIG = {
        pinchThreshold: 0.07,
        pinchReleaseThreshold: 0.11,
        zoomSensitivity: 4.0,
        minZoom: 0.1,
        maxZoom: 10,
        smoothingFactor: 0.5,  // Lower = smoother tracking
        cursorInterpolation: 0.3  // Cursor smoothing (separate from tracking)
    };

    // Hand landmarks
    const LANDMARKS = {
        THUMB_TIP: 4,
        INDEX_TIP: 8
    };

    /**
     * Initialize gesture control
     */
    async function init() {
        canvasWrapper = document.getElementById('canvasWrapper');
        createOverlayElements();
        createHandCursors();
        setupKeyboardShortcut();
        startInterpolationLoop();
        console.log('[GestureControl] Initialized with CSS transform acceleration');
    }

    /**
     * Start 60fps interpolation loop for smooth cursor movement
     */
    function startInterpolationLoop() {
        function interpolate() {
            interpolationFrame = requestAnimationFrame(interpolate);

            // Interpolate cursor positions for smooth 60fps movement
            for (let i = 0; i < 2; i++) {
                if (targetHandPositions[i] && handCursors[i]) {
                    if (!lastHandPositions[i]) {
                        lastHandPositions[i] = { ...targetHandPositions[i] };
                    } else {
                        // Smooth interpolation
                        lastHandPositions[i].x += (targetHandPositions[i].x - lastHandPositions[i].x) * CONFIG.cursorInterpolation;
                        lastHandPositions[i].y += (targetHandPositions[i].y - lastHandPositions[i].y) * CONFIG.cursorInterpolation;
                    }

                    handCursors[i].style.left = lastHandPositions[i].x + 'px';
                    handCursors[i].style.top = lastHandPositions[i].y + 'px';
                }
            }
        }
        interpolate();
    }

    /**
     * Create hand cursors
     */
    function createHandCursors() {
        for (let i = 0; i < 2; i++) {
            const cursor = document.createElement('div');
            cursor.id = `gestureHandCursor${i}`;
            cursor.className = 'gesture-hand-cursor';
            cursor.innerHTML = `
                <div class="cursor-ring outer"></div>
                <div class="cursor-ring inner"></div>
                <div class="cursor-center"></div>
            `;
            document.body.appendChild(cursor);
            handCursors[i] = cursor;
        }
    }

    /**
     * Create preview elements
     */
    function createOverlayElements() {
        previewContainer = document.createElement('div');
        previewContainer.id = 'gesturePreviewContainer';
        previewContainer.className = 'gesture-preview-container';
        previewContainer.innerHTML = `
            <div class="gesture-preview-header">
                <span class="gesture-preview-title">🖐️ Gesture Control</span>
                <div class="gesture-preview-status">
                    <span class="gesture-status-dot"></span>
                    <span class="gesture-status-text">Initializing...</span>
                </div>
                <button class="gesture-preview-close" title="Close (Ctrl+Ö)">×</button>
            </div>
            <div class="gesture-preview-content">
                <video id="gestureVideo" playsinline autoplay muted></video>
                <canvas id="gestureOverlay"></canvas>
            </div>
            <div class="gesture-preview-fps">FPS: --</div>
        `;
        document.body.appendChild(previewContainer);

        videoElement = document.getElementById('gestureVideo');
        canvasOverlay = document.getElementById('gestureOverlay');
        overlayCtx = canvasOverlay.getContext('2d');

        previewContainer.querySelector('.gesture-preview-close').addEventListener('click', togglePreview);
        makeDraggable(previewContainer);
    }

    function makeDraggable(element) {
        const header = element.querySelector('.gesture-preview-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('gesture-preview-close')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = element.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            header.setPointerCapture(e.pointerId);
        });

        header.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            element.style.left = (initialX + e.clientX - startX) + 'px';
            element.style.top = (initialY + e.clientY - startY) + 'px';
            element.style.right = 'auto';
        });

        header.addEventListener('pointerup', () => isDragging = false);
    }

    function setupKeyboardShortcut() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && (e.key === 'ö' || e.key === 'Ö' || e.key === ';')) {
                e.preventDefault();
                togglePreview();
            }
        });
    }

    function togglePreview() {
        isPreviewVisible = !isPreviewVisible;
        previewContainer.classList.toggle('visible', isPreviewVisible);
    }

    function updateStatus(state, text) {
        const dot = previewContainer.querySelector('.gesture-status-dot');
        const textEl = previewContainer.querySelector('.gesture-status-text');
        dot.className = 'gesture-status-dot ' + state;
        textEl.textContent = text;
    }

    /**
     * Enable gesture control with HIGH RESOLUTION camera
     */
    async function enable() {
        if (isEnabled) return;

        try {
            if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
                throw new Error('MediaPipe not loaded');
            }

            updateStatus('loading', 'Loading model...');

            if (!hands) {
                hands = new Hands({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                });

                hands.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 1,  // FULL model for accuracy (user wanted high res)
                    minDetectionConfidence: 0.7,
                    minTrackingConfidence: 0.5
                });

                hands.onResults(onHandResults);
            }

            updateStatus('loading', 'Starting camera...');

            // HIGH RESOLUTION for accuracy (user requested)
            canvasOverlay.width = 1280;
            canvasOverlay.height = 720;

            camera = new Camera(videoElement, {
                onFrame: async () => {
                    if (!isEnabled) return;

                    const now = performance.now();
                    if (lastFrameTime) {
                        const fps = Math.round(1000 / (now - lastFrameTime));
                        frameCount++;
                        if (frameCount % 10 === 0) {
                            const fpsEl = previewContainer.querySelector('.gesture-preview-fps');
                            if (fpsEl) fpsEl.textContent = `MediaPipe: ${fps} FPS`;
                        }
                    }
                    lastFrameTime = now;

                    await hands.send({ image: videoElement });
                },
                width: 1280,
                height: 720
            });

            await camera.start();
            isEnabled = true;

            updateStatus('active', 'Tracking hands');

            const btn = document.getElementById('gestureControlBtn');
            if (btn) btn.classList.add('active');

            if (typeof showToast === 'function') {
                showToast('Gesture control enabled 🖐️', 'success');
            }

        } catch (error) {
            console.error('[GestureControl] Failed:', error);
            updateStatus('error', 'Error');
            if (typeof showToast === 'function') {
                showToast('Gesture error: ' + error.message, 'error');
            }
        }
    }

    /**
     * Disable gesture control
     */
    function disable() {
        if (!isEnabled) return;

        isEnabled = false;

        // End any active gesture first
        endCSSTransformGesture();

        if (camera) {
            camera.stop();
            camera = null;
        }

        resetGestureState();
        smoothedHands = [null, null];
        lastHandPositions = [null, null];
        targetHandPositions = [null, null];

        handCursors.forEach(c => c && c.classList.remove('visible', 'pinching'));

        if (overlayCtx) {
            overlayCtx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        }

        updateStatus('inactive', 'Disabled');

        const btn = document.getElementById('gestureControlBtn');
        if (btn) btn.classList.remove('active');

        if (typeof showToast === 'function') {
            showToast('Gesture control disabled', 'info');
        }
    }

    function toggle() {
        if (isEnabled) disable();
        else enable();
        return isEnabled;
    }

    /**
     * Start CSS transform gesture (instant visual feedback)
     */
    function startCSSTransformGesture(pivotX, pivotY) {
        if (cssTransformActive) return;

        cssTransformActive = true;
        gestureStartPanX = window.panX || 0;
        gestureStartPanY = window.panY || 0;
        gestureStartZoom = window.zoom || 1;
        gestureDeltaPanX = 0;
        gestureDeltaPanY = 0;
        gestureDeltaZoom = 1;
        gesturePivotX = pivotX;
        gesturePivotY = pivotY;

        // Enable CSS transitions for smooth transform
        if (canvasWrapper) {
            canvasWrapper.style.willChange = 'transform';
        }
    }

    /**
     * Update CSS transform (called on every MediaPipe frame - INSTANT, no redraw)
     */
    function updateCSSTransform(deltaPanX, deltaPanY, deltaZoom, pivotX, pivotY) {
        if (!cssTransformActive || !canvasWrapper) return;

        gestureDeltaPanX = deltaPanX;
        gestureDeltaPanY = deltaPanY;
        gestureDeltaZoom = deltaZoom;
        gesturePivotX = pivotX;
        gesturePivotY = pivotY;

        // Calculate transform relative to pivot point
        const scale = deltaZoom;
        const translateX = deltaPanX + (1 - scale) * pivotX;
        const translateY = deltaPanY + (1 - scale) * pivotY;

        // Apply CSS transform (GPU accelerated, instant, no redraw)
        canvasWrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        canvasWrapper.style.transformOrigin = `${pivotX}px ${pivotY}px`;

        // Update zoom display in real-time
        const currentZoom = gestureStartZoom * deltaZoom;
        const zoomDisplay = document.getElementById('zoomValue');
        if (zoomDisplay) {
            zoomDisplay.textContent = Math.round(currentZoom * 100) + '%';
        }
    }

    /**
     * End CSS transform gesture - sync to actual canvas state (ONE redraw)
     */
    function endCSSTransformGesture() {
        if (!cssTransformActive) return;

        cssTransformActive = false;

        // Reset CSS transform
        if (canvasWrapper) {
            canvasWrapper.style.transform = 'none';
            canvasWrapper.style.willChange = 'auto';
        }

        // Calculate final state
        const finalZoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom,
            gestureStartZoom * gestureDeltaZoom
        ));
        const finalPanX = gestureStartPanX + gestureDeltaPanX;
        const finalPanY = gestureStartPanY + gestureDeltaPanY;

        // Sync to actual canvas state (triggers ONE redraw)
        if (typeof setZoom === 'function' && typeof setPan === 'function') {
            // Use internal setters to avoid double redraw
            if (typeof window._setZoomInternal === 'function') {
                window._setZoomInternal(finalZoom, gesturePivotX, gesturePivotY);
            } else {
                // Fallback: set zoom without pivot
                window.zoom = finalZoom;
            }

            window.panX = finalPanX;
            window.panY = finalPanY;

            // rAF-throttled to avoid redundant redraws during fast gestures
            if (typeof redrawCanvas === 'function') {
                redrawCanvas();
            }
        }

    }

    function getPinchPoint(landmarks) {
        const thumb = landmarks[LANDMARKS.THUMB_TIP];
        const index = landmarks[LANDMARKS.INDEX_TIP];
        return {
            x: (thumb.x + index.x) / 2,
            y: (thumb.y + index.y) / 2
        };
    }

    function isPinchingHand(landmarks) {
        const thumb = landmarks[LANDMARKS.THUMB_TIP];
        const index = landmarks[LANDMARKS.INDEX_TIP];
        const dx = thumb.x - index.x;
        const dy = thumb.y - index.y;
        const dz = (thumb.z || 0) - (index.z || 0);
        return Math.sqrt(dx*dx + dy*dy + dz*dz) < CONFIG.pinchThreshold;
    }

    /**
     * Process MediaPipe results
     */
    function onHandResults(results) {
        if (!isEnabled) return;

        const width = canvasOverlay.width;
        const height = canvasOverlay.height;
        const numHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

        // Hide cursors
        handCursors.forEach(c => c && c.classList.remove('visible', 'pinching'));

        if (numHands === 0) {
            endGesture();
            smoothedHands = [null, null];
            targetHandPositions = [null, null];

            if (isPreviewVisible && overlayCtx) {
                overlayCtx.clearRect(0, 0, width, height);
                overlayCtx.save();
                overlayCtx.scale(-1, 1);
                overlayCtx.drawImage(results.image, -width, 0, width, height);
                overlayCtx.restore();
            }
            return;
        }

        // Process hands
        const handData = [];
        for (let i = 0; i < numHands && i < 2; i++) {
            const raw = results.multiHandLandmarks[i];

            // Smooth landmarks
            if (!smoothedHands[i]) {
                smoothedHands[i] = JSON.parse(JSON.stringify(raw));
            } else {
                for (let j = 0; j < raw.length; j++) {
                    smoothedHands[i][j].x += (raw[j].x - smoothedHands[i][j].x) * CONFIG.smoothingFactor;
                    smoothedHands[i][j].y += (raw[j].y - smoothedHands[i][j].y) * CONFIG.smoothingFactor;
                    smoothedHands[i][j].z += (raw[j].z - smoothedHands[i][j].z) * CONFIG.smoothingFactor;
                }
            }

            const landmarks = smoothedHands[i];
            const isPinching = isPinchingHand(landmarks);
            const pinchPoint = getPinchPoint(landmarks);

            handData.push({ landmarks, isPinching, pinchPoint });

            // Update cursor target (interpolation loop will smooth it)
            const screenX = (1 - pinchPoint.x) * window.innerWidth;
            const screenY = pinchPoint.y * window.innerHeight;
            targetHandPositions[i] = { x: screenX, y: screenY };

            handCursors[i].classList.add('visible');
            handCursors[i].classList.toggle('pinching', isPinching);

            // Draw preview
            if (isPreviewVisible && overlayCtx) {
                if (i === 0) {
                    overlayCtx.clearRect(0, 0, width, height);
                    overlayCtx.save();
                    overlayCtx.scale(-1, 1);
                    overlayCtx.drawImage(results.image, -width, 0, width, height);
                    overlayCtx.restore();
                }
                drawHandSimple(landmarks, width, height, isPinching, i);
            }
        }

        // Clear unused
        for (let i = numHands; i < 2; i++) {
            smoothedHands[i] = null;
            targetHandPositions[i] = null;
        }

        processGestures(handData);
    }

    function endGesture() {
        if (isTwoHandZooming || isSingleHandPanning) {
            endCSSTransformGesture();
        }
        resetGestureState();
    }

    function resetGestureState() {
        isTwoHandZooming = false;
        isSingleHandPanning = false;
        lastTwoHandDistance = null;
        lastTwoHandCenter = null;
        lastSingleHandPos = null;
    }

    /**
     * Process gestures using CSS transforms for instant feedback
     */
    function processGestures(handData) {
        const pinchingHands = handData.filter(h => h.isPinching);

        if (pinchingHands.length === 2) {
            // TWO HANDS = ZOOM + PAN
            if (isSingleHandPanning) {
                // Transition from pan to zoom
                endCSSTransformGesture();
                isSingleHandPanning = false;
            }

            const p1 = pinchingHands[0].pinchPoint;
            const p2 = pinchingHands[1].pinchPoint;

            const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
            const centerX = (1 - (p1.x + p2.x) / 2) * window.innerWidth;
            const centerY = ((p1.y + p2.y) / 2) * window.innerHeight;

            if (!isTwoHandZooming) {
                isTwoHandZooming = true;
                lastTwoHandDistance = distance;
                lastTwoHandCenter = { x: centerX, y: centerY };
                startCSSTransformGesture(centerX, centerY);
            } else {
                // Calculate deltas since gesture start
                const zoomRatio = distance / lastTwoHandDistance;
                const totalZoomDelta = gestureDeltaZoom * zoomRatio;
                const panDx = centerX - lastTwoHandCenter.x;
                const panDy = centerY - lastTwoHandCenter.y;

                // Clamp zoom
                const newZoom = gestureStartZoom * totalZoomDelta;
                const clampedZoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, newZoom));
                const clampedDelta = clampedZoom / gestureStartZoom;

                // Update CSS transform (instant, GPU)
                updateCSSTransform(
                    gestureDeltaPanX + panDx,
                    gestureDeltaPanY + panDy,
                    clampedDelta,
                    centerX, centerY
                );

                lastTwoHandDistance = distance;
                lastTwoHandCenter = { x: centerX, y: centerY };
            }

        } else if (pinchingHands.length === 1) {
            // ONE HAND = PAN
            if (isTwoHandZooming) {
                endCSSTransformGesture();
                isTwoHandZooming = false;
            }

            const p = pinchingHands[0].pinchPoint;
            const screenX = (1 - p.x) * window.innerWidth;
            const screenY = p.y * window.innerHeight;

            if (!isSingleHandPanning) {
                isSingleHandPanning = true;
                lastSingleHandPos = { x: screenX, y: screenY };
                startCSSTransformGesture(screenX, screenY);
            } else {
                const panDx = screenX - lastSingleHandPos.x;
                const panDy = screenY - lastSingleHandPos.y;

                updateCSSTransform(
                    gestureDeltaPanX + panDx,
                    gestureDeltaPanY + panDy,
                    1, // No zoom for single hand
                    screenX, screenY
                );

                lastSingleHandPos = { x: screenX, y: screenY };
            }

        } else {
            // No pinch
            endGesture();
        }
    }

    /**
     * Simple hand drawing for preview
     */
    function drawHandSimple(landmarks, w, h, pinching, handIdx) {
        const color = pinching ? 'rgba(0,255,100,' : (handIdx === 0 ? 'rgba(124,77,255,' : 'rgba(77,200,255,');
        const thumb = landmarks[LANDMARKS.THUMB_TIP];
        const index = landmarks[LANDMARKS.INDEX_TIP];

        // Line between thumb and index
        overlayCtx.beginPath();
        overlayCtx.moveTo((1 - thumb.x) * w, thumb.y * h);
        overlayCtx.lineTo((1 - index.x) * w, index.y * h);
        overlayCtx.strokeStyle = color + '0.8)';
        overlayCtx.lineWidth = pinching ? 4 : 2;
        overlayCtx.stroke();

        // Pinch center
        const midX = (1 - (thumb.x + index.x) / 2) * w;
        const midY = ((thumb.y + index.y) / 2) * h;
        overlayCtx.beginPath();
        overlayCtx.arc(midX, midY, pinching ? 18 : 12, 0, Math.PI * 2);
        overlayCtx.strokeStyle = color + '0.9)';
        overlayCtx.lineWidth = 3;
        overlayCtx.stroke();

        // Fingertips
        overlayCtx.fillStyle = color + '0.9)';
        overlayCtx.beginPath();
        overlayCtx.arc((1 - thumb.x) * w, thumb.y * h, 8, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.beginPath();
        overlayCtx.arc((1 - index.x) * w, index.y * h, 8, 0, Math.PI * 2);
        overlayCtx.fill();
    }

    function isActive() { return isEnabled; }
    function showPreview() { if (!isPreviewVisible) togglePreview(); }
    function hidePreview() { if (isPreviewVisible) togglePreview(); }

    return {
        init,
        enable,
        disable,
        toggle,
        isActive,
        showPreview,
        hidePreview,
        togglePreview
    };
})();

window.GestureControl = GestureControl;
