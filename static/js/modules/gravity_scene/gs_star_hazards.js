// ============================================================
// Gravity Scene — Star Types & Hazards
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.classifyStar = function (b) {
        if (!b._starClass) {
            // If a sun type was set from planet collision, use that
            if (b._sunType && GS.SUN_TYPES[b._sunType]) {
                b._starClass = b._sunType;
            } else {
                const m = b.mass;
                if (m > GS.STAR_MAX * 0.85) b._starClass = 'blue_supergiant';
                else if (m > GS.STAR_MAX * 0.6) b._starClass = 'red_giant';
                else b._starClass = 'yellow';
            }
            b._starAge = 0;
            b._pulsarAngle = 0;
            b._isNuclear = false;
            b._supernovaTimer = b._starClass === 'blue_supergiant' ? (40 + Math.random() * 30) : -1;
        }
        b._starAge += 0;
        return b._starClass;
    };

    GS.drawStarHazards = function (ctx, bodies, dt) {
        for (const b of bodies) {
            const type = GS.bodyType(b.mass);
            if (type !== 'star') continue;
            const sc = GS.classifyStar(b);
            b._starAge = (b._starAge || 0) + dt;

            // Habitable zone
            const radR = b.r * 8;
            const habInner = radR * 0.4;
            const habOuter = radR * 0.6;

            ctx.globalAlpha = 0.04;
            const st = GS.SUN_TYPES[sc];
            const habColor = st ? st.glowColor + '0.4)' :
                              sc === 'blue_supergiant' ? 'rgba(100,150,255,0.5)' :
                              sc === 'red_giant' ? 'rgba(255,100,80,0.4)' :
                              'rgba(255,220,100,0.3)';
            ctx.strokeStyle = habColor;
            ctx.lineWidth = habOuter - habInner;
            ctx.beginPath();
            ctx.arc(b.x, b.y, (habInner + habOuter) / 2, 0, Math.PI * 2);
            ctx.stroke();

            // Nuclear star: green radiation pulses
            if (b._isNuclear) {
                b._nuclearPulseTimer = (b._nuclearPulseTimer || 0) + dt;
                if (b._nuclearPulseTimer > 5 + Math.random() * 3) {
                    b._nuclearPulseTimer = 0;
                    GS.spawnRing(b.x, b.y, 350, 'rgba(100,255,50,0.4)', 1.8, 3);
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
                if (b._supernovaTimer < 5 && b._supernovaTimer > 0) {
                    ctx.globalAlpha = 0.15 + 0.1 * Math.sin(b._starAge * 15);
                    ctx.fillStyle = 'rgba(255,255,255,0.9)';
                    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.5, 0, Math.PI * 2); ctx.fill();
                }
                if (b._supernovaTimer <= 0) {
                    b._supernovaTimer = -1;
                    GS.spawnCollapse(b.x, b.y, b.r);
                    GS.spawnRing(b.x, b.y, 500, 'rgba(255,255,200,0.8)', 2, 5);
                    GS.spawnRing(b.x, b.y, 350, 'rgba(255,150,50,0.6)', 1.5, 4);
                    GS.spawnFlash(b.x, b.y, 200, 'rgba(255,255,255,0.9)', 0.5);
                    GS.spawnDebris(b.x, b.y, 40, 45, 3);
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
                    // Shatter the star into fragments
                    const idx = bodies.indexOf(b);
                    if (idx >= 0) {
                        bodies.splice(idx, 1);
                        const numF = 6 + Math.floor(Math.random() * 4);
                        for (let f = 0; f < numF && bodies.length < GS.MAX_BODIES; f++) {
                            const ang = (Math.PI * 2 * f / numF) + (Math.random() - 0.5) * 0.5;
                            const spd = 200 + Math.random() * 200;
                            const fragMass = (b.mass / numF) * (0.5 + Math.random());
                            const fb = GS.createBody(
                                b.x + Math.cos(ang) * b.r * 2, b.y + Math.sin(ang) * b.r * 2,
                                Math.cos(ang) * spd, Math.sin(ang) * spd, fragMass
                            );
                            bodies.push(fb);
                        }
                    }
                }
            }

            // Red giant: pulsating expansion warning
            if (sc === 'red_giant' || sc === 'red_dwarf') {
                const pulse = 1 + 0.08 * Math.sin(b._starAge * 1.5);
                ctx.globalAlpha = 0.05;
                const rg = ctx.createRadialGradient(b.x, b.y, b.r * pulse, b.x, b.y, b.r * 3 * pulse);
                rg.addColorStop(0, 'rgba(255,100,50,0.2)');
                rg.addColorStop(1, 'rgba(255,50,20,0)');
                ctx.fillStyle = rg;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3 * pulse, 0, Math.PI * 2); ctx.fill();
            }

            // Toxic star: poison cloud pulses that damage colonies
            if (sc === 'toxic_star') {
                b._toxicTimer = (b._toxicTimer || 0) + dt;
                // Green-yellow toxic cloud
                ctx.globalAlpha = 0.06 + 0.03 * Math.sin(b._starAge * 1.8);
                const tg = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, b.r * 4.5);
                tg.addColorStop(0, 'rgba(140,220,30,0.25)');
                tg.addColorStop(0.5, 'rgba(100,180,20,0.08)');
                tg.addColorStop(1, 'rgba(80,140,10,0)');
                ctx.fillStyle = tg;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 4.5, 0, Math.PI * 2); ctx.fill();
                // Toxic spore particles
                for (let sp = 0; sp < 6; sp++) {
                    const a = b._starAge * 0.7 + (Math.PI * 2 * sp / 6);
                    const d = b.r * (1.5 + 0.5 * Math.sin(b._starAge * 2 + sp));
                    ctx.globalAlpha = 0.2 + 0.1 * Math.sin(b._starAge * 3 + sp * 1.3);
                    ctx.fillStyle = 'rgba(160,230,40,0.6)';
                    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 1.5, 0, Math.PI * 2); ctx.fill();
                }
                // Periodic toxic pulse
                if (b._toxicTimer > 7 + Math.random() * 4) {
                    b._toxicTimer = 0;
                    GS.spawnRing(b.x, b.y, 300, 'rgba(140,220,30,0.35)', 1.5, 2);
                    for (const ob of bodies) {
                        if (!ob.civ || ob === b) continue;
                        const dx = ob.x - b.x, dy = ob.y - b.y;
                        if (dx * dx + dy * dy < 300 * 300) {
                            ob.civ.population *= 0.92;
                            ob.civ.morale = Math.max(0, ob.civ.morale - 0.08);
                        }
                    }
                }
            }

            // Cosmic star: multi-spectral shimmer + reality warping
            if (sc === 'cosmic_star') {
                const t = b._starAge;
                // Shifting rainbow corona
                for (let ring = 0; ring < 3; ring++) {
                    const rHue = (t * 60 + ring * 120) % 360;
                    ctx.globalAlpha = 0.04 + 0.02 * Math.sin(t * 3 + ring);
                    const cg = ctx.createRadialGradient(b.x, b.y, b.r * (1 + ring * 0.3), b.x, b.y, b.r * (2.5 + ring * 0.8));
                    cg.addColorStop(0, `hsla(${rHue}, 80%, 70%, 0.2)`);
                    cg.addColorStop(1, `hsla(${rHue + 60}, 70%, 50%, 0)`);
                    ctx.fillStyle = cg;
                    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (2.5 + ring * 0.8), 0, Math.PI * 2); ctx.fill();
                }
                // Spiral energy trails
                ctx.globalAlpha = 0.12;
                ctx.strokeStyle = `hsl(${(t * 40) % 360}, 90%, 70%)`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let a = 0; a < Math.PI * 4; a += 0.2) {
                    const sr = b.r * (1.2 + a * 0.2);
                    const px = b.x + Math.cos(a + t * 1.5) * sr;
                    const py = b.y + Math.sin(a + t * 1.5) * sr;
                    a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                }
                ctx.stroke();
            }

            // Dark star: light-absorbing void aura
            if (sc === 'dark_star') {
                ctx.globalAlpha = 0.12;
                const dg = ctx.createRadialGradient(b.x, b.y, b.r * 0.8, b.x, b.y, b.r * 4);
                dg.addColorStop(0, 'rgba(30,15,60,0.4)');
                dg.addColorStop(0.5, 'rgba(20,10,40,0.15)');
                dg.addColorStop(1, 'rgba(10,5,20,0)');
                ctx.fillStyle = dg;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 4, 0, Math.PI * 2); ctx.fill();
                // Dim flickering sparks
                for (let sp = 0; sp < 4; sp++) {
                    const a = b._starAge * 0.5 + sp * Math.PI / 2;
                    const d = b.r * (1.8 + 0.3 * Math.sin(b._starAge * 2 + sp));
                    ctx.globalAlpha = 0.1 + 0.05 * Math.sin(b._starAge * 4 + sp);
                    ctx.fillStyle = 'rgba(100,60,180,0.5)';
                    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 1, 0, Math.PI * 2); ctx.fill();
                }
            }

            // White dwarf: intense compact glow
            if (sc === 'white_dwarf') {
                ctx.globalAlpha = 0.1 + 0.04 * Math.sin(b._starAge * 6);
                const wg = ctx.createRadialGradient(b.x, b.y, b.r * 0.3, b.x, b.y, b.r * 2.5);
                wg.addColorStop(0, 'rgba(230,240,255,0.5)');
                wg.addColorStop(0.4, 'rgba(200,215,255,0.15)');
                wg.addColorStop(1, 'rgba(180,200,255,0)');
                ctx.fillStyle = wg;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.5, 0, Math.PI * 2); ctx.fill();
            }

            // Neutron star: rapid pulsar beams
            if (sc === 'neutron_star') {
                b._pulsarAngle = (b._pulsarAngle || 0) + dt * 12;
                const pa = b._pulsarAngle;
                ctx.globalAlpha = 0.2 + 0.15 * Math.sin(b._starAge * 20);
                ctx.strokeStyle = 'rgba(180,220,255,0.7)';
                ctx.lineWidth = 2;
                const beamLen = b.r * 6;
                ctx.beginPath();
                ctx.moveTo(b.x + Math.cos(pa) * b.r, b.y + Math.sin(pa) * b.r);
                ctx.lineTo(b.x + Math.cos(pa) * beamLen, b.y + Math.sin(pa) * beamLen);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(b.x - Math.cos(pa) * b.r, b.y - Math.sin(pa) * b.r);
                ctx.lineTo(b.x - Math.cos(pa) * beamLen, b.y - Math.sin(pa) * beamLen);
                ctx.stroke();
            }

            // Plasma star: flare ejections
            if (sc === 'plasma_star') {
                const t = b._starAge;
                ctx.globalAlpha = 0.07 + 0.03 * Math.sin(t * 3);
                const pg = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, b.r * 3.5);
                pg.addColorStop(0, 'rgba(255,180,50,0.3)');
                pg.addColorStop(0.5, 'rgba(255,120,30,0.1)');
                pg.addColorStop(1, 'rgba(255,80,10,0)');
                ctx.fillStyle = pg;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3.5, 0, Math.PI * 2); ctx.fill();
                // Solar flare arcs
                for (let f = 0; f < 3; f++) {
                    const fa = t * 0.8 + f * Math.PI * 2 / 3;
                    const fR = b.r * (1.3 + 0.4 * Math.sin(t * 2 + f));
                    ctx.globalAlpha = 0.15;
                    ctx.strokeStyle = 'rgba(255,200,60,0.8)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(b.x, b.y, fR, fa - 0.3, fa + 0.3);
                    ctx.stroke();
                }
            }

            // Ice star: crystalline frost aura
            if (sc === 'ice_star') {
                ctx.globalAlpha = 0.06;
                const ig = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, b.r * 3);
                ig.addColorStop(0, 'rgba(200,220,255,0.25)');
                ig.addColorStop(1, 'rgba(180,200,240,0)');
                ctx.fillStyle = ig;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2); ctx.fill();
                // Ice crystal sparkles
                for (let ic = 0; ic < 5; ic++) {
                    const a = b._starAge * 0.3 + ic * Math.PI * 2 / 5;
                    const d = b.r * (1.5 + 0.3 * Math.sin(b._starAge * 1.5 + ic));
                    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(b._starAge * 5 + ic * 2);
                    ctx.fillStyle = 'rgba(220,235,255,0.7)';
                    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 1, 0, Math.PI * 2); ctx.fill();
                }
            }

            // Colony growth bonus in habitable zone
            for (const ob of bodies) {
                if (!ob.civ || ob === b) continue;
                const dx = ob.x - b.x, dy = ob.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > habInner && dist < habOuter) {
                    ob.civ._habBonus = true;
                }
            }
        }
        ctx.globalAlpha = 1;
    };

    GS.markNuclearStar = function (b) {
        b._isNuclear = true;
        b._nuclearPulseTimer = 0;
        b._starClass = 'nuclear';
        GS.spawnRing(b.x, b.y, 200, 'rgba(100,255,50,0.6)', 1, 3);
        GS.spawnFlash(b.x, b.y, 50, 'rgba(100,255,50,0.7)', 0.3);
    };
})();
