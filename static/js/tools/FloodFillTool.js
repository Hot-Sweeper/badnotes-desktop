/**
 * FloodFillTool - Reliable flood fill for closed shapes
 *
 * How it works:
 * 1. FIRST: Check if click is inside any closed stroke path (vector-based)
 * 2. If found, use that stroke's path as fill boundary
 * 3. FALLBACK: Pixel flood fill with edge detection
 *
 * A stroke is "closed" if its start and end points are close together.
 */
class FloodFillTool {
    constructor(options = {}) {
        this.canvasManager = options.canvasManager;
        this.isFilling = false;

        // Configuration
        this.tolerance = 32;          // Color matching tolerance (0-255)
        this.minAreaPixels = 100;     // Minimum fill area to be considered valid
        this.simplifyTolerance = 2;   // Douglas-Peucker simplification tolerance
        this.animationSpeed = 15;     // Animation frames to complete
        this.closeThreshold = 50;     // Max distance between start/end to consider closed
    }

    /**
     * Fill at a specific point with animation
     * @param {number} x - X position relative to canvas-container
     * @param {number} y - Y position relative to canvas-container
     * @param {string} color - Fill color
     * @param {HTMLElement} canvasContainer - The canvas container element
     */
    fillAt(x, y, color, canvasContainer) {
        if (this.isFilling) return;

        if (this.canvasManager) {
            this.performFill(x, y, color, canvasContainer);
        }
    }

    /**
     * Main fill operation
     */
    performFill(containerX, containerY, fillColor, container) {
        if (!this.canvasManager) return;

        const canvas = this.canvasManager.mainCanvas;
        const wrapper = this.canvasManager.wrapper;
        if (!canvas || !wrapper) return;

        // Convert to canvas logical coordinates
        const coords = this._containerToLogicalCoords(containerX, containerY, container, canvas);
        if (!coords) return;

        const { logicalX, logicalY } = coords;

        // STEP 1: Try vector-based fill (check if inside any closed stroke)
        const closedStroke = this._findClosedStrokeAtPoint(logicalX, logicalY);

        if (closedStroke) {
            this.isFilling = true;
            this._fillFromStroke(closedStroke, fillColor, container, canvas);
            return;
        }

        // STEP 2: Fallback to pixel-based flood fill
        this._performPixelFill(containerX, containerY, fillColor, container, canvas);
    }

    /**
     * Find a closed stroke that contains the given point
     */
    _findClosedStrokeAtPoint(x, y) {
        // Try multiple sources for strokes:
        // 1. Global strokes array (from old modules system)
        // 2. CanvasManager.strokes (from new system)
        let strokesArray = null;

        if (typeof strokes !== 'undefined' && Array.isArray(strokes)) {
            strokesArray = strokes;  // Global strokes from modules
        } else if (this.canvasManager && Array.isArray(this.canvasManager.strokes)) {
            strokesArray = this.canvasManager.strokes;
        }

        if (!strokesArray || strokesArray.length === 0) {
            return null;
        }

        // Search from top (newest) to bottom (oldest)
        for (let i = strokesArray.length - 1; i >= 0; i--) {
            const stroke = strokesArray[i];

            // Skip fills
            if (stroke.isFill || stroke.type === 'fill') continue;

            // Need at least 3 points
            if (!stroke.points || stroke.points.length < 3) continue;

            const points = stroke.points;
            const start = points[0];
            const end = points[points.length - 1];

            // Check if stroke is closed (start and end are close)
            const dist = Math.sqrt(
                Math.pow(end.x - start.x, 2) +
                Math.pow(end.y - start.y, 2)
            );

            // Use adaptive threshold based on stroke size
            const bounds = this._getStrokeBounds(points);
            const strokeSize = Math.max(bounds.width, bounds.height);
            const threshold = Math.max(this.closeThreshold, strokeSize * 0.15);

            if (dist < threshold) {
                // Check if point is inside this closed path
                const isInside = this._isPointInPolygon(x, y, points);
                if (isInside) {
                    return stroke;
                }
            }
        }

        return null;
    }

