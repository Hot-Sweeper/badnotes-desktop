// ============================================================
// Gravity Scene — Mega Structures (Dyson Ring, shields)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.updateMegaStructures = function (dt, bodies) {
        for (const b of bodies) {
            if (!b.civ || b.civ.techLevel < 7) continue;

            // Dyson Ring construction (tech >= 7, near a star)
            if (!b.civ.dysonRing && !b.civ._dysonBuilding) {
                for (const s of bodies) {
                    if (GS.bodyType(s.mass) !== 'star') continue;
                    const dx = s.x - b.x, dy = s.y - b.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 250 && b.civ.resources > 500) {
                        b.civ._dysonBuilding = { star: s, progress: 0, segments: 0 };
                        b.civ.resources -= 500;
                        break;
                    }
                }
            }

            // Build progress
            if (b.civ._dysonBuilding) {
                const db = b.civ._dysonBuilding;
                if (bodies.indexOf(db.star) < 0) { b.civ._dysonBuilding = null; continue; }
                db.progress += dt / 30;
                db.segments = Math.floor(db.progress * 16);
                if (db.progress >= 1) {
                    b.civ.dysonRing = { star: db.star, segments: 16, angle: 0 };
                    b.civ._dysonBuilding = null;
                    GS.spawnRing(db.star.x, db.star.y, db.star.r * 4, 'rgba(255,220,50,0.7)', 1, 3);
                }
            }

            // Dyson Ring benefits
            if (b.civ.dysonRing) {
                const dr = b.civ.dysonRing;
                if (bodies.indexOf(dr.star) < 0) { b.civ.dysonRing = null; continue; }
                dr.angle = (dr.angle || 0) + dt * 0.3;
                b.civ.techLevel = Math.min(10, b.civ.techLevel + 0.01 * dt);
                b.civ.resources += 5 * dt;
            }

            // Planetary shield regeneration (tech >= 5)
            if (b.civ.techLevel >= 5 && b.civ.shields < 1) {
                b.civ.shields = Math.min(1, b.civ.shields + 0.02 * dt);
            }
        }
    };

    GS.drawMegaStructures = function (ctx, bodies, time) {
        for (const b of bodies) {
            if (!b.civ) continue;

            // Dyson Ring rendering
            if (b.civ.dysonRing) {
                const dr = b.civ.dysonRing;
                if (bodies.indexOf(dr.star) < 0) continue;
                const sx = dr.star.x, sy = dr.star.y;
                const ringR = dr.star.r * 2.5;
                const fc = GS.FACTIONS[b.civ.faction].color;

                for (let i = 0; i < dr.segments; i++) {
                    const ang = (Math.PI * 2 * i / 16) + dr.angle;
                    const x = sx + Math.cos(ang) * ringR;
                    const y = sy + Math.sin(ang) * ringR;
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = fc;
                    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
                    if (i < dr.segments - 1) {
                        const nAng = (Math.PI * 2 * (i + 1) / 16) + dr.angle;
                        ctx.globalAlpha = 0.3;
                        ctx.strokeStyle = fc;
                        ctx.lineWidth = 0.8;
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(sx + Math.cos(nAng) * ringR, sy + Math.sin(nAng) * ringR);
                        ctx.stroke();
                    }
                }
                ctx.globalAlpha = 0.1 + 0.05 * Math.sin(time * 3);
                ctx.strokeStyle = 'rgba(255,220,80,0.4)';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(sx, sy, ringR, 0, Math.PI * 2); ctx.stroke();
            }

            // Building progress
            if (b.civ._dysonBuilding) {
                const db = b.civ._dysonBuilding;
                if (bodies.indexOf(db.star) < 0) continue;
                const sx = db.star.x, sy = db.star.y;
                const ringR = db.star.r * 2.5;
                for (let i = 0; i < db.segments; i++) {
                    const ang = (Math.PI * 2 * i / 16);
                    ctx.globalAlpha = 0.4;
                    ctx.fillStyle = GS.FACTIONS[b.civ.faction].color;
                    ctx.beginPath();
                    ctx.arc(sx + Math.cos(ang) * ringR, sy + Math.sin(ang) * ringR, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 0.15;
                ctx.strokeStyle = GS.FACTIONS[b.civ.faction].color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(sx, sy, ringR, 0, Math.PI * 2 * db.progress);
                ctx.stroke();
            }

            // Planetary shield dome
            if (b.civ.shields > 0.05) {
                const shieldR = b.r + 4;
                ctx.globalAlpha = b.civ.shields * 0.15;
                ctx.strokeStyle = GS.FACTIONS[b.civ.faction].color;
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(b.x, b.y, shieldR, 0, Math.PI * 2); ctx.stroke();
                if (b.civ._shieldHit) {
                    b.civ._shieldHit -= 0.016; // approx dt
                    if (b.civ._shieldHit > 0) {
                        ctx.globalAlpha = b.civ._shieldHit * 0.6;
                        ctx.fillStyle = 'rgba(255,255,255,0.3)';
                        ctx.beginPath(); ctx.arc(b.x, b.y, shieldR, 0, Math.PI * 2); ctx.fill();
                    } else {
                        b.civ._shieldHit = 0;
                    }
                }
            }
        }
        ctx.globalAlpha = 1;
    };
})();
