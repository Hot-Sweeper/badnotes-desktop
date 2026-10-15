// ============================================================
// Gravity Scene — Cosmic Events (meteors, flares, rogue planets)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.updateCosmicEvents = function (dt, bodies) {
        GS.state._eventTimer = (GS.state._eventTimer || 0) + dt;

        // Spawn new event every 30-60s
        if (!GS.state.cosmicEvent && GS.state._eventTimer > 30 + Math.random() * 30) {
            GS.state._eventTimer = 0;
            const types = ['meteor_storm', 'solar_flare', 'rogue_planet'];
            const hasStars = bodies.some(b => GS.bodyType(b.mass) === 'star');
            if (!hasStars) types.splice(types.indexOf('solar_flare'), 1);
            const type = types[Math.floor(Math.random() * types.length)];
            const vw = GS.state._vw, vh = GS.state._vh;

            if (type === 'meteor_storm') {
                const side = Math.floor(Math.random() * 4);
                const count = 5 + Math.floor(Math.random() * 4);
                const meteors = [];
                for (let i = 0; i < count; i++) {
                    let mx, my, mvx, mvy;
                    const spd = 300 + Math.random() * 200;
                    if (side === 0)      { mx = Math.random() * vw; my = -10; mvx = (Math.random() - 0.5) * 100; mvy = spd; }
                    else if (side === 1) { mx = vw + 10; my = Math.random() * vh; mvx = -spd; mvy = (Math.random() - 0.5) * 100; }
                    else if (side === 2) { mx = Math.random() * vw; my = vh + 10; mvx = (Math.random() - 0.5) * 100; mvy = -spd; }
                    else                 { mx = -10; my = Math.random() * vh; mvx = spd; mvy = (Math.random() - 0.5) * 100; }
                    meteors.push({ x: mx, y: my, vx: mvx, vy: mvy, alive: true, r: 2 + Math.random() * 2 });
                }
                GS.state.cosmicEvent = { type: 'meteor_storm', duration: 5, life: 5, meteors: meteors };
            }

            else if (type === 'solar_flare') {
                const stars = bodies.filter(b => GS.bodyType(b.mass) === 'star');
                if (stars.length > 0) {
                    const star = stars[Math.floor(Math.random() * stars.length)];
                    GS.state.cosmicEvent = {
                        type: 'solar_flare', duration: 3, life: 3,
                        star: star, angle: Math.random() * Math.PI * 2,
                        spread: 0.5, range: 300,
                    };
                }
            }

            else if (type === 'rogue_planet' && bodies.length < GS.MAX_BODIES) {
                const side = Math.floor(Math.random() * 4);
                let rx, ry, rvx, rvy;
                const spd = 80 + Math.random() * 60;
                if (side === 0)      { rx = Math.random() * vw; ry = -40; rvx = (Math.random() - 0.5) * 30; rvy = spd; }
                else if (side === 1) { rx = vw + 40; ry = Math.random() * vh; rvx = -spd; rvy = (Math.random() - 0.5) * 30; }
                else if (side === 2) { rx = Math.random() * vw; ry = vh + 40; rvx = (Math.random() - 0.5) * 30; rvy = -spd; }
                else                 { rx = -40; ry = Math.random() * vh; rvx = spd; rvy = (Math.random() - 0.5) * 30; }
                const rogue = GS.createBody(rx, ry, rvx, rvy, 100 + Math.random() * 200);
                bodies.push(rogue);
                GS.state.cosmicEvent = { type: 'rogue_planet', duration: 15, life: 15, body: rogue };
                GS.spawnRing(rx, ry, 30, 'rgba(200,200,255,0.5)', 0.5, 2);
            }
        }

        // Update active event
        const ev = GS.state.cosmicEvent;
        if (!ev) return;
        ev.life -= dt;

        if (ev.type === 'meteor_storm') {
            for (const m of ev.meteors) {
                if (!m.alive) continue;
                m.x += m.vx * dt;
                m.y += m.vy * dt;
                for (const b of bodies) {
                    const dx = b.x - m.x, dy = b.y - m.y;
                    if (dx * dx + dy * dy < (b.r + m.r) * (b.r + m.r)) {
                        m.alive = false;
                        GS.spawnFlash(m.x, m.y, 8, 'rgba(255,200,100,0.7)', 0.2);
                        GS.spawnDebris(m.x, m.y, 5, 30, 1);
                        if (b.civ && b.civ.settlements.length > 0) {
                            b.civ.settlements.splice(Math.floor(Math.random() * b.civ.settlements.length), 1);
                        }
                        break;
                    }
                }
                if (m.x < -50 || m.x > GS.state._vw + 50 || m.y < -50 || m.y > GS.state._vh + 50) {
                    m.alive = false;
                }
            }
        }

        else if (ev.type === 'solar_flare') {
            if (bodies.indexOf(ev.star) < 0) { GS.state.cosmicEvent = null; return; }
            const t = 1 - ev.life / ev.duration;
            const curRange = ev.range * t;
            for (const b of bodies) {
                if (b === ev.star || !b.civ) continue;
                const dx = b.x - ev.star.x, dy = b.y - ev.star.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > curRange) continue;
                let angDiff = Math.abs(Math.atan2(dy, dx) - ev.angle);
                if (angDiff > Math.PI) angDiff = Math.PI * 2 - angDiff;
                if (angDiff < ev.spread) {
                    if (b.civ.shields > 0.1) {
                        b.civ.shields -= 0.1 * dt;
                    } else if (Math.random() < 0.05 * dt && b.civ.settlements.length > 0) {
                        b.civ.settlements.splice(Math.floor(Math.random() * b.civ.settlements.length), 1);
                    }
                }
            }
        }

        if (ev.life <= 0) { GS.state.cosmicEvent = null; }
    };

    GS.drawCosmicEvent = function (ctx) {
        const ev = GS.state.cosmicEvent;
        if (!ev) return;

        if (ev.type === 'meteor_storm') {
            for (const m of ev.meteors) {
                if (!m.alive) continue;
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = '#DDA044';
                ctx.beginPath();
                ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
                ctx.fill();
                const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy) + 1;
                ctx.globalAlpha = 0.3;
                ctx.strokeStyle = '#FF8833';
                ctx.lineWidth = m.r * 0.8;
                ctx.beginPath();
                ctx.moveTo(m.x, m.y);
                ctx.lineTo(m.x - m.vx / spd * 15, m.y - m.vy / spd * 15);
                ctx.stroke();
            }
        }

        else if (ev.type === 'solar_flare') {
            if (!ev.star || GS.state.bodies.indexOf(ev.star) < 0) return;
            const t = 1 - ev.life / ev.duration;
            const curRange = ev.range * t;
            ctx.save();
            ctx.translate(ev.star.x, ev.star.y);
            ctx.rotate(ev.angle);
            ctx.globalAlpha = (1 - t) * 0.25;
            ctx.fillStyle = `hsla(${ev.star.hue}, 100%, 70%, 0.5)`;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, curRange, -ev.spread, ev.spread);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = (1 - t) * 0.4;
            ctx.strokeStyle = `hsla(${ev.star.hue}, 100%, 85%, 0.8)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(ev.star.r, 0);
            ctx.lineTo(curRange, 0);
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalAlpha = 1;
    };
})();
