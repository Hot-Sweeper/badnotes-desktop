/**
 * ShapeTool - Draw geometric shapes
 * Supports lines, rectangles, circles, arrows, triangles
 */
class ShapeTool extends BaseTool {
    constructor(options = {}) {
        super('shape', {
            color: '#ffffff',
            size: 2,
            opacity: 1,
            fill: false,
            fillColor: 'rgba(255, 255, 255, 0.2)',
            ...options,
        });

        // Shape type
        this.shapeType = options.shapeType || 'rectangle';

        // Shape being drawn
        this.startPoint = null;
        this.currentShape = null;

        // Snap to perfect shapes
        this.snapEnabled = true;
        this.snapAngle = 15; // degrees
    }

    /**
     * Handle pointer down - start shape
     */
    onPointerDown(pointerData) {
        if (!this.isActive) return;

        this.isDrawing = true;
        this.startPoint = { x: pointerData.x, y: pointerData.y };
        this.currentShape = null;
    }

    /**
     * Handle pointer move - preview shape
     */
    onPointerMove(data) {
        if (!this.isActive || !this.isDrawing) return;

        const current = data.current;
        const endPoint = this.getEndPoint(current.x, current.y, data.shiftKey);

        // Create shape preview
        this.currentShape = this.createShape(this.startPoint, endPoint);

        // Draw preview
        this.drawShapePreview();
    }

    /**
     * Handle pointer up - finalize shape
     */
    onPointerUp(pointerData) {
        if (!this.isActive || !this.isDrawing) return;

        this.isDrawing = false;
        RenderEngine.clearUI();

        if (this.currentShape) {
            // Add shape to canvas
            const shape = {
                id: `shape_${Date.now()}`,
                type: 'shape',
                shapeType: this.shapeType,
                ...this.currentShape,
                color: this.settings.color,
                size: this.settings.size,
                fill: this.settings.fill,
                fillColor: this.settings.fillColor,
                opacity: this.settings.opacity,
            };

            CanvasManager.addShape(shape);
            this.emit('shapeCreated', shape);
        }

        this.startPoint = null;
        this.currentShape = null;
    }

    /**
     * Get end point with optional constraints
     */
    getEndPoint(x, y, constrain) {
        if (!constrain || !this.startPoint) {
            return { x, y };
        }

        const dx = x - this.startPoint.x;
        const dy = y - this.startPoint.y;

        switch (this.shapeType) {
            case 'line':
            case 'arrow':
                // Snap to angles
                return this.snapToAngle(dx, dy);

            case 'rectangle':
            case 'ellipse':
            case 'triangle':
                // Make square/circle
                const size = Math.max(Math.abs(dx), Math.abs(dy));
                return {
                    x: this.startPoint.x + size * Math.sign(dx || 1),
                    y: this.startPoint.y + size * Math.sign(dy || 1),
                };

            default:
                return { x, y };
        }
    }

    /**
     * Snap to angle increments
     */
    snapToAngle(dx, dy) {
        const angle = Math.atan2(dy, dx);
        const snapRad = (this.snapAngle * Math.PI) / 180;
        const snappedAngle = Math.round(angle / snapRad) * snapRad;
        const length = Math.sqrt(dx * dx + dy * dy);

        return {
            x: this.startPoint.x + Math.cos(snappedAngle) * length,
            y: this.startPoint.y + Math.sin(snappedAngle) * length,
        };
    }

    /**
     * Create shape data
     */
    createShape(start, end) {
        switch (this.shapeType) {
            case 'line':
                return this.createLine(start, end);
            case 'arrow':
                return this.createArrow(start, end);
            case 'rectangle':
                return this.createRectangle(start, end);
            case 'ellipse':
                return this.createEllipse(start, end);
            case 'triangle':
                return this.createTriangle(start, end);
            default:
                return null;
        }
    }

    /**
     * Create line shape
     */
    createLine(start, end) {
        return {
            points: [start, end],
        };
    }

    /**
     * Create arrow shape
     */
    createArrow(start, end) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6;

        const arrowPoint1 = {
            x: end.x - arrowLength * Math.cos(angle - arrowAngle),
            y: end.y - arrowLength * Math.sin(angle - arrowAngle),
        };

        const arrowPoint2 = {
            x: end.x - arrowLength * Math.cos(angle + arrowAngle),
            y: end.y - arrowLength * Math.sin(angle + arrowAngle),
        };

