/**
 * StrokeRenderer - High-quality stroke rendering
 * Handles pressure-sensitive stroke rendering with variable width
 */
class StrokeRenderer {
    /**
     * Render a stroke on context
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} stroke - Stroke data
     */
    static render(ctx, stroke) {
        if (!stroke.points || stroke.points.length < 2) return;

        // Handle fill strokes (from flood fill tool)
        if (stroke.isFill || stroke.type === 'fill') {
            StrokeRenderer.renderFill(ctx, stroke);
            return;
        }

        let points = stroke.points;

        // OPTIMIZATION: Level of Detail (LOD)
        // Simplify stroke based on current zoom level to improve performance
        // Only apply for long strokes when zoomed out
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            const zoom = ViewportManager.state.zoom;
            // If zoomed out significantly and stroke is detailed
            if (zoom < 0.8 && points.length > 20) {
                // Calculate step size based on zoom.
                // Lower zoom = higher step (skip more points)
                // e.g. Zoom 0.1 -> step 4. Zoom 0.5 -> step 2
                const step = Math.min(5, Math.floor(1 / Math.max(0.1, zoom)));

                if (step > 1) {
                   points = StrokeRenderer._applyLOD(points, step);
                }
            }
        }

        ctx.save();

        // Set stroke properties
        ctx.strokeStyle = stroke.color || '#ffffff';
        ctx.fillStyle = stroke.color || '#ffffff';
        ctx.globalAlpha = stroke.opacity || 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Check if we need variable width rendering
        const hasVariableWidth = points.some(p => p.size !== undefined);

        if (hasVariableWidth) {
            StrokeRenderer.renderVariableWidth(ctx, points, stroke);
        } else {
            StrokeRenderer.renderConstantWidth(ctx, points, stroke);
        }

