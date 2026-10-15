// ============================================================
// Gravity Scene — Diplomacy & Relations
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.updateRelations = function (dt) {
        const rel = GS.state.relations;
        const bodies = GS.state.bodies;

        // Natural decay toward neutral
        const nf = GS.FACTIONS.length;
        for (let i = 0; i < nf; i++) {
            for (let j = 0; j < nf; j++) {
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

        // Trade route peace bonus
        for (const rt of GS.state.routes) {
            if (rt.from.civ && rt.to.civ && rt.from.civ.faction !== rt.to.civ.faction) {
                const fi = rt.from.civ.faction, fj = rt.to.civ.faction;
                rel[fi][fj] = Math.min(1, rel[fi][fj] + 0.005 * dt);
                rel[fj][fi] = Math.min(1, rel[fj][fi] + 0.005 * dt);
            }
        }

        // Aggressive factions ramp hostility faster
        for (let i = 0; i < nf; i++) {
            if (GS.FACTIONS[i].trait === 'aggressive') {
                for (let j = 0; j < nf; j++) {
                    if (i === j) continue;
                    if (rel[i][j] < 0) rel[i][j] -= 0.003 * dt;
                }
            }
        }

        // Defensive factions build tolerance
        for (let i = 0; i < nf; i++) {
            if (GS.FACTIONS[i].trait === 'defensive') {
                for (let j = 0; j < nf; j++) {
                    if (i === j) continue;
                    if (rel[i][j] < 0) rel[i][j] = Math.min(0, rel[i][j] + 0.004 * dt);
                }
            }
        }
    };
})();
