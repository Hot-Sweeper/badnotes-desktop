// ============================================================
// Gravity Scene — Trade Routes & Mining
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    GS.manageRoutes = function () {
        const bodies = GS.state.bodies;
        const routes = GS.state.routes;

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
    };

    GS.updateRoutes = function (dt) {
        for (const rt of GS.state.routes) {
            rt.age += dt;
            rt.shipTimer += dt;

            // Spawn trade ship every 10s per route
            if (rt.shipTimer > 10 && GS.state.rockets.length < GS.MAX_ROCKETS) {
                rt.shipTimer = 0;
                const outbound = rt.age % 20 < 10;
                const from = outbound ? rt.from : rt.to;
                const to = outbound ? rt.to : rt.from;
                if (from.civ && to.civ) {
                    GS.state.rockets.push(GS.createRocket(from, to, 'trade', rt.faction));
                }
            }
        }
    };

    GS.drawRoutes = function (ctx) {
        for (const rt of GS.state.routes) {
            const f = GS.FACTIONS[rt.faction];
            ctx.globalAlpha = 0.1;
            ctx.strokeStyle = f.color;
            ctx.lineWidth = 0.8;
            ctx.setLineDash([4, 6]);

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
    };
})();
