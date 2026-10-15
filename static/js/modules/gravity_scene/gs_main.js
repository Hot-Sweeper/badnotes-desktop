/* gs_main.js — Orchestrator: state init, seedScene, pointer input, resize, draw loop
   Requires: gs_constants, gs_helpers, gs_effects, gs_colonies, gs_rockets,
             gs_trade, gs_diplomacy, gs_cosmic, gs_star_hazards,
             gs_mega_structures, gs_destruction */
(function () {
    'use strict';
    const GS = window.GS;

    function initGravityScene(ctx, w, h, state, canvas, toolData) {
        const dpr = toolData?.dpr || window.devicePixelRatio || 1;

        // Expose to all modules
        GS.state = state;
        GS.ctx = ctx;
        GS.canvas = canvas;
        GS.dpr = dpr;

        // Local aliases for hot-path constants
        const { G, MAX_BODIES, MERGE_FACTOR, SHATTER_SPEED,
                CRUSH_MOON_SPEED, CRUSH_PLANET_SPEED,
                ASTEROID_MAX, MOON_MAX, PLANET_MAX, STAR_MAX } = GS;

        // --- State initialization ---
        state.bodies = [];
        state.particles = [];
        state.effects = [];
        state.rockets = [];
        state.routes = [];
        state.factions = GS.FACTIONS.map(f => ({ ...f, colonies: 0 }));
        state.relations = [];
        const numFactions = GS.FACTIONS.length;
        for (let i = 0; i < numFactions; i++) {
            state.relations[i] = [];
            for (let j = 0; j < numFactions; j++) state.relations[i][j] = 0;
        }

        // --- Seed scene: colony clusters + rogues ---
        (function seedScene() {
            const vw = w, vh = h;
            const bodies = state.bodies;
            const numColonies = 5 + Math.floor(Math.random() * 3);
            const centers = [];
            for (let c = 0; c < numColonies; c++) {
                const baseAng = (Math.PI * 2 * c / numColonies) + (Math.random() - 0.5) * 0.6;
                const ringR = Math.min(vw, vh) * (0.18 + Math.random() * 0.2);
                let cx = vw / 2 + Math.cos(baseAng) * ringR;
                let cy = vh / 2 + Math.sin(baseAng) * ringR;
                const pad = 80;
                cx = Math.max(pad, Math.min(vw - pad, cx));
                cy = Math.max(pad, Math.min(vh - pad, cy));
                centers.push({ x: cx, y: cy });

                const nucleusMass = 12 + Math.random() * 25;
                const driftVx = (Math.random() - 0.5) * 8;
                const driftVy = (Math.random() - 0.5) * 8;
                bodies.push(GS.createBody(cx, cy, driftVx, driftVy, nucleusMass));

                const numOrbiters = 4 + Math.floor(Math.random() * 4);
                for (let i = 0; i < numOrbiters; i++) {
                    const orbAng = (Math.PI * 2 * i / numOrbiters) + (Math.random() - 0.5) * 0.8;
                    const orbR = 35 + Math.random() * 55;
                    const x = cx + Math.cos(orbAng) * orbR;
                    const y = cy + Math.sin(orbAng) * orbR;
                    const mass = 1 + Math.random() * 7;
                    const orbSpeed = Math.sqrt(G * nucleusMass * orbR / (orbR * orbR + 200))
                        * (0.7 + Math.random() * 0.4);
                    const vx = driftVx + (-Math.sin(orbAng)) * orbSpeed + (Math.random() - 0.5) * 3;
                    const vy = driftVy + Math.cos(orbAng) * orbSpeed + (Math.random() - 0.5) * 3;
                    bodies.push(GS.createBody(x, y, vx, vy, mass));
                }
            }

            const numRogues = 10 + Math.floor(Math.random() * 8);
            for (let i = 0; i < numRogues; i++) {
                const x = 60 + Math.random() * (vw - 120);
                const y = 60 + Math.random() * (vh - 120);
                const mass = 1 + Math.random() * 10;
                const vx = (Math.random() - 0.5) * 12;
                const vy = (Math.random() - 0.5) * 12;
                bodies.push(GS.createBody(x, y, vx, vy, mass));
            }
        })();

        // --- Pointer: hold to grow, drag for slingshot; tap to select ---
        const pointers = new Map();

        const onDown = (e) => {
            if (e.pointerType !== 'touch') return;
            pointers.set(e.pointerId, {
                sx: e.clientX, sy: e.clientY,
                x: e.clientX, y: e.clientY,
                downTime: performance.now(),
                mass: 5, released: false,
                locked: false
            });
        };
        const onMove = (e) => {
            const ptr = pointers.get(e.pointerId);
            if (!ptr || ptr.released) return;
            ptr.x = e.clientX;
            ptr.y = e.clientY;
            if (!ptr.locked) {
                const dx = ptr.x - ptr.sx, dy = ptr.y - ptr.sy;
                if (dx * dx + dy * dy > 20 * 20) ptr.locked = true;
            }
        };
        const onUp = (e) => {
            const ptr = pointers.get(e.pointerId);
            if (!ptr || ptr.released) return;
            ptr.released = true;

            // --- Zoom view click intercept ---
            if (GS.zoomActive && GS.handleZoomClick(ptr.x, ptr.y)) {
                pointers.delete(e.pointerId);
                return;
            }

            // Tap detection: short hold + no drag = select body OR spawn asteroid
            const holdTime = (performance.now() - ptr.downTime) / 1000;
            const tapDx = ptr.x - ptr.sx, tapDy = ptr.y - ptr.sy;
            const tapDist = Math.sqrt(tapDx * tapDx + tapDy * tapDy);
            if (holdTime < 0.3 && tapDist < 15) {
                // If zoom is active, ignore taps (except the back button above)
                if (GS.zoomActive) {
                    pointers.delete(e.pointerId);
                    return;
                }

                // Check if inspect button was tapped
                const ibtn = GS._inspectBtnBounds;
                if (ibtn && GS.selectedBody &&
                    ptr.x >= ibtn.x && ptr.x <= ibtn.x + ibtn.w &&
                    ptr.y >= ibtn.y && ptr.y <= ibtn.y + ibtn.h) {
                    GS.enterZoom(GS.selectedBody);
                    pointers.delete(e.pointerId);
                    return;
                }

                // Tap — try to select a body first
                const hit = GS.hitTestBody(ptr.sx, ptr.sy);
                if (hit) {
                    GS.selectedBody = (hit === GS.selectedBody) ? null : hit;
                    pointers.delete(e.pointerId);
                    return;
                }
                // No body hit — spawn a small asteroid at tap location
                if (state.bodies.length < MAX_BODIES) {
                    const b = GS.createBody(ptr.sx, ptr.sy,
                        (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 5);
                    state.bodies.push(b);
                    GS.spawnFlash(ptr.sx, ptr.sy, 8, 'rgba(255,255,255,0.3)', 0.15);
                }
                pointers.delete(e.pointerId);
                return;
            }

            // Block slingshot spawn while zoomed
            if (GS.zoomActive) { pointers.delete(e.pointerId); return; }
            if (state.bodies.length >= MAX_BODIES) { pointers.delete(e.pointerId); return; }
            const mass = Math.max(ptr.mass, 5);
            const dx = ptr.sx - ptr.x;
            const dy = ptr.sy - ptr.y;
            const pullDist = Math.sqrt(dx * dx + dy * dy);
            const maxPull = 300;
            const strength = Math.min(pullDist / maxPull, 1);
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

            const body = GS.createBody(ptr.sx, ptr.sy, vx, vy, mass);
            // Initialize colony on user-spawned planets
            if (GS.bodyType(mass) === 'planet') {
                GS.initColony(body);
                if (!body._rings && Math.random() < 0.35) GS.assignRings(body);
            }
            state.bodies.push(body);
            GS.spawnDebris(ptr.sx, ptr.sy, Math.min(12, Math.floor(mass / 5) + 3), body.hue);
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
            const STAGE_TIME = 3;
            const massStages = [5, ASTEROID_MAX, MOON_MAX, PLANET_MAX, STAR_MAX, STAR_MAX * 2];
            for (const ptr of pointers.values()) {
                if (ptr.released || ptr.locked) continue;
                const elapsed = (now - ptr.downTime) / 1000;
                const stageProgress = elapsed / STAGE_TIME;
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

            // --- Integrate (mass-dependent speed caps) ---
            for (const b of bodies) {
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

            // --- Update colonies ---
            for (const b of bodies) {
                if (b.civ) GS.updateColony(b, dt);
            }

            // --- Manage trade routes (every 3s) ---
            state._routeTimer = (state._routeTimer || 0) + dt;
            if (state._routeTimer >= 3) {
                state._routeTimer = 0;
                GS.manageRoutes();
            }
            GS.updateRoutes(dt);
            GS.updateRelations(dt);
            GS.updateCosmicEvents(dt, bodies);
            GS.updateMegaStructures(dt, bodies);
            GS.handleDestruction(bodies, dt);
            GS.updateRockets(dt, bodies);
            GS.updateOrbits(dt, bodies);

            // --- Random edge asteroid spawning (keeps the system alive) ---
            state._edgeSpawnTimer = (state._edgeSpawnTimer || 0) + dt;
            if (state._edgeSpawnTimer > 2 && bodies.length < MAX_BODIES - 5) {
                state._edgeSpawnTimer = 0;
                if (Math.random() < 0.4) {
                    const side = Math.floor(Math.random() * 4);
                    let sx, sy, svx, svy;
                    const mass = 5 + Math.random() * ASTEROID_MAX * 0.7;
                    const inSpeed = 20 + Math.random() * 60;
                    if (side === 0) { sx = -10; sy = Math.random() * vh; svx = inSpeed; svy = (Math.random() - 0.5) * 30; }
                    else if (side === 1) { sx = vw + 10; sy = Math.random() * vh; svx = -inSpeed; svy = (Math.random() - 0.5) * 30; }
                    else if (side === 2) { sx = Math.random() * vw; sy = -10; svx = (Math.random() - 0.5) * 30; svy = inSpeed; }
                    else { sx = Math.random() * vw; sy = vh + 10; svx = (Math.random() - 0.5) * 30; svy = -inSpeed; }
                    bodies.push(GS.createBody(sx, sy, svx, svy, mass));
                }
            }

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
                        const bigType = GS.bodyType(big.mass);
                        const smallType = GS.bodyType(small.mass);
                        const rvx = a.vx - b.vx, rvy = a.vy - b.vy;
                        const impactSpeed = Math.sqrt(rvx * rvx + rvy * rvy);
                        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;

                        // *** BH + BH collision: mutual annihilation — BOTH collapse ***
                        if (bigType === 'blackhole' && smallType === 'blackhole') {
                            const maxR = Math.max(big.r, small.r);
                            GS.spawnCollapse(cx, cy, maxR);
                            GS.spawnCollapse(cx, cy, maxR * 0.6);
                            GS.spawnFlash(cx, cy, maxR * 8, 'rgba(200,120,255,0.95)', 0.5);
                            GS.spawnRing(cx, cy, maxR * 16, 'rgba(160,80,255,0.7)', 1.2, 5);
                            GS.spawnDebris(cx, cy, 50, 270, 4);
                            GS.spawnDebris(cx, cy, 30, 40, 3);
                            GS.clearOrbitalsOf(a); GS.clearOrbitalsOf(b);
                            // Destroy BOTH black holes
                            const idxA = bodies.indexOf(a), idxB = bodies.indexOf(b);
                            if (idxA > idxB) { bodies.splice(idxA, 1); bodies.splice(idxB, 1); }
                            else { bodies.splice(idxB, 1); bodies.splice(idxA, 1); }
                            break outer;
                        }

                        // *** Fast asteroid crushes moon into multiple asteroids ***
                        if (impactSpeed > CRUSH_MOON_SPEED && bigType === 'moon' && smallType === 'asteroid') {
                            const numFrags = Math.min(10, 3 + Math.floor(big.mass / 30));
                            // Spawn refugee escape pods from moon colony before destruction
                            if (big.civ) {
                                GS.spawnRefugees(cx, cy, big.civ, (a.vx + b.vx) * 0.5, (a.vy + b.vy) * 0.5);
                            }
                            GS.clearOrbitalsOf(a); GS.clearOrbitalsOf(b);
                            const idxA = bodies.indexOf(a), idxB = bodies.indexOf(b);
                            if (idxA > idxB) { bodies.splice(idxA, 1); bodies.splice(idxB, 1); }
                            else { bodies.splice(idxB, 1); bodies.splice(idxA, 1); }
                            for (let f = 0; f < numFrags && bodies.length < MAX_BODIES; f++) {
                                const ang = (Math.PI * 2 * f / numFrags) + (Math.random() - 0.5) * 0.5;
                                const spd = 140 + Math.random() * impactSpeed * 0.4;
                                const fragMass = 3 + Math.random() * ASTEROID_MAX * 0.6;
                                const sep = GS.massToRadius(fragMass) * 2 + Math.random() * 6;
                                const fb = GS.createBody(
                                    cx + Math.cos(ang) * sep, cy + Math.sin(ang) * sep,
                                    Math.cos(ang) * spd + (a.vx + b.vx) * 0.2,
                                    Math.sin(ang) * spd + (a.vy + b.vy) * 0.2,
                                    fragMass
                                );
                                bodies.push(fb);
                            }
                            GS.spawnFlash(cx, cy, big.r * 3, 'rgba(255,180,80,0.9)', 0.35);
                            GS.spawnRing(cx, cy, big.r * 5, 'rgba(255,160,60,0.7)', 0.6, 2);
                            GS.spawnDebris(cx, cy, 20, 30, 2);
                            break outer;
                        }

                        // *** Fast moon crushes planet into big asteroids — colony extinction ***
                        if (impactSpeed > CRUSH_PLANET_SPEED && bigType === 'planet' && smallType === 'moon') {
                            const numFrags = Math.min(14, 5 + Math.floor(big.mass / 80));
                            // Spawn refugee escape pods from colonies before destruction
                            if (big.civ) {
                                GS.spawnRefugees(cx, cy, big.civ, (a.vx + b.vx) * 0.5, (a.vy + b.vy) * 0.5);
                            }
                            if (small.civ) {
                                GS.spawnRefugees(cx, cy, small.civ, (a.vx + b.vx) * 0.5, (a.vy + b.vy) * 0.5);
                            }
                            GS.clearOrbitalsOf(a); GS.clearOrbitalsOf(b);
                            const idxA = bodies.indexOf(a), idxB = bodies.indexOf(b);
                            if (idxA > idxB) { bodies.splice(idxA, 1); bodies.splice(idxB, 1); }
                            else { bodies.splice(idxB, 1); bodies.splice(idxA, 1); }
                            for (let f = 0; f < numFrags && bodies.length < MAX_BODIES; f++) {
                                const ang = (Math.PI * 2 * f / numFrags) + (Math.random() - 0.5) * 0.5;
                                const spd = 120 + Math.random() * impactSpeed * 0.35;
                                // Big asteroids — upper half of asteroid mass range
                                const fragMass = ASTEROID_MAX * (0.4 + Math.random() * 0.55);
                                const sep = GS.massToRadius(fragMass) * 2 + Math.random() * 10;
                                const fb = GS.createBody(
                                    cx + Math.cos(ang) * sep, cy + Math.sin(ang) * sep,
                                    Math.cos(ang) * spd + (a.vx + b.vx) * 0.2,
                                    Math.sin(ang) * spd + (a.vy + b.vy) * 0.2,
                                    fragMass
                                );
                                bodies.push(fb);
                            }
                            GS.spawnFlash(cx, cy, big.r * 4, 'rgba(255,120,40,0.95)', 0.5);
                            GS.spawnRing(cx, cy, big.r * 6, 'rgba(255,100,30,0.8)', 0.8, 3);
                            GS.spawnRing(cx, cy, big.r * 4, 'rgba(255,200,80,0.5)', 0.4, 2);
                            GS.spawnDebris(cx, cy, 30, 25, 3);
                            break outer;
                        }

                        // High-speed shattering (asteroid/moon only)
                        const shatterTypes = ['asteroid', 'moon'];
                        if (impactSpeed > SHATTER_SPEED && shatterTypes.includes(bigType) && shatterTypes.includes(smallType)) {
                            const totalMass = big.mass + small.mass;
                            const numFrags = Math.min(14, Math.floor(totalMass / 1.2) + 3);
                            const fragMass = Math.min(ASTEROID_MAX * 0.8, Math.max(0.5, totalMass / numFrags));
                            GS.clearOrbitalsOf(a); GS.clearOrbitalsOf(b);
                            const idxA = bodies.indexOf(a), idxB = bodies.indexOf(b);
                            if (idxA > idxB) { bodies.splice(idxA, 1); bodies.splice(idxB, 1); }
                            else { bodies.splice(idxB, 1); bodies.splice(idxA, 1); }
                            const avgR = GS.massToRadius(fragMass);
                            for (let f = 0; f < numFrags && bodies.length < MAX_BODIES; f++) {
                                const ang = (Math.PI * 2 * f / numFrags) + (Math.random() - 0.5) * 0.5;
                                const spd = 180 + Math.random() * impactSpeed * 0.5;
                                const sep = avgR * 2 + Math.random() * 8;
                                const fb = GS.createBody(
                                    cx + Math.cos(ang) * sep, cy + Math.sin(ang) * sep,
                                    Math.cos(ang) * spd + (a.vx + b.vx) * 0.25,
                                    Math.sin(ang) * spd + (a.vy + b.vy) * 0.25,
                                    fragMass * (0.6 + Math.random() * 0.8)
                                );
                                bodies.push(fb);
                            }
                            GS.spawnFlash(cx, cy, Math.max(big.r, small.r) * 2.5, 'rgba(255,200,100,0.8)', 0.25);
                            GS.spawnRing(cx, cy, Math.max(big.r, small.r) * 4, 'rgba(255,180,80,0.6)', 0.5, 2);
                            GS.spawnDebris(cx, cy, 18, 35, 2);
                            break outer;
                        }

                        // *** Planet+Planet collision: sun birth or catastrophic shatter ***
                        if (bigType === 'planet' && smallType === 'planet') {
                            const totalM = big.mass + small.mass;
                            if (totalM > PLANET_MAX) {
                                // Combined mass enough for a star — SUN BIRTH!
                                big.vx = (big.vx * big.mass + small.vx * small.mass) / totalM;
                                big.vy = (big.vy * big.mass + small.vy * small.mass) / totalM;
                                big.mass = totalM;
                                big.r = GS.massToRadius(totalM);
                                const c = GS.pickColor(big.mass);
                                big.hue = c.hue; big.sat = c.sat; big.lit = c.lit;
                                big.seed = Math.floor(Math.random() * 2147483647);

                                // Determine sun type from dominant resource
                                const bigRes = big.civ ? (big.civ._dominantResource || null) : null;
                                const smallRes = small.civ ? (small.civ._dominantResource || null) : null;
                                const resType = bigRes || smallRes;
                                if (resType && GS.RESOURCE_TINTS[resType]) {
                                    big._sunType = GS.RESOURCE_TINTS[resType].sunType;
                                    const st = GS.SUN_TYPES[big._sunType];
                                    if (st) { big.hue = st.h; big.sat = st.s; big.lit = st.l; }
                                } else {
                                    big._sunType = 'yellow';
                                }

                                // Colonies are destroyed by the star birth
                                big.civ = null;
                                GS.spawnPromotion(big.x, big.y, big.r, 'star');
                                GS.spawnCollapse(cx, cy, big.r * 0.5);
                                GS.transferOrbitals(small, big); GS.clearOrbit(big);

                                const removeIdx = bodies.indexOf(small);
                                if (removeIdx >= 0) bodies.splice(removeIdx, 1);
                                break outer;
                            } else {
                                // Not enough mass for a star — CATASTROPHIC SHATTER
                                // Both planets break into moons + comets with colony survivors
                                GS.clearOrbitalsOf(a); GS.clearOrbitalsOf(b);
                                const idxA = bodies.indexOf(a), idxB = bodies.indexOf(b);
                                if (idxA > idxB) { bodies.splice(idxA, 1); bodies.splice(idxB, 1); }
                                else { bodies.splice(idxB, 1); bodies.splice(idxA, 1); }

                                // Collect survivors from both colonies
                                const survivors = [];
                                for (const src of [big, small]) {
                                    if (src.civ) {
                                        survivors.push({
                                            faction: src.civ.faction,
                                            population: Math.floor(src.civ.population * 0.3),
                                            resources: Math.floor(src.civ.resources * 0.2),
                                            techLevel: src.civ.techLevel * 0.7,
                                        });
                                    }
                                }

                                const totalMass = big.mass + small.mass;
                                const numFrags = Math.min(12, 4 + Math.floor(totalMass / 80));
                                let survivorIdx = 0;

                                for (let f = 0; f < numFrags && bodies.length < MAX_BODIES; f++) {
                                    const ang = (Math.PI * 2 * f / numFrags) + (Math.random() - 0.5) * 0.5;
                                    const spd = 100 + Math.random() * impactSpeed * 0.4;
                                    // First 2-3 fragments are moon-sized, rest are comets/asteroids
                                    let fragMass;
                                    if (f < 2) {
                                        fragMass = GS.ASTEROID_MAX + Math.random() * (GS.MOON_MAX - GS.ASTEROID_MAX) * 0.6;
                                    } else {
                                        fragMass = 5 + Math.random() * GS.ASTEROID_MAX * 0.7;
                                    }
                                    const sep = GS.massToRadius(fragMass) * 2 + Math.random() * 10;
                                    const fb = GS.createBody(
                                        cx + Math.cos(ang) * sep, cy + Math.sin(ang) * sep,
                                        Math.cos(ang) * spd + (a.vx + b.vx) * 0.2,
                                        Math.sin(ang) * spd + (a.vy + b.vy) * 0.2,
                                        fragMass
                                    );

                                    // Assign colony survivors to moon-sized fragments
                                    if (survivorIdx < survivors.length && GS.bodyType(fb.mass) === 'moon') {
                                        const sv = survivors[survivorIdx++];
                                        fb.civ = {
                                            faction: sv.faction,
                                            population: sv.population,
                                            techLevel: sv.techLevel,
                                            settlements: [{ angle: Math.random() * Math.PI * 2, size: 1, glow: 0.6, type: 'village' }],
                                            age: 0, morale: 0.3, resources: sv.resources,
                                            military: 0, alert: 'evacuated', shields: 0,
                                        };
                                    }
                                    bodies.push(fb);
                                }

                                GS.spawnFlash(cx, cy, Math.max(big.r, small.r) * 3, 'rgba(255,200,100,0.9)', 0.4);
                                GS.spawnRing(cx, cy, Math.max(big.r, small.r) * 5, 'rgba(255,180,80,0.7)', 0.7, 3);
                                GS.spawnDebris(cx, cy, 25, 35, 2.5);
                                break outer;
                            }
                        }

                        // Normal merge (non-planet+planet cases)
                        const totalM = big.mass + small.mass;
                        big.vx = (big.vx * big.mass + small.vx * small.mass) / totalM;
                        big.vy = (big.vy * big.mass + small.vy * small.mass) / totalM;

                        const oldType = GS.bodyType(big.mass);
                        big.mass = totalM;
                        big.r = GS.massToRadius(totalM);
                        const newType = GS.bodyType(big.mass);

                        // Type evolution: dramatic promotion effects
                        if (newType !== oldType) {
                            // BLOCK star promotion from non-planet+planet merges
                            // A body can only become a star from planet+planet (handled above)
                            if (newType === 'star' && !(bigType === 'planet' && smallType === 'planet')) {
                                // Cap mass just below star threshold — stays as a mega-planet
                                big.mass = PLANET_MAX;
                                big.r = GS.massToRadius(big.mass);
                            } else {
                                const c = GS.pickColor(big.mass);
                                big.hue = c.hue; big.sat = c.sat; big.lit = c.lit;
                                big.seed = Math.floor(Math.random() * 2147483647);
                                GS.spawnPromotion(big.x, big.y, big.r, newType);

                                // Colony genesis: planet promotion = civilization emerges
                                if (newType === 'planet' && !big.civ) {
                                    GS.initColony(big);
                                    // Chance for newly promoted planet to get rings
                                    if (!big._rings && Math.random() < 0.35) {
                                        GS.assignRings(big);
                                    }
                                }
                                // Colony destruction: BH burns away civilizations
                                if (newType === 'blackhole' && big.civ) {
                                    big.civ = null;
                                }
                                // Black hole birth from star = collapse event
                                if (newType === 'blackhole' && oldType === 'star') {
                                    GS.spawnCollapse(big.x, big.y, big.r);
                                }
                            }
                        }

                        // Star + Star merge = nuclear star
                        if (bigType === 'star' && smallType === 'star') {
                            GS.markNuclearStar(big);
                        }

                        // Transfer colony from small to big
                        if (small.civ && !big.civ && GS.bodyType(big.mass) === 'planet') {
                            big.civ = small.civ;
                        } else if (small.civ && big.civ) {
                            big.civ.population += small.civ.population * 0.3;
                            big.civ.resources += small.civ.resources * 0.5;
                        }

                        // Orbital cleanup: transfer small's orbitals to big, clear small's orbit
                        GS.transferOrbitals(small, big);
                        GS.clearOrbit(small);

                        // Impact flash
                        GS.spawnFlash(cx, cy, Math.max(big.r, small.r) * 1.5, 'rgba(255,255,255,0.4)', 0.15);
                        GS.spawnDebris(cx, cy, 6, big.hue, 1);

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
                const t = 1 - ef.life / ef.duration;
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
                        const isBH = GS.bodyType(a.mass) === 'blackhole' || GS.bodyType(b.mass) === 'blackhole';
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
                const type = GS.bodyType(b.mass);

                if (type === 'blackhole') {
                    // --- Cinematic Black Hole (Interstellar-inspired) ---
                    b.bhTime = (b.bhTime || 0) + dt;
                    const t = b.bhTime;
                    const R = b.r;
                    ctx.save();
                    ctx.translate(b.x, b.y);

                    // === 1. Deep space warp field (dark gravity well) ===
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.globalAlpha = 0.5;
                    const warpR = R * 7;
                    const wg = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, warpR);
                    wg.addColorStop(0, 'rgba(0,0,0,0.6)');
                    wg.addColorStop(0.15, 'rgba(5,2,15,0.3)');
                    wg.addColorStop(0.4, 'rgba(15,5,35,0.08)');
                    wg.addColorStop(0.7, 'rgba(10,3,25,0.02)');
                    wg.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = wg;
                    ctx.beginPath(); ctx.arc(0, 0, warpR, 0, Math.PI * 2); ctx.fill();

                    // === 2. Gravitational lensing ring (Einstein ring) ===
                    ctx.globalCompositeOperation = 'screen';
                    const lensR = R * 1.8;
                    ctx.globalAlpha = 0.12 + 0.04 * Math.sin(t * 2.5);
                    const lg = ctx.createRadialGradient(0, 0, lensR - R * 0.3, 0, 0, lensR + R * 0.3);
                    lg.addColorStop(0, 'rgba(255,200,100,0)');
                    lg.addColorStop(0.3, 'rgba(255,210,130,0.15)');
                    lg.addColorStop(0.5, 'rgba(255,220,160,0.25)');
                    lg.addColorStop(0.7, 'rgba(255,200,120,0.12)');
                    lg.addColorStop(1, 'rgba(255,180,80,0)');
                    ctx.fillStyle = lg;
                    ctx.beginPath(); ctx.arc(0, 0, lensR + R * 0.3, 0, Math.PI * 2); ctx.fill();

                    // === 3. Accretion disk (back half — behind BH) ===
                    ctx.save();
                    const diskTilt = 0.22;
                    const diskRot = t * 0.6;
                    ctx.rotate(0.15); // slight tilt angle

                    // Multiple disk layers with depth
                    for (let layer = 0; layer < 5; layer++) {
                        const innerR = R * (1.0 + layer * 0.5);
                        const outerR = innerR + R * (0.4 - layer * 0.03);
                        const midR = (innerR + outerR) / 2;
                        const w = outerR - innerR;

                        ctx.save();
                        ctx.scale(1, diskTilt);

                        // Back half of disk (behind the hole)
                        const layerSpeed = diskRot * (2.5 - layer * 0.35);
                        // Hot inner disk → cooler outer disk color shift
                        const diskH = layer < 2 ? 40 + Math.sin(t * 3 + layer) * 10
                                    : layer < 3 ? 25 + Math.sin(t * 2) * 8
                                    : 280 + Math.sin(t * 1.5) * 15;
                        const diskL = layer < 2 ? 72 - layer * 5 + Math.sin(t * 4 + layer) * 4
                                    : 45 - layer * 3;
                        const diskA = (0.4 - layer * 0.06);

                        ctx.globalAlpha = diskA * 0.7;
                        ctx.strokeStyle = `hsl(${diskH}, 95%, ${diskL}%)`;
                        ctx.lineWidth = w;
                        ctx.beginPath();
                        ctx.arc(0, 0, midR, 0, Math.PI); // back half
                        ctx.stroke();

                        // Swirling hot spots in the disk
                        const nHotspots = 4 + layer;
                        for (let h = 0; h < nHotspots; h++) {
                            const hAng = layerSpeed + (Math.PI * 2 * h / nHotspots);
                            // Only draw hotspots in the back half
                            const normAng = ((hAng % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                            if (normAng > Math.PI) continue;
                            const hx = Math.cos(hAng) * midR;
                            const hy = Math.sin(hAng) * midR;
                            const hSize = w * (0.3 + 0.2 * Math.sin(t * 5 + h + layer));
                            ctx.globalAlpha = diskA * (0.5 + 0.3 * Math.sin(t * 6 + h * 1.7));
                            ctx.fillStyle = layer < 2
                                ? `hsl(${45 + Math.sin(t * 4 + h) * 15}, 100%, ${80 + Math.sin(t * 7 + h) * 8}%)`
                                : `hsl(${280 + Math.sin(t * 3) * 20}, 80%, ${55 + Math.sin(t * 5 + h) * 10}%)`;
                            ctx.beginPath(); ctx.arc(hx, hy, hSize, 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.restore();
                    }
                    ctx.restore();

                    // === 4. Photon sphere (thin bright ring hugging event horizon) ===
                    ctx.globalAlpha = 0.6 + 0.25 * Math.sin(t * 8);
                    ctx.save();
                    ctx.scale(1, diskTilt);
                    const psGrad = ctx.createRadialGradient(0, 0, R * 0.75, 0, 0, R * 1.05);
                    psGrad.addColorStop(0, 'rgba(255,240,200,0)');
                    psGrad.addColorStop(0.4, 'rgba(255,235,180,0.6)');
                    psGrad.addColorStop(0.6, 'rgba(255,220,150,0.9)');
                    psGrad.addColorStop(0.8, 'rgba(255,200,100,0.5)');
                    psGrad.addColorStop(1, 'rgba(255,180,60,0)');
                    ctx.fillStyle = psGrad;
                    ctx.beginPath(); ctx.arc(0, 0, R * 1.05, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();

                    // === 5. Relativistic jets (polar Hawking radiation) ===
                    for (let jet = 0; jet < 2; jet++) {
                        const dir = jet === 0 ? -1 : 1;
                        const jetLen = R * (4 + Math.sin(t * 3) * 0.8);
                        const jetW = R * 0.15;
                        const jg = ctx.createLinearGradient(0, dir * R * 0.3, 0, dir * jetLen);
                        jg.addColorStop(0, 'rgba(180,140,255,0.35)');
                        jg.addColorStop(0.3, 'rgba(140,100,255,0.15)');
                        jg.addColorStop(0.7, 'rgba(100,60,220,0.04)');
                        jg.addColorStop(1, 'rgba(60,30,150,0)');
                        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 5 + jet);
                        ctx.fillStyle = jg;
                        ctx.beginPath();
                        ctx.moveTo(-jetW, dir * R * 0.3);
                        ctx.lineTo(0, dir * jetLen);
                        ctx.lineTo(jetW, dir * R * 0.3);
                        ctx.closePath();
                        ctx.fill();
                        // Bright core of jet
                        ctx.globalAlpha = 0.3 + 0.15 * Math.sin(t * 7 + jet);
                        ctx.strokeStyle = 'rgba(200,180,255,0.6)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(0, dir * R * 0.3);
                        ctx.lineTo(0, dir * jetLen * 0.7);
                        ctx.stroke();
                    }

                    // === 6. Matter spiraling inward (infalling streams) ===
                    const nStreams = 3;
                    for (let s = 0; s < nStreams; s++) {
                        const baseAng = t * 0.3 + s * Math.PI * 2 / nStreams;
                        ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 4 + s);
                        ctx.strokeStyle = s % 2 === 0
                            ? `hsl(${35 + Math.sin(t * 2 + s) * 10}, 90%, ${65 + Math.sin(t * 3 + s) * 10}%)`
                            : `hsl(${270 + Math.sin(t * 2) * 15}, 70%, ${50 + Math.sin(t * 4 + s) * 8}%)`;
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        for (let a = 0; a < Math.PI * 6; a += 0.15) {
                            const spiral = R * (3.5 - a * 0.15);
                            if (spiral < R * 0.6) break;
                            const px = Math.cos(baseAng + a) * spiral;
                            const py = Math.sin(baseAng + a) * spiral * diskTilt;
                            a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                        }
                        ctx.stroke();
                    }

                    // === 7. Orbiting particle debris (captured matter) ===
                    const nParticles = 24;
                    for (let p = 0; p < nParticles; p++) {
                        const pAng = t * (1.8 + (p % 5) * 0.25) + (Math.PI * 2 * p / nParticles);
                        const pOrbitR = R * (1.0 + (p % 6) * 0.35 + Math.sin(t * 1.5 + p * 0.9) * 0.12);
                        const px = Math.cos(pAng) * pOrbitR;
                        const py = Math.sin(pAng) * pOrbitR * (diskTilt + (p % 3) * 0.08);
                        const pSize = 0.5 + (p % 4) * 0.3;
                        const pH = p % 3 === 0 ? 40 : p % 3 === 1 ? 20 : 280;
                        const pL = 55 + (p % 4) * 8 + Math.sin(t * 5 + p) * 5;
                        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 4 + p * 1.3);
                        ctx.fillStyle = `hsl(${pH}, 90%, ${pL}%)`;
                        ctx.beginPath(); ctx.arc(px, py, pSize, 0, Math.PI * 2); ctx.fill();
                    }

                    // === 8. Accretion disk (front half — in front of BH) ===
                    ctx.save();
                    ctx.rotate(0.15);
                    for (let layer = 0; layer < 5; layer++) {
                        const innerR = R * (1.0 + layer * 0.5);
                        const outerR = innerR + R * (0.4 - layer * 0.03);
                        const midR = (innerR + outerR) / 2;
                        const w = outerR - innerR;
                        const layerSpeed = diskRot * (2.5 - layer * 0.35);
                        const diskH = layer < 2 ? 40 + Math.sin(t * 3 + layer) * 10
                                    : layer < 3 ? 25 + Math.sin(t * 2) * 8
                                    : 280 + Math.sin(t * 1.5) * 15;
                        const diskL = layer < 2 ? 72 - layer * 5 + Math.sin(t * 4 + layer) * 4
                                    : 45 - layer * 3;
                        const diskA = (0.4 - layer * 0.06);

                        ctx.save();
                        ctx.scale(1, diskTilt);
                        ctx.globalAlpha = diskA;
                        ctx.strokeStyle = `hsl(${diskH}, 95%, ${diskL}%)`;
                        ctx.lineWidth = w;
                        ctx.beginPath();
                        ctx.arc(0, 0, midR, Math.PI, Math.PI * 2); // front half
                        ctx.stroke();

                        // Front-half hotspots
                        const nHotspots = 4 + layer;
                        for (let h = 0; h < nHotspots; h++) {
                            const hAng = layerSpeed + (Math.PI * 2 * h / nHotspots);
                            const normAng = ((hAng % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                            if (normAng <= Math.PI) continue;
                            const hx = Math.cos(hAng) * midR;
                            const hy = Math.sin(hAng) * midR;
                            const hSize = w * (0.3 + 0.2 * Math.sin(t * 5 + h + layer));
                            ctx.globalAlpha = diskA * (0.6 + 0.3 * Math.sin(t * 6 + h * 1.7));
                            ctx.fillStyle = layer < 2
                                ? `hsl(${45 + Math.sin(t * 4 + h) * 15}, 100%, ${82 + Math.sin(t * 7 + h) * 8}%)`
                                : `hsl(${280 + Math.sin(t * 3) * 20}, 80%, ${58 + Math.sin(t * 5 + h) * 10}%)`;
                            ctx.beginPath(); ctx.arc(hx, hy, hSize, 0, Math.PI * 2); ctx.fill();
                        }
                        ctx.restore();
                    }
                    ctx.restore();

                    ctx.globalCompositeOperation = 'source-over';

                    // === 9. Event horizon (deep void) ===
                    ctx.globalAlpha = 1;
                    const ehR = R * 0.55;
                    const ehGrad = ctx.createRadialGradient(0, 0, ehR * 0.3, 0, 0, ehR);
                    ehGrad.addColorStop(0, '#000');
                    ehGrad.addColorStop(0.7, '#000');
                    ehGrad.addColorStop(0.9, 'rgba(0,0,0,0.9)');
                    ehGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
                    ctx.fillStyle = ehGrad;
                    ctx.beginPath(); ctx.arc(0, 0, ehR, 0, Math.PI * 2); ctx.fill();

                    // === 10. Edge highlight (thin bright rim) ===
                    ctx.globalAlpha = 0.4 + 0.15 * Math.sin(t * 6);
                    const rimGrad = ctx.createRadialGradient(0, 0, ehR * 0.85, 0, 0, ehR * 1.15);
                    rimGrad.addColorStop(0, 'rgba(0,0,0,0)');
                    rimGrad.addColorStop(0.5, 'rgba(120,80,220,0.2)');
                    rimGrad.addColorStop(0.8, 'rgba(160,100,255,0.15)');
                    rimGrad.addColorStop(1, 'rgba(100,60,200,0)');
                    ctx.fillStyle = rimGrad;
                    ctx.beginPath(); ctx.arc(0, 0, ehR * 1.15, 0, Math.PI * 2); ctx.fill();

                    // === 11. Tiny bright singularity flash ===
                    ctx.globalAlpha = 0.08 + 0.06 * Math.sin(t * 12);
                    ctx.fillStyle = '#fff';
                    ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); ctx.fill();

                    ctx.restore();

                } else {
                    // Pre-baked textured rendering for asteroid/moon/planet/star
                    if (!b._tex || b._texType !== type || Math.abs(b._texR - b.r) > 0.5) {
                        GS.generateBodyTexture(b);
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

                    // Star animated corona pulse (uses sun type color if available)
                    if (type === 'star') {
                        b.bhTime = (b.bhTime || 0) + dt;
                        const sunT = b._sunType ? GS.SUN_TYPES[b._sunType] : null;
                        const coronaHue = sunT ? sunT.h : b.hue;
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = 0.1 + 0.05 * Math.sin(b.bhTime * 4);
                        const pulse = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 3.5);
                        pulse.addColorStop(0, `hsla(${coronaHue}, 100%, 85%, 0.5)`);
                        pulse.addColorStop(0.4, `hsla(${coronaHue}, 90%, 60%, 0.15)`);
                        pulse.addColorStop(1, `hsla(${coronaHue}, 80%, 50%, 0)`);
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
                if (b.civ) GS.drawSettlements(ctx, b, now / 1000);
            }

            // --- Draw trade routes ---
            GS.drawRoutes(ctx);

            // --- Draw rockets ---
            GS.drawRockets(ctx, now / 1000);

            // --- Draw cosmic events ---
            GS.drawCosmicEvent(ctx);
            GS.drawStarHazards(ctx, bodies, dt);
            GS.drawMegaStructures(ctx, bodies, now / 1000);
            GS.drawDestructionEffects(ctx, bodies, now / 1000);

            // --- Draw orbital paths ---
            GS.drawOrbits(ctx, bodies, now / 1000);

            // --- Draw info panel for selected body ---
            GS.drawInfoPanel(ctx, dt);

            // --- Update & draw zoom view ---
            GS.updateZoom(dt);
            const zoomRendered = GS.drawZoomView(ctx, dt, now / 1000);

            // --- Draw hold preview (growing body + slingshot + progress ring) ---
            for (const ptr of pointers.values()) {
                if (ptr.released) continue;
                const mass = ptr.mass;
                const r = GS.massToRadius(mass);
                const type = GS.bodyType(mass);
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
                    ctx.save();
                    ctx.translate(ptr.sx, ptr.sy);
                    // Warp halo
                    ctx.globalAlpha = 0.2;
                    const pg = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2);
                    pg.addColorStop(0, 'rgba(0,0,0,0.5)');
                    pg.addColorStop(0.5, 'rgba(30,15,60,0.15)');
                    pg.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = pg;
                    ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, Math.PI * 2); ctx.fill();
                    // Mini accretion disk
                    ctx.globalCompositeOperation = 'screen';
                    ctx.globalAlpha = 0.3;
                    ctx.strokeStyle = 'hsl(40, 95%, 70%)';
                    ctx.lineWidth = r * 0.15;
                    ctx.save(); ctx.scale(1, 0.22);
                    ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.stroke();
                    ctx.restore();
                    ctx.globalCompositeOperation = 'source-over';
                    // Event horizon
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = '#000';
                    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
                    // Rim glow
                    ctx.globalAlpha = 0.4;
                    ctx.strokeStyle = 'rgba(160, 100, 255, 0.7)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.stroke();
                    ctx.restore();
                } else if (type === 'star') {
                    ctx.globalAlpha = 0.6;
                    ctx.fillStyle = 'hsl(45, 95%, 65%)';
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
