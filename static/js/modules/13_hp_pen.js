// ============== HP Pen Handler ==============
// Features:
// - Eraser button (button 32) -> Configurable action
// - Barrel button (button 2) -> Configurable action
// - Pressure-based eraser size -> Eraser scales with pen pressure

// HP Pen State
let hpPenColors = {
    primary: '#ffffff',
    secondary: '#ff4444'
};

let hpPenState = {
    previousTool: null,
    previousColor: null,
    previousSize: null,
    isUsingSecondaryColor: false,
    isUsingEraser: false,
    isAdjustingBrushSize: false,
    brushSizeAdjustStartX: 0,
    brushSizeAdjustStartY: 0,
    brushSizeAdjustStartCanvasX: 0,
    brushSizeAdjustStartCanvasY: 0,
    brushSizeAdjustStartSize: 0,
    brushSizeAdjustDirX: 0,
    brushSizeAdjustDirY: 0,
    brushSizeAdjustDirReady: false,
    // Track active button holds
    eraserButtonHeld: false,
    barrelButtonHeld: false,
    // Button modes: 'eraser', 'color', 'lasso', 'radial', 'undo', 'redo', 'highlighter', 'none'
    eraserButtonMode: 'lasso',
    barrelButtonMode: 'color'
};

const HP_PEN_BRUSH_SIZE_SENSITIVITY = 0.03; // size units per pixel dragged
let hpPenHardwareButtons = null;
let hpPenLastPointer = null;
function selectHPPenTool(tool) {
    currentTool=tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(button=>button.classList.toggle('active',button.dataset.tool===tool));
    if(typeof updateCanvasToolCursor==='function')updateCanvasToolCursor();
}
function updateHPPenHardwareButtons(packet) {
    hpPenHardwareButtons={primary:packet.primary===true,secondary:packet.secondary===true};
    const point=hpPenLastPointer||{pointerType:'pen',clientX:innerWidth/2,clientY:innerHeight/2,buttons:0,pressure:0};
    handleHPPenMove(point);
}
function resetHPPenHardwareButtons() {
    hpPenHardwareButtons=null;
    handleHPPenUp({pointerType:'pen',buttons:0,pressure:0,type:'pointercancel'});
}
for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>{
    if(isPenPointerEvent(e))hpPenLastPointer={pointerType:e.pointerType,pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,buttons:e.buttons,button:e.button,pressure:e.pressure,type:e.type};
},{capture:true,passive:true});

function isPenPointerEvent(e) {
    return e?.pointerType === 'pen' || e?.pointerType === 'eraser';
}
function isPenTipContact(e) {
    const hardware=window.badnotesDirectState?.().penContact;
    return hardware===true||!!(e?.buttons&1)||e?.pressure>0;
}

function isPenBarrelPressed(e) {
    if(hpPenHardwareButtons)return hpPenHardwareButtons.primary;
    return !!((e?.buttons & 2) || (e?.type === 'pointerdown' && e?.button === 2));
}

function isPenEraserPressed(e) {
    if(hpPenHardwareButtons)return hpPenHardwareButtons.secondary;
    const eraserEndContact = e?.pointerType === 'eraser' && (e?.type === 'pointerdown' || !!(e?.buttons & 1));
    return eraserEndContact || !!((e?.buttons & 36) || (e?.type === 'pointerdown' && [1,5].includes(e?.button)));
}

let hpPenPreviewCanvas = null;
let hpPenPreviewCtx = null;

function ensureHPPenPreviewCanvas() {
    if (hpPenPreviewCanvas && hpPenPreviewCtx) return;
    const container = document.getElementById('canvasContainer');
    if (!container || !canvas) return;
    hpPenPreviewCanvas = document.createElement('canvas');
    hpPenPreviewCanvas.id = 'hpPenPreviewCanvas';
    hpPenPreviewCanvas.style.position = 'absolute';
    hpPenPreviewCanvas.style.left = '0';
    hpPenPreviewCanvas.style.top = '0';
    hpPenPreviewCanvas.style.width = '100%';
    hpPenPreviewCanvas.style.height = '100%';
    hpPenPreviewCanvas.style.pointerEvents = 'none';
    hpPenPreviewCanvas.style.zIndex = '6';
    container.appendChild(hpPenPreviewCanvas);
    hpPenPreviewCtx = hpPenPreviewCanvas.getContext('2d');
}

