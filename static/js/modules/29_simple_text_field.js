// ============== Simple Text Field Module ==============
// Editable text fields with keyboard typing (PowerPoint-style)

const SimpleTextField = (function() {
    'use strict';

    const settings = {
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        fontSize: 24,
        minFontSize: 8,
        maxFontSize: 200,
        lineHeight: 1.25,
        paddingX: 12,
        paddingY: 10,
        minWidth: 80,
        minHeight: 40,
        handleSize: 12,
        dragBarHeight: 18
    };
    const TAB_SIZE = 8;

    let textFields = [];
    let activeField = null;
    let cursorVisible = true;
    let cursorInterval = null;

    let isDragging = false;
    let isResizing = false;
    let dragStart = null;
    let resizeStart = null;

    // Triple-tap detection for touch selection
    let tapHistory = [];
    const TRIPLE_TAP_TIMEOUT = 500;
    const TRIPLE_TAP_DISTANCE = 40;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    const fontMeasureCaches = new Map();

    function getMeasureCacheForFont(ctx) {
        const font = ctx.font || '';
        let cache = fontMeasureCaches.get(font);
        if (!cache) {
            cache = {
                charWidths: new Map(),
                textWidths: new Map(),
                textChars: 0,
                spaceWidth: null
            };
            fontMeasureCaches.set(font, cache);
            if (fontMeasureCaches.size > 32) {
                const firstKey = fontMeasureCaches.keys().next().value;
                fontMeasureCaches.delete(firstKey);
            }
        } else {
            // Keep the fonts actually in use warm, not just the newest fonts.
            fontMeasureCaches.delete(font);fontMeasureCaches.set(font,cache);
        }
        return cache;
    }

    function measurePlainTextCached(ctx, text) {
        if (!text) return 0;
        const cache = getMeasureCacheForFont(ctx);
        if (cache.textWidths.has(text)) {
            const width=cache.textWidths.get(text);
            cache.textWidths.delete(text);cache.textWidths.set(text,width);
            return width;
        }
        const width = ctx.measureText(text).width;
        if(text.length<=4096){
            cache.textWidths.set(text, width);cache.textChars+=text.length;
            // Retaining thousands of successively typed paragraph strings was
            // expensive, and clearing the entire cache caused periodic replay
            // cliffs. Incremental LRU eviction keeps hot widths and exact text.
            while(cache.textWidths.size>4096||cache.textChars>131072){
                const oldest=cache.textWidths.keys().next().value;
                cache.textChars-=oldest.length;cache.textWidths.delete(oldest);
            }
        }
        return width;
    }

    function init() {
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keypress', handleKeyPress);
        document.addEventListener('paste', handlePaste);
    }

    function setTextFields(fields) {
        textFields = Array.isArray(fields) ? fields.map(f => ({ ...f })) : [];
        activeField = null;
        stopCursorBlink();
    }

    function getTextFields() {
        return textFields;
    }

    function hasActiveField() {
        return activeField !== null;
    }

    function getFontSpec(field) {
        const size = field.fontSize || settings.fontSize;
        return `${size}px ${settings.fontFamily}`;
    }

    function getLayoutCacheKey(field) {
        return [
            field.text || '',
            field.fontSize || settings.fontSize,
            field.width || settings.minWidth
        ].join('|');
    }

    function getBoundsCacheKey(field, layoutKey) {
        return [
            layoutKey,
            field.height || settings.minHeight,
            field.autoHeight === false ? 'fixed' : 'auto'
        ].join('|');
    }

    function getSpaceWidthPx(ctx) {
        const cache = getMeasureCacheForFont(ctx);
        if (cache.spaceWidth === null) {
            cache.spaceWidth = Math.max(1, measurePlainTextCached(ctx, ' '));
        }
        return cache.spaceWidth;
    }

    function getTabStopWidthPx(ctx) {
        return getSpaceWidthPx(ctx) * TAB_SIZE;
    }

    function getCharAdvanceWithTabs(ctx, char, currentX) {
        if (char === '\t') {
            const tabStopWidth = getTabStopWidthPx(ctx);
            const nextTabStop = (Math.floor(currentX / tabStopWidth) + 1) * tabStopWidth;
            return Math.max(1, nextTabStop - currentX);
        }
        const cache = getMeasureCacheForFont(ctx);
        if (cache.charWidths.has(char)) {
            const width=cache.charWidths.get(char);
            cache.charWidths.delete(char);cache.charWidths.set(char,width);
            return width;
        }
        const width = measurePlainTextCached(ctx, char);
        cache.charWidths.set(char, width);
        if (cache.charWidths.size > 512) {
            cache.charWidths.delete(cache.charWidths.keys().next().value);
        }
        return width;
    }

    function measureTextWithTabs(ctx, text, startX = 0) {
        if (!text) return 0;
        if (text.indexOf('\t') === -1) {
            return measurePlainTextCached(ctx, text);
        }

        let x = startX;
        let segment = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '\t') {
                if (segment) {
                    x += measurePlainTextCached(ctx, segment);
                    segment = '';
                }
                x += getCharAdvanceWithTabs(ctx, '\t', x);
                continue;
            }
            segment += char;
        }
        if (segment) x += measurePlainTextCached(ctx, segment);
        return x - startX;
    }

    function drawTextWithTabs(ctx, text, x, y) {
        let cursorX = x;
        let segment = '';

        const flush = () => {
            if (!segment) return;
            ctx.fillText(segment, cursorX, y);
            cursorX += measurePlainTextCached(ctx, segment);
            segment = '';
        };

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '\t') {
                flush();
                const relativeX = cursorX - x;
                cursorX += getCharAdvanceWithTabs(ctx, '\t', relativeX);
            } else {
                segment += char;
            }
        }

        flush();
    }

    function buildLayout(field) {
        const layoutKey = getLayoutCacheKey(field);
        if (field._layoutCacheKey === layoutKey && field._layoutCache) {
            return field._layoutCache;
        }

        const ctx = measureCtx;
        ctx.font = getFontSpec(field);

        const maxWidth = Math.max(field.width || settings.minWidth, settings.minWidth);
        const tokens = field.text.match(/\n|[^\s]+|\s+/g) || [];

        const lines = [];
        let lineText = '';
        let lineWidth = 0;
        let maxContentWidth = 0;
        let lineStart = 0;
        let index = 0;

        const pushLine = (endIndex) => {
            const width = lineText ? lineWidth : 0;
            lines.push({ text: lineText, startIndex: lineStart, endIndex, width });
            maxContentWidth = Math.max(maxContentWidth, width);
            lineText = '';
            lineWidth = 0;
            lineStart = endIndex;
        };

        for (const token of tokens) {
            if (token === '\n') {
                pushLine(index);
                index += 1;
                lineStart = index;
                continue;
            }

            const tokenWidth = measureTextWithTabs(ctx, token, lineWidth);
            if (lineText && lineWidth + tokenWidth > maxWidth) {
                pushLine(index);
            }

            lineText += token;
            lineWidth += tokenWidth;
            index += token.length;
        }

        if (lineText || field.text.endsWith('\n') || lines.length === 0) {
            pushLine(index);
        }

        const lineHeightPx = (field.fontSize || settings.fontSize) * settings.lineHeight;
        const layout = { lines, lineHeight: lineHeightPx, maxWidth, maxContentWidth };
        field._layoutCacheKey = layoutKey;
        field._layoutCache = layout;
        return layout;
    }

    function getFieldBounds(field) {
        const layout = buildLayout(field);
        const boundsKey = getBoundsCacheKey(field, field._layoutCacheKey || getLayoutCacheKey(field));
        if (field._boundsCacheKey === boundsKey && field._boundsCache) {
            return field._boundsCache;
        }

        const contentWidth = layout.maxContentWidth || 0;
        const width = Math.max(field.width || contentWidth + settings.paddingX * 2, settings.minWidth);
        const contentHeight = layout.lines.length * layout.lineHeight;
        const height = Math.max(
            field.autoHeight === false ? (field.height || settings.minHeight) : contentHeight + settings.paddingY * 2,
            settings.minHeight,
            contentHeight + settings.paddingY * 2
        );

        const bounds = {
            x: field.x,
            y: field.y,
            width,
            height,
            layout
        };
        field._boundsCacheKey = boundsKey;
        field._boundsCache = bounds;
        return bounds;
    }

    function createTextField(x, y) {
        const field = {
            id: Date.now() + Math.random(),
            x,
            y,
            text: '',
            cursorPos: 0,
            fontSize: settings.fontSize,
            color: typeof currentColor !== 'undefined' ? currentColor : '#ffffff',
            width: 240,
            height: 80,
            autoHeight: true
        };

        textFields.push(field);
        activeField = field;
        startCursorBlink();
        if (typeof redrawCanvas === 'function') redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
        return field;
    }

    function getFieldAtPosition(x, y) {
        for (const field of textFields) {
            const bounds = getFieldBounds(field);
            if (x >= bounds.x && x <= bounds.x + bounds.width &&
                y >= bounds.y && y <= bounds.y + bounds.height) {
                return field;
            }
        }
        return null;
    }

    function getCursorPosAtPoint(field, clickX, clickY) {
        const bounds = getFieldBounds(field);
        const layout = bounds.layout;
        const ctx = measureCtx;
        ctx.font = getFontSpec(field);

        const relX = clickX - bounds.x - settings.paddingX;
        const relY = clickY - bounds.y - settings.paddingY;
        const lineIndex = Math.max(0, Math.min(layout.lines.length - 1, Math.floor(relY / layout.lineHeight)));
        const line = layout.lines[lineIndex];

        let cursorIndex = line.startIndex;
        let accWidth = 0;
        for (let i = 0; i < line.text.length; i++) {
            const char = line.text[i];
            const charWidth = getCharAdvanceWithTabs(ctx, char, accWidth);
            const mid = accWidth + charWidth / 2;
            if (relX < mid) {
                cursorIndex = line.startIndex + i;
                return cursorIndex;
            }
            accWidth += charWidth;
        }

        return line.endIndex;
    }

    function getCursorCoords(field, layout) {
        const ctx = measureCtx;
        ctx.font = getFontSpec(field);

        let lineIndex = 0;
        for (let i = 0; i < layout.lines.length; i++) {
            const line = layout.lines[i];
            if (activeField.cursorPos >= line.startIndex && activeField.cursorPos <= line.endIndex) {
                lineIndex = i;
                break;
            }
        }

        const line = layout.lines[lineIndex];
        const localIndex = Math.max(0, activeField.cursorPos - line.startIndex);
        const prefix = line.text.slice(0, localIndex);
        const prefixWidth = prefix ? measureTextWithTabs(ctx, prefix) : 0;

        return {
            x: field.x + settings.paddingX + prefixWidth,
            y: field.y + settings.paddingY + lineIndex * layout.lineHeight,
            height: layout.lineHeight
        };
    }

    function draw(ctx) {
        for (const field of textFields) {
            drawField(ctx, field, field === activeField);
        }
    }

    function drawPreview(ctx, fields) {
        for (const field of fields || []) {
            const color = typeof getThemedColor === 'function' ? getThemedColor(field.color || '#ffffff') : field.color || '#ffffff';
            drawField(ctx, { ...field, color }, false);
        }
    }

    function drawField(ctx, field, isActive) {
        const bounds = getFieldBounds(field);
        const layout = bounds.layout;
        const currentZoom = window.zoom || 1;

        ctx.save();
        ctx.font = getFontSpec(field);
        ctx.textBaseline = 'top';

        if (isActive) {
            const colors=getSelectionThemePalette(),chrome=getCanvasThemePalette().ui;
            ctx.fillStyle = chrome.surface;
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2 / currentZoom;
            ctx.beginPath();
            ctx.roundRect(
                bounds.x - 6 / currentZoom,
                bounds.y - 6 / currentZoom,
                bounds.width + 12 / currentZoom,
                bounds.height + 12 / currentZoom,
                8 / currentZoom
            );
            ctx.fill();
            ctx.stroke();

            // Drag bar
            ctx.fillStyle = colors.accent;
            const barHeight = settings.dragBarHeight / currentZoom;
            ctx.fillRect(
                bounds.x + bounds.width * 0.25,
                bounds.y - barHeight - 2 / currentZoom,
                bounds.width * 0.5,
                barHeight
            );

            // Resize handle (bottom-right)
            const handleSize = settings.handleSize / currentZoom;
            ctx.fillStyle = colors.accent;
            ctx.beginPath();
            ctx.roundRect(
                bounds.x + bounds.width - handleSize,
                bounds.y + bounds.height - handleSize,
                handleSize,
                handleSize,
                3 / currentZoom
            );
            ctx.fill();
        }

        ctx.fillStyle = field.color || '#ffffff';
        layout.lines.forEach((line, idx) => {
            const x = bounds.x + settings.paddingX;
            const y = bounds.y + settings.paddingY + idx * layout.lineHeight;
            drawTextWithTabs(ctx, line.text, x, y);
        });

        if (isActive && cursorVisible) {
            const cursor = getCursorCoords(field, layout);
            ctx.strokeStyle = field.color || '#ffffff';
            ctx.lineWidth = 2 / currentZoom;
            ctx.beginPath();
            ctx.moveTo(cursor.x, cursor.y);
            ctx.lineTo(cursor.x, cursor.y + cursor.height);
            ctx.stroke();
        }

        ctx.restore();
    }

    function handleCanvasClick(screenX, screenY) {
        const currentZoom = window.zoom || 1;
        const currentPanX = window.panX || 0;
        const currentPanY = window.panY || 0;

        const canvasX = (screenX - currentPanX) / currentZoom;
        const canvasY = (screenY - currentPanY) / currentZoom;

        const existingField = getFieldAtPosition(canvasX, canvasY);
        if (existingField) {
            activeField = existingField;
            activeField.cursorPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
            startCursorBlink();
            if (typeof setColor === 'function' && activeField.color) {
                setColor(activeField.color, true);
            }
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        createTextField(canvasX, canvasY);
        return true;
    }

    function handlePointerDown(e, canvasX, canvasY, canvas) {
        if (e.pointerType === 'pen') return false;
        if (e.pointerType === 'touch' && e.isPrimary === false) return false;

        // Touch selection guard: track taps for triple-tap detection
        const isTouch = e.pointerType === 'touch';
        if (isTouch) {
            const now = Date.now();
            tapHistory.push({ time: now, x: canvasX, y: canvasY });
            tapHistory = tapHistory.filter(t => now - t.time < TRIPLE_TAP_TIMEOUT * 3);
        }

        function isTripleTap() {
            if (tapHistory.length < 3) return false;
            const recent = tapHistory.slice(-3);
            const timeDiffs = [
                recent[1].time - recent[0].time,
                recent[2].time - recent[1].time
            ];
            if (timeDiffs[0] > TRIPLE_TAP_TIMEOUT || timeDiffs[1] > TRIPLE_TAP_TIMEOUT) return false;
            for (let i = 0; i < 2; i++) {
                const dx = recent[i + 1].x - recent[i].x;
                const dy = recent[i + 1].y - recent[i].y;
                if (Math.sqrt(dx * dx + dy * dy) > TRIPLE_TAP_DISTANCE) return false;
            }
            return true;
        }

        const touchAllowed = !isTouch || isTripleTap();

        const currentZoom = window.zoom || 1;
        const handleSize = settings.handleSize / currentZoom;
        const dragHeight = settings.dragBarHeight / currentZoom;

        if (activeField) {
            const bounds = getFieldBounds(activeField);
            const resizeX = bounds.x + bounds.width - handleSize;
            const resizeY = bounds.y + bounds.height - handleSize;

            if (canvasX >= resizeX && canvasX <= resizeX + handleSize &&
                canvasY >= resizeY && canvasY <= resizeY + handleSize) {
                isResizing = true;
                resizeStart = {
                    x: canvasX,
                    y: canvasY,
                    width: bounds.width,
                    height: bounds.height
                };
                canvas.setPointerCapture(e.pointerId);
                return true;
            }

            if (canvasY >= bounds.y - dragHeight && canvasY <= bounds.y &&
                canvasX >= bounds.x && canvasX <= bounds.x + bounds.width) {
                isDragging = true;
                dragStart = {
                    x: canvasX,
                    y: canvasY,
                    fieldX: activeField.x,
                    fieldY: activeField.y
                };
                canvas.setPointerCapture(e.pointerId);
                return true;
            }

            if (canvasX >= bounds.x && canvasX <= bounds.x + bounds.width &&
                canvasY >= bounds.y && canvasY <= bounds.y + bounds.height) {
                activeField.cursorPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
                startCursorBlink();
                if (typeof redrawCanvas === 'function') redrawCanvas();
                return true;
            }

            // Click outside - deselect
            activeField = null;
            stopCursorBlink();
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return false;
        }

        // Block touch selection unless triple-tap
        if (!touchAllowed) return false;

        const field = getFieldAtPosition(canvasX, canvasY);
        if (field) {
            activeField = field;
            activeField.cursorPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
            startCursorBlink();
            if (typeof setColor === 'function' && activeField.color) {
                setColor(activeField.color, true);
            }
            if (typeof redrawCanvas === 'function') redrawCanvas();
            // Clear tap history after successful triple-tap selection
            if (isTouch) tapHistory = [];
            return true;
        }

        return false;
    }

    function handlePointerMove(e) {
        if (!activeField) return false;

        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const currentZoom = window.zoom || 1;
        const currentPanX = window.panX || 0;
        const currentPanY = window.panY || 0;

        const canvasX = (e.clientX - rect.left - currentPanX) / currentZoom;
        const canvasY = (e.clientY - rect.top - currentPanY) / currentZoom;

        if (isDragging && dragStart) {
            const deltaX = canvasX - dragStart.x;
            const deltaY = canvasY - dragStart.y;
            activeField.x = dragStart.fieldX + deltaX;
            activeField.y = dragStart.fieldY + deltaY;

            // Check if dragging over recycle bin
            if (typeof updateTrashHover === 'function') {
                updateTrashHover(e.clientX, e.clientY);
            }

            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        if (isResizing && resizeStart) {
            const newWidth = Math.max(settings.minWidth, resizeStart.width + (canvasX - resizeStart.x));
            const newHeight = Math.max(settings.minHeight, resizeStart.height + (canvasY - resizeStart.y));
            activeField.width = newWidth;
            activeField.height = newHeight;
            activeField.autoHeight = false;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        return false;
    }

    function handlePointerUp(e) {
        let handled = false;

        if (isDragging) {
            // Check if dropped on recycle bin
            if (e && typeof isOverRecycleBin === 'function' && isOverRecycleBin(e.clientX, e.clientY)) {
                if (typeof playTrashSuckAnimation === 'function') {
                    playTrashSuckAnimation(e.clientX, e.clientY, () => {
                        textFields = textFields.filter(f => f.id !== activeField.id);
                        activeField = null;
                        stopCursorBlink();
                        if (typeof redrawCanvas === 'function') redrawCanvas();
                        if (typeof triggerAutoSave === 'function') triggerAutoSave();
                    });
                } else {
                    textFields = textFields.filter(f => f.id !== activeField.id);
                    activeField = null;
                    stopCursorBlink();
                    if (typeof redrawCanvas === 'function') redrawCanvas();
                    if (typeof triggerAutoSave === 'function') triggerAutoSave();
                }
                isDragging = false;
                dragStart = null;
                if (e.target && e.target.releasePointerCapture) {
                    try { e.target.releasePointerCapture(e.pointerId); } catch (ex) {}
                }
                return true;
            }

            if (typeof clearTrashHover === 'function') clearTrashHover();
            isDragging = false;
            dragStart = null;
            handled = true;
        }

        if (isResizing) {
            isResizing = false;
            resizeStart = null;
            handled = true;
        }

        if (handled && e.target && e.target.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch (ex) {}
        }

        if (handled && typeof triggerAutoSave === 'function') triggerAutoSave();
        return handled;
    }

    // Selection helpers for SimpleTextField
    function hasSelection() {
        return activeField &&
               activeField.selectionStart !== undefined &&
               activeField.selectionEnd !== undefined &&
               activeField.selectionStart !== activeField.selectionEnd;
    }

    function clearSelection() {
        if (activeField) {
            activeField.selectionStart = undefined;
            activeField.selectionEnd = undefined;
        }
    }

    function getSelectedText() {
        if (!hasSelection()) return '';
        const start = Math.min(activeField.selectionStart, activeField.selectionEnd);
        const end = Math.max(activeField.selectionStart, activeField.selectionEnd);
        return activeField.text.slice(start, end);
    }

    function deleteSelection() {
        if (!hasSelection()) return;
        const start = Math.min(activeField.selectionStart, activeField.selectionEnd);
        const end = Math.max(activeField.selectionStart, activeField.selectionEnd);
        activeField.text = activeField.text.slice(0, start) + activeField.text.slice(end);
        activeField.cursorPos = start;
        clearSelection();
    }

    function handleKeyDown(e) {
        if (!activeField) return;
        if(e.target instanceof Element&&e.target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"],[role="button"]'))return;

        // Ctrl+A - Select all
        if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            activeField.selectionStart = 0;
            activeField.selectionEnd = activeField.text.length;
            activeField.cursorPos = activeField.text.length;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return;
        }

        // Ctrl+C - Copy
        if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            const text = hasSelection() ? getSelectedText() : activeField.text;
            if (text) {
                navigator.clipboard.writeText(text).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                });
            }
            return;
        }

        // Ctrl+X - Cut
        if (e.key === 'x' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (hasSelection()) {
                const text = getSelectedText();
                if (text) {
                    navigator.clipboard.writeText(text).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    });
                    deleteSelection();
                    if (typeof redrawCanvas === 'function') redrawCanvas();
                    if (typeof triggerAutoSave === 'function') triggerAutoSave();
                }
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            activeField.fontSize = Math.min(settings.maxFontSize, (activeField.fontSize || settings.fontSize) + 2);
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === '-') {
            e.preventDefault();
            activeField.fontSize = Math.max(settings.minFontSize, (activeField.fontSize || settings.fontSize) - 2);
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return;
        }

        if (e.key === 'Backspace') {
            e.preventDefault();
            if (hasSelection()) {
                deleteSelection();
            } else if (activeField.cursorPos > 0) {
                activeField.text =
                    activeField.text.slice(0, activeField.cursorPos - 1) +
                    activeField.text.slice(activeField.cursorPos);
                activeField.cursorPos--;
            }
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return;
        }

        if (e.key === 'Delete') {
            e.preventDefault();
            if (hasSelection()) {
                deleteSelection();
            } else if (activeField.cursorPos < activeField.text.length) {
                activeField.text =
                    activeField.text.slice(0, activeField.cursorPos) +
                    activeField.text.slice(activeField.cursorPos + 1);
            }
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (hasSelection()) deleteSelection();
            activeField.text =
                activeField.text.slice(0, activeField.cursorPos) +
                '\n' +
                activeField.text.slice(activeField.cursorPos);
            activeField.cursorPos++;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            if (hasSelection()) deleteSelection();
            activeField.text =
                activeField.text.slice(0, activeField.cursorPos) +
                '\t' +
                activeField.text.slice(activeField.cursorPos);
            activeField.cursorPos += 1;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            activeField = null;
            stopCursorBlink();
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return;
        }

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            activeField.cursorPos = Math.max(0, activeField.cursorPos - 1);
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return;
        }

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            activeField.cursorPos = Math.min(activeField.text.length, activeField.cursorPos + 1);
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            moveCursorVertically(e.key === 'ArrowUp' ? -1 : 1);
        }
    }

    function getTabInsertionText() {
        return '\t';
    }

    function handleKeyPress(e) {
        if (!activeField || e.ctrlKey || e.metaKey) return;
        if(e.target instanceof Element&&e.target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"],[role="button"]'))return;

        const char = e.key;
        if (char.length !== 1) return;

        e.preventDefault();
        if (hasSelection()) deleteSelection();
        activeField.text =
            activeField.text.slice(0, activeField.cursorPos) +
            char +
            activeField.text.slice(activeField.cursorPos);
        activeField.cursorPos++;
        if (typeof redrawCanvas === 'function') redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    function handlePaste(e) {
        if (!activeField) return;
        if(e.target instanceof Element&&e.target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"],[role="button"]'))return;

        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;

        if (hasSelection()) deleteSelection();
        activeField.text =
            activeField.text.slice(0, activeField.cursorPos) +
            text +
            activeField.text.slice(activeField.cursorPos);
        activeField.cursorPos += text.length;
        if (typeof redrawCanvas === 'function') redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    function moveCursorVertically(direction) {
        if (!activeField) return;

        const layout = buildLayout(activeField);
        let lineIndex = 0;
        for (let i = 0; i < layout.lines.length; i++) {
            const line = layout.lines[i];
            if (activeField.cursorPos >= line.startIndex && activeField.cursorPos <= line.endIndex) {
                lineIndex = i;
                break;
            }
        }

        const targetLineIndex = Math.max(0, Math.min(layout.lines.length - 1, lineIndex + direction));
        const currentLine = layout.lines[lineIndex];
        const targetLine = layout.lines[targetLineIndex];

        const ctx = measureCtx;
        ctx.font = getFontSpec(activeField);
        const localIndex = Math.max(0, activeField.cursorPos - currentLine.startIndex);
        const prefix = currentLine.text.slice(0, localIndex);
        const targetX = prefix ? measureTextWithTabs(ctx, prefix) : 0;

        let accWidth = 0;
        let newIndex = targetLine.startIndex;
        for (let i = 0; i < targetLine.text.length; i++) {
            const charWidth = getCharAdvanceWithTabs(ctx, targetLine.text[i], accWidth);
            if (accWidth + charWidth / 2 >= targetX) {
                newIndex = targetLine.startIndex + i;
                activeField.cursorPos = newIndex;
                if (typeof redrawCanvas === 'function') redrawCanvas();
                return;
            }
            accWidth += charWidth;
        }

        activeField.cursorPos = targetLine.endIndex;
        if (typeof redrawCanvas === 'function') redrawCanvas();
    }

    function startCursorBlink() {
        stopCursorBlink();
        cursorVisible = true;
        cursorInterval = setInterval(() => {
            if(document.hidden||window.DialogFocus?.active)return;
            cursorVisible = !cursorVisible;
            if (typeof redrawCanvas === 'function') redrawCanvas();
        }, 530);
    }

    function stopCursorBlink() {
        if (cursorInterval) {
            clearInterval(cursorInterval);
            cursorInterval = null;
        }
        cursorVisible = true;
    }

    function setActiveColor(color) {
        if (!activeField) return;
        activeField.color = color;
        if (typeof redrawCanvas === 'function') redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    // Initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 50);
    }

    return {
        handleCanvasClick,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        draw,
        drawPreview,
        createTextField,
        setTextFields,
        getTextFields,
        setActiveColor,
        hasActiveField,
        get isDragging() { return isDragging; },
        get isResizing() { return isResizing; }
    };
})();

window.SimpleTextField = SimpleTextField;