    /**
     * Point-in-polygon test using ray casting algorithm
     */
    _isPointInPolygon(x, y, points) {
        let inside = false;
        const n = points.length;

        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;

            if (((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    /**
     * Get bounding box of points
     */
    _getStrokeBounds(points) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }

        return {
            minX, minY, maxX, maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Fill using the stroke's path directly (vector-based)
     */
    _fillFromStroke(stroke, fillColor, container, canvas) {
        const points = stroke.points;

        // Create fill stroke using the original stroke's path
        const fillStroke = {
            id: `fill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'fill',
            color: fillColor,
            fillColor: fillColor,
            points: points.map(p => ({ x: p.x, y: p.y })),
            isFill: true,
            opacity: 1,
            size: 0,
            originalStrokeId: stroke.id,
            timestamp: Date.now()
        };

        // Show animation
        this._animateFillFromStroke(stroke, fillColor, container, canvas, () => {
            // Add fill stroke to canvas
            if (this.canvasManager && typeof this.canvasManager.addStroke === 'function') {
                this.canvasManager.addStroke(fillStroke, true);
            }

            if (this.canvasManager && this.canvasManager.emit) {
                this.canvasManager.emit('fillCreated', fillStroke);
            }

            this.isFilling = false;
        });

        this._showToast('Shape filled!', 'success');
    }

    /**
     * Animate fill expanding from center of stroke
     */
    _animateFillFromStroke(stroke, fillColor, container, canvas, onComplete) {
        const points = stroke.points;
        const bounds = this._getStrokeBounds(points);

        // Calculate center
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        // Get canvas wrapper for proper positioning
        const wrapper = canvas.parentElement;
        if (!wrapper) {
            onComplete();
            return;
        }

        // Create animation canvas
        const animCanvas = document.createElement('canvas');
        const logicalWidth = parseFloat(canvas.style.width) || canvas.width;
        const logicalHeight = parseFloat(canvas.style.height) || canvas.height;

        animCanvas.width = canvas.width;
        animCanvas.height = canvas.height;
        animCanvas.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: ${logicalWidth}px;
            height: ${logicalHeight}px;
            pointer-events: none;
            z-index: 100;
        `;

        wrapper.appendChild(animCanvas);
        const ctx = animCanvas.getContext('2d');

        // Scale factor
        const dpr = this.canvasManager.dpr || window.devicePixelRatio || 1;
        let zoom = 1;
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            zoom = ViewportManager.state.zoom;
        }
        const scale = Math.min(dpr * zoom, 4.0);

        // Animation parameters
        const maxRadius = Math.sqrt(
            Math.pow(bounds.width, 2) + Math.pow(bounds.height, 2)
        ) / 2 + 20;

        let radius = 0;
        const speed = maxRadius / this.animationSpeed;
        let fillApplied = false;

        const animate = () => {
            radius += speed;

            ctx.clearRect(0, 0, animCanvas.width, animCanvas.height);
            ctx.save();
            ctx.scale(scale, scale);

            // Draw expanding circle
            ctx.fillStyle = fillColor;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.fill();

            // Clip to stroke path
            ctx.globalCompositeOperation = 'destination-in';
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.closePath();
            ctx.fill('evenodd');

            ctx.restore();

            // Apply fill at 70%
            if (!fillApplied && radius > maxRadius * 0.7) {
                fillApplied = true;
                onComplete();
            }

            if (radius < maxRadius) {
                requestAnimationFrame(animate);
            } else {
                setTimeout(() => animCanvas.remove(), 100);
            }
        };

        animate();
    }

    /**
     * Convert container coordinates to logical canvas coordinates
     */
    _containerToLogicalCoords(containerX, containerY, container, canvas) {
        const containerRect = container.getBoundingClientRect();
        const screenX = containerX + containerRect.left;
        const screenY = containerY + containerRect.top;
        const canvasRect = canvas.getBoundingClientRect();

        const canvasRelX = screenX - canvasRect.left;
        const canvasRelY = screenY - canvasRect.top;

        if (canvasRelX < 0 || canvasRelX > canvasRect.width ||
            canvasRelY < 0 || canvasRelY > canvasRect.height) {
            return null;
        }

        // Convert to logical coordinates (accounting for zoom/pan)
        const logicalWidth = parseFloat(canvas.style.width) || canvas.width;
        const logicalHeight = parseFloat(canvas.style.height) || canvas.height;

        const logicalX = (canvasRelX / canvasRect.width) * logicalWidth;
        const logicalY = (canvasRelY / canvasRect.height) * logicalHeight;

        return { logicalX, logicalY };
    }

    /**
     * Fallback: Pixel-based flood fill
     */
    _performPixelFill(containerX, containerY, fillColor, container, canvas) {
        // Get context from canvas (CanvasManager doesn't expose mainContext)
        const ctx = canvas.getContext('2d');

        // Convert container coordinates to canvas internal coordinates
        const coords = this._containerToCanvasCoords(containerX, containerY, container, canvas);
        if (!coords) return;

        const { canvasX, canvasY, internalWidth, internalHeight, logicalWidth, logicalHeight } = coords;

        // Get image data for analysis
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const imageData = ctx.getImageData(0, 0, internalWidth, internalHeight);
        ctx.restore();

        const data = imageData.data;

        // Get target color at click point
        const targetIndex = (canvasY * internalWidth + canvasX) * 4;
        const targetColor = {
            r: data[targetIndex],
            g: data[targetIndex + 1],
            b: data[targetIndex + 2],
            a: data[targetIndex + 3]
        };

        // Parse fill color
        const fill = this._parseColor(fillColor);

        // Don't fill if clicking on same color
        if (this._colorsMatch(targetColor, fill, 10)) {
            this._showToast('Already filled with this color', 'info');
            return;
        }

        this.isFilling = true;

        // Step 1: Flood fill to find the region and check if it's closed
        const floodResult = this._floodFillAnalysis(
            data, internalWidth, internalHeight,
            canvasX, canvasY, targetColor
        );

        if (!floodResult.isClosed) {
            this.isFilling = false;
            this._showToast('Shape is not closed - draw a complete boundary first', 'warning');
            return;
        }

        if (floodResult.pixelCount < this.minAreaPixels) {
            this.isFilling = false;
            this._showToast('Area too small to fill', 'info');
            return;
        }

        // Step 2: Trace the boundary contour
        const contour = this._traceBoundary(
            floodResult.mask, internalWidth, internalHeight,
            floodResult.bounds
        );

        if (!contour || contour.length < 3) {
            this.isFilling = false;
            this._showToast('Could not trace shape boundary', 'warning');
            return;
        }

        // Step 3: Simplify the contour (reduce points)
        const simplified = this._simplifyContour(contour, this.simplifyTolerance);

        // Step 4: Convert to logical canvas coordinates (for vector storage)
        const dpr = this.canvasManager.dpr || window.devicePixelRatio || 1;
        let zoom = 1;
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            zoom = ViewportManager.state.zoom;
        }
        const effectiveDpr = Math.min(dpr * zoom, 4.0);

        const vectorPoints = simplified.map(p => ({
            x: p.x / effectiveDpr,
            y: p.y / effectiveDpr
        }));

        // Step 5: Show animation and create the fill stroke
        this._animateFillAndCreate(
            canvasX, canvasY, fillColor,
            floodResult.mask, floodResult.bounds,
            internalWidth, internalHeight,
            logicalWidth, logicalHeight,
            canvas, ctx, vectorPoints
        );
    }

    /**
     * Convert container coordinates to internal canvas coordinates
     */
    _containerToCanvasCoords(containerX, containerY, container, canvas) {
        const containerRect = container.getBoundingClientRect();
        const screenX = containerX + containerRect.left;
        const screenY = containerY + containerRect.top;
        const canvasRect = canvas.getBoundingClientRect();

        const canvasRelX = screenX - canvasRect.left;
        const canvasRelY = screenY - canvasRect.top;

        if (canvasRelX < 0 || canvasRelX > canvasRect.width ||
            canvasRelY < 0 || canvasRelY > canvasRect.height) {
            return null;
        }

        const dpr = this.canvasManager.dpr || window.devicePixelRatio || 1;
        const internalWidth = canvas.width;
        const internalHeight = canvas.height;
        const logicalWidth = parseFloat(canvas.style.width) || (internalWidth / dpr);
        const logicalHeight = parseFloat(canvas.style.height) || (internalHeight / dpr);

        const scaleX = internalWidth / canvasRect.width;
        const scaleY = internalHeight / canvasRect.height;

        const canvasX = Math.floor(canvasRelX * scaleX);
        const canvasY = Math.floor(canvasRelY * scaleY);

        if (canvasX < 0 || canvasX >= internalWidth || canvasY < 0 || canvasY >= internalHeight) {
            return null;
        }

        return { canvasX, canvasY, internalWidth, internalHeight, logicalWidth, logicalHeight };
    }

    /**
     * Flood fill analysis - returns mask and checks if shape is closed
     */
    _floodFillAnalysis(data, width, height, startX, startY, targetColor) {
        const mask = new Uint8Array(width * height);
        const visited = new Uint8Array(width * height);

        // Use a queue for BFS flood fill
        const queue = [startX, startY];
        let qIndex = 0;

        visited[startY * width + startX] = 1;

        let minX = startX, maxX = startX, minY = startY, maxY = startY;
        let pixelCount = 0;
        let touchesEdge = false;

        while (qIndex < queue.length) {
            const cx = queue[qIndex++];
            const cy = queue[qIndex++];

            const idx = cy * width + cx;
            mask[idx] = 1;
            pixelCount++;

            // Update bounds
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            // Check if touching edge - means shape is NOT closed
            if (cx <= 1 || cx >= width - 2 || cy <= 1 || cy >= height - 2) {
                touchesEdge = true;
            }

            // Check 4-connected neighbors
            const neighbors = [
                [cx + 1, cy],
                [cx - 1, cy],
                [cx, cy + 1],
                [cx, cy - 1]
            ];

            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (visited[nIdx] === 0) {
                        const pixelIdx = nIdx * 4;
                        const r = data[pixelIdx];
                        const g = data[pixelIdx + 1];
                        const b = data[pixelIdx + 2];
                        const a = data[pixelIdx + 3];

                        if (this._colorsMatchRaw(r, g, b, a, targetColor, this.tolerance)) {
                            visited[nIdx] = 1;
                            queue.push(nx, ny);
                        }
                    }
                }
            }
        }

        return {
            mask,
            isClosed: !touchesEdge,
            pixelCount,
            bounds: { minX, maxX, minY, maxY }
        };
    }

    /**
     * Moore boundary tracing algorithm
     * Traces the outer boundary of a filled region
     */
    _traceBoundary(mask, width, height, bounds) {
        const { minX, maxX, minY, maxY } = bounds;
        const contour = [];

        // Find starting point - scan from top-left for first filled pixel
        let startX = -1, startY = -1;
        outer: for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (mask[y * width + x] === 1) {
                    startX = x;
                    startY = y;
                    break outer;
                }
            }
        }