function resizeHPPenPreviewCanvas() {
    if (!hpPenPreviewCanvas || !hpPenPreviewCtx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    hpPenPreviewCanvas.width = rect.width * dpr;
    hpPenPreviewCanvas.height = rect.height * dpr;
    hpPenPreviewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearHPPenPreview() {
    if (!hpPenPreviewCtx || !hpPenPreviewCanvas) return;
    hpPenPreviewCtx.setTransform(1, 0, 0, 1, 0, 0);
    hpPenPreviewCtx.clearRect(0, 0, hpPenPreviewCanvas.width, hpPenPreviewCanvas.height);
}

function drawHPPenSizePreview(x, y, size) {
    if (!hpPenPreviewCtx) return;
    const zoomFactor = (typeof zoom !== 'undefined' && zoom) ? zoom : 1;
    const radius = Math.max(0.5, (size * zoomFactor) / 2);
    hpPenPreviewCtx.save();
    hpPenPreviewCtx.beginPath();
    hpPenPreviewCtx.arc(x, y, radius, 0, Math.PI * 2);
    hpPenPreviewCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    hpPenPreviewCtx.fill();
    hpPenPreviewCtx.lineWidth = 1.5;
    hpPenPreviewCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    hpPenPreviewCtx.stroke();
    hpPenPreviewCtx.lineWidth = 1;
    hpPenPreviewCtx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    hpPenPreviewCtx.stroke();
    hpPenPreviewCtx.restore();
}

// Load saved settings
(function loadHPPenSettings() {
    const savedSecondary = localStorage.getItem('hp_pen_secondary_color');
    if (savedSecondary) {
        hpPenColors.secondary = savedSecondary;
    }
    const savedBarrelMode = localStorage.getItem('hp_pen_barrel_mode');
    if (savedBarrelMode) {
        hpPenState.barrelButtonMode = savedBarrelMode;
    }
    const savedEraserMode = localStorage.getItem('hp_pen_eraser_mode');
    if (savedEraserMode) {
        hpPenState.eraserButtonMode = savedEraserMode;
    }
})();

/**
 * Execute action based on mode
 */
function executeButtonAction(mode, e, isStart) {
    if (isStart) {
        // Button pressed - start action
        switch (mode) {
            case 'eraser':
                activateHPPenEraser();
                break;
            case 'color':
                activateSecondaryColor();
                break;
            case 'lasso':
                // The side button can be pressed while hovering. Arm the tool
                // now; actual tip contact starts selection in the canvas router.
                if(isDrawing)stopDrawing();
                hpPenState.previousLassoTool=currentTool;
                selectHPPenTool('lasso');
                break;
            case 'radial':
                if (typeof openRadialMenu === 'function') openRadialMenu(e.clientX, e.clientY);
                break;
            case 'undo':
                if (typeof undo === 'function') undo();
                break;
            case 'redo':
                if (typeof redo === 'function') redo();
                break;
            case 'highlighter':
                activateHighlighter();
                break;
            case 'size':
                startBrushSizeAdjust(e);
                break;
            case 'none':
            default:
                break;
        }
    } else {
        // Button released - end action
        switch (mode) {
            case 'eraser':
                deactivateHPPenEraser();
                break;
            case 'color':
                deactivateSecondaryColor();
                break;
            case 'lasso':
                if (typeof endLasso === 'function' && typeof lassoMode !== 'undefined' && lassoMode) {
                    endLasso();
                }
                else if(typeof handleLassoPointerUp==='function')handleLassoPointerUp(e);
                selectHPPenTool(hpPenState.previousLassoTool||'pen');
                hpPenState.previousLassoTool=null;
                if(typeof updateCanvasToolCursor==='function')updateCanvasToolCursor();
                break;
            case 'radial':
                // Select hovered slice and close menu on button release
                if (typeof selectRadialMenuSlice === 'function') selectRadialMenuSlice();
                break;
            case 'highlighter':
                deactivateHighlighter();
                break;
            case 'size':
                stopBrushSizeAdjust();
                break;
            case 'undo':
            case 'redo':
            case 'none':
            default:
                break;
        }
    }
}

/**
 * Handle HP Pen button states on pointer down
 */
function handleHPPenDown(e) {
    if (!isPenPointerEvent(e)) return;

    // Linux tablet stacks can expose the pen's eraser end as pointerType
    // "eraser" and may report a side-button press only in PointerEvent.button.
    const isEraserButton = isPenEraserPressed(e);
    const isBarrelButton = isPenBarrelPressed(e);

    // Handle eraser button
    if (isEraserButton && !hpPenState.eraserButtonHeld) {
        executeButtonAction(hpPenState.eraserButtonMode, e, true);
        hpPenState.eraserButtonHeld = true;
    } else if (!isEraserButton && hpPenState.eraserButtonHeld) {
        executeButtonAction(hpPenState.eraserButtonMode, e, false);
        hpPenState.eraserButtonHeld = false;
    }

    // Handle barrel button
    if (isBarrelButton && !hpPenState.barrelButtonHeld) {
        executeButtonAction(hpPenState.barrelButtonMode, e, true);
        hpPenState.barrelButtonHeld = true;
    } else if (!isBarrelButton && hpPenState.barrelButtonHeld) {
        executeButtonAction(hpPenState.barrelButtonMode, e, false);
        hpPenState.barrelButtonHeld = false;
    }
}

/**
 * Handle HP Pen button states on pointer move
 */
function handleHPPenMove(e) {
    if (!isPenPointerEvent(e) && !hpPenState.barrelButtonHeld && !hpPenState.eraserButtonHeld) return;

    const isEraserButton = isPenEraserPressed(e);
    const isBarrelButton = isPenBarrelPressed(e);

    // Handle eraser button HOLD
    if (isEraserButton && !hpPenState.eraserButtonHeld) {
        executeButtonAction(hpPenState.eraserButtonMode, e, true);
        hpPenState.eraserButtonHeld = true;
    } else if (!isEraserButton && hpPenState.eraserButtonHeld) {
        executeButtonAction(hpPenState.eraserButtonMode, e, false);
        hpPenState.eraserButtonHeld = false;
    }

    // Handle barrel button HOLD
    if (isBarrelButton && !hpPenState.barrelButtonHeld) {
        executeButtonAction(hpPenState.barrelButtonMode, e, true);
        hpPenState.barrelButtonHeld = true;
    } else if (!isBarrelButton && hpPenState.barrelButtonHeld) {
        executeButtonAction(hpPenState.barrelButtonMode, e, false);
        hpPenState.barrelButtonHeld = false;
    }

    // Continue lasso path if in lasso mode (for either button)
    if (typeof lassoMode !== 'undefined' && lassoMode && isPenTipContact(e)) {
        if (typeof continueLasso === 'function') {
            continueLasso(e);
        }
    }

    // Update radial menu hover if open (for hold-to-select behavior)
    if (typeof isRadialMenuOpen === 'function' && isRadialMenuOpen()) {
        if (typeof updateRadialMenuHover === 'function') {
            updateRadialMenuHover(e.clientX, e.clientY);
        }
    }

    // Brush size adjust when barrel/eraser mode is set to size
    if (hpPenState.isAdjustingBrushSize) {
        updateBrushSizeAdjust(e);
    }
}

/**
 * Handle HP Pen button states on pointer up
 */
function handleHPPenUp(e) {
    if (!isPenPointerEvent(e) && !hpPenState.barrelButtonHeld && !hpPenState.eraserButtonHeld) return;

    // Release held buttons on pen up
    if (hpPenState.eraserButtonHeld && (e.type==='pointercancel'||!isPenEraserPressed(e))) {
        executeButtonAction(hpPenState.eraserButtonMode, e, false);
        hpPenState.eraserButtonHeld = false;
    }

    if (hpPenState.barrelButtonHeld && (e.type==='pointercancel'||!isPenBarrelPressed(e))) {
        executeButtonAction(hpPenState.barrelButtonMode, e, false);
        hpPenState.barrelButtonHeld = false;
    }
}

/**
 * Start brush size adjustment (Photoshop-style drag)
 */
function startBrushSizeAdjust(e) {
    if (hpPenState.isAdjustingBrushSize) return;
    hpPenState.isAdjustingBrushSize = true;
    hpPenState.brushSizeAdjustStartX = e.clientX;
    hpPenState.brushSizeAdjustStartY = e.clientY;
    hpPenState.brushSizeAdjustStartSize = currentSize;
    hpPenState.brushSizeAdjustDirX = 0;
    hpPenState.brushSizeAdjustDirY = 0;
    hpPenState.brushSizeAdjustDirReady = false;
    if (canvas) {
        const rect = canvas.getBoundingClientRect();
        hpPenState.brushSizeAdjustStartCanvasX = e.clientX - rect.left;
        hpPenState.brushSizeAdjustStartCanvasY = e.clientY - rect.top;
    }
    ensureHPPenPreviewCanvas();
    resizeHPPenPreviewCanvas();
    updateBrushSizeAdjust(e);
}

/**
 * Update brush size while dragging
 */
function updateBrushSizeAdjust(e) {
    const sizeSlider = document.getElementById('sizeSlider');
    const sizeValue = document.getElementById('sizeValue');
    const minSize = sizeSlider ? parseFloat(sizeSlider.min) : 0.5;
    const maxSize = sizeSlider ? parseFloat(sizeSlider.max) : 10;
    const deltaX = e.clientX - hpPenState.brushSizeAdjustStartX;
    const deltaY = e.clientY - hpPenState.brushSizeAdjustStartY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!hpPenState.brushSizeAdjustDirReady && distance > 4) {
        hpPenState.brushSizeAdjustDirX = deltaX / distance;
        hpPenState.brushSizeAdjustDirY = deltaY / distance;
        hpPenState.brushSizeAdjustDirReady = true;
    }
    const signedDistance = hpPenState.brushSizeAdjustDirReady
        ? (deltaX * hpPenState.brushSizeAdjustDirX + deltaY * hpPenState.brushSizeAdjustDirY)
        : 0;
    const rawSize = hpPenState.brushSizeAdjustStartSize + (signedDistance * HP_PEN_BRUSH_SIZE_SENSITIVITY);
    const clampedSize = Math.max(minSize, Math.min(maxSize, rawSize));
    currentSize = clampedSize;
    baseBrushSize = currentSize;

    if (sizeSlider) sizeSlider.value = currentSize;
    if (sizeValue) {
        const displayValue = currentSize < 10 ? currentSize.toFixed(1) : Math.round(currentSize);
        sizeValue.textContent = displayValue + 'px';
    }

    if (hpPenPreviewCanvas && hpPenPreviewCtx) {
        hpPenPreviewCtx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        hpPenPreviewCtx.clearRect(0, 0, hpPenPreviewCanvas.width, hpPenPreviewCanvas.height);
        drawHPPenSizePreview(hpPenState.brushSizeAdjustStartCanvasX, hpPenState.brushSizeAdjustStartCanvasY, currentSize);
    }
}

/**
 * Stop brush size adjustment
 */
function stopBrushSizeAdjust() {
    hpPenState.isAdjustingBrushSize = false;
    clearHPPenPreview();
}

/**
 * Check if HP pen is adjusting brush size
 */
function isHPPenSizeAdjusting() {
    return hpPenState.isAdjustingBrushSize === true;
}

/**
 * Activate eraser tool (HOLD behavior)
 */
function activateHPPenEraser() {
    if (hpPenState.isUsingEraser) return; // Already active

    // Store current tool
    hpPenState.previousTool = currentTool;

    // Switch to eraser
    currentTool = 'eraser';
    hpPenState.isUsingEraser = true;

    // Update UI
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === 'eraser');
    });
}