        return {
            points: [start, end],
            arrowHead: [arrowPoint1, end, arrowPoint2],
        };
    }

    /**
     * Create rectangle shape
     */
    createRectangle(start, end) {
        return {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
        };
    }

    /**
     * Create ellipse shape
     */
    createEllipse(start, end) {
        return {
            cx: (start.x + end.x) / 2,
            cy: (start.y + end.y) / 2,
            rx: Math.abs(end.x - start.x) / 2,
            ry: Math.abs(end.y - start.y) / 2,
        };
    }

    /**
     * Create triangle shape
     */
    createTriangle(start, end) {
        const midX = (start.x + end.x) / 2;

        return {
            points: [
                { x: midX, y: Math.min(start.y, end.y) },
                { x: Math.min(start.x, end.x), y: Math.max(start.y, end.y) },
                { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
            ],
        };
    }

    /**
     * Draw shape preview
     */
    drawShapePreview() {
        RenderEngine.clearUI();

        if (!this.currentShape) return;

        RenderEngine.drawUI((ctx) => {
            ctx.strokeStyle = this.settings.color;
            ctx.lineWidth = this.settings.size;
            ctx.globalAlpha = this.settings.opacity;

            if (this.settings.fill) {
                ctx.fillStyle = this.settings.fillColor;
            }

            ctx.setLineDash([5, 5]);

            switch (this.shapeType) {
                case 'line':
                    this.drawLine(ctx);
                    break;
                case 'arrow':
                    this.drawArrow(ctx);
                    break;
                case 'rectangle':
                    this.drawRectangle(ctx);
                    break;
                case 'ellipse':
                    this.drawEllipse(ctx);
                    break;
                case 'triangle':
                    this.drawTriangle(ctx);
                    break;
            }

            ctx.setLineDash([]);
        });
    }

    /**
     * Draw line
     */
    drawLine(ctx) {
        const { points } = this.currentShape;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
    }

    /**
     * Draw arrow
     */
    drawArrow(ctx) {
        const { points, arrowHead } = this.currentShape;

        // Main line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();

        // Arrow head
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(arrowHead[0].x, arrowHead[0].y);
        ctx.lineTo(arrowHead[1].x, arrowHead[1].y);
        ctx.lineTo(arrowHead[2].x, arrowHead[2].y);
        ctx.stroke();
    }

    /**
     * Draw rectangle
     */
    drawRectangle(ctx) {
        const { x, y, width, height } = this.currentShape;

        if (this.settings.fill) {
            ctx.fillRect(x, y, width, height);
        }
        ctx.strokeRect(x, y, width, height);
    }

    /**
     * Draw ellipse
     */
    drawEllipse(ctx) {
        const { cx, cy, rx, ry } = this.currentShape;

        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

        if (this.settings.fill) {
            ctx.fill();
        }
        ctx.stroke();
    }

    /**
     * Draw triangle
     */
    drawTriangle(ctx) {
        const { points } = this.currentShape;

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.lineTo(points[2].x, points[2].y);
        ctx.closePath();

        if (this.settings.fill) {
            ctx.fill();
        }
        ctx.stroke();
    }

    /**
     * Set shape type
     */
    setShapeType(type) {
        this.shapeType = type;
        this.emit('shapeTypeChanged', type);
    }

    /**
     * Toggle fill
     */
    toggleFill() {
        this.settings.fill = !this.settings.fill;
        this.emit('fillChanged', this.settings.fill);
    }

    getCursor() {
        return 'crosshair';
    }
}


/**
 * Render shapes on canvas
 */
class ShapeRenderer {
    /**
     * Render a shape
     */
    static render(ctx, shape) {
        ctx.save();
        ctx.strokeStyle = shape.color || '#ffffff';
        ctx.lineWidth = shape.size || 2;
        ctx.globalAlpha = shape.opacity || 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (shape.fill) {
            ctx.fillStyle = shape.fillColor || 'rgba(255, 255, 255, 0.2)';
        }

        switch (shape.shapeType) {
            case 'line':
                ShapeRenderer.renderLine(ctx, shape);
                break;
            case 'arrow':
                ShapeRenderer.renderArrow(ctx, shape);
                break;
            case 'rectangle':
                ShapeRenderer.renderRectangle(ctx, shape);
                break;
            case 'ellipse':
                ShapeRenderer.renderEllipse(ctx, shape);
                break;
            case 'triangle':
                ShapeRenderer.renderTriangle(ctx, shape);
                break;
        }

        ctx.restore();
    }

    static renderLine(ctx, shape) {
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        ctx.lineTo(shape.points[1].x, shape.points[1].y);
        ctx.stroke();
    }

    static renderArrow(ctx, shape) {
        // Main line
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        ctx.lineTo(shape.points[1].x, shape.points[1].y);
        ctx.stroke();

        // Arrow head
        if (shape.arrowHead) {
            ctx.beginPath();
            ctx.moveTo(shape.arrowHead[0].x, shape.arrowHead[0].y);
            ctx.lineTo(shape.arrowHead[1].x, shape.arrowHead[1].y);
            ctx.lineTo(shape.arrowHead[2].x, shape.arrowHead[2].y);
            ctx.stroke();
        }
    }

    static renderRectangle(ctx, shape) {
        if (shape.fill) {
            ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
        }
        ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
    }

    static renderEllipse(ctx, shape) {
        ctx.beginPath();
        ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
        if (shape.fill) {
            ctx.fill();
        }
        ctx.stroke();
    }

    static renderTriangle(ctx, shape) {
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        ctx.lineTo(shape.points[1].x, shape.points[1].y);
        ctx.lineTo(shape.points[2].x, shape.points[2].y);
        ctx.closePath();
        if (shape.fill) {
            ctx.fill();
        }
        ctx.stroke();
    }
}


// Make available globally
window.ShapeTool = ShapeTool;
window.ShapeRenderer = ShapeRenderer;
