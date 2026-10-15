// ============== Apple-Style Post-Stroke Bezier Smoothing ==============
        // Based on tridiagonal algorithm for optimal bezier control points
        // This creates smooth curves that pass through all points with C2 continuity

        // Calculate first control points for bezier spline using tridiagonal system
        function getFirstControlPoints(rhs) {
            const n = rhs.length;
            const x = new Array(n);
            const tmp = new Array(n);

            let b = 2.0;
            x[0] = rhs[0] / b;

            for (let i = 1; i < n; i++) {
                tmp[i] = 1 / b;
                b = (i < n - 1 ? 4.0 : 3.5) - tmp[i];
                x[i] = (rhs[i] - x[i - 1]) / b;
            }

            for (let i = 1; i < n; i++) {
                x[n - i - 1] -= tmp[n - i] * x[n - i];
            }

            return x;
        }

        // Get bezier control points for smooth curve through knot points
        function getBezierControlPoints(knots) {
            if (!knots || knots.length < 2) return null;

            const n = knots.length - 1;

            if (n === 1) {
                // Special case: straight line - control points at 1/3 and 2/3
                return {
                    firstControlPoints: [{
                        x: (2 * knots[0].x + knots[1].x) / 3,
                        y: (2 * knots[0].y + knots[1].y) / 3
                    }],
                    secondControlPoints: [{
                        x: (knots[0].x + 2 * knots[1].x) / 3,
                        y: (knots[0].y + 2 * knots[1].y) / 3
                    }]
                };
            }

            // Right hand side vector
            const rhsX = new Array(n);
            const rhsY = new Array(n);

            // Set right hand side values
            for (let i = 1; i < n - 1; i++) {
                rhsX[i] = 4 * knots[i].x + 2 * knots[i + 1].x;
                rhsY[i] = 4 * knots[i].y + 2 * knots[i + 1].y;
            }
            rhsX[0] = knots[0].x + 2 * knots[1].x;
            rhsY[0] = knots[0].y + 2 * knots[1].y;
            rhsX[n - 1] = (8 * knots[n - 1].x + knots[n].x) / 2.0;
            rhsY[n - 1] = (8 * knots[n - 1].y + knots[n].y) / 2.0;

            // Get first control points
            const x = getFirstControlPoints(rhsX);
            const y = getFirstControlPoints(rhsY);

            // Fill output arrays
            const firstControlPoints = [];
            const secondControlPoints = [];

            for (let i = 0; i < n; i++) {
                firstControlPoints.push({ x: x[i], y: y[i] });

                if (i < n - 1) {
                    secondControlPoints.push({
                        x: 2 * knots[i + 1].x - x[i + 1],
                        y: 2 * knots[i + 1].y - y[i + 1]
                    });
                } else {
                    secondControlPoints.push({
                        x: (knots[n].x + x[n - 1]) / 2,
                        y: (knots[n].y + y[n - 1]) / 2
                    });
                }
            }

            return { firstControlPoints, secondControlPoints };
        }

        // Canvas resolution scale for high DPI
        let canvasScale = window.devicePixelRatio || 1;
        let baseWidth = 800;
        let baseHeight = 1100;

        // Elements
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for opaque background
        const activeCanvas = document.getElementById('activeCanvas');
        const activeCtx = activeCanvas.getContext('2d', { alpha: true }); // Transparent for active stroke
        const canvasWrapper = document.getElementById('canvasWrapper');

// ============== Toast ==============
        function showToast(message, type = 'info', duration = 3000) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), duration);
        }
