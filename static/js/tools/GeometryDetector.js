/**
 * GeometryDetector - Real-time shape detection and cleanup
 * Detects circles, rectangles, triangles, lines, arrows from hand-drawn strokes
 * Uses pure algorithms, no AI
 */
class GeometryDetector {
    constructor() {
        this.enabled = false;
        this.snapAngleThreshold = 12; // degrees
    }

    /**
     * Enable/disable geometry mode
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[GeometryDetector] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Toggle geometry mode
     */
    toggle() {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }

    /**
     * Check if geometry mode is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Process a stroke and return either the original or a cleaned geometric shape
     * @param {Object} stroke - The raw stroke
     * @returns {Object} - The original stroke or transformed geometric stroke
     */
    processStroke(stroke) {
        if (!this.enabled || !stroke.points || stroke.points.length < 3) {
            return stroke;
        }

        // Convert stroke points to simple {x, y} format for detection
        const points = stroke.points.map(p => ({ x: p.x, y: p.y }));

        // Detect shape
        const detected = this.detectShape(points);

        if (detected.type === 'freehand' || detected.confidence < 0.5) {
            // Not a recognized shape, return original
            return stroke;
        }

        console.log(`[GeometryDetector] Detected: ${detected.type} (${(detected.confidence * 100).toFixed(0)}%)`);

        // Create clean geometric stroke
        return this.createCleanStroke(detected, stroke);
    }

    /**
     * Detect what shape the points represent
     */
    detectShape(points) {
        const start = points[0];
        const end = points[points.length - 1];
        const closingDist = this.distance(start, end);
        const bounds = this.getBounds(points);
        const diagLen = Math.sqrt(bounds.width ** 2 + bounds.height ** 2);

        // Is it closed?
        const isClosed = closingDist < diagLen * 0.25 && diagLen > 20;

        if (isClosed) {
            const circleScore = this.getCircleScore(points, bounds);
            const rectScore = this.getRectangleScore(points, bounds);
            const triangleScore = this.getTriangleScore(points, bounds);

            if (circleScore > 0.65 && circleScore >= rectScore && circleScore >= triangleScore) {
                return { type: 'circle', confidence: circleScore, bounds };
            } else if (triangleScore > 0.6 && triangleScore >= rectScore) {
                const corners = this.findCorners(points, 3);
                return { type: 'triangle', confidence: triangleScore, corners, bounds };
            } else if (rectScore > 0.55) {
                return { type: 'rectangle', confidence: rectScore, bounds };
            }
            return { type: 'freehand', confidence: 0 };
        } else {
            const lineScore = this.getLineScore(points);
            const arrowData = this.detectArrowHead(points);

            if (arrowData && lineScore > 0.65) {
                return { type: 'arrow', confidence: lineScore, start, end, arrowData };
            } else if (lineScore > 0.7) {
                return { type: 'line', confidence: lineScore, start, end };
            }
            return { type: 'freehand', confidence: 0 };
        }
    }

    /**
     * Create a clean stroke from detected shape
     */
    createCleanStroke(detected, originalStroke) {
        const baseProps = {
            id: originalStroke.id,
            color: originalStroke.color,
            size: originalStroke.size,
            opacity: originalStroke.opacity || 1,
            tool: originalStroke.tool,
            timestamp: originalStroke.timestamp,
            isGeometric: true, // Mark as cleaned shape
            geometryType: detected.type
        };

        switch (detected.type) {
            case 'circle':
                return this.createCircleStroke(detected, baseProps);
            case 'rectangle':
                return this.createRectangleStroke(detected, baseProps);
            case 'triangle':
                return this.createTriangleStroke(detected, baseProps);
            case 'line':
                return this.createLineStroke(detected, baseProps);
            case 'arrow':
                return this.createArrowStroke(detected, baseProps);
            default:
                return originalStroke;
        }
    }

