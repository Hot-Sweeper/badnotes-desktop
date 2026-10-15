// ============================================================
// Gravity Scene — Helper Functions (body types, colors, textures)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    // --- Core helpers ---
    GS.massToRadius = function (m) { return Math.pow(m, 0.35) * 5.0; };

    GS.bodyType = function (m) {
        if (m <= GS.ASTEROID_MAX) return 'asteroid';
        if (m <= GS.MOON_MAX)    return 'moon';
        if (m <= GS.PLANET_MAX)  return 'planet';
        if (m <= GS.STAR_MAX)    return 'star';
        return 'blackhole';
    };

    GS.pickColor = function (mass) {
        const type = GS.bodyType(mass);
        let pal;
        if (type === 'asteroid')    pal = GS.ASTEROID_COLORS;
        else if (type === 'moon')   pal = GS.MOON_COLORS;
        else if (type === 'planet') pal = GS.PLANET_COLORS;
        else                        pal = GS.STAR_COLORS;
        const c = pal[Math.floor(Math.random() * pal.length)];
        return {
            hue: c.h + (Math.random() - 0.5) * 20,
            sat: c.s + (Math.random() - 0.5) * 10,
            lit: c.l + (Math.random() - 0.5) * 10
        };
    };

    GS.createBody = function (x, y, vx, vy, mass) {
        mass = Math.max(mass, 3);
        const c = GS.pickColor(mass);
        const body = {
            x, y, vx, vy, mass, r: GS.massToRadius(mass),
            hue: c.hue, sat: c.sat, lit: c.lit,
            bhTime: 0, evapMass: mass,
            seed: Math.floor(Math.random() * 2147483647)
        };
        // Randomly assign rings to planets (~35% chance)
        if (GS.bodyType(mass) === 'planet' && Math.random() < 0.35) {
            GS.assignRings(body);
        }
        return body;
    };

    // Assign Saturn-like ring system to a body
    GS.assignRings = function (b) {
        const rng = GS.seededRng(b.seed + 777);
        const tilt = 0.15 + rng() * 0.45; // ring tilt (how elliptical they look)
        const numBands = 2 + Math.floor(rng() * 4); // 2-5 bands
        const bands = [];
        let innerR = b.r * (1.4 + rng() * 0.3);
        for (let i = 0; i < numBands; i++) {
            const width = b.r * (0.15 + rng() * 0.35);
            const hueShift = (rng() - 0.5) * 40;
            bands.push({
                innerR: innerR,
                outerR: innerR + width,
                hue: b.hue + hueShift,
                sat: Math.max(5, b.sat - 20 + rng() * 15),
                lit: b.lit + (rng() - 0.5) * 20,
                opacity: 0.15 + rng() * 0.35,
                particles: rng() > 0.5 // some bands have visible particle texture
            });
            innerR += width + b.r * (0.05 + rng() * 0.15); // gap between bands
        }
        b._rings = { tilt, bands, rotation: rng() * Math.PI * 2 };
    };

    // Seeded PRNG for deterministic procedural textures
    GS.seededRng = function (seed) {
        let s = seed | 0 || 1;
        return () => { s = (s * 16807 + 11) % 2147483647; return (s - 1) / 2147483646; };
    };

    // Pre-bake procedural body texture onto a canvas
    GS.generateBodyTexture = function (b) {
        const type = GS.bodyType(b.mass);
        const r = b.r;
        // Calculate pad: rings extend far beyond body radius
        let pad = type === 'star' ? r * 2.5 : 6;
        if (type === 'planet' && b._rings) {
            const maxR = b._rings.bands.reduce((mx, band) => Math.max(mx, band.outerR), 0);
            pad = Math.max(pad, maxR - r + 4);
        }
        const size = Math.ceil((r + pad) * 2);
        const oc = document.createElement('canvas');
        oc.width = size; oc.height = size;
        const c = oc.getContext('2d');
        const cx = size / 2, cy = size / 2;
        const rng = GS.seededRng(b.seed);

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

            // Bake back-half rings into texture if planet has rings
            if (b._rings) {
                c.save(); c.translate(cx, cy);
                c.scale(1, b._rings.tilt);
                for (const band of b._rings.bands) {
                    // Back half only (behind planet)
                    c.globalAlpha = band.opacity * 0.7;
                    c.strokeStyle = `hsl(${band.hue}, ${band.sat}%, ${band.lit}%)`;
                    c.lineWidth = band.outerR - band.innerR;
                    c.beginPath();
                    c.arc(0, 0, (band.innerR + band.outerR) / 2, 0, Math.PI);
                    c.stroke();
                    // Subtle particle texture
                    if (band.particles) {
                        const bRng = GS.seededRng(b.seed + Math.floor(band.innerR * 100));
                        const nDots = Math.floor(8 + band.outerR * 0.3);
                        for (let d = 0; d < nDots; d++) {
                            const a = bRng() * Math.PI;
                            const rr = band.innerR + bRng() * (band.outerR - band.innerR);
                            c.globalAlpha = band.opacity * (0.3 + bRng() * 0.5);
                            c.fillStyle = `hsl(${band.hue + (bRng()-0.5)*15}, ${band.sat}%, ${band.lit + (bRng()-0.5)*10}%)`;
                            c.beginPath();
                            c.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.4 + bRng() * 0.8, 0, Math.PI * 2);
                            c.fill();
                        }
                    }
                }
                c.restore();
            }

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

        // Bake front-half rings on top of planet if it has rings
        if (type === 'planet' && b._rings) {
            c.save(); c.translate(cx, cy);
            c.scale(1, b._rings.tilt);
            for (const band of b._rings.bands) {
                c.globalAlpha = band.opacity * 0.8;
                c.strokeStyle = `hsl(${band.hue}, ${band.sat}%, ${band.lit}%)`;
                c.lineWidth = band.outerR - band.innerR;
                c.beginPath();
                c.arc(0, 0, (band.innerR + band.outerR) / 2, Math.PI, Math.PI * 2);
                c.stroke();
                if (band.particles) {
                    const bRng = GS.seededRng(b.seed + Math.floor(band.innerR * 100) + 999);
                    const nDots = Math.floor(8 + band.outerR * 0.3);
                    for (let d = 0; d < nDots; d++) {
                        const a = Math.PI + bRng() * Math.PI;
                        const rr = band.innerR + bRng() * (band.outerR - band.innerR);
                        c.globalAlpha = band.opacity * (0.3 + bRng() * 0.5);
                        c.fillStyle = `hsl(${band.hue + (bRng()-0.5)*15}, ${band.sat}%, ${band.lit + (bRng()-0.5)*10}%)`;
                        c.beginPath();
                        c.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.4 + bRng() * 0.8, 0, Math.PI * 2);
                        c.fill();
                    }
                }
            }
            c.restore();
        }

        b._tex = oc;
        b._texR = r;
        b._texType = type;
        b._texSize = size;
    };
})();
