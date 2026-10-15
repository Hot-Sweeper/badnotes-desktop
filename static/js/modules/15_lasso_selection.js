// ============== Lasso Selection ==============
        // Lasso selection state
        let lassoMode = false;
        let lassoPath = []; // Points of the lasso (while drawing)
        let lassoSelection = {
            strokes: [], // Selected stroke indices
            images: [],  // Selected image IDs
            bounds: null, // Bounding box {x, y, width, height, rotation}
            originalStrokes: [], // Deep copy for transformation
            originalImages: [],  // Deep copy of images for transformation
            isDragging: false,
            isRotating: false,
            isResizing: false,
            handle: null,
            dragStart: null,
            pendingDeselect: null, // Track tap-to-deselect
            path: [] // Store the lasso path after selection completes
        };

        // Multi-selection storage for AI (Ctrl+lasso to add more)
        let multiLassoSelections = []; // Array of { path: [], bounds: {} }
        let isCtrlHeld = false; // Track Ctrl key state

        const LASSO_PRESSURE_THRESHOLD = 0.99; // Full pressure to trigger
        const LASSO_HANDLE_SIZE = 14;
        const LASSO_ROTATE_DISTANCE = 40;
        const LASSO_TAP_THRESHOLD = 10; // Max movement to count as tap

        /**
         * Check if lasso should start (full pressure on initial contact)
         */
        function shouldStartLasso(e) {
            // Only trigger on pen with high pressure at START of stroke
            if (e.pointerType !== 'pen') return false;
            if (typeof isDrawing !== 'undefined' && isDrawing) return false; // Already drawing
            return e.pressure >= LASSO_PRESSURE_THRESHOLD;
        }

        /**
         * Start lasso selection mode
         */
        function startLasso(e) {
            lassoMode = true;
            lassoSelection.pointerId=e.pointerId;
            lassoSelection.pointerType=e.pointerType;
            lassoPath = [];

            // Track Ctrl state for multi-selection
            isCtrlHeld = e.ctrlKey || e.metaKey || e.shiftKey;

            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left - panX) / zoom;
            const y = (e.clientY - rect.top - panY) / zoom;

            lassoPath.push({ x, y });

            // If Ctrl is NOT held, clear all previous selections
            // If Ctrl IS held, keep existing selections (add mode)
            if (!isCtrlHeld) {
                multiLassoSelections = [];
                clearLassoSelection();
            }

            redrawCanvas();
        }

        /**
         * Continue lasso path
         */
        function continueLasso(e) {
            if (!lassoMode) return;

            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left - panX) / zoom;
            const y = (e.clientY - rect.top - panY) / zoom;

            // Only add point if moved enough
            const last = lassoPath[lassoPath.length - 1];
            const dx = x - last.x;
            const dy = y - last.y;
            if (dx * dx + dy * dy > 4/(zoom*zoom)) {
                lassoPath.push({ x, y });
                if(window.LassoWorkbench?.rectangle)lassoPath=[lassoPath[0],{x,y:lassoPath[0].y},{x,y},{x:lassoPath[0].x,y}];
                redrawCanvas();
            }
        }

        /**
         * End lasso and select strokes
         */
        function endLasso() {
            if (!lassoMode) return;
            lassoMode = false;

            if (lassoPath.length < 3) {
                lassoPath = [];
                redrawCanvas();
                return;
            }

            // Calculate bounds for this lasso path BEFORE selecting strokes
            const pathBounds = calculatePathBounds(lassoPath);

            // Store this selection for multi-selection AI feature
            if (pathBounds) {
                multiLassoSelections.push({
                    path: [...lassoPath],
                    bounds: pathBounds
                });
                console.log(`Lasso: Added selection ${multiLassoSelections.length} (Ctrl: ${isCtrlHeld})`);
            }

            // Find strokes inside lasso (for move/transform features)
            selectStrokesInLasso();

            // Store the lasso path in the selection (keep it visible)
            lassoSelection.path = [...lassoPath];

            // Clear the active drawing path
            lassoPath = [];
            redrawCanvas();
        }

        /**
         * Check if a point is inside the lasso polygon (ray casting)
         */
        function pointInLasso(px, py) {
            if (lassoPath.length < 3) return false;

            let inside = false;
            const n = lassoPath.length;

            for (let i = 0, j = n - 1; i < n; j = i++) {
                const xi = lassoPath[i].x, yi = lassoPath[i].y;
                const xj = lassoPath[j].x, yj = lassoPath[j].y;

                if (((yi > py) !== (yj > py)) &&
                    (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        /**
         * Check if a stroke is inside the lasso (check all points)
         */
        function strokeInLasso(stroke) {
            if (!stroke.points || stroke.points.length === 0) return false;

            if(stroke.points.length===1)return pointInLasso(stroke.points[0].x,stroke.points[0].y);
            // Weight by visible path length, not sample count. Sparse vectors
            // and densely sampled handwriting must select identically.
            let covered=0,total=0;
            for(let i=1;i<stroke.points.length;i++){
                const a=stroke.points[i-1],b=stroke.points[i];if(b.break)continue;
                const length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1e-8)continue;
                const count=Math.max(2,Math.min(96,Math.ceil(length*zoom/6)));
                for(let j=0;j<count;j++){const t=(j+.5)/count;if(pointInLasso(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))covered+=length/count;}total+=length;
            }
            return total>0?covered/total>=.5:pointInLasso(stroke.points[0].x,stroke.points[0].y);
        }

        /**
         * Check if image center is inside the lasso
         */
        function imageInLasso(img) {
            // Check if image center is inside lasso
            const cx = img.x + img.width / 2;
            const cy = img.y + img.height / 2;
            return pointInLasso(cx, cy);
        }

        /**
         * Select strokes and images that are inside the lasso
         */
        function selectStrokesInLasso() {
            if (typeof strokes === 'undefined' || !strokes) return;

            const previous=isCtrlHeld?[...lassoSelection.strokes]:[];
            const previousImages=isCtrlHeld?[...lassoSelection.images]:[];
            lassoSelection.strokes = [];
            lassoSelection.originalStrokes = [];
            lassoSelection.images = [];
            lassoSelection.originalImages = [];

            // Select strokes
            for (let i = 0; i < strokes.length; i++) {
                if (previous.includes(i)||window.LassoWorkbench?.includeInk!==false&&strokeInLasso(strokes[i])) {
                    lassoSelection.strokes.push(i);
                    // Deep copy for transformation reference (structuredClone is faster)
                    lassoSelection.originalStrokes.push(structuredClone(strokes[i]));
                }
            }

            // Select images (skip placeholders and locked images)
            if (typeof images !== 'undefined' && images) {
                for (const img of images) {
                    if (img.isPlaceholder) continue; // Skip scan placeholders
                    if (img.locked) continue; // Skip locked images

                    if (previousImages.includes(img.id)||window.LassoWorkbench?.includeImages!==false&&imageInLasso(img)) {
                        lassoSelection.images.push(img.id);
                        lassoSelection.originalImages.push(structuredClone(img));
                    }
                }
            }

            const totalCount = lassoSelection.strokes.length + lassoSelection.images.length;
            if (totalCount > 0) {
                // Deselect any individually selected image (to avoid conflict)
                if (typeof selectedImage !== 'undefined' && selectedImage !== null) {
                    if (typeof deselectImage === 'function') deselectImage();
                    else selectedImage = null;
                }

                calculateSelectionBounds();
                window.LassoWorkbench?.sync();
                showToast(`Selected ${totalCount} item(s)`, 'info');
            }
        }

        /**
         * Calculate bounding box of selected strokes and images
         */
        function calculateSelectionBounds() {
            const totalCount = lassoSelection.strokes.length + lassoSelection.images.length;
            if (totalCount === 0) {
                lassoSelection.bounds = null;
                return;
            }

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            // Include strokes in bounds
            for (const idx of lassoSelection.strokes) {
                const stroke = strokes[idx];
                for (const pt of stroke.points) {
                    minX = Math.min(minX, pt.x);
                    minY = Math.min(minY, pt.y);
                    maxX = Math.max(maxX, pt.x);
                    maxY = Math.max(maxY, pt.y);
                }
            }

            // Include images in bounds
            for (const imgId of lassoSelection.images) {
                const img = images.find(i => i.id === imgId);
                if (!img) continue;

                // For simplicity, use axis-aligned bounding box even for rotated images
                // A more accurate implementation would calculate the rotated corners
                minX = Math.min(minX, img.x);
                minY = Math.min(minY, img.y);
                maxX = Math.max(maxX, img.x + img.width);
                maxY = Math.max(maxY, img.y + img.height);
            }

            const pad=8/zoom;
            minX-=pad;minY-=pad;maxX+=pad;maxY+=pad;
            if(maxX-minX<32/zoom){const center=(minX+maxX)/2;minX=center-16/zoom;maxX=center+16/zoom;}
            if(maxY-minY<32/zoom){const center=(minY+maxY)/2;minY=center-16/zoom;maxY=center+16/zoom;}
            lassoSelection.bounds = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                rotation: 0,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2
            };
        }

        /**
         * Clear lasso selection
         */
        function clearLassoSelection() {
            lassoSelection.strokes = [];
            lassoSelection.originalStrokes = [];
            lassoSelection.images = [];
            lassoSelection.originalImages = [];
            lassoSelection.bounds = null;
            lassoSelection.isDragging = false;
            lassoSelection.isRotating = false;
            lassoSelection.isResizing = false;
            lassoSelection.handle = null;
            lassoSelection.dragStart = null;
            lassoSelection.path = [];
            lassoSelection.pendingDeselect=null;
            window.LassoWorkbench?.sync();
        }

        /**
         * Get selection handle positions
         */
        function getLassoHandles() {
            if (!lassoSelection.bounds) return null;

            const b = lassoSelection.bounds;
            const cx = b.centerX;
            const cy = b.centerY;
            const hw = b.width / 2;
            const hh = b.height / 2;
            const cos = Math.cos(b.rotation);
            const sin = Math.sin(b.rotation);

            const rotate = (lx, ly) => ({
                x: cx + lx * cos - ly * sin,
                y: cy + lx * sin + ly * cos
            });

            const extension=28/zoom;
            const handles={
                nw: rotate(-hw, -hh),
                ne: rotate(hw, -hh),
                se: rotate(hw, hh),
                sw: rotate(-hw, hh),
                rotateNW: rotate(-hw-extension,-hh-extension),
                rotateNE: rotate(hw+extension,-hh-extension),
                rotateSE: rotate(hw+extension,hh+extension),
                rotateSW: rotate(-hw-extension,hh+extension)
            };
            // Preserve the public single-handle accessor without displaying a
            // second, redundant top-center knob.
            Object.defineProperty(handles,'rotate',{value:handles.rotateNE});return handles;
        }

        /**
         * Check which handle is at position
         */
        function getLassoHandleAt(canvasX, canvasY,pointerType='mouse') {
            const handles = getLassoHandles();
            if (!handles) return null;

            const threshold = (pointerType==='touch'?16:11) / zoom;

            for (const [name, pos] of Object.entries(handles)) {
                const dx = canvasX - pos.x;
                const dy = canvasY - pos.y;
                const hitRadius=name.startsWith('rotate')?(pointerType==='touch'?22:14)/zoom:threshold;
                if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
                    return name;
                }
            }
            return null;
        }

        /**
         * Check if point is inside selection bounds
         */
        function pointInSelectionBounds(px, py) {
            if (!lassoSelection.bounds) return false;

            const b = lassoSelection.bounds;
            const cos = Math.cos(-b.rotation);
            const sin = Math.sin(-b.rotation);

            // Rotate point relative to center
            const dx = px - b.centerX;
            const dy = py - b.centerY;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;

            return Math.abs(rx) <= b.width / 2 && Math.abs(ry) <= b.height / 2;
        }

        /**
         * Handle selection pointer down
         */
        function handleLassoPointerDown(e, canvasX, canvasY) {
            // Check if we have a selection
            if (hasLassoSelection()) {
                // Check for handle click
                const handle = getLassoHandleAt(canvasX, canvasY,e.pointerType);
                if (handle) {
                    if (handle.startsWith('rotate')) {
                        lassoSelection.isRotating = true;
                    } else {
                        lassoSelection.isResizing = true;
                    }
                    lassoSelection.handle = handle;
                    lassoSelection.dragStart = {
                        x: canvasX,
                        y: canvasY,
                        bounds: structuredClone(lassoSelection.bounds),
                        originalStrokes: structuredClone(lassoSelection.originalStrokes),
                        originalImages: structuredClone(lassoSelection.originalImages)
                    };
                    return true;
                }

                // Check for click inside bounds to drag
                if (pointInSelectionBounds(canvasX, canvasY)) {
                    lassoSelection.isDragging = true;
                    lassoSelection.dragStart = {
                        x: canvasX,
                        y: canvasY,
                        bounds: structuredClone(lassoSelection.bounds),
                        originalStrokes: structuredClone(lassoSelection.originalStrokes),
                        originalImages: structuredClone(lassoSelection.originalImages)
                    };
                    return true;
                }

                // Clicked outside - mark for potential deselect (will clear on pointerup if didn't move)
                lassoSelection.pendingDeselect = {
                    x: canvasX,
                    y: canvasY,
                    pointerType: e.pointerType
                };

                // For pen/mouse, return true to prevent drawing a dot
                if(currentTool==='lasso'){lassoSelection.pendingDeselect=null;return false;}
                if(e.pointerType==='pen'||e.pointerType==='mouse'){
                    clearLassoSelection();redrawCanvas();return false;
                }
                // Touch still returns false to allow panning
                if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
                    return true;
                }
                // Don't return true for touch - let other handlers process (like panning)
            }

            return false;
        }

        /**
         * Handle selection pointer move
         */
        function handleLassoPointerMove(e, canvasX, canvasY) {
            if (!lassoSelection.dragStart) return false;

            const b = lassoSelection.bounds;
            const start = lassoSelection.dragStart;

            if (lassoSelection.isDragging) {
                // Move selection
                const dx = canvasX - start.x;
                const dy = canvasY - start.y;

                // Update bounds
                b.centerX = start.bounds.centerX + dx;
                b.centerY = start.bounds.centerY + dy;
                b.x = start.bounds.x + dx;
                b.y = start.bounds.y + dy;

                // Transform strokes
                for (let i = 0; i < lassoSelection.strokes.length; i++) {
                    const strokeIdx = lassoSelection.strokes[i];
                    const origStroke = start.originalStrokes[i];

                    for (let j = 0; j < strokes[strokeIdx].points.length; j++) {
                        strokes[strokeIdx].points[j].x = origStroke.points[j].x + dx;
                        strokes[strokeIdx].points[j].y = origStroke.points[j].y + dy;
                    }
                    // Invalidate cached bounds and bezier for culling/rendering recalculation
                    delete strokes[strokeIdx].bounds;
                    delete strokes[strokeIdx]._bezierCP;
                    delete strokes[strokeIdx]._bezierPath;delete strokes[strokeIdx]._fillPath;
                }

                // Transform images
                for (let i = 0; i < lassoSelection.images.length; i++) {
                    const imgId = lassoSelection.images[i];
                    const origImg = start.originalImages[i];
                    const img = images.find(im => im.id === imgId);
                    if (img && origImg) {
                        img.x = origImg.x + dx;
                        img.y = origImg.y + dy;
                    }
                }

                // Check if dragging over recycle bin
                updateTrashHover(e.clientX, e.clientY);

                invalidateStrokeCache(false);redrawCanvas();
                return true;
            }

            if (lassoSelection.isRotating) {
                // Rotate selection
                const startAngle = Math.atan2(start.y - start.bounds.centerY, start.x - start.bounds.centerX);
                const currentAngle = Math.atan2(canvasY - b.centerY, canvasX - b.centerX);
                const deltaAngle = currentAngle - startAngle;

                b.rotation = deltaAngle;

                // Transform strokes around center
                const cos = Math.cos(deltaAngle);
                const sin = Math.sin(deltaAngle);
                const cx = start.bounds.centerX;
                const cy = start.bounds.centerY;

                for (let i = 0; i < lassoSelection.strokes.length; i++) {
                    const strokeIdx = lassoSelection.strokes[i];
                    const origStroke = start.originalStrokes[i];

                    for (let j = 0; j < strokes[strokeIdx].points.length; j++) {
                        const px = origStroke.points[j].x - cx;
                        const py = origStroke.points[j].y - cy;
                        strokes[strokeIdx].points[j].x = cx + px * cos - py * sin;
                        strokes[strokeIdx].points[j].y = cy + px * sin + py * cos;
                    }
                    // Invalidate cached bounds and bezier for recalculation
                    delete strokes[strokeIdx].bounds;
                    delete strokes[strokeIdx]._bezierCP;
                    delete strokes[strokeIdx]._bezierPath;delete strokes[strokeIdx]._fillPath;
                }

                // Transform images around center
                for (let i = 0; i < lassoSelection.images.length; i++) {
                    const imgId = lassoSelection.images[i];
                    const origImg = start.originalImages[i];
                    const img = images.find(im => im.id === imgId);
                    if (img && origImg) {
                        // Rotate image center around selection center
                        const imgCx = origImg.x + origImg.width / 2 - cx;
                        const imgCy = origImg.y + origImg.height / 2 - cy;
                        const newCx = cx + imgCx * cos - imgCy * sin;
                        const newCy = cy + imgCx * sin + imgCy * cos;

                        img.x = newCx - origImg.width / 2;
                        img.y = newCy - origImg.height / 2;
                        img.rotation = (origImg.rotation || 0) + deltaAngle;
                    }
                }

                invalidateStrokeCache(false);redrawCanvas();
                return true;
            }

            if (lassoSelection.isResizing) {
                // Scale selection
                const handle = lassoSelection.handle;
                const cx = start.bounds.centerX;
                const cy = start.bounds.centerY;

                // Calculate scale based on distance from center
                const startDist = Math.hypot(start.x - cx, start.y - cy);
                const currentDist = Math.hypot(canvasX - cx, canvasY - cy);
                const scale = currentDist / Math.max(startDist, 1);

                // Update bounds
                b.width = start.bounds.width * scale;
                b.height = start.bounds.height * scale;
                b.x = cx - b.width / 2;
                b.y = cy - b.height / 2;

                // Transform strokes
                for (let i = 0; i < lassoSelection.strokes.length; i++) {
                    const strokeIdx = lassoSelection.strokes[i];
                    const origStroke = start.originalStrokes[i];

                    for (let j = 0; j < strokes[strokeIdx].points.length; j++) {
                        const px = origStroke.points[j].x - cx;
                        const py = origStroke.points[j].y - cy;
                        strokes[strokeIdx].points[j].x = cx + px * scale;
                        strokes[strokeIdx].points[j].y = cy + py * scale;

                        // Scale pressure/width if present
                        if (strokes[strokeIdx].points[j].pressure !== undefined) {
                            strokes[strokeIdx].points[j].pressure = origStroke.points[j].pressure;
                        }
                    }

                    // Scale stroke width if present
                    strokes[strokeIdx].size=origStroke.size*scale;
                    strokes[strokeIdx].points.forEach((p,j)=>{if(origStroke.points[j].size!==undefined)p.size=origStroke.points[j].size*scale;});
                    if (strokes[strokeIdx].width !== undefined && origStroke.width !== undefined) {
                        strokes[strokeIdx].width = origStroke.width * scale;
                    }
                    // Invalidate cached bounds and bezier for recalculation
                    delete strokes[strokeIdx].bounds;
                    delete strokes[strokeIdx]._bezierCP;
                    delete strokes[strokeIdx]._bezierPath;delete strokes[strokeIdx]._fillPath;
                }

                // Scale images
                for (let i = 0; i < lassoSelection.images.length; i++) {
                    const imgId = lassoSelection.images[i];
                    const origImg = start.originalImages[i];
                    const img = images.find(im => im.id === imgId);
                    if (img && origImg) {
                        // Scale image position relative to center
                        const imgCx = origImg.x + origImg.width / 2 - cx;
                        const imgCy = origImg.y + origImg.height / 2 - cy;
                        const newCx = cx + imgCx * scale;
                        const newCy = cy + imgCy * scale;

                        img.width = origImg.width * scale;
                        img.height = origImg.height * scale;
                        img.x = newCx - img.width / 2;
                        img.y = newCy - img.height / 2;
                    }
                }

                invalidateStrokeCache(false);redrawCanvas();
                return true;
            }

            return false;
        }

        /**
         * Handle selection pointer up
         */
        function handleLassoPointerUp(e) {
            // Check for pending deselect (tap outside selection)
            if (lassoSelection.pendingDeselect) {
                const pending = lassoSelection.pendingDeselect;
                lassoSelection.pendingDeselect = null;

                // Only deselect if this is from an event (actual tap)
                // and we have a selection
                const totalCount = lassoSelection.strokes.length + lassoSelection.images.length;
                if (e && totalCount > 0) {
                    const rect = canvas.getBoundingClientRect();
                    const canvasX = (e.clientX - rect.left - panX) / zoom;
                    const canvasY = (e.clientY - rect.top - panY) / zoom;

                    // Check if movement was minimal (a tap, not a pan)
                    const dx = canvasX - pending.x;
                    const dy = canvasY - pending.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < LASSO_TAP_THRESHOLD) {
                        // It was a tap - clear selection
                        clearLassoSelection();
                        redrawCanvas();
                        return true;
                    }
                }
            }

            if (lassoSelection.isDragging || lassoSelection.isRotating || lassoSelection.isResizing) {
                const wasDragging = lassoSelection.isDragging;

                // Check if dropped on recycle bin
                if (wasDragging && isOverRecycleBin(e.clientX, e.clientY)) {
                    // Play suck animation then delete
                    playTrashSuckAnimation(e.clientX, e.clientY, () => {
                        deleteSelectedItems();
                    });
                    lassoSelection.isDragging = false;
                    lassoSelection.isRotating = false;
                    lassoSelection.isResizing = false;
                    return true;
                }

                clearTrashHover();

                // Push to history for undo/redo support (strokes)
                if (lassoSelection.dragStart && lassoSelection.dragStart.originalStrokes) {
                    const beforeStrokes = lassoSelection.dragStart.originalStrokes;
                    const afterStrokes = [];
                    for (const idx of lassoSelection.strokes) {
                        afterStrokes.push(structuredClone(strokes[idx]));
                    }

                    if (lassoSelection.strokes.length > 0) {
                        historyStack.push({
                            type: 'transform',
                            strokeIndices: [...lassoSelection.strokes],
                            beforeStrokes: beforeStrokes,
                            afterStrokes: afterStrokes
                        });
                        // Invalidate stroke cache after transform
                        if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
                    }
                }

                // Push to history for undo/redo support (images)
                if (lassoSelection.dragStart && lassoSelection.dragStart.originalImages) {
                    for (let i = 0; i < lassoSelection.images.length; i++) {
                        const imgId = lassoSelection.images[i];
                        const beforeImg = lassoSelection.dragStart.originalImages[i];
                        const img = images.find(im => im.id === imgId);
                        if (img && beforeImg) {
                            const afterImg = structuredClone(img);
                            // Only push if something actually changed
                            if (beforeImg.x !== afterImg.x || beforeImg.y !== afterImg.y ||
                                beforeImg.width !== afterImg.width || beforeImg.height !== afterImg.height ||
                                beforeImg.rotation !== afterImg.rotation) {
                                historyStack.push({
                                    type: 'image-transform',
                                    imageId: imgId,
                                    before: beforeImg,
                                    after: afterImg
                                });
                            }
                        }
                    }
                }

                redoStack.length = 0; // Clear redo stack on new action

                lassoSelection.isDragging = false;
                lassoSelection.isRotating = false;
                lassoSelection.isResizing = false;
                lassoSelection.dragStart = null;

                // Update original strokes for next transformation
                lassoSelection.originalStrokes = [];
                for (const idx of lassoSelection.strokes) {
                    lassoSelection.originalStrokes.push(structuredClone(strokes[idx]));
                }

                // Update original images for next transformation
                lassoSelection.originalImages = [];
                for (const imgId of lassoSelection.images) {
                    const img = images.find(im => im.id === imgId);
                    if (img) {
                        lassoSelection.originalImages.push(structuredClone(img));
                    }
                }

                // Recalculate bounds
                calculateSelectionBounds();

                // Save
                triggerAutoSave();
                return true;
            }
            return false;
        }

        /**
         * Delete selected strokes and images
         */
        function deleteSelectedItems() {
            let deletedCount = 0;

            // Delete strokes (sort indices descending to remove from end first)
            if (lassoSelection.strokes.length > 0) {
                const indices = [...lassoSelection.strokes].sort((a, b) => b - a);
                for (const idx of indices) {
                    strokes.splice(idx, 1);
                    deletedCount++;
                }
                // Invalidate stroke cache after deletion
                if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
            }

            // Delete images
            if (lassoSelection.images.length > 0) {
                for (const imgId of lassoSelection.images) {
                    const imgIdx = images.findIndex(im => im.id === imgId);
                    if (imgIdx >= 0) {
                        // Push to history before removing
                        const deletedImage = structuredClone(images[imgIdx]);
                        historyStack.push({
                            type: 'image-remove',
                            image: deletedImage
                        });

                        images.splice(imgIdx, 1);
                        deletedCount++;
                    }
                }
            }

            clearLassoSelection();
            redrawCanvas();
            saveCurrentPage();
            showToast(`Deleted ${deletedCount} item(s)`, 'success');
        }

        // Keep old function name for backwards compatibility
        function deleteSelectedStrokes() {
            deleteSelectedItems();
        }

        /**
         * Draw the lasso path (dashed cyan line)
         * Draws both the active drawing path and the stored selection path
         * Also draws all multi-selections for AI feature
         */
        function drawLassoPath(ctx) {
            ctx.save();
            const colors=getSelectionThemePalette();

            // First, draw all stored multi-selections (slightly transparent)
            if (multiLassoSelections.length > 0) {
                for (let i = 0; i < multiLassoSelections.length; i++) {
                    const sel = multiLassoSelections[i];
                    if (!sel.path || sel.path.length < 3) continue;

                    // Use different color for older selections
                    const isLatest = (i === multiLassoSelections.length - 1) && lassoPath.length < 2;
                    ctx.strokeStyle = isLatest ? colors.highlight : colors.accent;
                    ctx.lineWidth = 2 / zoom;
                    ctx.setLineDash([8 / zoom, 4 / zoom]);
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.fillStyle = colors.accent;

                    ctx.beginPath();
                    ctx.moveTo(sel.path[0].x, sel.path[0].y);
                    for (let j = 1; j < sel.path.length; j++) {
                        ctx.lineTo(sel.path[j].x, sel.path[j].y);
                    }
                    ctx.closePath();
                    ctx.save();ctx.globalAlpha=isLatest ? .1 : .06;ctx.fill();ctx.restore();
                    ctx.stroke();

                    // Draw selection number badge
                    if (multiLassoSelections.length > 1) {
                        const bounds = sel.bounds;
                        const badgeX = bounds.x + bounds.width - 10 / zoom;
                        const badgeY = bounds.y + 10 / zoom;
                        const badgeR = 12 / zoom;

                        ctx.setLineDash([]);
                        ctx.fillStyle = colors.accent;
                        ctx.beginPath();
                        ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
                        ctx.fill();

                        ctx.fillStyle = colors.surface;
                        ctx.font = `bold ${Math.round(14 / zoom)}px sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(String(i + 1), badgeX, badgeY);
                    }
                }
            }

            // Draw the active lasso path being drawn
            if (lassoPath.length >= 2) {
                ctx.strokeStyle = colors.accent;
                ctx.lineWidth = 2 / zoom;
                ctx.setLineDash([8 / zoom, 4 / zoom]);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.beginPath();
                ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
                for (let i = 1; i < lassoPath.length; i++) {
                    ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
                }
                ctx.stroke();
            }

            ctx.restore();
        }

        /**
         * Draw selection handles
         */
        function drawLassoSelectionHandles(ctx) {
            if (!hasLassoSelection() || !lassoSelection.bounds) return;

            const handles = getLassoHandles();
            if (!handles) return;
            const colors=getSelectionThemePalette();

            ctx.save();

            // Draw selection border (dashed cyan)
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2 / zoom;
            ctx.setLineDash([6 / zoom, 4 / zoom]);

            ctx.beginPath();
            ctx.moveTo(handles.nw.x, handles.nw.y);
            ctx.lineTo(handles.ne.x, handles.ne.y);
            ctx.lineTo(handles.se.x, handles.se.y);
            ctx.lineTo(handles.sw.x, handles.sw.y);
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw line to rotation handle
            const topCenter = {
                x: (handles.nw.x + handles.ne.x) / 2,
                y: (handles.nw.y + handles.ne.y) / 2
            };
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.moveTo(topCenter.x, topCenter.y);
            ctx.lineTo(handles.rotate.x, handles.rotate.y);
            ctx.stroke();

            // Draw corner handles
            const handleRadius = LASSO_HANDLE_SIZE / 2 / zoom;
            ctx.fillStyle = colors.surface;
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2 / zoom;

            for (const [name, pos] of Object.entries(handles)) {
                ctx.beginPath();
                if (name === 'rotate') {
                    ctx.arc(pos.x, pos.y, handleRadius, 0, Math.PI * 2);
                } else {
                    ctx.rect(pos.x - handleRadius, pos.y - handleRadius, handleRadius * 2, handleRadius * 2);
                }
                ctx.fill();
                ctx.stroke();
            }

            // Draw rotation icon
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1.5 / zoom;
            const r = handleRadius * 0.6;
            ctx.beginPath();
            ctx.arc(handles.rotate.x, handles.rotate.y, r, -Math.PI * 0.7, Math.PI * 0.5);
            ctx.stroke();

            // Arrow head
            const arrowAngle = Math.PI * 0.5;
            const ax = handles.rotate.x + r * Math.cos(arrowAngle);
            const ay = handles.rotate.y + r * Math.sin(arrowAngle);
            ctx.beginPath();
            ctx.moveTo(ax - 3/zoom, ay - 4/zoom);
            ctx.lineTo(ax, ay);
            ctx.lineTo(ax + 4/zoom, ay - 2/zoom);
            ctx.stroke();

            ctx.restore();
        }

        /**
         * Check if lasso selection is active
         */
        function hasLassoSelection() {
            return lassoSelection.strokes.length > 0 || lassoSelection.images.length > 0;
        }

        /**
         * Recolor selected strokes to a new color
         */
        function recolorLassoSelection(newColor) {
            if (lassoSelection.strokes.length === 0) {
                showToast('No strokes selected', 'warning');
                return false;
            }

            // Change color of all selected strokes
            for (const idx of lassoSelection.strokes) {
                if (strokes[idx]) {
                    strokes[idx].color = newColor;
                }
            }

            // Also update original strokes for consistency
            for (const origStroke of lassoSelection.originalStrokes) {
                origStroke.color = newColor;
            }

            // Invalidate stroke cache
            if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();

            markPageDirty();
            redrawCanvas();

            showToast(`Recolored ${lassoSelection.strokes.length} stroke(s)`, 'success');
            return true;
        }

        /**
         * Get the currently selected strokes and images as actual objects
         * @returns {Object} { strokes: Array, images: Array, bounds: Object|null, path: Array }
         */
        function getLassoSelection() {
            const selectedStrokesData = [];
            const selectedImagesData = [];

            // Get actual stroke objects from indices
            for (const idx of lassoSelection.strokes) {
                if (strokes[idx]) {
                    selectedStrokesData.push(strokes[idx]);
                }
            }

            // Get actual image objects from IDs
            for (const imgId of lassoSelection.images) {
                const img = images.find(i => i.id === imgId);
                if (img) {
                    selectedImagesData.push(img);
                }
            }

            return {
                strokes: selectedStrokesData,
                images: selectedImagesData,
                bounds: lassoSelection.bounds,
                path: lassoSelection.path
            };
        }

        /**
         * Get the bounding box of the lasso path (for screenshot capture)
         * @returns {Object|null} { x, y, width, height } or null if no path
         */
        function getLassoPathBounds() {
            const path = lassoSelection.path;
            if (!path || path.length < 3) return null;

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            for (const pt of path) {
                minX = Math.min(minX, pt.x);
                minY = Math.min(minY, pt.y);
                maxX = Math.max(maxX, pt.x);
                maxY = Math.max(maxY, pt.y);
            }

            return {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            };
        }

        /**
         * Calculate bounds for any path (helper for multi-selection)
         * @param {Array} path - Array of {x, y} points
         * @returns {Object|null} { x, y, width, height } or null
         */
        function calculatePathBounds(path) {
            if (!path || path.length < 3) return null;

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            for (const pt of path) {
                minX = Math.min(minX, pt.x);
                minY = Math.min(minY, pt.y);
                maxX = Math.max(maxX, pt.x);
                maxY = Math.max(maxY, pt.y);
            }

            return {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            };
        }

        /**
         * Get all lasso selections (for multi-image AI capture)
         * @returns {Array} Array of { path, bounds } objects
         */
        function getAllLassoSelections() {
            return multiLassoSelections;
        }

        /**
         * Get count of current lasso selections
         * @returns {number}
         */
        function getLassoSelectionCount() {
            return multiLassoSelections.length;
        }

        /**
         * Clear all multi-selections
         */
        function clearMultiLassoSelections() {
            multiLassoSelections = [];
        }

        // Expose functions globally
        window.recolorLassoSelection = recolorLassoSelection;
        window.getLassoSelection = getLassoSelection;
        window.hasLassoSelection = hasLassoSelection;
        window.getLassoPathBounds = getLassoPathBounds;
        window.getAllLassoSelections = getAllLassoSelections;
        window.getLassoSelectionCount = getLassoSelectionCount;
        window.clearMultiLassoSelections = clearMultiLassoSelections;

        // Note: isOverRecycleBin, updateTrashHover, clearTrashHover are now in 01_core.js
