// ============================================================
// Gravity Scene — Orbital Mechanics (capture, stabilization, decay, visuals)
// ============================================================
// Bodies can enter stable orbits around heavier bodies when conditions are right.
// A gentle velocity correction compensates for Euler integration energy drift,
// keeping orbits alive. Orbits can break from perturbation or speed changes.
// Colonies on planets will prioritize spreading to their orbiting moons.
(function () {
    'use strict';
    const GS = window.GS;

    // --- Orbital tunables ---
    const MASS_RATIO_MIN   = 4;     // Parent must be ≥4× heavier to capture
    const DIST_MIN_RADII   = 1.6;   // Min orbit distance in parent radii
    const DIST_MAX_RADII   = 10;    // Max capture distance in parent radii
    const SPEED_LO         = 0.45;  // Accept down to 45% of v_circ
    const SPEED_HI         = 1.7;   // Accept up to 170% of v_circ
    const TAN_RATIO        = 1.2;   // Tangential must be ≥1.2× radial for capture
    const STABILIZE_RAD    = 0.025; // Radial damping per integration step
    const STABILIZE_TAN    = 0.012; // Tangential correction per step
    const BREAK_SPEED_MUL  = 2.2;   // Orbit breaks if speed > 2.2× v_circ
    const BREAK_DIST_MUL   = 1.6;   // Orbit breaks if dist > max * 1.6
    const TRAIL_LEN        = 50;    // Orbit trail dot count
    const CAPTURE_PERIOD   = 0.4;   // Seconds between capture scans

    let captureTimer = 0;

    // ── Circular orbit speed at distance r from mass M (with sim softening) ──
    function vCircular(M, r) {
        return Math.sqrt(GS.G * M * r / (r * r + 200));
    }

    // ══════════════════════════════════════════════════════════════════
    //  UPDATE — called every frame from gs_main draw loop
    // ══════════════════════════════════════════════════════════════════
    GS.updateOrbits = function (dt, bodies) {
        // --- Periodic capture scan ---
        captureTimer += dt;
        if (captureTimer >= CAPTURE_PERIOD) {
            captureTimer = 0;
            scanForCaptures(bodies);
        }

        // --- Stabilize existing orbits ---
        for (let i = bodies.length - 1; i >= 0; i--) {
            const b = bodies[i];
            if (!b._orbitParent) continue;
            const parent = b._orbitParent;

            // Parent gone?
            if (!bodies.includes(parent)) {
                clearOrbit(b);
                continue;
            }

            // --- Measure orbital state ---
            const dx = b.x - parent.x;
            const dy = b.y - parent.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Too close → will merge naturally; too far → escaped
            if (dist < parent.r * 1.1 || dist > parent.r * DIST_MAX_RADII * BREAK_DIST_MUL) {
                clearOrbit(b);
                continue;
            }

            // Radial & tangential decomposition of relative velocity
            const nx = dx / dist;              // radial outward
            const ny = dy / dist;
            const tx = -ny;                    // tangential (CCW)
            const ty = nx;
            const rvx = b.vx - parent.vx;
            const rvy = b.vy - parent.vy;
            const vRad = rvx * nx + rvy * ny;  // radial component
            const vTan = rvx * tx + rvy * ty;  // tangential component
            const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy);

            // Escape check
            const vC = vCircular(parent.mass, dist);
            if (relSpeed > vC * BREAK_SPEED_MUL) {
                clearOrbit(b);
                continue;
            }

            // Third-body perturbation check: if another body of comparable mass
            // is very close, break the orbit (tidal disruption)
            let disrupted = false;
            for (const other of bodies) {
                if (other === b || other === parent) continue;
                if (other.mass < b.mass * 0.5) continue; // too small to disrupt
                const odx = other.x - b.x, ody = other.y - b.y;
                const oDist = Math.sqrt(odx * odx + ody * ody);
                if (oDist < dist * 0.4 && other.mass > parent.mass * 0.3) {
                    disrupted = true;
                    break;
                }
            }
            if (disrupted) {
                clearOrbit(b);
                continue;
            }

            // --- Apply gentle stabilization ---
            // Orbital direction is locked at capture
            const dir = b._orbitDir;
            const idealVTan = vC * dir;

            // Damp radial velocity (prevents drifting in/out)
            const radDamp = STABILIZE_RAD * dt * 60;
            // Nudge tangential toward ideal (compensates Euler energy loss)
            const tanNudge = STABILIZE_TAN * dt * 60;

            b.vx += (-vRad * radDamp * nx) + ((idealVTan - vTan) * tanNudge * tx);
            b.vy += (-vRad * radDamp * ny) + ((idealVTan - vTan) * tanNudge * ty);

            // --- Record orbit trail (relative to parent, so it follows) ---
            if (!b._orbitTrail) b._orbitTrail = [];
            const trail = b._orbitTrail;
            // Detect screen-edge wrap: if offset jumped too far, clear trail
            if (trail.length > 0) {
                const prev = trail[trail.length - 1];
                const jdx = dx - prev.rx, jdy = dy - prev.ry;
                if (jdx * jdx + jdy * jdy > (dist * 2) * (dist * 2)) {
                    trail.length = 0;
                }
            }
            trail.push({ rx: dx, ry: dy });
            if (trail.length > TRAIL_LEN) trail.shift();
        }
    };

    // ══════════════════════════════════════════════════════════════════
    //  CAPTURE SCAN — find new orbital relationships
    // ══════════════════════════════════════════════════════════════════
    function scanForCaptures(bodies) {
        for (const b of bodies) {
            if (b._orbitParent) continue; // already orbiting

            const bType = GS.bodyType(b.mass);
            // Black holes and stars are too massive to become orbitals
            if (bType === 'blackhole' || bType === 'star') continue;

            let bestParent = null;
            let bestScore = Infinity;

            for (const parent of bodies) {
                if (parent === b) continue;
                // Must be significantly heavier
                if (parent.mass < b.mass * MASS_RATIO_MIN) continue;

                // If parent is itself orbiting something, allow multi-level
                // but limit depth to 2 (moon → planet → star)
                if (parent._orbitParent && parent._orbitParent._orbitParent) continue;

                const dx = b.x - parent.x;
                const dy = b.y - parent.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Distance bounds
                if (dist < parent.r * DIST_MIN_RADII) continue;
                if (dist > parent.r * DIST_MAX_RADII) continue;

                // Relative velocity
                const rvx = b.vx - parent.vx;
                const rvy = b.vy - parent.vy;
                const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy);

                // Circular orbit speed at this distance
                const vC = vCircular(parent.mass, dist);

                // Speed within acceptance window
                if (relSpeed < vC * SPEED_LO || relSpeed > vC * SPEED_HI) continue;

                // Tangential vs radial decomposition
                const nx = dx / dist;
                const ny = dy / dist;
                const tx = -ny;
                const ty = nx;
                const vTan = Math.abs(rvx * tx + rvy * ty);
                const vRad = Math.abs(rvx * nx + rvy * ny);

                // Must be moving mostly tangentially (orbiting, not falling in)
                if (vTan < vRad * TAN_RATIO) continue;

                // Don't capture if body is already heading straight at parent
                // (dot product of velocity with radial direction is positive = outward)
                // This is fine; we just need tangential dominance checked above.

                // Score: prefer bodies closest to ideal circular orbit
                const speedDev = Math.abs(relSpeed - vC) / vC;
                const score = speedDev + dist / (parent.r * DIST_MAX_RADII);

                if (score < bestScore) {
                    bestScore = score;
                    bestParent = parent;
                }
            }

            if (bestParent) {
                b._orbitParent = bestParent;
                b._orbitTrail = [];

                // Lock initial orbit direction (CW or CCW)
                const dx = b.x - bestParent.x;
                const dy = b.y - bestParent.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const tx = -dy / dist;
                const ty = dx / dist;
                const rvx = b.vx - bestParent.vx;
                const rvy = b.vy - bestParent.vy;
                const vTan = rvx * tx + rvy * ty;
                b._orbitDir = vTan >= 0 ? 1 : -1;
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  DRAW — orbit rings, trails, and tethers
    // ══════════════════════════════════════════════════════════════════
    GS.drawOrbits = function (ctx, bodies, time) {
        for (const b of bodies) {
            if (!b._orbitParent) continue;
            const parent = b._orbitParent;
            if (!bodies.includes(parent)) continue;

            const dx = b.x - parent.x;
            const dy = b.y - parent.y;
            const orbitR = Math.sqrt(dx * dx + dy * dy);

            // Skip drawing when body is across screen from parent (edge wrap)
            const vw = GS.state._vw, vh = GS.state._vh;
            if (orbitR > Math.max(vw, vh) * 0.5) continue;

            ctx.save();

            // Faint circular orbit path (dashed)
            ctx.globalAlpha = 0.06;
            ctx.strokeStyle = 'rgba(140, 175, 255, 1)';
            ctx.lineWidth = 0.6;
            ctx.setLineDash([3, 7]);
            ctx.beginPath();
            ctx.arc(parent.x, parent.y, orbitR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Orbit trail (fading dots relative to parent position)
            if (b._orbitTrail && b._orbitTrail.length > 2) {
                const trail = b._orbitTrail;
                const vw = GS.state._vw, vh = GS.state._vh;
                for (let i = 0; i < trail.length; i++) {
                    const px = parent.x + trail[i].rx;
                    const py = parent.y + trail[i].ry;
                    // Skip dots that are off-screen (avoids wrap artifacts)
                    if (px < -20 || px > vw + 20 || py < -20 || py > vh + 20) continue;
                    const t = i / trail.length;
                    ctx.globalAlpha = t * t * 0.12;
                    ctx.fillStyle = 'rgba(140, 175, 255, 1)';
                    ctx.beginPath();
                    ctx.arc(px, py, 0.7, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Direction indicator: tiny arrow along orbit
            const angle = Math.atan2(dy, dx);
            const arrowAng = angle + b._orbitDir * 0.3;
            const ax = parent.x + Math.cos(arrowAng) * orbitR;
            const ay = parent.y + Math.sin(arrowAng) * orbitR;
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = 'rgba(140, 175, 255, 1)';
            ctx.beginPath();
            ctx.arc(ax, ay, 1.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    };

    // ══════════════════════════════════════════════════════════════════
    //  UTILITIES
    // ══════════════════════════════════════════════════════════════════

    // Clear orbital data from a body
    function clearOrbit(b) {
        b._orbitParent = null;
        b._orbitTrail = null;
        b._orbitDir = undefined;
    }
    GS.clearOrbit = clearOrbit;

    // Clear all orbitals of a given parent (call when parent is destroyed/merged)
    GS.clearOrbitalsOf = function (parent) {
        for (const b of GS.state.bodies) {
            if (b._orbitParent === parent) {
                clearOrbit(b);
            }
        }
    };

    // Transfer orbitals from one parent to another (when parents merge)
    GS.transferOrbitals = function (from, to) {
        for (const b of GS.state.bodies) {
            if (b._orbitParent === from) {
                b._orbitParent = to;
                b._orbitTrail = []; // reset trail for new parent
            }
        }
    };

    // Get all bodies currently orbiting a parent
    GS.getOrbitals = function (parent) {
        const result = [];
        for (const b of GS.state.bodies) {
            if (b._orbitParent === parent) result.push(b);
        }
        return result;
    };

    // Get orbit parent chain (e.g. moon → planet → star)
    GS.getOrbitChain = function (b) {
        const chain = [];
        let current = b._orbitParent;
        while (current && chain.length < 5) {
            chain.push(current);
            current = current._orbitParent;
        }
        return chain;
    };
})();
