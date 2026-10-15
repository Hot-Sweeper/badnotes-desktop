// ============== Event Listeners ==============

        // OPTIMIZATION: Track intervals for cleanup to prevent memory leaks
        const _intervals = [];
        const _eventCleanup = [];

        // OPTIMIZATION: Helper function to get canvas center - prevents code duplication
        function getCanvasCenter() {
            return {
                x: (-panX + (window.innerWidth / 2) / zoom),
                y: (-panY + (window.innerHeight / 2) / zoom)
            };
        }

        // Helper to create managed interval (auto-tracked for cleanup)
        function createManagedInterval(callback, delay) {
            const id = setInterval(callback, delay);
            _intervals.push(id);
            return id;
        }

        // Cleanup function for page unload
        function cleanupEventListeners() {
            _intervals.forEach(id => clearInterval(id));
            _intervals.length = 0;
            _eventCleanup.forEach(fn => fn());
            _eventCleanup.length = 0;
        }

        function setupEventListeners() {
            setupRecycleBinListeners();
            setupCanvasDropListener();
            setupFloatingToolbar();

            const canvasContainer = document.getElementById('canvasContainer');
            // Disable browser gestures so touch input reaches the notebook reliably.
            canvasContainer.style.touchAction = 'none';

            // Light inertial coast for one-finger canvas panning. Velocity is
            // estimated over a short recent window so a slow release doesn't
            // inherit stale speed from earlier in the drag.
            let panInertiaFrame = 0;
            let panInertiaActive = false;
            let panSamples = [];
            let pinchSamples = [];
            let contactProjection = null;
            let pinchHandoff = null;
            let panFrame = 0;
            let panCameraAnchor = null;
            // Contact follows measured fingers 1:1. A deliberate interpolation
            // buffer made grabbing the page feel like dragging a follower.
            const cameraSampleAt = samples => samples[samples.length - 1] || null;
            const renderPointerPan = (time, flush = false) => {
                panFrame = 0;
                if (!panCameraAnchor || !isPointerPanning || isPinching) return;
                const sample = cameraSampleAt(panSamples);
                if (sample) {
                    const rawX = panCameraAnchor.panX + sample.x - panCameraAnchor.x;
                    const rawY = panCameraAnchor.panY + sample.y - panCameraAnchor.y;
                    contactProjection={rawX,rawY,rawZoom:zoom,worldX:0,worldY:0};
                    const limited=window.ViewLimits?ViewLimits.pan(rawX,rawY,zoom,true):{x:rawX,y:rawY};
                    const nextX=limited.x,nextY=limited.y;
                    if (panX !== nextX || panY !== nextY) {
                        panX = nextX; panY = nextY;
                        _updateGesturePreview(true);
                    }
                }
                // Pointermove schedules the next frame. A stationary contact
                // needs no recurring RAF and follows exactly the same anchor.
            };
            const finishPointerPan = () => {
                if (panFrame) cancelAnimationFrame(panFrame);
                panFrame = 0;
                renderPointerPan(performance.now(), true);
                panCameraAnchor = null;
            };
            const cancelPanInertia = () => {
                if (panInertiaFrame) cancelAnimationFrame(panInertiaFrame);
                panInertiaFrame = 0;
                if (panInertiaActive) {
                    panInertiaActive = false;
                    isPanning = false;
                    isPinching = false;
                    _endGesturePreview(false,false);
                }
            };
            window.cancelCanvasInertia=cancelPanInertia;
            const rememberPanPoint = (x, y, time = performance.now()) => {
                panSamples.push({ x, y, time });
                const cutoff = time - 90;
                while (panSamples.length > 2 && panSamples[0].time < cutoff) panSamples.shift();
            };
            const releaseVelocity = (samples) => {
                if (samples.length < 2) return null;
                const newest = samples[samples.length - 1];
                const age = Math.max(0, performance.now() - newest.time);
                if (age > 90) return null;
                const recent = samples.filter(sample => newest.time - sample.time <= 60);
                if (recent.length < 2 || newest.time - recent[0].time < 8) return null;
                // Fit recent input timestamps, weighting the latest movement.
                // A reversal or a pause must win over the earlier drag direction.
                let weightSum = 0, meanTime = 0, meanX = 0, meanY = 0, meanScale = 0;
                for (const sample of recent) {
                    const weight = Math.exp((sample.time - newest.time) / 20);
                    weightSum += weight;
                    meanTime += weight * sample.time;
                    meanX += weight * sample.x;
                    meanY += weight * sample.y;
                    meanScale += weight * (sample.scale || 0);
                }
                meanTime /= weightSum; meanX /= weightSum; meanY /= weightSum; meanScale /= weightSum;
                let variance = 0, covX = 0, covY = 0, covScale = 0;
                for (const sample of recent) {
                    const weight = Math.exp((sample.time - newest.time) / 20);
                    const dt = sample.time - meanTime;
                    variance += weight * dt * dt;
                    covX += weight * dt * (sample.x - meanX);
                    covY += weight * dt * (sample.y - meanY);
                    covScale += weight * dt * ((sample.scale || 0) - meanScale);
                }
                if (variance < 1) return null;
                // Normal packet delivery/finger-up latency isn't a deliberate
                // stop. Only damp velocity after an actual pause in the input.
                const freshness = Math.exp(-Math.max(0, age - 35) / 30);
                const previous = recent[recent.length - 2];
                const tailTime = newest.time - previous.time;
                const latestDirection = (estimated, delta, minimumDelta) => {
                    if (tailTime >= 8 && Math.abs(delta) > minimumDelta && estimated * delta < 0) {
                        return delta / tailTime;
                    }
                    return estimated;
                };
                return {
                    x: latestDirection(covX / variance, newest.x - previous.x, 0.5) * freshness,
                    y: latestDirection(covY / variance, newest.y - previous.y, 0.5) * freshness,
                    scale: latestDirection(covScale / variance, (newest.scale || 0) - (previous.scale || 0), 0.001) * freshness,
                    pivotX: newest.x,
                    pivotY: newest.y
                };
            };
            // Advance actual velocity under viscous drag plus surface friction.
            // There is no destination or easing curve: distance is produced by
            // the velocity remaining during this frame, ending at zero speed.
            const driftStep = (speed, milliseconds, drag, friction) => {
                if (speed <= 0 || milliseconds <= 0) return { speed, distance: 0 };
                const offset = friction / drag;
                const stopTime = Math.log1p(speed / offset) / drag;
                const elapsed = Math.min(milliseconds, stopTime);
                const decay = Math.exp(-drag * elapsed);
                return {
                    speed: milliseconds >= stopTime ? 0 : Math.max(0, (speed + offset) * decay - offset),
                    distance: Math.max(0, (speed + offset) * -Math.expm1(-drag * elapsed) / drag - offset * elapsed)
                };
            };
            const projectCameraRelease=release=>window.ViewLimits?.projectRelease?.(release,contactProjection)??release;
            const startPanInertia = (release = projectCameraRelease(releaseVelocity(panSamples))) => {
                if (!release) return false;
                // Translation and scale both carry the measured release
                // momentum, even when the fingers were moving and pinching.
                let velocityX = release.x;
                let velocityY = release.y;
                // Time-stretch the original controlled coast: velocity and
                // drag scale together, friction scales quadratically. Travel
                // stays the same while the glide runs slower and lasts longer.
                let zoomVelocity = release.scale * 0.55;
                const speed = Math.hypot(velocityX, velocityY);
                if (speed < 0.04 && Math.abs(zoomVelocity) < 0.00004) return false;
                if (speed < 0.04) {
                    velocityX = 0;
                    velocityY = 0;
                }

                cancelPanInertia();
                panInertiaActive = true;
                isPanning = true;
                isPinching = Math.abs(zoomVelocity) >= 0.00008;
                _beginGesturePreview();
                let previousTime = performance.now();
                const rect = canvas.getBoundingClientRect();
                const pivotX = release.pivotX - rect.left;
                const pivotY = release.pivotY - rect.top;
                window.ViewLimits?.setPivot(pivotX,pivotY);
                const finishAtLimit=()=>{
                    panInertiaFrame=0;panInertiaActive=false;isPanning=false;isPinching=false;
                    _endGesturePreview(false,false);
                    // Units here are px/ms and log-scale/ms; the spring uses
                    // seconds. Never throw away incoming velocity at the edge.
                    ViewLimits.settle({x:velocityX*1000,y:velocityY*1000,scale:zoomVelocity*1000});
                };
                if(window.ViewLimits?.outside()){finishAtLimit();return true;}
                const coast = (time) => {
                    if (!panInertiaActive) return;
                    const elapsed = Math.max(0, time - previousTime);
                    previousTime = Math.max(previousTime, time);
                    const panSpeed = Math.hypot(velocityX, velocityY);
                    const panStep = driftStep(panSpeed, elapsed, 0.0038, 0.00035);
                    const zoomStep = driftStep(Math.abs(zoomVelocity), elapsed, 0.01375, 0.000001815);
                    if (zoomVelocity) {
                        const previousZoom = zoom;
                        _setZoomInternal(zoom * Math.exp(Math.sign(zoomVelocity) * zoomStep.distance),null,null,true);
                        const ratio = zoom / previousZoom;
                        panX = pivotX - (pivotX - panX) * ratio;
                        panY = pivotY - (pivotY - panY) * ratio;
                        zoomVelocity = Math.sign(zoomVelocity) * zoomStep.speed;
                    }
                    if (panSpeed > 0) {
                        panX += velocityX / panSpeed * panStep.distance;
                        panY += velocityY / panSpeed * panStep.distance;
                        velocityX *= panStep.speed / panSpeed;
                        velocityY *= panStep.speed / panSpeed;
                    }
                    const hitLimit=window.ViewLimits?.outside()||false;
                    // This callback is already running on the display frame.
                    // Render here instead of scheduling another frame of delay.
                    _updateGesturePreview(true);
                    if(hitLimit){finishAtLimit();return;}
                    if (panStep.speed === 0 && zoomStep.speed === 0) {
                        panInertiaFrame = 0;
                        panInertiaActive = false;
                        isPanning = false;
                        isPinching = false;
                        _endGesturePreview(false);
                        redrawCanvas();
                        return;
                    }
                    panInertiaFrame = requestAnimationFrame(coast);
                };
                panInertiaFrame = requestAnimationFrame(coast);
                return true;
            };

            // Canvas pointer events (for pen/mouse/touch)
            canvas.addEventListener('pointerdown', (e) => {
                cancelPanInertia();
                panSamples = [];
                pinchSamples = [];
                contactProjection = null;
                pinchHandoff = null;
                if (panFrame) cancelAnimationFrame(panFrame);
                panFrame = 0;
                panCameraAnchor = null;
                // Track pen activity for palm rejection
                if (e.pointerType === 'pen' || e.pointerType === 'eraser') {
                    if (isPenTipContact(e)) markPenActive(e.pointerId);
                }

                // The radial menu's Lasso command arms selection for the next
                // canvas press (it has no live pointer to pass to startLasso).
                if (window.__radialLassoArmed && typeof startLasso === 'function') {
                    window.__radialLassoArmed = false;
                    e.preventDefault();
                    if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                    startLasso(e);
                    return;
                }

                // HP Pen button handling
                if (typeof handleHPPenDown === 'function') {
                    handleHPPenDown(e);
                }
                // Barrel-button presses while hovering may deliver pointerdown,
                // but only tip/eraser contact may begin an ink stroke.
                if ((e.pointerType === 'pen' || e.pointerType === 'eraser') && !isPenTipContact(e)) return;
                if(currentTool==='lasso'&&e.pointerType!=='touch'){
                    if(e.pressure===0&&(e.buttons&1)===0)return;
                    if(e.pointerType==='touch'&&shouldRejectTouch(e))return;
                    e.preventDefault();if(!e.badnotesDirect)canvas.setPointerCapture(e.pointerId);
                    const point=getCanvasPoint(e);
                    if(!handleLassoPointerDown(e,point.x,point.y))startLasso(e);
                    return;
                }

                // Skip drawing when adjusting brush size with pen button
                if ((e.pointerType === 'pen' || e.pointerType === 'eraser') && typeof isHPPenSizeAdjusting === 'function' && isHPPenSizeAdjusting()) {
                    e.preventDefault();
                    if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                    return;
                }

                // Pipette check
                if (isPipetteActive) {
                    pickColorFromCanvas(e.clientX, e.clientY);
                    return;
                }

                // *** HANDWRITTEN TEXT FIELD HANDLING ***
                if (typeof HandwrittenTextField !== 'undefined' &&
                    (typeof HandwrittenTextTool !== 'undefined' && HandwrittenTextTool.isActive())) {
                    const rect = canvas.getBoundingClientRect();
                    const currentZoom = window.zoom || 1;
                    const currentPanX = window.panX || 0;
                    const currentPanY = window.panY || 0;
                    const canvasX = (e.clientX - rect.left - currentPanX) / currentZoom;
                    const canvasY = (e.clientY - rect.top - currentPanY) / currentZoom;

                    const handled = HandwrittenTextField.handlePointerDown(e, canvasX, canvasY, canvas, {
                        allowSelect: true
                    });
                    if (handled) {
                        e.preventDefault();
                        return;
                    }
                }


                // Handwritten text tool check (create NEW text field)
                // Only allow mouse cursor to create new text fields
                if (e.pointerType === 'mouse' &&
                    typeof HandwrittenTextField !== 'undefined' &&
                    typeof HandwrittenTextTool !== 'undefined' &&
                    HandwrittenTextTool.isActive()) {
                    const rect = canvas.getBoundingClientRect();
                    const screenX = e.clientX - rect.left;
                    const screenY = e.clientY - rect.top;
                    if (HandwrittenTextField.handleCanvasClick(screenX, screenY)) {
                        HandwrittenTextTool.deactivate();
                        return;
                    }
                }

                // Simple text tool check (create NEW text field)
                // Only allow mouse cursor to create new text fields
                if (e.pointerType === 'mouse' &&
                    typeof SimpleTextField !== 'undefined' &&
                    typeof SimpleTextTool !== 'undefined' &&
                    SimpleTextTool.isActive()) {
                    const rect = canvas.getBoundingClientRect();
                    const screenX = e.clientX - rect.left;
                    const screenY = e.clientY - rect.top;
                    if (SimpleTextField.handleCanvasClick(screenX, screenY)) {
                        SimpleTextTool.deactivate();
                        return;
                    }
                }

                // Text hit-testing: allow mouse/touch interaction, but never pen.
                const canInteractWithTextFields = e.pointerType === 'mouse' || e.pointerType === 'touch';

                // Handwritten text field selection/interaction (when text interaction is enabled)
                if (canInteractWithTextFields && typeof HandwrittenTextField !== 'undefined') {
                    const rect = canvas.getBoundingClientRect();
                    const currentZoom = window.zoom || 1;
                    const currentPanX = window.panX || 0;
                    const currentPanY = window.panY || 0;
                    const canvasX = (e.clientX - rect.left - currentPanX) / currentZoom;
                    const canvasY = (e.clientY - rect.top - currentPanY) / currentZoom;
                    const handled = HandwrittenTextField.handlePointerDown(e, canvasX, canvasY, canvas, {
                        allowSelect: true
                    });
                    if (handled) {
                        e.preventDefault();
                        return;
                    }
                }

                // Simple text field selection/interaction (when text interaction is enabled)
                if (canInteractWithTextFields && typeof SimpleTextField !== 'undefined') {
                    const rect = canvas.getBoundingClientRect();
                    const currentZoom = window.zoom || 1;
                    const currentPanX = window.panX || 0;
                    const currentPanY = window.panY || 0;
                    const canvasX = (e.clientX - rect.left - currentPanX) / currentZoom;
                    const canvasY = (e.clientY - rect.top - currentPanY) / currentZoom;
                    const handled = SimpleTextField.handlePointerDown(e, canvasX, canvasY, canvas);
                    if (handled) {
                        e.preventDefault();
                        return;
                    }
                }

                // Check for Page Resizing (Hold to Enable)
                // If it returns false, it means either not near edge OR timer started.
                // If timer started, we should probably allow drawing but cancel it if resize starts?
                // Or just block drawing?
                // Let's rely on 'isDrawing' check in resize logic.

                // If checkResizeStart returns FALSE, it implies we are not resizing *yet*.
                // BUT we might have started a timer.
                // We should proceed to drawing logic.
                // If the user HOLDS, the timer will fire `beginResizeDrag`.
                // At that point, `isPageResizing` becomes true.
                // We need `pointermove` to respect that switch.

                checkResizeStart(e);

                if (isPageResizing) return; // If already ready (2nd click)

                // Image manipulation check (for pen/mouse, not touch - touch uses pinch)
                if (e.pointerType === 'pen' || e.pointerType === 'eraser' || e.pointerType === 'mouse') {
                    const rect = canvas.getBoundingClientRect();
                    const canvasX = (e.clientX - rect.left - panX) / zoom;
                    const canvasY = (e.clientY - rect.top - panY) / zoom;

                    // Check for lasso selection interaction first
                    if (typeof handleLassoPointerDown === 'function' && handleLassoPointerDown(e, canvasX, canvasY)) {
                        e.preventDefault();
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                        return; // Selection was clicked
                    }

                    // Check for lasso trigger (full pressure at start)
                    if (typeof shouldStartLasso === 'function' && shouldStartLasso(e)) {
                        e.preventDefault();
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                        startLasso(e);
                        return; // Starting lasso mode
                    }

                    if (typeof handleImagePointerDown === 'function' && handleImagePointerDown(e, canvasX, canvasY)) {
                        e.preventDefault();
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                        return; // Image was clicked, don't draw
                    }
                }

                // 1. Pen or Mouse -> Always Draw (unless in lasso mode or radial menu is open)
                if (e.pointerType === 'pen' || e.pointerType === 'eraser' || e.pointerType === 'mouse') {
                    // Skip drawing if lasso mode is active (barrel button triggers lasso)
                    if (typeof lassoMode !== 'undefined' && lassoMode) {
                        e.preventDefault();
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                        return;
                    }
                    // Skip drawing if radial menu is open
                    if (typeof isRadialMenuOpen === 'function' && isRadialMenuOpen()) {
                        e.preventDefault();
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                        return;
                    }
                    startDrawing(e);
                    return;
                }

                // 2. Touch -> Check palm rejection first, then setting
                if (e.pointerType === 'touch') {
                    // Palm rejection: block touch if pen is active or was recently used
                    if (shouldRejectTouch(e)) {
                        e.preventDefault();
                        return; // Reject this touch - likely palm
                    }

                    const rect = canvas.getBoundingClientRect();
                    const canvasX = (e.clientX - rect.left - panX) / zoom;
                    const canvasY = (e.clientY - rect.top - panY) / zoom;

                    // Check for long-press context menu trigger
                    if (typeof shouldDetectLongPress === 'function' && shouldDetectLongPress(e, canvasX, canvasY)) {
                        startLongPress(e, canvasX, canvasY);
                    }

                    // Check for lasso selection interaction first (for dragging selected strokes)
                    if (typeof handleLassoPointerDown === 'function' && handleLassoPointerDown(e, canvasX, canvasY)) {
                        e.preventDefault();
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                        return; // Selection was clicked
                    }

                    // Check for image interaction first (when finger drawing is off)
                    if (!fingerDrawingEnabled) {
                        if (typeof handleImagePointerDown === 'function' && handleImagePointerDown(e, canvasX, canvasY)) {
                            e.preventDefault();
                            if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                            return; // Image was clicked
                        }
                    }

                    if (fingerDrawingEnabled) {
                        if (!isDrawing) startDrawing(e);
                    } else {
                        isPointerPanning = true;
                        _beginGesturePreview();
                        panningPointerId = e.pointerId;
                        lastPanX = e.clientX;
                        lastPanY = e.clientY;
                        if (e.pointerType === 'touch') rememberPanPoint(e.clientX, e.clientY, e.timeStamp);
                        panCameraAnchor = { x: lastPanX, y: lastPanY, panX, panY };
                        if (!e.badnotesDirect) canvas.setPointerCapture(e.pointerId);
                    }
                }
            });

            canvas.addEventListener('pointermove', (e) => {
                // Track pen activity for palm rejection
                if (e.pointerType === 'pen' || e.pointerType === 'eraser') {
                    if (isPenTipContact(e)) {
                        markPenActive(e.pointerId);
                    } else {
                        markPenInactive(false, e.pointerId);
                        // Recover when the driver delivers hover instead of
                        // the expected pen-up. Never append that hover to ink.
                        if (isDrawing && drawingPointerId === e.pointerId) stopDrawing();
                        resumeNavigationTouches(e);
                    }
                }

                // HP Pen button handling
                if (typeof handleHPPenMove === 'function') {
                    handleHPPenMove(e);
                }

                // Skip drawing updates when adjusting brush size with pen button
                if ((e.pointerType === 'pen' || e.pointerType === 'eraser') && typeof isHPPenSizeAdjusting === 'function' && isHPPenSizeAdjusting()) {
                    e.preventDefault();
                    return;
                }

                // An active drawing pointer has already been classified as
                // ink on pointer-down. Route its move immediately instead of
                // running unrelated text/image/lasso hover hit-tests first;
                // that work delayed the next visible ink frame on dense pages.
                if (isDrawing && e.pointerId === drawingPointerId) {
                    if (handleResizeMove(e)) {
                        isDrawing = false;
                        drawingPointerId = null;
                        smoothPointInitialized = false;
                        currentStroke = null;
                        clearActiveCanvas();
                        redrawCanvas();
                        return;
                    }
                    if (typeof checkResizeMovement === 'function') checkResizeMovement(e);
                    draw(e);
                    return;
                }

                // *** TEXT FIELD RESIZE/DRAG HANDLING ***
                if (typeof HandwrittenTextField !== 'undefined' &&
                    (HandwrittenTextField.isResizing || HandwrittenTextField.isDragging)) {
                    HandwrittenTextField.handlePointerMove(e);
                    e.preventDefault();
                    return;
                }
                if (typeof SimpleTextField !== 'undefined' &&
                    (SimpleTextField.isResizing || SimpleTextField.isDragging)) {
                    SimpleTextField.handlePointerMove(e);
                    e.preventDefault();
                    return;
                }

                // Skip drawing if pressure selection is active
                if (typeof pressureSelection !== 'undefined' && pressureSelection.isActive) {
                    return;
                }

                // Lasso mode - continue drawing lasso path
                if (typeof lassoMode !== 'undefined' && lassoMode) {
                    if(e.pointerId!==lassoSelection.pointerId)return;
                    continueLasso(e);
                    return;
                }

                // Lasso selection manipulation check
                if (typeof handleLassoPointerMove === 'function') {
                    const rect = canvas.getBoundingClientRect();
                    const canvasX = (e.clientX - rect.left - panX) / zoom;
                    const canvasY = (e.clientY - rect.top - panY) / zoom;
                    if (handleLassoPointerMove(e, canvasX, canvasY)) {
                        return; // Selection is being manipulated
                    }
                }

                // Cancel long-press on movement
                if (typeof checkLongPressMove === 'function') {
                    checkLongPressMove(e);
                }

                // Image manipulation check
                if (typeof handleImagePointerMove === 'function') {
                    const rect = canvas.getBoundingClientRect();
                    const canvasX = (e.clientX - rect.left - panX) / zoom;
                    const canvasY = (e.clientY - rect.top - panY) / zoom;

                    // Update image hover state (for lock icons)
                    if (typeof updateImageHoverState === 'function' && !isDrawing && !isPinching) {
                        updateImageHoverState(canvasX, canvasY);
                    }

                    if (handleImagePointerMove(e, canvasX, canvasY)) {
                        return; // Image is being manipulated
                    }
                }

                if (handleResizeMove(e)) {
                     // We are resizing! Check if we have accidental ink.
                     if (isDrawing) {
                         // ABORT DRAWING (Do not save)
                         isDrawing = false;
                         drawingPointerId = null;
                         smoothPointInitialized = false;
                         currentStroke = null;

                         // Clear Any Cursor/Temp Ink
                         if (typeof activeCtx !== 'undefined') {
                             activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
                         }

                         // Since handleResizeMove already called redrawCanvas(),
                         // we might need to call it again to ensure clean state?
                         // handleResizeMove calls redraw at the END.
                         // But handleResizeMove logic computes layout based on resize.
                         // redrawCanvas clears screen.
                         // If we are drawing, activeCtx might have ink.
                         // redrawCanvas clears activeCtx at start.
                         // So handleResizeMove's redrawCanvas should have cleared it.
                         // BUT `isDrawing` was true, so maybe something else redrew it?
                         // Explicitly clearing here is safer.
                         redrawCanvas();
                     }
                     return;
                }

                // Check if we should cancel resize trigger due to movement
                if (typeof checkResizeMovement === 'function') {
                    checkResizeMovement(e);
                }

                updateResizeCursor(e);

                if (isDrawing && e.pointerId === drawingPointerId) {
                    draw(e);
                } else if (isPointerPanning && e.pointerId === panningPointerId) {
                    // Skip if pinching (2-finger gesture handles pan)
                    if (isPinching) return;
                    if (pinchHandoff) {
                        const liftMovement = Math.hypot(e.clientX - pinchHandoff.x, e.clientY - pinchHandoff.y);
                        const afterLift = performance.now() - pinchHandoff.time;
                        // During a zoom release the last fingertip can travel
                        // quite far as it lifts. Don't interpret that as pan.
                        if (afterLift < 100 && (pinchHasScaled || liftMovement < 6)) return;
                        if (pinchHasScaled) {
                            panCameraAnchor = {x:e.clientX,y:e.clientY,panX,panY};
                            panSamples = [];
                            pinchHasScaled = false;
                        }
                        pinchHandoff = null;
                        pinchSamples = [];
                    }

                    if (e.pointerType === 'touch') {
                        rememberPanPoint(e.clientX, e.clientY, e.timeStamp);
                        pinchSamples = [];
                        lastPanX = e.clientX; lastPanY = e.clientY;
                        if (!panFrame) panFrame = requestAnimationFrame(renderPointerPan);
                        return;
                    }
                    // Mouse panning remains directly tied to its pointer.
                    panX += e.clientX - lastPanX;
                    panY += e.clientY - lastPanY;
                    if(window.ViewLimits){const p=ViewLimits.pan(panX,panY,zoom,true);panX=p.x;panY=p.y;}
                    lastPanX = e.clientX;
                    lastPanY = e.clientY;

                    // rAF-throttled redraw — stroke cache makes pan cheap
                    redrawCanvas();
                }
            });

            canvas.addEventListener('pointerup', (e) => {
                // Track pen inactivity for palm rejection
                if (e.pointerType === 'pen' || e.pointerType === 'eraser') {
                    markPenInactive(true, e.pointerId);
                }

                // HP Pen button handling
                if (typeof handleHPPenUp === 'function') {
                    handleHPPenUp(e);
                }

                // *** TEXT FIELD RESIZE END ***
                if (typeof HandwrittenTextField !== 'undefined' &&
                    (HandwrittenTextField.isResizing || HandwrittenTextField.isDragging)) {
                    HandwrittenTextField.handlePointerUp(e);
                    return;
                }
                if (typeof SimpleTextField !== 'undefined' &&
                    (SimpleTextField.isResizing || SimpleTextField.isDragging)) {
                    SimpleTextField.handlePointerUp(e);
                    return;
                }

                // Cancel long-press timer
                if (typeof cancelLongPress === 'function') {
                    cancelLongPress();
                }

                // Cancel timer if released early
                if (typeof cancelResizeTrigger === 'function') cancelResizeTrigger();

                // Lasso mode end
                if (typeof lassoMode !== 'undefined' && lassoMode) {
                    if(e.pointerId!==lassoSelection.pointerId)return;
                    endLasso();
                    if (!e.badnotesDirect) canvas.releasePointerCapture(e.pointerId);
                    return;
                }

                // Lasso selection manipulation end (pass event for tap detection)
                if (typeof handleLassoPointerUp === 'function' && handleLassoPointerUp(e)) {
                    if (!e.badnotesDirect) canvas.releasePointerCapture(e.pointerId);
                    return;
                }

                // Image manipulation end (pass event for trash drop detection)
                if (typeof handleImagePointerUp === 'function' && handleImagePointerUp(e)) {
                    if (!e.badnotesDirect) canvas.releasePointerCapture(e.pointerId);
                    return;
                }

                if (handleResizeEnd(e)) return;

                if (isDrawing && e.pointerId === drawingPointerId) {
                    stopDrawing(e);
                }
                if (isPointerPanning && e.pointerId === panningPointerId) {
                    const shouldCoast = e.pointerType === 'touch';
                    if (shouldCoast) finishPointerPan();
                    isPointerPanning = false;
                    panningPointerId = null;
                    if (!e.badnotesDirect) canvas.releasePointerCapture(e.pointerId);
                    if (shouldCoast && !startPanInertia()) _endGesturePreview();
                    if(!shouldCoast)window.ViewLimits?.settle();
                }
            });

            canvas.addEventListener('pointerleave', (e) => {
                if (e.pointerType === 'touch' && canvas.hasPointerCapture(e.pointerId)) return;
                // Track pen leaving for palm rejection
                if (e.pointerType === 'pen' || e.pointerType === 'eraser') {
                    markPenInactive(true, e.pointerId);
                }

                handleResizeEnd(e); // Cancel resize if leaving

                if (isDrawing && e.pointerId === drawingPointerId) {
                    stopDrawing(e);
                }
                if (isPointerPanning && e.pointerId === panningPointerId) {
                    isPointerPanning = false;
                    panningPointerId = null;
                    if (e.pointerType === 'touch') _endGesturePreview();
                }
            });

            // Track pen cancel events
            canvas.addEventListener('pointercancel', (e) => {
                window.LassoWorkbench?.cancel(e);
                if (e.pointerType === 'pen' || e.pointerType === 'eraser') {
                    markPenInactive(true, e.pointerId);
                }
                if (e.pointerType === 'touch' && isPointerPanning && e.pointerId === panningPointerId) {
                    isPointerPanning = false;
                    panningPointerId = null;
                    _endGesturePreview();
                }
            });

            canvas.style.touchAction = 'none';

            // PREVENT right-click context menu on canvas (pen barrel button triggers this)
            canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            });

            // Also prevent on canvas container
            canvasContainer.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            });

            // Handle touchscreen pinch/pan through Pointer Events. This is the
            // same native input stream used for pen and mouse, and avoids relying
            // on Chromium's separate TouchEvent compatibility path.
            const touchPointers = new Map();
            const rejectedTouchPointers = new Map();
            const blockedTouch = point => ({
                pointerId: point.pointerId, clientX: point.clientX, clientY: point.clientY,
                startX: point.clientX, startY: point.clientY, time: point.time ?? point.timeStamp,
                palm: (point.width || 0) > PALM_MIN_CONTACT_SIZE || (point.height || 0) > PALM_MIN_CONTACT_SIZE
            });
            let pointerGestureActive = false;
            let pinchHasScaled = false;
            let gestureFrame = 0;
            let pinchCameraAnchor = null;
            const anchorPinchCamera = (points) => {
                const center = getTouchCenter(points[0], points[1]);
                const rect = canvas.getBoundingClientRect();
                pinchCameraAnchor = {
                    zoom, distance: getTouchDistance(points[0], points[1]), left: rect.left, top: rect.top,
                    worldX: (center.x - rect.left - panX) / zoom,
                    worldY: (center.y - rect.top - panY) / zoom
                };
            };
            const renderPointerGesture = (time = performance.now(), flush = false) => {
                gestureFrame = 0;
                if (!pointerGestureActive || touchPointers.size < 2) return;
                const points = Array.from(touchPointers.values()).slice(0, 2);
                const distance = getTouchDistance(points[0], points[1]);
                const center = getTouchCenter(points[0], points[1]);
                _beginGesturePreview();
                lastTouchDistance = distance;
                lastTouchCenter = center;
                const now = Math.max(points[0].time, points[1].time);
                const previousSample = pinchSamples[pinchSamples.length - 1];
                const scale = Math.log(pinchCameraAnchor.zoom * distance / Math.max(1, pinchCameraAnchor.distance));
                if (Math.abs(scale - Math.log(pinchCameraAnchor.zoom)) >= 0.01) pinchHasScaled = true;
                if (!previousSample || previousSample.time !== now) {
                    pinchSamples.push({ x: center.x, y: center.y, scale, time: now });
                    while (pinchSamples.length > 2 && pinchSamples[0].time < now - 90) pinchSamples.shift();
                }
                const sample = cameraSampleAt(pinchSamples);
                const rawZoom=Math.exp(sample.scale),nextZoom=window.ViewLimits?ViewLimits.zoom(rawZoom,true):Math.max(.2,Math.min(400,rawZoom));
                const rawX = sample.x - pinchCameraAnchor.left - pinchCameraAnchor.worldX * nextZoom;
                const rawY = sample.y - pinchCameraAnchor.top - pinchCameraAnchor.worldY * nextZoom;
                contactProjection={rawX,rawY,rawZoom,worldX:pinchCameraAnchor.worldX,worldY:pinchCameraAnchor.worldY};
                const p=window.ViewLimits?ViewLimits.pan(rawX,rawY,nextZoom,true):{x:rawX,y:rawY};
                const nextPanX=p.x,nextPanY=p.y;
                window.ViewLimits?.setPivot(sample.x-pinchCameraAnchor.left,sample.y-pinchCameraAnchor.top);
                if (zoom !== nextZoom || panX !== nextPanX || panY !== nextPanY) {
                    _setZoomInternal(rawZoom,null,null,true);
                    panX = nextPanX; panY = nextPanY;
                    _updateGesturePreview(true);
                }
                // Wake on the next input sample, not continuously while two
                // fingers are resting on an unchanged camera.
            };
            const endPointerGesture = (e) => {
                if (rejectedTouchPointers.delete(e.pointerId)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                const wasGesture = pointerGestureActive;
                if (wasGesture && touchPointers.size >= 2 && gestureFrame) {
                    cancelAnimationFrame(gestureFrame);
                    renderPointerGesture(performance.now(), true);
                }
                touchPointers.delete(e.pointerId);
                if (touchPointers.size === 0) canvasContainer.classList.remove('touch-contact');
                if (!wasGesture) return;

                e.preventDefault();
                e.stopImmediatePropagation();
                const remaining = Array.from(touchPointers.values());
                if (remaining.length >= 2) {
                    lastTouchDistance = getTouchDistance(remaining[0], remaining[1]);
                    lastTouchCenter = getTouchCenter(remaining[0], remaining[1]);
                    anchorPinchCamera(remaining);
                    pinchSamples = [{ x: lastTouchCenter.x, y: lastTouchCenter.y, scale: Math.log(zoom), time: e.timeStamp }];
                    gestureFrame = requestAnimationFrame(renderPointerGesture);
                } else if (remaining.length === 1) {
                    isPinching = false;
                    isPanning = false;
                    lastTouchDistance = 0;
                    isPointerPanning = true;
                    panningPointerId = remaining[0].pointerId;
                    lastPanX = remaining[0].clientX;
                    lastPanY = remaining[0].clientY;
                    panSamples = [];
                    rememberPanPoint(lastPanX, lastPanY);
                    panCameraAnchor = { x: lastPanX, y: lastPanY, panX, panY };
                    // Finger-up events arrive separately. Small lift jitter
                    // must not turn a zoom release into a one-finger pan fling.
                    pinchHandoff = {
                        release: e.type === 'pointerup' ? (() => {
                            const velocity = projectCameraRelease(releaseVelocity(pinchSamples));
                            return velocity ? { ...velocity, zoomGesture: pinchHasScaled } : null;
                        })() : null,
                        time: performance.now(), x: lastPanX, y: lastPanY
                    };
                } else {
                    if (panFrame) finishPointerPan();
                    pointerGestureActive = false;
                    isPointerPanning = false;
                    panningPointerId = null;
                    isPinching = false;
                    isPanning = false;
                    lastTouchDistance = 0;
                    let release = pinchHandoff && performance.now() - pinchHandoff.time < 100
                        ? pinchHandoff.release : projectCameraRelease(releaseVelocity(panSamples));
                    if (release && pinchHandoff) {
                        const freshness = Math.exp(-Math.max(0, performance.now() - pinchHandoff.time - 30) / 30);
                        release = { ...release, x: release.x * freshness, y: release.y * freshness, scale: release.scale * freshness };
                    }
                    if (e.type !== 'pointerup' || !startPanInertia(release)) _endGesturePreview();
                    pinchSamples = [];
                    pinchHandoff = null;
                }
            };

            const beginPointerPinch = (e, consume = true) => {
                if (consume) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
                for (const pointerId of touchPointers.keys()) {
                    try { canvasContainer.setPointerCapture(pointerId); } catch (_) {}
                }
                pointerGestureActive = true;
                pinchHasScaled = false;
                finishPointerPan();
                _beginGesturePreview();
                isPinching = true;
                isPanning = true;
                cancelResizeTrigger();
                if (isDrawing) {
                    isDrawing = false;
                    drawingPointerId = null;
                    currentStroke = null;
                    activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
                }
                isPointerPanning = false;
                panningPointerId = null;
                const points = Array.from(touchPointers.values()).slice(0, 2);
                anchorPinchCamera(points);
                lastTouchDistance = getTouchDistance(points[0], points[1]);
                lastTouchCenter = getTouchCenter(points[0], points[1]);
                pinchSamples = [{ x: lastTouchCenter.x, y: lastTouchCenter.y, scale: Math.log(zoom), time: performance.now() }];
                pinchHandoff = null;
            };

            const resumeNavigationTouches = (e) => {
                if (penIsActive || isDrawing || fingerDrawingEnabled) return;
                let resumed = false;
                for (const [pointerId, point] of rejectedTouchPointers) {
                    if (point.palm) continue;
                    rejectedTouchPointers.delete(pointerId);
                    touchPointers.set(pointerId, { ...point, pointerId });
                    resumed = true;
                }
                if (!resumed) return;
                cancelPanInertia();
                canvasContainer.classList.add('touch-contact');
                if (touchPointers.size >= 2) {
                    beginPointerPinch(e, false);
                    return;
                }
                const point = touchPointers.values().next().value;
                isPointerPanning = true;
                panningPointerId = point.pointerId;
                lastPanX = point.clientX;
                lastPanY = point.clientY;
                panCameraAnchor = { x: point.clientX, y: point.clientY, panX, panY };
                panSamples = [];
                rememberPanPoint(point.clientX, point.clientY, performance.now());
                _beginGesturePreview();
                try { canvas.setPointerCapture(point.pointerId); } catch (_) {}
            };

            canvasContainer.addEventListener('pointerdown', (e) => {
                if ((e.pointerType === 'pen' || e.pointerType === 'eraser') &&
                    (e.buttons & 33) !== 0 && settings.palmRejection !== false) {
                    // Contacts already resting on the screen become palms
                    // while writing; don't let their existing pan keep moving.
                    for (const [pointerId, point] of touchPointers) rejectedTouchPointers.set(pointerId, blockedTouch(point));
                    touchPointers.clear();
                    canvasContainer.classList.remove('touch-contact');
                    if (gestureFrame) cancelAnimationFrame(gestureFrame);
                    if (panFrame) cancelAnimationFrame(panFrame);
                    gestureFrame = panFrame = 0;
                    pointerGestureActive = false;
                    isPointerPanning = false;
                    panningPointerId = null;
                    isPinching = isPanning = false;
                    panCameraAnchor = pinchHandoff = null;
                    _endGesturePreview(false);
                }
                if (e.pointerType !== 'touch') return;
                if (shouldRejectTouch(e)) {
                    rejectedTouchPointers.set(e.pointerId, blockedTouch(e));
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                cancelPanInertia();
                canvasContainer.classList.add('touch-contact');
                touchPointers.set(e.pointerId, { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, time: e.timeStamp, width: e.width, height: e.height });
                if (touchPointers.size < 2) return; // Let existing one-finger behavior run.
                if (pointerGestureActive) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return; // Extra contacts must not reset the active pair.
                }

                beginPointerPinch(e);
            }, { capture: true, passive: false });

            canvasContainer.addEventListener('pointermove', (e) => {
                if (rejectedTouchPointers.has(e.pointerId)) {
                    const pending = rejectedTouchPointers.get(e.pointerId);
                    pending.palm ||= e.width > PALM_MIN_CONTACT_SIZE || e.height > PALM_MIN_CONTACT_SIZE;
                    pending.clientX = e.clientX;
                    pending.clientY = e.clientY;
                    pending.time = e.timeStamp;
                    if (penIsActive || isDrawing) {
                        pending.startX = e.clientX;
                        pending.startY = e.clientY;
                    }
                    const deliberateMovement = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) >= 6;
                    if (!pending.palm && !fingerDrawingEnabled && !penIsActive && !isDrawing && deliberateMovement) {
                        // The finger can land just before pen-up. Promote its
                        // first deliberate post-pen movement without requiring
                        // another finger-down or a waiting period.
                        rejectedTouchPointers.delete(e.pointerId);
                        canvasContainer.classList.add('touch-contact');
                        touchPointers.set(e.pointerId, {
                            pointerId: e.pointerId, clientX: pending.startX, clientY: pending.startY,
                            time: e.timeStamp, width: e.width, height: e.height
                        });
                        // A two-finger pinch may also have landed before the
                        // final pen-up. Arm both small contacts from their
                        // original positions so the first pinch packet counts.
                        for (const [pointerId, partner] of rejectedTouchPointers) {
                            if (!partner.palm) {
                                rejectedTouchPointers.delete(pointerId);
                                touchPointers.set(pointerId, {
                                    pointerId, clientX: partner.startX, clientY: partner.startY,
                                    time: partner.time
                                });
                            }
                        }
                        if (touchPointers.size >= 2) {
                            beginPointerPinch(e);
                            touchPointers.set(e.pointerId, {
                                pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
                                time: e.timeStamp, width: e.width, height: e.height
                            });
                            if (!gestureFrame) gestureFrame = requestAnimationFrame(renderPointerGesture);
                        } else {
                            isPointerPanning = true;
                            panningPointerId = e.pointerId;
                            panSamples = [];
                            rememberPanPoint(e.clientX, e.clientY, e.timeStamp);
                            lastPanX = e.clientX; lastPanY = e.clientY;
                            panCameraAnchor = { x: pending.startX, y: pending.startY, panX, panY };
                            _beginGesturePreview();
                            touchPointers.set(e.pointerId, {
                                pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
                                time: e.timeStamp, width: e.width, height: e.height
                            });
                            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
                            if (!panFrame) panFrame = requestAnimationFrame(renderPointerPan);
                        }
                    }
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                if (!touchPointers.has(e.pointerId)) return;
                touchPointers.set(e.pointerId, { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, time: e.timeStamp, width: e.width, height: e.height });
                if (!pointerGestureActive || touchPointers.size < 2) return;

                e.preventDefault();
                e.stopImmediatePropagation();
                if (!gestureFrame) gestureFrame = requestAnimationFrame(renderPointerGesture);
            }, { capture: true, passive: false });

            canvasContainer.addEventListener('pointerup', endPointerGesture, { capture: true, passive: false });
            canvasContainer.addEventListener('pointercancel', endPointerGesture, { capture: true, passive: false });

            // Mouse wheel zoom
            canvasContainer.addEventListener('wheel', (e) => {
                window.ViewLimits?.cancel();
                cancelPanInertia();
                handleWheel(e);
            }, { passive: false });
            document.addEventListener('pointerdown', cancelPanInertia, { capture: true });
            window.addEventListener('blur', cancelPanInertia);

            // Pen lift/capture loss can arrive outside the drawing canvas.
            // Clear contact state there too, rather than leaving touch locked.
            const releasePenContact = (e) => {
                if (e.pointerType !== 'pen' && e.pointerType !== 'eraser') return;
                markPenInactive(true, e.pointerId);
                if (isDrawing && drawingPointerId === e.pointerId) {
                    stopDrawing(e.type === 'pointerup' ? e : undefined);
                }
                resumeNavigationTouches(e);
            };
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
                document.addEventListener(type, releasePenContact, { capture: true });
            });

            // Linux may suppress wl_touch while the stylus is merely nearby.
            // Route read-only hardware fingers through the same camera handlers,
            // and use BTN_TOUCH (not proximity/pressure/barrel buttons) for ink.
            let directTouchEnabled = false;
            const directContacts = new Map();
            const blockedDirectContacts = new Set();
            const directEvent = (point, phase, frameTime = performance.now()) => {
                const type = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel' }[phase];
                if (!type) return;
                const event = new PointerEvent(type, {
                    bubbles: true, cancelable: true, pointerType: 'touch',
                    pointerId: 1000000 + point.id, clientX: point.x, clientY: point.y,
                    width: 10, height: 10, buttons: phase === 'up' || phase === 'cancel' ? 0 : 1,
                    pressure: phase === 'up' || phase === 'cancel' ? 0 : .5,
                });
                Object.defineProperty(event, 'badnotesDirect', { value: true });
                Object.defineProperty(event, 'timeStamp', { value: frameTime });
                canvas.dispatchEvent(event);
            };
            const cancelDirectTouches = () => {
                for (const point of directContacts.values()) directEvent(point, 'cancel');
                directContacts.clear();
            };
            const updateHardwarePen = active => {
                const wasPenActive = penIsActive || hardwarePenContact === true;
                const wasHardwareActive = hardwarePenContact === true;
                hardwarePenContact = active;
                if (active) {
                    markPenActive(activePenPointerId);
                    if (!wasHardwareActive) {
                        for (const id of directContacts.keys()) blockedDirectContacts.add(id);
                        cancelDirectTouches();
                    }
                } else {
                    markPenInactive();
                    if(typeof lassoMode!=='undefined'&&lassoMode&&['pen','eraser'].includes(lassoSelection.pointerType))endLasso();
                    if (isDrawing && wasPenActive) stopDrawing();
                    resumeNavigationTouches({ preventDefault() {}, stopImmediatePropagation() {} });
                }
            };
            // Native touchscreen events still operate menus/buttons. Only the
            // drawing surface is de-duplicated while its direct reader is active.
            for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
                document.addEventListener(type, event => {
                    if (directTouchEnabled && event.pointerType === 'touch' && !event.badnotesDirect &&
                        canvasContainer.contains(event.target)) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                    }
                }, { capture: true, passive: false });
            }
            const routeDirectInput = packet => {
                if (packet.type === 'touch-source') {
                    if (directTouchEnabled !== packet.direct) {
                        cancelDirectTouches();
                        blockedDirectContacts.clear();
                    }
                    directTouchEnabled = packet.direct === true;
                    if (!directTouchEnabled) hardwarePenContact = null;
                    if (!directTouchEnabled && typeof resetHPPenHardwareButtons==='function')resetHPPenHardwareButtons();
                } else if (packet.type === 'cancel') {
                    cancelDirectTouches();
                    blockedDirectContacts.clear();
                    hardwarePenContact = null;
                    markPenInactive();
                    if (isDrawing) stopDrawing();
                    if(typeof resetHPPenHardwareButtons==='function')resetHPPenHardwareButtons();
                } else if (packet.type === 'pen-buttons' && directTouchEnabled) {
                    if(typeof updateHPPenHardwareButtons==='function')updateHPPenHardwareButtons(packet);
                } else if (packet.type === 'pen-contact' && directTouchEnabled) {
                    updateHardwarePen(packet.contact === true);
                } else if (packet.type === 'direct-touch' && directTouchEnabled) {
                    if (typeof packet.penContact === 'boolean') updateHardwarePen(packet.penContact);
                    const frameTime = performance.now();
                    // Apply a coherent pair before move-driven camera updates.
                    // On release packets, preserve the last two-finger pose:
                    // remaining-finger lift motion belongs to the handoff.
                    const hasRelease = (packet.events || []).some(point => point.phase === 'up' || point.phase === 'cancel');
                    for (const point of hasRelease ? [] : (packet.events || [])) {
                        const id = 1000000 + point.id;
                        const tracked = touchPointers.get(id);
                        if (tracked && point.phase === 'move') {
                            touchPointers.set(id, {...tracked,clientX:point.x,clientY:point.y,time:frameTime});
                        }
                    }
                    for (const point of packet.events || []) {
                        if (blockedDirectContacts.has(point.id)) {
                            if (point.phase === 'up' || point.phase === 'cancel') blockedDirectContacts.delete(point.id);
                            continue;
                        }
                        if (point.phase === 'down') {
                            if (penIsActive || isDrawing) {
                                blockedDirectContacts.add(point.id);
                                continue;
                            }
                            const target = document.elementFromPoint(point.x, point.y);
                            if (target !== canvas && target !== activeCanvas && target !== canvasContainer) continue;
                            directContacts.set(point.id, point);
                            directEvent(point, 'down', frameTime);
                        } else if (directContacts.has(point.id)) {
                            directContacts.set(point.id, point);
                            directEvent(point, point.phase, frameTime);
                            if (point.phase === 'up' || point.phase === 'cancel') directContacts.delete(point.id);
                        }
                    }
                }
            };
            if (window.badnotesTouch) window.badnotesTouch.subscribe(routeDirectInput);
            // Read-only routing diagnostics and deterministic regression input.
            window.badnotesDirectInput = routeDirectInput;
            window.badnotesDirectState = () => ({ enabled: directTouchEnabled, contacts: directContacts.size, penContact: hardwarePenContact });

            // Refresh the actual canvas cursor as soon as a tool is selected.
            document.addEventListener('click', (e) => {
                if (e.target.closest('.tool-btn, [data-tool]')) {
                    requestAnimationFrame(() => updateCanvasToolCursor());
                }
            });

            // Recycle Bin
            document.getElementById('recycleBinBtn').addEventListener('click', showRecycleBin);

            // Close Recycle Bin
            document.getElementById('closeRecycleBin').addEventListener('click', hideRecycleBin);

            // Empty Recycle Bin
            document.getElementById('emptyRecycleBin').addEventListener('click', emptyRecycleBin);

            // Tool buttons (non-shape tools)
            document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Deactivate all tool buttons including shape dropdown
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => b.classList.remove('active'));
                    const shapeBtn = document.getElementById('shapeDropdownBtn');
                    if (shapeBtn) shapeBtn.classList.remove('active');

                    btn.classList.add('active');
                    currentTool = btn.dataset.tool;
                });
            });

            // Shapes dropdown (legacy - may not exist if using geometry mode)
            const shapeDropdownBtn = document.getElementById('shapeDropdownBtn');
            const shapesMenu = document.getElementById('shapesMenu');

            if (shapeDropdownBtn) {
                document.querySelectorAll('.shapes-menu .tool-btn[data-shape]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        // Deactivate all tool buttons
                        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                        document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => b.classList.remove('active'));

                        // Activate this shape
                        btn.classList.add('active');
                        shapeDropdownBtn.classList.add('active');

                        // Update the dropdown button icon
                        currentShape = btn.dataset.shape;
                        shapeDropdownBtn.innerHTML = shapeIcons[currentShape];
                        shapeDropdownBtn.dataset.tool = currentShape;

                        // Set the current tool
                        currentTool = currentShape;
                    });
                });

                // Clicking the shape dropdown button itself selects the current shape
                shapeDropdownBtn.addEventListener('click', (e) => {
                    // Prevent if clicking when menu is showing
                    if (e.target.closest('.shapes-menu')) return;

                    // Deactivate all other tool buttons
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    shapeDropdownBtn.classList.add('active');

                    // Find and activate the current shape in the menu
                    document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.shape === currentShape);
                    });

                    currentTool = currentShape;
                });
            }

            // File Import (Images)
            const importFileBtn = document.getElementById('importFileBtn');
            if (importFileBtn) {
                importFileBtn.addEventListener('click', () => {
                    document.getElementById('fileInput').click();
                });
            }

            // Handwritten Text Tool
            const handwrittenTextBtn = document.getElementById('handwrittenTextBtn');
            if (handwrittenTextBtn) {
                handwrittenTextBtn.addEventListener('click', () => {
                    if (typeof HandwrittenTextTool !== 'undefined') {
                        HandwrittenTextTool.activate();
                    }
                });
            }

            // Simple Text Tool
            const simpleTextBtn = document.getElementById('simpleTextBtn');
            if (simpleTextBtn) {
                simpleTextBtn.addEventListener('click', () => {
                    if (typeof SimpleTextTool !== 'undefined') {
                        SimpleTextTool.activate();
                    }
                });
            }

            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        // Handle as image
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const img = new Image();
                            img.onload = () => {
                                // Scale down if too large (max 500px width/height initially)
                                let w = img.width;
                                let h = img.height;
                                const maxSize = 500;
                                if (w > maxSize || h > maxSize) {
                                    const ratio = Math.min(maxSize / w, maxSize / h);
                                    w *= ratio;
                                    h *= ratio;
                                }

                                // Center in visible view
                                const center = getCanvasCenter();

                                if (!images) images = []; // Ensure array exists
                                const newImage = {
                                    id: Date.now().toString(),
                                    dataUrl: event.target.result,
                                    x: center.x - w / 2,
                                    y: center.y - h / 2,
                                    width: w,
                                    height: h,
                                    rotation: 0
                                };
                                images.push(newImage);

                                // Push to history for undo
                                historyStack.push({
                                    type: 'image-add',
                                    image: structuredClone(newImage)
                                });
                                redoStack.length = 0;

                                redrawCanvas();
                                saveCurrentPage();
                                showToast('Image imported', 'success');

                                // Reset input
                                e.target.value = '';
                            };
                            img.src = event.target.result;
                        };
                        reader.readAsDataURL(file);
                    }
                });
            }

            // Phone scan listener (auto-insert scanned images)
            setupPhoneScanListener();

            // Color overflow indicator click - show all colors in a popup
            document.getElementById('colorOverflowIndicator').addEventListener('click', () => {
                window.PaletteWorkbench?.open();
            });

            // Primary color picker
            document.getElementById('colorPicker').addEventListener('input', (e) => {
                setColor(e.target.value);
                // Update HP Pen primary color
                if (typeof hpPenColors !== 'undefined') {
                    hpPenColors.primary = e.target.value;
                }
            });

            // Secondary color picker (HP Pen)
            const secondaryColorPicker = document.getElementById('secondaryColorPicker');
            if (secondaryColorPicker) {
                secondaryColorPicker.addEventListener('input', (e) => {
                    if (typeof setHPPenSecondaryColor === 'function') {
                        setHPPenSecondaryColor(e.target.value);
                    }
                    // Update UI
                    updateColorSwapUI();
                });
            }

            // Primary Color Swatch Click + Drag-to-Fill
            const primarySwatch = document.getElementById('primaryColorSwatch');
            if (primarySwatch) {
                primarySwatch.addEventListener('click', () => {
                    document.getElementById('colorPicker').click();
                });
                // Make draggable for canvas fill
                primarySwatch.setAttribute('draggable', 'true');
                primarySwatch.addEventListener('dragstart', (e) => {
                    const color = document.getElementById('colorPicker').value;
                    e.dataTransfer.setData('application/x-badnotes-color', color);
                    e.dataTransfer.effectAllowed = 'copyMove';
                    document.body.classList.add('is-dragging-color');
                });
                primarySwatch.addEventListener('dragend', () => {
                    document.body.classList.remove('is-dragging-color');
                });
            }

            // Secondary Color Swatch Click + Drag-to-Fill
            const secondarySwatch = document.getElementById('secondaryColorSwatch');
            if (secondarySwatch) {
                secondarySwatch.addEventListener('click', () => {
                    document.getElementById('secondaryColorPicker').click();
                });
                // Make draggable for canvas fill
                secondarySwatch.setAttribute('draggable', 'true');
                secondarySwatch.addEventListener('dragstart', (e) => {
                    const color = document.getElementById('secondaryColorPicker').value;
                    e.dataTransfer.setData('application/x-badnotes-color', color);
                    e.dataTransfer.effectAllowed = 'copyMove';
                    document.body.classList.add('is-dragging-color');
                });
                secondarySwatch.addEventListener('dragend', () => {
                    document.body.classList.remove('is-dragging-color');
                });
            }

            // Color Swap Button
            const colorSwapBtn = document.getElementById('colorSwapBtn');
            if (colorSwapBtn) {
                colorSwapBtn.addEventListener('click', () => {
                    if (typeof swapHPPenColors === 'function') {
                        swapHPPenColors();
                        updateColorSwapUI();
                    }
                });
            }

            // Initialize color swap UI
            updateColorSwapUI();

            // Palette & Pipette
            document.getElementById('pipetteBtn')?.addEventListener('click', activatePipette);
            document.getElementById('addColorBtn').addEventListener('click', () => window.PaletteWorkbench?.open());

            // Initialize UI
            const customColorPicker = document.getElementById('customColorPicker');
            if (customColorPicker) {
                customColorPicker.style.setProperty('--current-color', currentColor);
            }
            renderPalette();

            // Size slider
            const sizeSlider = document.getElementById('sizeSlider');
            if (sizeSlider && !sizeSlider.dataset.sizeListenerBound) {
                // Panel controls survive hidden-section toolbar renders.
                sizeSlider.dataset.sizeListenerBound='true';
                sizeSlider.addEventListener('input', () => {
                    currentSize = parseFloat(sizeSlider.value);
                    baseBrushSize = currentSize;
                    // Format display: show 1 decimal for sizes under 10px
                    const displayValue = currentSize < 10 ? currentSize.toFixed(1) : Math.round(currentSize);
                    document.getElementById('sizeValue').textContent = displayValue + 'px';
                });
            }

            // Dynamic brush toggle - persistent
            const dynamicBrushToggle = document.getElementById('dynamicBrushToggle');
            // Load saved state
            dynamicBrushEnabled = settings.dynamicBrushEnabled || false;
            dynamicBrushToggle.checked = dynamicBrushEnabled;

            if (!dynamicBrushToggle.dataset.pressureListenerBound) {
                dynamicBrushToggle.dataset.pressureListenerBound='true';
                dynamicBrushToggle.addEventListener('change', (e) => {
                    dynamicBrushEnabled = e.target.checked;
                    settings.dynamicBrushEnabled = dynamicBrushEnabled;
                    saveSettings();
                });
            }

            // Finger drawing toggle
            const fingerDrawBtn = document.getElementById('fingerDrawBtn');
            fingerDrawBtn.addEventListener('click', () => {
                fingerDrawingEnabled = !fingerDrawingEnabled;
                fingerDrawBtn.classList.toggle('active', fingerDrawingEnabled);
                // Persist to settings
                settings.fingerDrawing = fingerDrawingEnabled;
                saveSettings();
                showToast(fingerDrawingEnabled ? 'Finger drawing enabled' : 'Finger drawing disabled', 'info');
            });

            // Eraser mode selector
            document.querySelectorAll('.eraser-mode').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.eraser-mode').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    eraserMode = btn.dataset.mode;
                    // Also select eraser tool when changing mode
                    currentTool = 'eraser';
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
                        b.classList.toggle('active', b.dataset.tool === 'eraser');
                    });
                });
            });
            document.getElementById('themeToggleBtn').addEventListener('click', () => {
                toggleTheme();
                updateThemeIcon();
            });

            // Geometry mode toggle
            const geometryToggleBtn = document.getElementById('geometryToggleBtn');
            if (geometryToggleBtn) {
                geometryToggleBtn.addEventListener('click', () => {
                    if (window.GeometryDetector) {
                        window.GeometryWorkbench?.sync();
                    }
                });
            }

            // Undo/Redo
            document.getElementById('undoBtn').addEventListener('click', undo);
            document.getElementById('redoBtn').addEventListener('click', redo);

            // Zoom - click on percentage to reset
            document.getElementById('zoomValue').addEventListener('click', () => {
                zoom = 1;
                panX = 0;
                panY = 0;
                updateCanvasTransform();
                document.getElementById('zoomValue').textContent = '100%';
            });

            // Settings modal
            document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
            document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsModal);
            document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsFromModal);
            document.getElementById('resetSettingsBtn').addEventListener('click', resetSettingsToDefault);

            // Font trainer modal
            document.getElementById('fontTrainerBtn')?.addEventListener('click', () => {
                if (typeof FontTrainer !== 'undefined') {
                    FontTrainer.open();
                }
            });

            const fontbookAddPageBtn = document.getElementById('fontbookAddPageBtn');
            if (fontbookAddPageBtn) {
                fontbookAddPageBtn.addEventListener('click', () => {
                    if (typeof FontBook !== 'undefined' && FontBook.isFontBook && FontBook.isFontBook()) {
                        const name = prompt('Name this font variation (optional):', `Font ${pages.length + 1}`);
                        FontBook.addFontPage(name && name.trim() ? name.trim() : undefined);
                    } else {
                        showToast('Open the Fontbook to add a font page', 'info');
                    }
                });
            }

            // Fullscreen toggle
            document.getElementById('fullscreenBtn').addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                } else {
                    document.exitFullscreen();
                }
            });

            // Update fullscreen button icon on change
            document.addEventListener('fullscreenchange', () => {
                const btn = document.getElementById('fullscreenBtn');
                if (document.fullscreenElement) {
                    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                    </svg>`;
                    btn.title = 'Exit Fullscreen';
                } else {
                    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    </svg>`;
                    btn.title = 'Fullscreen';
                }
            });

            // Settings sliders live update
            document.getElementById('smoothnessSlider').addEventListener('input', (e) => {
                document.getElementById('smoothnessValue').textContent = e.target.value;
            });
            document.getElementById('minDistanceSlider').addEventListener('input', (e) => {
                document.getElementById('minDistanceValue').textContent = e.target.value + 'px';
            });

            // Pressure multiplier slider
            document.getElementById('settingsPressureMultiplier').addEventListener('input', (e) => {
                document.getElementById('pressureMultiplierValue').textContent = e.target.value + 'x';
            });

            // Close settings modal on overlay click
            document.getElementById('settingsModal').addEventListener('click', (e) => {
                if (e.target.id === 'settingsModal') closeSettingsModal();
            });

            // Add page
            document.getElementById('addPageBtn').addEventListener('click', () => {
                if (typeof FontBook !== 'undefined' && FontBook.isFontBook && FontBook.isFontBook()) {
                    const name = prompt('Name this font variation (optional):', `Font ${pages.length + 1}`);
                    FontBook.addFontPage(name && name.trim() ? name.trim() : undefined);
                    return;
                }
                addPage();
            });

            // Expand canvas
            document.getElementById('expandTop').addEventListener('click', () => expandCanvas('top', 480));
            document.getElementById('expandBottom').addEventListener('click', () => expandCanvas('bottom', 480));
            document.getElementById('expandLeft').addEventListener('click', () => expandCanvas('left', 480));
            document.getElementById('expandRight').addEventListener('click', () => expandCanvas('right', 480));

            // New notebook modal
            const newNotebookBtn = document.getElementById('newNotebookBtn');
            if (newNotebookBtn) {
                newNotebookBtn.addEventListener('click', () => showModal('newNotebookModal'));
            }

            const createNotebookBtn = document.getElementById('createNotebookBtn');
            if (createNotebookBtn) {
                createNotebookBtn.addEventListener('click', async () => {
                    const nameInput = document.getElementById('newNotebookTitle') || document.getElementById('notebookNameInput');
                    const name = nameInput ? (nameInput.value || 'My Notebook') : 'My Notebook';
                    // Get selected color from the modal's color grid
                    const colorGrid = document.getElementById('colorGrid');
                    const selectedColorEl = colorGrid ? colorGrid.querySelector('.color-option.selected') : null;
                    const color = selectedColorEl ? selectedColorEl.dataset.color : (typeof colors !== 'undefined' && colors[0]) || '#4a9eff';
                    // Get selected template from the modal's template options
                    const modal = document.getElementById('newNotebookModal');
                    const selectedTemplateEl = modal ? modal.querySelector('.template-option.selected') : null;
                    const template = selectedTemplateEl ? selectedTemplateEl.dataset.template : 'blank';
                    await createNotebook(name, color, template);
                    hideModal('newNotebookModal');
                    if (nameInput) nameInput.value = '';
                });
            }

            // Keyboard shortcuts
            let paletteScrubPosition = null;
            let paletteHintTimer=null;
            let paletteScrubIndex = -1;
            document.addEventListener('keydown', (e) => {
                // Skip if typing in an input
                const target = e.target;
                if (!target || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
                if (typeof SimpleTextField !== 'undefined' && SimpleTextField.hasActiveField()) return;
                if (typeof HandwrittenTextField !== 'undefined' && HandwrittenTextField.hasActiveField()) return;

                // Number keys select saved slots; Shift + number assigns the
                // current color. Hold Alt and slide across number keys to scrub
                // through the current palette like a tiny keyboard touch strip.
                const digitMatch = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '') || /^([0-9])$/.exec(e.key || '');
                if (digitMatch && !e.ctrlKey && !e.metaKey) {
                    const dock=document.querySelector('.floating-toolbar');
                    dock?.classList.add('palette-key-hints');
                    clearTimeout(paletteHintTimer);
                    paletteHintTimer=setTimeout(()=>dock?.classList.remove('palette-key-hints'),900);
                    const digit = Number(digitMatch[1]);
                    const slotIndex = digit === 0 ? 9 : digit - 1;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.altKey && !e.shiftKey) {
                        const colors = Array.isArray(customPalette) ? customPalette : [];
                        const stripPosition = digit === 0 ? 9 : digit - 1;
                        if (colors.length) {
                            if (paletteScrubPosition === null) {
                                // Touch down: anchor on the active palette color;
                                // movement between number keys changes the color.
                                paletteScrubPosition = stripPosition;
                                paletteScrubIndex = Math.max(0, colors.indexOf(currentColor));
                            } else {
                                const movement = stripPosition - paletteScrubPosition;
                                if (movement !== 0) {
                                    paletteScrubIndex = ((paletteScrubIndex + movement) % colors.length + colors.length) % colors.length;
                                    setColor(colors[paletteScrubIndex]);
                                    paletteScrubPosition = stripPosition;
                                }
                            }
                        }
                    } else if (!e.altKey && e.shiftKey) {
                        keyboardColorSlots[slotIndex] = currentColor;
                        localStorage.setItem('badnotes_keyboard_color_slots', JSON.stringify(keyboardColorSlots));
                        renderPalette();
                        showToast(`Color slot ${digit || 10} set to ${currentColor}`, 'success');
                    } else if (!e.altKey) {
                        setColor(keyboardColorSlots[slotIndex]);
                    }
                    return;
                }

                // Delete selected image
                if ((e.key === 'Delete' || e.key === 'Backspace') && typeof selectedImage !== 'undefined' && selectedImage) {
                    e.preventDefault();
                    deleteSelectedImage();
                    return;
                }

                // Delete selected strokes (lasso)
                if ((e.key === 'Delete' || e.key === 'Backspace') && typeof hasLassoSelection === 'function' && hasLassoSelection()) {
                    e.preventDefault();
                    deleteSelectedStrokes();
                    return;
                }

                // Escape to deselect image
                if (e.key === 'Escape' && typeof selectedImage !== 'undefined' && selectedImage) {
                    deselectImage();
                    return;
                }

                // Escape to deselect lasso selection
                if (e.key === 'Escape' && typeof hasLassoSelection === 'function' && hasLassoSelection()) {
                    clearLassoSelection();
                    redrawCanvas();
                    return;
                }

                // L to lock/unlock selected image
                if (e.key === 'l' && typeof selectedImage !== 'undefined' && selectedImage) {
                    e.preventDefault();
                    toggleImageLock();
                    return;
                }

                // Fullscreen toggle (F11 or Ctrl+Alt+F)
                if (e.key === 'F11' || (e.ctrlKey && e.altKey && (e.key === 'f' || e.key === 'F'))) {
                    e.preventDefault();
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen().catch(() => {});
                    } else {
                        document.exitFullscreen();
                    }
                    return;
                }

                if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault();if(e.shiftKey)redo();else undo();return; }
                if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault();redo();return; }
                if (e.key.toLowerCase() === 'p') currentTool = 'pen';
                if (e.key.toLowerCase() === 'h') currentTool = 'highlighter';
                if (e.key.toLowerCase() === 'e') currentTool = 'eraser';

                // Geometry mode toggle
                if (e.key === 'g' && !e.ctrlKey && !e.shiftKey) {
                    const geometryToggleBtn = document.getElementById('geometryToggleBtn');
                    if (window.GeometryDetector && geometryToggleBtn) {
                        const enabled = window.GeometryDetector.toggle();
                        geometryToggleBtn.classList.toggle('active', enabled);
                        showToast(enabled ? 'Geometry mode on' : 'Geometry mode off', 'info');
                    }
                }

                if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
                    if (typeof SimpleTextTool !== 'undefined') {
                        SimpleTextTool.activate();
                    }
                }

                // Shape shortcuts (legacy - only if shapes dropdown exists)
                const shapeDropdownBtn = document.getElementById('shapeDropdownBtn');
                if (shapeDropdownBtn) {
                    const shapeKeys = { 'l': 'line', 'r': 'rectangle', 'c': 'circle', 'a': 'arrow' };
                    if (shapeKeys[e.key]) {
                        currentTool = shapeKeys[e.key];
                        currentShape = shapeKeys[e.key];

                        // Update dropdown button
                        shapeDropdownBtn.innerHTML = shapeIcons[currentShape];
                        shapeDropdownBtn.dataset.tool = currentShape;
                        shapeDropdownBtn.classList.add('active');

                        // Update menu
                        document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => {
                            b.classList.toggle('active', b.dataset.shape === currentShape);
                        });
                    }
                }

                // Update toolbar buttons
                document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
                    if (!b.closest('.shapes-dropdown')) {
                        b.classList.toggle('active', b.dataset.tool === currentTool);
                    }
                });

                // Handle shape dropdown separately (if exists)
                const shapeDropdownBtnForActive = document.getElementById('shapeDropdownBtn');
                if (shapeDropdownBtnForActive) {
                    const isShapeTool = ['line', 'rectangle', 'circle', 'arrow'].includes(currentTool);
                    shapeDropdownBtnForActive.classList.toggle('active', isShapeTool);
                }
                if (typeof updateCanvasToolCursor === 'function') updateCanvasToolCursor();
            });
            document.addEventListener('keyup', (e) => {
                if (e.key === 'Alt' || e.key === 'Shift') paletteScrubPosition = null;
            });

            // Auto-save every 30 seconds (managed for cleanup)
            createManagedInterval(() => {
                if (currentNotebook) saveCurrentPage();
            }, 30000);

            // Save before page unload
            window.addEventListener('beforeunload', (e) => {
                if (currentNotebook) {
                    saveCurrentPage();
                }
            });

            // Save when page visibility changes (user switches tabs)
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && currentNotebook) {
                    saveCurrentPage();
                }
            });

            // Listen for toolbar re-renders (ModularToolbar)
            window.addEventListener('toolbarRendered', () => {
                rebindToolbarEvents();
            });
        }

        // Rebind toolbar-specific events (called when ModularToolbar re-renders)
        function rebindToolbarEvents() {
            // Tool buttons (pen, highlighter, eraser)
            document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => b.classList.remove('active'));
                    const shapeBtn = document.getElementById('shapeDropdownBtn');
                    if (shapeBtn) shapeBtn.classList.remove('active');
                    btn.classList.add('active');
                    currentTool = btn.dataset.tool;
                });
            });

            // Shapes dropdown
            const shapeDropdownBtn = document.getElementById('shapeDropdownBtn');
            const shapesMenu = document.getElementById('shapesMenu');

            if (shapesMenu) {
                document.querySelectorAll('.shapes-menu .tool-btn[data-shape]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                        document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        if (shapeDropdownBtn) {
                            shapeDropdownBtn.classList.add('active');
                            currentShape = btn.dataset.shape;
                            shapeDropdownBtn.innerHTML = shapeIcons[currentShape];
                            shapeDropdownBtn.dataset.tool = currentShape;
                        }
                        currentTool = currentShape;
                    });
                });
            }

            if (shapeDropdownBtn) {
                shapeDropdownBtn.addEventListener('click', (e) => {
                    if (e.target.closest('.shapes-menu')) return;
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    shapeDropdownBtn.classList.add('active');
                    document.querySelectorAll('.shapes-menu .tool-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.shape === currentShape);
                    });
                    currentTool = currentShape;
                });
            }

            // File Import
            const importFileBtn = document.getElementById('importFileBtn');
            if (importFileBtn) {
                importFileBtn.addEventListener('click', () => {
                    document.getElementById('fileInput').click();
                });
            }

            // Handwritten Text
            const handwrittenTextBtn = document.getElementById('handwrittenTextBtn');
            if (handwrittenTextBtn) {
                handwrittenTextBtn.addEventListener('click', () => {
                    if (typeof HandwrittenTextTool !== 'undefined') {
                        HandwrittenTextTool.activate();
                    }
                });
            }

            // Simple Text
            const simpleTextBtn = document.getElementById('simpleTextBtn');
            if (simpleTextBtn) {
                simpleTextBtn.addEventListener('click', () => {
                    if (typeof SimpleTextTool !== 'undefined') {
                        SimpleTextTool.activate();
                    }
                });
            }

            // Pipette
            const pipetteBtn = document.getElementById('pipetteBtn');
            if (pipetteBtn) {
                pipetteBtn.addEventListener('click', activatePipette);
            }

            // Add color to palette
            const addColorBtn = document.getElementById('addColorBtn');
            if (addColorBtn) {
                addColorBtn.addEventListener('click', () => window.PaletteWorkbench?.open());
            }

            // Color pickers
            const colorPicker = document.getElementById('colorPicker');
            if (colorPicker) {
                colorPicker.addEventListener('input', (e) => {
                    setColor(e.target.value);
                    if (typeof hpPenColors !== 'undefined') {
                        hpPenColors.primary = e.target.value;
                    }
                });
            }

            const secondaryColorPicker = document.getElementById('secondaryColorPicker');
            if (secondaryColorPicker) {
                secondaryColorPicker.addEventListener('input', (e) => {
                    if (typeof setHPPenSecondaryColor === 'function') {
                        setHPPenSecondaryColor(e.target.value);
                    }
                    updateColorSwapUI();
                });
            }

            // Color swatches
            const primarySwatch = document.getElementById('primaryColorSwatch');
            if (primarySwatch) {
                primarySwatch.addEventListener('click', () => {
                    document.getElementById('colorPicker').click();
                });
            }

            const secondarySwatch = document.getElementById('secondaryColorSwatch');
            if (secondarySwatch) {
                secondarySwatch.addEventListener('click', () => {
                    document.getElementById('secondaryColorPicker').click();
                });
            }

            // Color swap
            const colorSwapBtn = document.getElementById('colorSwapBtn');
            if (colorSwapBtn) {
                colorSwapBtn.addEventListener('click', () => {
                    if (typeof swapHPPenColors === 'function') {
                        swapHPPenColors();
                        updateColorSwapUI();
                    }
                });
            }

            // Size slider
            const sizeSlider = document.getElementById('sizeSlider');
            if (sizeSlider && !sizeSlider.dataset.sizeListenerBound) {
                sizeSlider.dataset.sizeListenerBound='true';
                sizeSlider.addEventListener('input', () => {
                    currentSize = parseFloat(sizeSlider.value);
                    baseBrushSize = currentSize;
                    const displayValue = currentSize < 10 ? currentSize.toFixed(1) : Math.round(currentSize);
                    document.getElementById('sizeValue').textContent = displayValue + 'px';
                });
            }

            // Dynamic brush toggle
            const dynamicBrushToggle = document.getElementById('dynamicBrushToggle');
            if (dynamicBrushToggle) {
                dynamicBrushEnabled = settings.dynamicBrushEnabled || false;
                dynamicBrushToggle.checked = dynamicBrushEnabled;
                if (!dynamicBrushToggle.dataset.pressureListenerBound) {
                    dynamicBrushToggle.dataset.pressureListenerBound='true';
                    dynamicBrushToggle.addEventListener('change', (e) => {
                        dynamicBrushEnabled = e.target.checked;
                        settings.dynamicBrushEnabled = dynamicBrushEnabled;
                        saveSettings();
                    });
                }
            }

            // Finger drawing toggle
            const fingerDrawBtn = document.getElementById('fingerDrawBtn');
            if (fingerDrawBtn) {
                fingerDrawBtn.classList.toggle('active', fingerDrawingEnabled);
                fingerDrawBtn.addEventListener('click', () => {
                    fingerDrawingEnabled = !fingerDrawingEnabled;
                    fingerDrawBtn.classList.toggle('active', fingerDrawingEnabled);
                    settings.fingerDrawing = fingerDrawingEnabled;
                    saveSettings();
                    showToast(fingerDrawingEnabled ? 'Finger drawing enabled' : 'Finger drawing disabled', 'info');
                });
            }

            // Eraser modes
            document.querySelectorAll('.eraser-mode').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.eraser-mode').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    eraserMode = btn.dataset.mode;
                    currentTool = 'eraser';
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
                        b.classList.toggle('active', b.dataset.tool === 'eraser');
                    });
                });
            });

            // Theme toggle
            const themeToggleBtn = document.getElementById('themeToggleBtn');
            if (themeToggleBtn) {
                themeToggleBtn.addEventListener('click', () => {
                    toggleTheme();
                    updateThemeIcon();
                });
            }

            // Undo/Redo
            const undoBtn = document.getElementById('undoBtn');
            const redoBtn = document.getElementById('redoBtn');
            if (undoBtn) undoBtn.addEventListener('click', undo);
            if (redoBtn) redoBtn.addEventListener('click', redo);

            // Zoom reset
            const zoomValue = document.getElementById('zoomValue');
            if (zoomValue) {
                zoomValue.addEventListener('click', () => {
                    zoom = 1;
                    panX = 0;
                    panY = 0;
                    document.getElementById('zoomValue').textContent = '100%';
                    redrawCanvas(true);
                });
            }

            // Settings
            const settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) {
                settingsBtn.addEventListener('click', openSettingsModal);
            }

            // Font trainer
            const fontTrainerBtn = document.getElementById('fontTrainerBtn');
            if (fontTrainerBtn) {
                fontTrainerBtn.addEventListener('click', () => {
                    if (typeof FontTrainer !== 'undefined') {
                        FontTrainer.open();
                    }
                });
            }

            const fontbookAddPageBtn = document.getElementById('fontbookAddPageBtn');
            if (fontbookAddPageBtn) {
                fontbookAddPageBtn.addEventListener('click', () => {
                    if (typeof FontBook !== 'undefined' && FontBook.isFontBook && FontBook.isFontBook()) {
                        const name = prompt('Name this font variation (optional):', `Font ${pages.length + 1}`);
                        FontBook.addFontPage(name && name.trim() ? name.trim() : undefined);
                    } else {
                        showToast('Open the Fontbook to add a font page', 'info');
                    }
                });
            }

            // Fullscreen
            const fullscreenBtn = document.getElementById('fullscreenBtn');
            if (fullscreenBtn) {
                fullscreenBtn.addEventListener('click', () => {
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen().catch(() => {});
                    } else {
                        document.exitFullscreen();
                    }
                });
            }

            // File input for image import
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const img = new Image();
                            img.onload = () => {
                                let w = img.width;
                                let h = img.height;
                                const maxSize = 500;
                                if (w > maxSize || h > maxSize) {
                                    const ratio = Math.min(maxSize / w, maxSize / h);
                                    w *= ratio;
                                    h *= ratio;
                                }

                                const center = getCanvasCenter();

                                if (!images) images = [];
                                const newImage = {
                                    id: Date.now().toString(),
                                    dataUrl: event.target.result,
                                    x: center.x - w / 2,
                                    y: center.y - h / 2,
                                    width: w,
                                    height: h,
                                    rotation: 0
                                };
                                images.push(newImage);

                                historyStack.push({
                                    type: 'image-add',
                                    image: structuredClone(newImage)
                                });
                                redoStack.length = 0;

                                redrawCanvas();
                                saveCurrentPage();
                                showToast('Image imported', 'success');
                                e.target.value = '';
                            };
                            img.src = event.target.result;
                        };
                        reader.readAsDataURL(file);
                    }
                });
            }

            // Update color UI
            updateColorSwapUI();
            renderPalette();
        }

        let lastPhoneScanId = 0;
        let phoneScanEventSource = null;
        let pendingScanPlaceholder = null;
        let lastInsertedScanId = 0;  // Track which scan ID was already inserted

        function setupPhoneScanListener() {
            if (window.phoneScanListenerInitialized) return;
            window.phoneScanListenerInitialized = true;

            if (!!window.EventSource) {
                phoneScanEventSource = new EventSource('/api/scan/stream');
                phoneScanEventSource.addEventListener('scan', async (event) => {
                    try {
                        const payload = JSON.parse(event.data);

                        // New scan ID - show placeholder
                        if (payload.id && payload.id !== lastPhoneScanId) {
                            lastPhoneScanId = payload.id;

                            // Show placeholder immediately with dimensions
                            if (payload.width && payload.height && !payload.ready) {
                                const isPending = payload.pending === true;
                                const progress = payload.progress || 0;
                                showScanPlaceholder(payload.width, payload.height, payload.id, isPending, progress);
                            }

                            // If ready immediately (no placeholder phase), insert directly
                            if (payload.ready && payload.id !== lastInsertedScanId) {
                                await fetchLatestPhoneScan(payload.id);
                            }
                        } else if (payload.id === lastPhoneScanId) {
                            // Same ID - update progress or fetch if ready
                            if (pendingScanPlaceholder && pendingScanPlaceholder.scanId === payload.id) {
                                pendingScanPlaceholder.progress = payload.progress || 0;
                                pendingScanPlaceholder.isPending = payload.pending === true;
                                redrawCanvas();
                            }
                            // Fetch when ready and not already inserted
                            if (payload.ready && payload.id !== lastInsertedScanId) {
                                await fetchLatestPhoneScan(payload.id);
                            }
                        }
                    } catch (err) {
                        console.warn('[PhoneScan] SSE parse error', err);
                    }
                });
                phoneScanEventSource.onerror = () => {
                    console.warn('[PhoneScan] SSE connection lost, falling back to polling');
                    if (phoneScanEventSource) {
                        phoneScanEventSource.close();
                        phoneScanEventSource = null;
                    }
                    startPhoneScanPolling();
                };
            } else {
                startPhoneScanPolling();
            }
        }

        function startPhoneScanPolling() {
            if (window.phoneScanPollingStarted) return;
            window.phoneScanPollingStarted = true;

            // Poll status endpoint which includes pending state (managed for cleanup)
            createManagedInterval(async () => {
                try {
                    const res = await fetch('/api/scan/status');
                    if (!res.ok) return;
                    const status = await res.json();

                    if (!status.id || status.id === 0) return;

                    // New scan detected
                    if (status.id !== lastPhoneScanId) {
                        lastPhoneScanId = status.id;

                        // Show placeholder if pending and not ready
                        if (status.pending && !status.ready && status.width && status.height) {
                            showScanPlaceholder(status.width, status.height, status.id, true, status.progress || 0);
                        }

                        // Fetch image if ready and not already inserted
                        if (status.ready && status.id !== lastInsertedScanId) {
                            await fetchLatestPhoneScan(status.id);
                        }
                    } else {
                        // Same ID - update placeholder progress or fetch if newly ready
                        if (pendingScanPlaceholder && pendingScanPlaceholder.scanId === status.id) {
                            pendingScanPlaceholder.progress = status.progress || 0;
                            pendingScanPlaceholder.isPending = status.pending;
                            redrawCanvas();
                        }

                        if (status.ready && status.id !== lastInsertedScanId) {
                            await fetchLatestPhoneScan(status.id);
                        }
                    }
                } catch (err) {
                    // Silently ignore polling errors
                }
            }, 1000);  // Poll every 1 second for better responsiveness
        }

        // Show a loading placeholder immediately with correct aspect ratio
        function showScanPlaceholder(width, height, scanId, isPending, progress = 0) {
            // If we already have a placeholder for this scan, just update its state (find in images array)
            const existingIndex = images ? images.findIndex(img => img.isPlaceholder && img.scanId === scanId) : -1;
            if (existingIndex >= 0) {
                // Update the ACTUAL object in the images array, not a potentially stale reference
                images[existingIndex].isPending = isPending;
                images[existingIndex].progress = progress;
                pendingScanPlaceholder = images[existingIndex]; // Keep reference in sync
                redrawCanvas();
                return;
            }

            let w = width;
            let h = height;
            const maxSize = 1200;
            if (w > maxSize || h > maxSize) {
                const ratio = Math.min(maxSize / w, maxSize / h);
                w *= ratio;
                h *= ratio;
            }

            const center = getCanvasCenter();

            if (!images) images = [];

            // Create placeholder object
            pendingScanPlaceholder = {
                id: 'scan-placeholder-' + scanId,
                scanId: scanId,
                isPlaceholder: true,
                isPending: isPending,  // true = uploading, false = processing on server
                progress: progress,    // Upload progress 0-100
                x: center.x - w / 2,
                y: center.y - h / 2,
                width: w,
                height: h,
                rotation: 0
            };

            images.push(pendingScanPlaceholder);
            redrawCanvas();
            showToast(isPending ? 'Uploading from phone...' : 'Processing scan...', 'info');
        }

        async function fetchLatestPhoneScan(expectedId) {
            try {
                const res = await fetch('/api/scan/latest');
                if (!res.ok) return;
                const data = await res.json();

                // Guard against duplicate inserts
                if (data.id === lastInsertedScanId) {
                    return;
                }

                // If we expected a specific ID, verify it matches
                if (expectedId && data.id !== expectedId) {
                    return;
                }

                // Support both imageUrl (new fast path) and dataUrl (legacy)
                const imageSource = data.imageUrl || data.dataUrl;
                if (imageSource) {
                    lastInsertedScanId = data.id;  // Mark as inserted BEFORE inserting
                    insertScannedImage(imageSource, data.width, data.height, data.id);
                }
            } catch (err) {
                console.warn('[PhoneScan] fetch error', err);
            }
        }

        function insertScannedImage(dataUrl, serverWidth, serverHeight, scanId) {
            const img = new Image();
            img.onload = () => {
                // Default dimensions from server
                let w = serverWidth || img.width;
                let h = serverHeight || img.height;
                const maxSize = 1200;
                if (w > maxSize || h > maxSize) {
                    const ratio = Math.min(maxSize / w, maxSize / h);
                    w *= ratio;
                    h *= ratio;
                }

                // Find placeholder in images array - search by isPlaceholder flag
                let finalX, finalY, finalW, finalH, finalRotation = 0;
                let placeholderFound = false;

                // First try to find by scanId
                let placeholderIndex = images.findIndex(img => img.isPlaceholder && img.scanId === scanId);

                // If not found by scanId, try to find any placeholder (fallback)
                if (placeholderIndex < 0) {
                    placeholderIndex = images.findIndex(img => img.isPlaceholder);
                }

                if (placeholderIndex >= 0) {
                    const ph = images[placeholderIndex];
                    placeholderFound = true;

                    // Inherit EXACT position, size and rotation from placeholder (current values from images array)
                    finalX = ph.x;
                    finalY = ph.y;
                    finalW = ph.width;
                    finalH = ph.height;
                    finalRotation = ph.rotation || 0;

                    // Clear selectedImage if it was the placeholder
                    if (typeof selectedImage !== 'undefined' && selectedImage && selectedImage.id === ph.id) {
                        if (typeof deselectImage === 'function') {
                            deselectImage();
                        } else {
                            selectedImage = null;
                        }
                    }

                    // Remove the placeholder from images array
                    images.splice(placeholderIndex, 1);
                }

                // If no placeholder found, center on screen with default size
                if (!placeholderFound) {
                    const center = getCanvasCenter();
                    finalX = center.x - w / 2;
                    finalY = center.y - h / 2;
                    finalW = w;
                    finalH = h;
                    finalRotation = 0;
                }

                if (!images) images = [];

                // Insert image with placeholder's exact transforms
                const newImage = {
                    id: Date.now().toString(),
                    dataUrl: dataUrl,
                    x: finalX,
                    y: finalY,
                    width: finalW,
                    height: finalH,
                    rotation: finalRotation
                };
                images.push(newImage);

                // Push to history for undo
                historyStack.push({
                    type: 'image-add',
                    image: structuredClone(newImage)
                });
                redoStack.length = 0;

                // Clear the reference
                pendingScanPlaceholder = null;

                redrawCanvas();
                saveCurrentPage();
                showToast('Phone scan imported', 'success');
            };
            img.src = dataUrl;
        }
