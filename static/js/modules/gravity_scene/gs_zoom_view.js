// ============================================================
// Gravity Scene — Zoom / Inspect View (Camera System)
// True close-up camera: centers on target, shows all nearby
// bodies, rockets, orbits at zoomed scale. Surface detail
// entities rendered on top of the focused body.
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    // ── Zoom state ──
    GS.zoomActive = false;
    GS.zoomTarget = null;
    GS.zoomProgress = 0;       // 0→1 eased transition
    GS.zoomScale = 1;
    const ZOOM_SPEED = 2.5;     // transition speed
    const BODY_FILL = 0.32;     // target body fills ~32% of smallest screen dim
    const MIN_ZOOM = 2;
    const MAX_ZOOM = 18;

    // ── Hi-res texture cache ──
    let hiResTex = null;
    let hiResBody = null;
    let hiResSize = 0;

    // ── Surface entity pool ──
    let surfaceEntities = [];
    let entitySeed = 0;

    function seededRand() {
        entitySeed = (entitySeed * 16807 + 0) % 2147483647;
        return (entitySeed & 0x7fffffff) / 0x7fffffff;
    }

    // ── Easing ──
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ══════════════════════════════════════════════════════════════
    //  HI-RES TEXTURE
    // ══════════════════════════════════════════════════════════════
    function generateHiRes(b, targetScreenR) {
        if (hiResBody === b && hiResTex && Math.abs(hiResSize - targetScreenR * 2) < targetScreenR * 0.3) return;

        const sz = Math.ceil(targetScreenR * 2.4);
        const oc = document.createElement('canvas');
        oc.width = sz; oc.height = sz;
        const c = oc.getContext('2d');
        const cx = sz / 2, cy = sz / 2;
        const r = targetScreenR;
        const rng = GS.seededRng(b.seed);
        const type = GS.bodyType(b.mass);

        if (type === 'asteroid') {
            c.save(); c.translate(cx, cy);
            c.beginPath();
            const nv = 10 + Math.floor(rng() * 6);
            for (let i = 0; i <= nv; i++) {
                const a = (Math.PI * 2 * i) / nv;
                const j = 0.72 + rng() * 0.32;
                const px = Math.cos(a) * r * j, py = Math.sin(a) * r * j;
                i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
            }
            c.closePath();
            const g = c.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
            g.addColorStop(0, `hsl(${b.hue}, ${b.sat + 5}%, ${b.lit + 12}%)`);
            g.addColorStop(1, `hsl(${b.hue}, ${Math.max(0, b.sat - 5)}%, ${Math.max(10, b.lit - 10)}%)`);
            c.fillStyle = g; c.fill();
            const nCraters = 5 + Math.floor(rng() * 8);
            for (let i = 0; i < nCraters; i++) {
                const ca = rng() * Math.PI * 2, cd = rng() * r * 0.65;
                const cr = r * (0.04 + rng() * 0.1);
                c.globalAlpha = 0.15 + rng() * 0.15;
                c.fillStyle = `hsl(${b.hue}, ${b.sat}%, ${b.lit - 15}%)`;
                c.beginPath(); c.arc(Math.cos(ca) * cd, Math.sin(ca) * cd, cr, 0, Math.PI * 2); c.fill();
            }
            c.globalAlpha = 1; c.restore();

        } else if (type === 'moon') {
            c.save(); c.translate(cx, cy);
            const g = c.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
            g.addColorStop(0, `hsl(${b.hue}, ${b.sat + 3}%, ${b.lit + 10}%)`);
            g.addColorStop(1, `hsl(${b.hue}, ${Math.max(0, b.sat - 3)}%, ${Math.max(15, b.lit - 8)}%)`);
            c.fillStyle = g;
            c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
            const nCraters = 8 + Math.floor(rng() * 10);
            for (let i = 0; i < nCraters; i++) {
                const ca = rng() * Math.PI * 2, cd = rng() * r * 0.75;
                const cr = r * (0.03 + rng() * 0.08);
                c.globalAlpha = 0.12 + rng() * 0.12;
                c.fillStyle = `hsl(${b.hue}, ${b.sat}%, ${b.lit - 12}%)`;
                c.beginPath(); c.arc(Math.cos(ca) * cd, Math.sin(ca) * cd, cr, 0, Math.PI * 2); c.fill();
                c.globalAlpha = 0.06;
                c.strokeStyle = `hsl(${b.hue}, ${b.sat}%, ${b.lit + 15}%)`; c.lineWidth = 1; c.stroke();
            }
            c.globalAlpha = 1; c.restore();

        } else if (type === 'planet') {
            c.save(); c.translate(cx, cy);
            const g = c.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
            g.addColorStop(0, `hsl(${b.hue}, ${b.sat + 5}%, ${b.lit + 15}%)`);
            g.addColorStop(0.6, `hsl(${b.hue}, ${b.sat}%, ${b.lit}%)`);
            g.addColorStop(1, `hsl(${b.hue}, ${Math.max(0, b.sat - 8)}%, ${Math.max(10, b.lit - 12)}%)`);
            c.fillStyle = g;
            c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
            c.clip();
            const nBands = 4 + Math.floor(rng() * 5);
            for (let i = 0; i < nBands; i++) {
                const by = -r + (2 * r * i / nBands) + rng() * r * 0.3;
                const bh = r * (0.05 + rng() * 0.12);
                c.globalAlpha = 0.06 + rng() * 0.1;
                c.fillStyle = `hsl(${b.hue + (rng() - 0.5) * 20}, ${b.sat + 10}%, ${b.lit + 8 + rng() * 10}%)`;
                c.fillRect(-r, by, r * 2, bh);
            }
            const nFeatures = 3 + Math.floor(rng() * 5);
            for (let i = 0; i < nFeatures; i++) {
                const fx = (rng() - 0.5) * r * 1.4, fy = (rng() - 0.5) * r * 1.4;
                const fr = r * (0.08 + rng() * 0.15);
                c.globalAlpha = 0.08 + rng() * 0.08;
                c.fillStyle = `hsl(${b.hue + (rng() - 0.5) * 30}, ${b.sat}%, ${b.lit - 5 + rng() * 10}%)`;
                c.beginPath(); c.arc(fx, fy, fr, 0, Math.PI * 2); c.fill();
            }
            c.globalAlpha = 1;
            const rimG = c.createRadialGradient(r * 0.3, -r * 0.3, r * 0.7, 0, 0, r);
            rimG.addColorStop(0, 'rgba(255,255,255,0)');
            rimG.addColorStop(0.85, 'rgba(255,255,255,0)');
            rimG.addColorStop(1, 'rgba(255,255,255,0.08)');
            c.fillStyle = rimG;
            c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
            c.restore();

        } else if (type === 'star') {
            c.save(); c.translate(cx, cy);
            const sunT = b._sunType ? GS.SUN_TYPES[b._sunType] : null;
            const h = sunT ? sunT.h : b.hue;
            const coreG = c.createRadialGradient(0, 0, 0, 0, 0, r);
            coreG.addColorStop(0, `hsl(${h}, 100%, 95%)`);
            coreG.addColorStop(0.3, `hsl(${h}, 95%, 75%)`);
            coreG.addColorStop(0.7, `hsl(${h}, 90%, 55%)`);
            coreG.addColorStop(1, `hsl(${h}, 85%, 35%)`);
            c.fillStyle = coreG;
            c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
            const nSpots = 3 + Math.floor(rng() * 4);
            for (let i = 0; i < nSpots; i++) {
                const sa = rng() * Math.PI * 2, sd = rng() * r * 0.6;
                const sr = r * (0.04 + rng() * 0.08);
                c.globalAlpha = 0.15 + rng() * 0.1;
                c.fillStyle = `hsl(${h}, 60%, 25%)`;
                c.beginPath(); c.arc(Math.cos(sa) * sd, Math.sin(sa) * sd, sr, 0, Math.PI * 2); c.fill();
            }
            c.globalAlpha = 1; c.restore();
        } else {
            c.fillStyle = '#000';
            c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
        }

        hiResTex = oc;
        hiResBody = b;
        hiResSize = sz;
    }

    // ══════════════════════════════════════════════════════════════
    //  SURFACE ENTITIES
    // ══════════════════════════════════════════════════════════════
    function rebuildEntities(body) {
        surfaceEntities = [];
        if (!body) return;
        entitySeed = body.seed || 12345;
        const c = body.civ;
        const type = GS.bodyType(body.mass);

        const numTerrain = (type === 'planet') ? 14 + Math.floor(seededRand() * 8) :
                           (type === 'moon') ? 8 + Math.floor(seededRand() * 5) :
                           (type === 'star') ? 4 : 3;
        for (let i = 0; i < numTerrain; i++) {
            surfaceEntities.push({
                kind: seededRand() < 0.5 ? 'rock' : 'crater',
                angle: seededRand() * Math.PI * 2,
                dist: 0.25 + seededRand() * 0.6,
                size: 2 + seededRand() * 4,
                hue: body.hue + (seededRand() - 0.5) * 30,
            });
        }

        if (c && c._dominantResource) {
            const numRes = 3 + Math.floor(seededRand() * 4);
            for (let i = 0; i < numRes; i++) {
                surfaceEntities.push({
                    kind: 'resource',
                    angle: seededRand() * Math.PI * 2,
                    dist: 0.35 + seededRand() * 0.5,
                    size: 3 + seededRand() * 3,
                    resName: c._dominantResource,
                });
            }
        }

        if (!c) return;
        const faction = GS.FACTIONS[c.faction];

        for (const s of c.settlements) {
            surfaceEntities.push({
                kind: 'building', subType: s.type,
                angle: s.angle, dist: 0.82,
                size: s.size * 3 + 3, color: faction.color,
            });
        }

        const numCivs = Math.min(25, Math.floor(c.population / 4));
        for (let i = 0; i < numCivs; i++) {
            surfaceEntities.push({
                kind: 'civilian',
                angle: seededRand() * Math.PI * 2,
                dist: 0.55 + seededRand() * 0.3,
                speed: 0.12 + seededRand() * 0.2,
                dir: seededRand() < 0.5 ? 1 : -1,
                color: faction.color,
            });
        }

        if (c._dominantResource) {
            const numMiners = Math.min(10, Math.floor(c.population / 12) + 1);
            for (let i = 0; i < numMiners; i++) {
                const resEnt = surfaceEntities.find(e => e.kind === 'resource');
                surfaceEntities.push({
                    kind: 'miner',
                    angle: resEnt ? resEnt.angle + (seededRand() - 0.5) * 0.3 : seededRand() * Math.PI * 2,
                    dist: resEnt ? resEnt.dist + (seededRand() - 0.5) * 0.1 : 0.5,
                    mineTimer: seededRand() * 3, color: faction.color,
                });
            }
        }

        const spaceports = c.settlements.filter(s => s.type === 'spaceport');
        for (const sp of spaceports) {
            const n = 1 + Math.floor(seededRand() * 3);
            for (let i = 0; i < n; i++) {
                surfaceEntities.push({
                    kind: 'ship_docked',
                    angle: sp.angle + (seededRand() - 0.5) * 0.15,
                    dist: 0.92 + seededRand() * 0.12,
                    shipType: seededRand() < 0.3 ? 'large' : 'small',
                    color: faction.color,
                });
            }
        }

        const forts = c.settlements.filter(s => s.type === 'fortress');
        for (const f of forts) {
            surfaceEntities.push({ kind: 'guard_tower', angle: f.angle - 0.08, dist: 0.88, color: faction.color });
            surfaceEntities.push({ kind: 'guard_tower', angle: f.angle + 0.08, dist: 0.88, color: faction.color });
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  ENTER / EXIT
    // ══════════════════════════════════════════════════════════════
    GS.enterZoom = function (body) {
        if (!body) return;
        GS.zoomActive = true;
        GS.zoomTarget = body;
        GS.zoomProgress = 0;
        rebuildEntities(body);
        hiResBody = null;
    };

    GS.exitZoom = function () {
        GS.zoomActive = false;
        GS.zoomTarget = null;
        GS.zoomProgress = 0;
        surfaceEntities = [];
        hiResTex = null; hiResBody = null;
    };

    // ══════════════════════════════════════════════════════════════
    //  UPDATE
    // ══════════════════════════════════════════════════════════════
    GS.updateZoom = function (dt) {
        if (GS.zoomActive) {
            GS.zoomProgress = Math.min(1, GS.zoomProgress + dt * ZOOM_SPEED);
            if (GS.zoomTarget && !GS.state.bodies.includes(GS.zoomTarget)) {
                GS.exitZoom();
            }
        } else if (GS.zoomProgress > 0) {
            GS.zoomProgress = Math.max(0, GS.zoomProgress - dt * ZOOM_SPEED * 1.8);
        }

        if (GS.zoomProgress > 0) {
            const t = easeInOutCubic(GS.zoomProgress);
            const b = GS.zoomTarget || GS._lastZoomTarget;
            if (b) {
                const vw = GS.state._vw, vh = GS.state._vh;
                const minDim = Math.min(vw, vh);
                const desiredScreenR = minDim * BODY_FILL;
                let ideal = desiredScreenR / Math.max(b.r, 2);
                ideal = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ideal));
                GS.zoomScale = 1 + (ideal - 1) * t;
            }
        } else {
            GS.zoomScale = 1;
        }
    };

    // ══════════════════════════════════════════════════════════════
    //  DRAW — Real camera view
    // ══════════════════════════════════════════════════════════════
    GS.drawZoomView = function (ctx, dt, time) {
        if (GS.zoomProgress <= 0.01) return false;

        const b = GS.zoomTarget || GS._lastZoomTarget;
        if (!b) return false;
        if (GS.zoomTarget) GS._lastZoomTarget = GS.zoomTarget;

        const ease = easeInOutCubic(GS.zoomProgress);
        const alpha = Math.min(1, ease * 1.5);
        const scale = GS.zoomScale;
        const vw = GS.state._vw, vh = GS.state._vh;
        const cx = vw / 2, cy = vh / 2;
        const type = GS.bodyType(b.mass);
        const faction = b.civ ? GS.FACTIONS[b.civ.faction] : null;

        // Camera offset: center on target body
        const camX = cx - b.x * scale;
        const camY = cy - b.y * scale;

        ctx.save();

        // Dim background
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, vw, vh);

        // Apply camera transform
        ctx.translate(camX, camY);
        ctx.scale(scale, scale);
        ctx.globalAlpha = 1;

        // ── Draw ALL bodies (nearby objects visible) ──
        const bodies = GS.state.bodies;
        for (const ob of bodies) {
            const sx = ob.x * scale + camX;
            const sy = ob.y * scale + camY;
            const sr = ob.r * scale + 40;
            if (sx < -sr || sx > vw + sr || sy < -sr || sy > vh + sr) continue;
            if (ob === b) continue; // draw target last

            ctx.globalAlpha = alpha * 0.85;
            if (ob._tex) {
                const sz = ob._texSize || ob.r * 2;
                ctx.drawImage(ob._tex, ob.x - sz / 2, ob.y - sz / 2);
            } else {
                ctx.fillStyle = `hsl(${ob.hue}, ${ob.sat}%, ${ob.lit}%)`;
                ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2); ctx.fill();
            }
        }

        // ── Orbital paths ──
        ctx.globalAlpha = alpha * 0.08;
        for (const ob of bodies) {
            if (!ob._orbitParent || !bodies.includes(ob._orbitParent)) continue;
            const p = ob._orbitParent;
            const dx = ob.x - p.x, dy = ob.y - p.y;
            const oR = Math.sqrt(dx * dx + dy * dy);
            ctx.strokeStyle = 'rgba(140,175,255,1)';
            ctx.lineWidth = 0.5 / scale + 0.3;
            ctx.setLineDash([3, 7]);
            ctx.beginPath(); ctx.arc(p.x, p.y, oR, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.setLineDash([]);

        // ── Rockets ──
        ctx.globalAlpha = alpha;
        for (const r of GS.state.rockets) {
            const rx = r.x * scale + camX, ry = r.y * scale + camY;
            if (rx < -30 || rx > vw + 30 || ry < -30 || ry > vh + 30) continue;

            const rFac = GS.FACTIONS[r.faction];
            const rCol = rFac ? rFac.color : '#fff';
            const sz = 2 + 1 / scale;

            ctx.save();
            ctx.translate(r.x, r.y);
            ctx.rotate(Math.atan2(r.vy, r.vx));
            ctx.fillStyle = rCol;
            ctx.beginPath();
            ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.6, -sz * 0.5); ctx.lineTo(-sz * 0.6, sz * 0.5);
            ctx.closePath(); ctx.fill();
            ctx.globalAlpha = alpha * 0.4;
            ctx.fillStyle = rCol;
            ctx.beginPath(); ctx.arc(-sz * 0.8, 0, sz * 0.35, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // ── TARGET BODY (hi-res) ──
        ctx.globalAlpha = 1;
        const screenR = b.r * scale;
        if (type !== 'blackhole') {
            generateHiRes(b, screenR);
            if (hiResTex) {
                const drawSize = hiResSize / scale;
                ctx.drawImage(hiResTex, b.x - drawSize / 2, b.y - drawSize / 2, drawSize, drawSize);
            }
        } else {
            if (b._tex) {
                const sz = b._texSize || b.r * 2;
                ctx.drawImage(b._tex, b.x - sz / 2, b.y - sz / 2);
            }
        }

        // ── Atmosphere glow ──
        if (type === 'planet') {
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.18 * alpha;
            const atmo = ctx.createRadialGradient(b.x, b.y, b.r * 0.7, b.x, b.y, b.r * 1.7);
            atmo.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, ${b.lit + 15}%, 0.4)`);
            atmo.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.lit}%, 0)`);
            ctx.fillStyle = atmo;
            ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.7, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }

        // ── Star corona ──
        if (type === 'star') {
            const sunT = b._sunType ? GS.SUN_TYPES[b._sunType] : null;
            const ch = sunT ? sunT.h : b.hue;
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.15 * alpha;
            const pulse = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 3);
            pulse.addColorStop(0, `hsla(${ch}, 100%, 85%, 0.5)`);
            pulse.addColorStop(0.4, `hsla(${ch}, 90%, 60%, 0.15)`);
            pulse.addColorStop(1, `hsla(${ch}, 80%, 50%, 0)`);
            ctx.fillStyle = pulse;
            ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }

        // ── Planetary rings ──
        if (b._rings) {
            GS.drawSettlements(ctx, b, time);
        }

        // ── Surface entities ──
        ctx.globalAlpha = alpha;
        const entScale = Math.max(0.4, 1 / scale * 3);
        for (const ent of surfaceEntities) {
            if (ent.kind === 'civilian') ent.angle += ent.speed * ent.dir * dt;
            if (ent.kind === 'miner') ent.mineTimer = (ent.mineTimer || 0) + dt;

            const ex = b.x + Math.cos(ent.angle) * b.r * (ent.dist || 1);
            const ey = b.y + Math.sin(ent.angle) * b.r * (ent.dist || 1);

            ctx.save();
            ctx.translate(ex, ey);
            ctx.scale(entScale, entScale);

            switch (ent.kind) {
                case 'rock':
                    ctx.globalAlpha = alpha * 0.55;
                    ctx.fillStyle = `hsl(${ent.hue}, 8%, 35%)`;
                    ctx.beginPath();
                    ctx.moveTo(-ent.size * 0.5, ent.size * 0.3);
                    ctx.lineTo(0, -ent.size * 0.5);
                    ctx.lineTo(ent.size * 0.5, ent.size * 0.3);
                    ctx.closePath(); ctx.fill();
                    break;

                case 'crater':
                    ctx.globalAlpha = alpha * 0.25;
                    ctx.strokeStyle = `hsl(${ent.hue}, 5%, 30%)`;
                    ctx.lineWidth = 0.8;
                    ctx.beginPath(); ctx.arc(0, 0, ent.size, 0, Math.PI * 2); ctx.stroke();
                    break;

                case 'resource': {
                    const resG = GS.RESOURCE_TINTS[ent.resName];
                    ctx.globalAlpha = alpha * (0.6 + Math.sin(time * 3 + ent.angle) * 0.2);
                    ctx.fillStyle = resG ? resG.glow : '#FFAA44';
                    ctx.beginPath();
                    ctx.moveTo(0, -ent.size);
                    ctx.lineTo(ent.size * 0.4, -ent.size * 0.2);
                    ctx.lineTo(ent.size * 0.3, ent.size * 0.5);
                    ctx.lineTo(-ent.size * 0.3, ent.size * 0.5);
                    ctx.lineTo(-ent.size * 0.4, -ent.size * 0.2);
                    ctx.closePath(); ctx.fill();
                    ctx.globalAlpha = alpha * 0.35;
                    ctx.fillStyle = '#fff'; ctx.font = '3px system-ui'; ctx.textAlign = 'center';
                    ctx.fillText(ent.resName, 0, ent.size + 4);
                    break;
                }

                case 'building':
                    drawBuilding(ctx, ent, alpha, time);
                    break;

                case 'civilian': {
                    ctx.globalAlpha = alpha * 0.7;
                    ctx.fillStyle = ent.color;
                    ctx.beginPath(); ctx.arc(0, -3, 1.2, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#ddd'; ctx.fillRect(-0.8, -1.8, 1.6, 3);
                    const lp = Math.sin(time * 6 + ent.angle * 10);
                    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 0.5;
                    ctx.beginPath();
                    ctx.moveTo(-0.3, 1.2); ctx.lineTo(-0.3 + lp * 0.8, 3);
                    ctx.moveTo(0.3, 1.2); ctx.lineTo(0.3 - lp * 0.8, 3);
                    ctx.stroke();
                    break;
                }

                case 'miner': {
                    ctx.globalAlpha = alpha * 0.8;
                    ctx.fillStyle = ent.color;
                    ctx.beginPath(); ctx.arc(0, -3, 1.3, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#aa8844'; ctx.fillRect(-1, -2, 2, 3.5);
                    const sw = Math.sin(ent.mineTimer * 4) * 0.6;
                    ctx.save(); ctx.translate(1.5, -1); ctx.rotate(sw - 0.5);
                    ctx.strokeStyle = '#886644'; ctx.lineWidth = 0.6;
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3, -3); ctx.stroke();
                    ctx.fillStyle = '#999'; ctx.fillRect(2.5, -4, 1.5, 1);
                    ctx.restore();
                    if (Math.sin(ent.mineTimer * 4) > 0.8) {
                        ctx.globalAlpha = alpha * 0.5; ctx.fillStyle = '#FFD700';
                        for (let sp = 0; sp < 3; sp++)
                            ctx.fillRect(3 + Math.random() * 2, -2 + Math.random() * 2, 0.5, 0.5);
                    }
                    break;
                }

                case 'ship_docked':
                    ctx.globalAlpha = alpha * 0.8;
                    drawShip(ctx, ent);
                    break;

                case 'guard_tower':
                    ctx.globalAlpha = alpha * 0.7;
                    ctx.fillStyle = '#445566'; ctx.fillRect(-1.5, -5, 3, 5);
                    ctx.fillStyle = ent.color; ctx.fillRect(-2, -7, 4, 2);
                    ctx.globalAlpha = alpha * (0.4 + Math.sin(time * 5) * 0.4);
                    ctx.fillStyle = '#FF4444';
                    ctx.beginPath(); ctx.arc(0, -8, 1, 0, Math.PI * 2); ctx.fill();
                    break;
            }
            ctx.restore();
        }

        // ── Settlements overlay ──
        if (b.civ && !b._rings) {
            GS.drawSettlements(ctx, b, time);
        }

        ctx.restore(); // undo camera transform

        // ── UI overlay (screen-space) ──
        drawZoomUI(ctx, b, alpha, vw, vh, time);

        return true;
    };

    // ══════════════════════════════════════════════════════════════
    //  BUILDING RENDERER
    // ══════════════════════════════════════════════════════════════
    function drawBuilding(ctx, ent, alpha, time) {
        ctx.globalAlpha = alpha * 0.85;
        const sz = ent.size;
        switch (ent.subType) {
            case 'village':
                ctx.fillStyle = '#887766';
                ctx.fillRect(-sz * 0.4, -sz * 0.3, sz * 0.8, sz * 0.6);
                ctx.fillStyle = '#AA6633';
                ctx.beginPath();
                ctx.moveTo(-sz * 0.5, -sz * 0.3); ctx.lineTo(0, -sz * 0.8); ctx.lineTo(sz * 0.5, -sz * 0.3);
                ctx.closePath(); ctx.fill();
                ctx.globalAlpha = alpha * (0.4 + Math.sin(time * 2) * 0.2);
                ctx.fillStyle = '#FFE088';
                ctx.fillRect(-sz * 0.15, -sz * 0.1, sz * 0.15, sz * 0.15);
                break;
            case 'city':
                ctx.fillStyle = '#556677';
                ctx.fillRect(-sz * 0.5, -sz, sz, sz * 1.2);
                ctx.globalAlpha = alpha * 0.6; ctx.fillStyle = '#FFEE88';
                for (let wy = 0; wy < 3; wy++)
                    for (let wx = 0; wx < 2; wx++)
                        if (Math.sin(time * 2 + wy * 3 + wx * 7 + ent.angle * 5) > -0.2)
                            ctx.fillRect(-sz * 0.35 + wx * sz * 0.35, -sz * 0.85 + wy * sz * 0.3, sz * 0.2, sz * 0.15);
                break;
            case 'spaceport':
                ctx.fillStyle = '#445566';
                ctx.fillRect(-sz * 0.8, 0, sz * 1.6, sz * 0.15);
                ctx.fillStyle = '#667788';
                ctx.fillRect(-sz * 0.15, -sz, sz * 0.3, sz);
                ctx.strokeStyle = ent.color; ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(0, -sz * 1.4); ctx.stroke();
                ctx.globalAlpha = alpha * (0.5 + Math.sin(time * 4) * 0.5);
                ctx.fillStyle = ent.color;
                ctx.beginPath(); ctx.arc(0, -sz * 1.4, 1, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = alpha * 0.4; ctx.fillStyle = '#88AAFF';
                for (let li = -3; li <= 3; li++) ctx.fillRect(li * sz * 0.2, sz * 0.15, 1, 1);
                break;
            case 'fortress':
                ctx.fillStyle = '#556655';
                ctx.fillRect(-sz * 0.6, -sz * 0.5, sz * 1.2, sz * 0.8);
                ctx.fillStyle = '#667766';
                for (let bt = -2; bt <= 2; bt++)
                    ctx.fillRect(bt * sz * 0.25 - sz * 0.08, -sz * 0.7, sz * 0.16, sz * 0.25);
                ctx.fillStyle = ent.color;
                ctx.fillRect(-0.5, -sz * 0.9, 3, 2);
                break;
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  SHIP RENDERER
    // ══════════════════════════════════════════════════════════════
    function drawShip(ctx, ent) {
        if (ent.shipType === 'large') {
            ctx.fillStyle = '#889999';
            ctx.beginPath();
            ctx.moveTo(5, 0); ctx.lineTo(-4, -3); ctx.lineTo(-5, -2);
            ctx.lineTo(-5, 2); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
            ctx.fillStyle = ent.color; ctx.globalAlpha *= 0.6;
            ctx.beginPath(); ctx.arc(-5, 0, 1.5, 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.fillStyle = '#aabbcc';
            ctx.beginPath();
            ctx.moveTo(3, 0); ctx.lineTo(-2, -1.5); ctx.lineTo(-3, 0); ctx.lineTo(-2, 1.5);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = ent.color;
            ctx.beginPath(); ctx.arc(-3, 0, 0.8, 0, Math.PI * 2); ctx.fill();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  ZOOM UI OVERLAY (screen-space)
    // ══════════════════════════════════════════════════════════════
    function drawZoomUI(ctx, b, alpha, vw, vh, time) {
        ctx.save();
        ctx.globalAlpha = alpha;
        const type = GS.bodyType(b.mass);
        const c = b.civ;
        const faction = c ? GS.FACTIONS[c.faction] : null;

        // ── Back button (top-left) ──
        const btnX = 16, btnY = 16, btnW = 80, btnH = 30;
        ctx.fillStyle = 'rgba(10,12,20,0.88)';
        ctx.beginPath(); ctx.roundRect(btnX, btnY, btnW, btnH, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(150,160,200,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('← Back', btnX + btnW / 2, btnY + btnH / 2);
        GS._zoomBackBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

        // ── Close X (top-right) ──
        const xS = 28, xX = vw - xS - 16, xY = 16;
        ctx.fillStyle = 'rgba(10,12,20,0.88)';
        ctx.beginPath(); ctx.roundRect(xX, xY, xS, xS, 6); ctx.fill();
        ctx.fillStyle = '#aaa'; ctx.font = 'bold 16px system-ui';
        ctx.fillText('✕', xX + xS / 2, xY + xS / 2);
        GS._zoomCloseBtn = { x: xX, y: xY, w: xS, h: xS };

        // ── Title bar (top-center) ──
        const typeName = type === 'blackhole' ? 'Black Hole' : type.charAt(0).toUpperCase() + type.slice(1);
        const title = faction ? `${faction.name} ${typeName}` : typeName;
        const subtitle = faction ? `Species: ${faction.species || faction.name}` : '';
        const titleW = 260, titleH = subtitle ? 48 : 32;
        const titleX = vw / 2 - titleW / 2, titleY = 12;
        ctx.fillStyle = 'rgba(10,12,20,0.82)';
        ctx.beginPath(); ctx.roundRect(titleX, titleY, titleW, titleH, 8); ctx.fill();
        ctx.fillStyle = faction ? faction.color : '#fff';
        ctx.font = 'bold 15px system-ui';
        ctx.fillText(title, vw / 2, subtitle ? titleY + 18 : titleY + titleH / 2);
        if (subtitle) {
            ctx.fillStyle = '#99aacc'; ctx.font = '11px system-ui';
            ctx.fillText(subtitle, vw / 2, titleY + 38);
        }

        // ── Stats panel (bottom-left) ──
        if (c) {
            const panelW = 185, lineH = 17;
            const stats = [
                ['Population', Math.floor(c.population)],
                ['Tech Level', c.techLevel.toFixed(1)],
                ['Resources', Math.floor(c.resources)],
                ['Specialty', c._dominantResource ? c._dominantResource.charAt(0).toUpperCase() + c._dominantResource.slice(1) : 'None'],
                ['Military', Math.floor(c.military)],
                ['Morale', (c.morale * 100).toFixed(0) + '%'],
                ['Shields', c.shields > 0.01 ? (c.shields * 100).toFixed(0) + '%' : 'None'],
                ['Buildings', c.settlements.length],
                ['Trait', faction.trait.charAt(0).toUpperCase() + faction.trait.slice(1)],
            ];
            const panelH = stats.length * lineH + 16;
            const px = 14, py = vh - panelH - 14;
            ctx.fillStyle = 'rgba(10,12,20,0.88)';
            ctx.beginPath(); ctx.roundRect(px, py, panelW, panelH, 8); ctx.fill();
            ctx.strokeStyle = faction ? faction.color + '55' : 'rgba(150,160,200,0.25)';
            ctx.lineWidth = 1; ctx.stroke();
            ctx.textBaseline = 'middle';
            let ly = py + 12;
            for (const [label, value] of stats) {
                ctx.globalAlpha = alpha * 0.5;
                ctx.fillStyle = '#8899aa'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
                ctx.fillText(label, px + 10, ly);
                ctx.globalAlpha = alpha * 0.9;
                ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
                ctx.fillText(String(value), px + panelW - 10, ly);
                ly += lineH;
            }
        }

        // ── Legend (bottom-right) ──
        if (c) {
            const legend = [
                ['🏠', 'Villages'], ['🏙️', 'Cities'],
                ['🚀', 'Spaceports'], ['🏰', 'Fortresses'],
                ['⛏️', 'Miners'], ['💎', 'Resources'],
            ];
            const legW = 130, legH = legend.length * 14 + 12;
            const lx = vw - legW - 14, ly2 = vh - legH - 14;
            ctx.fillStyle = 'rgba(10,12,20,0.82)';
            ctx.beginPath(); ctx.roundRect(lx, ly2, legW, legH, 6); ctx.fill();
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '10px system-ui';
            let lly = ly2 + 12;
            for (const [icon, label] of legend) {
                ctx.globalAlpha = alpha * 0.8; ctx.fillStyle = '#fff';
                ctx.fillText(icon + ' ' + label, lx + 8, lly);
                lly += 14;
            }
        }

        ctx.textBaseline = 'alphabetic';
        ctx.restore();
    }

    // ══════════════════════════════════════════════════════════════
    //  CLICK HANDLERS
    // ══════════════════════════════════════════════════════════════
    GS.handleZoomClick = function (x, y) {
        if (!GS.zoomActive) return false;
        const btn = GS._zoomBackBtn;
        if (btn && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
            GS.exitZoom(); return true;
        }
        const xb = GS._zoomCloseBtn;
        if (xb && x >= xb.x && x <= xb.x + xb.w && y >= xb.y && y <= xb.y + xb.h) {
            GS.exitZoom(); return true;
        }
        return true; // consume all clicks while zoomed
    };

})();
