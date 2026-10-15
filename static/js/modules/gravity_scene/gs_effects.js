// ============================================================
// Gravity Scene — Visual Effects (debris, rings, flashes, collapse)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.spawnDebris = function (x, y, count, hue, speedMul) {
        const sm = speedMul || 1;
        for (let i = 0; i < count; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = (0.4 + Math.random() * 1.2) * sm;
            GS.state.particles.push({
                x, y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd,
                r: 1.5 + Math.random() * 2,
                hue: typeof hue === 'number' ? hue : 40,
                life: 0.8 + Math.random() * 2.0,
                maxLife: 0.8 + Math.random() * 2.0
            });
            // Fix maxLife to match life
            const p = GS.state.particles[GS.state.particles.length - 1];
            p.maxLife = p.life;
        }
    };

    GS.spawnRing = function (x, y, maxR, color, duration, width) {
        GS.state.effects.push({
            type: 'ring', x, y, maxR,
            color: color || 'rgba(255,255,255,0.5)',
            life: duration || 0.5,
            duration: duration || 0.5,
            width: width || 2
        });
    };

    GS.spawnFlash = function (x, y, maxR, color, duration) {
        GS.state.effects.push({
            type: 'flash', x, y, maxR,
            color: color || 'rgba(255,255,255,0.5)',
            life: duration || 0.3,
            duration: duration || 0.3
        });
    };

    GS.spawnPromotion = function (x, y, r, newType) {
        const hues = { moon: 200, planet: 180, star: 45, blackhole: 280 };
        const hue = hues[newType] || 40;
        GS.spawnRing(x, y, r * 5, `hsla(${hue}, 80%, 60%, 0.6)`, 0.8, 3);
        GS.spawnFlash(x, y, r * 3, `hsla(${hue}, 90%, 70%, 0.7)`, 0.4);
        GS.spawnDebris(x, y, 12, hue, 1.5);
    };

    GS.spawnCollapse = function (x, y, r) {
        // Multiple rings for dramatic effect
        GS.spawnRing(x, y, r * 8, 'rgba(180,100,255,0.7)', 1.5, 4);
        GS.spawnRing(x, y, r * 5, 'rgba(255,200,100,0.5)', 1.0, 3);
        GS.spawnRing(x, y, r * 3, 'rgba(255,255,255,0.6)', 0.6, 2);
        GS.spawnFlash(x, y, r * 6, 'rgba(180,100,255,0.8)', 0.5);
        GS.spawnDebris(x, y, 25, 280, 2);
    };
})();
