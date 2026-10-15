// ============== Context Menu & Clipboard ==============
        // Long-press context menu for copy/paste operations

        // Clipboard state
        let clipboardData = {
            strokes: [],       // Copied strokes (deep copy)
            images: [],        // Copied images (deep copy)
            offsetX: 0,        // Center offset for pasting
            offsetY: 0
        };

        // Long-press detection
        let longPressTimer = null;
        let longPressPosition = null;
        const LONG_PRESS_DURATION = 500; // ms
        const LONG_PRESS_MOVE_THRESHOLD = 15; // px - how much movement cancels long press

        // Context menu element
        let contextMenu = null;

        /**
         * Initialize context menu system
         */
        function initContextMenu() {
            // Create context menu element
            contextMenu = document.createElement('div');
            contextMenu.id = 'contextMenu';
            contextMenu.className = 'context-menu';
            contextMenu.innerHTML = `
                <button class="context-menu-item" data-action="copy">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                    </svg>
                    <span>Copy</span>
                </button>
                <button class="context-menu-item" data-action="paste">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"></path>
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                    <span>Paste</span>
                </button>
                <button class="context-menu-item" data-action="recolor">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
                    </svg>
                    <span>Recolor</span>
                </button>
                <button class="context-menu-item" data-action="delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>
                    </svg>
                    <span>Delete</span>
                </button>
            `;
            document.body.appendChild(contextMenu);

            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                .context-menu {
                    position: fixed;
                    background: var(--color-bg-elevated, #333);
                    border: 1px solid var(--color-border, #404040);
                    border-radius: 8px;
                    padding: 6px;
                    display: none;
                    flex-direction: column;
                    gap: 2px;
                    z-index: 10000;
                    box-shadow: var(--shadow-lg, 0 10px 15px rgba(0,0,0,0.3));
                    min-width: 120px;
                    animation: contextMenuFadeIn 0.15s ease-out;
                }
                @keyframes contextMenuFadeIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                .context-menu.visible {
                    display: flex;
                }
                .context-menu-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 14px;
                    background: transparent;
                    border: none;
                    border-radius: 6px;
                    color: var(--color-text-primary, #fff);
                    font-size: 14px;
                    cursor: pointer;
                    transition: background 0.1s;
                }
                .context-menu-item:hover {
                    background: var(--color-bg-hover, rgba(255,255,255,0.1));
                }
                .context-menu-item:active {
                    background: var(--color-bg-active, rgba(255,255,255,0.15));
                }
                .context-menu-item:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                .context-menu-item svg {
                    width: 18px;
                    height: 18px;
                    flex-shrink: 0;
                }
                .context-menu-item[data-action="recolor"] {
                    color: var(--color-accent, #6c5ce7);
                }
                .context-menu-item[data-action="recolor"]:hover {
                    background: rgba(108,92,231,0.15);
                }
                .context-menu-item[data-action="delete"] {
                    color: var(--color-error, #ff5252);
                }
                .context-menu-item[data-action="delete"]:hover {
                    background: rgba(244,67,54,0.15);
                }
            `;
            document.head.appendChild(style);

            // Add click handlers
            contextMenu.addEventListener('click', handleContextMenuClick);

            // Close on click outside
            document.addEventListener('pointerdown', (e) => {
                if (!contextMenu.contains(e.target)) {
                    hideContextMenu();
                }
            });

            // Close on scroll/zoom
            document.addEventListener('wheel', hideContextMenu);
        }

        /**
         * Handle context menu item click
         */
        function handleContextMenuClick(e) {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            const menuData = contextMenu.dataset;

            switch (action) {
                case 'copy':
                    handleCopy();
                    break;
                case 'paste':
                    handlePaste(parseFloat(menuData.canvasX), parseFloat(menuData.canvasY));
                    break;
                case 'recolor':
                    handleRecolor();
                    break;
                case 'delete':
                    handleDelete();
                    break;
            }

            hideContextMenu();
        }

        /**
         * Show context menu at position
         */
        function showContextMenu(screenX, screenY, canvasX, canvasY, options = {}) {
            // Store canvas position for paste
            contextMenu.dataset.canvasX = canvasX;
            contextMenu.dataset.canvasY = canvasY;

            // Update button states
            const copyBtn = contextMenu.querySelector('[data-action="copy"]');
            const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
            const recolorBtn = contextMenu.querySelector('[data-action="recolor"]');
            const deleteBtn = contextMenu.querySelector('[data-action="delete"]');

            // Can copy if we have selection (lasso strokes, lasso images, selected image)
            const hasLasso = typeof lassoSelection !== 'undefined' &&
                            (lassoSelection.strokes.length > 0 || lassoSelection.images.length > 0);
            const hasLassoStrokes = typeof lassoSelection !== 'undefined' && lassoSelection.strokes.length > 0;
            const hasImageSelection = typeof selectedImage !== 'undefined' && selectedImage !== null;
            const hasSelection = hasLasso || hasImageSelection;

            copyBtn.disabled = !hasSelection;
            copyBtn.style.display = hasSelection ? 'flex' : 'none';

            // Can paste if clipboard has content
            const hasClipboard = clipboardData.strokes.length > 0 || clipboardData.images.length > 0;
            pasteBtn.disabled = !hasClipboard;

            // Can recolor only if we have lasso-selected strokes (not images)
            recolorBtn.disabled = !hasLassoStrokes;
            recolorBtn.style.display = hasLassoStrokes ? 'flex' : 'none';

            // Can delete if we have selection
            deleteBtn.disabled = !hasSelection;
            deleteBtn.style.display = hasSelection ? 'flex' : 'none';

            // Position menu (ensure it stays on screen)
            contextMenu.style.left = `${screenX}px`;
            contextMenu.style.top = `${screenY}px`;
            contextMenu.classList.add('visible');

            // Adjust if off screen
            const rect = contextMenu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                contextMenu.style.left = `${screenX - rect.width}px`;
            }
            if (rect.bottom > window.innerHeight) {
                contextMenu.style.top = `${screenY - rect.height}px`;
            }
        }

        /**
         * Hide context menu
         */
        function hideContextMenu() {
            if (contextMenu) {
                contextMenu.classList.remove('visible');
            }
        }

        /**
         * Handle copy action
         */
        function handleCopy() {
            clipboardData = {
                strokes: [],
                images: [],
                offsetX: 0,
                offsetY: 0
            };

            let centerX = 0, centerY = 0;
            let count = 0;

            // Copy lasso selection (strokes)
            if (typeof lassoSelection !== 'undefined' && lassoSelection.strokes.length > 0) {
                for (const idx of lassoSelection.strokes) {
                    const stroke = strokes[idx];
                    clipboardData.strokes.push(JSON.parse(JSON.stringify(stroke)));

                    // Calculate center
                    for (const pt of stroke.points) {
                        centerX += pt.x;
                        centerY += pt.y;
                        count++;
                    }
                }
            }

            // Copy lasso selection (images)
            if (typeof lassoSelection !== 'undefined' && lassoSelection.images.length > 0) {
                for (const imgId of lassoSelection.images) {
                    const img = images.find(im => im.id === imgId);
                    if (img) {
                        clipboardData.images.push(JSON.parse(JSON.stringify(img)));

                        // Image center
                        centerX += img.x + img.width / 2;
                        centerY += img.y + img.height / 2;
                        count++;
                    }
                }
            }

            // Copy selected image (if no lasso selection)
            if (typeof selectedImage !== 'undefined' && selectedImage !== null) {
                // Check if this image is not already in lasso selection
                const alreadyCopied = clipboardData.images.some(im => im.id === selectedImage.id);
                if (!alreadyCopied) {
                    clipboardData.images.push(JSON.parse(JSON.stringify(selectedImage)));

                    // Image center
                    centerX += selectedImage.x + selectedImage.width / 2;
                    centerY += selectedImage.y + selectedImage.height / 2;
                    count++;
                }
            }



            if (count > 0) {
                clipboardData.offsetX = centerX / count;
                clipboardData.offsetY = centerY / count;

                const itemCount = clipboardData.strokes.length + clipboardData.images.length;
                showToast(`Copied ${itemCount} item(s)`, 'success');
            }
        }

        /**
         * Handle paste action
         */
        function handlePaste(canvasX, canvasY) {
            if (clipboardData.strokes.length === 0 && clipboardData.images.length === 0) {
                showToast('Nothing to paste', 'info');
                return;
            }

            // Calculate offset from original center to paste position
            const dx = canvasX - clipboardData.offsetX;
            const dy = canvasY - clipboardData.offsetY;

            // Paste strokes
            const pastedStrokes = [];
            for (const stroke of clipboardData.strokes) {
                const newStroke = JSON.parse(JSON.stringify(stroke));
                newStroke.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);

                // Offset points
                for (const pt of newStroke.points) {
                    pt.x += dx;
                    pt.y += dy;
                }

                // Invalidate bounds
                delete newStroke.bounds;

                strokes.push(newStroke);
                pastedStrokes.push(newStroke);
            }

            // Invalidate stroke cache after all strokes are pasted
            if (pastedStrokes.length > 0 && typeof invalidateStrokeCache === 'function') {
                invalidateStrokeCache();
            }

            // Push strokes to history
            for (const stroke of pastedStrokes) {
                historyStack.push({ type: 'add', stroke: stroke });
            }

            // Paste images
            for (const img of clipboardData.images) {
                const newImage = JSON.parse(JSON.stringify(img));
                newImage.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                newImage.x += dx;
                newImage.y += dy;

                images.push(newImage);

                // Push to history
                historyStack.push({
                    type: 'image-add',
                    image: JSON.parse(JSON.stringify(newImage))
                });
            }



            const totalPasted = pastedStrokes.length + clipboardData.images.length;
            if (totalPasted > 0) {
                redoStack.length = 0;
                redrawCanvas();
                saveCurrentPage();

                showToast(`Pasted ${totalPasted} item(s)`, 'success');
            }
        }

        /**
         * Handle recolor action - recolor selected strokes to current pen color
         */
        function handleRecolor() {
            if (typeof recolorLassoSelection === 'function' && typeof currentColor !== 'undefined') {
                recolorLassoSelection(currentColor);
            } else {
                showToast('Recolor not available', 'error');
            }
        }

        /**
         * Handle delete action
         */
        function handleDelete() {
            // Delete lasso selection (strokes and images)
            if (typeof lassoSelection !== 'undefined' &&
               (lassoSelection.strokes.length > 0 || lassoSelection.images.length > 0)) {
                if (typeof deleteSelectedItems === 'function') {
                    deleteSelectedItems();
                } else if (typeof deleteSelectedStrokes === 'function') {
                    deleteSelectedStrokes();
                }
                return; // Don't also delete selectedImage if it's in lasso
            }

            // Delete selected image (if not in lasso)
            if (typeof selectedImage !== 'undefined' && selectedImage !== null) {
                if (typeof deleteSelectedImage === 'function') {
                    deleteSelectedImage();
                }
            }
        }

        /**
         * Start long-press timer
         */
        function startLongPress(e, canvasX, canvasY) {
            cancelLongPress();

            longPressPosition = {
                screenX: e.clientX,
                screenY: e.clientY,
                canvasX: canvasX,
                canvasY: canvasY
            };

            longPressTimer = setTimeout(() => {
                // Trigger context menu
                showContextMenu(
                    longPressPosition.screenX,
                    longPressPosition.screenY,
                    longPressPosition.canvasX,
                    longPressPosition.canvasY
                );
                longPressTimer = null;
                longPressPosition = null;
            }, LONG_PRESS_DURATION);
        }

        /**
         * Check if movement cancels long-press
         */
        function checkLongPressMove(e) {
            if (!longPressPosition) return;

            const dx = e.clientX - longPressPosition.screenX;
            const dy = e.clientY - longPressPosition.screenY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > LONG_PRESS_MOVE_THRESHOLD) {
                cancelLongPress();
            }
        }

        /**
         * Cancel long-press timer
         */
        function cancelLongPress() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            longPressPosition = null;
        }

        /**
         * Check if we should start long-press detection
         * Called from pointer down handlers
         */
        function shouldDetectLongPress(e, canvasX, canvasY) {
            // Only for touch (finger), not pen
            if (e.pointerType !== 'touch') return false;

            // Check if on selected image
            if (typeof selectedImage !== 'undefined' && selectedImage !== null) {
                if (typeof pointInRotatedRect === 'function' && pointInRotatedRect(canvasX, canvasY, selectedImage)) {
                    return true;
                }
            }

            // Check if on lasso selection (strokes or images)
            if (typeof lassoSelection !== 'undefined' &&
               (lassoSelection.strokes.length > 0 || lassoSelection.images.length > 0)) {
                if (typeof pointInSelectionBounds === 'function' && pointInSelectionBounds(canvasX, canvasY)) {
                    return true;
                }
            }

            // Empty area - allow paste if clipboard has content
            const hasClipboard = clipboardData.strokes.length > 0 ||
                                 clipboardData.images.length > 0;
            if (hasClipboard) {
                return true;
            }

            return false;
        }

        // Initialize on load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initContextMenu);
        } else {
            initContextMenu();
        }