        if (startX === -1) return null;

        // Moore neighbor offsets (8-connected, clockwise starting from left)
        const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
        const dy = [0, -1, -1, -1, 0, 1, 1, 1];

        let x = startX;
        let y = startY;
        let dir = 0; // Start looking left

        const maxIterations = (maxX - minX + 1) * (maxY - minY + 1) * 4;
        let iterations = 0;

        do {
            contour.push({ x, y });

            // Find next boundary pixel
            let found = false;
            for (let i = 0; i < 8; i++) {
                const checkDir = (dir + i) % 8;
                const nx = x + dx[checkDir];
                const ny = y + dy[checkDir];

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    if (mask[ny * width + nx] === 1) {
                        // Check if this pixel is on the boundary
                        // (has at least one non-filled neighbor)
                        let isBoundary = false;
                        for (let j = 0; j < 8; j++) {
                            const bx = nx + dx[j];
                            const by = ny + dy[j];
                            if (bx < 0 || bx >= width || by < 0 || by >= height ||
                                mask[by * width + bx] === 0) {
                                isBoundary = true;
                                break;
                            }
                        }

                        if (isBoundary) {
                            x = nx;
                            y = ny;
                            // Turn back to look behind where we came from
                            dir = (checkDir + 5) % 8;
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (!found) break;

            iterations++;
            if (iterations > maxIterations) break;

        } while (x !== startX || y !== startY || contour.length < 3);

        return contour;
    }

    /**
     * Douglas-Peucker line simplification
     */
    _simplifyContour(points, tolerance) {
        if (points.length <= 2) return points;

        // Find point with max distance from line between first and last
        let maxDist = 0;
        let maxIndex = 0;
        const first = points[0];
        const last = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this._pointLineDistance(points[i], first, last);
            if (dist > maxDist) {
                maxDist = dist;
                maxIndex = i;
            }
        }

        // If max distance is greater than tolerance, recursively simplify
        if (maxDist > tolerance) {
            const left = this._simplifyContour(points.slice(0, maxIndex + 1), tolerance);
            const right = this._simplifyContour(points.slice(maxIndex), tolerance);
            return left.slice(0, -1).concat(right);
        } else {
            return [first, last];
        }
    }

    /**
     * Distance from point to line segment
     */
    _pointLineDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const len2 = dx * dx + dy * dy;

        if (len2 === 0) {
            return Math.sqrt(
                Math.pow(point.x - lineStart.x, 2) +
                Math.pow(point.y - lineStart.y, 2)
            );
        }

        let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));

        const projX = lineStart.x + t * dx;
        const projY = lineStart.y + t * dy;

        return Math.sqrt(
            Math.pow(point.x - projX, 2) +
            Math.pow(point.y - projY, 2)
        );
    }

    /**
     * Animate fill and create the vector stroke
     */
    _animateFillAndCreate(
        canvasX, canvasY, fillColor,
        mask, bounds,
        internalWidth, internalHeight,
        logicalWidth, logicalHeight,
        canvas, ctx, vectorPoints
    ) {
        const { minX, maxX, minY, maxY } = bounds;

        // Create mask canvas for animation clipping
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = internalWidth;
        maskCanvas.height = internalHeight;
        const maskCtx = maskCanvas.getContext('2d');
        const maskImageData = maskCtx.createImageData(internalWidth, internalHeight);
        const maskData = maskImageData.data;

        for (let i = 0; i < mask.length; i++) {
            if (mask[i] === 1) {
                const idx = i * 4;
                maskData[idx] = 255;
                maskData[idx + 1] = 255;
                maskData[idx + 2] = 255;
                maskData[idx + 3] = 255;
            }
        }
        maskCtx.putImageData(maskImageData, 0, 0);

        // Calculate animation parameters
        const dists = [
            Math.hypot(canvasX - minX, canvasY - minY),
            Math.hypot(canvasX - maxX, canvasY - minY),
            Math.hypot(canvasX - minX, canvasY - maxY),
            Math.hypot(canvasX - maxX, canvasY - maxY)
        ];
        const maxRadius = Math.max(...dists) + 20;

        // Create overlay canvas
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = internalWidth;
        overlayCanvas.height = internalHeight;
        overlayCanvas.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: ${logicalWidth}px;
            height: ${logicalHeight}px;
            pointer-events: none;
            z-index: 100;
        `;

        const parent = canvas.parentElement;
        if (parent) parent.appendChild(overlayCanvas);

        const overlayCtx = overlayCanvas.getContext('2d');

        let radius = 0;
        const speed = maxRadius / this.animationSpeed;
        let strokeCreated = false;

        const animate = () => {
            radius += speed;

            overlayCtx.clearRect(0, 0, internalWidth, internalHeight);

            // Draw expanding circle
            overlayCtx.globalCompositeOperation = 'source-over';
            overlayCtx.fillStyle = fillColor;
            overlayCtx.beginPath();
            overlayCtx.arc(canvasX, canvasY, radius, 0, Math.PI * 2);
            overlayCtx.fill();

            // Clip to mask
            overlayCtx.globalCompositeOperation = 'destination-in';
            overlayCtx.drawImage(maskCanvas, 0, 0);

            // Create the stroke when animation is ~70% complete
            if (!strokeCreated && radius > maxRadius * 0.7) {
                strokeCreated = true;
                this._createFillStroke(vectorPoints, fillColor);
            }

            if (radius < maxRadius) {
                requestAnimationFrame(animate);
            } else {
                // Animation complete
                setTimeout(() => {
                    overlayCanvas.remove();
                    this.isFilling = false;
                }, 100);
            }
        };

        animate();

        // Show success feedback
        this._showToast('Shape filled!', 'success');
    }

    /**
     * Create the actual fill stroke/shape in CanvasManager
     */
    _createFillStroke(points, color) {
        // Close the path
        const closedPoints = [...points];
        if (points.length > 0) {
            const first = points[0];
            const last = points[points.length - 1];
            if (Math.abs(first.x - last.x) > 1 || Math.abs(first.y - last.y) > 1) {
                closedPoints.push({ ...first });
            }
        }

        // Create fill stroke object
        const fillStroke = {
            id: `fill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'fill',
            color: color,
            fillColor: color,
            points: closedPoints,
            isFill: true,
            opacity: 1,
            size: 0, // No stroke, just fill
            timestamp: Date.now()
        };

        // Add to canvas manager as a stroke
        if (this.canvasManager && typeof this.canvasManager.addStroke === 'function') {
            this.canvasManager.addStroke(fillStroke, true);
        }

        // Emit event
        if (this.canvasManager && this.canvasManager.emit) {
            this.canvasManager.emit('fillCreated', fillStroke);
        }
    }

    /**
     * Parse color string to RGBA
     */
    _parseColor(color) {
        const temp = document.createElement('div');
        temp.style.color = color;
        document.body.appendChild(temp);
        const computed = getComputedStyle(temp).color;
        document.body.removeChild(temp);

        const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            return {
                r: parseInt(match[1]),
                g: parseInt(match[2]),
                b: parseInt(match[3]),
                a: match[4] ? Math.round(parseFloat(match[4]) * 255) : 255
            };
        }
        return { r: 255, g: 255, b: 255, a: 255 };
    }

    /**
     * Check if colors match within tolerance
     */
    _colorsMatch(c1, c2, tolerance = 0) {
        return Math.abs(c1.r - c2.r) <= tolerance &&
               Math.abs(c1.g - c2.g) <= tolerance &&
               Math.abs(c1.b - c2.b) <= tolerance &&
               Math.abs(c1.a - c2.a) <= tolerance;
    }

    /**
     * Optimized color match for raw values
     */
    _colorsMatchRaw(r, g, b, a, target, tolerance = 0) {
        return Math.abs(r - target.r) <= tolerance &&
               Math.abs(g - target.g) <= tolerance &&
               Math.abs(b - target.b) <= tolerance &&
               Math.abs(a - target.a) <= tolerance;
    }

    /**
     * Show toast notification
     */
    _showToast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        }
    }
}

// Make available globally
window.FloodFillTool = FloodFillTool;
