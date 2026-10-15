// ============================================================
// Gravity Scene — Destruction & Evacuation
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.handleDestruction = function (bodies, dt) {
        for (let i = bodies.length - 1; i >= 0; i--) {
            const b = bodies[i];
            if (!b.civ) continue;

            // Check proximity to black holes
            for (const bh of bodies) {
                if (GS.bodyType(bh.mass) !== 'blackhole') continue;
                const dx = b.x - bh.x, dy = b.y - bh.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const dangerR = bh.r * 3;

                if (dist < dangerR) {
                    if (!b.civ._bhDistress) {
                        b.civ._bhDistress = true;
                        b.civ.alert = 'evacuation';
                        const podCount = 2 + Math.floor(Math.random() * 4);
                        for (let p = 0; p < podCount; p++) {
                            const ang = Math.random() * Math.PI * 2;
                            const escVel = 200 + Math.random() * 200;
                            GS.state.rockets.push({
                                x: b.x, y: b.y,
                                vx: Math.cos(ang) * escVel + b.vx,
                                vy: Math.sin(ang) * escVel + b.vy,
                                faction: b.civ.faction, type: 'escape',
                                origin: b, target: null,
                                fuel: 0, hp: 1, cargo: 'refugees',
                                trail: [], age: 0
                            });
                        }
                    }
                }
            }

            // Colony dies if population too low
            if (b.civ.population < 0.5) {
                b.civ = null;
            }
        }

        // Escape pod lifetime (disappear after 15s)
        for (let i = GS.state.rockets.length - 1; i >= 0; i--) {
            const r = GS.state.rockets[i];
            if (r.type === 'escape' && r.age > 15) {
                GS.state.rockets.splice(i, 1);
                continue;
            }
            if (r.type === 'escape' && r.age > 1) {
                for (const b of bodies) {
                    if (!b.civ || b.civ.faction !== r.faction) continue;
                    const dx = b.x - r.x, dy = b.y - r.y;
                    if (Math.sqrt(dx * dx + dy * dy) < b.r * 2) {
                        b.civ.population += 2;
                        GS.spawnFlash(r.x, r.y, 5, GS.FACTIONS[r.faction].color + '88', 0.15);
                        GS.state.rockets.splice(i, 1);
                        break;
                    }
                }
            }
        }
    };

    GS.drawDestructionEffects = function (ctx, bodies, time) {
        for (const b of bodies) {
            if (!b.civ) continue;

            // Black hole distress — spaghettification visual
            if (b.civ._bhDistress) {
                for (const bh of bodies) {
                    if (GS.bodyType(bh.mass) !== 'blackhole') continue;
                    const dx = bh.x - b.x, dy = bh.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < bh.r * 4) {
                        ctx.globalAlpha = 0.3;
                        ctx.strokeStyle = 'rgba(200,100,255,0.5)';
                        ctx.lineWidth = 1;
                        for (let i = 0; i < 3; i++) {
                            const offx = (Math.random() - 0.5) * b.r;
                            const offy = (Math.random() - 0.5) * b.r;
                            ctx.beginPath();
                            ctx.moveTo(b.x + offx, b.y + offy);
                            ctx.lineTo(b.x + dx * 0.3 + offx * 0.5, b.y + dy * 0.3 + offy * 0.5);
                            ctx.stroke();
                        }
                    }
                }
            }

            // Evacuation alert icon — flashing red ring
            if (b.civ.alert === 'evacuation' || b.civ.alert === 'war') {
                const flash = Math.sin(time * 10) > 0 ? 0.4 : 0.1;
                ctx.globalAlpha = flash;
                ctx.strokeStyle = b.civ.alert === 'evacuation' ? '#FF4444' : '#FF8800';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, 0, Math.PI * 2); ctx.stroke();
            }
        }

        // Faction elimination check
        if (!GS.state._elimCheck) GS.state._elimCheck = 0;
        GS.state._elimCheck += 1;
        if (GS.state._elimCheck % 180 === 0) {
            for (let f = 0; f < 6; f++) {
                if (GS.state.factions[f].eliminated) continue;
                const hasCiv = bodies.some(b => b.civ && b.civ.faction === f);
                const hasRocket = GS.state.rockets.some(r => r.faction === f);
                if (!hasCiv && !hasRocket) {
                    GS.state.factions[f].eliminated = true;
                    GS.spawnFlash(GS.state._vw / 2, GS.state._vh / 2, 100, GS.FACTIONS[f].color + '66', 0.5);
                }
            }
        }

        ctx.globalAlpha = 1;
    };
})();