        ctx.restore();
    }

    /**
     * Apply simple LOD by skipping points
     * Use simple stride for performance (caching simplified versions would be better but requires more memory)
     */
    static _applyLOD(points, step) {
        const simplified = [points[0]];
        for (let i = step; i < points.length - 1; i += step) {
            simplified.push(points[i]);
        }
        simplified.push(points[points.length - 1]);
        return simplified;
    }

    /**
     * Render stroke with constant width
     * PERFORMANCE: Optimized path building with minimal operations
     */
    static renderConstantWidth(ctx, points, stroke) {
        const len = points.length;
        ctx.lineWidth = stroke.size || 3;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        // PERFORMANCE: Use local variables to avoid repeated property access
        // Use quadratic curves for smoothness
        if (len > 2) {
            let p1 = points[1];
            for (let i = 1; i < len - 1; i++) {
                const p2 = points[i + 1];
                const midX = (p1.x + p2.x) * 0.5; // Multiplication faster than division
                const midY = (p1.y + p2.y) * 0.5;
                ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
                p1 = p2;
            }
        }

        // Last point
        const last = points[len - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
    }

    /**
     * Render stroke with variable width (pressure-sensitive)
     * PERFORMANCE: Optimized with pre-allocated arrays and reduced object creation
     */
    static renderVariableWidth(ctx, points, stroke) {
        const baseSize = stroke.size || 3;
        const numPoints = points.length;

        // PERFORMANCE: Pre-allocate arrays with known size
        const leftPoints = new Array(numPoints);
        const rightPoints = new Array(numPoints);

        // PERFORMANCE: Reuse variables to minimize allocations
        let perpX, perpY, dx, dy, invLen, size, point, prev, next;

        for (let i = 0; i < numPoints; i++) {
            point = points[i];
            size = (point.size || baseSize) * 0.5;

            // Calculate perpendicular direction
            if (i === 0) {
                // Use direction to next point
                next = points[1];
                dx = next.x - point.x;
                dy = next.y - point.y;
            } else if (i === numPoints - 1) {
                // Use direction from previous point
                prev = points[i - 1];
                dx = point.x - prev.x;
                dy = point.y - prev.y;
            } else {
                // Average of before and after directions
                prev = points[i - 1];
                next = points[i + 1];
                dx = next.x - prev.x;
                dy = next.y - prev.y;
            }

            // PERFORMANCE: Use fast inverse sqrt approximation for very long strokes
            // For normal cases, standard calculation is fine
            invLen = 1 / (Math.sqrt(dx * dx + dy * dy) || 1);
            perpX = -dy * invLen;
            perpY = dx * invLen;

            leftPoints[i] = {
                x: point.x + perpX * size,
                y: point.y + perpY * size,
            };

            rightPoints[i] = {
                x: point.x - perpX * size,
                y: point.y - perpY * size,
            };
        }

        // Draw the filled stroke shape
        const leftLen = numPoints;
        const rightLen = numPoints;

        if (leftLen > 1) {
            // PERFORMANCE: Begin path after all calculations
            ctx.beginPath();
            ctx.moveTo(leftPoints[0].x, leftPoints[0].y);

            // Draw left side with curves
            // PERFORMANCE: Cache length lookups and use local vars
            const lastLeftIdx = leftLen - 1;
            for (let i = 1; i < lastLeftIdx; i++) {
                const curr = leftPoints[i];
                const next = leftPoints[i + 1];
                ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) * 0.5, (curr.y + next.y) * 0.5);
            }

            const lastLeft = leftPoints[lastLeftIdx];
            ctx.lineTo(lastLeft.x, lastLeft.y);

            // Draw end cap
            const lastRight = rightPoints[rightLen - 1];
            const endCapRadius = (points[numPoints - 1].size || baseSize) * 0.5;
            ctx.arc(
                (lastLeft.x + lastRight.x) * 0.5,
                (lastLeft.y + lastRight.y) * 0.5,
                endCapRadius,
                0,
                Math.PI
            );

            // Draw right side (reversed)
            for (let i = rightLen - 2; i >= 1; i--) {
                const curr = rightPoints[i];
                const prev = rightPoints[i - 1];
                ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + prev.x) * 0.5, (curr.y + prev.y) * 0.5);
            }
            ctx.lineTo(rightPoints[0].x, rightPoints[0].y);

            // Draw start cap
            const firstLeft = leftPoints[0];
            const firstRight = rightPoints[0];
            const startCapRadius = (points[0].size || baseSize) * 0.5;
            ctx.arc(
                (firstLeft.x + firstRight.x) * 0.5,
                (firstLeft.y + firstRight.y) * 0.5,
                startCapRadius,
                Math.PI,
                0
            );

            ctx.closePath();
            ctx.fill();
        }
    }

    /**
     * Render a filled shape (from flood fill tool)
     */
    static renderFill(ctx, stroke) {
        if (!stroke.points || stroke.points.length < 3) return;

        ctx.save();

        const fillColor = stroke.fillColor || stroke.color || '#ffffff';
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = stroke.opacity || 1;

        const points = stroke.points;
        const triangles = stroke.fillTriangles;

        if (Array.isArray(triangles) && triangles.length) {
            ctx.beginPath();
            for (let i = 0; i < triangles.length; i += 3) {
                const a = points[triangles[i]];
                const b = points[triangles[i + 1]];
                const c = points[triangles[i + 2]];
                if (!a || !b || !c) continue;
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineTo(c.x, c.y);
                ctx.closePath();
            }
        } else {
            // Draw filled path
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);

            if (stroke.fillExact) {
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
            } else if (points.length > 2) {
                // Use quadratic curves for smoother edges
                for (let i = 1; i < points.length - 1; i++) {
                    const curr = points[i];
                    const next = points[i + 1];
                    const midX = (curr.x + next.x) * 0.5;
                    const midY = (curr.y + next.y) * 0.5;
                    ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
                }
                // Last point
                const last = points[points.length - 1];
                ctx.lineTo(last.x, last.y);
            } else {
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
            }
        }

        ctx.closePath();
        ctx.fill(stroke.fillRule || 'evenodd');

        if (stroke.fillUnderlayWidth) {
            ctx.save();
            ctx.strokeStyle = fillColor;
            ctx.lineWidth = stroke.fillUnderlayWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();
    }

    /**
     * Render stroke in highlighter mode
     */
    static renderHighlighter(ctx, stroke) {
        if (!stroke.points || stroke.points.length < 2) return;

        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = stroke.color || 'rgba(255, 235, 59, 0.4)';
        ctx.lineWidth = stroke.size || 20;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = stroke.opacity || 0.4;

        const points = stroke.points;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }

        ctx.stroke();
        ctx.restore();
    }

    /**
     * Simplify stroke points (Douglas-Peucker algorithm)
     */
    static simplify(points, tolerance = 1) {
        if (points.length <= 2) return points;

        // Find the point with maximum distance from line
        let maxDist = 0;
        let maxIndex = 0;

        const start = points[0];
        const end = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = StrokeRenderer.perpendicularDistance(points[i], start, end);
            if (dist > maxDist) {
                maxDist = dist;
                maxIndex = i;
            }
        }

        // If max distance is greater than tolerance, recursively simplify
        if (maxDist > tolerance) {
            const left = StrokeRenderer.simplify(points.slice(0, maxIndex + 1), tolerance);
            const right = StrokeRenderer.simplify(points.slice(maxIndex), tolerance);
            return [...left.slice(0, -1), ...right];
        } else {
            return [start, end];
        }
    }

    /**
     * Calculate perpendicular distance from point to line
     */
    static perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lineLengthSq = dx * dx + dy * dy;

        if (lineLengthSq === 0) {
            return Math.sqrt(
                Math.pow(point.x - lineStart.x, 2) +
                Math.pow(point.y - lineStart.y, 2)
            );
        }

        const t = Math.max(0, Math.min(1,
            ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSq
        ));

        const projX = lineStart.x + t * dx;
        const projY = lineStart.y + t * dy;

        return Math.sqrt(Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2));
    }

    /**
     * Smooth stroke points using Chaikin's Algorithm
     */
    static smooth(points, iterations = 3) {
        if (points.length < 3) return points;

        let currentPoints = [...points];

        for (let k = 0; k < iterations; k++) {
            const nextPoints = [currentPoints[0]];

            for (let i = 0; i < currentPoints.length - 1; i++) {
                const p0 = currentPoints[i];
                const p1 = currentPoints[i + 1];

                const q = {
                    x: 0.75 * p0.x + 0.25 * p1.x,
                    y: 0.75 * p0.y + 0.25 * p1.y,
                    pressure: p0.pressure !== undefined ? 0.75 * p0.pressure + 0.25 * p1.pressure : undefined,
                    size: p0.size !== undefined ? 0.75 * p0.size + 0.25 * p1.size : undefined
                };

                const r = {
                    x: 0.25 * p0.x + 0.75 * p1.x,
                    y: 0.25 * p0.y + 0.75 * p1.y,
                    pressure: p0.pressure !== undefined ? 0.25 * p0.pressure + 0.75 * p1.pressure : undefined,
                    size: p0.size !== undefined ? 0.25 * p0.size + 0.75 * p1.size : undefined
                };

                nextPoints.push(q);
                nextPoints.push(r);
            }

            nextPoints.push(currentPoints[currentPoints.length - 1]);
            currentPoints = nextPoints;
        }

        return currentPoints;
    }

    /**
     * Calculate point on Cubic Bezier curve
     */
    static cubicBezierPoint(p0, cp0, cp1, p1, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        return {
            x: mt3 * p0.x + 3 * mt2 * t * cp0.x + 3 * mt * t2 * cp1.x + t3 * p1.x,
            y: mt3 * p0.y + 3 * mt2 * t * cp0.y + 3 * mt * t2 * cp1.y + t3 * p1.y,
        };
    }

    /**
     * Calculate stroke bounding box
     */
    static getBoundingBox(stroke) {
        if (!stroke.points || stroke.points.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        const padding = (stroke.size || 3) / 2;

        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        return {
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
        };
    }
}


// Make available globally
window.StrokeRenderer = StrokeRenderer;
