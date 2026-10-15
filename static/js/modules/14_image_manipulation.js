// ============== Image Manipulation ==============
        // State for image selection and manipulation
        let selectedImage = null;
        let imageManipulation = {
            isDragging: false,
            isResizing: false,
            isRotating: false,
            dragStart: null,
            handle: null,
            initialPinch: null // For two-finger scale/rotate
        };

        const IMAGE_HANDLE_SIZE = 14; // Size of corner handles
        const IMAGE_ROTATE_DISTANCE = 40; // Distance of rotation handle from corner

        // Double-tap detection for unlocking
        let lastTapTime = 0;
        let lastTapX = 0;
        let lastTapY = 0;
        const DOUBLE_TAP_THRESHOLD = 300; // ms
        const DOUBLE_TAP_DISTANCE = 30; // pixels

        // Snapping thresholds
        const ROTATION_SNAP_ANGLE = Math.PI / 4; // 45 degrees
        const ROTATION_SNAP_THRESHOLD = Math.PI / 36; // 5 degrees - how close to trigger snap
        const ROTATION_BREAK_THRESHOLD = Math.PI / 18; // 10 degrees - how far to break free
        const ASPECT_SNAP_THRESHOLD = 0.08; // 8% tolerance for aspect ratio snapping

        // Snap state
        let isSnappedToAngle = false;
        let currentSnapAngle = null;
        let snapAnimationProgress = 0;
        let snapStartAngle = 0;

        // Lock animation state
        let lockAnimation = null;
        let lockAnimationImage = null;

        /**
         * Update hover state for images (for displaying lock icons on hover)
         */
        function updateImageHoverState(canvasX, canvasY) {
            if (!images) return;

            let changed = false;
            let foundHover = null;

            // Find image under cursor
            const img = findImageAt(canvasX, canvasY, true); // Include locked

            // Mark new hover state
            for (const i of images) {
                const shouldBeHovered = (img && i.id === img.id);
                if (i.isHovered !== shouldBeHovered) {
                    i.isHovered = shouldBeHovered;
                    changed = true;
                }
            }

            if (changed) {
                redrawCanvas();
            }
        }

        /**
         * Check if point is on a locked image's lock icon
         */
        function isOnLockIcon(canvasX, canvasY) {
            if (!images || images.length === 0) return null;

            for (let i = images.length - 1; i >= 0; i--) {
                const img = images[i];
                if (!img.locked) continue;

                // Calculate lock icon position (same as in canvas_core.js rendering)
                const lockSize = Math.min(img.width, img.height) * 0.035;
                const cx = img.x + img.width / 2;
                const cy = img.y + img.height / 2;

                // Lock icon is at top-right, rotated with image
                const cos = Math.cos(img.rotation || 0);
                const sin = Math.sin(img.rotation || 0);

                // Local position of lock icon (relative to center)
                const localLx = img.width / 2 - lockSize * 2.5;
                const localLy = -img.height / 2 + lockSize * 2.5;

                // Rotate to get world position
                const lockX = cx + localLx * cos - localLy * sin;
                const lockY = cy + localLx * sin + localLy * cos;

                // Check if tap is within lock icon radius
                const dx = canvasX - lockX;
                const dy = canvasY - lockY;
                const hitRadius = lockSize * 3; // Generous hit area

                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    return img;
                }
            }
            return null;
        }

        /**
         * Play freeze/lock animation on an image
         */
        function playLockAnimation(img) {
            if (lockAnimation) cancelAnimationFrame(lockAnimation);

            lockAnimationImage = img;
            const startTime = performance.now();
            const duration = 400;

            function animate(now) {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Store animation progress on the image for rendering
                lockAnimationImage._lockAnimProgress = progress;
                redrawCanvas();

                if (progress < 1) {
                    lockAnimation = requestAnimationFrame(animate);
                } else {
                    lockAnimationImage._lockAnimProgress = null;
                    lockAnimation = null;
                    lockAnimationImage = null;
                    redrawCanvas();
                }
            }

            lockAnimation = requestAnimationFrame(animate);
        }

        /**
         * Check for double-tap to lock/unlock images
         * - Double-tap on unlocked image: lock it
         * - Double-tap on lock icon: unlock it
         * - Only works with finger (touch), not pen
         * Returns true if handled
         */
        function checkDoubleTapLock(canvasX, canvasY, pointerType) {
            // Only allow finger double-tap, not pen
            if (pointerType !== 'touch') {
                return false;
            }

            const now = Date.now();
            const dx = canvasX - lastTapX;
            const dy = canvasY - lastTapY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const isDoubleTap = (now - lastTapTime < DOUBLE_TAP_THRESHOLD) && (dist < DOUBLE_TAP_DISTANCE);

            lastTapTime = now;
            lastTapX = canvasX;
            lastTapY = canvasY;

            if (isDoubleTap) {
                // First check if tapping on lock icon to unlock
                const lockedImg = isOnLockIcon(canvasX, canvasY);
                if (lockedImg) {
                    lockedImg.locked = false;
                    redrawCanvas();
                    saveCurrentPage();
                    showToast('Image unlocked', 'info');
                    return true;
                }

                // Check if tapping on unlocked image to lock it
                const img = findImageAt(canvasX, canvasY, false);
                if (img && !img.locked) {
                    img.locked = true;
                    deselectImage();
                    playLockAnimation(img);
                    saveCurrentPage();
                    showToast('Image locked', 'info');
                    return true;
                }
            }
            return false;
        }

        /**
         * Get distance to nearest snap angle (handles wrap-around)
         */
        function getSnapDistance(angle) {
            let normalized = angle % (Math.PI * 2);
            if (normalized < 0) normalized += Math.PI * 2;

            const snapPoint = Math.round(normalized / ROTATION_SNAP_ANGLE) * ROTATION_SNAP_ANGLE;
            let diff = normalized - snapPoint;
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;
            return diff;
        }

        /**
         * Handle rotation with magnetic snapping
         * Returns the visual rotation angle (may differ from raw input during snap)
         */
        function handleRotationSnapping(rawRotation) {
            const snapDist = getSnapDistance(rawRotation);
            const absDist = Math.abs(snapDist);
            const targetSnap = rawRotation - snapDist;

            if (isSnappedToAngle && currentSnapAngle !== null) {
                // Currently snapped - check if we should break free
                // Use the distance from the current snap angle, not from nearest snap
                const distFromSnap = Math.abs(rawRotation - currentSnapAngle);
                if (distFromSnap > ROTATION_BREAK_THRESHOLD) {
                    // Break free!
                    isSnappedToAngle = false;
                    currentSnapAngle = null;
                    return rawRotation;
                } else {
                    // Stay snapped at current snap angle
                    return currentSnapAngle;
                }
            } else {
                // Not snapped - check if we should snap
                if (absDist < ROTATION_SNAP_THRESHOLD) {
                    // Snap with a quick bounce effect
                    isSnappedToAngle = true;
                    currentSnapAngle = targetSnap;
                    return targetSnap;
                } else {
                    // Free rotation
                    return rawRotation;
                }
            }
        }

        /**
         * Reset snap state
         */
        function resetSnapState() {
            isSnappedToAngle = false;
            currentSnapAngle = null;
        }

        /**
         * Snap dimensions to maintain aspect ratio if close
         */
        function snapAspectRatio(newW, newH, origW, origH) {
            const targetRatio = origW / origH;
            const currentRatio = newW / newH;
            const ratioDiff = Math.abs(currentRatio - targetRatio) / targetRatio;

            if (ratioDiff < ASPECT_SNAP_THRESHOLD) {
                // Snap to original aspect ratio
                const snapStrength = 1 - (ratioDiff / ASPECT_SNAP_THRESHOLD);

                // Determine which dimension to adjust based on drag direction
                const avgSize = (newW + newH * targetRatio) / 2;
                const snappedW = newW + (avgSize - newW) * snapStrength * 0.7;
                const snappedH = snappedW / targetRatio;

                return { width: snappedW, height: snappedH };
            }
            return { width: newW, height: newH };
        }

        /**
         * Find image at canvas coordinates
         */
        function findImageAt(canvasX, canvasY, includeLocked = false) {
            if (!images || images.length === 0) return null;

            // Check in reverse order (top-most first)
            for (let i = images.length - 1; i >= 0; i--) {
                const img = images[i];

                // Skip locked images unless explicitly including them
                if (img.locked && !includeLocked) continue;

                // For rotated images, we need to check if point is inside the rotated rectangle
                if (img.rotation && img.rotation !== 0) {
                    if (pointInRotatedRect(canvasX, canvasY, img)) {
                        return img;
                    }
                } else {
                    // Simple AABB check
                    if (canvasX >= img.x && canvasX <= img.x + img.width &&
                        canvasY >= img.y && canvasY <= img.y + img.height) {
                        return img;
                    }
                }
            }
            return null;
        }

        /**
         * Unlock a specific image by clicking its lock indicator
         */
        function unlockImageAt(canvasX, canvasY) {
            const img = findImageAt(canvasX, canvasY, true); // Include locked
            if (img && img.locked) {
                img.locked = false;
                redrawCanvas();
                saveCurrentPage();
                showToast('Image unlocked', 'info');
                return true;
            }
            return false;
        }

        /**
         * Check if point is inside rotated rectangle
         */
        function pointInRotatedRect(px, py, img) {
            // Center of image
            const cx = img.x + img.width / 2;
            const cy = img.y + img.height / 2;

            // Rotate point around center (inverse rotation)
            const cos = Math.cos(-img.rotation);
            const sin = Math.sin(-img.rotation);
            const dx = px - cx;
            const dy = py - cy;
            const rx = dx * cos - dy * sin;
            const ry = dx * sin + dy * cos;

            // Check against unrotated rectangle
            return Math.abs(rx) <= img.width / 2 && Math.abs(ry) <= img.height / 2;
        }

        /**
         * Get handle positions for selected image
         */
        function getImageHandles(img) {
            const cx = img.x + img.width / 2;
            const cy = img.y + img.height / 2;
            const cos = Math.cos(img.rotation || 0);
            const sin = Math.sin(img.rotation || 0);

            // Helper to rotate point around center
            const rotate = (x, y) => ({
                x: cx + (x - cx) * cos - (y - cy) * sin,
                y: cy + (x - cx) * sin + (y - cy) * cos
            });

            return {
                nw: rotate(img.x, img.y),
                ne: rotate(img.x + img.width, img.y),
                se: rotate(img.x + img.width, img.y + img.height),
                sw: rotate(img.x, img.y + img.height),
                // Rotation handle - above the top center
                rotate: rotate(img.x + img.width / 2, img.y - IMAGE_ROTATE_DISTANCE),
                // Lock handle - bottom center
                lock: rotate(img.x + img.width / 2, img.y + img.height + IMAGE_ROTATE_DISTANCE),
                // Invert handle - left of center
                invert: rotate(img.x - IMAGE_ROTATE_DISTANCE, img.y + img.height / 2),
                // Delete handle - right of center
                delete: rotate(img.x + img.width + IMAGE_ROTATE_DISTANCE, img.y + img.height / 2)
            };
        }

        /**
         * Check which handle is at position
         */
        function getHandleAt(canvasX, canvasY, img) {
            if (!img) return null;

            const handles = getImageHandles(img);
            const threshold = IMAGE_HANDLE_SIZE * 1.5 / zoom; // Account for zoom

            for (const [name, pos] of Object.entries(handles)) {
                const dx = canvasX - pos.x;
                const dy = canvasY - pos.y;
                if (Math.sqrt(dx * dx + dy * dy) < threshold) {
                    return name;
                }
            }
            return null;
        }

        /**
         * Select an image
         */
        function selectImage(img) {
            selectedImage = img;
            redrawCanvas();
        }

        /**
         * Deselect image
         */
        function deselectImage() {
            selectedImage = null;
            imageManipulation = {
                isDragging: false,
                isResizing: false,
                isRotating: false,
                dragStart: null,
                handle: null,
                initialPinch: null
            };
            redrawCanvas();
        }

        /**
         * Delete selected image
         */
        function deleteSelectedImage() {
            if (!selectedImage) return;

            const idx = images.findIndex(i => i.id === selectedImage.id);
            if (idx !== -1) {
                // Push to history for undo
                const deletedImage = structuredClone(selectedImage);
                historyStack.push({
                    type: 'image-remove',
                    image: deletedImage
                });
                redoStack.length = 0; // Clear redo stack

                images.splice(idx, 1);
                selectedImage = null;
                redrawCanvas();
                saveCurrentPage();
                showToast('Image deleted', 'success');
            }
        }

        /**
         * Toggle lock state of selected image
         */
        function toggleImageLock() {
            if (!selectedImage) return;

            selectedImage.locked = !selectedImage.locked;
            const wasLocked = selectedImage.locked;

            if (wasLocked) {
                // Deselect when locking
                deselectImage();
                showToast('Image locked', 'info');
            } else {
                showToast('Image unlocked', 'info');
            }

            redrawCanvas();
            saveCurrentPage();
        }

        /**
         * Toggle invert color of selected image
         */
        function toggleImageInvert() {
            if (!selectedImage) return;

            selectedImage.inverted = !selectedImage.inverted;

            if (selectedImage.inverted) {
                showToast('Colors inverted', 'info');
            } else {
                showToast('Colors restored', 'info');
            }

            redrawCanvas();
            saveCurrentPage();
        }

        /**
         * Handle image pointer down
         * Returns true if event was handled (image was clicked)
         */
        function handleImagePointerDown(e, canvasX, canvasY) {
            // Check for double-tap to lock/unlock images (finger only)
            if (checkDoubleTapLock(canvasX, canvasY, e.pointerType)) {
                return true;
            }

            // Check if clicking on a handle of selected image
            if (selectedImage) {
                const handle = getHandleAt(canvasX, canvasY, selectedImage);
                if (handle) {
                    if (handle === 'lock') {
                        // Lock handle clicked - toggle lock
                        toggleImageLock();
                        return true;
                    } else if (handle === 'invert') {
                        // Invert handle clicked - toggle invert
                        toggleImageInvert();
                        return true;
                    } else if (handle === 'delete') {
                        // Delete handle clicked - delete image
                        deleteSelectedImage();
                        return true;
                    } else if (handle === 'rotate') {
                        imageManipulation.isRotating = true;
                    } else {
                        imageManipulation.isResizing = true;
                    }
                    imageManipulation.handle = handle;
                    imageManipulation.dragStart = {
                        x: canvasX,
                        y: canvasY,
                        image: structuredClone(selectedImage)
                    };
                    return true;
                }
            }

            // Check if clicking on an image
            const img = findImageAt(canvasX, canvasY);
            if (img) {
                selectImage(img);
                imageManipulation.isDragging = true;
                window.DragMotion?.beginImage(e);
                imageManipulation.dragStart = {
                    x: canvasX,
                    y: canvasY,
                    image: structuredClone(img)
                };
                return true;
            }

            // Clicked elsewhere - deselect
            if (selectedImage) {
                deselectImage();
                // Don't return true - let event propagate for drawing
            }

            return false;
        }

        /**
         * Handle image pointer move
         * Returns true if event was handled
         */
        function handleImagePointerMove(e, canvasX, canvasY) {
            if (!selectedImage || !imageManipulation.dragStart) return false;

            if (imageManipulation.isDragging) {
                window.DragMotion?.imageSample(e);
                // Move image
                const dx = canvasX - imageManipulation.dragStart.x;
                const dy = canvasY - imageManipulation.dragStart.y;
                selectedImage.x = imageManipulation.dragStart.image.x + dx;
                selectedImage.y = imageManipulation.dragStart.image.y + dy;

                // imageSample also previews the momentum-aware trash catch.

                redrawCanvas();
                return true;
            }

            if (imageManipulation.isRotating) {
                // Rotate around center with magnetic snapping
                const cx = selectedImage.x + selectedImage.width / 2;
                const cy = selectedImage.y + selectedImage.height / 2;

                const startAngle = Math.atan2(
                    imageManipulation.dragStart.y - cy,
                    imageManipulation.dragStart.x - cx
                );
                const currentAngle = Math.atan2(canvasY - cy, canvasX - cx);

                // Calculate raw rotation
                const rawRotation = (imageManipulation.dragStart.image.rotation || 0) + (currentAngle - startAngle);

                // Apply magnetic snapping (handles bounce animation internally)
                selectedImage.rotation = handleRotationSnapping(rawRotation);
                redrawCanvas();
                return true;
            }

            if (imageManipulation.isResizing) {
                handleImageResize(canvasX, canvasY, e.shiftKey);
                redrawCanvas();
                return true;
            }

            return false;
        }

        /**
         * Handle image resize based on handle being dragged
         */
        function handleImageResize(canvasX, canvasY, maintainAspect) {
            if (!selectedImage || !imageManipulation.handle) return;

            const orig = imageManipulation.dragStart.image;
            const handle = imageManipulation.handle;
            const aspectRatio = orig.width / orig.height;

            // For rotated images, work in unrotated coordinate space
            const rotation = orig.rotation || 0;
            const cx = orig.x + orig.width / 2;
            const cy = orig.y + orig.height / 2;

            // Rotate current point back to original orientation
            const cos = Math.cos(-rotation);
            const sin = Math.sin(-rotation);
            const dx = canvasX - cx;
            const dy = canvasY - cy;
            const localX = cx + dx * cos - dy * sin;
            const localY = cy + dx * sin + dy * cos;

            // Apply resize in local coordinates
            let newX = orig.x;
            let newY = orig.y;
            let newW = orig.width;
            let newH = orig.height;

            switch (handle) {
                case 'se':
                    newW = localX - orig.x;
                    newH = localY - orig.y;
                    break;
                case 'sw':
                    newX = localX;
                    newW = orig.x + orig.width - localX;
                    newH = localY - orig.y;
                    break;
                case 'ne':
                    newW = localX - orig.x;
                    newY = localY;
                    newH = orig.y + orig.height - localY;
                    break;
                case 'nw':
                    newX = localX;
                    newY = localY;
                    newW = orig.x + orig.width - localX;
                    newH = orig.y + orig.height - localY;
                    break;
            }

            // Shift = force aspect ratio, otherwise smart snap
            if (maintainAspect) {
                // Force exact aspect ratio
                if (newW / aspectRatio > newH) {
                    newH = newW / aspectRatio;
                } else {
                    newW = newH * aspectRatio;
                }
            } else {
                // Smart snap to aspect ratio when close
                const snapped = snapAspectRatio(newW, newH, orig.width, orig.height);
                newW = snapped.width;
                newH = snapped.height;
            }

            // Minimum size
            newW = Math.max(30, newW);
            newH = Math.max(30, newH);

            selectedImage.x = newX;
            selectedImage.y = newY;
            selectedImage.width = newW;
            selectedImage.height = newH;
        }

        /**
         * Handle image pointer up
         */
        function handleImagePointerUp(e) {
            if (imageManipulation.isDragging || imageManipulation.isResizing || imageManipulation.isRotating) {
                const wasDragging = imageManipulation.isDragging;
                const throwPlan=wasDragging?window.DragMotion?.releaseImage(e):null;

                // Check if dropped on recycle bin
                if (wasDragging && e && throwPlan) {
                    const visible=structuredClone(selectedImage),original=structuredClone(imageManipulation.dragStart?.image||selectedImage);
                    const index=images.findIndex(img=>img.id===visible.id);
                    Object.assign(selectedImage,original);
                    TrashWorkbench.dropSelection({strokes:[],images:[{index,item:original}]},{strokes:[],images:[{index,item:visible}]},e,()=>{
                        const found=images.findIndex(img=>img.id===original.id);if(found<0)return;
                        historyStack.push({type:'lasso-edit',before:{strokes:[],images:[{index:found,item:original}]},after:{strokes:[],images:[]}});redoStack=[];images.splice(found,1);selectedImage=null;redrawCanvas(true);triggerAutoSave();
                    },throwPlan).finally(()=>DragMotion.finishImageDrop());
                    imageManipulation.isDragging = false;
                    imageManipulation.isResizing = false;
                    imageManipulation.isRotating = false;
                    imageManipulation.dragStart = null;
                    imageManipulation.handle = null;
                    return true;
                }

                clearTrashHover();

                // Push transform to history for undo/redo
                if (imageManipulation.dragStart && selectedImage) {
                    const beforeImage = imageManipulation.dragStart.image;
                    const afterImage = structuredClone(selectedImage);

                    // Only push if something actually changed
                    if (beforeImage.x !== afterImage.x || beforeImage.y !== afterImage.y ||
                        beforeImage.width !== afterImage.width || beforeImage.height !== afterImage.height ||
                        beforeImage.rotation !== afterImage.rotation) {
                        historyStack.push({
                            type: 'image-transform',
                            imageId: selectedImage.id,
                            before: beforeImage,
                            after: afterImage
                        });
                        redoStack.length = 0; // Clear redo stack
                    }
                }

                imageManipulation.isDragging = false;
                imageManipulation.isResizing = false;
                imageManipulation.isRotating = false;
                imageManipulation.dragStart = null;
                imageManipulation.handle = null;

                // Reset snap state
                resetSnapState();

                // Save changes
                triggerAutoSave();
                return true;
            }
            return false;
        }

        /**
         * Handle pinch gesture for scale/rotate/move
         */
        function handleImagePinch(touch1, touch2) {
            if (!selectedImage) return false;

            // Convert touches to canvas coordinates
            const rect = canvas.getBoundingClientRect();
            const toCanvas = (t) => ({
                x: (t.clientX - rect.left - panX) / zoom,
                y: (t.clientY - rect.top - panY) / zoom
            });

            const p1 = toCanvas(touch1);
            const p2 = toCanvas(touch2);

            const currentDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const currentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            if (!imageManipulation.initialPinch) {
                // Check if pinch center is on the selected image
                if (!pointInRotatedRect(center.x, center.y, selectedImage) &&
                    !findImageAt(center.x, center.y)) {
                    return false;
                }

                imageManipulation.initialPinch = {
                    distance: currentDistance,
                    angle: currentAngle,
                    centerX: center.x,
                    centerY: center.y,
                    image: structuredClone(selectedImage)
                };
                return true;
            }

            const init = imageManipulation.initialPinch;
            const scale = currentDistance / init.distance;
            const deltaAngle = currentAngle - init.angle;

            // Calculate center movement (for panning the image)
            const centerDx = center.x - init.centerX;
            const centerDy = center.y - init.centerY;

            // Calculate raw rotation and apply magnetic snapping
            const rawRotation = (init.image.rotation || 0) + deltaAngle;
            let newRotation = handleRotationSnapping(rawRotation);

            // Apply scale (always maintains aspect ratio for pinch)
            const newWidth = init.image.width * scale;
            const newHeight = init.image.height * scale;

            // Calculate new position:
            // 1. Start from original center
            // 2. Add finger movement (pan)
            // 3. Offset by half the new dimensions
            const origCenterX = init.image.x + init.image.width / 2;
            const origCenterY = init.image.y + init.image.height / 2;

            const newCenterX = origCenterX + centerDx;
            const newCenterY = origCenterY + centerDy;

            selectedImage.x = newCenterX - newWidth / 2;
            selectedImage.y = newCenterY - newHeight / 2;
            selectedImage.width = newWidth;
            selectedImage.height = newHeight;
            selectedImage.rotation = newRotation;

            redrawCanvas();
            return true;
        }

        /**
         * End pinch gesture
         */
        function handleImagePinchEnd() {
            if (imageManipulation.initialPinch) {
                // Push transform to history for undo/redo
                if (selectedImage) {
                    const beforeImage = imageManipulation.initialPinch.image;
                    const afterImage = structuredClone(selectedImage);

                    // Only push if something actually changed
                    if (beforeImage.x !== afterImage.x || beforeImage.y !== afterImage.y ||
                        beforeImage.width !== afterImage.width || beforeImage.height !== afterImage.height ||
                        beforeImage.rotation !== afterImage.rotation) {
                        historyStack.push({
                            type: 'image-transform',
                            imageId: selectedImage.id,
                            before: beforeImage,
                            after: afterImage
                        });
                        redoStack.length = 0; // Clear redo stack
                    }
                }

                imageManipulation.initialPinch = null;

                // Reset snap state
                resetSnapState();

                triggerAutoSave();
                return true;
            }
            return false;
        }

        /**
         * Draw selection handles on the active canvas
         */
        function drawImageSelectionHandles(ctx) {
            if (!selectedImage) return;

            const img = selectedImage;
            const handles = getImageHandles(img);
            const colors=getSelectionThemePalette(),chrome=getCanvasThemePalette().ui;

            ctx.save();

            // Draw selection border (dashed)
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

            // Draw line to lock handle
            const bottomCenter = {
                x: (handles.sw.x + handles.se.x) / 2,
                y: (handles.sw.y + handles.se.y) / 2
            };
            ctx.beginPath();
            ctx.moveTo(bottomCenter.x, bottomCenter.y);
            ctx.lineTo(handles.lock.x, handles.lock.y);
            ctx.stroke();

            // Draw corner handles
            const handleRadius = IMAGE_HANDLE_SIZE / 2 / zoom;
            ctx.fillStyle = colors.surface;
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2 / zoom;

            for (const [name, pos] of Object.entries(handles)) {
                if (name === 'lock' || name === 'invert' || name === 'delete') continue; // Draw separately
                ctx.beginPath();
                if (name === 'rotate') {
                    // Rotation handle is a circle
                    ctx.arc(pos.x, pos.y, handleRadius, 0, Math.PI * 2);
                } else {
                    // Corner handles are squares
                    ctx.rect(pos.x - handleRadius, pos.y - handleRadius, handleRadius * 2, handleRadius * 2);
                }
                ctx.fill();
                ctx.stroke();
            }

            // Draw line to invert handle (left side)
            const leftCenter = {
                x: (handles.nw.x + handles.sw.x) / 2,
                y: (handles.nw.y + handles.sw.y) / 2
            };
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.moveTo(leftCenter.x, leftCenter.y);
            ctx.lineTo(handles.invert.x, handles.invert.y);
            ctx.stroke();

            // Draw invert handle (circle with yin-yang style icon)
            ctx.fillStyle = img.inverted ? colors.accent : colors.surface;
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2 / zoom;
            ctx.beginPath();
            ctx.arc(handles.invert.x, handles.invert.y, handleRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw invert icon (half circle filled)
            const ix = handles.invert.x;
            const iy = handles.invert.y;
            const ir = handleRadius * 0.55;

            ctx.save();
            ctx.beginPath();
            ctx.arc(ix, iy, ir, 0, Math.PI * 2);
            ctx.clip();

            // Left half black, right half white
            ctx.fillStyle = img.inverted ? '#ffffff' : '#000000';
            ctx.fillRect(ix - ir, iy - ir, ir, ir * 2);
            ctx.fillStyle = img.inverted ? '#000000' : '#ffffff';
            ctx.fillRect(ix, iy - ir, ir, ir * 2);
            ctx.restore();

            // Circle outline for the icon
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            ctx.arc(ix, iy, ir, 0, Math.PI * 2);
            ctx.stroke();

            // Draw lock handle (circle with lock icon)
            ctx.beginPath();
            ctx.arc(handles.lock.x, handles.lock.y, handleRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw lock icon inside
            ctx.strokeStyle = colors.accent;
            ctx.fillStyle = colors.accent;
            ctx.lineWidth = 1.5 / zoom;
            const lx = handles.lock.x;
            const ly = handles.lock.y;
            const ls = handleRadius * 0.45; // lock size

            // Lock body (rectangle)
            ctx.fillRect(lx - ls, ly - ls * 0.2, ls * 2, ls * 1.4);

            // Lock shackle (arc on top)
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2 / zoom;
            ctx.beginPath();
            ctx.arc(lx, ly - ls * 0.2, ls * 0.7, Math.PI, 0);
            ctx.stroke();

            // Draw rotation icon in rotation handle
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

            // Draw line to delete handle (right side)
            const rightCenter = {
                x: (handles.ne.x + handles.se.x) / 2,
                y: (handles.ne.y + handles.se.y) / 2
            };
            ctx.strokeStyle = chrome.error; // Semantic danger color, not the selection accent.
            ctx.lineWidth = 1.5 / zoom;
            ctx.beginPath();
            ctx.moveTo(rightCenter.x, rightCenter.y);
            ctx.lineTo(handles.delete.x, handles.delete.y);
            ctx.stroke();

            // Draw delete handle (red circle with X icon)
            ctx.fillStyle = colors.surface;
            ctx.strokeStyle = chrome.error;
            ctx.lineWidth = 2 / zoom;
            ctx.beginPath();
            ctx.arc(handles.delete.x, handles.delete.y, handleRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw X icon inside delete handle
            const dx = handles.delete.x;
            const dy = handles.delete.y;
            const ds = handleRadius * 0.5;
            ctx.strokeStyle = chrome.error;
            ctx.lineWidth = 2.5 / zoom;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(dx - ds, dy - ds);
            ctx.lineTo(dx + ds, dy + ds);
            ctx.moveTo(dx + ds, dy - ds);
            ctx.lineTo(dx - ds, dy + ds);
            ctx.stroke();

            ctx.restore();
        }
