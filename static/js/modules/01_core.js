// ============== BadNotes Application ==============
// NOTE: This file uses legacy global state. Consider migrating to App.js architecture.
// TODO: Encapsulate state in a proper state management object

        /**
         * API Client - Handles all backend communication
         * OPTIMIZATION: Added request caching and deduplication for common endpoints
         */
        const API = {
            _cache: new Map(),
            _cacheTTL: 5000, // 5 second cache for GET requests
            _pendingRequests: new Map(), // Deduplication of in-flight requests

            // Clear cache entry
            invalidateCache(url) {
                this._cache.delete(url);
            },

            // Clear all cache
            clearCache() {
                this._cache.clear();
            },
            async get(url) {
                try {
                    const res = await fetch(url);
                    if (!res.ok) {
                        console.error(`API GET ${url} failed:`, res.status);
                        return null;
                    }
                    return res.json();
                } catch (error) {
                    console.error(`API GET ${url} error:`, error);
                    return null;
                }
            },
            async post(url, data) {
                try {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    if (!res.ok) {
                        console.error(`API POST ${url} failed:`, res.status);
                        return null;
                    }
                    return res.json();
                } catch (error) {
                    console.error(`API POST ${url} error:`, error);
                    return null;
                }
            },
            async put(url, data) {
                try {
                    const res = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    if (!res.ok) {
                        console.error(`API PUT ${url} failed:`, res.status);
                        return null;
                    }
                    return res.json();
                } catch (error) {
                    console.error(`API PUT ${url} error:`, error);
                    return null;
                }
            },
            async delete(url) {
                try {
                    const res = await fetch(url, { method: 'DELETE' });
                    if (!res.ok) {
                        console.error(`API DELETE ${url} failed:`, res.status);
                        return null;
                    }
                    return res.json();
                } catch (error) {
                    console.error(`API DELETE ${url} error:`, error);
                    return null;
                }
            }
        };

        // State
        let notebooks = [];
        let currentNotebook = null;
        let pages = [];
        let currentPageIndex = 0;
        let currentTool = 'pen';
        let currentColor = '#ffffff';
        let currentSize = 1.5;
        let isDrawing = false;
        let drawingPointerId = null; // Track which pointer is drawing
        let isPointerPanning = false; // New flag for single-finger panning
        let panningPointerId = null; // Track which pointer is panning
        let lastX = 0;
        let lastY = 0;

        // Separate tracking for panning to prevent conflicts with drawing
        let lastPanX = 0;
        let lastPanY = 0;

        // Palm rejection state - track pen activity
        let penIsActive = false;
        let hardwarePenContact = null;
        let activePenPointerId = null;
        let lastPenEventTime = 0;
        // Touchscreens report broader contacts than a mouse/stylus. Keep this
        // threshold high enough not to mistake an ordinary fingertip for a palm.
        const PALM_MIN_CONTACT_SIZE = 80;

        let zoom = 1;
        let panX = 0;
        let panY = 0;

        // Expose zoom/pan state to window for IIFE modules that can't access globals
        Object.defineProperties(window, {
            zoom: { get: () => zoom, enumerable: true },
            panX: { get: () => panX, enumerable: true },
            panY: { get: () => panY, enumerable: true }
        });

        let strokes = [];
        let images = []; // Array to store image objects {id, x, y, width, height, dataUrl, rotation}
        let currentPageTemplate = 'blank'; // Per-page template (blank, lined, grid, dotted)
        let currentStroke = null;
        let historyStack = [];
        let redoStack = [];

        // Shape dropdown state
        let currentShape = 'line';
        const shapeIcons = {
            line: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>`,
            rectangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
            circle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>`,
            arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14,6 20,12 14,18"/></svg>`
        };

        // Touch gesture state
        let touches = [];
        let lastTouchDistance = 0;
        let lastTouchCenter = { x: 0, y: 0 };
        let isPinching = false;
        let isPanning = false;

        // Pressure-based dynamic brush (4096 levels)
        let dynamicBrushEnabled = false;
        let baseBrushSize = 3;

        // Finger drawing toggle
        let fingerDrawingEnabled = true;

        // Eraser modes: 'point', 'object'
        let eraserMode = 'point';

        // Settings (with defaults)
        let settings = {
            smoothness: 60,        // 0-100, affects input smoothing weight
            minDistance: 1.5,      // Minimum distance between points
            fingerDrawing: false,   // Pen only by default
            theme: 'dark',         // Default theme (light or dark)
            accentTheme: 'iris',   // Interface material tone; never changes ink or covers
            // Pressure thickness settings
            pressureMultiplier: 1.0,   // Multiplier for pressure-based thickness (0.5 = half, 2.0 = double)
            dynamicBrushEnabled: false // Whether dynamic brush (pressure thickness) is enabled
        };

        // Theme state - true = dark mode (default), false = light mode
        let isDarkMode = true;

        // Read theme colors only on a theme change, never during a zoom frame.
        // Both paper renderers use this snapshot, not separate hard-coded fills.
        let canvasThemePalette = null;
        function refreshCanvasThemePalette() {
            const theme=settings.theme||'dark',style=getComputedStyle(document.documentElement);
            const light=theme==='light',oled=theme==='oled';
            const read=(key,fallback)=>style.getPropertyValue(key).trim()||fallback;
            canvasThemePalette={theme,
                surround:read('--color-canvas-bg',light?'#e5e5e5':oled?'#000000':'#101010'),
                paper:read('--color-canvas-paper',light?'#ffffff':oled?'#000000':'#1a1a1a'),
                grid:read('--template-line-color',light?'rgba(0,0,0,.08)':'rgba(255,255,255,.08)'),
                dots:read('--template-dot-color',light?'rgba(0,0,0,.15)':'rgba(255,255,255,.15)'),
                edge:read('--ui-paper-edge','transparent'),
                ui:{surface:read('--ui-surface',light?'#fbfaff':'#302c3a'),text:read('--ui-text',light?'#292333':'#f3eff9'),
                    muted:read('--ui-muted','#a69bb8'),action:read('--ui-action-solid','#7640fd'),error:read('--ui-error','#ee93aa')},
                selection:{accent:read('--selection-accent',light?'#7640fd':'#c39cf8'),
                    highlight:read('--selection-highlight',light?'#9a4cfd':'#edd3fd'),
                    surface:read('--selection-surface',light?'#f4e8fb':'#302439')}};
            return canvasThemePalette;
        }
        function getCanvasThemePalette() {
            return canvasThemePalette?.theme===(settings.theme||'dark')?canvasThemePalette:refreshCanvasThemePalette();
        }

        function getSelectionThemePalette() { return getCanvasThemePalette().selection; }
        function getSelectionStroke(context,x1,y1,x2,y2) {
            const colors=getSelectionThemePalette();
            const gradient=context.createLinearGradient(x1,y1,x2,y2);
            gradient.addColorStop(0,colors.accent);gradient.addColorStop(1,colors.highlight);return gradient;
        }

        // Apply theme to document and canvas
        function applyTheme(theme) {
            const nextIsDarkMode = theme === 'dark' || theme === 'oled';
            const themeChanged = document.documentElement.dataset.theme !== theme || isDarkMode !== nextIsDarkMode;
            isDarkMode = nextIsDarkMode;
            settings.theme = theme;
            document.documentElement.setAttribute('data-theme', theme);
            window.AppearanceSettings?.applyAccent(theme, settings.accentTheme || 'iris');
            refreshCanvasThemePalette();
            localStorage.setItem('badnotes-theme', theme);
            // The raster stroke cache contains theme-resolved pixels. Rebuild
            // just that cache when switching themes; vector paths are geometry
            // only and can keep rendering with the new color immediately.
            if (themeChanged && typeof window.invalidateStrokeRasterCache === 'function') {
                window.invalidateStrokeRasterCache();
            }
            // Redraw canvas with new theme colors
            if (typeof redrawCanvas === 'function') {
                redrawCanvas();
            }
            // Regenerate page thumbnails with new theme
            if (typeof renderPageList === 'function') {
                renderPageList();
            }
            if(themeChanged)window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme,rasterInvalidated:true } }));
        }

        // Toggle between light, dark, and oled mode
        function toggleTheme() {
            const currentTheme = settings.theme || 'dark';
            let nextTheme;
            if (currentTheme === 'dark' || currentTheme === 'oled') {
                nextTheme = 'light';
            } else {
                nextTheme = 'dark';
            }
            applyTheme(nextTheme);
        }

        // Get theme-adjusted color for rendering
        // Swaps white↔black in light mode for proper contrast
        function getThemedColor(color) {
            if (!color) return color;
            if (isDarkMode) return color; // Dark mode: use original colors

            // Light mode: swap pure black and white while preserving alpha.
            const c = String(color).toLowerCase().trim().replace(/\s+/g, '');
            if (c === 'white') return '#000000';
            if (c === 'black') return '#ffffff';

            const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
            if (hex) {
                const digits = hex[1];
                const rgbLength = digits.length === 3 || digits.length === 4 ? 3 : 6;
                const rgb = digits.slice(0, rgbLength);
                const isWhite = rgbLength === 3 ? /^f{3}$/.test(rgb) : /^f{6}$/.test(rgb);
                const isBlack = /^0+$/.test(rgb);
                if (isWhite || isBlack) {
                    const replacement = isWhite ? '0' : 'f';
                    return `#${replacement.repeat(rgbLength)}${digits.slice(rgbLength)}`;
                }
            }

            const functional = c.match(/^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,([^,)]+))?\)$/);
            if (functional) {
                const [, red, green, blue, alpha] = functional;
                const rgb = [Number(red), Number(green), Number(blue)];
                if (rgb.every(channel => channel === 255)) {
                    return alpha === undefined ? 'rgb(0,0,0)' : `rgba(0,0,0,${alpha})`;
                }
                if (rgb.every(channel => channel === 0)) {
                    return alpha === undefined ? 'rgb(255,255,255)' : `rgba(255,255,255,${alpha})`;
                }
            }
            return color; // Other colors stay the same
        }

        // Initialize theme from localStorage or default
        function initTheme() {
            const savedTheme = localStorage.getItem('badnotes-theme') || 'dark';
            applyTheme(savedTheme);
        }

        // ============== Palm Rejection ==============

        // Track contact, not stylus hover/proximity.
        function markPenActive(pointerId = null) {
            if (hardwarePenContact === false) return;
            penIsActive = true;
            activePenPointerId = pointerId;
            lastPenEventTime = performance.now();
        }

        // Mark pen as inactive (call on pen up/leave)
        function markPenInactive(updateTimestamp = true, pointerId = null) {
            if (pointerId !== null && activePenPointerId !== null && pointerId !== activePenPointerId) return;
            const wasActive = penIsActive;
            penIsActive = false;
            activePenPointerId = null;
            if (wasActive && updateTimestamp) lastPenEventTime = performance.now();
        }

        // Check if touch should be rejected due to palm rejection
        // Returns true if touch should be BLOCKED
        // Accepts optional PointerEvent/Touch to inspect contact size
        function shouldRejectTouch(e) {
            // If palm rejection is disabled in settings, allow all touches
            if (settings.palmRejection === false) return false;

            // Block if pen is currently active
            if (penIsActive) return true;

            // No post-pen timer: fresh interactions can start on pen-up.
            // Existing contacts are classified by the canvas pointer router.

            // Contact size heuristic — large touch area is likely a palm
            // PointerEvent uses width/height; Touch uses radiusX/radiusY
            if (e) {
                const w = e.width || (e.radiusX ? e.radiusX * 2 : 0);
                const h = e.height || (e.radiusY ? e.radiusY * 2 : 0);
                if (w > PALM_MIN_CONTACT_SIZE || h > PALM_MIN_CONTACT_SIZE) {
                    return true;
                }
            }

            return false;
        }

        // Check if ANY touch in a TouchList should be rejected (for multi-touch gestures)
        // Returns true if the gesture should be BLOCKED
        function shouldRejectTouchList(touchList) {
            if (settings.palmRejection === false) return false;
            if (penIsActive) return true;
            // Check every touch — if any one looks like a palm, reject the whole gesture
            if (touchList) {
                for (let i = 0; i < touchList.length; i++) {
                    const t = touchList[i];
                    const w = t.radiusX ? t.radiusX * 2 : 0;
                    const h = t.radiusY ? t.radiusY * 2 : 0;
                    if (w > PALM_MIN_CONTACT_SIZE || h > PALM_MIN_CONTACT_SIZE) {
                        return true;
                    }
                }
            }
            return false;
        }

        // Expose palm rejection globally for GestureRecognizer and other input modules
        window._badnotesPalmRejection = {
            shouldReject: (e) => shouldRejectTouch(e),
            shouldRejectList: (touchList) => shouldRejectTouchList(touchList),
        };

        // Set Application Theme
        function setTheme(themeName) {
            const root=document.documentElement;
            if(root.dataset.theme!==themeName||isDarkMode!==(themeName==='dark'||themeName==='oled')){
                applyTheme(themeName);
            }else if(window.AppearanceSettings&&root.dataset.accent!==(settings.accentTheme||'iris')){
                window.AppearanceSettings.applyAccent(themeName,settings.accentTheme||'iris');
                refreshCanvasThemePalette();redrawCanvas(true);window.PageThumbnails?.refreshAppearance();
            }
        }

        // Load settings from localStorage
        function loadSettings() {
            try {
                const saved = localStorage.getItem('badnotes_settings');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    settings = { ...settings, ...parsed };
                }
            } catch (e) {
                console.warn('Failed to load settings:', e);
            }
            applySettings();
        }

        // Save settings to localStorage
        function saveSettings() {
            try {
                localStorage.setItem('badnotes_settings', JSON.stringify(settings));
            } catch (e) {
                console.warn('Failed to save settings:', e);
            }
            applySettings();
        }

        // Apply settings to the app
        function applySettings() {
            fingerDrawingEnabled = settings.fingerDrawing;
            dynamicBrushEnabled = settings.dynamicBrushEnabled || false;
            if (settings.theme) setTheme(settings.theme);

            // Update finger draw button state
            const fingerDrawBtn = document.getElementById('fingerDrawBtn');
            if (fingerDrawBtn) {
                fingerDrawBtn.classList.toggle('active', fingerDrawingEnabled);
            }
        }

        // Get smoothing weights based on settings
        function getSmoothingWeights() {
            // Smoothness 0 = no smoothing (1, 0, 0)
            // Smoothness 100 = heavy smoothing (0.4, 0.35, 0.25)
            const s = settings.smoothness / 100;
            return {
                current: 1 - (s * 0.6),      // 1.0 to 0.4
                prev1: s * 0.35,              // 0 to 0.35
                prev2: s * 0.25               // 0 to 0.25
            };
        }

        // Smooth point that "chases" the actual cursor (iOS-style)
        let smoothPoint = { x: 0, y: 0 };
        let smoothPointInitialized = false;

        // Multi-point smoothing buffer for ultra-smooth strokes
        let smoothingBuffer = [];
        const MAX_SMOOTHING_BUFFER = 8;

        // Get the lerp factor based on smoothness setting
        // Lower = smoother/slower chase, Higher = more responsive
        function getSmoothLerpFactor() {
            // Smoothness 0 = factor 1.0 (instant, no smoothing)
            // Smoothness 100 = factor 0.15 (smooth)
            // Smoothness 200 = factor 0.03 (ultra-smooth, silky)
            const s = Math.min(settings.smoothness, 200) / 100;
            if (s <= 1) {
                // 0-100: lerp from 1.0 to 0.15
                return Math.max(0.35, 1.0 - (s * 0.85));
            } else {
                // 100-200: lerp from 0.15 to 0.03 (exponential for silky feel)
                const extra = s - 1; // 0 to 1
                // Keep the filter responsive; curve fitting supplies smoothness
                // without making the stored path trail far behind the pen.
                return Math.max(0.35, 0.15 * Math.pow(0.2, extra));
            }
        }

        // Get how many points to use for smoothing buffer based on smoothness
        function getSmoothingBufferSize() {
            // 0-100: 1-3 points
            // 100-200: 3-8 points for ultra-smooth
            const s = Math.min(settings.smoothness, 200) / 100;
            if (s <= 1) {
                return Math.floor(1 + s * 2); // 1 to 3
            } else {
                return Math.floor(3 + (s - 1) * 5); // 3 to 8
            }
        }

        // Apply weighted moving average to get ultra-smooth point
        // OPTIMIZED: Avoid object creation in hot path, use cached weights
        const _weightCache = [1, 2, 4, 8, 16, 32, 64, 128];
        function getSmoothedBufferPoint(newPoint) {
            // Add to buffer - reuse object properties
            smoothingBuffer.push({ x: newPoint.x, y: newPoint.y });

            // Keep buffer size limited
            const bufferSize = getSmoothingBufferSize();
            while (smoothingBuffer.length > bufferSize) {
                smoothingBuffer.shift();
            }

            const len = smoothingBuffer.length;
            if (len === 1) {
                return smoothingBuffer[0];
            }

            // Weighted average with cached weights - avoids Math.pow calls
            let totalWeight = 0;
            let x = 0, y = 0;

            for (let i = 0; i < len; i++) {
                const weight = _weightCache[i] || (1 << i);
                const pt = smoothingBuffer[i];
                x += pt.x * weight;
                y += pt.y * weight;
                totalWeight += weight;
            }

            return { x: x / totalWeight, y: y / totalWeight };
        }

        // ===== TRASH/RECYCLE BIN HELPERS =====
        // Check if pointer is over recycle bin (large corner zone)
        function isOverRecycleBin(clientX, clientY) {
            const recycleBin = document.getElementById('recycleBinBtn');
            if (!recycleBin) return false;
            const rect = recycleBin.getBoundingClientRect();
            // Large hit area - entire bottom-left corner zone
            const padding = 80;
            // Also check if in bottom-left corner region of screen
            const cornerZone = clientX < 180 && clientY > window.innerHeight - 180;
            const directHit = clientX >= rect.left - padding &&
                   clientX <= rect.right + padding &&
                   clientY >= rect.top - padding &&
                   clientY <= rect.bottom + padding;
            return directHit || cornerZone;
        }

        // Update trash hover state during drag
        function updateTrashHover(clientX, clientY) {
            const recycleBin = document.getElementById('recycleBinBtn');
            if (!recycleBin) return;
            if (isOverRecycleBin(clientX, clientY)) {
                recycleBin.classList.add('drag-over');
                document.body.classList.add('trash-drop-zone-active');
            } else {
                recycleBin.classList.remove('drag-over');
                document.body.classList.remove('trash-drop-zone-active');
            }
        }

        // Clear trash hover state
        function clearTrashHover() {
            const recycleBin = document.getElementById('recycleBinBtn');
            if (recycleBin) {
                recycleBin.classList.remove('drag-over');
                recycleBin.classList.remove('sucking');
            }
            document.body.classList.remove('trash-drop-zone-active');
        }

        // Play suck animation when dropping into trash
        function playTrashSuckAnimation(clientX, clientY, callback) {
            const recycleBin = document.getElementById('recycleBinBtn');
            if (!recycleBin) {
                if (callback) callback();
                return;
            }

            const rect = recycleBin.getBoundingClientRect();
            const trashX = rect.left + rect.width / 2;
            const trashY = rect.top + rect.height / 2;

            // Spawn particles at drop location that animate to trash
            const colors = ['var(--accent)', '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff'];

            for (let i = 0; i < 6; i++) {
                const particle = document.createElement('div');
                particle.className = 'trash-particle';

                // Random offset from drop point
                const angle = (i / 6) * Math.PI * 2;
                const dist = 15 + Math.random() * 20;
                const startX = clientX + Math.cos(angle) * dist;
                const startY = clientY + Math.sin(angle) * dist;

                // Calculate offset from trash (animation goes FROM offset TO 0,0)
                const offsetX = startX - trashX;
                const offsetY = startY - trashY;

                const size = 6 + Math.random() * 10;

                particle.style.cssText = `
                    left: ${trashX}px;
                    top: ${trashY}px;
                    width: ${size}px;
                    height: ${size}px;
                    background: ${colors[i % colors.length]};
                    --suck-x: ${offsetX}px;
                    --suck-y: ${offsetY}px;
                    animation-delay: ${i * 15}ms;
                `;

                document.body.appendChild(particle);

                // Remove after animation
                setTimeout(() => particle.remove(), 150 + i * 15);
            }

            // Quick pulse on trash bin
            recycleBin.classList.add('sucking');
            setTimeout(() => {
                recycleBin.classList.remove('sucking');
                recycleBin.classList.remove('drag-over');
                document.body.classList.remove('trash-drop-zone-active');
            }, 120);

            // Callback immediately - don't wait
            if (callback) setTimeout(callback, 50);
        }
