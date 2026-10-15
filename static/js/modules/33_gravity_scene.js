// ============================================================
// 33_gravity_scene.js â€” N-body gravity simulation scene
// Extracted from 32_toolbox.js for cleaner workflow
// ============================================================
// Exposed as window.initGravityScene(ctx, w, h, state, canvas, toolData)
// Called by 32_toolbox.js toy animation engine

(function () {
    'use strict';

    function initGravityScene(ctx, w, h, state, canvas, toolData) {
        const dpr = window.devicePixelRatio || 1;
        const G = 60;
        const MAX_BODIES = 100;
        const MERGE_FACTOR = 0.45;
        const SHATTER_SPEED = 540;

        // Mass thresholds (in "asteroid equivalents": ~1 asteroid = mass 1)
        // 50 asteroids = moon, 250 = planet, 1000 = star, 2500 = black hole
        const ASTEROID_MAX = 50;
        const MOON_MAX = 250;
        const PLANET_MAX = 1000;
        const STAR_MAX = 2500;

        // Growth: mass per second while holding (slow â€” earning stages takes time)
        const GROW_RATE = 10;

        // Color palettes per type
        const ASTEROID_COLORS = [
            { h: 30, s: 10, l: 45 }, { h: 20, s: 8, l: 40 }, { h: 40, s: 12, l: 50 }
        ];
        const MOON_COLORS = [
            { h: 40, s: 15, l: 70 }, { h: 200, s: 10, l: 65 }, { h: 0, s: 5, l: 75 }
        ];
        const PLANET_COLORS = [
            { h: 20, s: 75, l: 55 }, { h: 200, s: 60, l: 55 }, { h: 45, s: 70, l: 60 },
            { h: 160, s: 50, l: 50 }, { h: 280, s: 45, l: 55 }, { h: 340, s: 60, l: 60 }
        ];
        const STAR_COLORS = [
            { h: 45, s: 95, l: 60 }, { h: 30, s: 90, l: 55 }, { h: 55, s: 85, l: 65 },
            { h: 15, s: 80, l: 50 }, { h: 200, s: 70, l: 75 }
        ];

        // ============================================================
        // SPACE TRAVELERS â€” Faction & Colony System
        // ============================================================

        const FACTIONS = [
            { id: 0, name: 'Solari',  color: '#FF4444', hue: 0,   trait: 'aggressive' },
            { id: 1, name: 'Aquarii', color: '#4488FF', hue: 220, trait: 'defensive'  },
            { id: 2, name: 'Verdani', color: '#44FF66', hue: 135, trait: 'growth'     },
            { id: 3, name: 'Aureon',  color: '#FFAA22', hue: 38,  trait: 'traders'    },
            { id: 4, name: 'Nexari',  color: '#CC44FF', hue: 280, trait: 'robots'     },
            { id: 5, name: 'Glacium', color: '#44FFEE', hue: 175, trait: 'miners'     },
        ];

        // Colony spawns: track which factions have been assigned
        let nextFactionIdx = 0;

        function assignFaction() {
            const f = nextFactionIdx % FACTIONS.length;
            nextFactionIdx++;
            return f;
        }

        // Initialize a civilization on a body (called when body reaches planet tier)
        function initColony(b) {
            if (b.civ) return; // already colonized
            const factionId = assignFaction();
            const faction = FACTIONS[factionId];
            // Create 2-3 initial settlements on the circumference
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
            };
        }

        // Update colony each frame (growth, tech, settlements)
        function updateColony(b, dt) {
            const c = b.civ;
            if (!c) return;
            const faction = FACTIONS[c.faction];
            c.age += dt;

            // --- Population growth ---
            // base rate, boosted by Verdani trait
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
                // Spawn new settlement at a gap between existing ones
                let bestAngle = Math.random() * Math.PI * 2;
                if (c.settlements.length > 0) {
                    // Find the largest gap
                    const angles = c.settlements.map(s => s.angle).sort((a, b) => a - b);
                    let maxGap = 0, gapStart = 0;
                    for (let i = 0; i < angles.length; i++) {
                        const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
                        const gap = next - angles[i];
                        if (gap > maxGap) { maxGap = gap; gapStart = angles[i]; }
                    }
                    bestAngle = gapStart + maxGap / 2;
                }
                // Settlement type based on tech level
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
                if (hasSpaceport && state.rockets.length < MAX_ROCKETS) {
                    // ~once every 20s per colony
                    if (Math.random() < 0.05 * dt) {
                        let bestTarget = null, bestDist = 400;
                        for (const other of state.bodies) {
                            if (other === b || other.civ) continue;
                            const ot = bodyType(other.mass);
                            if (ot !== 'moon' && ot !== 'asteroid' && ot !== 'planet') continue;
                            // Skip if already targeted by our faction
                            const taken = state.rockets.some(rk => rk.type === 'colony' && rk.target === other && rk.faction === c.faction);
                            if (taken) continue;
                            const ddx = other.x - b.x, ddy = other.y - b.y;
                            const d = Math.sqrt(ddx * ddx + ddy * ddy);
                            if (d < bestDist) { bestDist = d; bestTarget = other; }
                        }
                        if (bestTarget) {
                            state.rockets.push(createRocket(b, bestTarget, 'colony', c.faction));
                            c.population -= 5;
                            c.resources -= 50;
                            const lang = Math.atan2(bestTarget.y - b.y, bestTarget.x - b.x);
                            const lfx = b.x + Math.cos(lang) * b.r;
                            const lfy = b.y + Math.sin(lang) * b.r;
                            spawnFlash(lfx, lfy, 6, FACTIONS[c.faction].color, 0.2);
                            spawnDebris(lfx, lfy, 4, FACTIONS[c.faction].hue, 0.8);
                        }
                    }
                }
            }

            // --- Mining Drone Launches (tech >= 2) ---
            if (c.techLevel >= 2 && state.rockets.length < MAX_ROCKETS) {
                // ~once every 8s per colony
                if (Math.random() < 0.12 * dt) {
                    let mineTarget = null, mineDist = 200;
                    for (const other of state.bodies) {
                        if (other === b || other.civ) continue;
                        if (bodyType(other.mass) !== 'asteroid') continue;
                        const taken = state.rockets.some(rk =>
                            rk.type === 'mining' && rk.target === other && rk.faction === c.faction);
                        if (taken) continue;
                        const mdx = other.x - b.x, mdy = other.y - b.y;
                        const md = Math.sqrt(mdx * mdx + mdy * mdy);
                        if (md < mineDist) { mineDist = md; mineTarget = other; }
                    }
                    if (mineTarget) {
                        const drone = createRocket(b, mineTarget, 'mining', c.faction);
                        drone.phase = 'outbound';
                        drone.homeBody = b;
                        state.rockets.push(drone);
                    }
                }
            }

            // --- War Fleet Launches (tech >= 3, at war) ---
            if (c.techLevel >= 3 && c.military > 20 && c.population > 50) {
                for (let fi = 0; fi < 6; fi++) {
                    if (fi === c.faction) continue;
                    if (state.relations[c.faction][fi] >= -0.5) continue;
                    // At war! Launch fleet at nearest enemy
                    if (Math.random() < 0.03 * dt) {
                        let warTarget = null, warDist = 500;
                        for (const other of state.bodies) {
                            if (!other.civ || other.civ.faction !== fi) continue;
                            const wdx = other.x - b.x, wdy = other.y - b.y;
                            const wd = Math.sqrt(wdx * wdx + wdy * wdy);
                            if (wd < warDist) { warDist = wd; warTarget = other; }
                        }
                        if (warTarget) {
                            const fleetSz = 3 + Math.floor(Math.random() * 3);
                            for (let s = 0; s < fleetSz && state.rockets.length < MAX_ROCKETS; s++) {
                                const ship = createRocket(b, warTarget, 'war', c.faction);
                                ship.hp = 2;
                                ship._attackTimer = Math.random();
                                state.rockets.push(ship);
                            }
                            c.military -= 15;
                            c.resources -= 30;
                            spawnFlash(b.x, b.y, b.r * 1.5, 'rgba(255,50,50,0.5)', 0.3);
                            break;
                        }
                    }
                }
            }

            // --- Nuke Missile (tech >= 6, at war, rare) ---
            if (c.techLevel >= 6 && c.resources > 80) {
                for (let fi = 0; fi < 6; fi++) {
                    if (fi === c.faction || state.relations[c.faction][fi] >= -0.5) continue;
                    if (Math.random() < 0.005 * dt) {
                        let nukeTarget = null, nukeDist = 600;
                        for (const other of state.bodies) {
                            if (!other.civ || other.civ.faction !== fi) continue;
                            const ndx = other.x - b.x, ndy = other.y - b.y;
                            const nd = Math.sqrt(ndx * ndx + ndy * ndy);
                            if (nd < nukeDist) { nukeDist = nd; nukeTarget = other; }
                        }
                        if (nukeTarget && state.rockets.length < MAX_ROCKETS) {
                            const nuke = createRocket(b, nukeTarget, 'nuke', c.faction);
                            nuke.hp = 1;
                            nuke.fuel = 5.0;
                            state.rockets.push(nuke);
                            c.resources -= 80;
                            spawnFlash(b.x, b.y, b.r * 1.5, 'rgba(255,0,0,0.5)', 0.3);
                            break;
                        }
                    }
                }
            }

            // --- Capital Ship (tech >= 7, at war, very rare) ---
            if (c.techLevel >= 7 && c.resources > 300 && c.military > 50) {
                for (let fi = 0; fi < 6; fi++) {
                    if (fi === c.faction || state.relations[c.faction][fi] >= -0.5) continue;
                    if (Math.random() < 0.003 * dt) {
                        let capTarget = null, capDist = 600;
                        for (const other of state.bodies) {
                            if (!other.civ || other.civ.faction !== fi) continue;
                            const cdx = other.x - b.x, cdy = other.y - b.y;
                            const cd = Math.sqrt(cdx * cdx + cdy * cdy);
                            if (cd < capDist) { capDist = cd; capTarget = other; }
                        }
                        if (capTarget && state.rockets.length < MAX_ROCKETS) {
                            const cap = createRocket(b, capTarget, 'capital', c.faction);
                            cap.hp = 8;
                            cap.fuel = 6.0;
                            cap._attackTimer = 0;
                            state.rockets.push(cap);
                            c.resources -= 300;
                            c.military -= 40;
                            spawnFlash(b.x, b.y, b.r * 2, FACTIONS[c.faction].color, 0.4);
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
                spawnFlash(b.x, b.y, b.r * 2, FACTIONS[c.faction].color, 0.3);
            }
            if (c.spaceBase) {
                c.spaceBase.angle += dt * 0.5;
            }
        }

        // Draw settlements on a colonized body
        function drawSettlements(ctx, b, time) {
            const c = b.civ;
            if (!c) return;
            const faction = FACTIONS[c.faction];

            ctx.save();

            // --- Shield dome (tech >= 5) ---
            if (c.shields > 0.01) {
                ctx.globalAlpha = c.shields * 0.12;
                ctx.strokeStyle = faction.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
                ctx.stroke();
                // faint fill
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

                // Glow pulse
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
                    // Tiny upward line (launch pad)
                    const nx = Math.cos(s.angle), ny = Math.sin(s.angle);
                    ctx.globalAlpha = 0.5;
                    ctx.strokeStyle = faction.color;
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(sx + nx * 4, sy + ny * 4);
                    ctx.stroke();
                } else if (s.type === 'fortress') {
                    // Tiny bracket (walls)
                    ctx.globalAlpha = 0.5;
                    ctx.strokeStyle = faction.color;
                    ctx.lineWidth = 0.8;
                    const nx = Math.cos(s.angle), ny = Math.sin(s.angle);
                    const px = -ny, py = nx; // perpendicular
                    ctx.beginPath();
                    ctx.moveTo(sx + px * 2.5, sy + py * 2.5);
                    ctx.lineTo(sx + nx * 2.5, sy + ny * 2.5);
                    ctx.lineTo(sx - px * 2.5, sy - py * 2.5);
                    ctx.stroke();
                }
            }

            // --- Faction ownership ring (subtle colored ring around planet) ---
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

                // Tether line to planet
                ctx.globalAlpha = 0.06;
                ctx.strokeStyle = faction.color;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(b.x, b.y);
                ctx.lineTo(bsx, bsy);
                ctx.stroke();

                // Base structure (rectangle)
                ctx.save();
                ctx.translate(bsx, bsy);
                ctx.rotate(c.spaceBase.angle + Math.PI / 2);
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = '#aabbcc';
                ctx.fillRect(-3, -1.5, 6, 3);
                // Docking lights
                ctx.globalAlpha = 0.5 + Math.sin(time * 4) * 0.2;
                ctx.fillStyle = faction.color;
                ctx.fillRect(-3.5, -0.5, 1, 1);
                ctx.fillRect(2.5, -0.5, 1, 1);
                ctx.restore();
            }

            // --- Robot workers (tech >= 4, buzzing dots near surface) ---
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

            // --- Combat drones (tech >= 5, patrolling perimeter) ---
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
        }

        // ============================================================
        // SPACE TRAVELERS â€” Rocket System
        // ============================================================

        const MAX_ROCKETS = 60;
        const ROCKET_TRAIL_LEN = 10;

        function createRocket(origin, target, type, factionId) {
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
        }

        function updateRockets(dt, bodies) {
            const rockets = state.rockets;
            for (let i = rockets.length - 1; i >= 0; i--) {
                const r = rockets[i];
                r.age += dt;

                // Despawn: too old (lost in space)
                if (r.age > 30) { rockets.splice(i, 1); continue; }

                // Trail breadcrumb
                r.trail.push({ x: r.x, y: r.y });
                if (r.trail.length > ROCKET_TRAIL_LEN) r.trail.shift();

                // Target destroyed?
                if (r.target && bodies.indexOf(r.target) < 0) {
                    rockets.splice(i, 1);
                    spawnDebris(r.x, r.y, 3, FACTIONS[r.faction].hue, 0.5);
                    continue;
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

                    // Colony ship: land after 2s orbit
                    if (r.type === 'colony' && r.orbitTime > 2) {
                        if (!r.target.civ) {
                            initColony(r.target);
                            r.target.civ.faction = r.faction;
                            r.target.civ.population = r.cargo.population || 5;
                        } else if (r.target.civ.faction === r.faction) {
                            // Reinforce existing same-faction colony
                            r.target.civ.population += r.cargo.population || 3;
                        }
                        spawnFlash(r.target.x, r.target.y, r.target.r * 2, FACTIONS[r.faction].color, 0.3);
                        rockets.splice(i, 1);
                        continue;
                    }

                    // Mining drone: mine for 3s, then return home
                    if (r.type === 'mining') {
                        if (r.phase === 'outbound' && r.orbitTime > 3) {
                            r.target.mass = Math.max(0.5, r.target.mass - 0.3);
                            r.target.r = massToRadius(r.target.mass);
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
                                // Fire at surface: combat streak visual
                                const sa = Math.random() * Math.PI * 2;
                                const sx = r.target.x + Math.cos(sa) * r.target.r;
                                const sy = r.target.y + Math.sin(sa) * r.target.r;
                                spawnDebris(r.x, r.y, 2, FACTIONS[r.faction].hue, 0.5);
                                spawnFlash(sx, sy, 3, 'rgba(255,150,50,0.5)', 0.1);

                                // Chance to destroy settlement (shields can block)
                                if (tc.settlements.length > 0 && Math.random() < 0.15) {
                                    if (tc.shields > 0.1 && Math.random() < tc.shields * 0.5) {
                                        tc.shields -= 0.15;
                                        spawnFlash(r.target.x, r.target.y, r.target.r + 4, FACTIONS[tc.faction].color, 0.1);
                                    } else {
                                        tc.settlements.splice(Math.floor(Math.random() * tc.settlements.length), 1);
                                        spawnFlash(r.target.x, r.target.y, r.target.r, 'rgba(255,100,50,0.5)', 0.2);
                                        state.relations[tc.faction][r.faction] = Math.max(-1, state.relations[tc.faction][r.faction] - 0.05);
                                    }
                                }

                                // Fortress fires back
                                const hasFort = tc.settlements.some(s => s.type === 'fortress');
                                if (hasFort && Math.random() < 0.2) {
                                    r.hp--;
                                    spawnFlash(r.x, r.y, 4, 'rgba(255,200,100,0.6)', 0.1);
                                    spawnDebris(r.x, r.y, 2, tc.faction, 0.3);
                                    if (r.hp <= 0) {
                                        spawnDebris(r.x, r.y, 5, FACTIONS[r.faction].hue, 1.5);
                                        spawnFlash(r.x, r.y, 6, 'rgba(255,200,100,0.7)', 0.2);
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
                                spawnFlash(r.target.x, r.target.y, r.target.r * 3, FACTIONS[r.faction].color, 0.5);
                                spawnRing(r.target.x, r.target.y, r.target.r * 5, FACTIONS[r.faction].color, 0.6, 2);
                                rockets.splice(i, 1);
                                continue;
                            }
                        } else {
                            // Target no longer enemy, remove fleet
                            rockets.splice(i, 1);
                            continue;
                        }
                    }

                    // Capital ship: heavy assault from orbit (attacks faster, harder to kill)
                    if (r.type === 'capital') {
                        const tc = r.target.civ;
                        if (tc && tc.faction !== r.faction) {
                            r._attackTimer = (r._attackTimer || 0) + dt;
                            if (r._attackTimer > 0.5) {
                                r._attackTimer = 0;
                                spawnDebris(r.x, r.y, 3, FACTIONS[r.faction].hue, 0.5);
                                const sa = Math.random() * Math.PI * 2;
                                spawnFlash(r.target.x + Math.cos(sa) * r.target.r, r.target.y + Math.sin(sa) * r.target.r, 4, 'rgba(255,150,50,0.6)', 0.1);

                                if (tc.settlements.length > 0 && Math.random() < 0.25) {
                                    if (tc.shields > 0.1 && Math.random() < tc.shields * 0.4) {
                                        tc.shields -= 0.2;
                                        spawnFlash(r.target.x, r.target.y, r.target.r + 4, FACTIONS[tc.faction].color, 0.15);
                                    } else {
                                        tc.settlements.splice(Math.floor(Math.random() * tc.settlements.length), 1);
                                        spawnFlash(r.target.x, r.target.y, r.target.r * 1.5, 'rgba(255,100,50,0.6)', 0.2);
                                    }
                                }
                                const hasFort = tc.settlements.some(s => s.type === 'fortress');
                                if (hasFort && Math.random() < 0.08) {
                                    r.hp--;
                                    spawnFlash(r.x, r.y, 5, 'rgba(255,200,100,0.6)', 0.15);
                                    if (r.hp <= 0) {
                                        spawnDebris(r.x, r.y, 10, FACTIONS[r.faction].hue, 2);
                                        spawnFlash(r.x, r.y, 12, 'rgba(255,200,100,0.8)', 0.3);
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
                                spawnFlash(r.target.x, r.target.y, r.target.r * 3, FACTIONS[r.faction].color, 0.5);
                                spawnRing(r.target.x, r.target.y, r.target.r * 5, FACTIONS[r.faction].color, 0.6, 2);
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
                                spawnRing(r.target.x, r.target.y, r.target.r * 3, FACTIONS[tc.faction].color, 0.4, 2);
                            } else {
                                const kills = Math.min(tc.settlements.length, 3 + Math.floor(Math.random() * 3));
                                for (let k = 0; k < kills; k++) {
                                    if (tc.settlements.length > 0)
                                        tc.settlements.splice(Math.floor(Math.random() * tc.settlements.length), 1);
                                }
                                tc.population *= 0.6;
                                tc.morale = Math.max(0.1, tc.morale - 0.3);
                            }
                            spawnFlash(r.target.x, r.target.y, r.target.r * 4, 'rgba(255,100,50,0.9)', 0.5);
                            spawnRing(r.target.x, r.target.y, r.target.r * 6, 'rgba(255,80,30,0.8)', 0.7, 3);
                            spawnRing(r.target.x, r.target.y, r.target.r * 4, 'rgba(255,200,50,0.6)', 0.4, 2);
                            spawnDebris(r.target.x, r.target.y, 20, 30, 2);
                            state.relations[tc.faction][r.faction] = Math.max(-1, state.relations[tc.faction][r.faction] - 0.3);
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
                    const force = G * b.mass / (distSq + 200) * 0.3;
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
                const vw = state._vw, vh = state._vh;
                if (r.x < -20) r.x = vw + 20;
                if (r.x > vw + 20) r.x = -20;
                if (r.y < -20) r.y = vh + 20;
                if (r.y > vh + 20) r.y = -20;

                // --- Orbit insertion: close enough to target ---
                if (r.target) {
                    const adx = r.target.x - r.x, ady = r.target.y - r.y;
                    const aDist = Math.sqrt(adx * adx + ady * ady);
                    if (aDist < r.target.r * 2.2) {
                        r.orbiting = true;
                        r.orbitAngle = Math.atan2(r.y - r.target.y, r.x - r.target.x);
                        continue;
                    }
                }

                // --- Combat drone defense: tech >= 5 colonies auto-engage enemy ships ---
                if ((r.type === 'war' || r.type === 'nuke' || r.type === 'capital') && !r.orbiting) {
                    for (const b of bodies) {
                        if (!b.civ || b.civ.faction === r.faction || b.civ.techLevel < 5) continue;
                        const ddx = b.x - r.x, ddy = b.y - r.y;
                        if (ddx * ddx + ddy * ddy < (b.r * 3) * (b.r * 3) && Math.random() < 0.1 * dt) {
                            r.hp--;
                            spawnFlash(r.x, r.y, 3, 'rgba(255,200,100,0.5)', 0.1);
                            if (r.hp <= 0) {
                                spawnDebris(r.x, r.y, 4, FACTIONS[r.faction].hue, 1);
                                spawnFlash(r.x, r.y, 6, 'rgba(255,200,100,0.7)', 0.2);
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
                        spawnDebris(r.x, r.y, 4, FACTIONS[r.faction].hue, 1);
                        spawnFlash(r.x, r.y, 8, 'rgba(255,200,100,0.6)', 0.15);
                        rockets.splice(i, 1);
                        break;
                    }
                }
            }
        }

        function drawRockets(ctx, time) {
            for (const r of state.rockets) {
                const f = FACTIONS[r.faction];

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

                // Rocket body (triangle in velocity direction)
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

                // Type-specific extra effects
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
            }
            ctx.globalAlpha = 1;
        }

        // ============================================================
        // SPACE TRAVELERS â€” Trade Routes & Mining
        // ============================================================

        function manageRoutes() {
            const bodies = state.bodies;
            const routes = state.routes;

            // Remove dead routes
            for (let i = routes.length - 1; i >= 0; i--) {
                const rt = routes[i];
                if (bodies.indexOf(rt.from) < 0 || bodies.indexOf(rt.to) < 0 ||
                    !rt.from.civ || !rt.to.civ ||
                    rt.from.civ.faction !== rt.to.civ.faction) {
                    routes.splice(i, 1);
                }
            }

            // Establish new routes (same faction, tech >= 2, within 400px)
            for (let i = 0; i < bodies.length; i++) {
                const a = bodies[i];
                if (!a.civ || a.civ.techLevel < 2) continue;
                for (let j = i + 1; j < bodies.length; j++) {
                    const b = bodies[j];
                    if (!b.civ || b.civ.techLevel < 2) continue;
                    if (a.civ.faction !== b.civ.faction) continue;
                    const dx = b.x - a.x, dy = b.y - a.y;
                    if (dx * dx + dy * dy > 400 * 400) continue;
                    const exists = routes.some(rt =>
                        (rt.from === a && rt.to === b) || (rt.from === b && rt.to === a));
                    if (!exists && routes.length < 15) {
                        routes.push({ from: a, to: b, faction: a.civ.faction, age: 0, shipTimer: 0 });
                    }
                }
            }

            // Passive trade bonus per route
            for (const rt of routes) {
                if (rt.from.civ) rt.from.civ.resources += 0.5;
                if (rt.to.civ) rt.to.civ.resources += 0.5;
            }
        }

        function updateRoutes(dt) {
            for (const rt of state.routes) {
                rt.age += dt;
                rt.shipTimer += dt;

                // Spawn trade ship every 10s per route
                if (rt.shipTimer > 10 && state.rockets.length < MAX_ROCKETS) {
                    rt.shipTimer = 0;
                    const outbound = rt.age % 20 < 10;
                    const from = outbound ? rt.from : rt.to;
                    const to = outbound ? rt.to : rt.from;
                    if (from.civ && to.civ) {
                        state.rockets.push(createRocket(from, to, 'trade', rt.faction));
                    }
                }
            }
        }

        function drawRoutes(ctx) {
            for (const rt of state.routes) {
                const f = FACTIONS[rt.faction];
                ctx.globalAlpha = 0.1;
                ctx.strokeStyle = f.color;
                ctx.lineWidth = 0.8;
                ctx.setLineDash([4, 6]);

                // BÃ©zier arc with perpendicular offset
                const mx = (rt.from.x + rt.to.x) / 2;
                const my = (rt.from.y + rt.to.y) / 2;
                const dx = rt.to.x - rt.from.x, dy = rt.to.y - rt.from.y;
                const dist = Math.sqrt(dx * dx + dy * dy) + 1;
                const cpx = mx + (-dy / dist) * dist * 0.15;
                const cpy = my + (dx / dist) * dist * 0.15;

                ctx.beginPath();
                ctx.moveTo(rt.from.x, rt.from.y);
                ctx.quadraticCurveTo(cpx, cpy, rt.to.x, rt.to.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.globalAlpha = 1;
        }

        // ============================================================
        // SPACE TRAVELERS â€” Diplomacy & Relations
        // ============================================================

        function updateRelations(dt) {
            const rel = state.relations;
            const bodies = state.bodies;

            // Natural decay toward neutral
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 6; j++) {
                    if (i === j) continue;
                    if (rel[i][j] > 0.01) rel[i][j] -= 0.002 * dt;
                    else if (rel[i][j] < -0.01) rel[i][j] += 0.001 * dt;
                }
            }

            // Proximity tension: colonies within 200px of different faction
            for (let i = 0; i < bodies.length; i++) {
                const a = bodies[i];
                if (!a.civ) continue;
                for (let j = i + 1; j < bodies.length; j++) {
                    const b = bodies[j];
                    if (!b.civ || a.civ.faction === b.civ.faction) continue;
                    const dx = b.x - a.x, dy = b.y - a.y;
                    if (dx * dx + dy * dy < 200 * 200) {
                        const fi = a.civ.faction, fj = b.civ.faction;
                        rel[fi][fj] = Math.max(-1, rel[fi][fj] - 0.01 * dt);
                        rel[fj][fi] = Math.max(-1, rel[fj][fi] - 0.01 * dt);
                    }
                }
            }

            // Trade route peace bonus (reduces hostility between connected factions)
            for (const rt of state.routes) {
                if (rt.from.civ && rt.to.civ && rt.from.civ.faction !== rt.to.civ.faction) {
                    const fi = rt.from.civ.faction, fj = rt.to.civ.faction;
                    rel[fi][fj] = Math.min(1, rel[fi][fj] + 0.005 * dt);
                    rel[fj][fi] = Math.min(1, rel[fj][fi] + 0.005 * dt);
                }
            }

            // Aggressive factions ramp hostility faster
            for (let i = 0; i < 6; i++) {
                if (FACTIONS[i].trait === 'aggressive') {
                    for (let j = 0; j < 6; j++) {
                        if (i === j) continue;
                        if (rel[i][j] < 0) rel[i][j] -= 0.003 * dt;
                    }
                }
            }

            // Defensive factions build tolerance
            for (let i = 0; i < 6; i++) {
                if (FACTIONS[i].trait === 'defensive') {
                    for (let j = 0; j < 6; j++) {
                        if (i === j) continue;
                        if (rel[i][j] < 0) rel[i][j] = Math.min(0, rel[i][j] + 0.004 * dt);
                    }
                }
            }
        }

        // ============================================================
        // SPACE TRAVELERS â€” Cosmic Events
        // ============================================================

        function updateCosmicEvents(dt, bodies) {
            state._eventTimer = (state._eventTimer || 0) + dt;

            // Spawn new event every 30-60s
            if (!state.cosmicEvent && state._eventTimer > 30 + Math.random() * 30) {
                state._eventTimer = 0;
                const types = ['meteor_storm', 'solar_flare', 'rogue_planet'];
                const hasStars = bodies.some(b => bodyType(b.mass) === 'star');
                if (!hasStars) types.splice(types.indexOf('solar_flare'), 1);
                const type = types[Math.floor(Math.random() * types.length)];
                const vw = state._vw, vh = state._vh;

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
                    state.cosmicEvent = { type: 'meteor_storm', duration: 5, life: 5, meteors: meteors };
                }

                else if (type === 'solar_flare') {
                    const stars = bodies.filter(b => bodyType(b.mass) === 'star');
                    if (stars.length > 0) {
                        const star = stars[Math.floor(Math.random() * stars.length)];
                        state.cosmicEvent = {
                            type: 'solar_flare', duration: 3, life: 3,
                            star: star, angle: Math.random() * Math.PI * 2,
                            spread: 0.5, range: 300,
                        };
                    }
                }

                else if (type === 'rogue_planet' && bodies.length < MAX_BODIES) {
                    const side = Math.floor(Math.random() * 4);
                    let rx, ry, rvx, rvy;
                    const spd = 80 + Math.random() * 60;
                    if (side === 0)      { rx = Math.random() * vw; ry = -40; rvx = (Math.random() - 0.5) * 30; rvy = spd; }
                    else if (side === 1) { rx = vw + 40; ry = Math.random() * vh; rvx = -spd; rvy = (Math.random() - 0.5) * 30; }
                    else if (side === 2) { rx = Math.random() * vw; ry = vh + 40; rvx = (Math.random() - 0.5) * 30; rvy = -spd; }
                    else                 { rx = -40; ry = Math.random() * vh; rvx = spd; rvy = (Math.random() - 0.5) * 30; }
                    const rogue = createBody(rx, ry, rvx, rvy, 100 + Math.random() * 200);
                    bodies.push(rogue);
                    state.cosmicEvent = { type: 'rogue_planet', duration: 15, life: 15, body: rogue };
                    spawnRing(rx, ry, 30, 'rgba(200,200,255,0.5)', 0.5, 2);
                }
            }

            // Update active event
            const ev = state.cosmicEvent;
            if (!ev) return;
            ev.life -= dt;

            if (ev.type === 'meteor_storm') {
                for (const m of ev.meteors) {
                    if (!m.alive) continue;
                    m.x += m.vx * dt;
                    m.y += m.vy * dt;
                    // Collision with bodies
                    for (const b of bodies) {
                        const dx = b.x - m.x, dy = b.y - m.y;
                        if (dx * dx + dy * dy < (b.r + m.r) * (b.r + m.r)) {
                            m.alive = false;
                            spawnFlash(m.x, m.y, 8, 'rgba(255,200,100,0.7)', 0.2);
                            spawnDebris(m.x, m.y, 5, 30, 1);
                            if (b.civ && b.civ.settlements.length > 0) {
                                b.civ.settlements.splice(Math.floor(Math.random() * b.civ.settlements.length), 1);
                            }
                            break;
                        }
                    }
                    if (m.x < -50 || m.x > state._vw + 50 || m.y < -50 || m.y > state._vh + 50) {
                        m.alive = false;
                    }
                }
            }

            else if (ev.type === 'solar_flare') {
                if (bodies.indexOf(ev.star) < 0) { state.cosmicEvent = null; return; }
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

            if (ev.life <= 0) { state.cosmicEvent = null; }
        }

        function drawCosmicEvent(ctx) {
            const ev = state.cosmicEvent;
            if (!ev) return;

            if (ev.type === 'meteor_storm') {
                for (const m of ev.meteors) {
                    if (!m.alive) continue;
                    ctx.globalAlpha = 0.8;
                    ctx.fillStyle = '#DDA044';
                    ctx.beginPath();
                    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
                    ctx.fill();
                    // Trail
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
                if (!ev.star || state.bodies.indexOf(ev.star) < 0) return;
                const t = 1 - ev.life / ev.duration;
                const curRange = ev.range * t;
                ctx.save();
                ctx.translate(ev.star.x, ev.star.y);
                ctx.rotate(ev.angle);
                // Flare cone
                ctx.globalAlpha = (1 - t) * 0.25;
                ctx.fillStyle = `hsla(${ev.star.hue}, 100%, 70%, 0.5)`;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, curRange, -ev.spread, ev.spread);
                ctx.closePath();
                ctx.fill();
                // Core beam
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
        }


        // ============================================================
        // SPACE TRAVELERS  Star Types & Hazards
        // ============================================================

        function classifyStar(b) {
            if (!b._starClass) {
                const m = b.mass;
                if (m > STAR_MAX * 0.85) b._starClass = 'blue_supergiant';
                else if (m > STAR_MAX * 0.6) b._starClass = 'red_giant';
                else b._starClass = 'yellow';
                b._starAge = 0;
                b._pulsarAngle = 0;
                b._isNuclear = false;
                b._supernovaTimer = b._starClass === 'blue_supergiant' ? (40 + Math.random() * 30) : -1;
            }
            b._starAge += 0;
            return b._starClass;
        }

        // Star hazard zones  drawn behind everything
        function drawStarHazards(ctx, bodies, dt) {
            for (const b of bodies) {
                const type = bodyType(b.mass);
                if (type !== 'star') continue;
                const sc = classifyStar(b);
                b._starAge = (b._starAge || 0) + dt;

                // Radiation zone (habitable zone ring)
                const radR = b.r * 8;
                const habInner = radR * 0.4;
                const habOuter = radR * 0.6;

                // Habitable zone glow
                ctx.globalAlpha = 0.04;
                ctx.strokeStyle = sc === 'blue_supergiant' ? 'rgba(100,150,255,0.5)' :
                                  sc === 'red_giant' ? 'rgba(255,100,80,0.4)' :
                                  'rgba(255,220,100,0.3)';
                ctx.lineWidth = habOuter - habInner;
                ctx.beginPath();
                ctx.arc(b.x, b.y, (habInner + habOuter) / 2, 0, Math.PI * 2);
                ctx.stroke();

                // Nuclear star: green radiation pulses
                if (b._isNuclear) {
                    b._nuclearPulseTimer = (b._nuclearPulseTimer || 0) + dt;
                    if (b._nuclearPulseTimer > 5 + Math.random() * 3) {
                        b._nuclearPulseTimer = 0;
                        spawnRing(b.x, b.y, 350, 'rgba(100,255,50,0.4)', 1.8, 3);
                        // Damage nearby colonies
                        for (const ob of bodies) {
                            if (!ob.civ || ob === b) continue;
                            const dx = ob.x - b.x, dy = ob.y - b.y;
                            if (dx * dx + dy * dy < 350 * 350) {
                                ob.civ.population *= 0.9;
                                ob.civ.morale = Math.max(0, ob.civ.morale - 0.1);
                            }
                        }
                    }
                    // Green aura
                    ctx.globalAlpha = 0.06 + 0.02 * Math.sin(b._starAge * 2);
                    const ng = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, b.r * 5);
                    ng.addColorStop(0, 'rgba(80,255,40,0.3)');
                    ng.addColorStop(1, 'rgba(80,255,40,0)');
                    ctx.fillStyle = ng;
                    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 5, 0, Math.PI * 2); ctx.fill();
                }

                // Blue supergiant: supernova countdown
                if (sc === 'blue_supergiant' && b._supernovaTimer > 0) {
                    b._supernovaTimer -= dt;
                    // Warning flicker in last 5 seconds
                    if (b._supernovaTimer < 5 && b._supernovaTimer > 0) {
                        ctx.globalAlpha = 0.15 + 0.1 * Math.sin(b._starAge * 15);
                        ctx.fillStyle = 'rgba(255,255,255,0.9)';
                        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.5, 0, Math.PI * 2); ctx.fill();
                    }
                    // SUPERNOVA! Shatter the star
                    if (b._supernovaTimer <= 0) {
                        b._supernovaTimer = -1;
                        spawnCollapse(b.x, b.y, b.r);
                        spawnRing(b.x, b.y, 500, 'rgba(255,255,200,0.8)', 2, 5);
                        spawnRing(b.x, b.y, 350, 'rgba(255,150,50,0.6)', 1.5, 4);
                        spawnFlash(b.x, b.y, 200, 'rgba(255,255,255,0.9)', 0.5);
                        spawnDebris(b.x, b.y, 40, 45, 3);
                        // Damage all colonies within 300px
                        for (const ob of bodies) {
                            if (!ob.civ || ob === b) continue;
                            const dx = ob.x - b.x, dy = ob.y - b.y;
                            if (dx * dx + dy * dy < 300 * 300) {
                                ob.civ.population *= 0.3;
                                ob.civ.morale = Math.max(0, ob.civ.morale - 0.5);
                                if (ob.civ.settlements.length > 2) {
                                    ob.civ.settlements.splice(0, Math.ceil(ob.civ.settlements.length / 2));
                                }
                            }
                        }
                        // Shatter the star body into fragments
                        const idx = bodies.indexOf(b);
                        if (idx >= 0) {
                            bodies.splice(idx, 1);
                            const numF = 6 + Math.floor(Math.random() * 4);
                            for (let f = 0; f < numF && bodies.length < MAX_BODIES; f++) {
                                const ang = (Math.PI * 2 * f / numF) + (Math.random() - 0.5) * 0.5;
                                const spd = 200 + Math.random() * 200;
                                const fragMass = (b.mass / numF) * (0.5 + Math.random());
                                const fb = createBody(
                                    b.x + Math.cos(ang) * b.r * 2, b.y + Math.sin(ang) * b.r * 2,
                                    Math.cos(ang) * spd, Math.sin(ang) * spd, fragMass
                                );
                                bodies.push(fb);
                            }
                        }
                    }
                }

                // Red giant: pulsating expansion warning
                if (sc === 'red_giant') {
                    const pulse = 1 + 0.08 * Math.sin(b._starAge * 1.5);
                    ctx.globalAlpha = 0.05;
                    const rg = ctx.createRadialGradient(b.x, b.y, b.r * pulse, b.x, b.y, b.r * 3 * pulse);
                    rg.addColorStop(0, 'rgba(255,100,50,0.2)');
                    rg.addColorStop(1, 'rgba(255,50,20,0)');
                    ctx.fillStyle = rg;
                    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3 * pulse, 0, Math.PI * 2); ctx.fill();
                }

                // Colony growth bonus in habitable zone
                for (const ob of bodies) {
                    if (!ob.civ || ob === b) continue;
                    const dx = ob.x - b.x, dy = ob.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > habInner && dist < habOuter) {
                        ob.civ._habBonus = true; // Used in colony growth
                    }
                }
            }
            ctx.globalAlpha = 1;
        }

        // Mark nuclear star on star+star merge
        function markNuclearStar(b) {
            b._isNuclear = true;
            b._nuclearPulseTimer = 0;
            b._starClass = 'nuclear';
            spawnRing(b.x, b.y, 200, 'rgba(100,255,50,0.6)', 1, 3);
            spawnFlash(b.x, b.y, 50, 'rgba(100,255,50,0.7)', 0.3);
        }

        // ============================================================
        // SPACE TRAVELERS  Mega Structures
        // ============================================================

        function updateMegaStructures(dt, bodies) {
            for (const b of bodies) {
                if (!b.civ || b.civ.techLevel < 7) continue;

                // Dyson Ring construction (tech >= 7, near a star)
                if (!b.civ.dysonRing && !b.civ._dysonBuilding) {
                    for (const s of bodies) {
                        if (bodyType(s.mass) !== 'star') continue;
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
                    db.progress += dt / 30; // 30s to complete
                    db.segments = Math.floor(db.progress * 16);
                    if (db.progress >= 1) {
                        b.civ.dysonRing = { star: db.star, segments: 16, angle: 0 };
                        b.civ._dysonBuilding = null;
                        spawnRing(db.star.x, db.star.y, db.star.r * 4, 'rgba(255,220,50,0.7)', 1, 3);
                    }
                }

                // Dyson Ring benefits
                if (b.civ.dysonRing) {
                    const dr = b.civ.dysonRing;
                    if (bodies.indexOf(dr.star) < 0) { b.civ.dysonRing = null; continue; }
                    dr.angle = (dr.angle || 0) + dt * 0.3;
                    // Boost tech and resources
                    b.civ.techLevel = Math.min(10, b.civ.techLevel + 0.01 * dt);
                    b.civ.resources += 5 * dt;
                }

                // Planetary shield regeneration (tech >= 5)
                if (b.civ.techLevel >= 5 && b.civ.shields < 1) {
                    b.civ.shields = Math.min(1, b.civ.shields + 0.02 * dt);
                }
            }
        }

        function drawMegaStructures(ctx, bodies, time) {
            for (const b of bodies) {
                if (!b.civ) continue;

                // Dyson Ring rendering
                if (b.civ.dysonRing) {
                    const dr = b.civ.dysonRing;
                    if (bodies.indexOf(dr.star) < 0) continue;
                    const sx = dr.star.x, sy = dr.star.y;
                    const ringR = dr.star.r * 2.5;
                    const fc = FACTIONS[b.civ.faction].color;

                    // Ring segments (orbiting dots connected by lines)
                    for (let i = 0; i < dr.segments; i++) {
                        const ang = (Math.PI * 2 * i / 16) + dr.angle;
                        const x = sx + Math.cos(ang) * ringR;
                        const y = sy + Math.sin(ang) * ringR;
                        // Segment dot
                        ctx.globalAlpha = 0.7;
                        ctx.fillStyle = fc;
                        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
                        // Connection to next segment
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
                    // Energy pulse ring
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
                    // Partial ring
                    for (let i = 0; i < db.segments; i++) {
                        const ang = (Math.PI * 2 * i / 16);
                        ctx.globalAlpha = 0.4;
                        ctx.fillStyle = FACTIONS[b.civ.faction].color;
                        ctx.beginPath();
                        ctx.arc(sx + Math.cos(ang) * ringR, sy + Math.sin(ang) * ringR, 1.5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    // Progress arc
                    ctx.globalAlpha = 0.15;
                    ctx.strokeStyle = FACTIONS[b.civ.faction].color;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(sx, sy, ringR, 0, Math.PI * 2 * db.progress);
                    ctx.stroke();
                }

                // Planetary shield dome
                if (b.civ.shields > 0.05) {
                    const shieldR = b.r + 4;
                    ctx.globalAlpha = b.civ.shields * 0.15;
                    ctx.strokeStyle = FACTIONS[b.civ.faction].color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(b.x, b.y, shieldR, 0, Math.PI * 2); ctx.stroke();
                    // Shield shimmer
                    if (b.civ._shieldHit) {
                        b.civ._shieldHit -= dt;
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
        }

        // ============================================================
        // SPACE TRAVELERS  Destruction & Evacuation
        // ============================================================

        function handleDestruction(bodies, dt) {
            for (let i = bodies.length - 1; i >= 0; i--) {
                const b = bodies[i];
                if (!b.civ) continue;

                // Check proximity to black holes
                for (const bh of bodies) {
                    if (bodyType(bh.mass) !== 'blackhole') continue;
                    const dx = b.x - bh.x, dy = b.y - bh.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const dangerR = bh.r * 3;

                    if (dist < dangerR) {
                        // Colony distress  approaching event horizon
                        if (!b.civ._bhDistress) {
                            b.civ._bhDistress = true;
                            b.civ.alert = 'evacuation';
                            // Launch escape pods
                            const podCount = 2 + Math.floor(Math.random() * 4);
                            for (let p = 0; p < podCount; p++) {
                                const ang = Math.random() * Math.PI * 2;
                                const escVel = 200 + Math.random() * 200;
                                state.rockets.push({
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

                // Red Alert for colonies being sieged
                if (b.civ && b.civ.alert === 'war') {
                    // Rapid settlement flicker handled in drawSettlements
                }
            }

            // Escape pod lifetime (disappear after 15s)
            for (let i = state.rockets.length - 1; i >= 0; i--) {
                const r = state.rockets[i];
                if (r.type === 'escape' && r.age > 15) {
                    state.rockets.splice(i, 1);
                    continue;
                }
                // Escape pod rescue: reaches friendly colony
                if (r.type === 'escape' && r.age > 1) {
                    for (const b of bodies) {
                        if (!b.civ || b.civ.faction !== r.faction) continue;
                        const dx = b.x - r.x, dy = b.y - r.y;
                        if (Math.sqrt(dx * dx + dy * dy) < b.r * 2) {
                            b.civ.population += 2; // Refugees rescued!
                            spawnFlash(r.x, r.y, 5, FACTIONS[r.faction].color + '88', 0.15);
                            state.rockets.splice(i, 1);
                            break;
                        }
                    }
                }
            }
        }

        function drawDestructionEffects(ctx, bodies, time) {
            for (const b of bodies) {
                if (!b.civ) continue;

                // Black hole distress  spaghettification visual
                if (b.civ._bhDistress) {
                    // Stretched glow toward nearest BH
                    for (const bh of bodies) {
                        if (bodyType(bh.mass) !== 'blackhole') continue;
                        const dx = bh.x - b.x, dy = bh.y - b.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < bh.r * 4) {
                            // Draw stretch lines toward BH
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

                // Evacuation alert icon  flashing red ring
                if (b.civ.alert === 'evacuation' || b.civ.alert === 'war') {
                    const flash = Math.sin(time * 10) > 0 ? 0.4 : 0.1;
                    ctx.globalAlpha = flash;
                    ctx.strokeStyle = b.civ.alert === 'evacuation' ? '#FF4444' : '#FF8800';
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, 0, Math.PI * 2); ctx.stroke();
                }
            }

            // Faction elimination check
            if (!state._elimCheck) state._elimCheck = 0;
            state._elimCheck += 1;
            if (state._elimCheck % 180 === 0) { // Every ~3s at 60fps
                for (let f = 0; f < 6; f++) {
                    if (state.factions[f].eliminated) continue;
                    const hasCiv = bodies.some(b => b.civ && b.civ.faction === f);
                    const hasRocket = state.rockets.some(r => r.faction === f);
                    if (!hasCiv && !hasRocket) {
                        state.factions[f].eliminated = true;
                        // Memorial flash
                        spawnFlash(state._vw / 2, state._vh / 2, 100, FACTIONS[f].color + '66', 0.5);
                    }
                }
            }

            ctx.globalAlpha = 1;
        }
        function massToRadius(m) { return Math.pow(m, 0.35) * 5.0; }

        function bodyType(m) {
            if (m <= ASTEROID_MAX) return 'asteroid';
            if (m <= MOON_MAX) return 'moon';
            if (m <= PLANET_MAX) return 'planet';
            if (m <= STAR_MAX) return 'star';
            return 'blackhole';
        }

        function pickColor(mass) {
            const type = bodyType(mass);
            let pal;
            if (type === 'asteroid') pal = ASTEROID_COLORS;
            else if (type === 'moon') pal = MOON_COLORS;
            else if (type === 'planet') pal = PLANET_COLORS;
            else pal = STAR_COLORS;
            const c = pal[Math.floor(Math.random() * pal.length)];
            return {
                hue: c.h + (Math.random() - 0.5) * 20,
                sat: c.s + (Math.random() - 0.5) * 10,
                lit: c.l + (Math.random() - 0.5) * 10
            };
        }

        function createBody(x, y, vx, vy, mass) {
            const c = pickColor(mass);
            return {
                x, y, vx, vy, mass, r: massToRadius(mass),
                hue: c.hue, sat: c.sat, lit: c.lit,
                bhTime: 0, evapMass: mass,
                seed: Math.floor(Math.random() * 2147483647)
            };
        }

        // Seeded PRNG for deterministic procedural textures
        function seededRng(seed) {
            let s = seed | 0 || 1;
            return () => { s = (s * 16807 + 11) % 2147483647; return (s - 1) / 2147483646; };
        }

        // Pre-bake procedural body texture onto a canvas
        function generateBodyTexture(b) {
            const type = bodyType(b.mass);
            const r = b.r;
            const pad = type === 'star' ? r * 2.5 : 6;
            const size = Math.ceil((r + pad) * 2);
            const oc = document.createElement('canvas');
            oc.width = size; oc.height = size;
            const c = oc.getContext('2d');
            const cx = size / 2, cy = size / 2;
            const rng = seededRng(b.seed);

            if (r < 3) {
                // Tiny body: simple colored circle
                c.fillStyle = `hsl(${b.hue}, ${b.sat}%, ${b.lit}%)`;
                c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();

            } else if (type === 'asteroid') {
                // --- Irregular rocky shape with craters ---
                c.save(); c.translate(cx, cy);
                c.beginPath();
                const nv = 8 + Math.floor(rng() * 5);
                for (let i = 0; i <= nv; i++) {
                    const a = (Math.PI * 2 * i) / nv;
                    const j = 0.7 + rng() * 0.35;
                    const px = Math.cos(a) * r * j, py = Math.sin(a) * r * j;
                    i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
                }
                c.closePath();
                const ag = c.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r);
                ag.addColorStop(0, `hsl(${b.hue}, ${b.sat + 5}%, ${b.lit + 12}%)`);
                ag.addColorStop(1, `hsl(${b.hue}, ${b.sat}%, ${Math.max(15, b.lit - 12)}%)`);
                c.fillStyle = ag; c.fill();
                c.save(); c.clip();
                // Craters
                const nc = 2 + Math.floor(rng() * 4);
                for (let i = 0; i < nc; i++) {
                    const cx2 = (rng() - 0.5) * r * 1.2, cy2 = (rng() - 0.5) * r * 1.2;
                    const cr = r * (0.1 + rng() * 0.18);
                    c.fillStyle = `hsla(${b.hue}, ${b.sat}%, ${b.lit - 15}%, 0.45)`;
                    c.beginPath(); c.arc(cx2, cy2, cr, 0, Math.PI * 2); c.fill();
                    c.strokeStyle = `hsla(${b.hue}, ${b.sat}%, ${b.lit + 10}%, 0.25)`;
                    c.lineWidth = Math.max(0.5, cr * 0.12);
                    c.beginPath(); c.arc(cx2 - cr * 0.15, cy2 - cr * 0.15, cr, Math.PI * 0.8, Math.PI * 1.8); c.stroke();
                }
                // Surface noise
                for (let i = 0; i < 12 + r * 2; i++) {
                    c.fillStyle = `hsla(${b.hue + (rng() - 0.5) * 20}, ${b.sat}%, ${b.lit + (rng() - 0.5) * 18}%, ${0.12 + rng() * 0.18})`;
                    c.beginPath(); c.arc((rng() - 0.5) * r * 1.6, (rng() - 0.5) * r * 1.6, 0.5 + rng() * 1.5, 0, Math.PI * 2); c.fill();
                }
                c.restore(); c.restore();

            } else if (type === 'moon') {
                // --- Cratered moon ---
                c.save(); c.translate(cx, cy);
                const mg = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
                mg.addColorStop(0, `hsl(${b.hue}, ${b.sat + 5}%, ${b.lit + 15}%)`);
                mg.addColorStop(0.5, `hsl(${b.hue}, ${b.sat}%, ${b.lit}%)`);
                mg.addColorStop(1, `hsl(${b.hue}, ${Math.max(0, b.sat - 3)}%, ${Math.max(20, b.lit - 18)}%)`);
                c.fillStyle = mg;
                c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
                c.save(); c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
                // Craters
                const mc = 5 + Math.floor(rng() * 6);
                for (let i = 0; i < mc; i++) {
                    const cx2 = (rng() - 0.5) * r * 1.4, cy2 = (rng() - 0.5) * r * 1.4;
                    const cr = r * (0.08 + rng() * 0.22);
                    c.fillStyle = `hsla(${b.hue}, ${Math.max(0, b.sat - 3)}%, ${b.lit - 10}%, 0.35)`;
                    c.beginPath(); c.arc(cx2, cy2, cr, 0, Math.PI * 2); c.fill();
                    // Shadow
                    c.fillStyle = 'hsla(0, 0%, 0%, 0.12)';
                    c.beginPath(); c.arc(cx2 + cr * 0.2, cy2 + cr * 0.2, cr * 0.8, 0, Math.PI * 2); c.fill();
                    // Highlight rim
                    c.strokeStyle = 'hsla(0, 0%, 100%, 0.12)';
                    c.lineWidth = Math.max(0.4, cr * 0.12);
                    c.beginPath(); c.arc(cx2, cy2, cr, Math.PI * 0.7, Math.PI * 1.7); c.stroke();
                }
                // Maria (dark plains)
                for (let i = 0; i < 2; i++) {
                    c.fillStyle = `hsla(${b.hue}, ${b.sat}%, ${b.lit - 8}%, 0.15)`;
                    c.beginPath();
                    c.ellipse((rng() - 0.5) * r, (rng() - 0.5) * r, r * (0.25 + rng() * 0.3), r * (0.15 + rng() * 0.2), rng() * Math.PI, 0, Math.PI * 2);
                    c.fill();
                }
                c.restore(); c.restore();

            } else if (type === 'planet') {
                // --- Planet with biomes/bands ---
                c.save(); c.translate(cx, cy);
                c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
                c.fillStyle = `hsl(${b.hue}, ${b.sat}%, ${b.lit}%)`;
                c.fillRect(-r, -r, r * 2, r * 2);
                if (rng() > 0.4) {
                    // Gas giant bands
                    const nb = 6 + Math.floor(rng() * 6);
                    for (let i = 0; i < nb; i++) {
                        const by = -r + (r * 2 * i / nb) + (rng() - 0.5) * r * 0.12;
                        const bh = (r * 2 / nb) * (0.3 + rng() * 0.7);
                        c.fillStyle = `hsla(${b.hue + (rng() - 0.5) * 35}, ${b.sat + rng() * 10}%, ${b.lit + (rng() - 0.5) * 15}%, ${0.2 + rng() * 0.25})`;
                        c.fillRect(-r, by, r * 2, bh);
                    }
                    // Storm spot
                    if (rng() > 0.4) {
                        c.fillStyle = `hsla(${b.hue + 30}, ${b.sat + 15}%, ${b.lit + 10}%, 0.5)`;
                        c.beginPath();
                        c.ellipse((rng() - 0.5) * r * 0.8, (rng() - 0.5) * r * 0.6, r * (0.1 + rng() * 0.12), r * (0.06 + rng() * 0.06), 0, 0, Math.PI * 2);
                        c.fill();
                    }
                } else {
                    // Rocky planet with continents
                    const ncon = 2 + Math.floor(rng() * 3);
                    for (let i = 0; i < ncon; i++) {
                        const cx2 = (rng() - 0.5) * r * 1.2, cy2 = (rng() - 0.5) * r * 1.2;
                        const cr = r * (0.25 + rng() * 0.35);
                        c.fillStyle = `hsla(${b.hue + 40 + rng() * 50}, ${Math.min(80, b.sat + 15)}%, ${b.lit - 5 + rng() * 10}%, 0.5)`;
                        c.beginPath();
                        const np = 7 + Math.floor(rng() * 4);
                        for (let p = 0; p <= np; p++) {
                            const a = (Math.PI * 2 * p) / np;
                            const j = 0.65 + rng() * 0.45;
                            const px = cx2 + Math.cos(a) * cr * j, py = cy2 + Math.sin(a) * cr * j;
                            p === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
                        }
                        c.closePath(); c.fill();
                    }
                    // Ice caps
                    c.fillStyle = 'hsla(200, 15%, 90%, 0.25)';
                    c.beginPath(); c.ellipse(0, -r * 0.85, r * 0.5, r * 0.15, 0, 0, Math.PI * 2); c.fill();
                    c.beginPath(); c.ellipse(0, r * 0.85, r * 0.4, r * 0.12, 0, 0, Math.PI * 2); c.fill();
                }
                // Clouds
                for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
                    c.fillStyle = `hsla(0, 0%, 100%, ${0.06 + rng() * 0.09})`;
                    c.beginPath();
                    c.ellipse((rng() - 0.5) * r * 1.6, (rng() - 0.5) * r * 1.2, r * (0.15 + rng() * 0.4), r * (0.03 + rng() * 0.08), rng() * 0.4, 0, Math.PI * 2);
                    c.fill();
                }
                c.restore();
                // 3D sphere lighting overlay
                c.save(); c.translate(cx, cy);
                const pl = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
                pl.addColorStop(0, 'hsla(0,0%,100%,0.18)');
                pl.addColorStop(0.5, 'hsla(0,0%,100%,0)');
                pl.addColorStop(1, 'hsla(0,0%,0%,0.25)');
                c.fillStyle = pl;
                c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
                c.restore();

            } else if (type === 'star') {
                // --- Star with corona, granulation, sunspots ---
                c.save(); c.translate(cx, cy);
                // Baked corona glow
                const cR = r * 2.2;
                const cg = c.createRadialGradient(0, 0, r * 0.8, 0, 0, cR);
                cg.addColorStop(0, `hsla(${b.hue}, 100%, 80%, 0.3)`);
                cg.addColorStop(0.4, `hsla(${b.hue}, 90%, 60%, 0.06)`);
                cg.addColorStop(1, `hsla(${b.hue}, 80%, 50%, 0)`);
                c.fillStyle = cg;
                c.beginPath(); c.arc(0, 0, cR, 0, Math.PI * 2); c.fill();
                // Surface
                c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
                const sg = c.createRadialGradient(0, 0, 0, 0, 0, r);
                sg.addColorStop(0, `hsl(${b.hue}, 100%, 95%)`);
                sg.addColorStop(0.3, `hsl(${b.hue}, 96%, 78%)`);
                sg.addColorStop(0.7, `hsl(${b.hue}, 92%, 58%)`);
                sg.addColorStop(1, `hsl(${b.hue - 10}, 85%, 42%)`);
                c.fillStyle = sg;
                c.fillRect(-r, -r, r * 2, r * 2);
                // Granulation (convection cells)
                const ng = Math.floor(20 + r * 3);
                for (let i = 0; i < ng; i++) {
                    const gx = (rng() - 0.5) * r * 1.8, gy = (rng() - 0.5) * r * 1.8;
                    const gr = 0.8 + rng() * r * 0.1;
                    c.fillStyle = rng() > 0.5
                        ? `hsla(${b.hue + rng() * 10}, 100%, ${82 + rng() * 13}%, ${0.12 + rng() * 0.15})`
                        : `hsla(${b.hue - 8}, 80%, ${38 + rng() * 12}%, ${0.08 + rng() * 0.12})`;
                    c.beginPath(); c.arc(gx, gy, gr, 0, Math.PI * 2); c.fill();
                }
                // Sunspots
                for (let i = 0; i < Math.floor(rng() * 3); i++) {
                    c.fillStyle = `hsla(${b.hue - 15}, 55%, 22%, 0.35)`;
                    c.beginPath(); c.arc((rng() - 0.5) * r, (rng() - 0.5) * r, r * (0.04 + rng() * 0.08), 0, Math.PI * 2); c.fill();
                }
                c.restore();
            }

            b._tex = oc;
            b._texR = r;
            b._texType = type;
            b._texSize = size;
        }

        state.bodies = [];
        state.particles = [];
        state.effects = []; // flash rings, shockwaves, etc.
        state.rockets = [];  // all in-flight spacecraft
        state.routes = [];   // active trade routes between colonies
        state.factions = FACTIONS.map(f => ({ ...f, colonies: 0 }));
        state.relations = []; // hostility matrix (future)
        // Initialize relations matrix (6x6, all neutral)
        for (let i = 0; i < 6; i++) {
            state.relations[i] = [];
            for (let j = 0; j < 6; j++) state.relations[i][j] = 0;
        }

        // Seed the scene with small colonies that build up like proto-planetary formation
        (function seedScene() {
            const vw = w, vh = h;
            const bodies = state.bodies;

            // Create 5-7 colony clusters spread across the viewport
            const numColonies = 5 + Math.floor(Math.random() * 3);
            const minSep = Math.min(vw, vh) * 0.22; // minimum separation between colonies

            const centers = [];
            for (let c = 0; c < numColonies; c++) {
                // Spread colonies in a ring layout with jitter for natural feel
                const baseAng = (Math.PI * 2 * c / numColonies) + (Math.random() - 0.5) * 0.6;
                const ringR = Math.min(vw, vh) * (0.18 + Math.random() * 0.2);
                let cx = vw / 2 + Math.cos(baseAng) * ringR;
                let cy = vh / 2 + Math.sin(baseAng) * ringR;
                // Clamp to safe area
                const pad = 80;
                cx = Math.max(pad, Math.min(vw - pad, cx));
                cy = Math.max(pad, Math.min(vh - pad, cy));
                centers.push({ x: cx, y: cy });

                // Colony nucleus: a medium asteroid that others orbit around
                const nucleusMass = 12 + Math.random() * 25;
                // Give colony a gentle drift so clusters eventually interact
                const driftVx = (Math.random() - 0.5) * 8;
                const driftVy = (Math.random() - 0.5) * 8;
                bodies.push(createBody(cx, cy, driftVx, driftVy, nucleusMass));

                // Orbiting bodies: 4-7 small asteroids in orbit around the nucleus
                const numOrbiters = 4 + Math.floor(Math.random() * 4);
                for (let i = 0; i < numOrbiters; i++) {
                    const orbAng = (Math.PI * 2 * i / numOrbiters) + (Math.random() - 0.5) * 0.8;
                    const orbR = 35 + Math.random() * 55; // orbit radius 35-90px from center
                    const x = cx + Math.cos(orbAng) * orbR;
                    const y = cy + Math.sin(orbAng) * orbR;
                    const mass = 1 + Math.random() * 7;
                    // Tangential velocity for stable-ish orbit: v = sqrt(G * M * r / (rÂ² + softening))
                    const orbSpeed = Math.sqrt(G * nucleusMass * orbR / (orbR * orbR + 200))
                        * (0.7 + Math.random() * 0.4);
                    const vx = driftVx + (-Math.sin(orbAng)) * orbSpeed + (Math.random() - 0.5) * 3;
                    const vy = driftVy + Math.cos(orbAng) * orbSpeed + (Math.random() - 0.5) * 3;
                    bodies.push(createBody(x, y, vx, vy, mass));
                }
            }

            // Rogue asteroids scattered between colonies (free agents that get captured)
            const numRogues = 10 + Math.floor(Math.random() * 8);
            for (let i = 0; i < numRogues; i++) {
                const x = 60 + Math.random() * (vw - 120);
                const y = 60 + Math.random() * (vh - 120);
                const mass = 1 + Math.random() * 10;
                const vx = (Math.random() - 0.5) * 12;
                const vy = (Math.random() - 0.5) * 12;
                bodies.push(createBody(x, y, vx, vy, mass));
            }
        })();

        function spawnDebris(x, y, count, hue, speedMul) {
            const sm = speedMul || 1;
            for (let i = 0; i < count; i++) {
                const ang = Math.random() * Math.PI * 2;
                const spd = (1 + Math.random() * 1.5) * sm;
                state.particles.push({
                    x, y,
                    vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                    life: 0.5 + Math.random() * 0.7,
                    maxLife: 0.5 + Math.random() * 0.7,
                    r: 0.4 + Math.random() * 1.4,
                    hue: hue + (Math.random() - 0.5) * 30
                });
            }
        }

        // Expanding ring flash effect
        function spawnRing(x, y, maxR, color, duration, width) {
            state.effects.push({
                type: 'ring', x, y, maxR,
                color: color || 'rgba(255,255,255,0.8)',
                duration: duration || 0.5,
                width: width || 2,
                life: duration || 0.5
            });
        }

        // Screen flash
        function spawnFlash(x, y, maxR, color, duration) {
            state.effects.push({
                type: 'flash', x, y, maxR: maxR || 60,
                color: color || 'rgba(255,255,255,0.5)',
                duration: duration || 0.3,
                life: duration || 0.3
            });
        }

        // Type-promotion shockwave + colored flash
        function spawnPromotion(x, y, r, newType) {
            const colors = {
                moon: 'rgba(200,200,220,0.7)',
                planet: 'rgba(80,160,255,0.7)',
                star: 'rgba(255,220,60,0.9)',
                blackhole: 'rgba(160,80,255,0.9)'
            };
            const c = colors[newType] || 'rgba(255,255,255,0.7)';
            spawnRing(x, y, r * 5, c, 0.6, 3);
            spawnFlash(x, y, r * 3, c, 0.25);
            if (newType === 'blackhole') {
                // Extra dramatic: double ring + big debris burst
                spawnRing(x, y, r * 8, 'rgba(100,40,200,0.6)', 0.9, 4);
                spawnRing(x, y, r * 3, 'rgba(255,200,50,0.8)', 0.35, 2);
                spawnDebris(x, y, 30, 270, 2.5);
            } else if (newType === 'star') {
                spawnRing(x, y, r * 6, 'rgba(255,200,50,0.5)', 0.7, 2.5);
                spawnDebris(x, y, 18, 45, 1.5);
            } else {
                spawnDebris(x, y, 12, 200, 1.2);
            }
        }

        // Black hole collapse/supernova effect
        function spawnCollapse(x, y, r) {
            spawnFlash(x, y, r * 6, 'rgba(180,100,255,0.9)', 0.4);
            spawnRing(x, y, r * 10, 'rgba(140,60,255,0.8)', 1.0, 5);
            spawnRing(x, y, r * 7, 'rgba(255,200,80,0.6)', 0.7, 3);
            spawnRing(x, y, r * 14, 'rgba(80,40,160,0.4)', 1.4, 3);
            spawnDebris(x, y, 40, 270, 3);
            spawnDebris(x, y, 20, 40, 2);
        }

        // --- Pointer: hold to grow, drag for slingshot ---
        const pointers = new Map();

        const onDown = (e) => {
            if (e.pointerType !== 'touch') return;
            pointers.set(e.pointerId, {
                sx: e.clientX, sy: e.clientY,
                x: e.clientX, y: e.clientY,
                downTime: performance.now(),
                mass: 1, released: false,
                locked: false // true once dragging starts
            });
        };
        const onMove = (e) => {
            const ptr = pointers.get(e.pointerId);
            if (!ptr || ptr.released) return;
            ptr.x = e.clientX;
            ptr.y = e.clientY;
            // Lock mass once user starts dragging (slingshot)
            if (!ptr.locked) {
                const dx = ptr.x - ptr.sx, dy = ptr.y - ptr.sy;
                if (dx * dx + dy * dy > 20 * 20) ptr.locked = true;
            }
        };
        const onUp = (e) => {
            const ptr = pointers.get(e.pointerId);
            if (!ptr || ptr.released) return;
            ptr.released = true;

            if (state.bodies.length >= MAX_BODIES) { pointers.delete(e.pointerId); return; }

            const mass = ptr.mass;
            // Slingshot: velocity is opposite of drag direction
            const dx = ptr.sx - ptr.x;
            const dy = ptr.sy - ptr.y;
            const pullDist = Math.sqrt(dx * dx + dy * dy);
            const maxPull = 300;
            const strength = Math.min(pullDist / maxPull, 1);
            // Lighter = faster launch (asteroid rockets vs heavy planets)
            const massFactor = 1080 / (1 + Math.pow(mass, 0.45));
            const launchSpeed = strength * massFactor;
            let vx = 0, vy = 0;
            if (pullDist > 5) {
                vx = (dx / pullDist) * launchSpeed;
                vy = (dy / pullDist) * launchSpeed;
            } else {
                vx = (Math.random() - 0.5) * 30;
                vy = (Math.random() - 0.5) * 30;
            }

            const body = createBody(ptr.sx, ptr.sy, vx, vy, mass);
            state.bodies.push(body);
            spawnDebris(ptr.sx, ptr.sy, Math.min(12, Math.floor(mass / 5) + 3), body.hue);

            pointers.delete(e.pointerId);
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);

        // --- Resize ---
        const onResize = () => {
            const vw = window.innerWidth, vh = window.innerHeight;
            canvas.width = Math.round(vw * dpr);
            canvas.height = Math.round(vh * dpr);
            canvas.style.width = vw + 'px';
            canvas.style.height = vh + 'px';
            state._vw = vw; state._vh = vh;
        };
        window.addEventListener('resize', onResize);
        state._vw = w; state._vh = h;
        state._resizeCleanup = () => {
            window.removeEventListener('resize', onResize);
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
        };

        let lastFrame = performance.now();

        function draw() {
            const now = performance.now();
            const dt = Math.min((now - lastFrame) / 1000, 0.05);
            lastFrame = now;
            const vw = state._vw, vh = state._vh;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // --- Grow held pointers (linear stages: equal time per tier) ---
            // Each stage takes STAGE_TIME seconds, progress feels even
            const STAGE_TIME = 3; // seconds per stage
            const massStages = [1, ASTEROID_MAX, MOON_MAX, PLANET_MAX, STAR_MAX, STAR_MAX * 2];
            for (const ptr of pointers.values()) {
                if (ptr.released || ptr.locked) continue;
                const elapsed = (now - ptr.downTime) / 1000;
                const stageProgress = elapsed / STAGE_TIME; // 0-1 = asteroid, 1-2 = moon, etc.
                const idx = Math.min(Math.floor(stageProgress), massStages.length - 2);
                const frac = stageProgress - idx;
                ptr.mass = massStages[idx] + (massStages[idx + 1] - massStages[idx]) * Math.min(frac, 1);
            }

            const bodies = state.bodies;

            // --- N-body gravity ---
            for (let i = 0; i < bodies.length; i++) {
                const a = bodies[i];
                for (let j = i + 1; j < bodies.length; j++) {
                    const b = bodies[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const distSq = dx * dx + dy * dy;
                    const dist = Math.sqrt(distSq) + 2;
                    const force = G * a.mass * b.mass / (distSq + 200);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    a.vx += (fx / a.mass) * dt;
                    a.vy += (fy / a.mass) * dt;
                    b.vx -= (fx / b.mass) * dt;
                    b.vy -= (fy / b.mass) * dt;
                }
            }

            // --- Integrate (mass-dependent speed: lighter = faster) ---
            for (const b of bodies) {
                // Max speed cap inversely proportional to mass (px/s)
                const maxSpd = 1800 / (1 + Math.pow(b.mass, 0.4));
                const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                if (spd > maxSpd) {
                    b.vx = (b.vx / spd) * maxSpd;
                    b.vy = (b.vy / spd) * maxSpd;
                }
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                const margin = b.r + 40;
                if (b.x < -margin) b.x = vw + margin;
                if (b.x > vw + margin) b.x = -margin;
                if (b.y < -margin) b.y = vh + margin;
                if (b.y > vh + margin) b.y = -margin;
            }

            // --- Black holes only grow, no evaporation ---
            // (Black holes are permanent and terrifying)

            // --- Update colonies (every frame, dt-scaled) ---
            for (const b of bodies) {
                if (b.civ) updateColony(b, dt);
            }

            // --- Manage trade routes (every 3s) ---
            state._routeTimer = (state._routeTimer || 0) + dt;
            if (state._routeTimer >= 3) {
                state._routeTimer = 0;
                manageRoutes();
            }
            updateRoutes(dt);
            updateRelations(dt);
            updateCosmicEvents(dt, bodies);
            updateMegaStructures(dt, bodies);
            handleDestruction(bodies, dt);

            // --- Update rockets (gravity, thrust, arrival, collision) ---
            updateRockets(dt, bodies);

            // --- Merge / Shatter ---
            outer: for (let i = bodies.length - 1; i >= 0; i--) {
                const a = bodies[i];
                for (let j = i - 1; j >= 0; j--) {
                    const b = bodies[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < (a.r + b.r) * MERGE_FACTOR) {
                        const big = a.mass >= b.mass ? a : b;
                        const small = a.mass >= b.mass ? b : a;
                        const bigType = bodyType(big.mass);
                        const smallType = bodyType(small.mass);

                        // Relative impact speed
                        const rvx = a.vx - b.vx, rvy = a.vy - b.vy;
                        const impactSpeed = Math.sqrt(rvx * rvx + rvy * rvy);
                        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;

                        // High-speed shattering (only for asteroid/moon, planets+ are too massive)
                        const shatterTypes = ['asteroid', 'moon'];
                        if (impactSpeed > SHATTER_SPEED && shatterTypes.includes(bigType) && shatterTypes.includes(smallType)) {
                            const totalMass = big.mass + small.mass;
                            // More fragments, spread apart from center
                            const numFrags = Math.min(14, Math.floor(totalMass / 1.2) + 3);
                            const fragMass = Math.min(ASTEROID_MAX * 0.8, Math.max(0.5, totalMass / numFrags));
                            // Remove both
                            const idxA = bodies.indexOf(a), idxB = bodies.indexOf(b);
                            if (idxA > idxB) { bodies.splice(idxA, 1); bodies.splice(idxB, 1); }
                            else { bodies.splice(idxB, 1); bodies.splice(idxA, 1); }
                            // Spawn fragments with initial separation (pushed apart)
                            const avgR = massToRadius(fragMass);
                            for (let f = 0; f < numFrags && bodies.length < MAX_BODIES; f++) {
                                const ang = (Math.PI * 2 * f / numFrags) + (Math.random() - 0.5) * 0.5;
                                const spd = 180 + Math.random() * impactSpeed * 0.5;
                                const sep = avgR * 2 + Math.random() * 8; // start already separated
                                const fb = createBody(
                                    cx + Math.cos(ang) * sep, cy + Math.sin(ang) * sep,
                                    Math.cos(ang) * spd + (a.vx + b.vx) * 0.25,
                                    Math.sin(ang) * spd + (a.vy + b.vy) * 0.25,
                                    fragMass * (0.6 + Math.random() * 0.8)
                                );
                                bodies.push(fb);
                            }
                            // Impact flash + ring
                            spawnFlash(cx, cy, Math.max(big.r, small.r) * 2.5, 'rgba(255,200,100,0.8)', 0.25);
                            spawnRing(cx, cy, Math.max(big.r, small.r) * 4, 'rgba(255,180,80,0.6)', 0.5, 2);
                            spawnDebris(cx, cy, 18, 35, 2);
                            break outer;
                        }

                        // Normal merge
                        const totalM = big.mass + small.mass;
                        big.vx = (big.vx * big.mass + small.vx * small.mass) / totalM;
                        big.vy = (big.vy * big.mass + small.vy * small.mass) / totalM;

                        const oldType = bodyType(big.mass);
                        big.mass = totalM;
                        big.r = massToRadius(totalM);
                        const newType = bodyType(big.mass);

                        // Type evolution: dramatic promotion effects
                        if (newType !== oldType) {
                            const c = pickColor(big.mass);
                            big.hue = c.hue; big.sat = c.sat; big.lit = c.lit;
                            big.seed = Math.floor(Math.random() * 2147483647); // new texture
                            spawnPromotion(big.x, big.y, big.r, newType);

                            // Colony genesis: when a body becomes a planet, civilization emerges!
                            if (newType === 'planet' && !big.civ) {
                                initColony(big);
                            }

                            // Colony destruction: stars/BH burn away civilizations
                            if ((newType === 'star' || newType === 'blackhole') && big.civ) {
                                big.civ = null;
                            }

                            // Black hole collapse: if BH + BH merge or BH too big, mega event
                            if (newType === 'blackhole' && oldType === 'star') {
                                spawnCollapse(big.x, big.y, big.r);
                            }
                        }
                        // BH + BH merge = mega collapse
                        if (bigType === 'blackhole' && smallType === 'blackhole') {
                            spawnCollapse(big.x, big.y, big.r);
                        }
                        // Star + Star merge = nuclear star!
                        if (bigType === 'star' && smallType === 'star') {
                            markNuclearStar(big);
                        }

                        // Transfer colony from small to big if small had one and big doesn't
                        if (small.civ && !big.civ && bodyType(big.mass) === 'planet') {
                            big.civ = small.civ;
                        } else if (small.civ && big.civ) {
                            // Both colonized: big absorbs population
                            big.civ.population += small.civ.population * 0.3;
                            big.civ.resources += small.civ.resources * 0.5;
                        }

                        // Impact flash for any merge
                        spawnFlash(cx, cy, Math.max(big.r, small.r) * 1.5, 'rgba(255,255,255,0.4)', 0.15);
                        spawnDebris(cx, cy, 6, big.hue, 1);

                        const removeIdx = bodies.indexOf(small);
                        if (removeIdx >= 0) bodies.splice(removeIdx, 1);
                        break outer;
                    }
                }
            }

            // --- Update debris ---
            for (let i = state.particles.length - 1; i >= 0; i--) {
                const p = state.particles[i];
                p.x += p.vx * dt * 60;
                p.y += p.vy * dt * 60;
                p.vx *= Math.pow(0.96, dt * 60);
                p.vy *= Math.pow(0.96, dt * 60);
                p.life -= dt;
                if (p.life <= 0) state.particles.splice(i, 1);
            }

            // --- Update effects (rings, flashes) ---
            for (let i = state.effects.length - 1; i >= 0; i--) {
                state.effects[i].life -= dt;
                if (state.effects[i].life <= 0) state.effects.splice(i, 1);
            }

            // ===== DRAW =====

            // Debris
            for (const p of state.particles) {
                const t = p.life / p.maxLife;
                ctx.globalAlpha = t * 0.7;
                ctx.fillStyle = `hsl(${p.hue}, 80%, ${55 + (1 - t) * 30}%)`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r * (0.3 + t * 0.7), 0, Math.PI * 2);
                ctx.fill();
            }

            // Effects (rings + flashes)
            for (const ef of state.effects) {
                const t = 1 - ef.life / ef.duration; // 0â†’1 progress
                if (ef.type === 'ring') {
                    const curR = ef.maxR * t;
                    ctx.globalAlpha = (1 - t) * 0.8;
                    ctx.strokeStyle = ef.color;
                    ctx.lineWidth = ef.width * (1 - t * 0.6);
                    ctx.beginPath();
                    ctx.arc(ef.x, ef.y, curR, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (ef.type === 'flash') {
                    const curR = ef.maxR * (0.3 + t * 0.7);
                    ctx.globalAlpha = (1 - t) * 0.6;
                    ctx.globalCompositeOperation = 'screen';
                    const fg = ctx.createRadialGradient(ef.x, ef.y, 0, ef.x, ef.y, curR);
                    fg.addColorStop(0, ef.color);
                    fg.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = fg;
                    ctx.beginPath();
                    ctx.arc(ef.x, ef.y, curR, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalCompositeOperation = 'source-over';
                }
            }

            // Gravity lines
            ctx.lineWidth = 0.4;
            for (let i = 0; i < bodies.length; i++) {
                const a = bodies[i];
                for (let j = i + 1; j < bodies.length; j++) {
                    const b = bodies[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxD = 100 + (a.r + b.r) * 2.5;
                    if (dist < maxD) {
                        const t = 1 - dist / maxD;
                        const isBH = bodyType(a.mass) === 'blackhole' || bodyType(b.mass) === 'blackhole';
                        ctx.globalAlpha = t * t * 0.12;
                        ctx.strokeStyle = isBH ? 'rgba(140, 80, 255, 1)' : 'rgba(200, 210, 255, 1)';
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
            }

            // Bodies
            for (const b of bodies) {
                const type = bodyType(b.mass);

                if (type === 'blackhole') {
                    // --- Enhanced animated black hole ---
                    b.bhTime = (b.bhTime || 0) + dt;
                    const t = b.bhTime;
                    ctx.save();
                    ctx.translate(b.x, b.y);

                    // Outer gravitational distortion field
                    ctx.globalCompositeOperation = 'screen';
                    const distR = b.r * 5;
                    const dg = ctx.createRadialGradient(0, 0, b.r * 0.4, 0, 0, distR);
                    dg.addColorStop(0, 'rgba(120, 60, 220, 0.15)');
                    dg.addColorStop(0.25, 'rgba(80, 40, 180, 0.08)');
                    dg.addColorStop(0.6, 'rgba(40, 20, 120, 0.03)');
                    dg.addColorStop(1, 'rgba(20, 10, 60, 0)');
                    ctx.globalAlpha = 0.6;
                    ctx.fillStyle = dg;
                    ctx.beginPath(); ctx.arc(0, 0, distR, 0, Math.PI * 2); ctx.fill();

                    // Swirling particle streaks (orbiting matter)
                    const nStreaks = 16;
                    for (let s = 0; s < nStreaks; s++) {
                        const baseAng = (Math.PI * 2 * s / nStreaks) + t * (1.5 + (s % 3) * 0.3);
                        const orbitR = b.r * (0.8 + (s % 4) * 0.4 + Math.sin(t * 2 + s) * 0.15);
                        const streakLen = 0.3 + (s % 3) * 0.15;
                        const sx = Math.cos(baseAng) * orbitR;
                        const sy = Math.sin(baseAng) * orbitR * 0.3; // flattened orbit
                        const ex = Math.cos(baseAng - streakLen) * orbitR;
                        const ey = Math.sin(baseAng - streakLen) * orbitR * 0.3;
                        const hue = s % 3 === 0 ? 40 : s % 3 === 1 ? 20 : 275;
                        const lit = 50 + (s % 4) * 10;
                        ctx.globalAlpha = 0.25 + Math.sin(t * 3 + s * 0.7) * 0.1;
                        ctx.strokeStyle = `hsl(${hue}, 90%, ${lit}%)`;
                        ctx.lineWidth = 0.8 + (s % 3) * 0.4;
                        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
                    }

                    // Accretion disk rings (spinning ellipses)
                    for (let ring = 0; ring < 4; ring++) {
                        const rr = b.r * (1.1 + ring * 0.55);
                        const rw = b.r * (0.10 + ring * 0.05);
                        ctx.save();
                        ctx.rotate(t * (3.5 - ring * 0.5) * 0.5 + ring * 0.8);
                        ctx.scale(1, 0.25);
                        ctx.globalAlpha = 0.35 - ring * 0.06;
                        const diskHue = ring === 0 ? 38 + Math.sin(t * 3) * 5
                            : ring === 1 ? 25 : ring === 2 ? 280 : 260;
                        const diskLit = ring < 2 ? 68 + Math.sin(t * 4) * 6 : 42;
                        ctx.strokeStyle = `hsl(${diskHue}, 95%, ${diskLit}%)`;
                        ctx.lineWidth = rw;
                        ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
                        ctx.restore();
                    }

                    // Bright photon ring (innermost)
                    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 7);
                    ctx.strokeStyle = `hsla(45, 100%, ${78 + Math.sin(t * 5) * 5}%, 0.8)`;
                    ctx.lineWidth = 1.5;
                    ctx.save(); ctx.scale(1, 0.25);
                    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.95, 0, Math.PI * 2); ctx.stroke();
                    ctx.restore();

                    // Gravitational lensing arcs (bright arcs at edges)
                    for (let la = 0; la < 2; la++) {
                        const lAng = t * 0.4 + la * Math.PI;
                        ctx.globalAlpha = 0.12 + 0.05 * Math.sin(t * 3 + la);
                        ctx.strokeStyle = 'hsla(40, 100%, 80%, 0.6)';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(0, 0, b.r * 0.7, lAng - 0.4, lAng + 0.4);
                        ctx.stroke();
                    }

                    ctx.globalCompositeOperation = 'source-over';

                    // Event horizon (pure black center with sharp edge)
                    ctx.globalAlpha = 1;
                    const ehGrad = ctx.createRadialGradient(0, 0, b.r * 0.3, 0, 0, b.r * 0.6);
                    ehGrad.addColorStop(0, '#000');
                    ehGrad.addColorStop(0.8, '#000');
                    ehGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
                    ctx.fillStyle = ehGrad;
                    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.6, 0, Math.PI * 2); ctx.fill();

                    // Purple edge glow
                    const eg = ctx.createRadialGradient(0, 0, b.r * 0.5, 0, 0, b.r * 0.85);
                    eg.addColorStop(0, 'rgba(0,0,0,0)');
                    eg.addColorStop(0.5, 'rgba(0,0,0,0)');
                    eg.addColorStop(0.8, 'rgba(100, 50, 220, 0.18)');
                    eg.addColorStop(1, 'rgba(140, 70, 255, 0)');
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = eg;
                    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.85, 0, Math.PI * 2); ctx.fill();

                    ctx.restore();

                } else {
                    // Pre-baked textured rendering for asteroid/moon/planet/star
                    if (!b._tex || b._texType !== type || Math.abs(b._texR - b.r) > 0.5) {
                        generateBodyTexture(b);
                    }

                    // Planet atmosphere glow (real-time)
                    if (type === 'planet') {
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = 0.1;
                        const atmo = ctx.createRadialGradient(b.x, b.y, b.r * 0.7, b.x, b.y, b.r * 1.6);
                        atmo.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, ${b.lit + 15}%, 0.35)`);
                        atmo.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.lit}%, 0)`);
                        ctx.fillStyle = atmo;
                        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.6, 0, Math.PI * 2); ctx.fill();
                        ctx.globalCompositeOperation = 'source-over';
                    }

                    // Star animated corona pulse
                    if (type === 'star') {
                        b.bhTime = (b.bhTime || 0) + dt;
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = 0.1 + 0.05 * Math.sin(b.bhTime * 4);
                        const pulse = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 3.5);
                        pulse.addColorStop(0, `hsla(${b.hue}, 100%, 85%, 0.5)`);
                        pulse.addColorStop(0.4, `hsla(${b.hue}, 90%, 60%, 0.15)`);
                        pulse.addColorStop(1, `hsla(${b.hue}, 80%, 50%, 0)`);
                        ctx.fillStyle = pulse;
                        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3.5, 0, Math.PI * 2); ctx.fill();
                        ctx.globalCompositeOperation = 'source-over';
                    }

                    ctx.globalAlpha = 1;
                    ctx.drawImage(b._tex, b.x - b._texSize / 2, b.y - b._texSize / 2);
                }
            }

            // --- Draw settlements on colonized bodies ---
            for (const b of bodies) {
                if (b.civ) drawSettlements(ctx, b, now / 1000);
            }

            // --- Draw trade routes (dashed arcs) ---
            drawRoutes(ctx);

            // --- Draw rockets (trails + ships) ---
            drawRockets(ctx, now / 1000);

            // --- Draw cosmic events (meteors, flares) ---
            drawCosmicEvent(ctx);
            drawStarHazards(ctx, bodies, dt);
            drawMegaStructures(ctx, bodies, now / 1000);
            drawDestructionEffects(ctx, bodies, now / 1000);

            // --- Draw hold preview (growing body + slingshot + progress ring) ---
            for (const ptr of pointers.values()) {
                if (ptr.released) continue;
                const mass = ptr.mass;
                const r = massToRadius(mass);
                const type = bodyType(mass);
                const dx = ptr.sx - ptr.x;
                const dy = ptr.sy - ptr.y;
                const pullDist = Math.sqrt(dx * dx + dy * dy);

                // Slingshot line
                if (pullDist > 8) {
                    ctx.globalAlpha = 0.3;
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(ptr.sx, ptr.sy);
                    ctx.lineTo(ptr.x, ptr.y);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    const norm = Math.min(pullDist, 200);
                    const arrowLen = 10 + norm * 0.15;
                    const ax = ptr.sx + (dx / pullDist) * arrowLen;
                    const ay = ptr.sy + (dy / pullDist) * arrowLen;
                    ctx.globalAlpha = 0.4;
                    ctx.fillStyle = '#fff';
                    ctx.beginPath();
                    ctx.arc(ax, ay, 3, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Preview body
                if (type === 'blackhole') {
                    ctx.globalAlpha = 0.5;
                    ctx.fillStyle = '#000';
                    ctx.beginPath();
                    ctx.arc(ptr.sx, ptr.sy, r * 0.7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 0.4;
                    ctx.strokeStyle = 'rgba(180, 100, 255, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(ptr.sx, ptr.sy, r, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (type === 'star') {
                    ctx.globalAlpha = 0.6;
                    ctx.fillStyle = `hsl(45, 95%, 65%)`;
                    ctx.beginPath();
                    ctx.arc(ptr.sx, ptr.sy, r, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.globalAlpha = 0.5;
                    ctx.fillStyle = type === 'asteroid'
                        ? 'rgba(140, 130, 110, 0.7)'
                        : type === 'moon'
                        ? 'rgba(200, 200, 210, 0.7)'
                        : 'rgba(100, 170, 220, 0.7)';
                    ctx.beginPath();
                    ctx.arc(ptr.sx, ptr.sy, r, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Progress ring to next stage
                const thresholds = [ASTEROID_MAX, MOON_MAX, PLANET_MAX, STAR_MAX];
                const stageColors = ['rgba(200,200,210,0.7)', 'rgba(100,170,220,0.7)', 'rgba(220,180,60,0.7)', 'rgba(180,100,255,0.7)'];
                let prevT = 0, nextT = thresholds[0], stageIdx = 0;
                for (let s = 0; s < thresholds.length; s++) {
                    if (mass > thresholds[s]) {
                        prevT = thresholds[s];
                        nextT = s + 1 < thresholds.length ? thresholds[s + 1] : thresholds[s] * 2;
                        stageIdx = s + 1;
                    }
                }
                const progress = Math.min(1, (mass - prevT) / (nextT - prevT));
                const ringR = r + 6;
                ctx.globalAlpha = 0.6;
                // Background ring
                ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(ptr.sx, ptr.sy, ringR, 0, Math.PI * 2);
                ctx.stroke();
                // Progress arc
                ctx.strokeStyle = stageIdx < stageColors.length ? stageColors[stageIdx] : 'rgba(180,100,255,0.7)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(ptr.sx, ptr.sy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                ctx.stroke();

                // Type label
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = '#fff';
                ctx.font = '12px system-ui';
                ctx.textAlign = 'center';
                const label = type === 'blackhole' ? 'black hole' : type;
                ctx.fillText(label, ptr.sx, ptr.sy - ringR - 5);
            }

            ctx.globalAlpha = 1;
            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // Expose globally for 32_toolbox.js to call
    window.initGravityScene = initGravityScene;
})();