    /**
     * Create circle stroke with points along circumference
     */
    createCircleStroke(detected, baseProps) {
        const { bounds } = detected;
        const cx = bounds.centerX;
        const cy = bounds.centerY;
        const radius = Math.max(bounds.width, bounds.height) / 2;

        const points = [];
        const segments = 36; // Smooth circle

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push({
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle),
                pressure: 0.5,
                size: baseProps.size
            });
        }

        return { ...baseProps, points };
    }

    /**
     * Create rectangle stroke
     */
    createRectangleStroke(detected, baseProps) {
        const { x, y, width, height } = detected.bounds;

        const corners = [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
            { x, y } // Close
        ];

        const points = corners.map(c => ({
            x: c.x,
            y: c.y,
            pressure: 0.5,
            size: baseProps.size
        }));

        return { ...baseProps, points };
    }

    /**
     * Create triangle stroke
     */
    createTriangleStroke(detected, baseProps) {
        let corners = detected.corners;

        if (!corners || corners.length < 3) {
            // Fallback: create equilateral-ish triangle from bounds
            const { bounds } = detected;
            corners = [
                { x: bounds.centerX, y: bounds.y },
                { x: bounds.x, y: bounds.y + bounds.height },
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
            ];
        }

        const points = [
            ...corners.slice(0, 3),
            corners[0] // Close
        ].map(c => ({
            x: c.x,
            y: c.y,
            pressure: 0.5,
            size: baseProps.size
        }));

        return { ...baseProps, points };
    }

    /**
     * Create line stroke with angle snapping
     */
    createLineStroke(detected, baseProps) {
        const snapped = this.snapLineToAngle(detected.start, detected.end);

        const points = [
            { x: snapped.start.x, y: snapped.start.y, pressure: 0.5, size: baseProps.size },
            { x: snapped.end.x, y: snapped.end.y, pressure: 0.5, size: baseProps.size }
        ];

        return { ...baseProps, points };
    }

    /**
     * Create arrow stroke (line + arrowhead)
     */
    createArrowStroke(detected, baseProps) {
        const snapped = this.snapLineToAngle(detected.start, detected.end);
        const start = snapped.start;
        const end = snapped.end;

        // Arrow head
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 15 + baseProps.size * 3;

        const head1 = {
            x: end.x - headLen * Math.cos(angle - Math.PI / 6),
            y: end.y - headLen * Math.sin(angle - Math.PI / 6)
        };
        const head2 = {
            x: end.x - headLen * Math.cos(angle + Math.PI / 6),
            y: end.y - headLen * Math.sin(angle + Math.PI / 6)
        };

        // Create points: line + head
        const points = [
            { x: start.x, y: start.y, pressure: 0.5, size: baseProps.size },
            { x: end.x, y: end.y, pressure: 0.5, size: baseProps.size },
            // Break for arrowhead (use same endpoint)
            { x: head1.x, y: head1.y, pressure: 0.5, size: baseProps.size },
            { x: end.x, y: end.y, pressure: 0.5, size: baseProps.size },
            { x: head2.x, y: head2.y, pressure: 0.5, size: baseProps.size }
        ];

        return { ...baseProps, points, isArrow: true };
    }

    // ========== Geometry Helpers ==========

    distance(p1, p2) {
        return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    }

    getBounds(points) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        return {
            x: minX, y: minY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }

    getCircleScore(points, bounds) {
        const cx = bounds.centerX;
        const cy = bounds.centerY;
        const radius = (bounds.width + bounds.height) / 4;

        if (radius < 10) return 0;

        let totalError = 0;
        for (const p of points) {
            const d = this.distance(p, { x: cx, y: cy });
            totalError += Math.abs(d - radius);
        }

        const avgError = totalError / points.length;
        const radiusScore = Math.max(0, 1 - (avgError / radius));

        const aspectRatio = Math.min(bounds.width, bounds.height) / Math.max(bounds.width, bounds.height);

        return radiusScore * 0.7 + aspectRatio * 0.3;
    }

    getRectangleScore(points, bounds) {
        const { x, y, width, height } = bounds;
        if (width < 15 || height < 15) return 0;

        const edges = [
            { x1: x, y1: y, x2: x + width, y2: y },
            { x1: x + width, y1: y, x2: x + width, y2: y + height },
            { x1: x + width, y1: y + height, x2: x, y2: y + height },
            { x1: x, y1: y + height, x2: x, y2: y }
        ];

        const threshold = Math.max(width, height) * 0.12;
        let nearEdgeCount = 0;

        for (const p of points) {
            for (const edge of edges) {
                if (this.pointToSegmentDist(p, edge) < threshold) {
                    nearEdgeCount++;
                    break;
                }
            }
        }

        const edgeScore = nearEdgeCount / points.length;
        const corners = this.findCorners(points, 4);
        const cornerScore = corners.length >= 3 ? 1 : corners.length / 4;

        return edgeScore * 0.6 + cornerScore * 0.4;
    }

    getTriangleScore(points, bounds) {
        const corners = this.findCorners(points, 5);

        if (corners.length < 3 || corners.length > 4) {
            return corners.length === 3 ? 0.5 : 0.2;
        }

        const triCorners = corners.slice(0, 3);
        const edges = [
            { x1: triCorners[0].x, y1: triCorners[0].y, x2: triCorners[1].x, y2: triCorners[1].y },
            { x1: triCorners[1].x, y1: triCorners[1].y, x2: triCorners[2].x, y2: triCorners[2].y },
            { x1: triCorners[2].x, y1: triCorners[2].y, x2: triCorners[0].x, y2: triCorners[0].y }
        ];

        const threshold = Math.max(bounds.width, bounds.height) * 0.15;
        let nearEdgeCount = 0;

        for (const p of points) {
            for (const edge of edges) {
                if (this.pointToSegmentDist(p, edge) < threshold) {
                    nearEdgeCount++;
                    break;
                }
            }
        }

        return nearEdgeCount / points.length;
    }

    getLineScore(points) {
        if (points.length < 2) return 0;

        const start = points[0];
        const end = points[points.length - 1];
        const lineLen = this.distance(start, end);

        if (lineLen < 15) return 0;

        let totalDist = 0;
        for (const p of points) {
            totalDist += this.pointToLineDist(p, start, end);
        }

        const avgDist = totalDist / points.length;
        return Math.max(0, 1 - (avgDist / lineLen) * 10);
    }

    pointToLineDist(point, lineStart, lineEnd) {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = lenSq !== 0 ? dot / lenSq : -1;

        let xx, yy;
        if (param < 0) {
            xx = lineStart.x; yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x; yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }

        return this.distance(point, { x: xx, y: yy });
    }

    pointToSegmentDist(point, segment) {
        return this.pointToLineDist(point,
            { x: segment.x1, y: segment.y1 },
            { x: segment.x2, y: segment.y2 }
        );
    }

    findCorners(points, minAngle = 4) {
        const corners = [];
        const angleThreshold = Math.PI / minAngle;

        const step = Math.max(1, Math.floor(points.length / 30));
        const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);

        if (sampled.length < 5) return [];

        for (let i = 2; i < sampled.length - 2; i++) {
            const prev = sampled[i - 2];
            const curr = sampled[i];
            const next = sampled[i + 2];

            const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
            const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);

            let angleDiff = Math.abs(angle2 - angle1);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            if (angleDiff > angleThreshold) {
                const tooClose = corners.some(c => this.distance(c, curr) < 20);
                if (!tooClose) {
                    corners.push(curr);
                }
            }
        }

        return corners;
    }

    detectArrowHead(points) {
        if (points.length < 15) return null;

        const lastPortion = points.slice(-Math.min(15, Math.floor(points.length * 0.3)));

        let maxCurvature = 0;
        let tipIndex = -1;

        for (let i = 3; i < lastPortion.length - 3; i++) {
            const prev = lastPortion[i - 3];
            const curr = lastPortion[i];
            const next = lastPortion[i + 3];

            const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
            const v2 = { x: next.x - curr.x, y: next.y - curr.y };

            const cross = v1.x * v2.y - v1.y * v2.x;
            const dot = v1.x * v2.x + v1.y * v2.y;
            const angle = Math.abs(Math.atan2(cross, dot));

            if (angle > maxCurvature && angle > Math.PI * 0.4) {
                maxCurvature = angle;
                tipIndex = i;
            }
        }

        if (tipIndex > 0 && maxCurvature > Math.PI * 0.4) {
            return { tipIndex, curvature: maxCurvature };
        }

        return null;
    }

    snapLineToAngle(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        let angle = Math.atan2(dy, dx) * (180 / Math.PI);

        const snapAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180];

        let closestAngle = angle;
        let minDiff = Infinity;

        for (const snap of snapAngles) {
            const diff = Math.abs(angle - snap);
            if (diff < minDiff && diff < this.snapAngleThreshold) {
                minDiff = diff;
                closestAngle = snap;
            }
        }

        const snappedRad = closestAngle * (Math.PI / 180);
        const newEnd = {
            x: start.x + length * Math.cos(snappedRad),
            y: start.y + length * Math.sin(snappedRad)
        };

        return { start, end: newEnd };
    }
}

// Create singleton instance
window.GeometryDetector = new GeometryDetector();
