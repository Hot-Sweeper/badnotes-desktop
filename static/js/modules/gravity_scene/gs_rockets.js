// ============================================================
// Gravity Scene — Rocket System (create, update, draw)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.createRocket = function (origin, target, type, factionId) {
        const ang = Math.atan2(target.y - origin.y, target.x - origin.x);
        const startX = origin.x + Math.cos(ang) * (origin.r + 3);
        const startY = origin.y + Math.sin(ang) * (origin.r + 3);
        const launchSpd = 120;
        return {
            x: startX, y: startY,
            vx: origin.vx + Math.cos(ang) * launchSpd,
            vy: origin.vy + Math.sin(ang) * launchSpd,
            faction: factionId,
            type: type,
            origin: origin,
            target: target,
            fuel: type === 'colony' ? 3.0 : 2.0,
            hp: type === 'colony' ? 2 : 1,
            cargo: type === 'colony' ? { population: 5 } : {},
            trail: [],
            age: 0,
            orbiting: false,
            orbitTime: 0,
            orbitAngle: 0,
        };
    };

    GS.updateRockets = function (dt, bodies) {
        const rockets = GS.state.rockets;
        for (let i = rockets.length - 1; i >= 0; i--) {
            const r = rockets[i];
            r.age += dt;

            // Despawn: too old
            if (r.age > 30) { rockets.splice(i, 1); continue; }

            // Trail breadcrumb
            r.trail.push({ x: r.x, y: r.y });
            if (r.trail.length > GS.ROCKET_TRAIL_LEN) r.trail.shift();

            // Target destroyed?
            if (r.target && bodies.indexOf(r.target) < 0) {
                if (r.type === 'refugee') {
                    r.target = null;
                    r.orbiting = false;
                    r.orbitTime = 0;
                } else {
                    rockets.splice(i, 1);
                    GS.spawnDebris(r.x, r.y, 3, GS.FACTIONS[r.faction].hue, 0.5);
                    continue;
                }
            }

            // Refugee: dynamically search for a new home
            if (r.type === 'refugee' && !r.target) {
                let best = null, bestScore = Infinity;
                for (const b of bodies) {
                    const bt = GS.bodyType(b.mass);
                    if (bt === 'star' || bt === 'blackhole') continue;
                    const ddx = b.x - r.x, ddy = b.y - r.y;
                    const d = Math.sqrt(ddx * ddx + ddy * ddy);
                    let score = d;
                    if (b.civ && b.civ.faction === r.faction) score *= 0.3;
                    else if (bt === 'planet') score *= 0.5;
                    else if (b.civ) score *= 0.7;
                    if (score < bestScore) { bestScore = score; best = b; }
                }
                if (best) { r.target = best; r.fuel = 3.0; }
            }

            // --- Orbiting phase ---
            if (r.orbiting) {
                r.orbitTime += dt;
                r.orbitAngle += dt * 2;
                const orbitR = r.target.r * 1.6;
                r.x = r.target.x + Math.cos(r.orbitAngle) * orbitR;
                r.y = r.target.y + Math.sin(r.orbitAngle) * orbitR;
                r.vx = r.target.vx;
                r.vy = r.target.vy;

                // Refugee: colonize unclaimed body or befriend existing colony
                if (r.type === 'refugee' && r.orbitTime > 2) {
                    const tc = r.target.civ;
                    if (!tc) {
                        // Unclaimed body → colonize it
                        GS.initColony(r.target);
                        r.target.civ.faction = r.faction;
                        r.target.civ.population = r.cargo.population || 3;
                        r.target.civ.techLevel = r.cargo.techLevel || 0;
                        r.target.civ.resources = r.cargo.resources || 5;
                        r.target.civ.morale = 0.5;
                        GS.spawnFlash(r.target.x, r.target.y, r.target.r * 2, GS.FACTIONS[r.faction].color, 0.3);
                    } else if (tc.faction === r.faction) {
                        // Same faction → reinforce
                        tc.population += r.cargo.population || 3;
                        tc.resources += r.cargo.resources || 5;
                        GS.spawnFlash(r.target.x, r.target.y, r.target.r * 1.5, GS.FACTIONS[r.faction].color, 0.2);
                    } else {
                        // Different faction → attempt friendship / seek asylum
                        const rel = GS.state.relations[r.faction][tc.faction];
                        if (rel > -0.3 || Math.random() < 0.5) {
                            // Accepted as refugees — relations improve
                            GS.state.relations[r.faction][tc.faction] = Math.min(1, rel + 0.15);
                            GS.state.relations[tc.faction][r.faction] = Math.min(1, GS.state.relations[tc.faction][r.faction] + 0.1);
                            tc.population += Math.floor((r.cargo.population || 3) * 0.5);
                            GS.spawnFlash(r.target.x, r.target.y, r.target.r * 1.5, '#FFFFFF', 0.25);
                            GS.spawnRing(r.target.x, r.target.y, r.target.r * 2, GS.FACTIONS[r.faction].color, 0.3, 1);
                        }
                        // If rejected, refugees disappear silently
                    }
                    rockets.splice(i, 1);
                    continue;
                }

                // Colony ship: land after 2s orbit
                if (r.type === 'colony' && r.orbitTime > 2) {
                    if (!r.target.civ) {
                        GS.initColony(r.target);
                        r.target.civ.faction = r.faction;
                        r.target.civ.population = r.cargo.population || 5;
                    } else if (r.target.civ.faction === r.faction) {
                        r.target.civ.population += r.cargo.population || 3;
                    }
                    GS.spawnFlash(r.target.x, r.target.y, r.target.r * 2, GS.FACTIONS[r.faction].color, 0.3);
                    rockets.splice(i, 1);
                    continue;
                }

                // Mining drone: mine for 3s, then return home
                if (r.type === 'mining') {
                    if (r.phase === 'outbound' && r.orbitTime > 3) {
                        r.target.mass = Math.max(0.5, r.target.mass - 0.3);
                        r.target.r = GS.massToRadius(r.target.mass);
                        if (r.homeBody && bodies.indexOf(r.homeBody) >= 0) {
                            r.origin = r.target;
                            r.target = r.homeBody;
                            r.orbiting = false;
                            r.orbitTime = 0;
                            r.fuel = 2.0;
                            r.phase = 'returning';
                        } else {
                            rockets.splice(i, 1);
                        }
                        continue;
                    }
                    if (r.phase === 'returning' && r.orbitTime > 1) {
                        if (r.target.civ) r.target.civ.resources += 15;
                        rockets.splice(i, 1);
                        continue;
                    }
                }

                // Trade ship: deliver goods on arrival
                if (r.type === 'trade' && r.orbitTime > 1.5) {
                    if (r.target.civ) {
                        r.target.civ.resources += 8;
                        r.target.civ.population += 1;
                    }
                    rockets.splice(i, 1);
                    continue;
                }

                // War fleet: attack enemy colony from orbit
                if (r.type === 'war') {
                    const tc = r.target.civ;
                    if (tc && tc.faction !== r.faction) {
                        r._attackTimer = (r._attackTimer || 0) + dt;
                        if (r._attackTimer > 1) {
                            r._attackTimer = 0;
                            const sa = Math.random() * Math.PI * 2;
                            const sx = r.target.x + Math.cos(sa) * r.target.r;
                            const sy = r.target.y + Math.sin(sa) * r.target.r;
                            GS.spawnDebris(r.x, r.y, 2, GS.FACTIONS[r.faction].hue, 0.5);
                            GS.spawnFlash(sx, sy, 3, 'rgba(255,150,50,0.5)', 0.1);

                            if (tc.settlements.length > 0 && Math.random() < 0.15) {
                                if (tc.shields > 0.1 && Math.random() < tc.shields * 0.5) {
                                    tc.shields -= 0.15;
                                    GS.spawnFlash(r.target.x, r.target.y, r.target.r + 4, GS.FACTIONS[tc.faction].color, 0.1);
                                } else {
                                    tc.settlements.splice(Math.floor(Math.random() * tc.settlements.length), 1);
                                    GS.spawnFlash(r.target.x, r.target.y, r.target.r, 'rgba(255,100,50,0.5)', 0.2);
                                    GS.state.relations[tc.faction][r.faction] = Math.max(-1, GS.state.relations[tc.faction][r.faction] - 0.05);
                                }
                            }

                            const hasFort = tc.settlements.some(s => s.type === 'fortress');
                            if (hasFort && Math.random() < 0.2) {
                                r.hp--;
                                GS.spawnFlash(r.x, r.y, 4, 'rgba(255,200,100,0.6)', 0.1);
                                GS.spawnDebris(r.x, r.y, 2, tc.faction, 0.3);
                                if (r.hp <= 0) {
                                    GS.spawnDebris(r.x, r.y, 5, GS.FACTIONS[r.faction].hue, 1.5);
                                    GS.spawnFlash(r.x, r.y, 6, 'rgba(255,200,100,0.7)', 0.2);
                                    rockets.splice(i, 1);
                                    continue;
                                }
                            }
                        }

                        // Colony conquest: all settlements destroyed
                        if (tc.settlements.length === 0) {
                            tc.faction = r.faction;
                            tc.population *= 0.1;
                            tc.techLevel = Math.max(0, tc.techLevel - 2);
                            tc.military = 0;
                            tc.settlements.push({ angle: Math.random() * Math.PI * 2, size: 1, glow: 0.5, type: 'village' });
                            GS.spawnFlash(r.target.x, r.target.y, r.target.r * 3, GS.FACTIONS[r.faction].color, 0.5);
                            GS.spawnRing(r.target.x, r.target.y, r.target.r * 5, GS.FACTIONS[r.faction].color, 0.6, 2);
                            rockets.splice(i, 1);
                            continue;
                        }
                    } else {
                        rockets.splice(i, 1);
                        continue;
                    }
                }

                // Capital ship: heavy assault from orbit
                if (r.type === 'capital') {
                    const tc = r.target.civ;
                    if (tc && tc.faction !== r.faction) {
                        r._attackTimer = (r._attackTimer || 0) + dt;
                        if (r._attackTimer > 0.5) {
                            r._attackTimer = 0;
                            GS.spawnDebris(r.x, r.y, 3, GS.FACTIONS[r.faction].hue, 0.5);
                            const sa = Math.random() * Math.PI * 2;
                            GS.spawnFlash(r.target.x + Math.cos(sa) * r.target.r, r.target.y + Math.sin(sa) * r.target.r, 4, 'rgba(255,150,50,0.6)', 0.1);
                            if (tc.settlements.length > 0 && Math.random() < 0.25) {
                                if (tc.shields > 0.1 && Math.random() < tc.shields * 0.4) {
                                    tc.shields -= 0.2;
                                    GS.spawnFlash(r.target.x, r.target.y, r.target.r + 4, GS.FACTIONS[tc.faction].color, 0.15);
                                } else {
                                    tc.settlements.splice(Math.floor(Math.random() * tc.settlements.length), 1);
                                    GS.spawnFlash(r.target.x, r.target.y, r.target.r * 1.5, 'rgba(255,100,50,0.6)', 0.2);
                                }
                            }
                            const hasFort = tc.settlements.some(s => s.type === 'fortress');
                            if (hasFort && Math.random() < 0.08) {
                                r.hp--;
                                GS.spawnFlash(r.x, r.y, 5, 'rgba(255,200,100,0.6)', 0.15);
                                if (r.hp <= 0) {
                                    GS.spawnDebris(r.x, r.y, 10, GS.FACTIONS[r.faction].hue, 2);
                                    GS.spawnFlash(r.x, r.y, 12, 'rgba(255,200,100,0.8)', 0.3);
                                    rockets.splice(i, 1);
                                    continue;
                                }
                            }
                        }
                        if (tc.settlements.length === 0) {
                            tc.faction = r.faction;
                            tc.population *= 0.1;
                            tc.techLevel = Math.max(0, tc.techLevel - 2);
                            tc.military = 0;
                            tc.settlements.push({ angle: Math.random() * Math.PI * 2, size: 1, glow: 0.5, type: 'village' });
                            GS.spawnFlash(r.target.x, r.target.y, r.target.r * 3, GS.FACTIONS[r.faction].color, 0.5);
                            GS.spawnRing(r.target.x, r.target.y, r.target.r * 5, GS.FACTIONS[r.faction].color, 0.6, 2);
                            rockets.splice(i, 1);
                            continue;
                        }
                    } else {
                        rockets.splice(i, 1);
                        continue;
                    }
                }

                // Nuke: detonate immediately on orbit arrival
                if (r.type === 'nuke') {
                    const tc = r.target.civ;
                    if (tc && tc.faction !== r.faction) {
                        if (tc.shields > 0.3) {
                            tc.shields -= 0.4;
                            GS.spawnRing(r.target.x, r.target.y, r.target.r * 3, GS.FACTIONS[tc.faction].color, 0.4, 2);
                        } else {
                            const kills = Math.min(tc.settlements.length, 3 + Math.floor(Math.random() * 3));
                            for (let k = 0; k < kills; k++) {
                                if (tc.settlements.length > 0)
                                    tc.settlements.splice(Math.floor(Math.random() * tc.settlements.length), 1);
                            }
                            tc.population *= 0.6;
                            tc.morale = Math.max(0.1, tc.morale - 0.3);
                        }
                        GS.spawnFlash(r.target.x, r.target.y, r.target.r * 4, 'rgba(255,100,50,0.9)', 0.5);
                        GS.spawnRing(r.target.x, r.target.y, r.target.r * 6, 'rgba(255,80,30,0.8)', 0.7, 3);
                        GS.spawnRing(r.target.x, r.target.y, r.target.r * 4, 'rgba(255,200,50,0.6)', 0.4, 2);
                        GS.spawnDebris(r.target.x, r.target.y, 20, 30, 2);
                        GS.state.relations[tc.faction][r.faction] = Math.max(-1, GS.state.relations[tc.faction][r.faction] - 0.3);
                    }
                    rockets.splice(i, 1);
                    continue;
                }

                continue;
            }

            // --- Gravity from all bodies (reduced influence) ---
            for (const b of bodies) {
                const dx = b.x - r.x, dy = b.y - r.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq) + 2;
                const force = GS.G * b.mass / (distSq + 200) * 0.3;
                r.vx += (dx / dist) * force * dt;
                r.vy += (dy / dist) * force * dt;
            }

            // --- Thrust toward target (lead-pursuit) ---
            if (r.fuel > 0 && r.target) {
                const tdx = r.target.x - r.x, tdy = r.target.y - r.y;
                const tDist = Math.sqrt(tdx * tdx + tdy * tdy) + 1;
                const rSpd = Math.sqrt(r.vx * r.vx + r.vy * r.vy) + 1;
                const eta = Math.min(tDist / rSpd, 5);
                const aimX = r.target.x + r.target.vx * eta - r.x;
                const aimY = r.target.y + r.target.vy * eta - r.y;
                const aimD = Math.sqrt(aimX * aimX + aimY * aimY) + 1;
                const thrust = r.type === 'nuke' ? 500 : r.type === 'capital' ? 150 : 300;
                r.vx += (aimX / aimD) * thrust * dt;
                r.vy += (aimY / aimD) * thrust * dt;
                r.fuel -= dt;
            }

            // Speed cap
            const maxSpd = r.type === 'nuke' ? 800 : r.type === 'capital' ? 200 : 600;
            const spd = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
            if (spd > maxSpd) { r.vx = (r.vx / spd) * maxSpd; r.vy = (r.vy / spd) * maxSpd; }

            // Position integrate
            r.x += r.vx * dt;
            r.y += r.vy * dt;

            // Screen wrap
            const vw = GS.state._vw, vh = GS.state._vh;
            if (r.x < -20) r.x = vw + 20;
            if (r.x > vw + 20) r.x = -20;
            if (r.y < -20) r.y = vh + 20;
            if (r.y > vh + 20) r.y = -20;

            // --- Orbit insertion ---
            if (r.target) {
                const adx = r.target.x - r.x, ady = r.target.y - r.y;
                const aDist = Math.sqrt(adx * adx + ady * ady);
                if (aDist < r.target.r * 2.2) {
                    r.orbiting = true;
                    r.orbitAngle = Math.atan2(r.y - r.target.y, r.x - r.target.x);
                    continue;
                }
            }

            // --- Combat drone defense ---
            if ((r.type === 'war' || r.type === 'nuke' || r.type === 'capital') && !r.orbiting) {
                for (const b of bodies) {
                    if (!b.civ || b.civ.faction === r.faction || b.civ.techLevel < 5) continue;
                    const ddx = b.x - r.x, ddy = b.y - r.y;
                    if (ddx * ddx + ddy * ddy < (b.r * 3) * (b.r * 3) && Math.random() < 0.1 * dt) {
                        r.hp--;
                        GS.spawnFlash(r.x, r.y, 3, 'rgba(255,200,100,0.5)', 0.1);
                        if (r.hp <= 0) {
                            GS.spawnDebris(r.x, r.y, 4, GS.FACTIONS[r.faction].hue, 1);
                            GS.spawnFlash(r.x, r.y, 6, 'rgba(255,200,100,0.7)', 0.2);
                            rockets.splice(i, 1);
                            break;
                        }
                    }
                }
                if (i >= rockets.length || rockets[i] !== r) continue;
            }

            // --- Collision with non-target bodies ---
            for (const b of bodies) {
                if (b === r.target || b === r.origin) continue;
                const cdx = b.x - r.x, cdy = b.y - r.y;
                if (cdx * cdx + cdy * cdy < b.r * b.r * 0.64) {
                    GS.spawnDebris(r.x, r.y, 4, GS.FACTIONS[r.faction].hue, 1);
                    GS.spawnFlash(r.x, r.y, 8, 'rgba(255,200,100,0.6)', 0.15);
                    rockets.splice(i, 1);
                    break;
                }
            }
        }
    };

    GS.drawRockets = function (ctx, time) {
        for (const r of GS.state.rockets) {
            const f = GS.FACTIONS[r.faction];

            // Exhaust trail
            if (r.trail.length > 1) {
                for (let t = 0; t < r.trail.length - 1; t++) {
                    const ta = (t / r.trail.length) * 0.4;
                    const lw = (t / r.trail.length) * 1.5;
                    ctx.globalAlpha = ta;
                    ctx.strokeStyle = r.fuel > 0 ? f.color : 'rgba(200,200,200,0.5)';
                    ctx.lineWidth = lw;
                    ctx.beginPath();
                    ctx.moveTo(r.trail[t].x, r.trail[t].y);
                    ctx.lineTo(r.trail[t + 1].x, r.trail[t + 1].y);
                    ctx.stroke();
                }
            }

            // Rocket body (triangle)
            const rSpd = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
            const ang = rSpd > 0.1 ? Math.atan2(r.vy, r.vx) : 0;
            const sz = r.type === 'capital' ? 8 : r.type === 'colony' ? 4 : 3;

            ctx.save();
            ctx.translate(r.x, r.y);
            ctx.rotate(ang);

            ctx.globalAlpha = 0.9;
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.moveTo(sz, 0);
            ctx.lineTo(-sz * 0.6, -sz * 0.5);
            ctx.lineTo(-sz * 0.6, sz * 0.5);
            ctx.closePath();
            ctx.fill();

            // White core dot
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, sz * 0.3, 0, Math.PI * 2);
            ctx.fill();

            // Exhaust glow when thrusting
            if (r.fuel > 0) {
                ctx.globalAlpha = 0.4 + Math.sin(time * 15) * 0.15;
                ctx.fillStyle = f.color;
                ctx.beginPath();
                ctx.arc(-sz * 0.8, 0, sz * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();

            // Type-specific effects
            if (r.type === 'nuke') {
                ctx.globalAlpha = 0.3 + Math.sin(time * 12) * 0.15;
                ctx.fillStyle = '#FF2200';
                ctx.beginPath();
                ctx.arc(r.x, r.y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
            if (r.type === 'capital') {
                ctx.globalAlpha = 0.12;
                ctx.strokeStyle = f.color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(r.x, r.y, 10, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (r.type === 'refugee') {
                ctx.globalAlpha = 0.3 + Math.sin(time * 8) * 0.2;
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath();
                ctx.arc(r.x, r.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    };

    // --- Refugee ship spawning (from destroyed colonies) ---
    GS.spawnRefugees = function (cx, cy, civData, baseVx, baseVy) {
        if (!civData || civData.faction === undefined) return;
        const tech = civData.techLevel || 0;
        const numShips = Math.min(3, 1 + Math.floor(tech / 3));
        const popPer = Math.max(2, Math.floor((civData.population || 5) * 0.15 / numShips));
        const resPer = Math.floor((civData.resources || 0) * 0.1 / numShips);
        const techLvl = tech * 0.6;
        for (let i = 0; i < numShips && GS.state.rockets.length < GS.MAX_ROCKETS; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 80 + Math.random() * 40;
            GS.state.rockets.push({
                x: cx + Math.cos(ang) * 5,
                y: cy + Math.sin(ang) * 5,
                vx: baseVx + Math.cos(ang) * spd,
                vy: baseVy + Math.sin(ang) * spd,
                faction: civData.faction,
                type: 'refugee',
                origin: null,
                target: null,
                fuel: 4.0,
                hp: 1,
                cargo: { population: popPer, techLevel: techLvl, resources: resPer },
                trail: [],
                age: 0,
                orbiting: false,
                orbitTime: 0,
                orbitAngle: 0,
            });
        }
    };
})();
