// ============================================================
// Gravity Scene — Info Panel (click body to show stats)
// ============================================================
(function () {
    'use strict';
    const GS = window.GS;

    // Currently selected body (null = nothing selected)
    GS.selectedBody = null;
    GS._infoPanelFadeIn = 0; // animation progress 0-1

    // Hit test: find body under screen coordinates
    GS.hitTestBody = function (sx, sy) {
        const bodies = GS.state.bodies;
        let best = null, bestDist = Infinity;
        for (const b of bodies) {
            const dx = b.x - sx, dy = b.y - sy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const hitR = Math.max(b.r * 1.3, 12); // generous hit area
            if (dist < hitR && dist < bestDist) {
                bestDist = dist;
                best = b;
            }
        }
        return best;
    };

    // Count colonies owned by a faction
    GS.countFactionColonies = function (factionId) {
        let count = 0;
        for (const b of GS.state.bodies) {
            if (b.civ && b.civ.faction === factionId) count++;
        }
        return count;
    };

    // Draw the info panel for the selected body
    GS.drawInfoPanel = function (ctx, dt) {
        const sel = GS.selectedBody;
        if (!sel) {
            GS._infoPanelFadeIn = Math.max(0, GS._infoPanelFadeIn - dt * 5);
            if (GS._infoPanelFadeIn <= 0) return;
        } else {
            GS._infoPanelFadeIn = Math.min(1, GS._infoPanelFadeIn + dt * 5);
            // Verify body still exists
            if (!GS.state.bodies.includes(sel)) {
                GS.selectedBody = null;
                return;
            }
        }

        const b = sel || GS._lastSelectedBody;
        if (!b) return;
        if (sel) GS._lastSelectedBody = sel;

        const alpha = GS._infoPanelFadeIn;
        const type = GS.bodyType(b.mass);
        const faction = b.civ ? GS.FACTIONS[b.civ.faction] : null;

        // --- Selection ring around body ---
        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = faction ? faction.color : '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // --- Panel position: offset from body ---
        const panelW = 170;
        const lineH = 15;
        const padding = 10;
        const vw = GS.state._vw;

        // Build info lines
        const lines = [];
        const typeName = type === 'blackhole' ? 'Black Hole' : type.charAt(0).toUpperCase() + type.slice(1);
        lines.push({ label: typeName, value: '', header: true });
        lines.push({ label: 'Mass', value: Math.floor(b.mass) });
        lines.push({ label: 'Radius', value: b.r.toFixed(1) + ' px' });
        const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        lines.push({ label: 'Speed', value: Math.floor(spd) + ' px/s' });

        if (b.civ) {
            const c = b.civ;
            lines.push({ label: '', value: '', spacer: true });
            lines.push({ label: faction.name, value: '', header: true, color: faction.color });
            lines.push({ label: 'Population', value: Math.floor(c.population) });
            lines.push({ label: 'Tech Level', value: c.techLevel.toFixed(1) });
            lines.push({ label: 'Resources', value: Math.floor(c.resources) });
            if (c._dominantResource) {
                lines.push({ label: 'Specialty', value: c._dominantResource.charAt(0).toUpperCase() + c._dominantResource.slice(1) });
            }
            lines.push({ label: 'Military', value: Math.floor(c.military) });
            lines.push({ label: 'Morale', value: (c.morale * 100).toFixed(0) + '%' });
            lines.push({ label: 'Shields', value: c.shields > 0.01 ? (c.shields * 100).toFixed(0) + '%' : 'None' });
            lines.push({ label: 'Settlements', value: c.settlements.length });
            lines.push({ label: 'Age', value: Math.floor(c.age) + 's' });

            // Count faction colonies across all bodies
            const colCount = GS.countFactionColonies(c.faction);
            lines.push({ label: 'Faction Worlds', value: colCount });

            // Space base
            if (c.spaceBase) {
                lines.push({ label: 'Space Base', value: 'Active' });
            }

            // Settlement breakdown
            const types = {};
            for (const s of c.settlements) {
                types[s.type] = (types[s.type] || 0) + 1;
            }
            const breakdown = Object.entries(types).map(([k, v]) => v + ' ' + k).join(', ');
            if (breakdown) {
                lines.push({ label: 'Buildings', value: breakdown });
            }
        }

        // Nuclear / sun type info
        if (type === 'star') {
            if (b._isNuclear) lines.push({ label: 'Nuclear', value: 'Yes', color: '#44FF44' });
            if (b._sunType) {
                const st = GS.SUN_TYPES[b._sunType];
                if (st) lines.push({ label: 'Star Type', value: st.name });
            }
        }

        // Planetary rings
        if (b._rings) {
            lines.push({ label: 'Rings', value: b._rings.bands.length + ' bands' });
        }

        // Orbital relationships
        if (b._orbitParent) {
            const parentType = GS.bodyType(b._orbitParent.mass);
            const parentName = parentType === 'blackhole' ? 'Black Hole'
                : parentType.charAt(0).toUpperCase() + parentType.slice(1);
            lines.push({ label: 'Orbiting', value: parentName, color: '#88bbff' });
        }
        const orbitals = GS.getOrbitals ? GS.getOrbitals(b) : [];
        if (orbitals.length > 0) {
            lines.push({ label: 'Satellites', value: orbitals.length, color: '#88bbff' });
            const colonized = orbitals.filter(o => o.civ).length;
            if (colonized > 0) {
                lines.push({ label: 'Colonized Moons', value: colonized, color: '#88ff88' });
            }
        }

        // Extra height for Inspect button if body has civ or is interesting
        const showInspect = true; // always show inspect for any body
        const inspectBtnH = showInspect ? 28 : 0;
        const panelH = lines.length * lineH + padding * 2 + inspectBtnH;

        // Position panel to the right of body, or left if near right edge
        let px = b.x + b.r + 16;
        let py = b.y - panelH / 2;
        if (px + panelW > vw - 10) px = b.x - b.r - 16 - panelW;
        const vh = GS.state._vh;
        if (py < 10) py = 10;
        if (py + panelH > vh - 10) py = vh - 10 - panelH;

        // --- Draw panel background ---
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = 'rgba(10, 12, 20, 0.92)';
        const cornerR = 8;
        ctx.beginPath();
        ctx.moveTo(px + cornerR, py);
        ctx.lineTo(px + panelW - cornerR, py);
        ctx.quadraticCurveTo(px + panelW, py, px + panelW, py + cornerR);
        ctx.lineTo(px + panelW, py + panelH - cornerR);
        ctx.quadraticCurveTo(px + panelW, py + panelH, px + panelW - cornerR, py + panelH);
        ctx.lineTo(px + cornerR, py + panelH);
        ctx.quadraticCurveTo(px, py + panelH, px, py + panelH - cornerR);
        ctx.lineTo(px, py + cornerR);
        ctx.quadraticCurveTo(px, py, px + cornerR, py);
        ctx.closePath();
        ctx.fill();

        // Border
        ctx.globalAlpha = alpha * 0.4;
        ctx.strokeStyle = faction ? faction.color : 'rgba(150,160,200,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // --- Connector line from body to panel ---
        ctx.globalAlpha = alpha * 0.25;
        ctx.strokeStyle = faction ? faction.color : '#88aacc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        const connX = px < b.x ? px + panelW : px;
        ctx.lineTo(connX, py + panelH / 2);
        ctx.stroke();

        // --- Draw text lines ---
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let ly = py + padding;

        for (const line of lines) {
            if (line.spacer) { ly += lineH * 0.4; continue; }

            if (line.header) {
                ctx.globalAlpha = alpha * 0.95;
                ctx.fillStyle = line.color || '#fff';
                ctx.font = 'bold 12px system-ui';
                ctx.fillText(line.label, px + padding, ly);
                ly += lineH;
                continue;
            }

            // Label
            ctx.globalAlpha = alpha * 0.55;
            ctx.fillStyle = '#aabbcc';
            ctx.font = '10px system-ui';
            ctx.fillText(line.label, px + padding, ly);

            // Value
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = line.color || '#fff';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'right';
            ctx.fillText(String(line.value), px + panelW - padding, ly);
            ctx.textAlign = 'left';

            ly += lineH;
        }

        // --- Inspect / Zoom button ---
        if (showInspect && sel) {
            const iBtnW = panelW - padding * 2;
            const iBtnH = 22;
            const iBtnX = px + padding;
            const iBtnY = py + panelH - inspectBtnH - padding / 2 + 4;

            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = faction ? faction.color + '33' : 'rgba(80,120,200,0.25)';
            ctx.beginPath();
            ctx.roundRect(iBtnX, iBtnY, iBtnW, iBtnH, 5);
            ctx.fill();
            ctx.strokeStyle = faction ? faction.color + '88' : 'rgba(100,140,220,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔍 Inspect', iBtnX + iBtnW / 2, iBtnY + iBtnH / 2);
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';

            // Store button bounds for click detection
            GS._inspectBtnBounds = { x: iBtnX, y: iBtnY, w: iBtnW, h: iBtnH };
        } else {
            GS._inspectBtnBounds = null;
        }

        ctx.restore();
    };
})();
