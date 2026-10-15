// ============================================================
// Gravity Scene — Colony System (factions, init, update, draw)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    // Colony spawns: track which factions have been assigned
    let nextFactionIdx = 0;

    GS.assignFaction = function () {
        const f = nextFactionIdx % GS.FACTIONS.length;
        nextFactionIdx++;
        return f;
    };

    // Initialize a civilization on a body (called when body reaches planet tier)
    GS.initColony = function (b) {
        if (b.civ) return;
        const factionId = GS.assignFaction();
        const numSettlements = 2 + Math.floor(Math.random() * 2);
        const settlements = [];
        for (let i = 0; i < numSettlements; i++) {
            settlements.push({
                angle: (Math.PI * 2 * i / numSettlements) + (Math.random() - 0.5) * 0.5,
                size: 1 + Math.random() * 0.5,
                glow: 0.5 + Math.random() * 0.3,
                type: 'village'
            });
        }
        b.civ = {
            faction:     factionId,
            population:  5 + Math.random() * 10,
            techLevel:   0,
            settlements: settlements,
            age:         0,
            morale:      0.7 + Math.random() * 0.2,
            resources:   10 + Math.random() * 20,
            military:    0,
            alert:       null,
            shields:     0,
            _dominantResource: GS.RESOURCE_NAMES[Math.floor(Math.random() * GS.RESOURCE_NAMES.length)],
        };
    };

    // Update colony each frame (growth, tech, settlements, launches)
    GS.updateColony = function (b, dt) {
        const c = b.civ;
        if (!c) return;
        const faction = GS.FACTIONS[c.faction];
        c.age += dt;

        // --- Population growth ---
        let growthMul = 1;
        if (faction.trait === 'growth') growthMul = 1.5;
        const popGrowth = 0.3 * Math.pow(c.population, 0.3) * c.morale * growthMul * dt;
        c.population = Math.min(c.population + popGrowth, 1000);

        // --- Tech advancement ---
        let techMul = 1;
        if (faction.trait === 'traders') techMul = 1.3;
        const techGrowth = 0.015 * Math.pow(c.population, 0.25) * c.morale * techMul * dt;
        c.techLevel = Math.min(c.techLevel + techGrowth, 10);

        // --- Resource accumulation ---
        let resMul = 1;
        if (faction.trait === 'miners') resMul = 1.5;
        c.resources += (b.mass * 0.005 + c.population * 0.01) * resMul * dt;

        // --- Military growth ---
        if (faction.trait === 'aggressive') {
            c.military += 0.02 * c.population * dt;
        } else {
            c.military += 0.008 * c.population * dt;
        }

        // --- Settlement growth based on population ---
        const maxSettlements = Math.min(12, 2 + Math.floor(c.population / 15));
        if (c.settlements.length < maxSettlements && Math.random() < 0.02 * dt * 60) {
            let bestAngle = Math.random() * Math.PI * 2;
            if (c.settlements.length > 0) {
                const angles = c.settlements.map(s => s.angle).sort((a, b) => a - b);
                let maxGap = 0, gapStart = 0;
                for (let i = 0; i < angles.length; i++) {
                    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
                    const gap = next - angles[i];
                    if (gap > maxGap) { maxGap = gap; gapStart = angles[i]; }
                }
                bestAngle = gapStart + maxGap / 2;
            }
            let type = 'village';
            if (c.techLevel >= 4) type = Math.random() > 0.5 ? 'fortress' : 'city';
            else if (c.techLevel >= 3) type = Math.random() > 0.5 ? 'spaceport' : 'city';
            else if (c.techLevel >= 2) type = 'city';
            c.settlements.push({
                angle: bestAngle,
                size: 1 + Math.random() * (c.techLevel >= 2 ? 1.5 : 0.5),
                glow: 0.5 + Math.random() * 0.3,
                type: type
            });
        }

        // --- Upgrade existing settlement types as tech grows ---
        for (const s of c.settlements) {
            if (s.type === 'village' && c.techLevel >= 2 && Math.random() < 0.005 * dt * 60) {
                s.type = 'city';
                s.size = Math.min(3, s.size + 0.5);
            }
            if (s.type === 'city' && c.techLevel >= 3 && Math.random() < 0.003 * dt * 60) {
                s.type = Math.random() > 0.5 ? 'spaceport' : 'fortress';
            }
        }

        // --- Colony Ship Launches (tech >= 2, needs spaceport) ---
        if (c.techLevel >= 2 && c.population > 30 && c.resources > 50) {
            const hasSpaceport = c.settlements.some(s => s.type === 'spaceport');
            if (hasSpaceport && GS.state.rockets.length < GS.MAX_ROCKETS) {
                // Lower threshold for orbiting moons — they're right there!
                const moonLaunchChance = 0.12;
                const normalLaunchChance = 0.05;
                if (Math.random() < Math.max(moonLaunchChance, normalLaunchChance) * dt) {
                    let bestTarget = null, bestDist = 400;
                    let bestIsOrbital = false;

                    // Prioritize our own orbiting moons first
                    const orbitals = GS.getOrbitals ? GS.getOrbitals(b) : [];
                    for (const moon of orbitals) {
                        if (moon.civ) continue; // already colonized
                        const ot = GS.bodyType(moon.mass);
                        if (ot !== 'moon' && ot !== 'asteroid') continue;
                        const taken = GS.state.rockets.some(rk => rk.type === 'colony' && rk.target === moon && rk.faction === c.faction);
                        if (taken) continue;
                        const ddx = moon.x - b.x, ddy = moon.y - b.y;
                        const d = Math.sqrt(ddx * ddx + ddy * ddy);
                        if (d < bestDist) { bestDist = d; bestTarget = moon; bestIsOrbital = true; }
                    }

                    // Fall back to any nearby uncolonized body
                    if (!bestTarget) {
                        bestDist = 400;
                        for (const other of GS.state.bodies) {
                            if (other === b || other.civ) continue;
                            const ot = GS.bodyType(other.mass);
                            if (ot !== 'moon' && ot !== 'asteroid' && ot !== 'planet') continue;
                            const taken = GS.state.rockets.some(rk => rk.type === 'colony' && rk.target === other && rk.faction === c.faction);
                            if (taken) continue;
                            const ddx = other.x - b.x, ddy = other.y - b.y;
                            const d = Math.sqrt(ddx * ddx + ddy * ddy);
                            if (d < bestDist) { bestDist = d; bestTarget = other; }
                        }
                    }

                    if (bestTarget) {
                        // Cheaper to colonize orbiting moons
                        const resCost = bestIsOrbital ? 25 : 50;
                        const popCost = bestIsOrbital ? 3 : 5;
                        GS.state.rockets.push(GS.createRocket(b, bestTarget, 'colony', c.faction));
                        c.population -= popCost;
                        c.resources -= resCost;
                        const lang = Math.atan2(bestTarget.y - b.y, bestTarget.x - b.x);
                        const lfx = b.x + Math.cos(lang) * b.r;
                        const lfy = b.y + Math.sin(lang) * b.r;
                        GS.spawnFlash(lfx, lfy, 6, GS.FACTIONS[c.faction].color, 0.2);
                        GS.spawnDebris(lfx, lfy, 4, GS.FACTIONS[c.faction].hue, 0.8);
                    }
                }
            }
        }

        // --- Mining Drone Launches (tech >= 2) ---
        if (c.techLevel >= 2 && GS.state.rockets.length < GS.MAX_ROCKETS) {
            if (Math.random() < 0.12 * dt) {
                let mineTarget = null, mineDist = 200;
                for (const other of GS.state.bodies) {
                    if (other === b || other.civ) continue;
                    if (GS.bodyType(other.mass) !== 'asteroid') continue;
                    const taken = GS.state.rockets.some(rk =>
                        rk.type === 'mining' && rk.target === other && rk.faction === c.faction);
                    if (taken) continue;
                    const mdx = other.x - b.x, mdy = other.y - b.y;
                    const md = Math.sqrt(mdx * mdx + mdy * mdy);
                    if (md < mineDist) { mineDist = md; mineTarget = other; }
                }
                if (mineTarget) {
                    const drone = GS.createRocket(b, mineTarget, 'mining', c.faction);
                    drone.phase = 'outbound';
                    drone.homeBody = b;
                    GS.state.rockets.push(drone);
                }
            }
        }

        // --- War Fleet Launches (tech >= 3, at war) ---
        if (c.techLevel >= 3 && c.military > 20 && c.population > 50) {
            for (let fi = 0; fi < GS.FACTIONS.length; fi++) {
                if (fi === c.faction) continue;
                if (GS.state.relations[c.faction][fi] >= -0.5) continue;
                if (Math.random() < 0.03 * dt) {
                    let warTarget = null, warDist = 500;
                    for (const other of GS.state.bodies) {
                        if (!other.civ || other.civ.faction !== fi) continue;
                        const wdx = other.x - b.x, wdy = other.y - b.y;
                        const wd = Math.sqrt(wdx * wdx + wdy * wdy);
                        if (wd < warDist) { warDist = wd; warTarget = other; }
                    }
                    if (warTarget) {
                        const fleetSz = 3 + Math.floor(Math.random() * 3);
                        for (let s = 0; s < fleetSz && GS.state.rockets.length < GS.MAX_ROCKETS; s++) {
                            const ship = GS.createRocket(b, warTarget, 'war', c.faction);
                            ship.hp = 2;
                            ship._attackTimer = Math.random();
                            GS.state.rockets.push(ship);
                        }
                        c.military -= 15;
                        c.resources -= 30;
                        GS.spawnFlash(b.x, b.y, b.r * 1.5, 'rgba(255,50,50,0.5)', 0.3);
                        break;
                    }
                }
            }
        }

        // --- Nuke Missile (tech >= 6, at war, rare) ---
        if (c.techLevel >= 6 && c.resources > 80) {
            for (let fi = 0; fi < GS.FACTIONS.length; fi++) {
                if (fi === c.faction || GS.state.relations[c.faction][fi] >= -0.5) continue;
                if (Math.random() < 0.005 * dt) {
                    let nukeTarget = null, nukeDist = 600;
                    for (const other of GS.state.bodies) {
                        if (!other.civ || other.civ.faction !== fi) continue;
                        const ndx = other.x - b.x, ndy = other.y - b.y;
                        const nd = Math.sqrt(ndx * ndx + ndy * ndy);
                        if (nd < nukeDist) { nukeDist = nd; nukeTarget = other; }
                    }
                    if (nukeTarget && GS.state.rockets.length < GS.MAX_ROCKETS) {
                        const nuke = GS.createRocket(b, nukeTarget, 'nuke', c.faction);
                        nuke.hp = 1;
                        nuke.fuel = 5.0;
                        GS.state.rockets.push(nuke);
                        c.resources -= 80;
                        GS.spawnFlash(b.x, b.y, b.r * 1.5, 'rgba(255,0,0,0.5)', 0.3);
                        break;
                    }
                }
            }
        }

        // --- Capital Ship (tech >= 7, at war, very rare) ---
        if (c.techLevel >= 7 && c.resources > 300 && c.military > 50) {
            for (let fi = 0; fi < GS.FACTIONS.length; fi++) {
                if (fi === c.faction || GS.state.relations[c.faction][fi] >= -0.5) continue;
                if (Math.random() < 0.003 * dt) {
                    let capTarget = null, capDist = 600;
                    for (const other of GS.state.bodies) {
                        if (!other.civ || other.civ.faction !== fi) continue;
                        const cdx = other.x - b.x, cdy = other.y - b.y;
                        const cd = Math.sqrt(cdx * cdx + cdy * cdy);
                        if (cd < capDist) { capDist = cd; capTarget = other; }
                    }
                    if (capTarget && GS.state.rockets.length < GS.MAX_ROCKETS) {
                        const cap = GS.createRocket(b, capTarget, 'capital', c.faction);
                        cap.hp = 8;
                        cap.fuel = 6.0;
                        cap._attackTimer = 0;
                        GS.state.rockets.push(cap);
                        c.resources -= 300;
                        c.military -= 40;
                        GS.spawnFlash(b.x, b.y, b.r * 2, GS.FACTIONS[c.faction].color, 0.4);
                        break;
                    }
                }
            }
        }

        // --- Shield tech ---
        if (c.techLevel >= 5 && c.shields < 1) {
            c.shields = Math.min(1, c.shields + 0.01 * dt);
        }

        // --- Space Base construction (tech >= 4) ---
        if (c.techLevel >= 4 && !c.spaceBase && c.resources > 200) {
            c.spaceBase = { angle: Math.random() * Math.PI * 2, hp: 5 };
            c.resources -= 200;
            GS.spawnFlash(b.x, b.y, b.r * 2, GS.FACTIONS[c.faction].color, 0.3);
        }
        if (c.spaceBase) {
            c.spaceBase.angle += dt * 0.5;
        }
    };

    // Draw settlements on a colonized body
    GS.drawSettlements = function (ctx, b, time) {
        const c = b.civ;
        if (!c) return;
        const faction = GS.FACTIONS[c.faction];

        ctx.save();

        // --- Shield dome (tech >= 5) ---
        if (c.shields > 0.01) {
            ctx.globalAlpha = c.shields * 0.12;
            ctx.strokeStyle = faction.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = c.shields * 0.04;
            ctx.fillStyle = faction.color;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // --- Settlement dots on circumference ---
        for (const s of c.settlements) {
            const sx = b.x + Math.cos(s.angle) * b.r;
            const sy = b.y + Math.sin(s.angle) * b.r;
            const pulse = s.glow + Math.sin(time * 3 + s.angle * 5) * 0.15;
            const sz = s.size;

            // Outer glow halo
            ctx.globalAlpha = pulse * 0.3;
            ctx.fillStyle = faction.color;
            ctx.beginPath();
            ctx.arc(sx, sy, sz + 2, 0, Math.PI * 2);
            ctx.fill();

            // Core dot
            ctx.globalAlpha = 0.7 + pulse * 0.3;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(sx, sy, sz, 0, Math.PI * 2);
            ctx.fill();

            // Type indicator
            if (s.type === 'spaceport') {
                const nx = Math.cos(s.angle), ny = Math.sin(s.angle);
                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = faction.color;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + nx * 4, sy + ny * 4);
                ctx.stroke();
            } else if (s.type === 'fortress') {
                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = faction.color;
                ctx.lineWidth = 0.8;
                const nx = Math.cos(s.angle), ny = Math.sin(s.angle);
                const px = -ny, py = nx;
                ctx.beginPath();
                ctx.moveTo(sx + px * 2.5, sy + py * 2.5);
                ctx.lineTo(sx + nx * 2.5, sy + ny * 2.5);
                ctx.lineTo(sx - px * 2.5, sy - py * 2.5);
                ctx.stroke();
            }
        }

        // --- Faction ownership ring ---
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = faction.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 1.5, 0, Math.PI * 2);
        ctx.stroke();

        // --- Space base (orbiting structure, tech >= 4) ---
        if (c.spaceBase) {
            const baseR = b.r * 1.6;
            const bsx = b.x + Math.cos(c.spaceBase.angle) * baseR;
            const bsy = b.y + Math.sin(c.spaceBase.angle) * baseR;

            ctx.globalAlpha = 0.06;
            ctx.strokeStyle = faction.color;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(bsx, bsy);
            ctx.stroke();

            ctx.save();
            ctx.translate(bsx, bsy);
            ctx.rotate(c.spaceBase.angle + Math.PI / 2);
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = '#aabbcc';
            ctx.fillRect(-3, -1.5, 6, 3);
            ctx.globalAlpha = 0.5 + Math.sin(time * 4) * 0.2;
            ctx.fillStyle = faction.color;
            ctx.fillRect(-3.5, -0.5, 1, 1);
            ctx.fillRect(2.5, -0.5, 1, 1);
            ctx.restore();
        }

        // --- Robot workers (tech >= 4) ---
        if (c.techLevel >= 4) {
            const numBots = Math.min(6, 3 + Math.floor(c.techLevel - 4));
            for (let i = 0; i < numBots; i++) {
                const botAng = time * (1.5 + i * 0.3) + i * Math.PI * 2 / numBots;
                const botR = b.r * (1.15 + Math.sin(time * 3 + i * 2) * 0.08);
                const bwx = b.x + Math.cos(botAng) * botR;
                const bwy = b.y + Math.sin(botAng) * botR;
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = faction.color;
                ctx.beginPath();
                ctx.arc(bwx, bwy, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // --- Combat drones (tech >= 5) ---
        if (c.techLevel >= 5) {
            const numDr = Math.min(4, 2 + Math.floor(c.techLevel - 5));
            for (let i = 0; i < numDr; i++) {
                const drAng = time * (-0.8 + i * 0.15) + i * Math.PI * 2 / numDr;
                const drR = b.r * 1.9;
                const drx = b.x + Math.cos(drAng) * drR;
                const dry = b.y + Math.sin(drAng) * drR;
                ctx.save();
                ctx.translate(drx, dry);
                ctx.rotate(drAng + Math.PI / 2);
                ctx.globalAlpha = 0.6;
                ctx.strokeStyle = faction.color;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(-1.5, 1);
                ctx.lineTo(0, -1.5);
                ctx.lineTo(1.5, 1);
                ctx.stroke();
                ctx.restore();
            }
        }

        ctx.restore();
    };
})();