/**
 * Deactivate eraser tool (release from HOLD)
 */
function deactivateHPPenEraser() {
    if (!hpPenState.isUsingEraser) return; // Not active

    // Restore previous tool
    currentTool = hpPenState.previousTool || 'pen';
    hpPenState.previousTool = null;
    hpPenState.isUsingEraser = false;

    // Update UI
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === currentTool);
    });
}

/**
 * Activate secondary color (HOLD behavior)
 */
function activateSecondaryColor() {
    if (hpPenState.isUsingSecondaryColor) return; // Already active

    // Save current color as primary (only if not already secondary)
    if (currentColor !== hpPenColors.secondary) {
        hpPenColors.primary = currentColor;
    }

    // Switch to secondary
    setColor(hpPenColors.secondary, true);
    hpPenState.isUsingSecondaryColor = true;
}

/**
 * Deactivate secondary color (release from HOLD)
 */
function deactivateSecondaryColor() {
    if (!hpPenState.isUsingSecondaryColor) return; // Not active

    // Switch back to primary
    setColor(hpPenColors.primary, false);
    hpPenState.isUsingSecondaryColor = false;
}

/**
 * Activate highlighter tool (HOLD behavior)
 */
function activateHighlighter() {
    if (currentTool === 'highlighter') return; // Already active

    // Store current tool
    hpPenState.previousTool = currentTool;

    // Switch to highlighter
    currentTool = 'highlighter';

    // Update UI
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === 'highlighter');
    });
}

