// ============== Toolbox - Draggable Classroom Tools ==============
const Toolbox = (() => {
    let isOpen = false;
    let activeTools = [];
    let dragGhost = null;
    let toolIdCounter = 0;
    let lastSyncZoom = -1, lastSyncPanX = -1, lastSyncPanY = -1;
    // no extra state needed for hidden scenes

    // ===== Coordinate Helpers =====
    // Convert screen pixel position to canvas coordinates
    function screenToCanvas(sx, sy) {
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            const vp = ViewportManager.state;
            return {
                x: (sx - vp.panX) / vp.zoom,
                y: (sy - vp.panY) / vp.zoom
            };
        }
        // Fallback: use globals
        const z = (typeof zoom !== 'undefined') ? zoom : 1;
        const px = (typeof panX !== 'undefined') ? panX : 0;
        const py = (typeof panY !== 'undefined') ? panY : 0;
        return { x: (sx - px) / z, y: (sy - py) / z };
    }

    // Convert canvas coordinates to screen pixel position
    function canvasToScreen(cx, cy) {
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            const vp = ViewportManager.state;
            return {
                x: cx * vp.zoom + vp.panX,
                y: cy * vp.zoom + vp.panY
            };
        }
        const z = (typeof zoom !== 'undefined') ? zoom : 1;
        const px = (typeof panX !== 'undefined') ? panX : 0;
        const py = (typeof panY !== 'undefined') ? panY : 0;
        return { x: cx * z + px, y: cy * z + py };
    }

    // ===== Constants =====
    // 1 cm = 48px (2 grid squares of 24px each)
    const CM = 48;

    // ===== Tool Definitions =====
    const TOOLS = {
        geodreieck: { name: 'Geodreieck', emoji: '📐', desc: '16cm triangle ruler', width: 16 * CM + 20, height: 8 * CM + 20, render: renderGeodreieck },
        ruler: { name: 'Ruler', emoji: '📏', desc: '20cm ruler', width: 20 * CM + 20, height: Math.round(1.5 * CM), render: renderRuler },
        protractor: { name: 'Protractor', emoji: '🔵', desc: '180° protractor (r=5cm)', width: 10 * CM + 20, height: 5 * CM + 30, render: renderProtractor },
        clock: { name: 'Clock', emoji: '🕐', desc: 'Live analog clock', width: 4 * CM, height: 4 * CM, render: renderClock },
        digitalclock: { name: 'Digital Clock', emoji: '⏱️', desc: 'Digital time display', width: Math.round(4.5 * CM), height: Math.round(1.5 * CM), render: renderDigitalClock },
        sticky: { name: 'Sticky Note', emoji: '📝', desc: 'Editable sticky note', width: 4 * CM, height: 4 * CM, render: renderStickyNote },
        compass: { name: 'Compass', emoji: '🧭', desc: 'Drawing compass', width: 4 * CM, height: Math.round(5.5 * CM), render: renderCompass },
        calculator: { name: 'TI-30X Plus', emoji: '🔢', desc: 'Scientific calculator', width: 6 * CM, height: 11 * CM, render: renderCalculator, isToy: true }
    };

    // ===== Toy Definitions =====
    const TOYS = {
        bubblewrap: { name: 'Bubble Wrap', emoji: '🫧', desc: 'Pop all the bubbles!', width: 6 * CM, height: 6 * CM, render: renderBubbleWrap, isToy: true },
        stressball: { name: 'Stress Ball', emoji: '🔴', desc: 'Squish it, poke it', width: 4 * CM, height: 4 * CM, render: renderStressBall, isToy: true },
        spinner: { name: 'Fidget Spinner', emoji: '🌀', desc: 'Flick to spin', width: 4 * CM, height: 4 * CM, render: renderFidgetSpinner, isToy: true },
        breathing: { name: 'Breathing Circle', emoji: '🧘', desc: 'Calm breathing guide', width: 4 * CM, height: 4 * CM, render: renderBreathingCircle, isToy: true },
        newtonscradle: { name: "Newton's Cradle", emoji: '⚪', desc: 'Pull and release', width: 5 * CM, height: 4 * CM, render: renderNewtonsCradle, isToy: true },
        infinityspinner: { name: 'Infinity Trace', emoji: '♾️', desc: 'Mesmerizing trail', width: 4 * CM, height: 3 * CM, render: renderInfinitySpinner, isToy: true },
        lavalamp: { name: 'Lava Lamp', emoji: '🪩', desc: 'Gooey floating blobs', width: 3 * CM, height: 5 * CM, render: renderLavaLamp, isToy: true },
        magnetsand: { name: 'Magnetic Sand', emoji: '🧲', desc: 'Iron filings follow you', width: 4 * CM, height: 4 * CM, render: renderMagnetSand, isToy: true },
        zenpond: { name: 'Zen Pond', emoji: '💧', desc: 'Tap for ripples', width: 4 * CM, height: 4 * CM, render: renderZenPond, isToy: true },
        chainrope: { name: 'Chain Rope', emoji: '⛓️', desc: 'Grab and fling it', width: 4 * CM, height: 5 * CM, render: renderChainRope, isToy: true },
        jellycube: { name: 'Jelly Cube', emoji: '🟩', desc: 'Wobbly soft body', width: 4 * CM, height: 4 * CM, render: renderJellyCube, isToy: true },
        pendulumwave: { name: 'Pendulum Wave', emoji: '🎵', desc: 'Hypnotic wave pattern', width: 5 * CM, height: 4 * CM, render: renderPendulumWave, isToy: true },
        kaleidoscope: { name: 'Kaleidoscope', emoji: '🔮', desc: 'Draw symmetric art', width: 4 * CM, height: 4 * CM, render: renderKaleidoscope, isToy: true },
        fidgetclicker: { name: 'Fidget Clicker', emoji: '🔢', desc: 'Click. Count. Satisfy.', width: 3 * CM, height: 3 * CM, render: renderFidgetClicker, isToy: true },
        staticbox: { name: 'Box Barrier', emoji: '📦', desc: 'Static box collider', width: 4 * CM, height: 2 * CM, render: renderStaticBox, isToy: true },
        staticball: { name: 'Ball Barrier', emoji: '⚫', desc: 'Static ball collider', width: 3 * CM, height: 3 * CM, render: renderStaticBall, isToy: true },
        staticwall: { name: 'Wall Barrier', emoji: '🧱', desc: 'Vertical wall collider', width: 1.5 * CM, height: 6 * CM, render: renderStaticWall, isToy: true },
        staticfloor: { name: 'Floor Barrier', emoji: '➖', desc: 'Horizontal floor platform', width: 8 * CM, height: CM, render: renderStaticFloor, isToy: true },
        rigiball: { name: 'Bouncy Ball', emoji: '🏀', desc: 'Ball with gravity & bounce', width: 3 * CM, height: 4 * CM, render: renderRigiBall, isToy: true },
        rigicrate: { name: 'Physics Crate', emoji: '📤', desc: 'Box with gravity & bounce', width: 3 * CM, height: 3 * CM, render: renderRigiCrate, isToy: true },
        particlescene: { name: 'Particle Scene', emoji: '✨', desc: 'Fullscreen particles, grab & fling!', width: 1, height: 1, render: renderParticleScene, isToy: true, isScene: true },
        gravityscene: { name: 'Gravity Scene', emoji: '🌌', desc: 'Spawn planets, hold for black holes!', width: 1, height: 1, render: renderGravityScene, isToy: true, isScene: true },
        gameboy: { name: 'Game Boy', emoji: '🎮', desc: 'Retro games arcade', width: 6 * CM, height: 9 * CM, render: renderGameBoy, isToy: true }
    };

    // ===== Camera synchronization =====
    // Called in the same camera paint, never a perpetual idle RAF per ruler.
    function syncViewport() {
        if (activeTools.length === 0) return;

        // Read current viewport
        let z, px, py;
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) {
            z = ViewportManager.state.zoom;
            px = ViewportManager.state.panX;
            py = ViewportManager.state.panY;
        } else {
            z = (typeof zoom !== 'undefined') ? zoom : 1;
            px = (typeof panX !== 'undefined') ? panX : 0;
            py = (typeof panY !== 'undefined') ? panY : 0;
        }

        // Only update if viewport changed
        if (z !== lastSyncZoom || px !== lastSyncPanX || py !== lastSyncPanY) {
            lastSyncZoom = z; lastSyncPanX = px; lastSyncPanY = py;
            for (const t of activeTools) {
                if (t.pinned || t._dragging || t.isScene) continue;
                const screen = canvasToScreen(t.canvasX, t.canvasY);
                applyPosition(t, screen.x, screen.y);
            }
        }
    }
    function startSyncLoop() { syncViewport(); }
    window.syncToolboxViewport=syncViewport;

    function applyPosition(toolData, screenX, screenY) {
        const el = toolData.element;
        if (!el) return;
        el.style.left = screenX + 'px';
        el.style.top = screenY + 'px';
        // Unpinned tools scale with canvas zoom so markings match the grid
        const z = toolData.pinned ? 1 : getZoom();
        const s = (toolData.userScale || 1) * z;
        el.style.transform = `rotate(${toolData.rotation}deg) scale(${s})`;
        el.style.transformOrigin = '0 0';
        toolData._toyState?._onScaleChanged?.();
    }

    function getZoom() {
        if (typeof ViewportManager !== 'undefined' && ViewportManager.state) return ViewportManager.state.zoom;
        return (typeof zoom !== 'undefined') ? zoom : 1;
    }

    // ===== Drawer UI =====
    function init() {
        const btn = document.getElementById('toolboxBtn');
        if (!btn) return;
        btn.tabIndex=0;btn.setAttribute('role','button');btn.setAttribute('aria-label','Open toolbox');
        btn.setAttribute('aria-haspopup','dialog');btn.setAttribute('aria-controls','toolboxDrawer');btn.setAttribute('aria-expanded','false');
        btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggle();if(isOpen)document.querySelector('#toolboxDrawer button')?.focus({preventScroll:true});}});
        btn.addEventListener('click', toggle);
        document.addEventListener('pointerdown', (e) => {
            if (!isOpen) return;
            const drawer = document.getElementById('toolboxDrawer');
            if (drawer && !drawer.contains(e.target) && !btn.contains(e.target)) close();
        });

        // H key toggles visibility of active scene toys
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
            if (e.key === 'h' || e.key === 'H') {
                const scene = activeTools.find(t => t.isScene);
                if (!scene) return;
                const hideBtn = scene._btnWrap?.querySelector('.scene-hide-btn');
                if (hideBtn) toggleSceneVisibility(scene, hideBtn);
            }
        });
    }

    function toggle() { isOpen ? close() : open(); }

    function open() {
        isOpen = true;
        let drawer = document.getElementById('toolboxDrawer');
        if (!drawer) drawer = createDrawer();
        drawer.inert=false;
        drawer.classList.add('open');
        document.getElementById('toolboxBtn')?.classList.add('active');
        document.getElementById('toolboxBtn')?.setAttribute('aria-expanded','true');
    }

    function close() {
        isOpen = false;
        const drawer = document.getElementById('toolboxDrawer');
        if (drawer) {drawer.classList.remove('open');drawer.inert=true;}
        document.getElementById('toolboxBtn')?.classList.remove('active');
        document.getElementById('toolboxBtn')?.setAttribute('aria-expanded','false');
    }

    // One rounded, monochrome icon family, shared by cards and pickup ghosts.
    function toolIcon(type) {
        const paths={
            geodreieck:'<path d="M4 20 20 4v16H4Z M10 17h7v-7M8 20v-2M12 20v-2M16 20v-2"/>',
            ruler:'<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v4M11 7v3M15 7v4M19 7v3"/>',
            protractor:'<path d="M3 19a9 9 0 0 1 18 0H3Zm4 0a5 5 0 0 1 10 0M12 10v2M6 13l2 2M18 13l-2 2"/>',
            clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
            digitalclock:'<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10v4M10 10v4M14 10v4M17 10v4"/>',
            sticky:'<path d="M5 3h14a2 2 0 0 1 2 2v9l-7 7H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 18v-5a2 2 0 0 1 2-2h5M7 8h10M7 12h6"/>',
            compass:'<path d="M12 3v3M8 20l4-14 4 14M8 14h8"/><circle cx="12" cy="7" r="2"/>',
            calculator:'<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M8 6h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 19h1M12 19h1M16 19h1"/>',
            bubblewrap:'<circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/>',
            stressball:'<path d="M19 6c4 6 1 15-7 15S1 12 5 6c3-4 10-4 14 0ZM7 10c0-2 2-3 4-3"/>',
            spinner:'<circle cx="12" cy="12" r="2"/><path d="M10 10C2 8 4 1 9 3c4 1 3 5 3 7M14 11c6-6 11-1 7 3-3 3-6 0-7-1M11 14c1 8-6 9-7 4-1-4 3-5 6-5"/>',
            breathing:'<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/>',
            newtonscradle:'<path d="M3 20V4h18v16M7 4v10M12 4v10M17 4v10"/><circle cx="7" cy="16" r="2"/><circle cx="12" cy="16" r="2"/><circle cx="17" cy="16" r="2"/>',
            infinityspinner:'<path d="M12 12c-8-11-15 7-5 5 3 0 7-10 10-10 10-2 3 16-5 5Z"/>',
            lavalamp:'<path d="m8 3-3 16h14L16 3H8ZM5 22h14"/><ellipse cx="10" cy="13" rx="2" ry="3"/><circle cx="14" cy="8" r="2"/>',
            magnetsand:'<path d="M5 4v10a7 7 0 0 0 14 0V4h-4v10a3 3 0 0 1-6 0V4H5ZM5 8h4M15 8h4"/>',
            zenpond:'<path d="M12 3c2 3 5 6 5 9a5 5 0 0 1-10 0c0-3 3-6 5-9ZM4 19c2 3 14 3 16 0M2 22h20"/>',
            chainrope:'<path d="m9 15 6-6M8 12l-2 2a4 4 0 0 0 6 6l2-2M10 6l2-2a4 4 0 0 1 6 6l-2 2"/>',
            jellycube:'<path d="M4 7c0-5 16-5 16 0l1 11c0 5-18 5-18 0L4 7ZM4 7c1 3 15 3 16 0"/>',
            pendulumwave:'<path d="M3 4h18M6 4v10M12 4v13M18 4v10"/><circle cx="6" cy="16" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="18" cy="16" r="2"/>',
            kaleidoscope:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 0v20M3 7l18 10M21 7 3 17"/>',
            fidgetclicker:'<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="4"/>',
            staticbox:'<rect x="3" y="6" width="18" height="12" rx="2"/>',
            staticball:'<circle cx="12" cy="12" r="8"/>',
            staticwall:'<path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8"/>',
            staticfloor:'<path d="M2 16h20M5 16l-3 5M10 16l-3 5M15 16l-3 5M20 16l-3 5"/>',
            rigiball:'<circle cx="12" cy="9" r="6"/><path d="M6 9h12M12 3v12M4 21c4-3 12-3 16 0"/>',
            rigicrate:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10v10M3 7l9 5 9-5"/>',
            particlescene:'<circle cx="7" cy="7" r="3"/><circle cx="17" cy="16" r="4"/><circle cx="5" cy="19" r="1"/><circle cx="20" cy="4" r="1"/>',
            gravityscene:'<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="6"/>',
            assistant:'<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2ZM8 9h8M8 13h5"/>',
            gameboy:'<rect x="5" y="2" width="14" height="20" rx="3"/><rect x="8" y="5" width="8" height="6" rx="1"/><path d="M7 16h6M10 13v6M16 14h1M16 18h1"/>',
            pin:'<path d="m8 3 8 0-1 6 4 4H5l4-4-1-6ZM12 13v8"/>',
            bag:'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M8 10v4M16 10v4"/>',
            trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 14a2 2 0 0 0 2 1h6a2 2 0 0 0 2-1l1-14M10 10v7M14 10v7"/>',
            rotate:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
            eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
            close:'<path d="m6 6 12 12M18 6 6 18"/>'
        };
        return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[type]||paths.spinner)+'</svg>';
    }

    function createDrawer() {
        const drawer = document.createElement('div');
        drawer.id = 'toolboxDrawer';
        drawer.className = 'toolbox-drawer';
        drawer.setAttribute('role','dialog');drawer.setAttribute('aria-label','Tools and toys');

        const toolItems = Object.entries(TOOLS).map(([key, tool]) => `
            <button type="button" class="toolbox-drawer-item" data-tool-type="${key}">
                <span class="toolbox-item-icon">${toolIcon(key)}</span>
                <div class="toolbox-item-info">
                    <span class="toolbox-item-name">${tool.name}</span>
                    <span class="toolbox-item-desc">${tool.desc}</span>
                </div>
            </button>
        `).join('');

        const toyItems = Object.entries(TOYS).map(([key, toy]) => `
            <button type="button" class="toolbox-drawer-item" data-tool-type="${key}" data-is-toy="true">
                <span class="toolbox-item-icon">${toolIcon(key)}</span>
                <div class="toolbox-item-info">
                    <span class="toolbox-item-name">${toy.name}</span>
                    <span class="toolbox-item-desc">${toy.desc}</span>
                </div>
            </button>
        `).join('');

        drawer.innerHTML = `
            <div class="toolbox-drawer-header">
                <div class="toolbox-category-tabs">
                    <button type="button" class="toolbox-tab active" data-category="tools" aria-pressed="true">Tools</button>
                    <button type="button" class="toolbox-tab" data-category="toys" aria-pressed="false">Toys</button>
                </div>
                <button type="button" class="bn-icon-button" data-toolbox-close aria-label="Close toolbox"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            </div>
            <button type="button" class="bn-button toolbox-assistant">${toolIcon('assistant')}<span>Assistant</span><small>Ctrl+Shift+Enter</small></button>
            <div class="toolbox-drawer-items" data-category-panel="tools">
                ${toolItems}
            </div>
            <div class="toolbox-drawer-items" data-category-panel="toys" style="display:none">
                ${toyItems}
            </div>
        `;
        document.body.appendChild(drawer);
        drawer.querySelector('[data-toolbox-close]').onclick=()=>{close();document.getElementById('toolboxBtn')?.focus({preventScroll:true});};
        drawer.querySelector('.toolbox-assistant').onclick=()=>{close();document.getElementById('toolboxBtn')?.focus({preventScroll:true});window.AIHelper?.showPrompt();};
        drawer.addEventListener('keydown',e=>{
            if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();document.getElementById('toolboxBtn')?.focus({preventScroll:true});}
            const item=e.target.closest('[data-tool-type]');
            if(item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();const type=item.dataset.toolType,tool=TOOLS[type]||TOYS[type];placeTool(type,innerWidth/2-tool.width/2,innerHeight/2-tool.height/2);close();}
        });

        // Category tab switching
        drawer.querySelectorAll('.toolbox-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                drawer.querySelectorAll('.toolbox-tab').forEach(t => t.classList.remove('active'));
                drawer.querySelectorAll('.toolbox-tab').forEach(t=>t.setAttribute('aria-pressed',String(t===tab)));
                tab.classList.add('active');
                const cat = tab.dataset.category;
                drawer.querySelectorAll('[data-category-panel]').forEach(panel => {
                    panel.style.display = panel.dataset.categoryPanel === cat ? '' : 'none';
                });
            });
        });

        setupDrawerDrag(drawer);
        return drawer;
    }

    function setupDrawerDrag(drawer) {
        drawer.querySelectorAll('.toolbox-drawer-item').forEach(item => {
            item.addEventListener('pointerdown', (e) => {
                const type = item.dataset.toolType;
                const tool = TOOLS[type] || TOYS[type];
                if (!tool) return;

                const startX = e.clientX, startY = e.clientY;
                const pointerId = e.pointerId;
                let holdTimer = null;
                let dragging = false;
                let cancelled = false;

                // After hold delay, start drag mode
                holdTimer = setTimeout(() => {
                    if (cancelled) return;
                    dragging = true;
                    // Capture pointer for drag
                    try { item.setPointerCapture(pointerId); } catch (_) {}

                    dragGhost = document.createElement('div');
                    dragGhost.className = 'toolbox-drag-ghost';
                    dragGhost.innerHTML = toolIcon(type);
                    dragGhost.style.left = (startX - 30) + 'px';
                    dragGhost.style.top = (startY - 30) + 'px';
                    document.body.appendChild(dragGhost);

                    // Visual feedback
                    item.style.opacity = '0.5';
                }, 300);

                const onMove = (ev) => {
                    if (dragging && dragGhost) {
                        ev.preventDefault();
                        dragGhost.style.left = (ev.clientX - 30) + 'px';
                        dragGhost.style.top = (ev.clientY - 30) + 'px';
                    } else if (!dragging) {
                        // If moved too much before hold triggers, cancel drag (user is scrolling)
                        const dx = ev.clientX - startX, dy = ev.clientY - startY;
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                            cancelled = true;
                            clearTimeout(holdTimer);
                            cleanup();
                        }
                    }
                };

                const onUp = (ev) => {
                    clearTimeout(holdTimer);
                    if (dragging) {
                        // Drop the tool
                        if (dragGhost) { dragGhost.remove(); dragGhost = null; }
                        const dropX = ev.clientX, dropY = ev.clientY;
                        placeTool(type, dropX - tool.width / 2, dropY - tool.height / 2);
                        close();
                    } else if (!cancelled) {
                        // Quick tap — place at center
                        placeTool(type, window.innerWidth / 2 - tool.width / 2, window.innerHeight / 2 - tool.height / 2);
                        close();
                    }
                    cleanup();
                };

                function cleanup() {
                    item.removeEventListener('pointermove', onMove);
                    item.removeEventListener('pointerup', onUp);
                    item.removeEventListener('pointercancel', onCancel);
                    item.style.opacity = '';
                    try { item.releasePointerCapture(pointerId); } catch (_) {}
                }

                const onCancel = () => {
                    clearTimeout(holdTimer);
                    cancelled = true;
                    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
                    cleanup();
                };

                item.addEventListener('pointermove', onMove);
                item.addEventListener('pointerup', onUp);
                item.addEventListener('pointercancel', onCancel);
            });
        });
    }

    // ===== Tool Placement =====
    function placeTool(type, screenX, screenY) {
        const tool = TOOLS[type] || TOYS[type];
        if (!tool) return;

        const id = 'toolbox-item-' + (++toolIdCounter);

        // Convert screen drop position to canvas coordinates
        const canvasPos = screenToCanvas(screenX, screenY);

        const toolData = {
            id, type,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            width: tool.width,
            height: tool.height,
            rotation: 0,
            userScale: 1,       // user pinch-resize scale
            pinned: false,      // pinned = stays fixed on screen
            _dragging: false,
            element: null,
            clockInterval: null,
            compassAngle: 45
        };

        const el = document.createElement('div');
        el.className = 'toolbox-canvas-item';
        el.id = id;
        el.style.width = tool.width + 'px';
        el.style.height = tool.height + 'px';
        el.dataset.toolType = type;

        el.innerHTML = tool.render(toolData);

        // Control bar
        const controls = document.createElement('div');
        controls.className = 'toolbox-item-controls';
        controls.innerHTML = `
            <button type="button" class="toolbox-ctrl-btn toolbox-rotate-btn" title="Rotate" aria-label="Rotate tool">${toolIcon('rotate')}</button>
            <div class="toolbox-ctrl-drag" title="Move">⋮⋮</div>
            <button type="button" class="toolbox-ctrl-btn toolbox-pin-btn" title="Pin to screen" aria-label="Pin tool to screen" aria-pressed="false">${toolIcon('pin')}</button>
            <button type="button" class="toolbox-ctrl-btn toolbox-bag-btn" title="Return to toolbox" aria-label="Return tool to toolbox">${toolIcon('bag')}</button>
            <button type="button" class="toolbox-ctrl-btn toolbox-close-btn" title="Remove tool" aria-label="Remove tool">${toolIcon('trash')}</button>
        `;
        el.appendChild(controls);

        document.body.appendChild(el);
        toolData.element = el;

        // Scene toys: fullscreen overlay, special handling
        if (tool.isScene) {
            toolData.isScene = true;
            el.classList.add('toolbox-scene');
            el.style.left = '0'; el.style.top = '0';
            el.style.width = '100vw'; el.style.height = '100vh';
            // Scene control buttons — placed on document.body so they stay visible when scene is hidden
            const sceneBtnWrap = document.createElement('div');
            sceneBtnWrap.className = 'scene-btn-wrap';
            sceneBtnWrap.dataset.sceneId = toolData.id;

            const sceneHide = document.createElement('button');
            sceneHide.type='button';sceneHide.setAttribute('aria-label','Hide scene');sceneHide.setAttribute('aria-pressed','false');
            sceneHide.className = 'scene-ctrl-btn scene-hide-btn';
            sceneHide.innerHTML = toolIcon('eye');
            sceneHide.title = 'Hide / Show scene';
            sceneHide.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSceneVisibility(toolData, sceneHide);
            });
            sceneBtnWrap.appendChild(sceneHide);

            const sceneClose = document.createElement('button');
            sceneClose.type='button';sceneClose.setAttribute('aria-label','Close scene');
            sceneClose.className = 'scene-ctrl-btn scene-close-btn';
            sceneClose.innerHTML = toolIcon('close');
            sceneClose.title = 'Close scene';
            sceneClose.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTool(toolData.id);
            });
            sceneBtnWrap.appendChild(sceneClose);
            document.body.appendChild(sceneBtnWrap);
            toolData._btnWrap = sceneBtnWrap;
            startToyAnimation(toolData);
            activeTools.push(toolData);
            if (typeof showToast === 'function') showToast(`${tool.name} activated`, 'success');
            return;
        }

        // Set initial screen position
        applyPosition(toolData, screenX, screenY);
        setupToolInteraction(toolData);

        if (type === 'clock') startClock(toolData);
        if (type === 'digitalclock') startDigitalClock(toolData);
        if (tool.isToy) startToyAnimation(toolData);

        activeTools.push(toolData);
        startSyncLoop();
        if (typeof showToast === 'function') showToast(`${tool.name} placed`, 'success');
    }

    // ===== Tool Interaction =====
    function setupToolInteraction(toolData) {
        const el = toolData.element;
        const rotateBtn = el.querySelector('.toolbox-rotate-btn');
        const pinBtn = el.querySelector('.toolbox-pin-btn');
        const bagBtn = el.querySelector('.toolbox-bag-btn');
        const closeBtn = el.querySelector('.toolbox-close-btn');
        rotateBtn.addEventListener('click',e=>{
            // Keyboard activation has no drag trajectory. Rotate one deliberate
            // step; pointer dragging continues to use its existing exact angle.
            if(e.detail!==0)return;
            e.stopPropagation();toolData.rotation+=e.shiftKey?-15:15;
            const scale=(toolData.userScale||1)*(toolData.pinned?1:getZoom());
            el.style.transform=`rotate(${toolData.rotation}deg) scale(${scale})`;
        });

        let isDragging = false;
        let cancelDrag = null; // allow pinch to kill an active drag

        function startDrag(e) {
            if (isDragging || pinchActive) return;
            if (e.target.closest('.toolbox-item-controls') && !e.target.closest('.toolbox-ctrl-drag')) return;
            if (e.target.closest('.toolbox-sticky-text')) return;
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            toolData._dragging = true;

            el.setPointerCapture(e.pointerId);

            // Work in screen coords during drag
            const currentScreen = toolData.pinned
                ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top) }
                : canvasToScreen(toolData.canvasX, toolData.canvasY);

            const startX = e.clientX, startY = e.clientY;
            const origSX = currentScreen.x, origSY = currentScreen.y;
            el.classList.add('dragging');

            const toolboxBtn = document.getElementById('toolboxBtn');
            let overBag = false, overTrash = false;

            const onMove = (ev) => {
                const sx = origSX + (ev.clientX - startX);
                const sy = origSY + (ev.clientY - startY);
                applyPosition(toolData, sx, sy);

                if (typeof updateTrashHover === 'function') updateTrashHover(ev.clientX, ev.clientY);
                overTrash = typeof isOverRecycleBin === 'function' && isOverRecycleBin(ev.clientX, ev.clientY);

                if (toolboxBtn) {
                    const r = toolboxBtn.getBoundingClientRect();
                    const wasOver = overBag;
                    overBag = ev.clientX >= r.left - 20 && ev.clientX <= r.right + 20 &&
                              ev.clientY >= r.top - 20 && ev.clientY <= r.bottom + 20;
                    if (overBag && !wasOver) toolboxBtn.classList.add('bag-hover');
                    if (!overBag && wasOver) toolboxBtn.classList.remove('bag-hover');
                }
            };

            const onUp = (ev) => {
                el.removeEventListener('pointermove', onMove);
                el.removeEventListener('pointerup', onUp);
                el.removeEventListener('lostpointercapture', onUp);
                el.classList.remove('dragging');
                isDragging = false;
                toolData._dragging = false;
                if (typeof clearTrashHover === 'function') clearTrashHover();
                if (toolboxBtn) toolboxBtn.classList.remove('bag-hover');

                if (overTrash) {
                    removeTool(toolData.id);
                    if (typeof playTrashSuckAnimation === 'function') playTrashSuckAnimation(ev.clientX, ev.clientY);
                    return;
                }
                if (overBag) {
                    removeTool(toolData.id);
                    if (typeof showToast === 'function') showToast('Returned to toolbox', 'info');
                    return;
                }

                // Commit final position
                const finalSX = origSX + (ev.clientX - startX);
                const finalSY = origSY + (ev.clientY - startY);

                if (toolData.pinned) {
                    // Pinned tools just store screen position directly via CSS
                    applyPosition(toolData, finalSX, finalSY);
                } else {
                    // Convert screen position back to canvas coords
                    const cp = screenToCanvas(finalSX, finalSY);
                    toolData.canvasX = cp.x;
                    toolData.canvasY = cp.y;
                }
            };

            cancelDrag = () => {
                el.removeEventListener('pointermove', onMove);
                el.removeEventListener('pointerup', onUp);
                el.removeEventListener('lostpointercapture', onUp);
                el.classList.remove('dragging');
                isDragging = false;
                toolData._dragging = false;
                if (typeof clearTrashHover === 'function') clearTrashHover();
                cancelDrag = null;
            };

            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
            el.addEventListener('lostpointercapture', onUp);
        }

        el.addEventListener('pointerdown', startDrag);

        // ===== Pinch-to-resize (2 fingers on control bar area) =====
        let pinchStartDist = 0;
        let pinchStartScale = 1;
        let pinchActive = false;

        el.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                // Only activate pinch when the touch midpoint is near the control bar
                const t0 = e.touches[0], t1 = e.touches[1];
                const midY = (t0.clientY + t1.clientY) / 2;
                const elRect = el.getBoundingClientRect();
                const ctrlBar = el.querySelector('.toolbox-item-controls');
                if (ctrlBar) {
                    const barRect = ctrlBar.getBoundingClientRect();
                    // Allow pinch if midpoint is within the control bar zone (with tolerance)
                    if (midY < barRect.top - 20 || midY > barRect.bottom + 20) return;
                }
                e.preventDefault();
                e.stopPropagation();
                // Kill any active single-finger drag
                if (isDragging && cancelDrag) cancelDrag();
                const dx = t1.clientX - t0.clientX;
                const dy = t1.clientY - t0.clientY;
                pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                pinchStartScale = toolData.userScale || 1;
                pinchActive = true;
            }
        }, { passive: false });

        el.addEventListener('touchmove', (e) => {
            if (pinchActive && e.touches.length === 2) {
                e.preventDefault();
                e.stopPropagation();
                const t0 = e.touches[0], t1 = e.touches[1];
                const dx = t1.clientX - t0.clientX;
                const dy = t1.clientY - t0.clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const ratio = dist / pinchStartDist;
                toolData.userScale = Math.max(0.2, Math.min(5, pinchStartScale * ratio));
                const z = toolData.pinned ? 1 : getZoom();
                const s = toolData.userScale * z;
                el.style.transform = `rotate(${toolData.rotation}deg) scale(${s})`;
                toolData._toyState?._onScaleChanged?.();
            }
        }, { passive: false });

        el.addEventListener('touchend', (e) => {
            if (pinchActive && e.touches.length < 2) {
                pinchActive = false;
            }
        });

        // Rotate via drag
        rotateBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            rotateBtn.setPointerCapture(e.pointerId);
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
            const origRot = toolData.rotation;

            const onMove = (ev) => {
                const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
                toolData.rotation = origRot + (angle - startAngle) * (180 / Math.PI);
                const z = toolData.pinned ? 1 : getZoom();
                const s = (toolData.userScale || 1) * z;
                el.style.transform = `rotate(${toolData.rotation}deg) scale(${s})`;
            };
            const onUp = () => {
                rotateBtn.removeEventListener('pointermove', onMove);
                rotateBtn.removeEventListener('pointerup', onUp);
                rotateBtn.removeEventListener('lostpointercapture', onUp);
                isDragging = false;
            };
            rotateBtn.addEventListener('pointermove', onMove);
            rotateBtn.addEventListener('pointerup', onUp);
            rotateBtn.addEventListener('lostpointercapture', onUp);
        });

        // Pin to screen toggle
        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toolData.pinned = !toolData.pinned;
            el.classList.toggle('pinned', toolData.pinned);
            pinBtn.setAttribute('aria-pressed',String(toolData.pinned));
            pinBtn.title = toolData.pinned ? 'Unpin (move with page)' : 'Pin to screen';
            pinBtn.setAttribute('aria-label',pinBtn.title);

            if (toolData.pinned) {
                // Switching to pinned: current screen pos is what sticks
                // No need to change anything, sync loop will skip it
            } else {
                // Switching to unpinned: convert current screen pos back to canvas coords
                const sx = parseFloat(el.style.left) || 0;
                const sy = parseFloat(el.style.top) || 0;
                const cp = screenToCanvas(sx, sy);
                toolData.canvasX = cp.x;
                toolData.canvasY = cp.y;
            }

            if (typeof showToast === 'function') {
                showToast(toolData.pinned ? 'Pinned to screen' : 'Moves with the page', 'info');
            }
            toolData._toyState?._onScaleChanged?.();
        });

        // Return to bag
        bagBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTool(toolData.id);
            if (typeof showToast === 'function') showToast('Returned to toolbox', 'info');
        });

        // Trash
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = el.getBoundingClientRect();
            removeTool(toolData.id);
            if (typeof playTrashSuckAnimation === 'function') playTrashSuckAnimation(rect.left + rect.width / 2, rect.top + rect.height / 2);
        });
    }

    function removeTool(id) {
        const idx = activeTools.findIndex(t => t.id === id);
        if (idx === -1) return;
        const tool = activeTools[idx];
        if (tool.clockInterval) clearInterval(tool.clockInterval);
        if (tool.toyAnimId) cancelAnimationFrame(tool.toyAnimId);
        if (tool._toyState && tool._toyState._animId) cancelAnimationFrame(tool._toyState._animId);
        if (tool._toyState && tool._toyState._cleanup) tool._toyState._cleanup();
        if (tool._toyState && tool._toyState._resizeCleanup) tool._toyState._resizeCleanup();
        // Remove from shared physics world
        toyWorld.bodies = toyWorld.bodies.filter(b => b.toyId !== id);
        if (tool._btnWrap) tool._btnWrap.remove();
        if (tool.element) {
            tool.element.remove();
            // Release potentially large zoom-density surfaces now, not at the
            // next garbage collection. These are discarded tool pixels only.
            for (const canvas of tool.element.querySelectorAll('canvas')) {
                canvas.width = canvas.height = 0;
            }
        }
        activeTools.splice(idx, 1);
    }

    // ===== Scene Hide / Show toggle =====
    function toggleSceneVisibility(toolData, btn) {
        if (!toolData.element) return;
        const hidden = !toolData._hidden;
        toolData._hidden = hidden;
        toolData.element.style.display = hidden ? 'none' : '';
        btn.classList.toggle('scene-hidden', hidden);
        btn.title = hidden ? 'Show scene' : 'Hide scene';
        btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-pressed',String(hidden));
    }

    // ===== Render Functions =====
    // All measurement tools use CM constant (48px = 1cm = 2 grid squares)

    function renderGeodreieck() {
        const uid = toolIdCounter;
        const cmCount = 16;
        const w = cmCount * CM + 20;  // 788
        const h = 8 * CM + 20;       // 404
        const bL = 10, bR = w - 10;  // bottom edge left/right
        const bY = h - 10;           // bottom y
        const apex = w / 2;          // top center x
        const apexY = 15;
        return `<svg class="toolbox-geodreieck" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="geodreieckGrad${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:rgba(255,220,100,0.18)"/>
                <stop offset="100%" style="stop-color:rgba(255,180,50,0.12)"/>
            </linearGradient></defs>
            <polygon points="${apex},${apexY} ${bL},${bY} ${bR},${bY}" fill="url(#geodreieckGrad${uid})" stroke="rgba(200,150,50,0.6)" stroke-width="1.5"/>
            <line x1="${apex}" y1="${apexY}" x2="${apex}" y2="${bY}" stroke="rgba(200,50,50,0.5)" stroke-width="0.7" stroke-dasharray="6,4"/>
            ${Array.from({length: cmCount * 10 + 1}, (_, i) => {
                const x = bL + i * (CM / 10);
                if (x > bR) return '';
                const isCm = i % 10 === 0;
                const isHalf = i % 5 === 0 && !isCm;
                const tickH = isCm ? 18 : isHalf ? 12 : 6;
                return `<line x1="${x}" y1="${bY}" x2="${x}" y2="${bY - tickH}" stroke="rgba(0,0,0,0.5)" stroke-width="${isCm ? 1 : 0.5}"/>
                ${isCm ? `<text x="${x}" y="${bY - 21}" text-anchor="middle" font-size="11" fill="rgba(0,0,0,0.6)">${i / 10}</text>` : ''}`;
            }).join('')}
            ${Array.from({length: 19}, (_, i) => {
                const angle = i * 10;
                const rad = angle * Math.PI / 180;
                const cx2 = apex, cy2 = bY;
                const r1 = 3 * CM, r2 = angle % 30 === 0 ? 2.5 * CM : 2.7 * CM;
                const x1 = cx2 + r1 * Math.cos(Math.PI + rad);
                const y1 = cy2 + r1 * Math.sin(Math.PI + rad);
                const x2 = cx2 + r2 * Math.cos(Math.PI + rad);
                const y2 = cy2 + r2 * Math.sin(Math.PI + rad);
                const tx = cx2 + 2.2 * CM * Math.cos(Math.PI + rad);
                const ty = cy2 + 2.2 * CM * Math.sin(Math.PI + rad);
                return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>
                ${angle % 30 === 0 ? `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="rgba(0,0,0,0.5)">${angle}°</text>` : ''}`;
            }).join('')}
            <circle cx="${apex}" cy="${apexY + 40}" r="5" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.8"/>
        </svg>`;
    }

    function renderRuler() {
        const uid = toolIdCounter;
        const cmCount = 20;
        const w = cmCount * CM + 20; // 980
        const h = Math.round(1.5 * CM); // 72
        return `<svg class="toolbox-ruler" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="rulerGrad${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:rgba(200,220,255,0.25)"/>
                <stop offset="50%" style="stop-color:rgba(180,200,240,0.15)"/>
                <stop offset="100%" style="stop-color:rgba(200,220,255,0.25)"/>
            </linearGradient></defs>
            <rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="url(#rulerGrad${uid})" stroke="rgba(100,140,200,0.5)" stroke-width="1"/>
            ${Array.from({length: cmCount * 10 + 1}, (_, i) => {
                const x = 10 + i * (CM / 10);
                const isCm = i % 10 === 0;
                const isHalf = i % 5 === 0 && !isCm;
                const tickH = isCm ? 22 : isHalf ? 15 : 8;
                return `<line x1="${x}" y1="0" x2="${x}" y2="${tickH}" stroke="rgba(0,0,0,0.55)" stroke-width="${isCm ? 1 : 0.4}"/>
                ${isCm ? `<text x="${x}" y="${tickH + 12}" text-anchor="middle" font-size="11" fill="rgba(0,0,0,0.6)">${i / 10}</text>` : ''}`;
            }).join('')}
        </svg>`;
    }

    function renderProtractor() {
        const uid = toolIdCounter;
        const radius = 5 * CM; // 240px = 5cm radius
        const w = 2 * radius + 20;
        const h = radius + 30;
        const cx = w / 2, cy = h - 10;
        return `<svg class="toolbox-protractor" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id="protGrad${uid}" cx="50%" cy="100%" r="70%">
                <stop offset="0%" style="stop-color:rgba(255,200,200,0.12)"/>
                <stop offset="100%" style="stop-color:rgba(200,180,255,0.18)"/>
            </radialGradient></defs>
            <path d="M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy} Z" fill="url(#protGrad${uid})" stroke="rgba(150,100,200,0.5)" stroke-width="1"/>
            <circle cx="${cx}" cy="${cy}" r="3" fill="rgba(200,50,50,0.6)"/>
            <line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="rgba(200,50,50,0.5)" stroke-width="0.5"/>
            ${Array.from({length: 181}, (_, i) => {
                const angle = i;
                const rad = angle * Math.PI / 180;
                const isMajor = angle % 10 === 0;
                const isMid = angle % 5 === 0 && !isMajor;
                const r1 = radius, r2 = isMajor ? radius - 22 : isMid ? radius - 14 : radius - 8;
                const x1 = cx + r1 * Math.cos(Math.PI - rad);
                const y1 = cy + r1 * Math.sin(Math.PI - rad);
                const x2 = cx + r2 * Math.cos(Math.PI - rad);
                const y2 = cy + r2 * Math.sin(Math.PI - rad);
                const tx = cx + (radius - 32) * Math.cos(Math.PI - rad);
                const ty = cy + (radius - 32) * Math.sin(Math.PI - rad);
                return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,0.45)" stroke-width="${isMajor ? 1 : 0.4}"/>
                ${isMajor ? `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="rgba(0,0,0,0.6)" transform="rotate(${90 - angle}, ${tx}, ${ty})">${angle}°</text>` : ''}`;
            }).join('')}
            <path d="M ${cx - radius + 50} ${cy} A ${radius - 50} ${radius - 50} 0 0 1 ${cx + radius - 50} ${cy}" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>
        </svg>`;
    }

    function renderClock() {
        const uid = toolIdCounter;
        const s = 4 * CM; // 192px
        const c = s / 2;  // center 96
        const r = c - 6;  // radius 90
        return `<svg class="toolbox-clock" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id="clockFace${uid}" cx="50%" cy="45%" r="55%">
                <stop offset="0%" style="stop-color:rgba(255,255,255,0.15)"/>
                <stop offset="100%" style="stop-color:rgba(200,200,220,0.08)"/>
            </radialGradient></defs>
            <circle cx="${c}" cy="${c}" r="${r}" fill="url(#clockFace${uid})" stroke="rgba(150,150,180,0.5)" stroke-width="2"/>
            <circle cx="${c}" cy="${c}" r="${r - 5}" fill="none" stroke="rgba(150,150,180,0.2)" stroke-width="0.5"/>
            ${Array.from({length: 12}, (_, i) => {
                const angle = (i * 30) * Math.PI / 180;
                const x1 = c + (r - 10) * Math.sin(angle), y1 = c - (r - 10) * Math.cos(angle);
                const x2 = c + r * Math.sin(angle), y2 = c - r * Math.cos(angle);
                const tx = c + (r - 22) * Math.sin(angle), ty = c - (r - 22) * Math.cos(angle);
                return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,0.6)" stroke-width="2" stroke-linecap="round"/>
                <text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" fill="rgba(0,0,0,0.55)">${i === 0 ? 12 : i}</text>`;
            }).join('')}
            ${Array.from({length: 60}, (_, i) => {
                if (i % 5 === 0) return '';
                const angle = (i * 6) * Math.PI / 180;
                const x1 = c + (r - 4) * Math.sin(angle), y1 = c - (r - 4) * Math.cos(angle);
                const x2 = c + r * Math.sin(angle), y2 = c - r * Math.cos(angle);
                return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,0.3)" stroke-width="0.7"/>`;
            }).join('')}
            <line class="clock-hour-hand" x1="${c}" y1="${c}" x2="${c}" y2="${c - r * 0.5}" stroke="rgba(0,0,0,0.7)" stroke-width="3.5" stroke-linecap="round"/>
            <line class="clock-minute-hand" x1="${c}" y1="${c}" x2="${c}" y2="${c - r * 0.7}" stroke="rgba(0,0,0,0.6)" stroke-width="2" stroke-linecap="round"/>
            <line class="clock-second-hand" x1="${c}" y1="${c + 6}" x2="${c}" y2="${c - r * 0.75}" stroke="rgba(220,50,50,0.7)" stroke-width="1" stroke-linecap="round"/>
            <circle cx="${c}" cy="${c}" r="3.5" fill="rgba(0,0,0,0.6)"/>
            <circle cx="${c}" cy="${c}" r="1.5" fill="rgba(220,50,50,0.8)"/>
        </svg>`;
    }

    function renderDigitalClock() {
        return `<div class="toolbox-digital-clock">
            <div class="digital-clock-time">00:00:00</div>
            <div class="digital-clock-date">--</div>
        </div>`;
    }

    function renderStickyNote() {
        const colors = ['#fff740', '#ff7eb3', '#7afcff', '#98ff98', '#ffb347'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        return `<div class="toolbox-sticky" style="--sticky-color: ${color}">
            <div class="toolbox-sticky-header"></div>
            <div class="toolbox-sticky-text" contenteditable="true" spellcheck="false" data-placeholder="Type here..."></div>
        </div>`;
    }

    function renderCompass(data) {
        const w = 4 * CM, h = Math.round(5.5 * CM);
        const cx = w / 2, topY = 30;
        return `<svg class="toolbox-compass-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${cx}" cy="${topY}" r="12" fill="rgba(180,180,190,0.3)" stroke="rgba(120,120,140,0.5)" stroke-width="1.5"/>
            <circle cx="${cx}" cy="${topY}" r="3" fill="rgba(80,80,100,0.6)"/>
            <line x1="${cx}" y1="${topY + 8}" x2="${cx - 30}" y2="${h - 15}" stroke="rgba(120,120,140,0.7)" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="${cx - 30}" cy="${h - 10}" r="2" fill="rgba(100,100,120,0.7)"/>
            <g class="toolbox-compass-arm" style="transform-origin: ${cx}px ${topY}px; transform: rotate(${data.compassAngle || 45}deg);">
                <line x1="${cx}" y1="${topY + 8}" x2="${cx + 30}" y2="${h - 15}" stroke="rgba(120,120,140,0.7)" stroke-width="2.5" stroke-linecap="round"/>
                <polygon points="${cx + 26},${h - 25} ${cx + 30},${h - 5} ${cx + 34},${h - 25}" fill="rgba(50,50,70,0.6)"/>
                <rect x="${cx + 26}" y="${h - 60}" width="8" height="32" rx="1" fill="rgba(220,180,50,0.5)" stroke="rgba(180,140,30,0.4)" stroke-width="0.5"/>
            </g>
            <text x="${cx}" y="${topY - 16}" text-anchor="middle" font-size="10" fill="rgba(0,0,0,0.5)">${data.compassAngle || 45}°</text>
        </svg>`;
    }

    // ===== Clock Tickers =====
    function startClock(toolData) {
        const s = 4 * CM;
        const c = s / 2;
        const r = c - 6;
        function tick() {
            const el = toolData.element;
            if (!el) return;
            const now = new Date();
            const h = now.getHours() % 12, m = now.getMinutes(), sec = now.getSeconds(), ms = now.getMilliseconds();
            const secAngle = (sec + ms / 1000) * 6;
            const minAngle = (m + sec / 60) * 6;
            const hourAngle = (h + m / 60) * 30;
            const hourHand = el.querySelector('.clock-hour-hand');
            const minHand = el.querySelector('.clock-minute-hand');
            const secHand = el.querySelector('.clock-second-hand');
            if (hourHand) {
                const hr = hourAngle * Math.PI / 180;
                hourHand.setAttribute('x2', c + r * 0.5 * Math.sin(hr));
                hourHand.setAttribute('y2', c - r * 0.5 * Math.cos(hr));
            }
            if (minHand) {
                const mr = minAngle * Math.PI / 180;
                minHand.setAttribute('x2', c + r * 0.7 * Math.sin(mr));
                minHand.setAttribute('y2', c - r * 0.7 * Math.cos(mr));
            }
            if (secHand) {
                const sr = secAngle * Math.PI / 180;
                secHand.setAttribute('x2', c + r * 0.75 * Math.sin(sr));
                secHand.setAttribute('y2', c - r * 0.75 * Math.cos(sr));
                secHand.setAttribute('x1', c - 12 * Math.sin(sr));
                secHand.setAttribute('y1', c + 12 * Math.cos(sr));
            }
        }
        tick();
        toolData.clockInterval = setInterval(tick, 50);
    }

    function startDigitalClock(toolData) {
        function tick() {
            const el = toolData.element;
            if (!el) return;
            const now = new Date();
            const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const dateStr = now.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            const timeEl = el.querySelector('.digital-clock-time');
            const dateEl = el.querySelector('.digital-clock-date');
            if (timeEl) timeEl.textContent = timeStr;
            if (dateEl) dateEl.textContent = dateStr;
        }
        tick();
        toolData.clockInterval = setInterval(tick, 500);
    }

    // ===== Toy Render Functions =====

    function toyDPR() { return window.devicePixelRatio || 1; }
    const TOY_PAD = 400;

    function toyCanvas(logW, logH, toyName) {
        const dpr = toyDPR();
        const pad = TOY_PAD;
        const cssW = logW + pad * 2, cssH = logH + pad * 2;
        const pxW = Math.round(cssW * dpr), pxH = Math.round(cssH * dpr);
        return `<canvas class="toy-canvas" width="${pxW}" height="${pxH}" style="width:${cssW}px;height:${cssH}px;margin:-${pad}px" data-toy="${toyName}" data-lw="${logW}" data-lh="${logH}" data-pad="${pad}"></canvas>`;
    }

    function renderBubbleWrap(data) { return toyCanvas(6 * CM, 6 * CM, 'bubblewrap'); }
    function renderStressBall(data) { return toyCanvas(4 * CM, 4 * CM, 'stressball'); }
    function renderFidgetSpinner(data) { return toyCanvas(4 * CM, 4 * CM, 'spinner'); }
    function renderBreathingCircle(data) { return toyCanvas(4 * CM, 4 * CM, 'breathing'); }
    function renderNewtonsCradle(data) { return toyCanvas(5 * CM, 4 * CM, 'newtonscradle'); }
    function renderInfinitySpinner(data) { return toyCanvas(4 * CM, 3 * CM, 'infinityspinner'); }
    function renderLavaLamp(data) { return toyCanvas(3 * CM, 5 * CM, 'lavalamp'); }
    function renderMagnetSand(data) { return toyCanvas(4 * CM, 4 * CM, 'magnetsand'); }
    function renderZenPond(data) { return toyCanvas(4 * CM, 4 * CM, 'zenpond'); }
    function renderChainRope(data) { return toyCanvas(4 * CM, 5 * CM, 'chainrope'); }
    function renderJellyCube(data) { return toyCanvas(4 * CM, 4 * CM, 'jellycube'); }
    function renderPendulumWave(data) { return toyCanvas(5 * CM, 4 * CM, 'pendulumwave'); }
    function renderKaleidoscope(data) { return toyCanvas(4 * CM, 4 * CM, 'kaleidoscope'); }
    function renderFidgetClicker(data) { return toyCanvas(3 * CM, 3 * CM, 'fidgetclicker'); }
    function renderStaticBox(data) { return toyCanvas(4 * CM, 2 * CM, 'staticbox'); }
    function renderStaticBall(data) { return toyCanvas(3 * CM, 3 * CM, 'staticball'); }
    function renderStaticWall(data) { return toyCanvas(1.5 * CM, 6 * CM, 'staticwall'); }
    function renderStaticFloor(data) { return toyCanvas(8 * CM, CM, 'staticfloor'); }
    function renderRigiBall(data) { return toyCanvas(3 * CM, 4 * CM, 'rigiball'); }
    function renderRigiCrate(data) { return toyCanvas(3 * CM, 3 * CM, 'rigicrate'); }
    function renderGameBoy(data) { return toyCanvas(6 * CM, 9 * CM, 'gameboy'); }
    function renderCalculator(data) { return toyCanvas(6 * CM, 11 * CM, 'calculator'); }
    function renderParticleScene() {
        const dpr = toyDPR();
        const vw = window.innerWidth, vh = window.innerHeight;
        return `<canvas class="toy-canvas scene-canvas" width="${Math.round(vw * dpr)}" height="${Math.round(vh * dpr)}" style="width:${vw}px;height:${vh}px" data-toy="particlescene" data-lw="${vw}" data-lh="${vh}" data-pad="0"></canvas>`;
    }
    function renderGravityScene() {
        const dpr = toyDPR();
        const vw = window.innerWidth, vh = window.innerHeight;
        return `<canvas class="toy-canvas scene-canvas" width="${Math.round(vw * dpr)}" height="${Math.round(vh * dpr)}" style="width:${vw}px;height:${vh}px" data-toy="gravityscene" data-lw="${vw}" data-lh="${vh}" data-pad="0"></canvas>`;
    }

    // ===== Toy Animation Engine =====
    function startToyAnimation(toolData) {
        const el = toolData.element;
        if (!el) return;
        const canvas = el.querySelector('.toy-canvas');
        if (!canvas) return;

        // Scene toys (fullscreen): no overlay redirect, canvas gets pointer-events directly
        const isScene = el.classList.contains('toolbox-scene');

        if (!isScene) {
            // The canvas extends far beyond the logical toy area (TOY_PAD).
            // Set it to pointer-events:none so it doesn't block normal canvas zoom.
            // Create a small interaction overlay matching the logical toy area,
            // and transparently redirect all event registrations to it.
            canvas.style.pointerEvents = 'none';
            const interact = document.createElement('div');
            interact.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;touch-action:none;';
            el.insertBefore(interact, el.querySelector('.toolbox-item-controls'));

            const _origAddEL = canvas.addEventListener.bind(canvas);
            const ptrEvents = new Set(['pointerdown','pointermove','pointerup','pointerleave','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel']);
            canvas.addEventListener = function(type, fn, opts) {
                if (ptrEvents.has(type)) interact.addEventListener(type, fn, opts);
                else _origAddEL(type, fn, opts);
            };
            // Redirect pointer capture calls so toys work correctly
            const _origCapture = canvas.setPointerCapture;
            const _origRelease = canvas.releasePointerCapture;
            canvas.setPointerCapture = function(id) { try { interact.setPointerCapture(id); } catch(_){} };
            canvas.releasePointerCapture = function(id) { try { interact.releasePointerCapture(id); } catch(_){} };
        }

        const ctx = canvas.getContext('2d');
        const toyType = canvas.dataset.toy;
        const w = parseInt(canvas.dataset.lw) || 192;
        const h = parseInt(canvas.dataset.lh) || 192;
        const pad = parseInt(canvas.dataset.pad) || TOY_PAD;
        const baseDPR = toyDPR();
        let curDPR = baseDPR;

        // Dynamic resolution: scale backing store with userScale*zoom so toys stay sharp
        function targetResolution() {
            const ts = (toolData.userScale || 1) * (toolData.pinned ? 1 : getZoom());
            return Math.max(baseDPR, Math.min(baseDPR * ts, baseDPR * 4));
        }
        ctx._needsResolution = () => Math.abs(targetResolution() - curDPR) / curDPR > 0.15;
        ctx._clearFull = function() {
            const target = targetResolution();
            if (Math.abs(target - curDPR) / curDPR > 0.15) {
                curDPR = target;
                canvas.width = Math.round((w + pad * 2) * curDPR);
                canvas.height = Math.round((h + pad * 2) * curDPR);
                return; // canvas resize already clears
            }
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        };
        ctx._resetTransform = function() {
            ctx.setTransform(curDPR, 0, 0, curDPR, pad * curDPR, pad * curDPR);
        };
        ctx._resetTransform();

        // State object for each toy
        const state = {};

        switch (toyType) {
            case 'bubblewrap': initBubbleWrap(ctx, w, h, state, canvas); break;
            case 'stressball': initStressBall(ctx, w, h, state, canvas); break;
            case 'spinner': initFidgetSpinnerToy(ctx, w, h, state, canvas); break;
            case 'breathing': initBreathingCircleToy(ctx, w, h, state, canvas); break;
            case 'newtonscradle': initNewtonsCradleToy(ctx, w, h, state, canvas); break;
            case 'infinityspinner': initInfinitySpinnerToy(ctx, w, h, state, canvas); break;
            case 'lavalamp': initLavaLamp(ctx, w, h, state, canvas); break;
            case 'magnetsand': initMagnetSand(ctx, w, h, state, canvas); break;
            case 'zenpond': initZenPond(ctx, w, h, state, canvas); break;
            case 'chainrope': initChainRope(ctx, w, h, state, canvas); break;
            case 'jellycube': initJellyCube(ctx, w, h, state, canvas); break;
            case 'pendulumwave': initPendulumWave(ctx, w, h, state, canvas); break;
            case 'kaleidoscope': initKaleidoscope(ctx, w, h, state, canvas); break;
            case 'fidgetclicker': initFidgetClicker(ctx, w, h, state, canvas); break;
            case 'staticbox': initStaticBox(ctx, w, h, state, canvas); break;
            case 'staticball': initStaticBall(ctx, w, h, state, canvas); break;
            case 'staticwall': initStaticWall(ctx, w, h, state, canvas); break;
            case 'staticfloor': initStaticFloor(ctx, w, h, state, canvas); break;
            case 'rigiball': initRigiBall(ctx, w, h, state, canvas); break;
            case 'rigicrate': initRigiCrate(ctx, w, h, state, canvas); break;
            case 'particlescene': initParticleScene(ctx, w, h, state, canvas, toolData); break;
            case 'gravityscene': initGravityScene(ctx, w, h, state, canvas, toolData); break;
            case 'gameboy': initGameBoy(ctx, w, h, state, canvas); break;
            case 'calculator': initCalculator(ctx, w, h, state, canvas); break;
        }

        toolData._toyState = state;
    }

    // Static controls retain their exact pixels until input or backing density changes.
    // Short feedback animations keep the same frame cadence; actual game/physics loops
    // are independent and are not throttled by this painter.
    function createToyPainter(ctx, state, draw, isAnimating = () => false) {
        let frame = null, disposed = false;
        function requestPaint() {
            if (disposed || frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                if (disposed) return;
                draw();
                if (isAnimating()) requestPaint();
            });
        }
        state._requestPaint = requestPaint;
        state._onScaleChanged = () => {
            if (ctx._needsResolution()) requestPaint();
        };
        draw();
        // Keep the original first-frame settling of canvas text/context state.
        requestPaint();
        return () => {
            disposed = true;
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
        };
    }

    // Helper to convert pointer event to toy-local logical coords (accounting for padding + DPR)
    function toyPointerPos(e, canvas, w, h) {
        const rect = canvas.getBoundingClientRect();
        const pad = parseInt(canvas.dataset.pad) || TOY_PAD;
        const cssW = w + pad * 2, cssH = h + pad * 2;
        const sx = (e.clientX - rect.left) / rect.width * cssW - pad;
        const sy = (e.clientY - rect.top) / rect.height * cssH - pad;
        return { x: sx, y: sy };
    }

    // ===== Shared Toy Physics World =====
    // Enables cross-toy interactions: bodies from different toys collide in screen space.
    const toyWorld = {
        bodies: [], // { id, toyId, x, y, r, vx, vy, mass, localRef, toolData }
    };

    // Convert a toy-local point to screen coords
    function toyLocalToScreen(lx, ly, toolData) {
        const el = toolData.element;
        if (!el) return { x: lx, y: ly };
        // The element's top-left in screen space
        const sx = parseFloat(el.style.left) || 0;
        const sy = parseFloat(el.style.top) || 0;
        const z = toolData.pinned ? 1 : getZoom();
        const s = (toolData.userScale || 1) * z;
        return { x: sx + lx * s, y: sy + ly * s };
    }

    // Convert a screen point back to toy-local coords
    function screenToToyLocal(sx, sy, toolData) {
        const el = toolData.element;
        if (!el) return { x: sx, y: sy };
        const elX = parseFloat(el.style.left) || 0;
        const elY = parseFloat(el.style.top) || 0;
        const z = toolData.pinned ? 1 : getZoom();
        const s = (toolData.userScale || 1) * z;
        return { x: (sx - elX) / s, y: (sy - elY) / s };
    }

    // Register bodies for a toy each frame
    function toyWorldRegister(toyId, toolData, bodies) {
        // Remove old bodies from this toy
        toyWorld.bodies = toyWorld.bodies.filter(b => b.toyId !== toyId);
        // Add new ones
        for (const b of bodies) {
            const screen = toyLocalToScreen(b.x, b.y, toolData);
            const z = toolData.pinned ? 1 : getZoom();
            const s = (toolData.userScale || 1) * z;
            const entry = {
                id: b.id,
                toyId,
                x: screen.x,
                y: screen.y,
                vx: (b.vx || 0) * s,
                vy: (b.vy || 0) * s,
                mass: b.mass || 1,
                localRef: b.localRef, // direct ref to the toy's state object for this body
                toolData,
                scale: s
            };
            // Circle body
            if (b.r != null) entry.r = b.r * s;
            // Box body (AABB)
            if (b.hw != null) { entry.hw = b.hw * s; entry.hh = b.hh * s; }
            toyWorld.bodies.push(entry);
        }
    }

    // Circle-AABB collision helper
    function _circleAABB(circle, box) {
        const cx = Math.max(box.x - box.hw, Math.min(circle.x, box.x + box.hw));
        const cy = Math.max(box.y - box.hh, Math.min(circle.y, box.y + box.hh));
        const dx = circle.x - cx, dy = circle.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= circle.r) return null;
        // Circle center inside box — push along shortest axis
        if (dist < 0.01) {
            const ex = box.hw - Math.abs(circle.x - box.x);
            const ey = box.hh - Math.abs(circle.y - box.y);
            if (ex < ey) return { nx: circle.x < box.x ? -1 : 1, ny: 0, overlap: ex + circle.r };
            return { nx: 0, ny: circle.y < box.y ? -1 : 1, overlap: ey + circle.r };
        }
        return { nx: dx / dist, ny: dy / dist, overlap: circle.r - dist };
    }

    // Run cross-toy collisions (called from each toy's draw loop)
    function toyWorldCollide(toyId) {
        const mine = toyWorld.bodies.filter(b => b.toyId === toyId);
        const others = toyWorld.bodies.filter(b => b.toyId !== toyId);
        for (const a of mine) {
            for (const b of others) {
                let nx, ny, overlap;
                const aCircle = a.r != null;
                const bCircle = b.r != null;

                if (aCircle && bCircle) {
                    // Circle-Circle
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = a.r + b.r;
                    if (dist >= minDist || dist < 0.1) continue;
                    nx = dx / dist; ny = dy / dist;
                    overlap = minDist - dist;
                } else if (aCircle && !bCircle) {
                    // Circle (a) vs AABB (b)
                    const col = _circleAABB(a, b);
                    if (!col) continue;
                    nx = col.nx; ny = col.ny; overlap = col.overlap;
                } else if (!aCircle && bCircle) {
                    // AABB (a) vs Circle (b) — flip normal
                    const col = _circleAABB(b, a);
                    if (!col) continue;
                    nx = -col.nx; ny = -col.ny; overlap = col.overlap;
                } else {
                    continue; // AABB-AABB skipped
                }

                // Relative velocity
                const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
                const relVel = dvx * nx + dvy * ny;
                // Only resolve if approaching
                if (relVel > 0) continue;
                const totalMass = a.mass + b.mass;
                const impulse = -(1 + 0.6) * relVel / totalMass;
                // Apply impulse back to local objects
                if (a.localRef) {
                    const invS = 1 / (a.scale || 1);
                    if (typeof a.localRef.vx === 'number') {
                        a.localRef.vx -= impulse * b.mass * nx * invS * 0.5;
                        a.localRef.vy -= impulse * b.mass * ny * invS * 0.5;
                    }
                    // For verlet objects (ox/oy), nudge position
                    if (typeof a.localRef.ox === 'number') {
                        a.localRef.x -= overlap * nx * (b.mass / totalMass) * invS * 0.5;
                        a.localRef.y -= overlap * ny * (b.mass / totalMass) * invS * 0.5;
                    }
                    // For pendulum objects (angVel), convert horizontal impulse to angular
                    if (typeof a.localRef.angVel === 'number') {
                        a.localRef.angVel -= impulse * b.mass * nx * invS * 0.003;
                    }
                }
                if (b.localRef) {
                    const invS = 1 / (b.scale || 1);
                    if (typeof b.localRef.vx === 'number') {
                        b.localRef.vx += impulse * a.mass * nx * invS * 0.5;
                        b.localRef.vy += impulse * a.mass * ny * invS * 0.5;
                    }
                    if (typeof b.localRef.ox === 'number') {
                        b.localRef.x += overlap * nx * (a.mass / totalMass) * invS * 0.5;
                        b.localRef.y += overlap * ny * (a.mass / totalMass) * invS * 0.5;
                    }
                    if (typeof b.localRef.angVel === 'number') {
                        b.localRef.angVel += impulse * a.mass * nx * invS * 0.003;
                    }
                }
            }
        }
    }

    // Get a toolData by its element id from activeTools
    function getToolDataForToy(canvas) {
        const el = canvas.closest('.toolbox-canvas-item');
        if (!el) return null;
        return activeTools.find(t => t.element === el) || null;
    }

    // --- Bubble Wrap ---
    function initBubbleWrap(ctx, w, h, state, canvas) {
        const cols = 7, rows = 7;
        const padX = w / (cols + 1), padY = h / (rows + 1);
        state.bubbles = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                state.bubbles.push({
                    x: padX * (c + 1), y: padY * (r + 1),
                    r: Math.min(padX, padY) * 0.38,
                    popped: false, popAnim: 0,
                    ripple: 0
                });
            }
        }
        state.popCount = 0;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            for (const b of state.bubbles) {
                if (b.popped) {
                    // Pop ripple effect
                    if (b.ripple > 0) {
                        ctx.globalAlpha = b.ripple * 0.4;
                        ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(b.x, b.y, b.r * (1 + (1 - b.ripple) * 0.8), 0, Math.PI * 2);
                        ctx.stroke();
                        b.ripple -= 0.04;
                    }
                    // Flat popped look
                    ctx.globalAlpha = 0.2;
                    ctx.fillStyle = 'rgba(180, 210, 230, 0.3)';
                    ctx.beginPath();
                    ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                } else {
                    // Unpopped bubble
                    const grad = ctx.createRadialGradient(b.x - b.r * 0.25, b.y - b.r * 0.25, b.r * 0.1, b.x, b.y, b.r);
                    grad.addColorStop(0, 'rgba(220, 240, 255, 0.6)');
                    grad.addColorStop(0.6, 'rgba(180, 220, 250, 0.35)');
                    grad.addColorStop(1, 'rgba(150, 200, 240, 0.15)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
                    ctx.fill();
                    // Shine
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.beginPath();
                    ctx.arc(b.x - b.r * 0.25, b.y - b.r * 0.3, b.r * 0.2, 0, Math.PI * 2);
                    ctx.fill();
                    // Border
                    ctx.strokeStyle = 'rgba(150, 200, 240, 0.4)';
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }

            // Counter
            const total = state.bubbles.length;
            const popped = state.bubbles.filter(b => b.popped).length;
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '12px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText(`${popped}/${total}`, w / 2, h - 8);

            // Reset hint
            if (popped === total) {
                ctx.fillStyle = 'rgba(100, 220, 150, 0.8)';
                ctx.font = 'bold 13px system-ui';
                ctx.fillText('Tap to reset!', w / 2, h / 2);
            }

            state._animId = requestAnimationFrame(draw);
        }

        function popAt(mx, my) {
            for (const b of state.bubbles) {
                if (b.popped) continue;
                const dx = mx - b.x, dy = my - b.y;
                if (dx * dx + dy * dy <= b.r * b.r) {
                    b.popped = true;
                    b.ripple = 1;
                }
            }
        }

        state._dragging = false;

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const { x: mx, y: my } = toyPointerPos(e, canvas, w, h);

            // Check if all popped → reset
            if (state.bubbles.every(b => b.popped)) {
                state.bubbles.forEach(b => { b.popped = false; b.ripple = 0; });
                return;
            }

            state._dragging = true;
            try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
            popAt(mx, my);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!state._dragging) return;
            const { x: mx, y: my } = toyPointerPos(e, canvas, w, h);
            popAt(mx, my);
        });
        canvas.addEventListener('pointerup', () => { state._dragging = false; });
        canvas.addEventListener('lostpointercapture', () => { state._dragging = false; });

        draw();
    }

    // --- Stress Ball ---
    function initStressBall(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2, baseR = w * 0.35;
        const N = 24; // control points around the circle
        state.points = [];
        state.restPoints = [];
        for (let i = 0; i < N; i++) {
            const angle = (i / N) * Math.PI * 2;
            const px = cx + baseR * Math.cos(angle);
            const py = cy + baseR * Math.sin(angle);
            state.points.push({ x: px, y: py, vx: 0, vy: 0 });
            state.restPoints.push({ x: px, y: py });
        }
        state.pressing = false;
        state.pressX = cx;
        state.pressY = cy;
        state.hue = Math.random() * 360;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Spring physics: points return to rest position
            for (let i = 0; i < N; i++) {
                const p = state.points[i], rest = state.restPoints[i];
                const dx = rest.x - p.x, dy = rest.y - p.y;
                p.vx += dx * 0.08;
                p.vy += dy * 0.08;
                // If pressing, push points away from press point
                if (state.pressing) {
                    const pdx = p.x - state.pressX, pdy = p.y - state.pressY;
                    const dist = Math.sqrt(pdx * pdx + pdy * pdy) + 1;
                    const force = Math.max(0, (baseR * 1.2 - dist)) * 0.15;
                    p.vx += (pdx / dist) * force;
                    p.vy += (pdy / dist) * force;
                }
                p.vx *= 0.85; // damping
                p.vy *= 0.85;
                p.x += p.vx;
                p.y += p.vy;
            }

            // Draw the ball using smooth bezier through points
            const grad = ctx.createRadialGradient(cx - baseR * 0.2, cy - baseR * 0.2, baseR * 0.1, cx, cy, baseR * 1.2);
            grad.addColorStop(0, `hsla(${state.hue}, 70%, 65%, 0.9)`);
            grad.addColorStop(0.7, `hsla(${state.hue}, 60%, 50%, 0.8)`);
            grad.addColorStop(1, `hsla(${state.hue}, 50%, 35%, 0.6)`);

            ctx.fillStyle = grad;
            ctx.beginPath();
            // Catmull-Rom style smooth path
            for (let i = 0; i < N; i++) {
                const p0 = state.points[(i - 1 + N) % N];
                const p1 = state.points[i];
                const p2 = state.points[(i + 1) % N];
                if (i === 0) ctx.moveTo(p1.x, p1.y);
                const cpx = (p0.x + p2.x) / 2;
                const cpy = (p0.y + p2.y) / 2;
                ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
            }
            ctx.closePath();
            ctx.fill();

            // Shine highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.beginPath();
            ctx.ellipse(cx - baseR * 0.2, cy - baseR * 0.25, baseR * 0.25, baseR * 0.15, -0.4, 0, Math.PI * 2);
            ctx.fill();

            // Register in shared world for cross-toy collisions
            const td = getToolDataForToy(canvas);
            if (td) {
                // Compute average center from deformed points
                let ax = 0, ay = 0;
                for (const p of state.points) { ax += p.x; ay += p.y; }
                ax /= N; ay /= N;
                toyWorldRegister(td.id, td, [{
                    id: 'stressball-body', x: ax, y: ay, r: baseR,
                    vx: state.points[0].vx, vy: state.points[0].vy,
                    mass: 3, localRef: state.points[0]
                }]);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            state.pressing = true;
            const p = toyPointerPos(e, canvas, w, h);
            state.pressX = p.x; state.pressY = p.y;
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!state.pressing) return;
            const p = toyPointerPos(e, canvas, w, h);
            state.pressX = p.x; state.pressY = p.y;
        });
        canvas.addEventListener('pointerup', () => { state.pressing = false; });
        canvas.addEventListener('pointerleave', () => { state.pressing = false; });

        draw();
    }

    // --- Fidget Spinner ---
    function initFidgetSpinnerToy(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2;
        const armR = w * 0.32;
        state.angle = 0;
        state.velocity = 0;
        state.lastAngle = null;
        state.lastTime = null;
        state.dragging = false;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Apply friction
            if (!state.dragging) {
                state.velocity *= 0.992;
                if (Math.abs(state.velocity) < 0.0001) state.velocity = 0;
                state.angle += state.velocity;
            }

            // Motion blur effect when spinning fast
            const speed = Math.abs(state.velocity);
            const blurSteps = speed > 0.15 ? 3 : 1;
            const blurAlpha = blurSteps > 1 ? 0.3 : 1;

            for (let b = 0; b < blurSteps; b++) {
                const a = state.angle - state.velocity * b * 0.3;
                ctx.globalAlpha = b === 0 ? 1 : blurAlpha / (b + 1);

                // Draw 3 arms
                for (let arm = 0; arm < 3; arm++) {
                    const armAngle = a + (arm * Math.PI * 2 / 3);
                    const ax = cx + armR * Math.cos(armAngle);
                    const ay = cy + armR * Math.sin(armAngle);

                    // Arm body
                    ctx.strokeStyle = `hsla(${arm * 120 + 200}, 50%, 55%, 0.7)`;
                    ctx.lineWidth = 14;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(ax, ay);
                    ctx.stroke();

                    // Arm tip circle
                    ctx.fillStyle = `hsla(${arm * 120 + 200}, 45%, 50%, 0.8)`;
                    ctx.beginPath();
                    ctx.arc(ax, ay, 12, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Center hub
                ctx.fillStyle = 'rgba(160, 160, 180, 0.9)';
                ctx.beginPath();
                ctx.arc(cx, cy, 14, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(120, 120, 140, 0.8)';
                ctx.beginPath();
                ctx.arc(cx, cy, 8, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Speed indicator
            if (speed > 0.01) {
                const rpm = Math.round(speed * 60 / (Math.PI * 2) * 60);
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.font = '10px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(`${rpm} rpm`, cx, h - 6);
            }

            // Register spinner arms in shared world
            const td = getToolDataForToy(canvas);
            if (td) {
                const worldBodies = [];
                for (let arm = 0; arm < 3; arm++) {
                    const armAngle = state.angle + (arm * Math.PI * 2 / 3);
                    const ax2 = cx + armR * Math.cos(armAngle);
                    const ay2 = cy + armR * Math.sin(armAngle);
                    worldBodies.push({
                        id: 'spinner-' + arm, x: ax2, y: ay2, r: 12,
                        vx: -Math.sin(armAngle) * state.velocity * armR,
                        vy: Math.cos(armAngle) * state.velocity * armR,
                        mass: 2, localRef: { vx: 0, vy: 0, _spinner: state }
                    });
                }
                toyWorldRegister(td.id, td, worldBodies);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            state.dragging = true;
            const p = toyPointerPos(e, canvas, w, h);
            const mx = p.x - cx;
            const my = p.y - cy;
            state.lastAngle = Math.atan2(my, mx);
            state.lastTime = performance.now();
            try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!state.dragging) return;
            const p = toyPointerPos(e, canvas, w, h);
            const mx = p.x - cx;
            const my = p.y - cy;
            const newAngle = Math.atan2(my, mx);
            if (state.lastAngle !== null) {
                let delta = newAngle - state.lastAngle;
                // Normalize to [-PI, PI]
                if (delta > Math.PI) delta -= Math.PI * 2;
                if (delta < -Math.PI) delta += Math.PI * 2;
                state.angle += delta;

                const now = performance.now();
                const dt = now - (state.lastTime || now);
                if (dt > 0) state.velocity = delta * 0.6 + state.velocity * 0.4;
                state.lastTime = now;
            }
            state.lastAngle = newAngle;
        });

        canvas.addEventListener('pointerup', () => { state.dragging = false; state.lastAngle = null; });
        canvas.addEventListener('lostpointercapture', () => { state.dragging = false; state.lastAngle = null; });

        draw();
    }

    // --- Breathing Circle ---
    function initBreathingCircleToy(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2;
        const maxR = w * 0.38, minR = w * 0.15;
        state.startTime = performance.now();
        // 4-7-8 pattern: 4s inhale, 7s hold, 8s exhale = 19s cycle
        const inhale = 4, hold = 7, exhale = 8;
        const total = inhale + hold + exhale;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            const t = ((performance.now() - state.startTime) / 1000) % total;

            let progress, label;
            if (t < inhale) {
                progress = t / inhale; // 0→1
                label = 'Breathe in...';
            } else if (t < inhale + hold) {
                progress = 1;
                label = 'Hold...';
            } else {
                progress = 1 - (t - inhale - hold) / exhale; // 1→0
                label = 'Breathe out...';
            }

            // Smooth easing
            const ease = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            const r = minR + (maxR - minR) * ease;
            const hue = 180 + ease * 40; // teal to blue shift

            // Outer rings
            for (let i = 3; i >= 0; i--) {
                const rr = r + i * 8;
                const alpha = 0.08 - i * 0.015;
                ctx.fillStyle = `hsla(${hue}, 60%, 60%, ${alpha})`;
                ctx.beginPath();
                ctx.arc(cx, cy, rr, 0, Math.PI * 2);
                ctx.fill();
            }

            // Main circle
            const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
            grad.addColorStop(0, `hsla(${hue}, 65%, 70%, 0.6)`);
            grad.addColorStop(0.7, `hsla(${hue}, 55%, 55%, 0.4)`);
            grad.addColorStop(1, `hsla(${hue}, 50%, 45%, 0.2)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            // Inner glow
            ctx.fillStyle = `hsla(${hue}, 70%, 80%, 0.3)`;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
            ctx.fill();

            // Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.font = '12px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText(label, cx, h - 10);

            state._animId = requestAnimationFrame(draw);
        }

        draw();
    }

    // --- Newton's Cradle ---
    function initNewtonsCradleToy(ctx, w, h, state, canvas) {
        const N = 5;
        const ballR = 10;
        const stringLen = h * 0.55;
        const spacing = ballR * 2.5;
        const topY = 18;
        const restX = (w - (N - 1) * spacing) / 2;

        state.balls = [];
        for (let i = 0; i < N; i++) {
            state.balls.push({
                anchorX: restX + i * spacing,
                anchorY: topY,
                angle: 0, // pendulum angle in radians
                angVel: 0
            });
        }
        // Start with left ball pulled out
        state.balls[0].angle = -0.6;
        state.dragging = null;
        state.gravity = 9.8;
        state.dampening = 0.999;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Frame
            ctx.strokeStyle = 'rgba(180,180,200,0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(restX - ballR * 2, topY);
            ctx.lineTo(restX + (N - 1) * spacing + ballR * 2, topY);
            ctx.stroke();

            // Physics
            const dt = 0.016;
            for (let i = 0; i < N; i++) {
                const b = state.balls[i];
                if (state.dragging === i) continue;
                // Pendulum: angular acceleration = -(g/L)*sin(angle)
                const angAcc = -(state.gravity / (stringLen * 0.15)) * Math.sin(b.angle);
                b.angVel += angAcc * dt;
                b.angVel *= state.dampening;
                b.angle += b.angVel * dt;
            }

            // Collision: simple momentum transfer between adjacent balls
            for (let i = 0; i < N - 1; i++) {
                const a = state.balls[i], bn = state.balls[i + 1];
                // Calculate ball positions
                const ax = a.anchorX + stringLen * Math.sin(a.angle);
                const bx = bn.anchorX + stringLen * Math.sin(bn.angle);
                // If overlapping
                if (bx - ax < ballR * 2) {
                    // Swap velocities (elastic collision)
                    const tmp = a.angVel;
                    a.angVel = bn.angVel;
                    bn.angVel = tmp;
                    // Separate slightly
                    a.angle -= 0.001;
                    bn.angle += 0.001;
                }
            }

            // Draw
            for (let i = 0; i < N; i++) {
                const b = state.balls[i];
                const bx = b.anchorX + stringLen * Math.sin(b.angle);
                const by = b.anchorY + stringLen * Math.cos(b.angle);

                // String
                ctx.strokeStyle = 'rgba(180,180,200,0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(b.anchorX, b.anchorY);
                ctx.lineTo(bx, by);
                ctx.stroke();

                // Ball
                const grad = ctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, ballR);
                grad.addColorStop(0, 'rgba(220, 220, 230, 0.9)');
                grad.addColorStop(0.7, 'rgba(180, 180, 195, 0.8)');
                grad.addColorStop(1, 'rgba(140, 140, 160, 0.6)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(bx, by, ballR, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(120,120,140,0.3)';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }

            // Register cradle balls in shared world
            const td = getToolDataForToy(canvas);
            if (td) {
                const worldBodies = [];
                for (let i = 0; i < N; i++) {
                    const b = state.balls[i];
                    const bx = b.anchorX + stringLen * Math.sin(b.angle);
                    const by = b.anchorY + stringLen * Math.cos(b.angle);
                    worldBodies.push({
                        id: 'cradle-' + i, x: bx, y: by, r: ballR,
                        vx: b.angVel * stringLen * 0.5, vy: 0,
                        mass: 2, localRef: b
                    });
                }
                toyWorldRegister(td.id, td, worldBodies);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const { x: mx, y: my } = toyPointerPos(e, canvas, w, h);

            // Find closest ball
            for (let i = 0; i < N; i++) {
                const b = state.balls[i];
                const bx = b.anchorX + stringLen * Math.sin(b.angle);
                const by = b.anchorY + stringLen * Math.cos(b.angle);
                const dx = mx - bx, dy = my - by;
                if (dx * dx + dy * dy < (ballR + 10) * (ballR + 10)) {
                    state.dragging = i;
                    b.angVel = 0;
                    try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
                    break;
                }
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            if (state.dragging === null) return;
            const mx = toyPointerPos(e, canvas, w, h).x;
            const b = state.balls[state.dragging];
            const dx = mx - b.anchorX;
            b.angle = Math.asin(Math.max(-0.95, Math.min(0.95, dx / stringLen)));
        });

        canvas.addEventListener('pointerup', () => { state.dragging = null; });
        canvas.addEventListener('lostpointercapture', () => { state.dragging = null; });

        draw();
    }

    // --- Infinity Spinner (Trace) ---
    function initInfinitySpinnerToy(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2;
        const scaleX = w * 0.35, scaleY = h * 0.32;
        state.dots = [{ t: 0 }];
        state.trails = [];
        state.startTime = performance.now();
        state.hue = 0;

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            // Add a new dot
            if (state.dots.length < 8) {
                state.dots.push({ t: state.dots.length * 0.8 });
            } else {
                // Reset
                state.dots = [{ t: 0 }];
            }
        });

        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            const now = performance.now();
            const elapsed = (now - state.startTime) / 1000;
            state.hue = (elapsed * 20) % 360;

            // Draw lemniscate path hint
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i <= 100; i++) {
                const t = (i / 100) * Math.PI * 2;
                const x = cx + scaleX * Math.cos(t);
                const y = cy + scaleY * Math.sin(2 * t) / 2;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Update and draw dots
            for (let d = 0; d < state.dots.length; d++) {
                const dot = state.dots[d];
                dot.t += 0.02;
                const x = cx + scaleX * Math.cos(dot.t);
                const y = cy + scaleY * Math.sin(2 * dot.t) / 2;

                // Trail
                const dotHue = (state.hue + d * 45) % 360;

                // Draw glow
                const grad = ctx.createRadialGradient(x, y, 0, x, y, 8);
                grad.addColorStop(0, `hsla(${dotHue}, 80%, 70%, 0.8)`);
                grad.addColorStop(0.5, `hsla(${dotHue}, 70%, 60%, 0.3)`);
                grad.addColorStop(1, `hsla(${dotHue}, 60%, 50%, 0)`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, 8, 0, Math.PI * 2);
                ctx.fill();

                // Core dot
                ctx.fillStyle = `hsla(${dotHue}, 80%, 80%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // Tap hint
            if (state.dots.length < 3) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '10px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText('Tap to add dots', cx, h - 6);
            }

            state._animId = requestAnimationFrame(draw);
        }

        draw();
    }

    // --- Lava Lamp ---
    function initLavaLamp(ctx, w, h, state, canvas) {
        const N = 6;
        state.blobs = [];
        for (let i = 0; i < N; i++) {
            state.blobs.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.2 + Math.random() * h * 0.6,
                r: 15 + Math.random() * 25,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -0.2 - Math.random() * 0.4,
                phase: Math.random() * Math.PI * 2,
                hueOff: Math.random() * 40
            });
        }
        state.baseHue = Math.random() * 360;
        state.time = 0;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            state.time += 0.016;

            // Update blobs
            for (const b of state.blobs) {
                b.phase += 0.02;
                // Gentle upward drift with sine wobble, wrapping
                b.x += b.vx + Math.sin(b.phase) * 0.3;
                b.y += b.vy + Math.sin(b.phase * 0.7) * 0.2;
                // Gently steer back toward center if straying far
                if (b.x < -w * 0.5) b.vx += 0.05;
                if (b.x > w * 1.5) b.vx -= 0.05;
                // Wrap vertically
                if (b.y < -b.r * 2) b.y = h + b.r;
                if (b.y > h + b.r * 2) b.y = -b.r;
                // Pulse radius
                b._drawR = b.r + Math.sin(b.phase * 1.3) * 5;
            }

            // Draw blobs with glow
            for (const b of state.blobs) {
                const hue = (state.baseHue + b.hueOff + state.time * 8) % 360;
                const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b._drawR * 1.5);
                grad.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.8)`);
                grad.addColorStop(0.6, `hsla(${hue}, 70%, 50%, 0.4)`);
                grad.addColorStop(1, `hsla(${hue}, 60%, 40%, 0)`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b._drawR * 1.5, 0, Math.PI * 2);
                ctx.fill();

                // Core
                ctx.fillStyle = `hsla(${hue}, 85%, 70%, 0.9)`;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b._drawR * 0.6, 0, Math.PI * 2);
                ctx.fill();
            }

            // Register blobs in shared world
            const td = getToolDataForToy(canvas);
            if (td) {
                const worldBodies = state.blobs.map((b, i) => ({
                    id: 'lava-' + i, x: b.x, y: b.y, r: b._drawR || b.r,
                    vx: b.vx, vy: b.vy,
                    mass: 2, localRef: b
                }));
                toyWorldRegister(td.id, td, worldBodies);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // --- Magnetic Sand ---
    function initMagnetSand(ctx, w, h, state, canvas) {
        const N = 300;
        state.particles = [];
        for (let i = 0; i < N; i++) {
            state.particles.push({
                x: Math.random() * w, y: Math.random() * h,
                homeX: Math.random() * w, homeY: Math.random() * h,
                angle: Math.random() * Math.PI * 2,
                len: 2 + Math.random() * 4
            });
        }
        state.magnetX = w / 2;
        state.magnetY = h / 2;
        state.magnetActive = false;
        state.releaseFrame = 0; // counts up after release for burst scatter

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            if (!state.magnetActive) state.releaseFrame++;

            for (const p of state.particles) {
                if (state.magnetActive) {
                    state.releaseFrame = 0;
                    // Attract toward magnet
                    const dx = state.magnetX - p.x, dy = state.magnetY - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) + 1;
                    const force = Math.min(2, 80 / (dist + 10));
                    p.x += (dx / dist) * force * 0.4;
                    p.y += (dy / dist) * force * 0.4;
                    // Align angle with field
                    p.angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.1;
                } else {
                    // Fast scatter on release, then settle to random drift
                    const burst = Math.max(0, 1 - state.releaseFrame / 40);
                    const scatter = 2 + burst * 4;
                    p.x += (Math.random() - 0.5) * scatter;
                    p.y += (Math.random() - 0.5) * scatter;
                    // Drift toward home position
                    p.x += (p.homeX - p.x) * 0.02;
                    p.y += (p.homeY - p.y) * 0.02;
                    p.angle += (Math.random() - 0.5) * (0.08 + burst * 0.2);
                }

                // Clamp to toy bounds
                p.x = Math.max(0, Math.min(w, p.x));
                p.y = Math.max(0, Math.min(h, p.y));

                // Draw as tiny elongated line (iron filing)
                const cos = Math.cos(p.angle) * p.len;
                const sin = Math.sin(p.angle) * p.len;
                ctx.strokeStyle = `rgba(${120 + Math.random() * 60}, ${110 + Math.random() * 50}, ${100 + Math.random() * 40}, 0.8)`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x - cos, p.y - sin);
                ctx.lineTo(p.x + cos, p.y + sin);
                ctx.stroke();
            }

            // Magnet glow
            if (state.magnetActive) {
                const grad = ctx.createRadialGradient(state.magnetX, state.magnetY, 0, state.magnetX, state.magnetY, 40);
                grad.addColorStop(0, 'rgba(200, 50, 50, 0.15)');
                grad.addColorStop(1, 'rgba(200, 50, 50, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(state.magnetX, state.magnetY, 40, 0, Math.PI * 2);
                ctx.fill();
            }

            state._animId = requestAnimationFrame(draw);
        }

        // No stopPropagation / setPointerCapture — let drag still work on el
        canvas.addEventListener('pointerdown', (e) => {
            state.magnetActive = true;
            const p = toyPointerPos(e, canvas, w, h);
            state.magnetX = p.x; state.magnetY = p.y;
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!state.magnetActive) return;
            const p = toyPointerPos(e, canvas, w, h);
            state.magnetX = p.x; state.magnetY = p.y;
        });
        canvas.addEventListener('pointerup', () => { state.magnetActive = false; });
        // Also listen on the parent element so magnet tracks during drag (el captures pointer)
        const elRef = canvas.closest('.toolbox-canvas-item');
        if (elRef) {
            elRef.addEventListener('pointermove', (e) => {
                if (!state.magnetActive) return;
                const p = toyPointerPos(e, canvas, w, h);
                state.magnetX = p.x; state.magnetY = p.y;
            });
            elRef.addEventListener('pointerup', () => { state.magnetActive = false; });
        }

        draw();
    }

    // --- Zen Pond ---
    function initZenPond(ctx, w, h, state, canvas) {
        state.ripples = [];
        state.time = 0;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            state.time += 0.016;

            // Subtle ambient shimmer
            for (let i = 0; i < 3; i++) {
                const sx = w * 0.3 + Math.sin(state.time * 0.5 + i * 2) * w * 0.2;
                const sy = h * 0.3 + Math.cos(state.time * 0.4 + i * 3) * h * 0.2;
                ctx.fillStyle = `rgba(80, 160, 200, ${0.03 + Math.sin(state.time + i) * 0.01})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 30 + Math.sin(state.time * 0.3 + i) * 10, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw and update ripples
            for (let i = state.ripples.length - 1; i >= 0; i--) {
                const r = state.ripples[i];
                r.radius += r.speed;
                r.alpha -= 0.008;
                if (r.alpha <= 0) { state.ripples.splice(i, 1); continue; }

                // Multiple concentric rings
                for (let ring = 0; ring < 3; ring++) {
                    const rr = r.radius - ring * 12;
                    if (rr < 0) continue;
                    const a = r.alpha * (1 - ring * 0.3);
                    ctx.strokeStyle = `rgba(150, 220, 255, ${a})`;
                    ctx.lineWidth = 1.5 - ring * 0.4;
                    ctx.beginPath();
                    ctx.arc(r.x, r.y, rr, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }

            // Hint text
            if (state.ripples.length === 0) {
                ctx.fillStyle = 'rgba(150, 200, 230, 0.3)';
                ctx.font = '11px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText('Tap for ripples', w / 2, h / 2);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const p = toyPointerPos(e, canvas, w, h);
            state.ripples.push({ x: p.x, y: p.y, radius: 2, speed: 1.2, alpha: 0.7 });
        });

        draw();
    }

    // --- Chain Rope (Verlet Physics) ---
    function initChainRope(ctx, w, h, state, canvas) {
        const N = 25;
        const segLen = 8;
        state.points = [];
        for (let i = 0; i < N; i++) {
            const x = w / 2, y = 30 + i * segLen;
            state.points.push({ x, y, ox: x, oy: y });
        }
        state.grabIndex = -1;
        state.gravity = 0.5;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Verlet integration
            for (let i = 0; i < N; i++) {
                if (i === state.grabIndex) continue;
                const p = state.points[i];
                const vx = (p.x - p.ox) * 0.99;
                const vy = (p.y - p.oy) * 0.99;
                p.ox = p.x;
                p.oy = p.y;
                p.x += vx;
                p.y += vy + state.gravity;
            }

            // Constraints (multiple iterations for stability)
            for (let iter = 0; iter < 5; iter++) {
                // Pin first point to top center
                if (state.grabIndex !== 0) {
                    state.points[0].x = w / 2;
                    state.points[0].y = 30;
                }
                // Distance constraints
                for (let i = 0; i < N - 1; i++) {
                    const a = state.points[i], b = state.points[i + 1];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    const diff = (dist - segLen) / dist * 0.5;
                    if (i !== state.grabIndex) { a.x += dx * diff; a.y += dy * diff; }
                    if (i + 1 !== state.grabIndex) { b.x -= dx * diff; b.y -= dy * diff; }
                }
            }

            // Draw rope
            ctx.strokeStyle = 'rgba(200, 180, 140, 0.8)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(state.points[0].x, state.points[0].y);
            for (let i = 1; i < N; i++) {
                ctx.lineTo(state.points[i].x, state.points[i].y);
            }
            ctx.stroke();

            // Draw beads
            for (let i = 0; i < N; i += 2) {
                const p = state.points[i];
                const hue = (i / N) * 60 + 20;
                ctx.fillStyle = `hsla(${hue}, 40%, 60%, 0.9)`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }

            // Anchor point
            ctx.fillStyle = 'rgba(180, 180, 200, 0.6)';
            ctx.beginPath();
            ctx.arc(state.points[0].x, state.points[0].y, 6, 0, Math.PI * 2);
            ctx.fill();

            // Register chain points in shared world
            const td = getToolDataForToy(canvas);
            if (td) {
                const worldBodies = [];
                for (let i = 0; i < N; i++) {
                    const p = state.points[i];
                    worldBodies.push({
                        id: 'chain-' + i, x: p.x, y: p.y, r: 5,
                        vx: p.x - p.ox, vy: p.y - p.oy,
                        mass: 1, localRef: p
                    });
                }
                toyWorldRegister(td.id, td, worldBodies);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const pt = toyPointerPos(e, canvas, w, h);
            // Find closest point
            let best = -1, bestD = 900;
            for (let i = 0; i < N; i++) {
                const p = state.points[i];
                const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
                if (d < bestD) { bestD = d; best = i; }
            }
            if (best >= 0) {
                state.grabIndex = best;
                try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
            }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (state.grabIndex < 0) return;
            const pt = toyPointerPos(e, canvas, w, h);
            const p = state.points[state.grabIndex];
            p.ox = p.x; p.oy = p.y;
            p.x = pt.x; p.y = pt.y;
        });
        canvas.addEventListener('pointerup', () => { state.grabIndex = -1; });
        canvas.addEventListener('lostpointercapture', () => { state.grabIndex = -1; });

        draw();
    }

    // --- Jelly Cube (Soft Body) ---
    function initJellyCube(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2;
        const size = w * 0.3;
        const rows = 10, cols = 10;
        const spacing = size / (cols - 1);
        state.pts = [];
        state.restPts = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = cx - size / 2 + c * spacing;
                const y = cy - size / 2 + r * spacing;
                state.pts.push({ x, y, ox: x, oy: y });
                state.restPts.push({ x, y });
            }
        }
        state.grabIdx = -1;
        state.hue = 130 + Math.random() * 100;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Verlet + springs
            for (let i = 0; i < state.pts.length; i++) {
                if (i === state.grabIdx) continue;
                const p = state.pts[i], rest = state.restPts[i];
                const vx = (p.x - p.ox) * 0.95;
                const vy = (p.y - p.oy) * 0.95;
                p.ox = p.x; p.oy = p.y;
                // Spring toward rest position
                const dx = rest.x - p.x, dy = rest.y - p.y;
                p.x += vx + dx * 0.06;
                p.y += vy + dy * 0.06;
            }

            // Structural constraints
            for (let iter = 0; iter < 3; iter++) {
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const i = r * cols + c;
                        // Right neighbor
                        if (c < cols - 1) constrainPair(state.pts, i, i + 1, spacing, state.grabIdx);
                        // Bottom neighbor
                        if (r < rows - 1) constrainPair(state.pts, i, i + cols, spacing, state.grabIdx);
                    }
                }
            }

            // Draw filled jelly
            const hue = state.hue;
            // Draw quad fills
            ctx.globalAlpha = 0.6;
            for (let r = 0; r < rows - 1; r++) {
                for (let c = 0; c < cols - 1; c++) {
                    const tl = state.pts[r * cols + c];
                    const tr = state.pts[r * cols + c + 1];
                    const bl = state.pts[(r + 1) * cols + c];
                    const br = state.pts[(r + 1) * cols + c + 1];
                    const lum = 50 + ((r + c) % 2) * 8;
                    ctx.fillStyle = `hsla(${hue}, 55%, ${lum}%, 0.7)`;
                    ctx.beginPath();
                    ctx.moveTo(tl.x, tl.y);
                    ctx.lineTo(tr.x, tr.y);
                    ctx.lineTo(br.x, br.y);
                    ctx.lineTo(bl.x, bl.y);
                    ctx.closePath();
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;

            // Outline
            ctx.strokeStyle = `hsla(${hue}, 50%, 40%, 0.5)`;
            ctx.lineWidth = 1.5;
            // Top edge
            ctx.beginPath();
            ctx.moveTo(state.pts[0].x, state.pts[0].y);
            for (let c = 1; c < cols; c++) ctx.lineTo(state.pts[c].x, state.pts[c].y);
            // Right edge
            for (let r = 1; r < rows; r++) ctx.lineTo(state.pts[r * cols + cols - 1].x, state.pts[r * cols + cols - 1].y);
            // Bottom edge
            for (let c = cols - 2; c >= 0; c--) ctx.lineTo(state.pts[(rows - 1) * cols + c].x, state.pts[(rows - 1) * cols + c].y);
            // Left edge
            for (let r = rows - 2; r >= 0; r--) ctx.lineTo(state.pts[r * cols].x, state.pts[r * cols].y);
            ctx.closePath();
            ctx.stroke();

            // Shine
            const tp = state.pts[1];
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.beginPath();
            ctx.ellipse(tp.x + spacing * 0.5, tp.y + spacing * 0.3, spacing * 0.8, spacing * 0.3, -0.2, 0, Math.PI * 2);
            ctx.fill();

            // Register jelly points in shared world
            const td = getToolDataForToy(canvas);
            if (td) {
                const worldBodies = [];
                for (let i = 0; i < state.pts.length; i++) {
                    const p = state.pts[i];
                    worldBodies.push({
                        id: 'jelly-' + i, x: p.x, y: p.y, r: spacing * 0.5,
                        vx: p.x - p.ox, vy: p.y - p.oy,
                        mass: 1.5, localRef: p
                    });
                }
                toyWorldRegister(td.id, td, worldBodies);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const pt = toyPointerPos(e, canvas, w, h);
            let best = -1, bestD = 900;
            for (let i = 0; i < state.pts.length; i++) {
                const p = state.pts[i];
                const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
                if (d < bestD) { bestD = d; best = i; }
            }
            if (best >= 0) {
                state.grabIdx = best;
                try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
            }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (state.grabIdx < 0) return;
            const pt = toyPointerPos(e, canvas, w, h);
            const p = state.pts[state.grabIdx];
            p.ox = p.x; p.oy = p.y;
            p.x = pt.x; p.y = pt.y;
        });
        canvas.addEventListener('pointerup', () => { state.grabIdx = -1; });
        canvas.addEventListener('lostpointercapture', () => { state.grabIdx = -1; });

        draw();
    }

    function constrainPair(pts, i, j, restLen, grabIdx) {
        const a = pts[i], b = pts[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = (dist - restLen) / dist * 0.4;
        if (i !== grabIdx) { a.x += dx * diff; a.y += dy * diff; }
        if (j !== grabIdx) { b.x -= dx * diff; b.y -= dy * diff; }
    }

    // --- Pendulum Wave ---
    function initPendulumWave(ctx, w, h, state, canvas) {
        const N = 15;
        const topY = 20;
        state.pendulums = [];
        for (let i = 0; i < N; i++) {
            const x = w * 0.1 + (w * 0.8 / (N - 1)) * i;
            // Each pendulum has slightly different length → different period
            const len = h * 0.3 + i * (h * 0.025);
            state.pendulums.push({
                anchorX: x, anchorY: topY,
                length: len,
                angle: 0.5, // initial displacement
                angVel: 0
            });
        }
        state.time = 0;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            state.time += 0.016;

            // Top bar
            ctx.strokeStyle = 'rgba(180, 180, 200, 0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(w * 0.05, topY);
            ctx.lineTo(w * 0.95, topY);
            ctx.stroke();

            for (let i = 0; i < N; i++) {
                const p = state.pendulums[i];
                // Physics: simple pendulum
                const g = 200;
                const angAcc = -(g / p.length) * Math.sin(p.angle);
                p.angVel += angAcc * 0.016;
                p.angVel *= 0.9998; // very slight damping
                p.angle += p.angVel * 0.016;

                const bx = p.anchorX + p.length * Math.sin(p.angle);
                const by = p.anchorY + p.length * Math.cos(p.angle);

                // String
                ctx.strokeStyle = 'rgba(180, 180, 200, 0.3)';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(p.anchorX, p.anchorY);
                ctx.lineTo(bx, by);
                ctx.stroke();

                // Ball with color gradient based on position
                const hue = (i / N) * 280 + 200;
                ctx.fillStyle = `hsla(${hue}, 60%, 60%, 0.85)`;
                ctx.beginPath();
                ctx.arc(bx, by, 6, 0, Math.PI * 2);
                ctx.fill();

                // Glow
                ctx.fillStyle = `hsla(${hue}, 70%, 70%, 0.15)`;
                ctx.beginPath();
                ctx.arc(bx, by, 12, 0, Math.PI * 2);
                ctx.fill();
            }

            // Register pendulum balls in shared world
            const td = getToolDataForToy(canvas);
            if (td) {
                const worldBodies = [];
                for (let i = 0; i < N; i++) {
                    const p = state.pendulums[i];
                    const bx2 = p.anchorX + p.length * Math.sin(p.angle);
                    const by2 = p.anchorY + p.length * Math.cos(p.angle);
                    worldBodies.push({
                        id: 'pend-' + i, x: bx2, y: by2, r: 6,
                        vx: p.angVel * p.length * 0.5, vy: 0,
                        mass: 1.5, localRef: p
                    });
                }
                toyWorldRegister(td.id, td, worldBodies);
                toyWorldCollide(td.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        // Tap to re-trigger wave
        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            for (const p of state.pendulums) {
                p.angle = 0.5;
                p.angVel = 0;
            }
        });

        draw();
    }

    // --- Kaleidoscope ---
    function initKaleidoscope(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2;
        const segments = 8;
        state.drawing = false;
        state.hue = 0;
        // Offscreen canvas for accumulating draws
        state.offCanvas = document.createElement('canvas');
        state.offCanvas.width = canvas.width;
        state.offCanvas.height = canvas.height;
        state.offCtx = state.offCanvas.getContext('2d');
        // Match DPR and padding transform
        const dpr = toyDPR();
        const pad = parseInt(canvas.dataset.pad) || TOY_PAD;
        state.offCtx.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr);
        state.lastPt = null;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Draw the accumulated offscreen layer
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(state.offCanvas, 0, 0);
            ctx.restore();

            // Slowly fade the offscreen canvas
            const offCtx = state.offCtx;
            offCtx.save();
            offCtx.setTransform(1, 0, 0, 1, 0, 0);
            offCtx.fillStyle = 'rgba(0, 0, 0, 0.003)';
            offCtx.fillRect(0, 0, state.offCanvas.width, state.offCanvas.height);
            offCtx.restore();

            if (!state.drawing) {
                ctx.fillStyle = 'rgba(200, 200, 220, 0.3)';
                ctx.font = '10px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText('Draw inside!', cx, cy);
            }

            state._animId = requestAnimationFrame(draw);
        }

        function drawSymmetric(x, y) {
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            state.hue = (state.hue + 1) % 360;
            const offCtx = state.offCtx;
            const angle = Math.atan2(dy, dx);
            const r = dist;

            for (let s = 0; s < segments; s++) {
                const a = (s / segments) * Math.PI * 2 + angle;
                const mx = cx + r * Math.cos(a);
                const my = cy + r * Math.sin(a);
                // Also mirror
                const ma = (s / segments) * Math.PI * 2 - angle;
                const mx2 = cx + r * Math.cos(ma);
                const my2 = cy + r * Math.sin(ma);

                for (const pt of [{x: mx, y: my}, {x: mx2, y: my2}]) {
                    offCtx.fillStyle = `hsla(${state.hue}, 80%, 65%, 0.6)`;
                    offCtx.beginPath();
                    offCtx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
                    offCtx.fill();
                }
            }
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            state.drawing = true;
            const pt = toyPointerPos(e, canvas, w, h);
            state.lastPt = pt;
            drawSymmetric(pt.x, pt.y);
            try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!state.drawing) return;
            const pt = toyPointerPos(e, canvas, w, h);
            drawSymmetric(pt.x, pt.y);
            state.lastPt = pt;
        });
        canvas.addEventListener('pointerup', () => { state.drawing = false; });
        canvas.addEventListener('lostpointercapture', () => { state.drawing = false; });

        draw();
    }

    // --- Fidget Clicker ---
    function initFidgetClicker(ctx, w, h, state, canvas) {
        const cx = w / 2, cy = h / 2;
        const btnR = w * 0.3;
        state.count = 0;
        state.press = 0; // 0-1 press depth animation
        state.particles = [];
        state.displayCount = '0';
        state.rollY = 0;
        state.targetRollY = 0;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            // Animate press depth
            if (state.press > 0) state.press *= 0.85;
            if (state.press < 0.01) state.press = 0;

            // Animate roll
            state.rollY += (state.targetRollY - state.rollY) * 0.15;

            const pressOff = state.press * 6;

            // Shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.beginPath();
            ctx.ellipse(cx, cy + btnR + 8, btnR * 0.9, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Button base (3D look)
            ctx.fillStyle = 'rgba(80, 80, 100, 0.6)';
            ctx.beginPath();
            ctx.arc(cx, cy + 4, btnR, 0, Math.PI * 2);
            ctx.fill();

            // Button face
            const faceY = cy - 2 + pressOff;
            const grad = ctx.createRadialGradient(cx - btnR * 0.2, faceY - btnR * 0.2, btnR * 0.1, cx, faceY, btnR);
            grad.addColorStop(0, 'rgba(220, 80, 80, 0.95)');
            grad.addColorStop(0.7, 'rgba(180, 50, 50, 0.9)');
            grad.addColorStop(1, 'rgba(140, 30, 30, 0.85)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, faceY, btnR, 0, Math.PI * 2);
            ctx.fill();

            // Highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.ellipse(cx - btnR * 0.15, faceY - btnR * 0.25, btnR * 0.35, btnR * 0.2, -0.3, 0, Math.PI * 2);
            ctx.fill();

            // Count text on button
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.font = `bold ${Math.min(24, w * 0.15)}px system-ui`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(state.count.toString(), cx, faceY);

            // Burst particles
            for (let i = state.particles.length - 1; i >= 0; i--) {
                const p = state.particles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.15;
                p.life -= 0.025;
                if (p.life <= 0) { state.particles.splice(i, 1); continue; }
                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            state.count++;
            state.press = 1;
            // Burst particles
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
                const speed = 2 + Math.random() * 3;
                state.particles.push({
                    x: cx, y: cy,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 2,
                    size: 2 + Math.random() * 3,
                    life: 1,
                    color: `hsla(${Math.random() * 60 + 340}, 80%, 65%, 1)`
                });
            }
        });

        draw();
    }

    // --- Static Box Barrier ---
    function initStaticBox(ctx, w, h, state, canvas) {
        const toolData = getToolDataForToy(canvas);
        const m = 4, rx = 6;
        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            // Solid box with subtle lines
            ctx.fillStyle = '#5a5a6e';
            ctx.strokeStyle = '#3a3a4e';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.roundRect(m, m, w - m * 2, h - m * 2, rx);
            ctx.fill(); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            for (let y = m + 12; y < h - m; y += 12) {
                ctx.beginPath(); ctx.moveTo(m + 4, y); ctx.lineTo(w - m - 4, y); ctx.stroke();
            }
            // Register as static AABB body
            if (toolData) {
                toyWorldRegister(toolData.id, toolData, [{
                    id: 'sbox_0', x: w / 2, y: h / 2,
                    hw: (w - m * 2) / 2, hh: (h - m * 2) / 2,
                    mass: 9999
                }]);
                toyWorldCollide(toolData.id);
            }
            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // --- Static Ball Barrier ---
    function initStaticBall(ctx, w, h, state, canvas) {
        const toolData = getToolDataForToy(canvas);
        const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.42;
        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            // Solid circle
            const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
            grad.addColorStop(0, '#7a7a8e');
            grad.addColorStop(1, '#4a4a5e');
            ctx.fillStyle = grad;
            ctx.strokeStyle = '#3a3a4e';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.ellipse(cx - r * 0.2, cy - r * 0.3, r * 0.3, r * 0.15, -0.4, 0, Math.PI * 2);
            ctx.fill();
            // Register as static circle body
            if (toolData) {
                toyWorldRegister(toolData.id, toolData, [{
                    id: 'sball_0', x: cx, y: cy, r: r,
                    mass: 9999
                }]);
                toyWorldCollide(toolData.id);
            }
            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // --- Static Wall Barrier ---
    function initStaticWall(ctx, w, h, state, canvas) {
        const toolData = getToolDataForToy(canvas);
        const m = 3;
        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            // Brick-like wall
            ctx.fillStyle = '#8b5e3c';
            ctx.strokeStyle = '#5a3a20';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(m, m, w - m * 2, h - m * 2, 4);
            ctx.fill(); ctx.stroke();
            // Brick lines
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            const brickH = 14;
            for (let row = 0; row < Math.ceil(h / brickH); row++) {
                const y = m + row * brickH;
                if (y > h - m) break;
                ctx.beginPath(); ctx.moveTo(m, y); ctx.lineTo(w - m, y); ctx.stroke();
                const off = (row % 2) ? (w - m * 2) * 0.5 : 0;
                const mx = m + off;
                if (mx > m && mx < w - m) {
                    ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx, Math.min(y + brickH, h - m)); ctx.stroke();
                }
            }
            // Register as static AABB body
            if (toolData) {
                toyWorldRegister(toolData.id, toolData, [{
                    id: 'swall_0', x: w / 2, y: h / 2,
                    hw: (w - m * 2) / 2, hh: (h - m * 2) / 2,
                    mass: 9999
                }]);
                toyWorldCollide(toolData.id);
            }
            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // --- Static Floor Barrier ---
    function initStaticFloor(ctx, w, h, state, canvas) {
        const toolData = getToolDataForToy(canvas);
        const m = 2;
        function draw() {
            ctx._clearFull(); ctx._resetTransform();
            // Metallic floor platform
            const grad = ctx.createLinearGradient(0, m, 0, h - m);
            grad.addColorStop(0, '#9a9aae');
            grad.addColorStop(0.5, '#6a6a7e');
            grad.addColorStop(1, '#5a5a6e');
            ctx.fillStyle = grad;
            ctx.strokeStyle = '#3a3a4e';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(m, m, w - m * 2, h - m * 2, 3);
            ctx.fill(); ctx.stroke();
            // Grip lines
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            for (let x = m + 10; x < w - m; x += 16) {
                ctx.beginPath(); ctx.moveTo(x, m + 2); ctx.lineTo(x, h - m - 2); ctx.stroke();
            }
            // Register as static AABB body
            if (toolData) {
                toyWorldRegister(toolData.id, toolData, [{
                    id: 'sfloor_0', x: w / 2, y: h / 2,
                    hw: (w - m * 2) / 2, hh: (h - m * 2) / 2,
                    mass: 9999
                }]);
                toyWorldCollide(toolData.id);
            }
            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // --- Bouncy Ball (rigidbody) ---
    function initRigiBall(ctx, w, h, state, canvas) {
        const toolData = getToolDataForToy(canvas);
        const ballR = Math.min(w, h) * 0.12;
        const ball = { x: w / 2, y: h * 0.3, vx: 1.5, vy: 0 };
        state.ball = ball;
        const gravity = 0.3, bounce = 0.75, friction = 0.995;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            if (!state.grabbed) {
                ball.vy += gravity;
                ball.vx *= friction;
            }
            ball.x += ball.vx;
            ball.y += ball.vy;

            // Bounce off local walls
            if (ball.x - ballR < 0) { ball.x = ballR; ball.vx = Math.abs(ball.vx) * bounce; }
            if (ball.x + ballR > w) { ball.x = w - ballR; ball.vx = -Math.abs(ball.vx) * bounce; }
            if (ball.y - ballR < 0) { ball.y = ballR; ball.vy = Math.abs(ball.vy) * bounce; }
            if (ball.y + ballR > h) { ball.y = h - ballR; ball.vy = -Math.abs(ball.vy) * bounce; }

            // Ball shadow
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.beginPath();
            ctx.ellipse(ball.x + 3, ball.y + ballR + 4, ballR * 0.8, 4, 0, 0, Math.PI * 2);
            ctx.fill();

            // Ball body
            const grad = ctx.createRadialGradient(ball.x - ballR * 0.3, ball.y - ballR * 0.3, ballR * 0.1, ball.x, ball.y, ballR);
            grad.addColorStop(0, '#ff9944');
            grad.addColorStop(0.7, '#dd5522');
            grad.addColorStop(1, '#aa3300');
            ctx.fillStyle = grad;
            ctx.strokeStyle = '#882200';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ballR, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.ellipse(ball.x - ballR * 0.2, ball.y - ballR * 0.3, ballR * 0.3, ballR * 0.15, -0.4, 0, Math.PI * 2);
            ctx.fill();

            // Seam lines
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ballR * 0.65, -0.5, 0.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ballR * 0.65, Math.PI - 0.5, Math.PI + 0.5);
            ctx.stroke();

            // Register in physics world
            if (toolData) {
                toyWorldRegister(toolData.id, toolData, [{
                    id: 'rb_0', x: ball.x, y: ball.y, r: ballR,
                    vx: ball.vx, vy: ball.vy, mass: 2,
                    localRef: ball
                }]);
                toyWorldCollide(toolData.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            const p = toyPointerPos(e, canvas, w, h);
            const dx = p.x - ball.x, dy = p.y - ball.y;
            if (dx * dx + dy * dy < (ballR * 3) * (ballR * 3)) {
                state.grabbed = true;
                state.grabOff = { x: dx, y: dy };
            }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!state.grabbed) return;
            const p = toyPointerPos(e, canvas, w, h);
            const nx = p.x - state.grabOff.x, ny = p.y - state.grabOff.y;
            ball.vx = (nx - ball.x) * 0.3;
            ball.vy = (ny - ball.y) * 0.3;
            ball.x = nx; ball.y = ny;
        });
        canvas.addEventListener('pointerup', () => { state.grabbed = false; });
        canvas.addEventListener('lostpointercapture', () => { state.grabbed = false; });

        draw();
    }

    // --- Physics Crate (rigidbody) ---
    function initRigiCrate(ctx, w, h, state, canvas) {
        const toolData = getToolDataForToy(canvas);
        const bw = w * 0.3, bh = w * 0.3;
        const box = { x: w / 2, y: h * 0.3, vx: 0.8, vy: 0, hw: bw / 2, hh: bh / 2 };
        state.box = box;
        const gravity = 0.3, bounce = 0.5, friction = 0.99;

        function draw() {
            ctx._clearFull(); ctx._resetTransform();

            if (!state.grabbed) {
                box.vy += gravity;
                box.vx *= friction;
            }
            box.x += box.vx;
            box.y += box.vy;

            // Bounce off local walls
            if (box.x - box.hw < 0) { box.x = box.hw; box.vx = Math.abs(box.vx) * bounce; }
            if (box.x + box.hw > w) { box.x = w - box.hw; box.vx = -Math.abs(box.vx) * bounce; }
            if (box.y - box.hh < 0) { box.y = box.hh; box.vy = Math.abs(box.vy) * bounce; }
            if (box.y + box.hh > h) { box.y = h - box.hh; box.vy = -Math.abs(box.vy) * bounce; }

            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.beginPath();
            ctx.roundRect(box.x - box.hw + 3, box.y + box.hh + 2, bw, 5, 2);
            ctx.fill();

            // Crate body
            ctx.fillStyle = '#8b6e4e';
            ctx.strokeStyle = '#5a4228';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(box.x - box.hw, box.y - box.hh, bw, bh, 3);
            ctx.fill(); ctx.stroke();

            // Wood grain
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1;
            const top = box.y - box.hh, left = box.x - box.hw;
            for (let y = top + 6; y < box.y + box.hh; y += 7) {
                ctx.beginPath(); ctx.moveTo(left + 2, y); ctx.lineTo(left + bw - 2, y); ctx.stroke();
            }

            // Cross planks
            ctx.strokeStyle = 'rgba(90,60,30,0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(left + 2, top + 2); ctx.lineTo(left + bw - 2, top + bh - 2);
            ctx.moveTo(left + bw - 2, top + 2); ctx.lineTo(left + 2, top + bh - 2);
            ctx.stroke();

            // Register in physics world
            if (toolData) {
                toyWorldRegister(toolData.id, toolData, [{
                    id: 'rc_0', x: box.x, y: box.y,
                    hw: box.hw, hh: box.hh,
                    vx: box.vx, vy: box.vy, mass: 3,
                    localRef: box
                }]);
                toyWorldCollide(toolData.id);
            }

            state._animId = requestAnimationFrame(draw);
        }

        canvas.addEventListener('pointerdown', (e) => {
            const p = toyPointerPos(e, canvas, w, h);
            if (Math.abs(p.x - box.x) < box.hw * 2 && Math.abs(p.y - box.y) < box.hh * 2) {
                state.grabbed = true;
                state.grabOff = { x: p.x - box.x, y: p.y - box.y };
            }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!state.grabbed) return;
            const p = toyPointerPos(e, canvas, w, h);
            const nx = p.x - state.grabOff.x, ny = p.y - state.grabOff.y;
            box.vx = (nx - box.x) * 0.3;
            box.vy = (ny - box.y) * 0.3;
            box.x = nx; box.y = ny;
        });
        canvas.addEventListener('pointerup', () => { state.grabbed = false; });
        canvas.addEventListener('lostpointercapture', () => { state.grabbed = false; });

        draw();
    }

    // --- Fullscreen Particle Scene ---
    function initParticleScene(ctx, w, h, state, canvas, toolData) {
        const dpr = toyDPR();
        const N = 400;
        state.particles = [];

        // Curated color families — warm golds, cool cyans, soft pinks, icy blues
        const families = [
            { h: 210, s: 70, l: 68 }, // sky blue
            { h: 240, s: 55, l: 65 }, // periwinkle
            { h: 280, s: 40, l: 70 }, // lavender
            { h: 320, s: 45, l: 72 }, // rose
            { h: 180, s: 55, l: 65 }, // teal
            { h: 45,  s: 65, l: 72 }, // warm gold
            { h: 160, s: 40, l: 68 }, // sage
        ];

        // Pre-bake a radial gradient texture for each color family
        const glowTextures = families.map(c => {
            const sz = 64;
            const off = new OffscreenCanvas(sz, sz);
            const g = off.getContext('2d');
            const grad = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
            grad.addColorStop(0, `hsla(${c.h}, ${c.s}%, ${Math.min(95, c.l + 20)}%, 0.9)`);
            grad.addColorStop(0.15, `hsla(${c.h}, ${c.s}%, ${c.l}%, 0.5)`);
            grad.addColorStop(0.4, `hsla(${c.h}, ${c.s - 10}%, ${c.l - 5}%, 0.15)`);
            grad.addColorStop(1, `hsla(${c.h}, ${c.s}%, ${c.l}%, 0)`);
            g.fillStyle = grad;
            g.fillRect(0, 0, sz, sz);
            return off;
        });

        for (let i = 0; i < N; i++) {
            const fi = Math.floor(Math.random() * families.length);
            const c = families[fi];
            state.particles.push({
                x: Math.random() * w, y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
                r: 1.2 + Math.random() * 1.6,
                hue: c.h + (Math.random() - 0.5) * 15,
                sat: c.s + (Math.random() - 0.5) * 10,
                lit: c.l + (Math.random() - 0.5) * 8,
                alpha: 0.45 + Math.random() * 0.35,
                phase: Math.random() * Math.PI * 2,
                tex: fi
            });
        }

        // Multi-touch pointer tracking (document-level, touch only)
        const pointers = new Map();

        const onDown = (e) => {
            if (e.pointerType !== 'touch') return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, pvx: 0, pvy: 0, t: 0 });
        };
        const onMove = (e) => {
            const ptr = pointers.get(e.pointerId);
            if (!ptr) return;
            ptr.pvx = (e.clientX - ptr.x) * 0.6 + ptr.pvx * 0.4;
            ptr.pvy = (e.clientY - ptr.y) * 0.6 + ptr.pvy * 0.4;
            ptr.px = ptr.x;
            ptr.py = ptr.y;
            ptr.x = e.clientX;
            ptr.y = e.clientY;
        };
        const onUp = (e) => {
            const ptr = pointers.get(e.pointerId);
            if (!ptr) return;
            const flingR = 160;
            for (const p of state.particles) {
                const dx = p.x - ptr.x, dy = p.y - ptr.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < flingR) {
                    const strength = (1 - dist / flingR);
                    const ss = strength * strength; // quadratic falloff
                    p.vx += ptr.pvx * ss * 2;
                    p.vy += ptr.pvy * ss * 2;
                    if (dist > 1) {
                        p.vx += (dx / dist) * ss * 3;
                        p.vy += (dy / dist) * ss * 3;
                    }
                }
            }
            pointers.delete(e.pointerId);
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);

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

        let time = 0;
        let lastFrame = performance.now();

        function draw() {
            const now = performance.now();
            const dt = Math.min((now - lastFrame) / 1000, 0.05); // cap at 50ms to avoid spiral
            lastFrame = now;
            const dt60 = dt * 60; // normalized so 1.0 at 60fps

            const vw = state._vw, vh = state._vh;
            time += dt;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const hasPointers = pointers.size > 0;

            // Increment pointer timers
            for (const ptr of pointers.values()) ptr.t += dt;

            // --- Update physics ---
            for (const p of state.particles) {
                if (hasPointers) {
                    let nearDist = Infinity, nearPtr = null;
                    for (const ptr of pointers.values()) {
                        const dx = ptr.x - p.x, dy = ptr.y - p.y;
                        const d = dx * dx + dy * dy;
                        if (d < nearDist) { nearDist = d; nearPtr = ptr; }
                    }
                    if (nearPtr) {
                        const dx = nearPtr.x - p.x, dy = nearPtr.y - p.y;
                        const dist = Math.sqrt(nearDist) + 1;
                        const force = Math.min(3.5, 180 / (dist + 25));
                        p.vx += (dx / dist) * force * 0.13 * dt60;
                        p.vy += (dy / dist) * force * 0.13 * dt60;
                    }
                } else {
                    p.vx += (Math.random() - 0.5) * 0.03 * dt60;
                    p.vy += (Math.random() - 0.5) * 0.03 * dt60;
                }

                const damping = Math.pow(0.978, dt60);
                p.vx *= damping;
                p.vy *= damping;

                const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                if (sp > 10) { p.vx = (p.vx / sp) * 10; p.vy = (p.vy / sp) * 10; }

                p.x += p.vx * dt60;
                p.y += p.vy * dt60;

                if (p.x < -20) p.x = vw + 20;
                if (p.x > vw + 20) p.x = -20;
                if (p.y < -20) p.y = vh + 20;
                if (p.y > vh + 20) p.y = -20;
            }

            // --- Draw constellation mesh (behind particles) ---
            const connDist = 55;
            const connDistSq = connDist * connDist;
            ctx.lineWidth = 0.5;
            for (let i = 0; i < N; i += 2) {
                const a = state.particles[i];
                for (let j = i + 2; j < N; j += 2) {
                    const b = state.particles[j];
                    const dx = a.x - b.x, dy = a.y - b.y;
                    const dSq = dx * dx + dy * dy;
                    if (dSq < connDistSq) {
                        const t = 1 - Math.sqrt(dSq) / connDist;
                        const midH = (a.hue + b.hue) / 2;
                        ctx.globalAlpha = t * t * 0.1;
                        ctx.strokeStyle = `hsl(${midH}, 50%, 75%)`;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
            }

            // --- Draw particles (texture-based glow + core + specular) ---
            ctx.globalCompositeOperation = 'screen';
            for (const p of state.particles) {
                const pulse = 0.88 + 0.12 * Math.sin(time * 1.8 + p.phase);
                const a = p.alpha * pulse;
                const sz = p.r * 8;

                // Glow sprite (pre-baked)
                ctx.globalAlpha = a * 0.55;
                ctx.drawImage(glowTextures[p.tex], p.x - sz / 2, p.y - sz / 2, sz, sz);
            }
            ctx.globalCompositeOperation = 'source-over';

            for (const p of state.particles) {
                const pulse = 0.88 + 0.12 * Math.sin(time * 1.8 + p.phase);
                const a = p.alpha * pulse;

                // Core
                ctx.globalAlpha = a * 0.9;
                ctx.fillStyle = `hsl(${p.hue}, ${Math.min(100, p.sat + 5)}%, ${Math.min(93, p.lit + 12)}%)`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();

                // Hot specular highlight
                ctx.globalAlpha = a * 0.6;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(p.x - p.r * 0.2, p.y - p.r * 0.2, p.r * 0.32, 0, Math.PI * 2);
                ctx.fill();
            }

            // --- Draw pointer aura ---
            ctx.globalCompositeOperation = 'screen';
            for (const ptr of pointers.values()) {
                const breathe = 0.9 + 0.1 * Math.sin(ptr.t * 4);
                const r = 65 * breathe;
                const grad = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, r);
                grad.addColorStop(0, 'rgba(200, 220, 255, 0.08)');
                grad.addColorStop(0.3, 'rgba(160, 190, 255, 0.04)');
                grad.addColorStop(1, 'rgba(140, 170, 255, 0)');
                ctx.globalAlpha = 1;
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(ptr.x, ptr.y, r, 0, Math.PI * 2);
                ctx.fill();
                // Inner ring
                ctx.strokeStyle = 'rgba(200, 220, 255, 0.06)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(ptr.x, ptr.y, 20 * breathe, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;

            state._animId = requestAnimationFrame(draw);
        }
        draw();
    }

    // --- Game Boy (Multi-Game Arcade) ---
    function initGameBoy(ctx, w, h, state, canvas) {
        const bodyW = w, bodyH = h;

        // Screen geometry
        const screenX = 22, screenY = 42;
        const screenW = bodyW - 44, screenH = Math.round(bodyH * 0.43);
        const screenR = 6;

        // Controls geometry
        const dpadCX = bodyW * 0.3;
        const dpadCY = screenY + screenH + 75;
        const dpadSize = 22;
        const btnAX = bodyW * 0.82, btnAY = dpadCY - 12;
        const btnBX = bodyW * 0.66, btnBY = dpadCY + 16;
        const btnRadius = 16;
        const selectX = bodyW * 0.36, startX = bodyW * 0.64;
        const ssY = screenY + screenH + 30;

        // Game registry
        const GAMES = [
            { name: 'Snake',    icon: '🐍', file: '/static/games/snake.html' },
            { name: 'Tetris',   icon: '🧱', file: '/static/games/tetris.html' },
            { name: 'Pong',     icon: '🏓', file: '/static/games/pong.html' },
            { name: 'Breakout', icon: '🧨', file: '/static/games/breakout.html' },
            { name: 'Flappy',   icon: '🐦', file: '/static/games/flappy.html' },
            { name: 'Invaders', icon: '👾', file: '/static/games/invaders.html' }
        ];

        let menuMode = true;
        let selectedIdx = 0;
        let activeBtn = null; // for button press highlight
        let btnFlash = 0;

        // --- Iframe for games ---
        const parentEl = canvas.closest('.toolbox-canvas-item');
        const iframe = document.createElement('iframe');
        iframe.className = 'gb-game-iframe';
        iframe.style.cssText = `position:absolute;left:${screenX}px;top:${screenY}px;width:${screenW}px;height:${screenH}px;border:none;z-index:3;border-radius:${screenR}px;background:#9bbc0f;display:none;`;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        parentEl.appendChild(iframe);

        function loadGame(idx) {
            menuMode = false;
            iframe.src = GAMES[idx].file;
            iframe.style.display = 'block';
        }
        function returnToMenu() {
            menuMode = true;
            iframe.style.display = 'none';
            iframe.src = 'about:blank';
        }
        function sendToGame(btn) {
            try { iframe.contentWindow.postMessage({ type: 'gb-input', btn }, '*'); } catch(_) {}
        }

        // --- Hit testing ---
        function hitTest(lx, ly) {
            if (Math.abs(lx - dpadCX) < dpadSize * 1.6 && Math.abs(ly - dpadCY) < dpadSize * 1.6) {
                const dx = lx - dpadCX, dy = ly - dpadCY;
                return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
            }
            if (Math.hypot(lx - btnAX, ly - btnAY) < btnRadius + 4) return 'a';
            if (Math.hypot(lx - btnBX, ly - btnBY) < btnRadius + 2) return 'b';
            if (Math.abs(lx - selectX) < 20 && Math.abs(ly - ssY) < 8) return 'select';
            if (Math.abs(lx - startX) < 20 && Math.abs(ly - ssY) < 8) return 'start';
            return null;
        }

        function handleInput(btn) {
            if (!btn) return;
            activeBtn = btn; btnFlash = 6;
            if (menuMode) {
                if (btn === 'up') selectedIdx = (selectedIdx - 1 + GAMES.length) % GAMES.length;
                else if (btn === 'down') selectedIdx = (selectedIdx + 1) % GAMES.length;
                else if (btn === 'a' || btn === 'start') loadGame(selectedIdx);
            } else {
                if (btn === 'b') returnToMenu();
                else sendToGame(btn);
            }
            state._requestPaint?.();
        }

        // Pointer events
        canvas.addEventListener('pointerdown', (e) => {
            const pos = toyPointerPos(e, canvas, w, h);
            handleInput(hitTest(pos.x, pos.y));
        });

        // Keyboard
        const keyHandler = (e) => {
            const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
                          w:'up', s:'down', a:'left', d:'right', Enter:'a', ' ':'a', Escape:'b', Backspace:'b' };
            const btn = map[e.key];
            if (btn) { e.preventDefault(); e.stopPropagation(); handleInput(btn); }
        };
        document.addEventListener('keydown', keyHandler);

        // --- Drawing helpers ---
        function rr(x, y, rw, rh, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.lineTo(x + rw - r, y);
            ctx.quadraticCurveTo(x + rw, y, x + rw, y + r);
            ctx.lineTo(x + rw, y + rh - r);
            ctx.quadraticCurveTo(x + rw, y + rh, x + rw - r, y + rh);
            ctx.lineTo(x + r, y + rh);
            ctx.quadraticCurveTo(x, y + rh, x, y + rh - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        function drawShell() {
            // Main body
            rr(0, 0, bodyW, bodyH, 16);
            const grad = ctx.createLinearGradient(0, 0, 0, bodyH);
            grad.addColorStop(0, '#3a3a52'); grad.addColorStop(0.5, '#2d2d3e');
            grad.addColorStop(1, '#252538');
            ctx.fillStyle = grad; ctx.fill();

            // Inner border
            rr(3, 3, bodyW - 6, bodyH - 6, 14);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1.5; ctx.stroke();

            // Top ledge (classic GB has a thicker top)
            rr(0, 0, bodyW, screenY + screenH + 16, 16);
            ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fill();

            // Screen bezel
            rr(screenX - 6, screenY - 6, screenW + 12, screenH + 12, screenR + 4);
            ctx.fillStyle = '#1a2a1a'; ctx.fill();
            // Bezel inner glow
            rr(screenX - 3, screenY - 3, screenW + 6, screenH + 6, screenR + 2);
            ctx.strokeStyle = 'rgba(155,188,15,0.15)'; ctx.lineWidth = 1; ctx.stroke();

            // Power LED
            ctx.beginPath(); ctx.arc(screenX + 10, screenY - 14, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#2a6'; ctx.fill();
            ctx.beginPath(); ctx.arc(screenX + 10, screenY - 14, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#5f8'; ctx.fill();
            // "POWER" label
            ctx.fillStyle = '#555'; ctx.font = '5px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('POWER', screenX + 16, screenY - 12);

            // DOT MATRIX label
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('DOT MATRIX WITH STEREO SOUND', bodyW / 2, screenY - 14);

            // Screen background (only visible when in menu mode — iframe covers it in game mode)
            rr(screenX, screenY, screenW, screenH, screenR);
            ctx.fillStyle = '#9bbc0f'; ctx.fill();
        }

        function drawMenu() {
            ctx.save();
            ctx.beginPath(); rr(screenX, screenY, screenW, screenH, screenR); ctx.clip();

            const cx = screenX + screenW / 2;
            const itemH = 22;
            const listTop = screenY + 36;

            // Title
            ctx.fillStyle = '#0f380f'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
            ctx.fillText('SELECT GAME', cx, screenY + 20);

            // Divider
            ctx.strokeStyle = '#306230'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(screenX + 10, screenY + 26); ctx.lineTo(screenX + screenW - 10, screenY + 26); ctx.stroke();

            // Game list
            for (let i = 0; i < GAMES.length; i++) {
                const y = listTop + i * itemH;
                const isSelected = i === selectedIdx;

                if (isSelected) {
                    rr(screenX + 6, y - 2, screenW - 12, itemH - 2, 4);
                    ctx.fillStyle = '#306230'; ctx.fill();
                }

                ctx.fillStyle = isSelected ? '#9bbc0f' : '#0f380f';
                ctx.font = (isSelected ? 'bold ' : '') + '11px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(GAMES[i].icon + ' ' + GAMES[i].name, screenX + 14, y + 12);

                if (isSelected) {
                    ctx.fillText('►', screenX + screenW - 24, y + 12);
                }
            }

            // Footer hint
            ctx.fillStyle = '#306230'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
            ctx.fillText('▲▼ Move   A Start   B Back', cx, screenY + screenH - 6);

            ctx.restore();
        }

        function drawControls() {
            const flash = btnFlash > 0;

            // --- SELECT / START pills ---
            ctx.save();
            ctx.translate(0, 0);
            [{ x: selectX, label: 'SELECT' }, { x: startX, label: 'START' }].forEach(s => {
                const hit = flash && (activeBtn === 'select' && s.label === 'SELECT' || activeBtn === 'start' && s.label === 'START');
                rr(s.x - 16, ssY - 5, 32, 10, 5);
                ctx.fillStyle = hit ? '#555' : '#1a1a28'; ctx.fill();
                ctx.fillStyle = '#666'; ctx.font = '5.5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(s.label, s.x, ssY);
            });
            ctx.restore();

            // --- D-pad ---
            const dp = dpadSize;
            // Shadow
            rr(dpadCX - dp * 1.6, dpadCY - dp * 1.6, dp * 3.2, dp * 3.2, 6);
            ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill();
            // Cross
            const isUp = flash && activeBtn === 'up', isDown = flash && activeBtn === 'down';
            const isLeft = flash && activeBtn === 'left', isRight = flash && activeBtn === 'right';
            // Vertical
            rr(dpadCX - dp / 2, dpadCY - dp * 1.5, dp, dp * 3, 3);
            ctx.fillStyle = '#1a1a2a'; ctx.fill();
            // Horizontal
            rr(dpadCX - dp * 1.5, dpadCY - dp / 2, dp * 3, dp, 3);
            ctx.fillStyle = '#1a1a2a'; ctx.fill();
            // Center circle
            ctx.beginPath(); ctx.arc(dpadCX, dpadCY, dp * 0.38, 0, Math.PI * 2);
            ctx.fillStyle = '#222238'; ctx.fill();
            // Direction highlights
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '9px sans-serif';
            ctx.fillStyle = isUp ? '#888' : '#444'; ctx.fillText('▲', dpadCX, dpadCY - dp * 0.95);
            ctx.fillStyle = isDown ? '#888' : '#444'; ctx.fillText('▼', dpadCX, dpadCY + dp * 0.95);
            ctx.fillStyle = isLeft ? '#888' : '#444'; ctx.fillText('◀', dpadCX - dp * 0.95, dpadCY);
            ctx.fillStyle = isRight ? '#888' : '#444'; ctx.fillText('▶', dpadCX + dp * 0.95, dpadCY);

            // --- A/B buttons ---
            const aHit = flash && activeBtn === 'a', bHit = flash && activeBtn === 'b';
            // B button (lower-left of the pair)
            ctx.beginPath(); ctx.arc(btnBX, btnBY, btnRadius - 1, 0, Math.PI * 2);
            ctx.fillStyle = bHit ? '#7a3868' : '#502848'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = '#ddd'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('B', btnBX, btnBY);
            // B label
            ctx.fillStyle = '#555'; ctx.font = '6px sans-serif'; ctx.textBaseline = 'alphabetic';
            ctx.fillText('B', btnBX, btnBY + btnRadius + 8);

            // A button (upper-right)
            ctx.beginPath(); ctx.arc(btnAX, btnAY, btnRadius, 0, Math.PI * 2);
            ctx.fillStyle = aHit ? '#8b3070' : '#6b2058'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textBaseline = 'middle';
            ctx.fillText('A', btnAX, btnAY);
            // A label
            ctx.fillStyle = '#555'; ctx.font = '6px sans-serif'; ctx.textBaseline = 'alphabetic';
            ctx.fillText('A', btnAX, btnAY + btnRadius + 8);

            // --- Speaker grille ---
            const spkX = bodyW * 0.6, spkY = bodyH - 48;
            ctx.save();
            ctx.rotate(-0.35);
            for (let i = 0; i < 6; i++) {
                const sx = spkX + i * 7;
                rr(sx, spkY, 3, 28, 1.5);
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
            }
            ctx.restore();

            // --- Bottom label ---
            ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = 'italic 8px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText('BadNotes™', bodyW / 2, bodyH - 10);
        }

        // --- Main draw loop ---
        function draw() {
            ctx._clearFull();
            ctx._resetTransform();
            if (btnFlash > 0) btnFlash--;
            drawShell();
            if (menuMode) drawMenu();
            drawControls();
        }

        const stopPainting = createToyPainter(ctx, state, draw, () => btnFlash > 0);

        // Cleanup
        state._cleanup = () => {
            stopPainting();
            document.removeEventListener('keydown', keyHandler);
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        };
    }

    // --- TI-30X Plus MathPrint Calculator ---
    function initCalculator(ctx, w, h, state, canvas) {
        const bodyW = w, bodyH = h;
        const parentEl = canvas.closest('.toolbox-canvas-item');

        // Frame geometry (silver outer shell)
        const framePad = 4;
        const frameR = 14;

        // Screen geometry
        const screenX = framePad + 10, screenY = 56;
        const screenW = bodyW - 2 * framePad - 20, screenH = Math.round(bodyH * 0.18);
        const screenR = 3;

        // Button grid geometry
        const btnStartY = screenY + screenH + 16;
        const btnCols = 5;
        const btnRows = 9;
        const btnGapX = 3, btnGapY = 5;
        const btnAreaW = bodyW - 2 * framePad - 10;
        const btnAreaH = bodyH - btnStartY - framePad - 10;
        const btnW = (btnAreaW - (btnCols - 1) * btnGapX) / btnCols;
        const btnH = (btnAreaH - (btnRows - 1) * btnGapY) / btnRows;
        const btnStartX = framePad + 5;

        // D-pad indices (these 4 buttons form one visual block)
        const DPAD_INDICES = [3, 4, 8, 9];

        // ════════ Calculator Engine State ════════
        let expression = '';
        let displayExpr = '';
        let calcResult = '';
        let lastAns = 0;
        let angleMode = 'DEG'; // DEG, RAD, GRAD
        let is2nd = false;
        let parenCount = 0;
        let hasResult = false;
        let errorState = false;
        let lastResultIsFrac = false;
        let memVars = { x: 0, y: 0, z: 0, t: 0, a: 0, b: 0, c: 0, d: 0 };
        let menuActive = null; // null or { title, items, selected }
        let history = []; // Array of {expr, result, ans}
        let historyIdx = -1;
        let statData = []; // Data list for statistics
        let cursorPos = -1; // -1 means end of expression

        // ════════ Button Layout ════════
        // [label, 2ndLabel, colorType, action, action2nd]
        // colorType: 'blue','blk','wht','gry','dark','enter','dpad'
        const BTN_LAYOUT = [
            // Row 0
            ['2nd','','blue','toggle2nd',''],
            ['mode','quit','blk','mode','quit'],
            ['delete','insert','blk','del','insert'],
            ['◀','','dpad','left',''],
            ['▶','','dpad','right',''],
            // Row 1
            ['ln','log','blk','ln(','log('],
            ['math','','blk','mathMenu',''],
            ['data','stat-reg','blk','data','stat'],
            ['▲','expr','dpad','up','expr'],
            ['▼','%','dpad','down','percent'],
            // Row 2
            ['eˣ','10ˣ','blk','exp(','pow10('],
            ['EE','','blk','EE',''],
            ['nCr','nPr','blk','nCr','nPr'],
            ['table','expr-eval','blk','table','expr'],
            ['clear','%','blk','clear','percent'],
            // Row 3
            ['π','complex','blk','pi','euler'],
            ['sin','sin⁻¹','blk','sin(','asin('],
            ['cos','cos⁻¹','blk','cos(','acos('],
            ['tan','tan⁻¹','blk','tan(','atan('],
            ['÷','set op','gry','/',''],
            // Row 4
            ['xⁿ','ⁿ√','blk','^(','nroot'],
            ['x!','','blk','!',''],
            ['(','constants','blk','(','constants'],
            [')','op','blk',')',''],
            ['×','set op','gry','*',''],
            // Row 5
            ['x²','√','blk','^2','sqrt('],
            ['7','','wht','7',''],
            ['8','convert','wht','8',''],
            ['9','base n','wht','9',''],
            ['−','','gry','-',''],
            // Row 6
            ['x⁻¹','clear var','blk','^(-1)','clearvar'],
            ['4','D','wht','4',''],
            ['5','E','wht','5',''],
            ['6','F','wht','6',''],
            ['+','','gry','+',''],
            // Row 7
            ['STO→','recall','blk','sto','rcl'],
            ['1','A','wht','1',''],
            ['2','B','wht','2',''],
            ['3','C','wht','3',''],
            ['f⟷d','','gry','frac2dec',''],
            // Row 8
            ['ON','OFF','dark','on','off'],
            ['0','reset','wht','0','reset'],
            ['.','','wht','.',''],
            ['(−)','answer','wht','negate','ans'],
            ['enter','','enter','enter','']
        ];

        // Buttons that show dual labels on their face (like the real TI-30X Plus)
        // Maps button index to [topLine, bottomLine] for stacked text
        const DUAL_LABELS = {
            5:  ['ln', 'log'],
            10: ['eˣ', '10ˣ'],
            12: ['nCr', 'nPr'],
            16: ['sin', 'sin⁻¹'],
            17: ['cos', 'cos⁻¹'],
            18: ['tan', 'tan⁻¹'],
            20: ['xⁿ', 'ⁿ√'],
            25: ['x²', '√'],
        };

        // ════════ Color map ════════
        const COLORS = {
            blue:  { bg: '#2878b0', fg: '#fff', press: '#3ca0d8', edge: '#1d5e8a' },
            blk:   { bg: '#1c1c24', fg: '#e4e4e4', press: '#363640', edge: '#111118' },
            wht:   { bg: '#eaeaec', fg: '#1a1a1a', press: '#d2d2d6', edge: '#c0c0c4' },
            gry:   { bg: '#505060', fg: '#fff', press: '#686878', edge: '#3a3a4a' },
            dark:  { bg: '#26262e', fg: '#ccc', press: '#40404a', edge: '#18181e' },
            enter: { bg: '#1c1c28', fg: '#fff', press: '#38384a', edge: '#101018' },
            dpad:  { bg: '#38384a', fg: '#b8b8c0', press: '#505068', edge: '#28283a' }
        };

        // ════════ Hit Test ════════
        let pressedBtn = -1;

        function btnRect(idx) {
            const col = idx % btnCols;
            const row = Math.floor(idx / btnCols);
            const x = btnStartX + col * (btnW + btnGapX);
            const y = btnStartY + row * (btnH + btnGapY);
            return { x, y, w: btnW, h: btnH };
        }

        function hitTestBtn(lx, ly) {
            for (let i = 0; i < BTN_LAYOUT.length; i++) {
                const r = btnRect(i);
                if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return i;
            }
            return -1;
        }

        const pressTimers = new Set();
        // ════════ Pointer Events ════════
        canvas.addEventListener('pointerdown', (e) => {
            const pos = toyPointerPos(e, canvas, w, h);
            if (menuActive) {
                handleMenuClick(pos.x, pos.y);
                state._requestPaint?.();
                return;
            }
            const idx = hitTestBtn(pos.x, pos.y);
            if (idx < 0) return;
            pressedBtn = idx;
            const btn = BTN_LAYOUT[idx];
            const act = (is2nd && btn[4]) ? btn[4] : btn[3];
            if (act !== 'toggle2nd') is2nd = false;
            processAction(act);
            state._requestPaint?.();
            const timer = setTimeout(() => {
                pressTimers.delete(timer);
                pressedBtn = -1;
                state._requestPaint?.();
            }, 100);
            pressTimers.add(timer);
        });

        // ════════ Keyboard Events ════════
        const keyHandler = (e) => {
            const k = e.key;
            let handled = true;
            if (k >= '0' && k <= '9') processAction(k);
            else if (k === '.') processAction('.');
            else if (k === '+') processAction('+');
            else if (k === '-') processAction('-');
            else if (k === '*') processAction('*');
            else if (k === '/') processAction('/');
            else if (k === '(') processAction('(');
            else if (k === ')') processAction(')');
            else if (k === '^') processAction('^(');
            else if (k === '!') processAction('!');
            else if (k === '%') processAction('percent');
            else if (k === 'Enter') processAction('enter');
            else if (k === 'Backspace') processAction('del');
            else if (k === 'Delete') processAction('del');
            else if (k === 'Escape') processAction('clear');
            else if (k === 'ArrowLeft') processAction('left');
            else if (k === 'ArrowRight') processAction('right');
            else if (k === 'ArrowUp') processAction('up');
            else if (k === 'ArrowDown') processAction('down');
            else if (k === 'x' || k === 'X') processAction('x_var');
            else if (k === 'p' || k === 'P') processAction('pi');
            else if (k === 'e' || k === 'E') processAction('euler');
            else if (k === 's') processAction('sin(');
            else if (k === 'c') processAction('cos(');
            else if (k === 't') processAction('tan(');
            else if (k === 'l') processAction('ln(');
            else if (k === 'r') processAction('sqrt(');
            else handled = false;
            if (handled) { e.preventDefault(); e.stopPropagation(); state._requestPaint?.(); }
        };
        document.addEventListener('keydown', keyHandler);

        // ════════ Math Functions ════════
        function factorial(n) {
            if (n < 0 || !isFinite(n)) return NaN;
            if (n === 0 || n === 1) return 1;
            if (n > 170) return Infinity;
            if (!Number.isInteger(n)) return gammaFn(n + 1);
            let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
        }
        function gammaFn(z) {
            if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
            z -= 1;
            const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
                       771.32342877765313,-176.61502916214059,12.507343278686905,
                       -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
            let x = c[0]; for (let i = 1; i < 9; i++) x += c[i] / (z + i);
            const t = z + 7.5;
            return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
        }
        function nCrFn(n, r) {
            if (r > n || r < 0) return 0;
            return factorial(n) / (factorial(r) * factorial(n - r));
        }
        function nPrFn(n, r) {
            if (r > n || r < 0) return 0;
            return factorial(n) / factorial(n - r);
        }
        function gcd(a, b) { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) { [a, b] = [b, a % b]; } return a; }
        function lcm(a, b) { return Math.abs(Math.round(a) * Math.round(b)) / gcd(a, b); }
        function toRad(v) { return angleMode === 'RAD' ? v : angleMode === 'GRAD' ? v * Math.PI / 200 : v * Math.PI / 180; }
        function fromRad(v) { return angleMode === 'RAD' ? v : angleMode === 'GRAD' ? v * 200 / Math.PI : v * 180 / Math.PI; }

        // ════════ Statistics Functions ════════
        function statSum() { return statData.reduce((a, b) => a + b, 0); }
        function statMean() { return statData.length ? statSum() / statData.length : 0; }
        function statSumSq() { return statData.reduce((a, b) => a + b * b, 0); }
        function statStdDev(sample) {
            const n = statData.length;
            if (n < (sample ? 2 : 1)) return 0;
            const mean = statMean();
            const variance = statData.reduce((s, v) => s + (v - mean) ** 2, 0) / (sample ? n - 1 : n);
            return Math.sqrt(variance);
        }
        function statMedian() {
            if (!statData.length) return 0;
            const sorted = [...statData].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        // ════════ Physical Constants (SI) ════════
        const PHYS_CONSTANTS = [
            { label: 'c (speed of light)', val: 299792458 },
            { label: 'g (gravity)', val: 9.80665 },
            { label: 'G (gravitational)', val: 6.67430e-11 },
            { label: 'h (Planck)', val: 6.62607e-34 },
            { label: 'Nₐ (Avogadro)', val: 6.02214e23 },
            { label: 'R (gas const)', val: 8.31446 },
            { label: 'k (Boltzmann)', val: 1.38065e-23 },
            { label: 'e (elem charge)', val: 1.60218e-19 },
            { label: 'mₑ (electron)', val: 9.10938e-31 },
            { label: 'mₚ (proton)', val: 1.67262e-27 },
        ];

        function formatNum(n) {
            if (typeof n !== 'number' || isNaN(n)) return 'Error';
            if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
            if (Math.abs(n) >= 1e10 || (Math.abs(n) < 1e-6 && n !== 0)) {
                return n.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'ᴇ').replace('e-', 'ᴇ-');
            }
            return String(parseFloat(n.toPrecision(10)));
        }

        function decToFrac(dec) {
            if (!isFinite(dec) || Number.isInteger(dec)) return null;
            const sign = dec < 0 ? '-' : ''; dec = Math.abs(dec);
            let lN = 0, lD = 1, rN = 1, rD = 0, x = dec, num, den;
            for (let i = 0; i < 100; i++) {
                const a = Math.floor(x); num = a * rN + lN; den = a * rD + lD;
                if (Math.abs(dec - num / den) < 1e-10) break;
                lN = rN; lD = rD; rN = num; rD = den;
                if (x - a < 1e-10) break; x = 1 / (x - a);
            }
            if (den === 1 || den > 9999) return null;
            return sign + num + '/' + den;
        }

        // ════════ Safe Expression Evaluator ════════
        function safeEval(expr) {
            // Tokenize and evaluate using a safe math-only parser
            // We use Function constructor with only Math in scope
            try {
                const fn = new Function('Math', 'return (' + expr + ')');
                return fn(Math);
            } catch (e) {
                return NaN;
            }
        }

        // ════════ Process Action ════════
        function processAction(act) {
            if (errorState && act !== 'clear' && act !== 'on') return;

            switch (act) {
                case 'toggle2nd': is2nd = !is2nd; break;

                case 'mode':
                    angleMode = angleMode === 'DEG' ? 'RAD' : angleMode === 'RAD' ? 'GRAD' : 'DEG';
                    break;
                case 'quit':
                    menuActive = null;
                    expression = ''; calcResult = ''; hasResult = false; parenCount = 0;
                    break;

                // Numbers
                case '0': case '1': case '2': case '3': case '4':
                case '5': case '6': case '7': case '8': case '9':
                    if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                    expression += act; break;
                case '.':
                    if (hasResult) { expression = '0'; hasResult = false; calcResult = ''; }
                    expression += '.'; break;

                // Operators
                case '+': case '-': case '*': case '/':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += act; break;

                // Parens
                case '(':
                    if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                    expression += '('; parenCount++; break;
                case ')':
                    if (parenCount > 0) { expression += ')'; parenCount--; } break;

                // Trig
                case 'sin(':  insertFunc('Math.sin('); break;
                case 'cos(':  insertFunc('Math.cos('); break;
                case 'tan(':  insertFunc('Math.tan('); break;
                case 'asin(': insertFunc('Math.asin('); break;
                case 'acos(': insertFunc('Math.acos('); break;
                case 'atan(': insertFunc('Math.atan('); break;

                // Log
                case 'ln(':   insertFunc('Math.log('); break;
                case 'log(':  insertFunc('Math.log10('); break;
                case 'sqrt(': insertFunc('Math.sqrt('); break;
                case 'abs(':  insertFunc('Math.abs('); break;
                case 'exp(':  insertFunc('Math.exp('); break;
                case 'pow10(': insertFunc('Math.pow(10,'); break;

                // Powers
                case '^(':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '**('; parenCount++; break;
                case '^2':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '**2'; break;
                case '^(-1)':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '**(-1)'; break;

                // Constants
                case 'pi':
                    if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                    expression += 'Math.PI'; break;
                case 'euler':
                    if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                    expression += 'Math.E'; break;

                // Factorial
                case '!':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '__FACT__'; break;

                // Negate
                case 'negate':
                    if (hasResult) { expression = '(-' + lastAns + ')'; hasResult = false; calcResult = ''; }
                    else { expression += '(-'; parenCount++; }
                    break;

                // Answer
                case 'ans':
                    if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                    expression += String(lastAns); break;

                // EE (scientific notation input)
                case 'EE':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += 'e'; break;

                // Percent
                case 'percent':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '/100'; break;

                // nCr / nPr
                case 'nCr':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '__NCR__'; break;
                case 'nPr':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '__NPR__'; break;

                // Clear / Delete
                case 'clear':
                    if (expression === '' && calcResult === '') { lastAns = 0; errorState = false; }
                    expression = ''; calcResult = ''; hasResult = false; parenCount = 0; errorState = false;
                    menuActive = null; break;
                case 'del':
                    if (hasResult) return;
                    expression = delLastToken(expression);
                    break;

                // Fraction/Decimal toggle
                case 'frac2dec':
                    if (!hasResult) break;
                    if (lastResultIsFrac) { calcResult = formatNum(lastAns); lastResultIsFrac = false; }
                    else { const f = decToFrac(lastAns); if (f) { calcResult = f; lastResultIsFrac = true; } }
                    break;

                // Memory
                case 'sto':
                    showCalcMenu('STO→', Object.keys(memVars).map(k => ({
                        label: k + ' = ' + memVars[k],
                        act: () => { memVars[k] = hasResult ? lastAns : 0; calcResult = k + '=' + formatNum(memVars[k]); }
                    })));
                    return;
                case 'rcl':
                    showCalcMenu('RCL', Object.keys(memVars).map(k => ({
                        label: k + ' = ' + memVars[k],
                        act: () => { if (hasResult) { expression = ''; hasResult = false; calcResult = ''; } expression += String(memVars[k]); }
                    })));
                    return;

                // Math menu
                case 'mathMenu':
                    showCalcMenu('MATH', [
                        { label: 'GCD(a,b)', act: () => { insertFunc('__GCD__('); } },
                        { label: 'LCM(a,b)', act: () => { insertFunc('__LCM__('); } },
                        { label: 'abs(', act: () => { insertFunc('Math.abs('); } },
                        { label: 'iPart(', act: () => { insertFunc('Math.trunc('); } },
                        { label: 'min(', act: () => { insertFunc('Math.min('); } },
                        { label: 'max(', act: () => { insertFunc('Math.max('); } },
                        { label: '→Frac', act: () => { processAction('frac2dec'); } }
                    ]);
                    return;

                // Enter
                case 'enter':
                    evaluateExpr(); return;

                // On/Off
                case 'on':
                    expression = ''; calcResult = ''; hasResult = false; parenCount = 0; errorState = false;
                    break;
                case 'off':
                    expression = ''; calcResult = ''; hasResult = false;
                    break;

                // ════════ D-PAD Navigation ════════
                case 'left':
                    if (hasResult) return;
                    expression = delLastToken(expression);
                    break;
                case 'right':
                    // Re-add last answer to continue expression
                    if (hasResult) { expression = String(lastAns); hasResult = false; calcResult = ''; }
                    break;
                case 'up':
                    // Navigate to previous expression in history
                    if (history.length === 0) break;
                    if (historyIdx < 0) historyIdx = history.length;
                    historyIdx--;
                    if (historyIdx >= 0) {
                        expression = history[historyIdx].expr;
                        calcResult = history[historyIdx].result;
                        lastAns = history[historyIdx].ans;
                        hasResult = true; lastResultIsFrac = false;
                    }
                    break;
                case 'down':
                    // Navigate to next expression in history
                    if (historyIdx < 0) break;
                    historyIdx++;
                    if (historyIdx < history.length) {
                        expression = history[historyIdx].expr;
                        calcResult = history[historyIdx].result;
                        lastAns = history[historyIdx].ans;
                        hasResult = true; lastResultIsFrac = false;
                    } else {
                        historyIdx = -1;
                        expression = ''; calcResult = ''; hasResult = false;
                    }
                    break;

                // ════════ nth Root ════════
                case 'nroot':
                    if (hasResult) { expression = String(lastAns); hasResult = false; }
                    expression += '**(1/'; parenCount++;
                    break;

                // ════════ Insert Mode ════════
                case 'insert':
                    // Toggle (visual indicator only, our string model always inserts at end)
                    calcResult = 'INS'; break;

                // ════════ Constants Menu ════════
                case 'constants':
                    showCalcMenu('CONSTANTS', PHYS_CONSTANTS.map(c => ({
                        label: c.label + ' = ' + formatNum(c.val),
                        act: () => {
                            if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                            expression += String(c.val);
                        }
                    })));
                    return;

                // ════════ Data Entry for Statistics ════════
                case 'data':
                    showCalcMenu('DATA', [
                        { label: 'Add current ans → data', act: () => {
                            if (hasResult && typeof lastAns === 'number' && isFinite(lastAns)) {
                                statData.push(lastAns);
                                calcResult = 'data[' + statData.length + ']=' + formatNum(lastAns);
                            } else { calcResult = 'Eval first'; }
                        }},
                        { label: 'View data (' + statData.length + ' pts)', act: () => {
                            if (statData.length === 0) { calcResult = 'No data'; return; }
                            const items = statData.map((v, i) => ({
                                label: (i + 1) + ': ' + formatNum(v),
                                act: () => { expression = String(v); calcResult = formatNum(v); lastAns = v; hasResult = true; }
                            }));
                            if (items.length > 12) items.length = 12; // limit display
                            showCalcMenu('DATA LIST', items);
                        }},
                        { label: 'Clear all data', act: () => { statData = []; calcResult = 'Cleared'; } },
                    ]);
                    return;

                // ════════ Statistics Results ════════
                case 'stat':
                    if (statData.length === 0) { calcResult = 'No data'; break; }
                    showCalcMenu('STAT', [
                        { label: 'n = ' + statData.length, act: () => { lastAns = statData.length; calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: 'x\u0304 = ' + formatNum(statMean()), act: () => { lastAns = statMean(); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: '\u03a3x = ' + formatNum(statSum()), act: () => { lastAns = statSum(); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: '\u03a3x\u00b2 = ' + formatNum(statSumSq()), act: () => { lastAns = statSumSq(); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: '\u03c3x = ' + formatNum(statStdDev(false)), act: () => { lastAns = statStdDev(false); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: 'sx = ' + formatNum(statStdDev(true)), act: () => { lastAns = statStdDev(true); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: 'med = ' + formatNum(statMedian()), act: () => { lastAns = statMedian(); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: 'min = ' + formatNum(Math.min(...statData)), act: () => { lastAns = Math.min(...statData); calcResult = formatNum(lastAns); hasResult = true; } },
                        { label: 'max = ' + formatNum(Math.max(...statData)), act: () => { lastAns = Math.max(...statData); calcResult = formatNum(lastAns); hasResult = true; } },
                    ]);
                    return;

                // ════════ Table Function ════════
                case 'table':
                    if (!expression && !hasResult) { calcResult = 'Enter f(x)'; break; }
                    {
                        // Use current expression as f(x), substitute x values
                        const tableExpr = hasResult ? String(lastAns) : expression;
                        const hasX = tableExpr.includes('__X__');
                        if (!hasX) {
                            // No variable x — just evaluate as-is
                            calcResult = 'No x in expr';
                            break;
                        }
                        const items = [];
                        for (let xv = -5; xv <= 5; xv++) {
                            try {
                                let e = tableExpr.replace(/__X__/g, '(' + xv + ')');
                                // Close unclosed parens
                                let pc2 = (e.match(/\(/g) || []).length - (e.match(/\)/g) || []).length;
                                while (pc2 > 0) { e += ')'; pc2--; }
                                const val = safeEval(e);
                                items.push({
                                    label: 'x=' + xv + '  y=' + formatNum(val),
                                    act: () => { lastAns = val; calcResult = formatNum(val); hasResult = true; }
                                });
                            } catch (_) {}
                        }
                        if (items.length) showCalcMenu('TABLE', items);
                        else calcResult = 'Error';
                    }
                    return;
                case 'expr':
                    // Expression evaluation — re-evaluate current expression
                    if (expression) evaluateExpr();
                    break;

                // ════════ Clear Variables ════════
                case 'clearvar':
                    Object.keys(memVars).forEach(k => memVars[k] = 0);
                    calcResult = 'Vars cleared';
                    break;

                // ════════ Reset ════════
                case 'reset':
                    expression = ''; calcResult = ''; lastAns = 0; angleMode = 'DEG';
                    is2nd = false; parenCount = 0; hasResult = false; errorState = false;
                    lastResultIsFrac = false; history = []; historyIdx = -1; statData = [];
                    Object.keys(memVars).forEach(k => memVars[k] = 0);
                    menuActive = null;
                    break;

                // ════════ Abs (from math menu) ════════
                case 'abs(':
                    insertFunc('Math.abs('); break;

                // ════════ Variable x for table ════════
                case 'x_var':
                    if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
                    expression += '__X__'; break;

                default: break;
            }
        }

        function insertFunc(fn) {
            if (hasResult) { expression = ''; hasResult = false; calcResult = ''; }
            expression += fn; parenCount++;
        }

        function delLastToken(expr) {
            const tokens = ['Math.sin(','Math.cos(','Math.tan(','Math.asin(','Math.acos(','Math.atan(',
                'Math.log10(','Math.log(','Math.sqrt(','Math.exp(','Math.pow(10,','Math.abs(','Math.trunc(','Math.min(','Math.max(',
                'Math.PI','Math.E','__FACT__','__NCR__','__NPR__','__GCD__(','__LCM__(','__X__',
                '**(-1)','**2','**(1/','**(','(-','/100'];
            for (const t of tokens) {
                if (expr.endsWith(t)) {
                    if (t.endsWith('(')) parenCount = Math.max(0, parenCount - 1);
                    return expr.slice(0, -t.length);
                }
            }
            const last = expr.slice(-1);
            if (last === '(') parenCount = Math.max(0, parenCount - 1);
            if (last === ')') parenCount++;
            return expr.slice(0, -1);
        }

        // ════════ Evaluate ════════
        function evaluateExpr() {
            if (!expression.trim()) return;
            let expr = expression;
            // Close unclosed parens
            let pc = parenCount;
            while (pc > 0) { expr += ')'; pc--; }

            try {
                // Replace __X__ with variable value (for table mode, default to 0)
                expr = expr.replace(/__X__/g, '(0)');

                // Process factorials: number__FACT__ or )__FACT__
                expr = expr.replace(/([\d.)]+)__FACT__/g, (m, n) => {
                    const v = safeEval(n);
                    return '(' + factorial(v) + ')';
                });
                // nCr/nPr: a__NCR__b / a__NPR__b (support expressions with parens too)
                expr = expr.replace(/([\d.)+eE-]+)__NCR__([\d.(eE-]+)/g, (_, a, b) => {
                    const va = safeEval(a), vb = safeEval(b);
                    return '(' + nCrFn(va, vb) + ')';
                });
                expr = expr.replace(/([\d.)+eE-]+)__NPR__([\d.(eE-]+)/g, (_, a, b) => {
                    const va = safeEval(a), vb = safeEval(b);
                    return '(' + nPrFn(va, vb) + ')';
                });
                // GCD/LCM (support decimal args)
                expr = expr.replace(/__GCD__\(([\d.]+),([\d.]+)\)/g, (_, a, b) => '(' + gcd(+a, +b) + ')');
                expr = expr.replace(/__LCM__\(([\d.]+),([\d.]+)\)/g, (_, a, b) => '(' + lcm(+a, +b) + ')');

                // Angle conversion for trig
                if (angleMode !== 'RAD') {
                    const f = angleMode === 'GRAD' ? Math.PI / 200 : Math.PI / 180;
                    const fi = angleMode === 'GRAD' ? 200 / Math.PI : 180 / Math.PI;
                    expr = expr.replace(/Math\.asin\(/g, '(' + fi + '*Math.asin(');
                    expr = expr.replace(/Math\.acos\(/g, '(' + fi + '*Math.acos(');
                    expr = expr.replace(/Math\.atan\(/g, '(' + fi + '*Math.atan(');
                    expr = expr.replace(/Math\.sin\(/g, 'Math.sin(' + f + '*(');
                    expr = expr.replace(/Math\.cos\(/g, 'Math.cos(' + f + '*(');
                    expr = expr.replace(/Math\.tan\(/g, 'Math.tan(' + f + '*(');
                }

                // Remove any leftover tokens
                expr = expr.replace(/__[A-Z_]+__/g, '');

                const val = safeEval(expr);
                if (typeof val !== 'number' || isNaN(val)) throw new Error('NaN');
                lastAns = val;
                calcResult = formatNum(val);
                hasResult = true;
                lastResultIsFrac = false;
                parenCount = 0;
                historyIdx = -1;
                // Save to history (keep last 30)
                history.push({ expr: expression, result: calcResult, ans: val });
                if (history.length > 30) history.shift();
            } catch (e) {
                calcResult = 'Syntax Error';
                errorState = true;
            }
        }

        // ════════ Menu System ════════
        function showCalcMenu(title, items) {
            menuActive = { title, items, selected: 0 };
        }
        function handleMenuClick(lx, ly) {
            if (!menuActive) return;
            const m = menuActive;
            const availH = bodyH - screenY - screenH - 36;
            const itemH = Math.min(17, Math.max(11, availH / m.items.length));
            const startY = screenY + screenH + 20;
            const idx = Math.floor((ly - startY) / itemH);
            if (idx >= 0 && idx < m.items.length) {
                menuActive = null;
                m.items[idx].act();
            } else {
                menuActive = null;
            }
        }

        // ════════ Pretty Display ════════
        function prettyExpr(expr) {
            return expr
                .replace(/Math\.PI/g, 'π').replace(/Math\.E(?!x)/g, 'e')
                .replace(/Math\.sqrt\(/g, '√(').replace(/Math\.abs\(/g, 'abs(')
                .replace(/Math\.sin\(/g, 'sin(').replace(/Math\.cos\(/g, 'cos(').replace(/Math\.tan\(/g, 'tan(')
                .replace(/Math\.asin\(/g, 'sin⁻¹(').replace(/Math\.acos\(/g, 'cos⁻¹(').replace(/Math\.atan\(/g, 'tan⁻¹(')
                .replace(/Math\.log10\(/g, 'log(').replace(/Math\.log\(/g, 'ln(')
                .replace(/Math\.exp\(/g, 'eˣ(').replace(/Math\.pow\(10,/g, '10^(')
                .replace(/Math\.trunc\(/g, 'iPart(').replace(/Math\.min\(/g, 'min(').replace(/Math\.max\(/g, 'max(')
                .replace(/__FACT__/g, '!').replace(/__NCR__/g, ' nCr ').replace(/__NPR__/g, ' nPr ')
                .replace(/__GCD__\(/g, 'GCD(').replace(/__LCM__\(/g, 'LCM(')
                .replace(/__X__/g, 'x')
                // Process ** patterns BEFORE replacing * with ×
                .replace(/\*\*\(1\//g, 'ⁿ√(')
                .replace(/\*\*2/g, '²').replace(/\*\*\(-1\)/g, '⁻¹').replace(/\*\*\(/g, '^(')
                // Now safe to replace remaining * and /
                .replace(/\*/g, '×').replace(/\/100/g, '%').replace(/\//g, '÷')
                .replace(/\(-/g, '(−');
        }

        // ════════ Drawing ════════
        function rr(x, y, rw, rh, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.lineTo(x + rw - r, y);
            ctx.quadraticCurveTo(x + rw, y, x + rw, y + r);
            ctx.lineTo(x + rw, y + rh - r);
            ctx.quadraticCurveTo(x + rw, y + rh, x + rw - r, y + rh);
            ctx.lineTo(x + r, y + rh);
            ctx.quadraticCurveTo(x, y + rh, x, y + rh - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        function drawBody() {
            // ─── Outer silver/grey frame (the plastic shell) ───
            rr(0, 0, bodyW, bodyH, frameR);
            const frameGrad = ctx.createLinearGradient(0, 0, 0, bodyH);
            frameGrad.addColorStop(0, '#c8c8cc');
            frameGrad.addColorStop(0.02, '#b8b8bc');
            frameGrad.addColorStop(0.15, '#a0a0a6');
            frameGrad.addColorStop(0.5, '#909096');
            frameGrad.addColorStop(0.85, '#a0a0a6');
            frameGrad.addColorStop(1, '#888890');
            ctx.fillStyle = frameGrad; ctx.fill();
            // Frame outer edge
            rr(0, 0, bodyW, bodyH, frameR);
            ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
            // Frame inner highlight
            rr(1, 1, bodyW - 2, bodyH - 2, frameR - 1);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5; ctx.stroke();

            // ─── Inner dark body ───
            const ix = framePad, iy = framePad;
            const iw = bodyW - 2 * framePad, ih = bodyH - 2 * framePad;
            rr(ix, iy, iw, ih, 10);
            const innerGrad = ctx.createLinearGradient(0, iy, 0, iy + ih);
            innerGrad.addColorStop(0, '#333338');
            innerGrad.addColorStop(0.08, '#2c2c32');
            innerGrad.addColorStop(0.5, '#252530');
            innerGrad.addColorStop(0.92, '#20202a');
            innerGrad.addColorStop(1, '#1c1c26');
            ctx.fillStyle = innerGrad; ctx.fill();
            // Inner body edge
            rr(ix, iy, iw, ih, 10);
            ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();

            // ─── Title ───
            ctx.textAlign = 'center';
            // "TI-30X Plus" in bold white
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText('TI-30X Plus', bodyW / 2, iy + 14);
            // "MathPrint" subtitle
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '8px Arial, sans-serif';
            ctx.fillText('MathPrint', bodyW / 2, iy + 26);

            // ─── Solar Cell (dark brown/blue strip) ───
            const sw = bodyW * 0.32, sh = 8;
            const sx = (bodyW - sw) / 2, sy = iy + 34;
            rr(sx, sy, sw, sh, 2);
            const solGrad = ctx.createLinearGradient(sx, sy, sx, sy + sh);
            solGrad.addColorStop(0, '#3a2820');
            solGrad.addColorStop(0.3, '#2e1e18');
            solGrad.addColorStop(0.7, '#2e1e18');
            solGrad.addColorStop(1, '#3a2820');
            ctx.fillStyle = solGrad; ctx.fill();
            ctx.strokeStyle = 'rgba(80,60,40,0.3)'; ctx.lineWidth = 0.4; ctx.stroke();
            // Solar cell grid lines
            ctx.strokeStyle = 'rgba(100,70,50,0.15)'; ctx.lineWidth = 0.3;
            for (let gx = sx + 5; gx < sx + sw - 2; gx += 5) {
                ctx.beginPath(); ctx.moveTo(gx, sy + 1); ctx.lineTo(gx, sy + sh - 1); ctx.stroke();
            }
        }

        function drawScreen() {
            // Recessed shadow
            rr(screenX - 4, screenY - 4, screenW + 8, screenH + 8, screenR + 4);
            ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();

            // Bezel (dark grey surround)
            rr(screenX - 2, screenY - 2, screenW + 4, screenH + 4, screenR + 2);
            ctx.fillStyle = '#464648'; ctx.fill();

            // LCD background — realistic greenish-grey
            rr(screenX, screenY, screenW, screenH, screenR);
            const lcdGrad = ctx.createLinearGradient(0, screenY, 0, screenY + screenH);
            lcdGrad.addColorStop(0, '#b8bca0');
            lcdGrad.addColorStop(0.1, '#c4c8aa');
            lcdGrad.addColorStop(0.5, '#c8ccae');
            lcdGrad.addColorStop(0.9, '#c2c6a6');
            lcdGrad.addColorStop(1, '#b4b89a');
            ctx.fillStyle = lcdGrad; ctx.fill();

            // Clip to screen
            ctx.save();
            rr(screenX, screenY, screenW, screenH, screenR); ctx.clip();

            // Very subtle scanlines
            ctx.strokeStyle = 'rgba(0,0,0,0.018)'; ctx.lineWidth = 0.5;
            for (let sl = screenY; sl < screenY + screenH; sl += 2) {
                ctx.beginPath(); ctx.moveTo(screenX, sl); ctx.lineTo(screenX + screenW, sl); ctx.stroke();
            }

            // Mode indicator at top center-right
            ctx.fillStyle = '#556644'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(angleMode, screenX + screenW / 2, screenY + 3);
            if (is2nd) {
                ctx.fillStyle = '#2575a8'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'left';
                ctx.fillText('2nd', screenX + 4, screenY + 3);
            }

            // Expression — top left, like real LCD
            const pretty = prettyExpr(expression);
            ctx.fillStyle = '#222'; ctx.font = '10px "Courier New", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            const exprW = ctx.measureText(pretty).width;
            const maxExprW = screenW - 12;
            const exprDrawX = exprW > maxExprW ? screenX + 6 + maxExprW - exprW : screenX + 6;
            ctx.fillText(pretty + (hasResult ? '' : '\u258c'), exprDrawX, screenY + 16);

            // Result — bottom right, large bold like real display
            if (calcResult) {
                ctx.fillStyle = '#111';
                ctx.font = 'bold 18px "Courier New", monospace';
                ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
                ctx.fillText(calcResult, screenX + screenW - 6, screenY + screenH - 5);
            }
            ctx.restore();
        }

        function drawButtons() {
            // ─── Draw D-pad as a single unified block first ───
            const dp0 = btnRect(3), dp1 = btnRect(4), dp2 = btnRect(8), dp3 = btnRect(9);
            const dpadX = dp0.x - 1, dpadY = dp0.y - 1;
            const dpadW = dp1.x + dp1.w - dp0.x + 2;
            const dpadH = dp2.y + dp2.h - dp0.y + 2;
            const dpadR = 4;

            // D-pad shadow
            rr(dpadX + 0.5, dpadY + 1.5, dpadW, dpadH, dpadR);
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
            // D-pad body
            rr(dpadX, dpadY, dpadW, dpadH, dpadR);
            const dpGrad = ctx.createLinearGradient(0, dpadY, 0, dpadY + dpadH);
            dpGrad.addColorStop(0, '#444450');
            dpGrad.addColorStop(0.5, '#3a3a48');
            dpGrad.addColorStop(1, '#333342');
            ctx.fillStyle = dpGrad; ctx.fill();
            rr(dpadX, dpadY, dpadW, dpadH, dpadR);
            ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5; ctx.stroke();

            // Highlight pressed d-pad zone (cross pattern: up=top, left=left, right=right, down=bottom)
            const dpFullW = dp1.x + dp1.w - dp0.x;
            const dpFullH = dp2.y + dp2.h - dp0.y;
            const dpHalfW = dpFullW / 2;
            const dpHalfH = dpFullH / 2;
            if (pressedBtn === 8) { rr(dp0.x + dpHalfW * 0.3, dp0.y, dpHalfW * 1.4, dpHalfH, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); }
            if (pressedBtn === 3) { rr(dp0.x, dp0.y + dpHalfH * 0.3, dpHalfW, dpHalfH * 1.4, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); }
            if (pressedBtn === 4) { rr(dp0.x + dpHalfW, dp0.y + dpHalfH * 0.3, dpHalfW, dpHalfH * 1.4, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); }
            if (pressedBtn === 9) { rr(dp0.x + dpHalfW * 0.3, dp0.y + dpHalfH, dpHalfW * 1.4, dpHalfH, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); }

            // ─── Draw regular buttons ───
            for (let i = 0; i < BTN_LAYOUT.length; i++) {
                if (DPAD_INDICES.includes(i)) continue; // Skip d-pad buttons

                const [label, lbl2, colorType] = BTN_LAYOUT[i];
                const r = btnRect(i);
                const c = COLORS[colorType];
                const isPressed = (i === pressedBtn);
                const rad = 3;

                if (isPressed) {
                    rr(r.x + 0.5, r.y + 0.5, r.w - 1, r.h, rad);
                    ctx.fillStyle = c.press; ctx.fill();
                } else {
                    // Shadow
                    rr(r.x + 0.5, r.y + 1.5, r.w, r.h, rad);
                    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();

                    // Button body
                    rr(r.x, r.y, r.w, r.h, rad);
                    ctx.fillStyle = c.bg; ctx.fill();

                    // Gradient highlight
                    ctx.save();
                    rr(r.x, r.y, r.w, r.h, rad); ctx.clip();
                    const hlGrad = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
                    hlGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
                    hlGrad.addColorStop(0.4, 'rgba(255,255,255,0.02)');
                    hlGrad.addColorStop(1, 'rgba(0,0,0,0.08)');
                    ctx.fillStyle = hlGrad;
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                    ctx.restore();

                    // Border
                    rr(r.x, r.y, r.w, r.h, rad);
                    ctx.strokeStyle = colorType === 'wht' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.04)';
                    ctx.lineWidth = 0.4; ctx.stroke();
                }

                // Button label
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

                // Check for dual-label buttons (show both functions on face)
                if (DUAL_LABELS[i]) {
                    const [top, bot] = DUAL_LABELS[i];
                    ctx.font = '6.5px Arial';
                    ctx.fillStyle = '#e8e8e8';
                    ctx.fillText(top, r.x + r.w / 2, r.y + r.h * 0.35);
                    ctx.fillStyle = '#a0a0aa';
                    ctx.font = '5.5px Arial';
                    ctx.fillText(bot, r.x + r.w / 2, r.y + r.h * 0.7);
                } else {
                    // Regular single label
                    if (colorType === 'wht') {
                        ctx.font = 'bold 11px Arial';
                        ctx.fillStyle = '#1a1a1a';
                    } else if (colorType === 'gry') {
                        ctx.font = 'bold 10px Arial';
                        ctx.fillStyle = c.fg;
                    } else if (colorType === 'enter') {
                        ctx.font = 'bold 9px Arial';
                        ctx.fillStyle = '#fff';
                    } else if (colorType === 'blue') {
                        ctx.font = 'bold 9px Arial';
                        ctx.fillStyle = '#fff';
                    } else {
                        ctx.font = '7.5px Arial';
                        ctx.fillStyle = '#e0e0e0';
                    }
                    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
                }

                // 2nd function label above button (cyan)
                if (lbl2) {
                    ctx.fillStyle = is2nd ? '#60e8ff' : '#4ab0c0';
                    ctx.font = is2nd ? 'bold 5px Arial' : '4.5px Arial';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(lbl2, r.x + r.w / 2, r.y - 1.5);
                }
            }

            // Redraw d-pad arrows in cross pattern: ▲ top, ◀ left, ▶ right, ▼ bottom
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const dpCenterX = (dp0.x + dp1.x + dp1.w) / 2;
            const dpCenterY = (dp0.y + dp2.y + dp2.h) / 2;
            ctx.font = '11px Arial';
            // ▲ up — top center
            ctx.fillStyle = pressedBtn === 8 ? '#eee' : '#8a8a94';
            ctx.fillText('\u25B2', dpCenterX, dp0.y + dp0.h * 0.4);
            // ◀ left — middle left
            ctx.fillStyle = pressedBtn === 3 ? '#eee' : '#8a8a94';
            ctx.fillText('\u25C0', dp0.x + dp0.w * 0.4, dpCenterY);
            // ▶ right — middle right
            ctx.fillStyle = pressedBtn === 4 ? '#eee' : '#8a8a94';
            ctx.fillText('\u25B6', dp1.x + dp1.w * 0.6, dpCenterY);
            // ▼ down — bottom center
            ctx.fillStyle = pressedBtn === 9 ? '#eee' : '#8a8a94';
            ctx.fillText('\u25BC', dpCenterX, dp2.y + dp2.h * 0.6);

            // Glow on 2nd button when active
            if (is2nd) {
                const r2 = btnRect(0);
                ctx.save();
                ctx.shadowColor = '#2888d0';
                ctx.shadowBlur = 8;
                rr(r2.x, r2.y, r2.w, r2.h, 3);
                ctx.strokeStyle = 'rgba(40,136,208,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.restore();
            }
        }

        function drawMenu() {
            if (!menuActive) return;
            const m = menuActive;
            // Frosted dark overlay with rounded corners
            rr(6, screenY + screenH + 2, bodyW - 12, bodyH - screenY - screenH - 16, 6);
            ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fill();
            rr(6, screenY + screenH + 2, bodyW - 12, bodyH - screenY - screenH - 16, 6);
            ctx.strokeStyle = 'rgba(100,160,220,0.15)'; ctx.lineWidth = 0.5; ctx.stroke();
            // Title
            ctx.fillStyle = '#5bc0de'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText('\u2500\u2500 ' + m.title + ' \u2500\u2500', bodyW / 2, screenY + screenH + 7);
            // Items — auto-size to fit
            const availH = bodyH - screenY - screenH - 36;
            const itemH = Math.min(17, Math.max(11, availH / m.items.length));
            const fontSize = itemH >= 14 ? 7.5 : 6;
            const startY = screenY + screenH + 20;
            m.items.forEach((item, i) => {
                const iy = startY + i * itemH;
                if (iy + itemH > bodyH - 12) return; // don't draw below bottom
                rr(10, iy - 1, bodyW - 20, itemH - 2, 3);
                ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
                ctx.fillStyle = '#e0e0e0'; ctx.font = fontSize + 'px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                ctx.fillText((i + 1) + ': ' + item.label, 14, iy + 1);
            });
            // Close hint
            ctx.fillStyle = '#556'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
            ctx.fillText('tap to select \u00b7 clear to close', bodyW / 2, bodyH - 8);
        }

        function drawFooter() {
            // TI logo area — small logo mark + text
            const footY = bodyH - framePad - 6;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            // Small TI shield icon approximation
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.font = 'bold 6px Arial';
            // Just show the text centered in the frame
            ctx.fillText('\u2756  TEXAS INSTRUMENTS', bodyW / 2, footY);
        }

        // ════════ Draw Loop ════════
        function draw() {
            ctx._clearFull();
            ctx._resetTransform();
            drawBody();
            drawScreen();
            drawButtons();
            drawMenu();
            drawFooter();
        }

        const stopPainting = createToyPainter(ctx, state, draw);

        // Cleanup
        state._cleanup = () => {
            stopPainting();
            for (const timer of pressTimers) clearTimeout(timer);
            pressTimers.clear();
            document.removeEventListener('keydown', keyHandler);
        };
    }

    // --- Gravity Scene (fullscreen) --- extracted to 33_gravity_scene.js
    function initGravityScene(ctx, w, h, state, canvas, toolData) {
        window.initGravityScene(ctx, w, h, state, canvas, toolData);
    }

    return { init, toggle, open, close, removeTool, placeTool };
})();
