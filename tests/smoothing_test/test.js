
// Test configuration
const RADIUS = 100;
const CENTER = { x: 150, y: 150 };

// --- Algorithms ---

// 1. Current Implementation (Cubic Bezier)
const Bezier = {
    name: 'Cubic Bezier',
    smooth: function(points, tension = 0.35, resolution = 10) {
        if (points.length < 3) return points;
        const smoothed = [];

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            const d1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
            const d2 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            const d3 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

            const m1 = tension * (d2 / (d1 + d2 || 1));
            const m2 = tension * (d2 / (d2 + d3 || 1));

            const cp1 = {
                x: p1.x + m1 * (p2.x - p0.x),
                y: p1.y + m1 * (p2.y - p0.y)
            };

            const cp2 = {
                x: p2.x - m2 * (p3.x - p1.x),
                y: p2.y - m2 * (p3.y - p1.y)
            };

            for (let t = 0; t < 1; t += 1 / resolution) {
                const t2 = t * t;
                const t3 = t2 * t;
                const mt = 1 - t;
                const mt2 = mt * mt;
                const mt3 = mt2 * mt;

                smoothed.push({
                    x: mt3 * p1.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p2.x,
                    y: mt3 * p1.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p2.y
                });
            }
        }
        smoothed.push(points[points.length - 1]);
        return smoothed;
    }
};

// 2. Previous Implementation (Catmull-Rom)
const CatmullRom = {
    name: 'Catmull-Rom',
    smooth: function(points, tension = 0.5, resolution = 10) {
        if (points.length < 3) return points;
        const smoothed = [points[0]];

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[Math.min(points.length - 1, i + 1)];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            for (let t = 1; t <= resolution; t++) {
                const s = t / resolution;
                const t2 = s * s;
                const t3 = t2 * s;

                const f = (1 - tension) / 2;

                const b0 = f * (-t3 + 2 * t2 - s);
                const b1 = f * (3 * t3 - 5 * t2 + 2);
                const b2 = f * (-3 * t3 + 4 * t2 + s);
                const b3 = f * (t3 - t2);

                smoothed.push({
                    x: p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
                    y: p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3
                });
            }
        }
        return smoothed;
    }
};

// 3. Chaikin's Algorithm (Corner Cutting)
const Chaikin = {
    name: 'Chaikin',
    smooth: function(points, iterations = 2) {
        if (points.length < 3) return points;
        let currentPoints = [...points];

        for (let i = 0; i < iterations; i++) {
            const nextPoints = [currentPoints[0]];

            for (let j = 0; j < currentPoints.length - 1; j++) {
                const p0 = currentPoints[j];
                const p1 = currentPoints[j + 1];

                // Q: 0.75 * p0 + 0.25 * p1
                // R: 0.25 * p0 + 0.75 * p1

                nextPoints.push({
                    x: 0.75 * p0.x + 0.25 * p1.x,
                    y: 0.75 * p0.y + 0.25 * p1.y
                });

                nextPoints.push({
                    x: 0.25 * p0.x + 0.75 * p1.x,
                    y: 0.25 * p0.y + 0.75 * p1.y
                });
            }

            nextPoints.push(currentPoints[currentPoints.length - 1]);
            currentPoints = nextPoints;
        }
        return currentPoints;
    }
};

// 4. Moving Average
const MovingAverage = {
    smooth: function(points, windowSize = 3) {
        if (points.length < windowSize) return points;
        const smoothed = [];
        const offset = Math.floor(windowSize / 2);

        for (let i = 0; i < points.length; i++) {
            let sumX = 0;
            let sumY = 0;
            let count = 0;

            for (let j = -offset; j <= offset; j++) {
                const idx = i + j;
                if (idx >= 0 && idx < points.length) {
                    sumX += points[idx].x;
                    sumY += points[idx].y;
                    count++;
                }
            }

            smoothed.push({
                x: sumX / count,
                y: sumY / count
            });
        }
        return smoothed;
    }
};

// --- Helper Functions ---

function generateNoisyCircle(radius, pointCount, jitterAmount) {
    const points = [];
    for (let i = 0; i <= pointCount; i++) {
        const angle = (i / pointCount) * Math.PI * 2;
        // Add some randomness to angle to simulate uneven speed
        const angleJitter = (Math.random() - 0.5) * 0.1;
        const finalAngle = angle + angleJitter;

        // Add jitter to radius to simulate shaky hand
        const r = radius + (Math.random() - 0.5) * jitterAmount;

        points.push({
            x: CENTER.x + Math.cos(finalAngle) * r,
            y: CENTER.y + Math.sin(finalAngle) * r
        });
    }
    return points;
}

function drawPoints(ctx, points, color = '#fff', width = 2) {
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // Draw vertices for debug
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function clearCanvas(id) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
}

function runTests() {
    const speed = parseInt(document.getElementById('speed').value);
    const jitter = parseInt(document.getElementById('jitter').value);

    // Invert speed for point count (faster = fewer points)
    const pointCount = Math.floor(150 - speed);

    const rawPoints = generateNoisyCircle(RADIUS, pointCount, jitter);

    // 1. Raw
    const ctxRaw = clearCanvas('c_raw');
    drawPoints(ctxRaw, rawPoints, '#888');
    document.getElementById('m_raw').innerText = `Points: ${rawPoints.length}`;

    // 2. Bezier
    const ctxBezier = clearCanvas('c_bezier');
    const startB = performance.now();
    const bezierPoints = Bezier.smooth(rawPoints);
    const timeB = performance.now() - startB;
    drawPoints(ctxBezier, bezierPoints, '#4caf50');
    document.getElementById('m_bezier').innerText = `Points: ${bezierPoints.length}, Time: ${timeB.toFixed(2)}ms`;

    // 3. Catmull-Rom
    const ctxCatmull = clearCanvas('c_catmull');
    const startC = performance.now();
    const catmullPoints = CatmullRom.smooth(rawPoints);
    const timeC = performance.now() - startC;
    drawPoints(ctxCatmull, catmullPoints, '#2196f3');
    document.getElementById('m_catmull').innerText = `Points: ${catmullPoints.length}, Time: ${timeC.toFixed(2)}ms`;

    // 4. Chaikin
    const ctxChaikin = clearCanvas('c_chaikin');
    const startCh = performance.now();
    const chaikinPoints = Chaikin.smooth(rawPoints, 4); // 4 iterations
    const timeCh = performance.now() - startCh;
    drawPoints(ctxChaikin, chaikinPoints, '#ff9800');
    document.getElementById('m_chaikin').innerText = `Points: ${chaikinPoints.length}, Time: ${timeCh.toFixed(2)}ms`;

    // 5. Hybrid (Avg + Chaikin)
    const ctxHybrid = clearCanvas('c_hybrid');
    const startHy = performance.now();
    // First smooth noise with Moving Average
    const avgPoints = MovingAverage.smooth(rawPoints, 5);
    // Then smooth curves with Chaikin
    const hybridPoints = Chaikin.smooth(avgPoints, 3);
    const timeHy = performance.now() - startHy;
    drawPoints(ctxHybrid, hybridPoints, '#e91e63');
    document.getElementById('m_hybrid').innerText = `Points: ${hybridPoints.length}, Time: ${timeHy.toFixed(2)}ms`;
}

// Initial run
window.onload = runTests;