/**
 * Deactivate highlighter tool (release from HOLD)
 */
function deactivateHighlighter() {
    if (currentTool !== 'highlighter') return;

    // Restore previous tool
    currentTool = hpPenState.previousTool || 'pen';

    // Update UI
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === currentTool);
    });
}

/**
 * Legacy: Toggle eraser (for UI button clicks)
 */
function toggleHPPenEraser() {
    if (hpPenState.isUsingEraser) {
        deactivateHPPenEraser();
    } else {
        activateHPPenEraser();
    }
}

/**
 * Legacy: Toggle secondary color (for UI button clicks)
 */
function toggleSecondaryColor() {
    if (hpPenState.isUsingSecondaryColor) {
        deactivateSecondaryColor();
    } else {
        activateSecondaryColor();
    }
}

/**
 * Legacy: Restore previous tool (kept for compatibility)
 */
function restoreHPPenPreviousTool() {
    deactivateHPPenEraser();
}

/**
 * Legacy: Swap to secondary color (kept for compatibility)
 */
function swapToSecondaryColor() {
    activateSecondaryColor();
}

/**
 * Legacy: Swap back to primary color (kept for compatibility)
 */
function swapToPrimaryColor() {
    deactivateSecondaryColor();
}

/**
 * Handle pressure-based selection mode during move
 */
