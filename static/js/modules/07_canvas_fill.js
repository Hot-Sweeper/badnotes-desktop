// ============== Canvas Fill Logic ==============
        let fillDebugOverlay = null;
        let fillDebugOffscreen = null;

        function ensureFillDebugOverlay() {
            const canvasEl = document.getElementById('drawingCanvas');
            const canvasWrapper = document.getElementById('canvasWrapper');
            if (!canvasEl || !canvasWrapper) return null;

            if (!fillDebugOverlay) {
                fillDebugOverlay = document.createElement('canvas');
                fillDebugOverlay.id = 'fillDebugOverlay';
                fillDebugOverlay.style.position = 'absolute';
                fillDebugOverlay.style.top = '0';
                fillDebugOverlay.style.left = '0';
                fillDebugOverlay.style.pointerEvents = 'none';
                fillDebugOverlay.style.zIndex = '40';
                fillDebugOverlay.style.mixBlendMode = 'multiply';
                canvasWrapper.appendChild(fillDebugOverlay);
            }

            const rect = canvasEl.getBoundingClientRect();
            const w = Math.max(1, Math.round(rect.width));
            const h = Math.max(1, Math.round(rect.height));
            if (fillDebugOverlay.width !== w || fillDebugOverlay.height !== h) {
                fillDebugOverlay.width = w;
                fillDebugOverlay.height = h;
                fillDebugOverlay.style.width = `${w}px`;
                fillDebugOverlay.style.height = `${h}px`;
            }

            return fillDebugOverlay;
        }

        function clearFillDebugOverlay() {
            if (!fillDebugOverlay) return;
            const ctx = fillDebugOverlay.getContext('2d');
            ctx.clearRect(0, 0, fillDebugOverlay.width, fillDebugOverlay.height);
        }

        function renderFillDebugOverlay(payload) {
            if (!window.__fillDebugEnabled) return;
            const overlay = ensureFillDebugOverlay();
            if (!overlay) return;

            const { maskWidth, maskHeight, scale, regionMask, boundaryMask } = payload;
            if (!maskWidth || !maskHeight || !scale) return;

            if (!fillDebugOffscreen || fillDebugOffscreen.width !== maskWidth || fillDebugOffscreen.height !== maskHeight) {
                fillDebugOffscreen = document.createElement('canvas');
                fillDebugOffscreen.width = maskWidth;
                fillDebugOffscreen.height = maskHeight;
            }

            const offCtx = fillDebugOffscreen.getContext('2d');
            const img = offCtx.createImageData(maskWidth, maskHeight);
            const data = img.data;

            for (let i = 0; i < maskWidth * maskHeight; i++) {
                const idx = i * 4;
                const isBoundary = boundaryMask ? boundaryMask[i] === 1 : false;
                const isRegion = regionMask ? regionMask[i] === 1 : false;
                if (isBoundary) {
                    data[idx] = 255;
                    data[idx + 1] = 60;
                    data[idx + 2] = 60;
                    data[idx + 3] = 140;
                } else if (isRegion) {
                    data[idx] = 40;
                    data[idx + 1] = 150;
                    data[idx + 2] = 255;
                    data[idx + 3] = 110;
                } else {
                    data[idx + 3] = 0;
                }
            }

            offCtx.putImageData(img, 0, 0);

            const ctx = overlay.getContext('2d');
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
            ctx.scale(1 / scale, 1 / scale);
            ctx.drawImage(fillDebugOffscreen, 0, 0);
            ctx.restore();
        }

        window.toggleFillDebug = function toggleFillDebug() {
            window.__fillDebugEnabled = !window.__fillDebugEnabled;
            if (!window.__fillDebugEnabled) {
                clearFillDebugOverlay();
            }
            if (typeof showToast === 'function') {
                showToast(`Fill debug ${window.__fillDebugEnabled ? 'enabled' : 'disabled'}`, 'info');
            }
        };

        function setupCanvasDropListener() {
            const canvasEl = document.getElementById('drawingCanvas');
            const canvasContainer = document.getElementById('canvasContainer');

            canvasContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            canvasContainer.addEventListener('drop', (e) => {
                e.preventDefault();

                const color = e.dataTransfer.getData('application/x-badnotes-color');
                if (color) {
                    // Map screen to world coordinates (accounts for pan/zoom)
                    const rect = canvas.getBoundingClientRect();
                    const screenX = e.clientX - rect.left;
                    const screenY = e.clientY - rect.top;
                    const x = (screenX - panX) / zoom;
                    const y = (screenY - panY) / zoom;

                    if(window.PaintFill)PaintFill.drop(x,y,color);
                    else performFloodFill(x, y, color);
                }
            });
        }

        function hexToRgb(hex) {
            // Handle different color formats
            if (hex.startsWith('rgb')) {
                const match = hex.match(/\d+/g);
                if (match) return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
            }
            hex = hex.replace('#', '');
            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            const num = parseInt(hex, 16);
            return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
        }

        // Check if a point is inside a polygon/path
        function isPointInPath(x, y, points) {
            if (points.length < 3) return false;

            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = points[i].x, yi = points[i].y;
                const xj = points[j].x, yj = points[j].y;

                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        // Check if a point is inside a circle shape
        function isPointInCircle(x, y, centerX, centerY, radius) {
            const dx = x - centerX;
            const dy = y - centerY;
            return (dx * dx + dy * dy) <= (radius * radius);
        }

        // Check if a point is inside a rectangle
        function isPointInRect(x, y, x1, y1, x2, y2) {
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);
            return x >= minX && x <= maxX && y >= minY && y <= maxY;
        }

        // Bounding box helper for stroke size heuristics
        function getStrokeBounds(points) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            points.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
            return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
        }

        // Remove tail artifacts caused by self-intersection near stroke end
        function sanitizeClosedPath(points) {
            if (!points || points.length < 4) return points || [];

            // Remove near-duplicate consecutive points
            const deduped = [points[0]];
            for (let i = 1; i < points.length; i++) {
                const a = deduped[deduped.length - 1];
                const b = points[i];
                if (Math.hypot(a.x - b.x, a.y - b.y) > 0.5) {
                    deduped.push(b);
                }
            }

            if (deduped.length < 4) return deduped;

            const intersect = (p1, p2, p3, p4) => {
                const s1x = p2.x - p1.x;
                const s1y = p2.y - p1.y;
                const s2x = p4.x - p3.x;
                const s2y = p4.y - p3.y;
                const denom = (-s2x * s1y + s1x * s2y);
                if (Math.abs(denom) < 1e-6) return null;
                const s = (-s1y * (p1.x - p3.x) + s1x * (p1.y - p3.y)) / denom;
                const t = ( s2x * (p1.y - p3.y) - s2y * (p1.x - p3.x)) / denom;
                const eps = 1e-3;
                if (s > eps && s < 1 - eps && t > eps && t < 1 - eps) {
                    return { x: p1.x + (t * s1x), y: p1.y + (t * s1y) };
                }
                return null;
            };

            // Look for a late self-intersection (tail crossing)
            let cut = null;
            for (let s = deduped.length - 2; s >= Math.max(2, deduped.length - 5); s--) {
                const a = deduped[s];
                const b = deduped[s + 1];
                for (let i = 0; i < s - 2; i++) {
                    const c = deduped[i];
                    const d = deduped[i + 1];
                    const hit = intersect(a, b, c, d);
                    if (hit) {
                        cut = { index: i + 1, point: hit };
                        break;
                    }
                }
                if (cut) break;
            }

            if (cut) {
                const trimmed = deduped.slice(0, cut.index);
                trimmed.push(cut.point);
                return trimmed;
            }

            return deduped;
        }

        // Find which shape contains the point
        function findShapeAtPoint(x, y) {
            // Search from top (last drawn) to bottom
            for (let i = strokes.length - 1; i >= 0; i--) {
                const stroke = strokes[i];

                // Skip if already a fill or doesn't have points
                if (stroke.isFill) continue;
                if (!stroke.points || stroke.points.length < 2) continue;

                const start = stroke.points[0];
                const end = stroke.points[stroke.points.length - 1];

                // Check shapes (circle, rectangle)
                if (stroke.isShape && stroke.tool === 'circle') {
                    const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
                    if (isPointInCircle(x, y, start.x, start.y, radius)) {
                        return { stroke, index: i };
                    }
                } else if (stroke.isShape && stroke.tool === 'rectangle') {
                    if (isPointInRect(x, y, start.x, start.y, end.x, end.y)) {
                        return { stroke, index: i };
                    }
                }
            }

            // Also check freehand strokes for Vector Regions (Figma-style)
            // This detects if the point is inside ANY topological face of the stroke,
            // even if the stroke itself isn't perfectly closed or is self-intersecting.
            if (window.VectorRegionFinder) {
                for (let i = strokes.length - 1; i >= 0; i--) {
                    const stroke = strokes[i];
                    if (stroke.isFill || stroke.isShape || !stroke.points || stroke.points.length < 5) continue;

                    const bounds = getStrokeBounds(stroke.points);
                    const pad = 20;
                    if (x < bounds.minX - pad || x > bounds.maxX + pad || y < bounds.minY - pad || y > bounds.maxY + pad) continue;

                    // Simple pre-check: quick bounding box distance to avoid heavy math
                    const regions = window.VectorRegionFinder.findRegions(stroke.points);

                    // Filter for regions containing the point
                    const match = regions.find(region => window.VectorRegionFinder.isPointInPolygon({x,y}, region));

                    if (match) {
                        return { stroke, index: i, region: match, isVectorRegion: true };
                    }
                }
            }

            // Legacy/Raster fallback check
            for (let i = strokes.length - 1; i >= 0; i--) {
                const stroke = strokes[i];
                if (stroke.isFill || stroke.isShape || !stroke.points || stroke.points.length < 5) continue;

                // Check if the path is closed (start and end are close)
                const start = stroke.points[0];
                const end = stroke.points[stroke.points.length - 1];
                const gapDist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));

                // Heuristics: allow larger gap for large shapes, but cap extremes
                const bounds = getStrokeBounds(stroke.points);
                const pathSize = Math.max(bounds.width, bounds.height);
                const primaryThreshold = Math.max(60, Math.min(300, pathSize * 0.28));
                const forgivingThreshold = Math.max(120, Math.min(360, pathSize * 0.45));
                const isInside = isPointInPath(x, y, stroke.points);
                const nearClosed = gapDist <= primaryThreshold;
                const almostClosed = isInside && gapDist <= forgivingThreshold;

                if ((nearClosed || almostClosed) && isInside) {
                    return { stroke, index: i, isClosed: true };
                }
            }

            return null;
        }

        function performFloodFill(startX, startY, fillColor) {
            const canvasWrapper = document.getElementById('canvasWrapper');
            const canvasEl = document.getElementById('drawingCanvas');

            // Get the canvas's intrinsic CSS size (not affected by wrapper zoom)
            // The canvas style.width/height are the logical size before zoom
            const canvasWidth = parseFloat(canvasEl.style.width) || canvasEl.offsetWidth;
            const canvasHeight = parseFloat(canvasEl.style.height) || canvasEl.offsetHeight;

            // startX/startY are world coordinates; convert to screen (accounts for pan/zoom)
            const visualX = (startX * zoom) + panX;
            const visualY = (startY * zoom) + panY;

            // Find if we clicked inside a shape
            const hitShape = findShapeAtPoint(startX, startY);

            if (hitShape) {
                // Fill this shape with the color (vector-based)
                const { stroke, index, isClosed, isVectorRegion, region } = hitShape;

                // 1. Vector Region Fill (Figma-style) - Priority #1
                if (isVectorRegion && region) {
                    const underlayWidth = Math.max(1, getStrokeMaxSize(stroke) * 0.9);
                    const fillShape = {
                        id: Date.now(),
                        tool: 'path',
                        color: fillColor,
                        fillColor: fillColor,
                        size: 0,
                        points: region,
                        isShape: false,
                        isFill: true,
                        originalStrokeId: stroke.id,
                        fillExact: true,
                        fillUnderlayWidth: underlayWidth
                    };

                    showFillAnimation(visualX, visualY, fillColor, canvasWrapper, fillShape, { width: canvasWidth, height: canvasHeight }, () => {
                        strokes.splice(index, 0, fillShape);
                        if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
                        historyStack.push({ type: 'add', stroke: fillShape });
                        redrawCanvas();
                        saveCurrentPage();
                    });
                    showToast('Region filled!', 'success');
                    return;
                }

                // Prefer raster-based region for freehand strokes to avoid wedge artifacts
                if (!stroke.isShape) {
                    // 1. Vector Region Check (Figma-style for self-intersecting strokes)
                    if (window.VectorRegionFinder) {
                        try {
                            const subRegions = window.VectorRegionFinder.findRegions(stroke.points);

                            // Find all regions containing the click
                            const candidates = subRegions.filter(reg =>
                                window.VectorRegionFinder.isPointInPolygon({x: startX, y: startY}, reg)
                            );

                            if (candidates.length > 0) {
                                // Pick the smallest region by area (handles nested regions/outer boundary issues)
                                candidates.sort((a, b) => {
                                    const areaA = Math.abs(window.VectorRegionFinder.calculateSignedArea(a));
                                    const areaB = Math.abs(window.VectorRegionFinder.calculateSignedArea(b));
                                    return areaA - areaB;
                                });

                                const bestRegion = candidates[0];

                                const underlayWidth = Math.max(1, getStrokeMaxSize(stroke) * 0.9);
                                const fillShape = {
                                    id: Date.now(),
                                    tool: 'path',
                                    color: fillColor,
                                    fillColor: fillColor,
                                    size: 0,
                                    points: bestRegion,
                                    isShape: false,
                                    isFill: true,
                                    originalStrokeId: stroke.id,
                                    fillExact: true,
                                    fillUnderlayWidth: underlayWidth
                                };

                                showFillAnimation(visualX, visualY, fillColor, canvasWrapper, fillShape, { width: canvasWidth, height: canvasHeight }, () => {
                                    strokes.splice(index, 0, fillShape);
                                    if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
                                    historyStack.push({ type: 'add', stroke: fillShape });
                                    redrawCanvas();
                                    saveCurrentPage();
                                });

                                showToast('Vector region filled!', 'success');
                                return;
                            }
                        } catch (e) {
                            console.warn("Vector region detection failed, falling back to raster:", e);
                        }
                    }

                    // 2. Raster Fallback
                    const region = findClosedRegionByMask(startX, startY, stroke);
                    if (region && region.points && region.points.length >= 3) {
                        const underlayWidth = region.triangles ? 0 : Math.max(1, getStrokeMaxSize(stroke) * 0.9);
                        const fillShape = {
                            id: Date.now(),
                            tool: 'path',
                            color: fillColor,
                            fillColor: fillColor,
                            size: 0,
                            points: region.points,
                            fillTriangles: region.triangles || null,
                            isShape: false,
                            isFill: true,
                            originalStrokeId: stroke.id,
                            fillExact: true,
                            fillUnderlayWidth: underlayWidth || undefined
                        };

                        showFillAnimation(visualX, visualY, fillColor, canvasWrapper, fillShape, { width: canvasWidth, height: canvasHeight }, () => {
                            strokes.splice(index, 0, fillShape);
                            if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
                            historyStack.push({ type: 'add', stroke: fillShape });
                            redrawCanvas();
                            saveCurrentPage();
                        });

                        showToast('Shape filled!', 'success');
                        return;
                    }

                }

                const cleanPoints = sanitizeClosedPath(stroke.points);
                const animStroke = { ...stroke, points: cleanPoints };
                const underlayWidth = Math.max(1, getStrokeMaxSize(stroke) * 0.9);

                // Create a fill shape that goes behind the stroke
                const fillShape = {
                    id: Date.now(),
                    tool: stroke.tool || 'path',
                    color: fillColor,
                    fillColor: fillColor,
                    size: 0,
                    points: cleanPoints,
                    isShape: stroke.isShape,
                    isFill: true,
                    originalStrokeId: stroke.id,
                    fillUnderlayWidth: underlayWidth
                };

                // Show animation FIRST, then apply fill after animation
                showFillAnimation(visualX, visualY, fillColor, canvasWrapper, animStroke, { width: canvasWidth, height: canvasHeight }, () => {
                    // This callback runs after animation completes
                    strokes.splice(index, 0, fillShape);
                    if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
                    historyStack.push({ type: 'add', stroke: fillShape });
                    redrawCanvas();
                    saveCurrentPage();
                });

                showToast('Shape filled!', 'success');
                return;
            } else {
                // Fallback: raster-based closure detection with gap sealing
                const region = findClosedRegionByMask(startX, startY, null);
                if (region && region.points && region.points.length >= 3) {
                    const underlayWidth = region.triangles ? 0 : undefined;
                    const fillShape = {
                        id: Date.now(),
                        tool: 'path',
                        color: fillColor,
                        fillColor: fillColor,
                        size: 0,
                        points: region.points,
                        fillTriangles: region.triangles || null,
                        isShape: false,
                        isFill: true,
                        originalStrokeId: null,
                        fillExact: true,
                        fillUnderlayWidth: underlayWidth
                    };

                    // Use animation for consistency
                    showFillAnimation(visualX, visualY, fillColor, canvasWrapper, fillShape, { width: canvasWidth, height: canvasHeight }, () => {
                        const insertIndex = findTopmostNonFillStrokeIndex();
                        if (insertIndex >= 0) {
                            strokes.splice(insertIndex, 0, fillShape);
                        } else {
                            strokes.push(fillShape);
                        }
                        if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();
                        historyStack.push({ type: 'add', stroke: fillShape });
                        redrawCanvas();
                        saveCurrentPage();
                    });

                    showToast('Shape filled!', 'success');
                    return;
                }

                // No closed region found
                showToast('Drop on a closed shape to fill it', 'info');
            }
        }

        // --- Raster-based closed region detection ---
        function findClosedRegionByMask(x, y, boundaryStroke) {
            if (!strokes || !strokes.length) return null;
            // Use adaptive higher resolution mask for accuracy; throttle on large pages for performance
            const pageArea = baseWidth * baseHeight;
            const scale = pageArea <= 2000000 ? 2.0 : (pageArea <= 5000000 ? 1.5 : 1.0);
            const maskWidth = Math.max(32, Math.round(baseWidth * scale));
            const maskHeight = Math.max(32, Math.round(baseHeight * scale));

            const { mask } = buildStrokeMask(maskWidth, maskHeight, scale, strokes);
            if (!mask) return null;

            let px = Math.floor(x * scale);
            let py = Math.floor(y * scale);
            const idx = py * maskWidth + px;
            if (idx < 0 || idx >= mask.length) return null;
                if (mask[idx] === 1) {
                    const alt = findNearestEmpty(mask, maskWidth, maskHeight, px, py, 4);
                    if (!alt) {
                        return null;
                    }
                    px = alt.x; py = alt.y;
                }

            const flood = floodRegion(mask, maskWidth, maskHeight, px, py);
            if (!flood || flood.touchesEdge) {
                if (window.__fillDebugEnabled) {
                    renderFillDebugOverlay({
                        maskWidth,
                        maskHeight,
                        scale,
                        regionMask: flood ? flood.regionMask : null,
                        boundaryMask: mask
                    });
                }
                return null;
            }

            // Expand region slightly into the stroke mask to eliminate edge gaps
            if (boundaryStroke) {
                const { mask: boundaryMask } = buildStrokeMask(maskWidth, maskHeight, scale, [boundaryStroke]);
                if (boundaryMask) {
                    expandRegionIntoBoundaryStroke(flood.regionMask, boundaryMask, maskWidth, maskHeight);
                }
            }

            const contour = traceContour(flood.regionMask, maskWidth, maskHeight);
            if (!contour || contour.length < 3) {
                if (window.__fillDebugEnabled) {
                    renderFillDebugOverlay({
                        maskWidth,
                        maskHeight,
                        scale,
                        regionMask: flood.regionMask,
                        boundaryMask: mask
                    });
                }
                return null;
            }

            // Smooth contour to reduce staircase artifacts while preserving shape
            const smoothIters = contour.length > 2000 ? 1 : 2;
            const smoothed = chaikinSmooth(contour, smoothIters);

            // Keep contour detail for accuracy; simplify only for very large contours
            const simplified = smoothed.length > 1600 ? simplifyPath(smoothed, 0.5) : smoothed;
            const logicalPoints = simplified.map(p => ({ x: p.x / scale, y: p.y / scale }));

            const triangles = triangulatePolygon(logicalPoints);

            if (window.__fillDebugEnabled) {
                renderFillDebugOverlay({
                    maskWidth,
                    maskHeight,
                    scale,
                    regionMask: flood.regionMask,
                    boundaryMask: mask
                });
            }

            return { points: logicalPoints, triangles };
        }

        function triangulatePolygon(points) {
            if (!points || points.length < 3) return null;
            const earcutRef = window.earcut || (typeof earcut !== 'undefined' ? earcut : null);
            if (!earcutRef) return null;
            const flat = [];
            for (const p of points) {
                flat.push(p.x, p.y);
            }
            try {
                const tris = earcutRef(flat);
                return Array.isArray(tris) && tris.length ? tris : null;
            } catch (err) {
                console.warn('[CanvasFill] Earcut triangulation failed', err);
                return null;
            }
        }

        function buildStrokeMask(width, height, scale, strokeList) {
            const off = document.createElement('canvas');
            off.width = width;
            off.height = height;
            const ctx = off.getContext('2d');
            ctx.clearRect(0, 0, width, height);
            ctx.scale(scale, scale);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const drawStrokePath = (points) => {
                if (!points || points.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                ctx.stroke();
            };

            const sourceStrokes = strokeList || strokes;
            for (const s of sourceStrokes) {
                if (!s || s.isFill || !s.points || s.points.length < 2) continue;
                // Keep line thickness after scaling down
                    const lw = Math.max(2, ((s.size || 4) * 2.5) / scale);
                ctx.lineWidth = lw;
                ctx.strokeStyle = '#000';

                if (s.isShape && s.tool === 'circle' && s.points.length >= 2) {
                    const start = s.points[0];
                    const end = s.points[s.points.length - 1];
                    const r = Math.hypot(end.x - start.x, end.y - start.y);
                    ctx.beginPath();
                    ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (s.isShape && s.tool === 'rectangle' && s.points.length >= 2) {
                    const start = s.points[0];
                    const end = s.points[s.points.length - 1];
                    const x1 = Math.min(start.x, end.x);
                    const y1 = Math.min(start.y, end.y);
                    const w = Math.abs(end.x - start.x);
                    const h = Math.abs(end.y - start.y);
                    ctx.strokeRect(x1, y1, w, h);
                } else {
                    drawStrokePath(s.points);
                }
            }

            const img = ctx.getImageData(0, 0, width, height);
            const mask = new Uint8Array(width * height);
            for (let i = 0; i < width * height; i++) {
                mask[i] = img.data[i * 4 + 3] > 0 ? 1 : 0;
            }

            // Morphological closing: dilate then erode to seal gaps
                const closeRadius = width > 2000 ? 1 : 2; // lighter for huge pages
                const dilated = dilateMask(mask, width, height, closeRadius);
                const closed = erodeMask(dilated, width, height, closeRadius);

            return { mask: closed, touchedEdge: false };
        }

        function dilateMask(mask, width, height, radius) {
            const out = new Uint8Array(mask.length);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let val = 0;
                    for (let dy = -radius; dy <= radius && !val; dy++) {
                        const ny = y + dy;
                        if (ny < 0 || ny >= height) continue;
                        for (let dx = -radius; dx <= radius; dx++) {
                            const nx = x + dx;
                            if (nx < 0 || nx >= width) continue;
                            if (mask[ny * width + nx]) {
                                val = 1;
                                break;
                            }
                        }
                    }
                    out[y * width + x] = val;
                }
            }
            return out;
        }

        function erodeMask(mask, width, height, radius) {
            const out = new Uint8Array(mask.length);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (!mask[y * width + x]) {
                        out[y * width + x] = 0;
                        continue;
                    }
                    let keep = 1;
                    for (let dy = -radius; dy <= radius && keep; dy++) {
                        const ny = y + dy;
                        if (ny < 0 || ny >= height) { keep = 0; break; }
                        for (let dx = -radius; dx <= radius; dx++) {
                            const nx = x + dx;
                            if (nx < 0 || nx >= width) { keep = 0; break; }
                            if (!mask[ny * width + nx]) { keep = 0; break; }
                        }
                    }
                    out[y * width + x] = keep;
                }
            }
            return out;
        }

        function floodRegion(mask, width, height, sx, sy) {
            if (mask[sy * width + sx]) return null;
            const visited = new Uint8Array(mask.length);
            const region = new Uint8Array(mask.length);
            const queue = [[sx, sy]];
            visited[sy * width + sx] = 1;
            region[sy * width + sx] = 1;
            let touchesEdge = false;

            while (queue.length) {
                const [x, y] = queue.pop();
                if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;

                for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const nIdx = ny * width + nx;
                    if (visited[nIdx] || mask[nIdx]) continue;
                    visited[nIdx] = 1;
                    region[nIdx] = 1;
                    queue.push([nx, ny]);
                }
            }

            return { regionMask: region, touchesEdge };
        }

        // Expand filled region into stroke pixels to reduce visible gaps
        function expandRegionIntoBoundaryStroke(regionMask, boundaryMask, width, height) {
            let addedTotal = 0;

            // Depth-limited expansion into stroke boundary.
            // Prevents leaking through crossing points of self-intersecting
            // strokes (e.g. figure-8) while still overlapping the stroke edge
            // enough to avoid visible gaps between fill and stroke.
            const MAX_EXPAND_DEPTH = 3; // pixels into the stroke boundary

            const neighbors = [
                -1, 1, -width, width,
                -width - 1, -width + 1, width - 1, width + 1
            ];

            // BFS with depth tracking — seed from region border, expand a few pixels in
            let currentFrontier = [];

            // Seed: find stroke pixels adjacent to the filled region
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    if (!boundaryMask[idx] || regionMask[idx]) continue;
                    if (regionMask[idx - 1] || regionMask[idx + 1] ||
                        regionMask[idx - width] || regionMask[idx + width] ||
                        regionMask[idx - width - 1] || regionMask[idx - width + 1] ||
                        regionMask[idx + width - 1] || regionMask[idx + width + 1]) {
                        regionMask[idx] = 1;
                        addedTotal++;
                        currentFrontier.push(idx);
                    }
                }
            }

            // Expand outward in layers up to MAX_EXPAND_DEPTH
            for (let depth = 1; depth < MAX_EXPAND_DEPTH; depth++) {
                const nextFrontier = [];
                for (const idx of currentFrontier) {
                    for (const n of neighbors) {
                        const ni = idx + n;
                        if (ni < 0 || ni >= regionMask.length) continue;
                        if (!boundaryMask[ni] || regionMask[ni]) continue;
                        regionMask[ni] = 1;
                        addedTotal++;
                        nextFrontier.push(ni);
                    }
                }
                currentFrontier = nextFrontier;
                if (currentFrontier.length === 0) break;
            }

            return addedTotal;
        }

        function traceContour(regionMask, width, height) {
            let sx = -1, sy = -1;
            for (let i = 0; i < regionMask.length; i++) {
                if (regionMask[i]) {
                    const x = i % width;
                    const y = Math.floor(i / width);
                    // boundary pixel?
                    if (isBoundary(regionMask, width, height, x, y)) {
                        sx = x; sy = y; break;
                    }
                }
            }
            if (sx === -1) return null;

            const neighbors = [
                [1, 0], [1, 1], [0, 1], [-1, 1],
                [-1, 0], [-1, -1], [0, -1], [1, -1]
            ];

            const contour = [];
            let cx = sx, cy = sy;
            let prevDir = 6; // start looking from west side
            let first = true;

            while (true) {
                contour.push({ x: cx + 0.5, y: cy + 0.5 });
                let found = false;
                for (let k = 0; k < 8; k++) {
                    const dir = (prevDir + k) % 8;
                    const nx = cx + neighbors[dir][0];
                    const ny = cy + neighbors[dir][1];
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    if (regionMask[ny * width + nx] && isBoundary(regionMask, width, height, nx, ny)) {
                        cx = nx; cy = ny;
                        prevDir = (dir + 6) % 8; // backtrack direction for next search
                        found = true;
                        break;
                    }
                }
                if (!found) break;
                if (!first && cx === sx && cy === sy) break;
                first = false;
                if (contour.length > 8000) break; // safety
            }

            return contour;
        }

        // Find nearest empty pixel around (x,y) within a Chebyshev radius
        function findNearestEmpty(mask, width, height, x, y, radius) {
            for (let r = 1; r <= radius; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                        if (mask[ny * width + nx] === 0) {
                            return { x: nx, y: ny };
                        }
                    }
                }
            }
            return null;
        }

        function isBoundary(mask, width, height, x, y) {
            if (!mask[y * width + x]) return false;
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
                if (!mask[ny * width + nx]) return true;
            }
            return false;
        }

        function simplifyPath(points, tolerance) {
            if (!points || points.length < 3) return points || [];
            const sqTol = tolerance * tolerance;

            const simplifyDP = (pts, first, last, keep) => {
                let maxDist = sqTol;
                let index = -1;
                const ax = pts[first].x;
                const ay = pts[first].y;
                const bx = pts[last].x;
                const by = pts[last].y;
                const dx = bx - ax;
                const dy = by - ay;
                const denom = dx * dx + dy * dy || 1;

                for (let i = first + 1; i < last; i++) {
                    const px = pts[i].x;
                    const py = pts[i].y;
                    const t = ((px - ax) * dx + (py - ay) * dy) / denom;
                    const projx = ax + t * dx;
                    const projy = ay + t * dy;
                    const dist = Math.pow(px - projx, 2) + Math.pow(py - projy, 2);
                    if (dist > maxDist) {
                        index = i;
                        maxDist = dist;
                    }
                }

                if (index !== -1) {
                    keep[index] = true;
                    simplifyDP(pts, first, index, keep);
                    simplifyDP(pts, index, last, keep);
                }
            };

            const keep = new Array(points.length).fill(false);
            keep[0] = keep[points.length - 1] = true;
            simplifyDP(points, 0, points.length - 1, keep);

            const out = [];
            for (let i = 0; i < points.length; i++) {
                if (keep[i]) out.push(points[i]);
            }
            return out;
        }

        function showFillAnimation(visualX, visualY, fillColor, container, stroke, canvasSize, onComplete) {
            // Get shape points for masking
            if (!stroke || !stroke.points || stroke.points.length < 3) {
                if (onComplete) onComplete();
                return;
            }

            // Convert world coords to screen coords (account for pan/zoom)
            const worldToScreen = (pt) => ({
                x: pt.x * zoom + panX,
                y: pt.y * zoom + panY
            });

            // Get bounding box in screen space
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            stroke.points.forEach(p => {
                const sp = worldToScreen(p);
                minX = Math.min(minX, sp.x);
                minY = Math.min(minY, sp.y);
                maxX = Math.max(maxX, sp.x);
                maxY = Math.max(maxY, sp.y);
            });

            // Add padding for smoother edges
            const pad = 20;
            minX -= pad; minY -= pad; maxX += pad; maxY += pad;

            const boundsWidth = Math.ceil(maxX - minX);
            const boundsHeight = Math.ceil(maxY - minY);
            const boundsLeft = minX;
            const boundsTop = minY;

            // ============== RASTER-BASED MASK (No Wedge Artifacts) ==============
            // Instead of clipping to vector path (which creates wedges on self-intersection),
            // render the stroke to an offscreen canvas and flood fill the interior.

            const dpr = window.devicePixelRatio || 1;

            // Create offscreen mask canvas (supersampled for tighter barriers at intersections)
            const maskScale = (stroke.size || 4) <= 4 ? 3 : 2;
            const maskWidth = Math.max(1, Math.round(boundsWidth * maskScale));
            const maskHeight = Math.max(1, Math.round(boundsHeight * maskScale));
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = maskWidth;
            maskCanvas.height = maskHeight;
            const maskCtx = maskCanvas.getContext('2d');
            maskCtx.scale(maskScale, maskScale);

            // Draw stroke outline on mask canvas with THICK line to create solid barrier
            maskCtx.strokeStyle = '#000';
            const baseLineWidth = Math.max(8, (stroke.size || 4) * zoom * 3);
            maskCtx.lineWidth = baseLineWidth;
            maskCtx.lineCap = 'round';
            maskCtx.lineJoin = 'round';
            maskCtx.beginPath();
            stroke.points.forEach((p, i) => {
                const sp = worldToScreen(p);
                const px = sp.x - boundsLeft;
                const py = sp.y - boundsTop;
                if (i === 0) maskCtx.moveTo(px, py);
                else maskCtx.lineTo(px, py);
            });
            maskCtx.closePath();
            maskCtx.stroke();

            // Get mask image data and build a sealed binary stroke mask
            const maskData = maskCtx.getImageData(0, 0, maskWidth, maskHeight);
            const maskPixels = maskData.data;
            const strokeMask = new Uint8Array(maskWidth * maskHeight);
            for (let i = 0; i < strokeMask.length; i++) {
                strokeMask[i] = maskPixels[i * 4 + 3] > 0 ? 1 : 0;
            }
            // Seal tiny gaps, then create a modest barrier to avoid leaks
            const sealRadius = 2;
            const closedStrokeMask = erodeMask(
                dilateMask(strokeMask, maskWidth, maskHeight, sealRadius),
                maskWidth,
                maskHeight,
                sealRadius
            );
            let sealedStrokeMask = null;
            let fillMask = null;
            let touchesEdge = false;
            let filledCount = 0;
            let barrierRadius = 1;

            // Find interior point (drop location in mask space)
            const seedX0 = Math.floor(Math.max(0, Math.min(maskWidth - 1, (visualX - boundsLeft) * maskScale)));
            const seedY0 = Math.floor(Math.max(0, Math.min(maskHeight - 1, (visualY - boundsTop) * maskScale)));
            const expandPixels = 1;

            for (let attempt = 0; attempt < 3; attempt++) {
                barrierRadius = 1 + attempt;
                sealedStrokeMask = dilateMask(closedStrokeMask, maskWidth, maskHeight, barrierRadius);

                // Fill only where sealed stroke mask is empty
                const isFillable = (x, y) => {
                    if (x < 0 || x >= maskWidth || y < 0 || y >= maskHeight) return false;
                    return sealedStrokeMask[y * maskWidth + x] === 0;
                };

                // If seed is on stroke, find nearby empty pixel
                let seedX = seedX0;
                let seedY = seedY0;
                if (!isFillable(seedX, seedY)) {
                    let found = false;
                    for (let r = 1; r <= 20 && !found; r++) {
                        for (let dy = -r; dy <= r && !found; dy++) {
                            for (let dx = -r; dx <= r && !found; dx++) {
                                const nx = seedX + dx;
                                const ny = seedY + dy;
                                if (isFillable(nx, ny)) {
                                    seedX = nx; seedY = ny; found = true;
                                }
                            }
                        }
                    }
                }

                // SCANLINE FLOOD FILL (much faster than pixel stack)
                fillMask = new Uint8Array(maskWidth * maskHeight);
                const stack = [[seedX, seedY]];
                touchesEdge = false;
                filledCount = 0;

                while (stack.length > 0) {
                    let [x, y] = stack.pop();

                    // Find leftmost fillable pixel in this row
                    while (x > 0 && isFillable(x - 1, y) && !fillMask[y * maskWidth + x - 1]) {
                        x--;
                    }

                    let spanAbove = false;
                    let spanBelow = false;

                    // Fill entire horizontal span
                    while (x < maskWidth && isFillable(x, y) && !fillMask[y * maskWidth + x]) {
                        const idx = y * maskWidth + x;
                        fillMask[idx] = 1;
                        filledCount++;

                        if (x === 0 || y === 0 || x === maskWidth - 1 || y === maskHeight - 1) {
                            touchesEdge = true;
                        }

                        // Check pixel above
                        if (y > 0) {
                            const aboveIdx = (y - 1) * maskWidth + x;
                            if (isFillable(x, y - 1) && !fillMask[aboveIdx]) {
                                if (!spanAbove) {
                                    stack.push([x, y - 1]);
                                    spanAbove = true;
                                }
                            } else {
                                spanAbove = false;
                            }
                        }

                        // Check pixel below
                        if (y < maskHeight - 1) {
                            const belowIdx = (y + 1) * maskWidth + x;
                            if (isFillable(x, y + 1) && !fillMask[belowIdx]) {
                                if (!spanBelow) {
                                    stack.push([x, y + 1]);
                                    spanBelow = true;
                                }
                            } else {
                                spanBelow = false;
                            }
                        }

                        x++;
                    }
                }

                if (!touchesEdge && filledCount > 200) {
                    break;
                }
            }

            // EXPAND fill INTO stroke center for perfect edge coverage
            for (let pass = 0; pass < expandPixels; pass++) {
                const toExpand = [];
                for (let y = 1; y < maskHeight - 1; y++) {
                    for (let x = 1; x < maskWidth - 1; x++) {
                        const idx = y * maskWidth + x;
                        if (fillMask[idx]) continue;
                        if (sealedStrokeMask[idx]) continue; // never expand into stroke barrier

                        // Check if any 4-neighbor is filled
                        if (fillMask[idx - 1] || fillMask[idx + 1] ||
                            fillMask[idx - maskWidth] || fillMask[idx + maskWidth]) {
                            toExpand.push(idx);
                        }
                    }
                }
                for (const idx of toExpand) {
                    fillMask[idx] = 1;
                }
            }

            if (!filledCount) {
                return;
            }

            // Create filled mask image for animation clipping
            const filledMaskCanvas = document.createElement('canvas');
            filledMaskCanvas.width = maskWidth;
            filledMaskCanvas.height = maskHeight;
            const filledMaskCtx = filledMaskCanvas.getContext('2d');
            const filledData = filledMaskCtx.createImageData(maskWidth, maskHeight);

            for (let i = 0; i < fillMask.length; i++) {
                if (fillMask[i]) {
                    filledData.data[i * 4] = 255;
                    filledData.data[i * 4 + 1] = 255;
                    filledData.data[i * 4 + 2] = 255;
                    filledData.data[i * 4 + 3] = 255;
                }
            }
            filledMaskCtx.putImageData(filledData, 0, 0);

            // Create animation canvas
            const animCanvas = document.createElement('canvas');
            animCanvas.width = maskWidth * dpr;
            animCanvas.height = maskHeight * dpr;
            animCanvas.style.cssText = `
                position: absolute;
                left: ${boundsLeft}px;
                top: ${boundsTop}px;
                width: ${boundsWidth}px;
                height: ${boundsHeight}px;
                pointer-events: none;
                z-index: 2;
            `;

            const ctx = animCanvas.getContext('2d');
            ctx.scale(dpr, dpr);

            // Drop point relative to canvas (mask space)
            const dropX = Math.max(0, Math.min(maskWidth, (visualX - boundsLeft) * maskScale));
            const dropY = Math.max(0, Math.min(maskHeight, (visualY - boundsTop) * maskScale));

            // Calculate max radius
            let maxRadius = 0;
            for (let y = 0; y < maskHeight; y++) {
                for (let x = 0; x < maskWidth; x++) {
                    if (fillMask[y * maskWidth + x]) {
                        maxRadius = Math.max(maxRadius, Math.hypot(x - dropX, y - dropY));
                    }
                }
            }
            maxRadius = Math.max(1, maxRadius + (5 * maskScale));

            const drawingCanvas = document.getElementById('drawingCanvas');
            const activeCanvas = document.getElementById('activeCanvas');
            if (activeCanvas && activeCanvas.parentElement === container) {
                container.insertBefore(animCanvas, activeCanvas);
            } else if (drawingCanvas && drawingCanvas.parentElement === container) {
                container.insertBefore(animCanvas, drawingCanvas.nextSibling);
            } else {
                container.appendChild(animCanvas);
            }

            // Animation timing
            const duration = 520;
            const startTime = performance.now();
            let fillApplied = false;

            const animate = (now) => {
                const elapsed = now - startTime;
                const t = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                const radius = Math.max(0, maxRadius * eased);

                ctx.clearRect(0, 0, maskWidth, maskHeight);

                // Draw expanding circle
                ctx.save();
                ctx.fillStyle = fillColor;
                ctx.beginPath();
                ctx.arc(dropX, dropY, radius, 0, Math.PI * 2);
                ctx.fill();

                // Use destination-in to mask to the flood-filled region
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(filledMaskCanvas, 0, 0);
                ctx.restore();

                // Apply actual fill midway
                if (!fillApplied && t > 0.45) {
                    fillApplied = true;
                    if (onComplete) onComplete();
                }

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    animCanvas.remove();
                }
            };

            requestAnimationFrame(animate);
        }

        function savePalette() {
            localStorage.setItem('badnotes_palette', JSON.stringify(customPalette));
        }

        function addToPalette(color) {
            if (!customPalette.includes(color)) {
                customPalette.push(color);
                savePalette();
                renderPalette();
                showToast('Color added to palette', 'success');
            } else {
                showToast('Color already in palette', 'info');
            }
        }

        async function activatePipette() {
            if (!window.EyeDropper) {
                // Fallback to canvas picking
                isPipetteActive = true;
                document.body.style.cursor = 'crosshair';
                document.getElementById('pipetteBtn').classList.add('active');
                showToast('Click on canvas to pick color', 'info');
                return;
            }

            try {
                const eyeDropper = new EyeDropper();
                const result = await eyeDropper.open();
                setColor(result.sRGBHex);
            } catch (e) {
                // Eyedropper cancelled or failed
            }
        }

        function setColor(color, isSecondarySwap) {
            currentColor = color;
            const picker = document.getElementById('colorPicker');
            picker.value = color;

            // Update custom picker UI (old style - fallback)
            const customPicker = document.getElementById('customColorPicker');
            if (customPicker) {
                customPicker.style.setProperty('--current-color', color);
            }

            // Only update HP Pen primary if NOT a secondary color swap
            // This prevents overwriting primary when toggling to secondary
            if (typeof hpPenColors !== 'undefined' && !isSecondarySwap) {
                hpPenColors.primary = color;
            }
            if (typeof SimpleTextField !== 'undefined') {
                SimpleTextField.setActiveColor(color);
            }
            if (typeof HandwrittenTextField !== 'undefined') {
                HandwrittenTextField.setActiveColor(color);
            }
            if (typeof redrawCanvas === 'function') {
                redrawCanvas();
            }
            updateColorSwapUI();

            renderPalette(); // Update active state if color is in palette
        }

        /**
         * Update color swap UI (Photoshop-style primary/secondary)
         */
        function updateColorSwapUI() {
            // Get colors
            const primaryColor = typeof hpPenColors !== 'undefined' ? hpPenColors.primary : currentColor;
            const secondaryColor = typeof hpPenColors !== 'undefined' ? hpPenColors.secondary : '#ff4444';

            // Update primary swatch
            const primarySwatch = document.getElementById('primaryColorSwatch');
            if (primarySwatch) {
                primarySwatch.style.setProperty('--primary-color', primaryColor);
            }

            // Update secondary swatch
            const secondarySwatch = document.getElementById('secondaryColorSwatch');
            if (secondarySwatch) {
                secondarySwatch.style.setProperty('--secondary-color', secondaryColor);
            }

            // Update color pickers
            const colorPicker = document.getElementById('colorPicker');
            if (colorPicker) {
                colorPicker.value = primaryColor;
            }

            const secondaryColorPicker = document.getElementById('secondaryColorPicker');
            if (secondaryColorPicker) {
                secondaryColorPicker.value = secondaryColor;
            }
        }

        function pickColorFromCanvas(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            const pixel = ctx.getImageData(x * scaleX, y * scaleY, 1, 1).data;

            if (pixel[3] === 0) {
                showToast('No ink at this location', 'info');
                return;
            }

            // Convert to hex
            const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(x => x.toString(16).padStart(2, '0')).join('');
            setColor(hex);

            isPipetteActive = false;
            document.body.style.cursor = 'default';
            document.getElementById('pipetteBtn').classList.remove('active');
            showToast('Color picked: ' + hex, 'success');
        }

        function findTopmostNonFillStrokeIndex() {
            if (!strokes || !strokes.length) return -1;
            for (let i = strokes.length - 1; i >= 0; i--) {
                const s = strokes[i];
                if (!s || s.isFill || s.type === 'fill') continue;
                return i;
            }
            return -1;
        }

        function getStrokeMaxSize(stroke) {
            if (!stroke) return 0;
            if (stroke.points && stroke.points.length) {
                let maxSize = 0;
                for (const p of stroke.points) {
                    if (p && p.size !== undefined) {
                        maxSize = Math.max(maxSize, p.size);
                    }
                }
                if (maxSize > 0) return maxSize;
            }
            return stroke.size || 0;
        }

        function chaikinSmooth(points, iterations = 1) {
            if (!points || points.length < 3) return points || [];
            let result = points.slice();
            for (let iter = 0; iter < iterations; iter++) {
                const next = [];
                const len = result.length;
                for (let i = 0; i < len; i++) {
                    const p0 = result[i];
                    const p1 = result[(i + 1) % len];
                    const q = {
                        x: p0.x * 0.75 + p1.x * 0.25,
                        y: p0.y * 0.75 + p1.y * 0.25
                    };
                    const r = {
                        x: p0.x * 0.25 + p1.x * 0.75,
                        y: p0.y * 0.25 + p1.y * 0.75
                    };
                    next.push(q, r);
                }
                result = next;
            }
            return result;
        }