function handlePressureSelectionMove(e) {
    const pressure = e.pressure || 0;

    // Check if pressure threshold reached
    if (pressure >= pressureSelection.threshold) {
        if (pressureSelection.startTime > 0) {
            const heldTime = Date.now() - pressureSelection.startTime;

            if (heldTime >= pressureSelection.activationDelay && !pressureSelection.isActive) {
                startPressureSelection(e);
            }
        }

        // If selection mode active, add to path
        if (pressureSelection.isActive) {
            addToPressureSelectionPath(e);
        }
    } else if (pressureSelection.isActive) {
        // Continue selection even with lower pressure once activated
        addToPressureSelectionPath(e);
    }
}

/**
 * Start pressure selection mode
 */
function startPressureSelection(e) {
    // Store current tool
    hpPenState.previousTool = currentTool;

    // Cancel current drawing
    if (isDrawing) {
        isDrawing = false;
        currentStroke = null;
        activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
    }

    // Get canvas coordinates
    const coords = getCanvasCoordinates(e.clientX, e.clientY);

    pressureSelection.isActive = true;
    pressureSelection.path = [{ x: coords.x, y: coords.y }];

    showToast('✂️ Selection Mode', 'info', 1500);
}

/**
 * Add point to pressure selection path
 */
function addToPressureSelectionPath(e) {
    const coords = getCanvasCoordinates(e.clientX, e.clientY);
    pressureSelection.path.push({ x: coords.x, y: coords.y });
    drawPressureSelectionPath();
}

/**
 * Draw the selection lasso path
 */
function drawPressureSelectionPath() {
    const path = pressureSelection.path;
    if (path.length < 2) return;

    // Clear active canvas and draw selection
    activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);

    activeCtx.save();

    // Apply transform
    const dpr = baseDPR;
    activeCtx.setTransform(dpr * zoom, 0, 0, dpr * zoom, panX * dpr, panY * dpr);

    // Draw dashed selection line
    activeCtx.strokeStyle = '#6c5ce7';
    activeCtx.lineWidth = 2 / zoom;
    activeCtx.setLineDash([8 / zoom, 4 / zoom]);

    activeCtx.beginPath();
    activeCtx.moveTo(path[0].x, path[0].y);

    for (let i = 1; i < path.length; i++) {
        activeCtx.lineTo(path[i].x, path[i].y);
    }

    // Draw line back to start
    if (path.length > 2) {
        activeCtx.lineTo(path[0].x, path[0].y);
    }

    activeCtx.stroke();

    // Fill with semi-transparent color
    activeCtx.fillStyle = 'rgba(108, 92, 231, 0.15)';
    activeCtx.fill();

    activeCtx.setLineDash([]);

    // Draw start point indicator
    activeCtx.fillStyle = '#6c5ce7';
    activeCtx.beginPath();
    activeCtx.arc(path[0].x, path[0].y, 6 / zoom, 0, Math.PI * 2);
    activeCtx.fill();

    activeCtx.restore();
}

/**
 * Complete pressure selection
 */
function completePressureSelection() {
    if (!pressureSelection.isActive) return;

    const path = pressureSelection.path;

    if (path.length > 3) {
        // Close the path
        path.push(path[0]);

        // Find strokes inside selection
        const selectedStrokes = findStrokesInPath(path);

        if (selectedStrokes.length > 0) {
            // Draw final selection with bounds
            drawFinalSelection(selectedStrokes);

            showToast(`✅ Selected ${selectedStrokes.length} stroke${selectedStrokes.length > 1 ? 's' : ''}`, 'success', 2000);

            // Store selection for later use (move, delete, etc.)
            window.currentSelection = {
                strokes: selectedStrokes,
                bounds: calculateSelectionBounds(selectedStrokes)
            };
        } else {
            activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
            showToast('No strokes in selection', 'info', 1500);
        }
    } else {
        activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
    }

    // Reset state
    pressureSelection.isActive = false;
    pressureSelection.path = [];

    // Restore previous tool
    if (hpPenState.previousTool) {
        currentTool = hpPenState.previousTool;
        hpPenState.previousTool = null;
    }
}

/**
 * Find strokes inside the selection path
 */
function findStrokesInPath(path) {
    const selected = [];

    for (const stroke of strokes) {
        if (isStrokeInPath(stroke, path)) {
            selected.push(stroke);
        }
    }

    return selected;
}

/**
 * Check if stroke is inside path
 */
function isStrokeInPath(stroke, path) {
    if (!stroke.points || stroke.points.length === 0) return false;

    let insideCount = 0;
    for (const point of stroke.points) {
        if (isPointInPolygon(point.x, point.y, path)) {
            insideCount++;
        }
    }

    // If more than half the points are inside, consider it selected
    return insideCount > stroke.points.length / 2;
}

/**
 * Point in polygon test (ray casting)
 */
function isPointInPolygon(x, y, polygon) {
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
 * Calculate bounding box of selected strokes
 */
function calculateSelectionBounds(selectedStrokes) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const stroke of selectedStrokes) {
        if (stroke.points) {
            for (const point of stroke.points) {
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
        height: maxY - minY
    };
}

/**
 * Draw final selection with handles
 */
function drawFinalSelection(selectedStrokes) {
    const bounds = calculateSelectionBounds(selectedStrokes);
    if (!bounds) return;

    activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);

    activeCtx.save();

    const dpr = baseDPR;
    activeCtx.setTransform(dpr * zoom, 0, 0, dpr * zoom, panX * dpr, panY * dpr);

    const padding = 10;

    // Selection rectangle
    activeCtx.strokeStyle = '#6c5ce7';
    activeCtx.lineWidth = 2 / zoom;
    activeCtx.setLineDash([5 / zoom, 5 / zoom]);
    activeCtx.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
    );
    activeCtx.setLineDash([]);

    // Resize handles
    const handleSize = 10 / zoom;
    const handles = [
        { x: bounds.x - padding, y: bounds.y - padding },
        { x: bounds.x + bounds.width / 2, y: bounds.y - padding },
        { x: bounds.x + bounds.width + padding, y: bounds.y - padding },
        { x: bounds.x - padding, y: bounds.y + bounds.height / 2 },
        { x: bounds.x + bounds.width + padding, y: bounds.y + bounds.height / 2 },
        { x: bounds.x - padding, y: bounds.y + bounds.height + padding },
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + padding },
        { x: bounds.x + bounds.width + padding, y: bounds.y + bounds.height + padding }
    ];

    activeCtx.fillStyle = '#ffffff';
    activeCtx.strokeStyle = '#6c5ce7';
    activeCtx.lineWidth = 2 / zoom;

    for (const handle of handles) {
        activeCtx.beginPath();
        activeCtx.rect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        activeCtx.fill();
        activeCtx.stroke();
    }

    activeCtx.restore();
}

/**
 * Set HP Pen secondary color
 */
function setHPPenSecondaryColor(color) {
    hpPenColors.secondary = color;
    localStorage.setItem('hp_pen_secondary_color', color);
    if (typeof updateColorSwapUI === 'function') {
        updateColorSwapUI();
    }
}

/**
 * Swap primary and secondary colors (like pressing X in Photoshop)
 */
function swapHPPenColors() {
    const temp = hpPenColors.primary;
    hpPenColors.primary = hpPenColors.secondary;
    hpPenColors.secondary = temp;

    setColor(hpPenColors.primary);

    if (typeof updateColorSwapUI === 'function') {
        updateColorSwapUI();
    }

    showToast('🔄 Colors swapped', 'info', 800);
}

/**
 * Clear current selection
 */
function clearSelection() {
    window.currentSelection = null;
    activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
}

// Add keyboard shortcut for swapping colors (X key like Photoshop)
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (typeof HandwrittenTextField !== 'undefined' && HandwrittenTextField.hasActiveField()) return;
    if (typeof SimpleTextField !== 'undefined' && SimpleTextField.hasActiveField()) return;

    // X key to swap colors
    if (e.key === 'x' || e.key === 'X') {
        swapHPPenColors();
    }

    // Escape to clear selection
    if (e.key === 'Escape' && window.currentSelection) {
        clearSelection();
        showToast('Selection cleared', 'info', 800);
    }

    // Delete to remove selected strokes
    if ((e.key === 'Delete' || e.key === 'Backspace') && window.currentSelection) {
        const selection = window.currentSelection;

        // Remove selected strokes
        for (const stroke of selection.strokes) {
            const idx = strokes.indexOf(stroke);
            if (idx > -1) {
                strokes.splice(idx, 1);
            }
        }

        if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
        clearSelection();
        redrawCanvas();
        saveCurrentPage();
        showToast(`🗑️ Deleted ${selection.strokes.length} stroke${selection.strokes.length > 1 ? 's' : ''}`, 'info', 1500);
    }
});

/**
 * Set barrel button mode
 * @param {string} mode - 'eraser', 'color', 'lasso', 'radial', 'undo', 'redo', 'highlighter', 'size', 'none'
 */
function setBarrelButtonMode(mode) {
    const validModes = ['eraser', 'color', 'lasso', 'radial', 'undo', 'redo', 'highlighter', 'size', 'none'];
    if (!validModes.includes(mode)) {
        return;
    }
    hpPenState.barrelButtonMode = mode;
    localStorage.setItem('hp_pen_barrel_mode', mode);
}

/**
 * Get current barrel button mode
 */
function getBarrelButtonMode() {
    return hpPenState.barrelButtonMode;
}

/**
 * Set eraser button mode
 * @param {string} mode - 'eraser', 'color', 'lasso', 'radial', 'undo', 'redo', 'highlighter', 'size', 'none'
 */
function setEraserButtonMode(mode) {
    const validModes = ['eraser', 'color', 'lasso', 'radial', 'undo', 'redo', 'highlighter', 'size', 'none'];
    if (!validModes.includes(mode)) {
        return;
    }
    hpPenState.eraserButtonMode = mode;
    localStorage.setItem('hp_pen_eraser_mode', mode);
}

/**
 * Get current eraser button mode
 */
function getEraserButtonMode() {
    return hpPenState.eraserButtonMode;
}

/**
 * Get available button modes
 */
function getAvailableButtonModes() {
    return [
        { id: 'eraser', label: 'Eraser', icon: '🧹' },
        { id: 'color', label: 'Secondary Color', icon: '🎨' },
        { id: 'lasso', label: 'Lasso Select', icon: '⭕' },
        { id: 'radial', label: 'Radial Menu', icon: '☀️' },
        { id: 'undo', label: 'Undo', icon: '↩️' },
        { id: 'redo', label: 'Redo', icon: '↪️' },
        { id: 'highlighter', label: 'Highlighter', icon: '🖍️' },
        { id: 'size', label: 'Brush Size', icon: '📏' },
        { id: 'none', label: 'None', icon: '➖' }
    ];
}
