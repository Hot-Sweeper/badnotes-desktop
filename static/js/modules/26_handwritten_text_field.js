// ============== Handwritten Text Field Module ==============
// Real-time editable text fields that render using your handwriting font
// Like PowerPoint text boxes but with your handwriting

const HandwrittenTextField = (function() {
    'use strict';
    const TAB_SIZE = 8;

    // Grid/atlas constants (must match FontBook)
    const CELL_WIDTH = 72;   // Original character cell width
    const CELL_HEIGHT = 96;  // Original character cell height

    // ============== EDITABLE TEXT SETTINGS ==============
    // Modify these values to adjust text appearance
    const DEFAULT_SETTINGS = {
        fontSize: 41,               // Base font size (standard default)
        letterSpacing: 0.05,        // Character spacing multiplier
        spaceWidth: 0.30,           // Space character width multiplier
        lineHeight: 0.585,          // Line height multiplier (24px grid at 41px font)
        boxPaddingX: 4,             // Horizontal padding inside text box
        boxPaddingY: 2,             // Vertical padding inside text box
        strokeThickness: 1.5,       // Base stroke thickness (independent of font size)
        minGlyphWidth: 0.15,        // Minimum glyph width (normalized) to prevent collapse
        randomness: 0.1             // Randomness strength
    };

    let settings = { ...DEFAULT_SETTINGS };

    // Expose settings for external modification
    function getSettings() { return { ...settings }; }
    function setSettings(newSettings) {
        settings = { ...settings, ...newSettings };
        window.dispatchEvent(new Event('handwrittenPreviewChanged'));
        if (typeof redrawCanvas === 'function') redrawCanvas();
    }

    const MIN_BOX_WIDTH = 100; // Minimum text box width
    const HANDLE_SIZE = 10;   // Resize handle size

    // Active text field state
    let activeField = null;
    let textFields = []; // All text fields on page
    let fontData = null;
    let cursorVisible = true;
    let cursorInterval = null;

    // Resize state
    let isResizing = false;
    let resizeHandle = null;
    let resizeStart = null;

    // Drag/move state
    let isDragging = false;
    let dragStart = null;
    let isSelecting = false;
    let selectionAnchor = null;

    // Triple-tap detection for touch selection
    let tapHistory = []; // { time, x, y }
    const TRIPLE_TAP_TIMEOUT = 500; // ms between taps
    const TRIPLE_TAP_DISTANCE = 40; // max px distance between taps

    // Settings panel state
    let settingsPanelVisible = false;
    let settingsPanel = null;
    let copiedPreset = null; // Stores copied settings preset

    // Cached character set
    let characterSet = null;
    let glyphMetricsCache = new Map();

    function resetGlyphMetricsCache() {
        glyphMetricsCache.clear();
    }

    function getGlyphMetrics(char) {
        if (!fontData || !fontData.characters || !fontData.characters[char]) {
            return { minX: 0, maxX: 1, width: 1 };
        }
        const cached = glyphMetricsCache.get(char);
        if (cached) return cached;

        const variants = fontData.characters[char].variants || [];
        let minX = Infinity;
        let maxX = -Infinity;

        for (const variant of variants) {
            for (const stroke of variant) {
                for (const pt of stroke.points || []) {
                    minX = Math.min(minX, pt.x);
                    maxX = Math.max(maxX, pt.x);
                }
            }
        }

        if (!isFinite(minX) || !isFinite(maxX)) {
            const fallback = { minX: 0, maxX: 1, width: 1 };
            glyphMetricsCache.set(char, fallback);
            return fallback;
        }

        const width = Math.max(settings.minGlyphWidth, maxX - minX);
        const metrics = { minX, maxX, width };
        glyphMetricsCache.set(char, metrics);
        return metrics;
    }

    function getCharAdvance(fontSize, char) {
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const metrics = getGlyphMetrics(char);
        const spacing = charWidth * settings.letterSpacing;
        const baseWidth = charWidth * metrics.width;
        return Math.max(charWidth * settings.minGlyphWidth, baseWidth, baseWidth + spacing);
    }

    function getCharOffset(fontSize, char) {
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const metrics = getGlyphMetrics(char);
        return charWidth * metrics.minX;
    }

    function getLineHeightPx(fontSize) {
        // Always use user's line height setting (multiplier applied to fontSize)
        return fontSize * settings.lineHeight;
    }

    function getSpaceAdvance(fontSize) {
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        return charWidth * settings.spaceWidth;
    }

    function getTabAdvance(fontSize, currentLineX) {
        const tabStopWidth = Math.max(1, getSpaceAdvance(fontSize) * TAB_SIZE);
        const nextTabStop = (Math.floor(currentLineX / tabStopWidth) + 1) * tabStopWidth;
        return Math.max(1, nextTabStop - currentLineX);
    }

    function isWordBreakChar(char) {
        return char === ' ' || char === '\t' || char === '\n';
    }

    function isWordStartAt(text, idx) {
        return idx === 0 || isWordBreakChar(text[idx - 1]);
    }

    function getBoundsCacheKey(field) {
        return [
            field.text || '',
            field.fontSize || settings.fontSize,
            field.width || MIN_BOX_WIDTH,
            field.autoWidth ? 'auto' : 'fixed',
            settings.spaceWidth,
            settings.lineHeight,
            settings.boxPaddingX,
            settings.boxPaddingY
        ].join('|');
    }

    function seededRandom(seed) {
        let t = seed + 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function getCharRandomness(field, index) {
        const strength = settings.randomness || 0;
        if (strength <= 0) return { dx: 0, dy: 0, rot: 0, spacing: 0 };
        const seed = Math.floor((field.id || 0) + index * 977);
        const r1 = seededRandom(seed);
        const r2 = seededRandom(seed + 13);
        const r3 = seededRandom(seed + 29);
        const r4 = seededRandom(seed + 53);
        const dx = (r1 - 0.5) * 6 * strength;
        const dy = (r2 - 0.5) * 4 * strength;
        const rot = (r3 - 0.5) * 0.18 * strength;
        const spacing = (r4 - 0.5) * 0.15 * strength;
        return { dx, dy, rot, spacing };
    }

    function getVariantIndex(field, index, variantCount) {
        if (variantCount <= 1) return 0;
        const seed = Math.floor((field.id || 0) + index * 131);
        return Math.floor(seededRandom(seed) * variantCount);
    }

    function getUsableVariants(variants) {
        const nonEmpty = (variants || [])
            .map((v, idx) => ({ strokes: v, idx, count: (v && v.length) ? v.length : 0 }))
            .filter(v => v.count > 0);

        if (nonEmpty.length <= 1) return nonEmpty;

        const maxCount = nonEmpty.reduce((max, v) => Math.max(max, v.count), 0);
        if (maxCount === 0) return nonEmpty;

        const threshold = Math.max(1, Math.floor(maxCount * 0.6));
        const filtered = nonEmpty.filter(v => v.count >= threshold);
        return filtered.length > 0 ? filtered : nonEmpty;
    }

    function startTextAnimation(field, fromIndex, count) {
        if (!field || count <= 0) return;
        const now = performance.now();
        const durationPerChar = 45;
        field.animation = {
            fromIndex,
            count,
            startTime: now,
            durationPerChar,
            totalDuration: Math.max(90, count * durationPerChar)
        };
    }

    /**
     * Initialize the module
     */
    async function init() {
        // Load font data from fontbook
        await loadFontData();

        // Create settings panel HTML
        createSettingsPanel();

        // Setup keyboard input
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keypress', handleKeyPress);

        // Setup paste handler
        document.addEventListener('paste', handlePaste);

        // NOTE: Canvas pointer events are now handled externally through 09_events.js
        // The main event handler delegates to our handlePointerDown/Move/Up functions
    }

    /**
     * Create the settings panel HTML element
     */
    function createSettingsPanel() {
        if (settingsPanel) return;

        settingsPanel = document.createElement('div');
        settingsPanel.id = 'textfield-settings-panel';
        settingsPanel.innerHTML = `
            <div class="tf-settings-header">
                <div><strong id="handwritingSettingsTitle">Handwriting</strong><small>Make typed ink feel like yours.</small></div>
                <button class="tf-settings-close" type="button" aria-label="Close handwriting settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            </div>
            <div class="tf-settings-body">
                <div class="tf-setting-row">
                    <label>Font Size</label>
                    <input type="range" id="tf-fontSize" min="24" max="200" value="${settings.fontSize}">
                    <span class="tf-value">${settings.fontSize}</span>
                </div>
                <div class="tf-setting-row">
                    <label>Line Height</label>
                    <input type="range" id="tf-lineHeight" min="0.585" max="2.5" step="0.005" value="${settings.lineHeight}" list="lineheight-ticks">
                    <datalist id="lineheight-ticks"><option value="0.585"></option></datalist>
                    <span class="tf-value">${settings.lineHeight.toFixed(2)}</span>
                </div>
                <div class="tf-setting-row">
                    <label>Letter Spacing</label>
                    <input type="range" id="tf-letterSpacing" min="-1" max="0.5" step="0.05" value="${settings.letterSpacing}">
                    <span class="tf-value">${settings.letterSpacing.toFixed(2)}</span>
                </div>
                <div class="tf-setting-row">
                    <label>Space Width</label>
                    <input type="range" id="tf-spaceWidth" min="0.2" max="1.5" step="0.05" value="${settings.spaceWidth}">
                    <span class="tf-value">${settings.spaceWidth.toFixed(2)}</span>
                </div>
                <div class="tf-setting-row">
                    <label>Stroke Thickness</label>
                    <input type="range" id="tf-strokeThickness" min="0.5" max="6" step="0.25" value="${settings.strokeThickness}">
                    <span class="tf-value">${settings.strokeThickness.toFixed(2)}</span>
                </div>
                <div class="tf-setting-row">
                    <label>Randomness</label>
                    <input type="range" id="tf-randomness" min="0" max="1" step="0.01" value="${settings.randomness}">
                    <span class="tf-value">${settings.randomness.toFixed(2)}</span>
                </div>
                <div class="tf-settings-actions">
                    <button class="tf-settings-btn" id="tf-copy-preset" title="Copy current settings">Copy Preset</button>
                    <button class="tf-settings-btn" id="tf-paste-preset" title="Paste saved settings">Paste Preset</button>
                </div>
                <div class="tf-settings-actions">
                    <button class="tf-settings-reset" id="tf-reset-defaults">Reset to Defaults</button>
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #textfield-settings-panel {
                position: fixed;
                top: 50%;
                right: 20px;
                transform: translateY(-50%);
                width: 280px;
                background: rgba(30, 35, 50, 0.95);
                border: 2px solid #6c5ce7;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                z-index: 10000;
                display: none;
                font-family: system-ui, -apple-system, sans-serif;
                backdrop-filter: blur(10px);
            }
            #textfield-settings-panel.visible {
                display: block;
            }
            .tf-settings-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid rgba(108, 92, 231, 0.3);
                color: #fff;
                font-weight: 600;
                font-size: 14px;
            }
            .tf-settings-close {
                background: none;
                border: none;
                color: #fff;
                font-size: 20px;
                cursor: pointer;
                opacity: 0.7;
                transition: opacity 0.2s;
                padding: 0 4px;
            }
            .tf-settings-close:hover {
                opacity: 1;
            }
            .tf-settings-body {
                padding: 16px;
            }
            .tf-setting-row {
                margin-bottom: 16px;
            }
            .tf-setting-row:last-child {
                margin-bottom: 0;
            }
            .tf-setting-row label {
                display: block;
                color: #a0a0a0;
                font-size: 12px;
                margin-bottom: 6px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .tf-setting-row input[type="range"] {
                width: calc(100% - 50px);
                vertical-align: middle;
                accent-color: #6c5ce7;
            }
            .tf-setting-row .tf-value {
                display: inline-block;
                width: 45px;
                text-align: right;
                color: #6c5ce7;
                font-size: 13px;
                font-weight: 600;
            }
            .tf-settings-actions {
                margin-top: 10px;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .tf-settings-btn {
                background: #6c5ce7;
                border: 1px solid rgba(108, 92, 231, 0.6);
                color: #ffffff;
                padding: 6px 10px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                transition: background 0.2s, border-color 0.2s;
            }
            .tf-settings-btn:hover {
                background: #5b4cdb;
                border-color: #7c6cf7;
            }
            .tf-settings-btn:disabled {
                background: #3a3f58;
                border-color: rgba(108, 92, 231, 0.2);
                color: #666;
                cursor: not-allowed;
            }
            .tf-settings-reset {
                background: #2f3549;
                border: 1px solid rgba(108, 92, 231, 0.4);
                color: #ffffff;
                padding: 6px 10px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                transition: background 0.2s, border-color 0.2s;
            }
            .tf-settings-reset:hover {
                background: #3a3f58;
                border-color: #6c5ce7;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(settingsPanel);
        settingsPanel.setAttribute('role','dialog');
        settingsPanel.setAttribute('aria-labelledby','handwritingSettingsTitle');
        settingsPanel.querySelectorAll('.tf-setting-row').forEach(row=>row.querySelector('label').htmlFor=row.querySelector('input').id);

        // Event listeners
        settingsPanel.querySelector('.tf-settings-close').addEventListener('click', () => {
            toggleSettingsPanel(false);
        });

        const resetBtn = settingsPanel.querySelector('#tf-reset-defaults');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                settings = { ...DEFAULT_SETTINGS };
                if (activeField) {
                    activeField.fontSize = settings.fontSize;
                }
                toggleSettingsPanel(true);
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof triggerAutoSave === 'function') triggerAutoSave();
            });
        }

        // Copy preset button
        const copyBtn = settingsPanel.querySelector('#tf-copy-preset');
        const pasteBtn = settingsPanel.querySelector('#tf-paste-preset');

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                copiedPreset = {
                    fontSize: activeField?.fontSize || settings.fontSize,
                    lineHeight: settings.lineHeight,
                    letterSpacing: settings.letterSpacing,
                    spaceWidth: settings.spaceWidth,
                    strokeThickness: settings.strokeThickness,
                    randomness: settings.randomness
                };
                if (pasteBtn) pasteBtn.disabled = false;
                if (typeof showToast === 'function') showToast('Preset copied!', 'success');
            });
        }

        if (pasteBtn) {
            pasteBtn.disabled = !copiedPreset;
            pasteBtn.addEventListener('click', () => {
                if (!copiedPreset) return;
                settings.lineHeight = copiedPreset.lineHeight;
                settings.letterSpacing = copiedPreset.letterSpacing;
                settings.spaceWidth = copiedPreset.spaceWidth;
                settings.strokeThickness = copiedPreset.strokeThickness;
                settings.randomness = copiedPreset.randomness;
                if (activeField) {
                    activeField.fontSize = copiedPreset.fontSize;
                }
                settings.fontSize = copiedPreset.fontSize;
                toggleSettingsPanel(true); // Refresh sliders
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof triggerAutoSave === 'function') triggerAutoSave();
                if (typeof showToast === 'function') showToast('Preset applied!', 'success');
            });
        }

        // Slider change handlers
        const sliders = {
            'tf-fontSize': { key: 'fontSize', format: v => Math.round(v) },
            'tf-lineHeight': { key: 'lineHeight', format: v => parseFloat(v).toFixed(2) },
            'tf-letterSpacing': { key: 'letterSpacing', format: v => parseFloat(v).toFixed(2) },
            'tf-spaceWidth': { key: 'spaceWidth', format: v => parseFloat(v).toFixed(2) },
            'tf-strokeThickness': { key: 'strokeThickness', format: v => parseFloat(v).toFixed(2) },
            'tf-randomness': { key: 'randomness', format: v => parseFloat(v).toFixed(2) }
        };

        for (const [id, config] of Object.entries(sliders)) {
            const slider = settingsPanel.querySelector(`#${id}`);
            const valueSpan = slider.parentElement.querySelector('.tf-value');

            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                settings[config.key] = config.key === 'fontSize' ? Math.round(val) : val;
                if (config.key === 'fontSize' && activeField) {
                    activeField.fontSize = settings.fontSize;
                }
                valueSpan.textContent = config.format(val);
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof triggerAutoSave === 'function') triggerAutoSave();
            });
        }

        // Prevent canvas events when interacting with panel
        settingsPanel.addEventListener('pointerdown', e => e.stopPropagation());
        settingsPanel.addEventListener('touchstart', e => e.stopPropagation());
    }

    /**
     * Toggle settings panel visibility
     */
    function toggleSettingsPanel(forceState) {
        settingsPanelVisible = forceState !== undefined ? forceState : !settingsPanelVisible;
        if (settingsPanel) {
            settingsPanel.classList.toggle('visible', settingsPanelVisible);

            // Update slider values when showing
            if (settingsPanelVisible) {
                const fontSizeValue = activeField?.fontSize || settings.fontSize;
                settingsPanel.querySelector('#tf-fontSize').value = fontSizeValue;
                settingsPanel.querySelector('#tf-lineHeight').value = settings.lineHeight;
                settingsPanel.querySelector('#tf-letterSpacing').value = settings.letterSpacing;
                settingsPanel.querySelector('#tf-spaceWidth').value = settings.spaceWidth;
                settingsPanel.querySelector('#tf-strokeThickness').value = settings.strokeThickness;
                settingsPanel.querySelector('#tf-randomness').value = settings.randomness;

                // Update displayed values
                const rows = settingsPanel.querySelectorAll('.tf-setting-row');
                rows[0].querySelector('.tf-value').textContent = fontSizeValue;
                rows[1].querySelector('.tf-value').textContent = settings.lineHeight.toFixed(2);
                rows[2].querySelector('.tf-value').textContent = settings.letterSpacing.toFixed(2);
                rows[3].querySelector('.tf-value').textContent = settings.spaceWidth.toFixed(2);
                rows[4].querySelector('.tf-value').textContent = settings.strokeThickness.toFixed(2);
                rows[5].querySelector('.tf-value').textContent = settings.randomness.toFixed(2);
            }
        }
        if (typeof redrawCanvas === 'function') redrawCanvas();
    }

    /**
     * Load font data from the fontbook
     */
    async function loadFontData() {
        const fontbookId = localStorage.getItem('badnotes_fontbook_id');
        if (!fontbookId) return;

        try {
            const data = await API.get(`/api/notebooks/${fontbookId}`);
            if (!data || !data.pages || data.pages.length === 0) return;

            // Combine all font pages for variation
            fontData = await extractFontFromPages(data.pages);
            characterSet = FontBook.ATLAS_CHARACTERS;
            resetGlyphMetricsCache();
            window.dispatchEvent(new Event('handwrittenPreviewChanged'));
        } catch (err) {
            console.error('Failed to load font data:', err);
        }
    }

    async function extractFontFromPages(pagesData) {
        const characters = FontBook.ATLAS_CHARACTERS;
        const font = { characters: {} };
        const atlasPages = pagesData.filter(page => page?.isFontAtlas === true || page?.isFontAtlas === 'true');
        const pageCount = Math.max(1, atlasPages.length);
        const defaultVariantsPerChar = (typeof FontBook !== 'undefined' && FontBook.VARIANTS_PER_CHAR) ? FontBook.VARIANTS_PER_CHAR : 3;

        const useSingleVariantPerPage = (() => {
            if (atlasPages.length > 1) return true;
            if (atlasPages.length === 0) return false;
            const thresholdRatio = 0.18;
            for (const pageData of atlasPages) {
                if (!pageData?.strokes) continue;
                const charVariantUsage = new Map();
                for (const stroke of pageData.strokes) {
                    if (!stroke.points || stroke.points.length === 0) continue;
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const pt of stroke.points) {
                        minX = Math.min(minX, pt.x);
                        maxX = Math.max(maxX, pt.x);
                        minY = Math.min(minY, pt.y);
                        maxY = Math.max(maxY, pt.y);
                    }
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;
                    const col = Math.floor(centerX / CELL_WIDTH);
                    const row = Math.floor(centerY / CELL_HEIGHT);
                    const charIndex = row * 10 + col;
                    if (charIndex < 0 || charIndex >= characters.length) continue;
                    const char = characters[charIndex];
                    const cellX = col * CELL_WIDTH;
                    const variant = Math.floor((centerX - cellX) / (CELL_WIDTH / defaultVariantsPerChar));
                    const variantIndex = Math.max(0, Math.min(variant, defaultVariantsPerChar - 1));
                    if (!charVariantUsage.has(char)) charVariantUsage.set(char, new Set());
                    charVariantUsage.get(char).add(variantIndex);
                }
                const usedChars = charVariantUsage.size;
                if (usedChars === 0) continue;
                let multiVariantChars = 0;
                for (const set of charVariantUsage.values()) {
                    if (set.size > 1) multiVariantChars++;
                }
                if (multiVariantChars / usedChars >= thresholdRatio) {
                    return true;
                }
            }
            return false;
        })();

        const variantsPerChar = useSingleVariantPerPage ? 1 : defaultVariantsPerChar;
        const totalVariantSlots = pageCount * variantsPerChar;

        characters.forEach(char => {
            font.characters[char] = { variants: Array.from({ length: totalVariantSlots }, () => []) };
        });

        atlasPages.forEach((pageData, pageIndex) => {
            if (!pageData?.strokes) return;

            for (const stroke of pageData.strokes) {
                if (!stroke.points || stroke.points.length === 0) continue;

                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                for (const pt of stroke.points) {
                    minX = Math.min(minX, pt.x);
                    maxX = Math.max(maxX, pt.x);
                    minY = Math.min(minY, pt.y);
                    maxY = Math.max(maxY, pt.y);
                }
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;

                const col = Math.floor(centerX / CELL_WIDTH);
                const row = Math.floor(centerY / CELL_HEIGHT);
                const charIndex = row * 10 + col;

                if (charIndex < 0 || charIndex >= characters.length) continue;

                const char = characters[charIndex];
                const cellX = col * CELL_WIDTH;
                const cellY = row * CELL_HEIGHT;
                const variant = useSingleVariantPerPage ? 0 : Math.floor((centerX - cellX) / (CELL_WIDTH / variantsPerChar));
                const variantIndex = Math.max(0, Math.min(variant, variantsPerChar - 1));
                const variantSlot = pageIndex * variantsPerChar + variantIndex;

                const normalizedPoints = stroke.points.map(pt => ({
                    x: (pt.x - cellX) / CELL_WIDTH,
                    y: (pt.y - cellY) / CELL_HEIGHT,
                    pressure: pt.pressure || 0.5,
                    size: pt.size || stroke.size
                }));

                font.characters[char].variants[variantSlot].push({
                    points: normalizedPoints,
                    color: stroke.color,
                    size: stroke.size
                });
            }
        });

        return font;
    }

    /**
     * Extract font strokes from a fontbook page
     */
    async function extractFontFromPage(pageData) {
        const characters = FontBook.ATLAS_CHARACTERS;
        const font = { characters: {} };

        // Initialize all characters
        characters.forEach(char => {
            font.characters[char] = { variants: [[], [], []] };
        });

        if (!pageData.strokes) return font;

        // Map each stroke to its character cell
        for (const stroke of pageData.strokes) {
            if (!stroke.points || stroke.points.length === 0) continue;

            // Find stroke center
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            for (const pt of stroke.points) {
                minX = Math.min(minX, pt.x);
                maxX = Math.max(maxX, pt.x);
                minY = Math.min(minY, pt.y);
                maxY = Math.max(maxY, pt.y);
            }
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            // Determine character and variant
            const col = Math.floor(centerX / CELL_WIDTH);
            const row = Math.floor(centerY / CELL_HEIGHT);
            const charIndex = row * 10 + col; // 10 columns

            if (charIndex < 0 || charIndex >= characters.length) continue;

            const char = characters[charIndex];
            const cellX = col * CELL_WIDTH;
            const cellY = row * CELL_HEIGHT;
            const variant = Math.floor((centerX - cellX) / (CELL_WIDTH / 3));
            const variantIndex = Math.max(0, Math.min(variant, 2));

            // Normalize stroke to 0-1 range within cell
            const normalizedPoints = stroke.points.map(pt => ({
                x: (pt.x - cellX) / CELL_WIDTH,
                y: (pt.y - cellY) / CELL_HEIGHT,
                pressure: pt.pressure || 0.5,
                size: pt.size || stroke.size
            }));

            font.characters[char].variants[variantIndex].push({
                points: normalizedPoints,
                color: stroke.color,
                size: stroke.size
            });
        }

        return font;
    }

    /**
     * Create a new text field at position
     */
    function createTextField(x, y) {
        const field = {
            id: Date.now(),
            x: x,
            y: y,
            text: '',
            fontSize: settings.fontSize,
            color: currentColor || '#ffffff',
            cursorPos: 0,
            width: 300, // Default width for word-wrap
            autoWidth: true, // Auto-expand until user resizes
            charColors: []
        };

        textFields.push(field);
        activeField = field;
        startCursorBlink();
        redrawCanvas();

        return field;
    }

    function setTextFields(fields) {
        textFields = Array.isArray(fields) ? fields.map(f => ({ ...f })) : [];
        activeField = null;
        stopCursorBlink();
        if (typeof redrawCanvas === 'function') redrawCanvas();
    }

    function getTextFields() {
        return textFields;
    }

    /**
     * Check if click is on an existing text field
     */
    function getFieldAtPosition(x, y) {
        for (const field of textFields) {
            const bounds = getFieldBounds(field);
            if (x >= bounds.x && x <= bounds.x + bounds.width &&
                y >= bounds.y && y <= bounds.y + bounds.height) {
                return field;
            }
        }
        return null;
    }

    /**
     * Get bounding box of a text field
     */
    function getFieldBounds(field) {
        const boundsKey = getBoundsCacheKey(field);
        if (field._boundsCacheKey === boundsKey && field._boundsCache) {
            return field._boundsCache;
        }

        const fontSize = field.fontSize || settings.fontSize;
        const lineHeightPx = getLineHeightPx(fontSize);

        // If field has fixed width, use it for wrapping
        const maxWidth = field.autoWidth ? Infinity : field.width;

        let currentLineWidth = 0;
        let maxLineWidth = 0;
        let lines = 1;
        let i = 0;

        while (i < field.text.length) {
            const char = field.text[i];

            if (char === '\n') {
                maxLineWidth = Math.max(maxLineWidth, currentLineWidth);
                currentLineWidth = 0;
                lines++;
                i++;
                continue;
            }

            if (char === ' ' || char === '\t') {
                const advance = char === '\t'
                    ? getTabAdvance(fontSize, currentLineWidth)
                    : getSpaceAdvance(fontSize);
                const newWidth = currentLineWidth + advance;
                if (!field.autoWidth && newWidth > maxWidth && currentLineWidth > 0) {
                    maxLineWidth = Math.max(maxLineWidth, currentLineWidth);
                    currentLineWidth = 0;
                    lines++;
                    if (char === '\t') {
                        currentLineWidth += getTabAdvance(fontSize, currentLineWidth);
                    }
                } else {
                    currentLineWidth = newWidth;
                }
                i++;
                continue;
            }

            let wordWidth = 0;
            let j = i;
            while (j < field.text.length && !isWordBreakChar(field.text[j])) {
                wordWidth += getCharAdvance(fontSize, field.text[j]);
                j++;
            }

            if (!field.autoWidth && currentLineWidth + wordWidth > maxWidth && currentLineWidth > 0) {
                maxLineWidth = Math.max(maxLineWidth, currentLineWidth);
                currentLineWidth = wordWidth;
                lines++;
            } else {
                currentLineWidth += wordWidth;
            }

            i = j;
        }
        maxLineWidth = Math.max(maxLineWidth, currentLineWidth);

        // Calculate final dimensions
        const contentWidth = field.autoWidth ? maxLineWidth : field.width;
        const width = Math.max(contentWidth, MIN_BOX_WIDTH);
        const height = Math.max(lineHeightPx * lines, fontSize) + settings.boxPaddingY * 2;

        const bounds = {
            x: field.x,
            y: field.y,
            width: width + settings.boxPaddingX * 2,
            height: height
        };
        field._boundsCacheKey = boundsKey;
        field._boundsCache = bounds;
        return bounds;
    }

    /**
     * Word-wrap text to fit within field width (never cuts words)
     */
    function wrapText(field) {
        if (field.autoWidth) return [field.text]; // No wrapping needed

        const fontSize = field.fontSize || settings.fontSize;
        const maxWidth = field.width;

        const lines = [];
        let currentLine = '';
        let currentWidth = 0;

        // Split by explicit newlines first
        const paragraphs = field.text.split('\n');

        for (let p = 0; p < paragraphs.length; p++) {
            currentLine = '';
            currentWidth = 0;

            let i = 0;
            while (i < paragraphs[p].length) {
                const char = paragraphs[p][i];

                if (char === ' ' || char === '\t') {
                    const advance = char === '\t'
                        ? getTabAdvance(fontSize, currentWidth)
                        : getSpaceAdvance(fontSize);
                    if (currentWidth + advance > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = '';
                        currentWidth = 0;
                        if (char === '\t') {
                            currentLine += '\t';
                            currentWidth += getTabAdvance(fontSize, currentWidth);
                        }
                    } else {
                        currentLine += char;
                        currentWidth += advance;
                    }
                    i++;
                    continue;
                }

                let word = '';
                let wordWidth = 0;
                while (i < paragraphs[p].length && !isWordBreakChar(paragraphs[p][i])) {
                    const c = paragraphs[p][i];
                    word += c;
                    wordWidth += getCharAdvance(fontSize, c);
                    i++;
                }

                if (currentWidth + wordWidth > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                    currentWidth = wordWidth;
                } else {
                    currentLine += word;
                    currentWidth += wordWidth;
                }
            }

            lines.push(currentLine);
        }

        return lines;
    }

    /**
     * Get resize handle at position (returns handle name or null)
     */
    function getResizeHandleAt(canvasX, canvasY, field) {
        if (!field) return null;

        const bounds = getFieldBounds(field);
        const currentZoom = window.zoom || 1;
        const handleSize = HANDLE_SIZE / currentZoom;
        const hitArea = handleSize * 2; // Larger hit area for touch

        // Right edge handle (for width resize) - entire right edge
        const rightX = bounds.x + bounds.width;

        if (canvasX >= rightX - hitArea && canvasX <= rightX + hitArea &&
            canvasY >= bounds.y && canvasY <= bounds.y + bounds.height) {
            return 'right';
        }

        // Bottom edge handle (for height - future use)
        // const bottomY = bounds.y + bounds.height;

        return null;
    }

    /**
     * Handle canvas click - create or select text field (called by external tool selection)
     */
    function handleCanvasClick(screenX, screenY) {
        const currentZoom = window.zoom || 1;
        const currentPanX = window.panX || 0;
        const currentPanY = window.panY || 0;

        const canvasX = (screenX - currentPanX) / currentZoom;
        const canvasY = (screenY - currentPanY) / currentZoom;

        // If we have an active field, the pointer events will handle it
        if (activeField) {
            return false; // Let pointer events handle
        }

        // Check if clicking existing field
        const existingField = getFieldAtPosition(canvasX, canvasY);
        if (existingField) {
            activeField = existingField;
            activeField.cursorPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
            startCursorBlink();
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        // Create new field
        createTextField(canvasX, canvasY);
        return true;
    }

    /**
     * Deselect text field but keep it editable
     */
    function commitAndDeselect() {
        if (activeField && activeField.text.length === 0) {
            textFields = textFields.filter(f => f.id !== activeField.id);
        }
        activeField = null;
        stopCursorBlink();
        toggleSettingsPanel(false);
        if (typeof redrawCanvas === 'function') redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    /**
     * Get cursor position for click location
     */
    function getCursorPosAtPoint(field, clickX, clickY) {
        const fontSize = field.fontSize || settings.fontSize;
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const lineHeightPx = getLineHeightPx(fontSize);

        // Determine which line was clicked
        const relY = clickY - field.y;
        const lineIndex = Math.floor(relY / lineHeightPx);

        // Find position in text
        let currentLine = 0;
        let cursorX = field.x;
        let pos = 0;

        for (let i = 0; i < field.text.length; i++) {
            const char = field.text[i];
            const jitter = getCharRandomness(field, i);

            if (currentLine === lineIndex) {
                // Check if click is before this character
                if (char === ' ') {
                    const charMid = cursorX + jitter.dx + getSpaceAdvance(fontSize) / 2;
                    if (clickX < charMid) {
                        return i;
                    }
                } else if (char === '\t') {
                    const tabWidth = getTabAdvance(fontSize, cursorX - field.x);
                    const charMid = cursorX + tabWidth / 2;
                    if (clickX < charMid) {
                        return i;
                    }
                } else {
                    const metrics = getGlyphMetrics(char);
                    const glyphWidth = Math.max(charWidth * metrics.width, charWidth * settings.minGlyphWidth);
                    const baseX = cursorX - getCharOffset(fontSize, char) + jitter.dx;
                    const charMid = baseX + glyphWidth / 2;
                    if (clickX < charMid) {
                        return i;
                    }
                }
            }

            if (char === '\n') {
                if (currentLine === lineIndex) {
                    return i;
                }
                currentLine++;
                cursorX = field.x;
            } else if (char === ' ') {
                cursorX += getSpaceAdvance(fontSize) + jitter.spacing * charWidth;
            } else if (char === '\t') {
                cursorX += getTabAdvance(fontSize, cursorX - field.x);
            } else {
                cursorX += getCharAdvance(fontSize, char) + jitter.spacing * charWidth;
            }
            pos = i + 1;
        }

        return pos;
    }

    /**
     * Deselect active field
     */
    function deselect() {
        if (activeField) {
            // Remove empty fields
            if (activeField.text.length === 0) {
                textFields = textFields.filter(f => f.id !== activeField.id);
            }
        }
        activeField = null;
        stopCursorBlink();
        toggleSettingsPanel(false);
        redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    /**
     * Convert text field to permanent strokes
     */
    function commitFieldToStrokes(field) {
        if (!fontData || !field.text) return;

        const renderedStrokes = renderTextAsStrokes(field.text, field.x, field.y, {
            fontSize: field.fontSize,
            color: field.color,
            maxWidth: field.autoWidth ? Infinity : field.width
        });

        // Add to page strokes
        for (const stroke of renderedStrokes) {
            stroke.id = Date.now() + Math.random();
            strokes.push(stroke);
        }

        // Invalidate stroke cache after adding strokes
        if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();

        // Save the page
        if (typeof saveCurrentPage === 'function') saveCurrentPage();
    }

    /**
     * Render text as stroke objects (with proper word wrapping)
     */
    function renderTextAsStrokes(text, startX, startY, options = {}) {
        const fontSize = options.fontSize || settings.fontSize;
        const color = options.color || '#ffffff';
        const maxWidth = options.maxWidth || Infinity;

        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const charHeight = fontSize;
        const lineHeightPx = getLineHeightPx(fontSize);

        const allStrokes = [];
        let cursorX = startX;
        let cursorY = startY;
        let charIndex = 0;

        // Helper to measure word width
        const measureWord = (txt, startIdx) => {
            let width = 0;
            let i = startIdx;
            while (i < txt.length && !isWordBreakChar(txt[i])) {
                width += getCharAdvance(fontSize, txt[i]);
                i++;
            }
            return { width, endIdx: i };
        };

        // Process text character by character with word wrapping
        let i = 0;
        while (i < text.length) {
            const char = text[i];
            const jitter = getCharRandomness({ id: 0 }, i);

            // Handle newline
            if (char === '\n') {
                cursorX = startX;
                cursorY += lineHeightPx;
                i++;
                charIndex++;
                continue;
            }

            // Handle space
            if (char === ' ') {
                // Skip space at start of line
                if (cursorX === startX) {
                    i++;
                    charIndex++;
                    continue;
                }
                cursorX += getSpaceAdvance(fontSize);
                i++;
                charIndex++;
                continue;
            }

            if (char === '\t') {
                cursorX += getTabAdvance(fontSize, cursorX - startX);
                i++;
                charIndex++;
                continue;
            }

            // For a regular character, check if the WHOLE word fits
            if (maxWidth !== Infinity && isWordStartAt(text, i)) {
                const wordInfo = measureWord(text, i);
                const lineWidth = cursorX - startX + wordInfo.width;

                // If word doesn't fit and we're not at start of line, wrap first
                if (lineWidth > maxWidth && cursorX > startX) {
                    cursorX = startX;
                    cursorY += lineHeightPx;
                }
            }

            // Draw character using font data
            const charData = fontData.characters[char];
            if (charData) {
                const nonEmpty = getUsableVariants(charData.variants);

                if (nonEmpty.length > 0) {
                    const variantIdx = getVariantIndex({ id: 0 }, i, nonEmpty.length);
                    const variant = nonEmpty[variantIdx];
                    const baseX = cursorX - getCharOffset(fontSize, char) + jitter.dx;
                    const baseY = cursorY + jitter.dy;
                    const rotCenterX = baseX + charWidth * 0.5;
                    const rotCenterY = baseY + charHeight * 0.5;
                    const cosR = Math.cos(jitter.rot);
                    const sinR = Math.sin(jitter.rot);

                    // Transform and add strokes
                    for (const stroke of variant.strokes) {
                        const transformedPoints = stroke.points.map(pt => ({
                            x: (() => {
                                const rawX = baseX + pt.x * charWidth;
                                const rawY = baseY + pt.y * charHeight;
                                const dx = rawX - rotCenterX;
                                const dy = rawY - rotCenterY;
                                return rotCenterX + dx * cosR - dy * sinR;
                            })(),
                            y: (() => {
                                const rawX = baseX + pt.x * charWidth;
                                const rawY = baseY + pt.y * charHeight;
                                const dx = rawX - rotCenterX;
                                const dy = rawY - rotCenterY;
                                return rotCenterY + dx * sinR + dy * cosR;
                            })(),
                            pressure: pt.pressure,
                            size: settings.strokeThickness
                        }));

                        allStrokes.push({
                            points: transformedPoints,
                            color: color,
                            size: settings.strokeThickness,
                            tool: 'pen'
                        });
                    }
                }
            }

            cursorX += getCharAdvance(fontSize, char) + jitter.spacing * charWidth;
            i++;
            charIndex++;
        }

        return allStrokes;
    }

    /**
     * Handle keyboard input
     */
    function handleKeyDown(e) {
        if (!activeField) return;
        if(e.target instanceof Element&&e.target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"],[role="button"]'))return;

        // Ctrl+A - Select all
        if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            activeField.selectionStart = 0;
            activeField.selectionEnd = activeField.text.length;
            activeField.cursorPos = activeField.text.length;
            redrawCanvas();
            return;
        }

        // Ctrl+C - Copy
        if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            const text = hasSelection() ? getSelectedText() : activeField.text;
            if (text) {
                navigator.clipboard.writeText(text).catch(() => {
                    // Fallback for older browsers
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                });
            }
            return;
        }

        // Ctrl+X - Cut
        if (e.key === 'x' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (hasSelection()) {
                const text = getSelectedText();
                if (text) {
                    navigator.clipboard.writeText(text).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    });
                    deleteSelection();
                    redrawCanvas();
                    if (typeof triggerAutoSave === 'function') triggerAutoSave();
                }
            }
            return;
        }

        // Ctrl+Backspace - Delete word
        if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (activeField.cursorPos > 0) {
                // Find start of previous word
                let pos = activeField.cursorPos - 1;
                // Skip trailing spaces
                while (pos > 0 && /\s/.test(activeField.text[pos])) pos--;
                // Skip word characters
                while (pos > 0 && !/\s/.test(activeField.text[pos - 1])) pos--;

                activeField.text =
                    activeField.text.slice(0, pos) +
                    activeField.text.slice(activeField.cursorPos);
                activeField.cursorPos = pos;
                clearSelection();
                redrawCanvas();
            }
            return;
        }

        // Ctrl+Delete - Delete word forward
        if (e.key === 'Delete' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (activeField.cursorPos < activeField.text.length) {
                let pos = activeField.cursorPos;
                // Skip leading spaces
                while (pos < activeField.text.length && /\s/.test(activeField.text[pos])) pos++;
                // Skip word characters
                while (pos < activeField.text.length && !/\s/.test(activeField.text[pos])) pos++;

                activeField.text =
                    activeField.text.slice(0, activeField.cursorPos) +
                    activeField.text.slice(pos);
                clearSelection();
                redrawCanvas();
            }
            return;
        }

        if (e.key === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            // Delete selection if any
            if (hasSelection()) {
                deleteSelection();
            } else if (activeField.cursorPos > 0) {
                activeField.text =
                    activeField.text.slice(0, activeField.cursorPos - 1) +
                    activeField.text.slice(activeField.cursorPos);
                if (activeField.charColors && activeField.charColors.length >= activeField.cursorPos) {
                    activeField.charColors.splice(activeField.cursorPos - 1, 1);
                }
                activeField.cursorPos--;
            }
            redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            if (hasSelection()) {
                deleteSelection();
            } else if (activeField.cursorPos < activeField.text.length) {
                activeField.text =
                    activeField.text.slice(0, activeField.cursorPos) +
                    activeField.text.slice(activeField.cursorPos + 1);
                if (activeField.charColors && activeField.charColors.length > activeField.cursorPos) {
                    activeField.charColors.splice(activeField.cursorPos, 1);
                }
            }
            redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        } else if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            // Move to start of line
            let pos = activeField.cursorPos;
            while (pos > 0 && activeField.text[pos - 1] !== '\n') pos--;
            updateSelectionOnMove(pos, e.shiftKey);
            redrawCanvas();
        } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            // Move to end of line
            let pos = activeField.cursorPos;
            while (pos < activeField.text.length && activeField.text[pos] !== '\n') pos++;
            updateSelectionOnMove(pos, e.shiftKey);
            redrawCanvas();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
                // Move by word
                let pos = activeField.cursorPos - 1;
                while (pos > 0 && /\s/.test(activeField.text[pos])) pos--;
                while (pos > 0 && !/\s/.test(activeField.text[pos - 1])) pos--;
                updateSelectionOnMove(Math.max(0, pos), e.shiftKey);
            } else if (activeField.cursorPos > 0) {
                updateSelectionOnMove(activeField.cursorPos - 1, e.shiftKey);
            }
            redrawCanvas();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
                // Move by word
                let pos = activeField.cursorPos;
                while (pos < activeField.text.length && /\s/.test(activeField.text[pos])) pos++;
                while (pos < activeField.text.length && !/\s/.test(activeField.text[pos])) pos++;
                updateSelectionOnMove(pos, e.shiftKey);
            } else if (activeField.cursorPos < activeField.text.length) {
                updateSelectionOnMove(activeField.cursorPos + 1, e.shiftKey);
            }
            redrawCanvas();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            moveCursorVertically(-1, e.shiftKey);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            moveCursorVertically(1, e.shiftKey);
        } else if (e.key === 'Enter') {
            // ALT+ENTER: Solve Math (Local JS Evaluation)
            if (e.altKey && !e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();

                // Extract math expression from current line
                let lineStart = activeField.cursorPos;
                const txt = activeField.text;
                while (lineStart > 0 && txt[lineStart - 1] !== '\n') lineStart--;

                let lineEnd = activeField.cursorPos;
                while (lineEnd < txt.length && txt[lineEnd] !== '\n') lineEnd++;

                const currentLineRaw = txt.slice(lineStart, lineEnd);

                let solvedResult = null;
                let insertionText = '';

                // NEW LOGIC: Context-aware solving
                if (typeof MathSolver !== 'undefined' && MathSolver.solveContext) {
                    // 1. Get previous lines in the same block
                    const textBefore = txt.slice(0, lineStart);
                    const prevLines = textBefore.split('\n');
                    const contextLines = [];

                    // Walk backwards to gather non-empty lines
                    for (let i = prevLines.length - 1; i >= 0; i--) {
                        const l = prevLines[i].trim();
                        if (!l) {
                            if (contextLines.length > 0) break; // Stop at empty line gap
                            continue; // Skip trailing empty lines
                        }
                        contextLines.unshift(l);
                    }

                    // 2. Add current line (cleaned of trailing '=')
                    const cleanCurrent = currentLineRaw.trim().replace(/=$/, '');
                    if (cleanCurrent) {
                        contextLines.push(cleanCurrent); // Add current line to context

                        // 3. Solve
                        const result = MathSolver.solveContext(contextLines);
                        if (result && result.lastResult) {
                            solvedResult = result.lastResult;
                            insertionText = (currentLineRaw.trim().endsWith('=') ? ' ' : ' = ') + solvedResult;
                        }
                    }
                }

                // Fallback: Single line simple math (if context solver didn't work)
                if (!solvedResult) {
                     // Remove existing equals sign at the end if present
                    const cleanExpr = currentLineRaw.replace(/=$/, '').trim();

                    if (cleanExpr) {
                        try {
                            // Safe basic JS fallback
                            if (!/^[0-9+\-*/().%\s^]+$/.test(cleanExpr) && !cleanExpr.startsWith('Math.')) {
                                // unsafe
                            } else {
                                const jsExpr = cleanExpr.replace(/\^/g, '**');
                                const result = new Function('return ' + jsExpr)();
                                if (result !== undefined && !isNaN(result)) {
                                    const resultStr = parseFloat(result.toFixed(4)).toString();
                                    solvedResult = resultStr;
                                    insertionText = (currentLineRaw.trim().endsWith('=') ? ' ' : ' = ') + resultStr;
                                }
                            }
                        } catch (err) {}
                    }
                }

                // Apply changes
                if (solvedResult) {
                    activeField.text =
                        activeField.text.slice(0, lineEnd) +
                        insertionText +
                        activeField.text.slice(lineEnd);

                    activeField.cursorPos = lineEnd + insertionText.length;
                    startTextAnimation(activeField, lineEnd, insertionText.length);
                    redrawCanvas();
                }
                return;
            }

            // Skip if Ctrl is pressed (AI shortcut) or AI modal is open
            if (e.ctrlKey) return;
            const aiModal = document.getElementById('ai-response-modal');
            if (aiModal && aiModal.classList.contains('visible')) return;
            e.preventDefault();
            e.stopPropagation();
            // Delete selection first if any
            if (hasSelection()) deleteSelection();
            const insertAt = activeField.cursorPos;
            activeField.text =
                activeField.text.slice(0, activeField.cursorPos) +
                '\n' +
                activeField.text.slice(activeField.cursorPos);
            activeField.cursorPos++;
            startTextAnimation(activeField, insertAt, 1);
            redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            if (hasSelection()) {
                deleteSelection();
            }
            const insertAt = activeField.cursorPos;
            activeField.text =
                activeField.text.slice(0, activeField.cursorPos) +
                '\t' +
                activeField.text.slice(activeField.cursorPos);
            if (!activeField.charColors) activeField.charColors = [];
            const insertColors = [activeField.color || currentColor || '#ffffff'];
            activeField.charColors.splice(activeField.cursorPos, 0, ...insertColors);
            activeField.cursorPos += 1;
            startTextAnimation(activeField, insertAt, 1);
            redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (activeField.text.length === 0) {
                textFields = textFields.filter(f => f.id !== activeField.id);
            }
            deselect();
        }
    }

    function getTabInsertionText() {
        return '\t';
    }

    // Selection helper functions
    function hasSelection() {
        return activeField &&
               activeField.selectionStart !== undefined &&
               activeField.selectionEnd !== undefined &&
               activeField.selectionStart !== activeField.selectionEnd;
    }

    function clearSelection() {
        if (activeField) {
            activeField.selectionStart = undefined;
            activeField.selectionEnd = undefined;
        }
    }

    function deleteSelection() {
        if (!hasSelection()) return;
        const start = Math.min(activeField.selectionStart, activeField.selectionEnd);
        const end = Math.max(activeField.selectionStart, activeField.selectionEnd);
        activeField.text = activeField.text.slice(0, start) + activeField.text.slice(end);
        if (activeField.charColors && activeField.charColors.length >= end) {
            activeField.charColors.splice(start, end - start);
        }
        activeField.cursorPos = start;
        clearSelection();
    }

    function getSelectedText() {
        if (!hasSelection()) return '';
        const start = Math.min(activeField.selectionStart, activeField.selectionEnd);
        const end = Math.max(activeField.selectionStart, activeField.selectionEnd);
        return activeField.text.slice(start, end);
    }

    /**
     * Move cursor up or down by lines
     */
    function moveCursorVertically(direction, extendSelection = false) {
        if (!activeField) return;

        // Find current line and column
        let line = 0;
        let col = 0;
        for (let i = 0; i < activeField.cursorPos; i++) {
            if (activeField.text[i] === '\n') {
                line++;
                col = 0;
            } else {
                col++;
            }
        }

        // Find target line
        const targetLine = Math.max(0, line + direction);

        // Find position in target line
        let currentLine = 0;
        let currentCol = 0;
        let newPos = 0;

        for (let i = 0; i <= activeField.text.length; i++) {
            if (currentLine === targetLine && currentCol === col) {
                newPos = i;
                break;
            }
            if (i < activeField.text.length && activeField.text[i] === '\n') {
                if (currentLine === targetLine) {
                    newPos = i; // End of target line
                    break;
                }
                currentLine++;
                currentCol = 0;
            } else {
                currentCol++;
            }
            if (i === activeField.text.length) {
                newPos = i;
            }
        }

        updateSelectionOnMove(newPos, extendSelection);
        redrawCanvas();
    }

    function updateSelectionOnMove(newPos, extendSelection) {
        if (!activeField) return;
        if (extendSelection) {
            if (activeField.selectionStart === undefined || activeField.selectionEnd === undefined) {
                activeField.selectionStart = activeField.cursorPos;
                activeField.selectionEnd = newPos;
            } else {
                activeField.selectionEnd = newPos;
            }
        } else {
            clearSelection();
        }
        activeField.cursorPos = newPos;
    }

    /**
     * Handle paste event
     */
    function handlePaste(e) {
        if (!activeField) return;
        if(e.target instanceof Element&&e.target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"],[role="button"]'))return;

        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;

        // Filter to supported characters only
        let filteredText = '';
        const supported = fontData ? Object.keys(fontData.characters) : [];

        for (const char of text) {
            if (char === '\n' || char === ' ' || char === '\t') {
                filteredText += char;
            } else if (supported.length === 0 || supported.includes(char)) {
                filteredText += char;
            }
            // Skip unsupported characters silently
        }

        // Insert at cursor
        const insertAt = activeField.cursorPos;
        activeField.text =
            activeField.text.slice(0, activeField.cursorPos) +
            filteredText +
            activeField.text.slice(activeField.cursorPos);
        if (!activeField.charColors) activeField.charColors = [];
        const insertColors = new Array(filteredText.length).fill(activeField.color || currentColor || '#ffffff');
        activeField.charColors.splice(activeField.cursorPos, 0, ...insertColors);
        activeField.cursorPos += filteredText.length;
        startTextAnimation(activeField, insertAt, filteredText.length);

        redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    /**
     * Handle character input
     */
    function handleKeyPress(e) {
        if (!activeField) return;
        if(e.target instanceof Element&&e.target.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"],[role="button"]'))return;
        if (e.ctrlKey || e.metaKey) return;

        const char = e.key;
        if (char.length !== 1) return;

        e.preventDefault();
        e.stopPropagation();

        // Delete selection first if typing
        if (hasSelection()) {
            deleteSelection();
        }
        const insertAt = activeField.cursorPos;
        activeField.text =
            activeField.text.slice(0, activeField.cursorPos) +
            char +
            activeField.text.slice(activeField.cursorPos);
        if (!activeField.charColors) activeField.charColors = [];
        activeField.charColors.splice(activeField.cursorPos, 0, activeField.color || currentColor || '#ffffff');
        activeField.cursorPos++;
        startTextAnimation(activeField, insertAt, 1);
        redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    // --- Performance Caching System ---

    function getFieldHash(field, isDark) {
        // Create a unique signature for the visual state of the field
        // Include properties that affect rendering layout or appearance
        // Camera zoom does not change layout/glyph identity. Keep one detailed
        // source while zooming out instead of rebuilding at quarter-zoom steps.
        return [
            field.text,
            field.fontSize,
            field.color,
            field.width,
            field.autoWidth,
            settings.spaceWidth,
            settings.letterSpacing,
            settings.lineHeight,
            settings.minGlyphWidth,
            settings.strokeThickness,
            settings.randomness,
            isDark,
            (field.charColors ? field.charColors.join(',') : '')
        ].join('|');
    }

    function updateFieldCache(field,requestedDensity) {
        if (!fontData) return;

        // 1. Setup Canvas
        if (!field.cacheCanvas) {
            field.cacheCanvas = document.createElement('canvas');
            field.cursorMap = []; // Maps char index to {x, y}
        }

        // Measure layout first to determine canvas size
        // We reuse the drawing logic but just for measurement first?
        // Or we can just use a dynamic canvas that grows?
        // Let's do a two-pass approach: Measure, then Draw.

        const fontSize = field.fontSize || settings.fontSize;
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const charHeight = fontSize;
        const lineHeightPx = getLineHeightPx(fontSize);
        const maxWidth = field.autoWidth ? Infinity : field.width;

        // Simulation variables
        let cursorX = 0; // Relative to field
        let cursorY = 0;
        let canvasWidth = field.width; // Start with at least base width
        let canvasHeight = lineHeightPx;

        // Reset map
        field.cursorMap = new Array(field.text.length + 1);

        // Helper to measure word width (duplicated logic, but crucial for consistency)
        const measureWord = (text, startIdx) => {
            let width = 0;
            let i = startIdx;
            while (i < text.length && !isWordBreakChar(text[i])) {
                width += getCharAdvance(fontSize, text[i]);
                i++;
            }
            return { width, endIdx: i };
        };

        // --- PASS 1: Layout & Measurement ---
        let i = 0;
        while (i < field.text.length) {
            // Save cursor pos for this char
            field.cursorMap[i] = { x: cursorX, y: cursorY };

            const char = field.text[i];

            if (char === '\n') {
                cursorX = 0;
                cursorY += lineHeightPx;
                canvasHeight = Math.max(canvasHeight, cursorY + lineHeightPx);
                i++;
                continue;
            }

            if (char === ' ') {
                if (cursorX === 0) { // wrapped/start line space skip
                     field.cursorMap[i] = { x: cursorX, y: cursorY };
                     i++;
                     continue;
                }
                cursorX += getSpaceAdvance(fontSize);
                canvasWidth = Math.max(canvasWidth, cursorX);
                i++;
                continue;
            }

            if (char === '\t') {
                cursorX += getTabAdvance(fontSize, cursorX);
                canvasWidth = Math.max(canvasWidth, cursorX);
                i++;
                continue;
            }

            // Word wrap check
            if (!field.autoWidth && isWordStartAt(field.text, i)) {
                const wordInfo = measureWord(field.text, i);
                const lineWidth = cursorX + wordInfo.width;
                if (lineWidth > maxWidth && cursorX > 0) {
                    cursorX = 0;
                    cursorY += lineHeightPx;
                    canvasHeight = Math.max(canvasHeight, cursorY + lineHeightPx);
                    // Update this char's position to new line
                    field.cursorMap[i] = { x: cursorX, y: cursorY };
                }
            }

            const advance = getCharAdvance(fontSize, char);
            // We need extra padding for handwriting imperfections/jitter
            const jitterSpacing = (getCharRandomness(field, i).spacing || 0) * charWidth;

            cursorX += advance + jitterSpacing;
            canvasWidth = Math.max(canvasWidth, cursorX);
            i++;
        }
        // End cursor pos
        field.cursorMap[field.text.length] = { x: cursorX, y: cursorY };

        // Add padding for messy handwriting (ascenders/descenders/jitter)
        const PADDING = fontSize * 0.5;

        // Resize Cache Canvas
        // Grow sampling density in power-of-two buckets, with headroom, and
        // never shrink a valid glyph source during a pinch or after release.
        const dpr = window.devicePixelRatio || 1;
        // Cap cacheScale to prevent OOM on very high zoom
        const maxCacheDim = 8192,maxCachePixels=16*1024*1024;
        const logicalW = Math.max(canvasWidth, field.width) + PADDING * 2;
        const logicalH = canvasHeight + PADDING * 2;
        const idealScale = Math.max(dpr,2**Math.ceil(Math.log2(Math.max(.01,requestedDensity||dpr)*1.75)));
        // Long, narrow fields can retain more detail without allocating a
        // huge square texture. Keep both an axis and a total-pixel budget.
        const maxScale = Math.min(maxCacheDim / Math.max(logicalW, logicalH, 1),Math.sqrt(maxCachePixels/Math.max(1,logicalW*logicalH)));
        const cacheScale = Math.min(idealScale, maxScale);
        Object.defineProperty(field,'cacheMaxScale',{value:maxScale,writable:true,configurable:true});
        invalidateBitmapSampling(field.cacheCanvas);

        field.cacheCanvas.width = Math.ceil(logicalW * cacheScale);
        field.cacheCanvas.height = Math.ceil(logicalH * cacheScale);
        field.cachePadding = PADDING; // Store this offset
        field.cacheScale = cacheScale; // Store for drawField

        const ctx = field.cacheCanvas.getContext('2d');
        ctx.scale(cacheScale, cacheScale);
        ctx.translate(PADDING, PADDING); // Apply padding offset

        // --- PASS 2: Drawing ---
        // Iterate again using the pre-calculated positions in cursorMap?
        // Or just re-run the loop. Re-running is safer to ensure 1:1 match with logic.

        // Actually, we can just iterate and use cursorMap[i]!
        // But need to handle variants drawing.

        for (let k = 0; k < field.text.length; k++) {
            const char = field.text[k];
            const pos = field.cursorMap[k];
            if (!pos) continue; // Should not happen

            if (char === '\n' || char === ' ' || char === '\t') continue;

            // Draw Character
            const jitter = getCharRandomness(field, k);
            const charData = fontData.characters[char];

            if (charData) {
                const nonEmpty = getUsableVariants(charData.variants);
                if (nonEmpty.length > 0) {
                    const variantIdx = getVariantIndex(field, k, nonEmpty.length);
                    const variant = nonEmpty[variantIdx];

                    const baseX = pos.x - getCharOffset(fontSize, char) + jitter.dx;
                    const baseY = pos.y + jitter.dy;

                    const rawColor = (field.charColors && field.charColors[k]) ? field.charColors[k] : field.color;
                    const charColor = (typeof getThemedColor === 'function') ? getThemedColor(rawColor) : rawColor;

                    const rotCenterX = baseX + charWidth * 0.5;
                    const rotCenterY = baseY + charHeight * 0.5;
                    const cosR = Math.cos(jitter.rot);
                    const sinR = Math.sin(jitter.rot);

                    ctx.strokeStyle = charColor;
                    ctx.lineWidth = settings.strokeThickness;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.fillStyle = charColor;

                    for (const stroke of variant.strokes) {
                         // Optimize: Batch points?
                         // Handwriting is complex, just draw normally.
                         // Since this is off-screen and only once, it's fine.
                        if (stroke.points.length === 1) {
                             const pt = stroke.points[0];
                             const rawX = baseX + pt.x * charWidth;
                             const rawY = baseY + pt.y * charHeight;
                             const dx = rawX - rotCenterX;
                             const dy = rawY - rotCenterY;
                             const px = rotCenterX + dx * cosR - dy * sinR;
                             const py = rotCenterY + dx * sinR + dy * cosR;
                             ctx.beginPath();
                             ctx.arc(px, py, Math.max(1, settings.strokeThickness / 2), 0, Math.PI * 2);
                             ctx.fill();
                        } else {
                            ctx.beginPath();
                            let first = true;
                            for (const pt of stroke.points) {
                                const rawX = baseX + pt.x * charWidth;
                                const rawY = baseY + pt.y * charHeight;
                                const dx = rawX - rotCenterX;
                                const dy = rawY - rotCenterY;
                                const px = rotCenterX + dx * cosR - dy * sinR;
                                const py = rotCenterY + dx * sinR + dy * cosR;
                                if (first) { ctx.moveTo(px, py); first = false; }
                                else { ctx.lineTo(px, py); }
                            }
                            ctx.stroke();
                        }
                    }
                }
            }
        }
    }

    /**
     * Draw all text fields on canvas
     */
    function draw(ctx) {
        if (!fontData) return;

        // Cull against this render target, not global camera/window values.
        // The same text renderer is used for differently scaled previews;
        // reading window.panX also misses the canvas's lexical camera state.
        const inverse=ctx.getTransform().inverse(),w=ctx.canvas.width,h=ctx.canvas.height;
        const corners=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>({x:inverse.a*x+inverse.c*y+inverse.e,y:inverse.b*x+inverse.d*y+inverse.f}));
        const viewLeft=Math.min(...corners.map(p=>p.x)),viewRight=Math.max(...corners.map(p=>p.x));
        const viewTop=Math.min(...corners.map(p=>p.y)),viewBottom=Math.max(...corners.map(p=>p.y));

        let needsAnimationFrame = false;
        for (const field of textFields) {
            const isActive = field === activeField;
            // Skip off-screen inactive text fields
            if (!isActive) {
                const fb = getFieldBounds(field);
                if (fb.x + fb.width < viewLeft || fb.x > viewRight ||
                    fb.y + fb.height < viewTop || fb.y > viewBottom) {
                    continue;
                }
            }
            const fieldAnimating = drawField(ctx, field, isActive,{left:viewLeft,right:viewRight,top:viewTop,bottom:viewBottom});
            if (fieldAnimating) needsAnimationFrame = true;
        }
        if (needsAnimationFrame && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                if (typeof redrawCanvas === 'function') redrawCanvas();
            });
        }
    }

    /**
     * Draw a single text field
     */
    function drawField(ctx, field, isActive,visible) {
        const bounds = getFieldBounds(field);
        const currentZoom = window.zoom || 1;
        const isDarkTheme = typeof isDarkMode !== 'undefined' ? isDarkMode : true;
        const colors=getSelectionThemePalette(),chrome=getCanvasThemePalette().ui;

        const now = performance.now();
        const animation = field.animation;
        const animating = animation && (now - animation.startTime) < animation.totalDuration;

        if (animation && !animating) {
            field.animation = null;
        }

        // --- SELECTION BOX & UI ---
        // (Draws border, handles, buttons)
        if (isActive) {
            ctx.save();
            // Background fill
            ctx.fillStyle = `color-mix(in srgb,${chrome.surface} 70%,transparent)`;
            ctx.beginPath();
            ctx.roundRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4, 6 / currentZoom);
            ctx.fill();

            // Border glow
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1.5 / currentZoom;
            ctx.shadowColor = `color-mix(in srgb,${colors.accent} 25%,transparent)`;
            ctx.shadowBlur = 8 / currentZoom;
            ctx.beginPath();
            ctx.roundRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4, 6 / currentZoom);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Top drag handle bar
            const dragBarHeight = 5 / currentZoom;
            ctx.fillStyle = colors.accent;
            ctx.beginPath();
            ctx.roundRect(bounds.x + bounds.width * 0.25, bounds.y - 4,
                         bounds.width * 0.5, dragBarHeight, 3 / currentZoom);
            ctx.fill();

            // Grip dots
            ctx.fillStyle = colors.surface;
            const dotSpacing = 8 / currentZoom;
            const dotY = bounds.y - 4 + dragBarHeight / 2;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.arc(bounds.x + bounds.width / 2 + i * dotSpacing, dotY, 1.5 / currentZoom, 0, Math.PI * 2);
                ctx.fill();
            }

            // Right edge resize handle
            const handleWidth = 10 / currentZoom;
            const rightX = bounds.x + bounds.width + 4;

            ctx.fillStyle = colors.accent;
            ctx.beginPath();
            ctx.roundRect(rightX - handleWidth/2, bounds.y + bounds.height/2 - 25/currentZoom,
                         handleWidth, 50/currentZoom, 4/currentZoom);
            ctx.fill();

            ctx.fillStyle = colors.surface;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.arc(rightX, bounds.y + bounds.height/2 + i * 8/currentZoom, 2/currentZoom, 0, Math.PI * 2);
                ctx.fill();
            }

            // Toolbar Buttons
            const btnSize = 40 / currentZoom;
            const btnSpacing = 8 / currentZoom;
            const btnMargin = 15 / currentZoom;
            const toolbarX = rightX + btnMargin;
            const toolbarY = bounds.y;

            // Apply
            ctx.fillStyle = chrome.action;
            ctx.beginPath();
            ctx.roundRect(toolbarX, toolbarY, btnSize, btnSize, 6 / currentZoom);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3 / currentZoom;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(toolbarX + btnSize * 0.22, toolbarY + btnSize * 0.5);
            ctx.lineTo(toolbarX + btnSize * 0.42, toolbarY + btnSize * 0.72);
            ctx.lineTo(toolbarX + btnSize * 0.78, toolbarY + btnSize * 0.28);
            ctx.stroke();

            // Cancel
            const cancelY = toolbarY + btnSize + btnSpacing;
            ctx.fillStyle = chrome.surface;
            ctx.beginPath();
            ctx.roundRect(toolbarX, cancelY, btnSize, btnSize, 6 / currentZoom);
            ctx.fill();
            ctx.strokeStyle = chrome.error;
            ctx.lineWidth = 3 / currentZoom;
            ctx.beginPath();
            ctx.moveTo(toolbarX + btnSize * 0.28, cancelY + btnSize * 0.28);
            ctx.lineTo(toolbarX + btnSize * 0.72, cancelY + btnSize * 0.72);
            ctx.moveTo(toolbarX + btnSize * 0.72, cancelY + btnSize * 0.28);
            ctx.lineTo(toolbarX + btnSize * 0.28, cancelY + btnSize * 0.72);
            ctx.stroke();

            // Settings
            const settingsY = cancelY + btnSize + btnSpacing;
            ctx.fillStyle = settingsPanelVisible ? chrome.action : chrome.surface;
            ctx.beginPath();
            ctx.roundRect(toolbarX, settingsY, btnSize, btnSize, 6 / currentZoom);
            ctx.fill();
            ctx.strokeStyle = settingsPanelVisible ? '#ffffff' : chrome.text;
            ctx.lineWidth = 2 / currentZoom;
            const gearCX = toolbarX + btnSize / 2;
            const gearCY = settingsY + btnSize / 2;
            const gearR = btnSize * 0.25;
            ctx.beginPath();
            ctx.arc(gearCX, gearCY, gearR * 0.5, 0, Math.PI * 2);
            ctx.stroke();
            for (let t = 0; t < 6; t++) {
                const angle = (t / 6) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(gearCX + Math.cos(angle) * gearR * 0.7, gearCY + Math.sin(angle) * gearR * 0.7);
                ctx.lineTo(gearCX + Math.cos(angle) * gearR * 1.3, gearCY + Math.sin(angle) * gearR * 1.3);
                ctx.stroke();
            }

            activeField._btnApply = { x: toolbarX, y: toolbarY, size: btnSize };
            activeField._btnCancel = { x: toolbarX, y: cancelY, size: btnSize };
            activeField._btnSettings = { x: toolbarX, y: settingsY, size: btnSize };
            activeField._btnZoom = currentZoom;
            activeField._rightEdge = rightX;

            ctx.restore();
        }

        // --- TEXT RENDERING (CACHED) ---
        // If animating, fallback to slow path. Cache everything else.
        if (animating) {
             return drawFieldLegacy(ctx, field, isActive, now, animation);
        } else {
             // 1. Check/Update Cache
             const hash = getFieldHash(field, isDarkTheme);
             const matrix=ctx.getTransform(),density=Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d));
             const needsDetail=field.cacheScale<density&&field.cacheScale<(field.cacheMaxScale||Infinity)*.999;
             if (field.lastHash !== hash || !field.cacheCanvas || needsDetail) {
                 updateFieldCache(field,density);
                 field.lastHash = hash;
             }

             const fontSize = field.fontSize || settings.fontSize;
             const charHeight = fontSize;
             const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);

             // 2. Draw Cached Text
             if (field.cacheCanvas) {
                 const padding = field.cachePadding || 0;
                 // Draw the cache at the correct offset (applying the padding shift backwards)
                 // field.x/y is where the text starts.
                 // The cache includes `padding` around it.
                 // So we draw at field.x - padding, field.y - padding.
                 // The cache size matches (width + 2*padding) / dpr.

                 const cs = field.cacheScale || (window.devicePixelRatio || 1);
                 const destW = field.cacheCanvas.width / cs;
                 const destH = field.cacheCanvas.height / cs;

                 if(density>cs*1.15){
                     // Never enlarge an under-resolved glyph texture after
                     // reaching its memory budget. Draw only visible glyphs
                     // natively; retain the cache for fast, filtered zoom-out.
                     drawFieldLegacy(ctx,field,false,0,{fromIndex:Infinity},visible);
                 }else{
                     drawFilteredBitmap(ctx,field.cacheCanvas, field.x - padding, field.y - padding, destW, destH);
                 }
             }

             // 3. Draw Selection (Dynamic)
             // Using pre-calculated cursor positions from updateFieldCache!
             if (isActive && hasSelection() && field.cursorMap) {
                 const start = Math.min(field.selectionStart, field.selectionEnd);
                 const end = Math.max(field.selectionStart, field.selectionEnd);
                 const advance = getCharAdvance(fontSize, 'M'); // approx

                 ctx.save();
                 ctx.fillStyle = `color-mix(in srgb,${colors.accent} 22%,transparent)`;

                 // Batch rects logic? Or just simple loop.
                 for (let i = start; i < end; i++) {
                     const pos = field.cursorMap[i];
                     if (pos) {
                         const nextPos = field.cursorMap[i+1];
                         // Determine width: usually dist to next char, or fallback
                         // Handle newlines: don't draw rect to 0
                         if (field.text[i] === '\n') continue;

                         let w;
                         if (nextPos && nextPos.y === pos.y && nextPos.x > pos.x) {
                             w = nextPos.x - pos.x;
                         } else {
                             w = getCharAdvance(fontSize, field.text[i]);
                         }

                         ctx.fillRect(field.x + pos.x, field.y + pos.y, w, charHeight);
                     }
                 }
                 ctx.restore();
             }

             // 4. Draw Cursor
             if (isActive && cursorVisible && field.cursorMap) {
                 // Use map if available, else fallback
                 let pos = field.cursorMap[field.cursorPos];
                 if (!pos) {
                     // Maybe at very end?
                     if (field.cursorPos >= field.cursorMap.length) {
                        pos = field.cursorMap[field.cursorMap.length - 1]; // Should be EOF pos
                     }
                 }

                 if (pos) {
                     drawCursor(ctx, field.x + pos.x, field.y + pos.y, charHeight);
                 }
             }

             return false;
        }
    }

    /**
     * Legacy slow drawing method used ONLY for animations
     */
     function drawFieldLegacy(ctx, field, isActive, now, animation,clip) {
        const fontSize = field.fontSize || settings.fontSize;
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const charHeight = fontSize;
        const lineHeightPx = getLineHeightPx(fontSize);
        const maxWidth = field.autoWidth ? Infinity : field.width;

        let cursorX = field.x;
        let cursorY = field.y;

        const measureWord = (text, startIdx) => {
            let width = 0;
            let i = startIdx;
            while (i < text.length && !isWordBreakChar(text[i])) {
                width += getCharAdvance(fontSize, text[i]);
                i++;
            }
            return { width, endIdx: i };
        };

        let i = 0;
        let animating = false;

        while (i < field.text.length) {
            const char = field.text[i];
            const jitter = getCharRandomness(field, i);

            if (isActive && i === field.cursorPos && cursorVisible) {
                drawCursor(ctx, cursorX, cursorY, charHeight);
            }

            if (char === '\n') {
                cursorX = field.x;
                cursorY += lineHeightPx;
                i++;
                continue;
            }

            if (char === ' ') {
                if (cursorX === field.x) { i++; continue; }
                cursorX += getSpaceAdvance(fontSize);
                i++;
                continue;
            }

            if (char === '\t') {
                cursorX += getTabAdvance(fontSize, cursorX - field.x);
                i++;
                continue;
            }

            if (!field.autoWidth && isWordStartAt(field.text, i)) {
                const wordInfo = measureWord(field.text, i);
                const lineWidth = cursorX - field.x + wordInfo.width;
                if (lineWidth > maxWidth && cursorX > field.x) {
                    cursorX = field.x;
                    cursorY += lineHeightPx;
                }
            }

            const charData = fontData.characters[char];
            if (charData&&(!clip||(cursorX+fontSize*2>=clip.left&&cursorX-fontSize<=clip.right&&cursorY+fontSize*2>=clip.top&&cursorY-fontSize<=clip.bottom))) {
                const nonEmpty = getUsableVariants(charData.variants);
                if (nonEmpty.length > 0) {
                    const variantIdx = getVariantIndex(field, i, nonEmpty.length);
                    const variant = nonEmpty[variantIdx];
                    const baseX = cursorX - getCharOffset(fontSize, char) + jitter.dx;
                    const baseY = cursorY + jitter.dy;

                    const rawColor = (field.charColors && field.charColors[i]) ? field.charColors[i] : field.color;
                    const charColor = (typeof getThemedColor === 'function') ? getThemedColor(rawColor) : rawColor;

                    const rotCenterX = baseX + charWidth * 0.5;
                    const rotCenterY = baseY + charHeight * 0.5;
                    const cosR = Math.cos(jitter.rot);
                    const sinR = Math.sin(jitter.rot);

                    let charProgress = 1;
                    if (i >= animation.fromIndex) {
                        const rel = i - animation.fromIndex;
                        const start = rel * animation.durationPerChar;
                        const end = start + animation.durationPerChar;
                        const elapsed = now - animation.startTime;
                        charProgress = Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
                        if (charProgress < 1) animating = true;
                    }

                    for (const stroke of variant.strokes) {
                        ctx.strokeStyle = charColor;
                        ctx.lineWidth = settings.strokeThickness;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';

                        if (charProgress <= 0) continue;

                        // Draw Point
                        if (stroke.points.length === 1) {
                            const pt = stroke.points[0];
                            const rawX = baseX + pt.x * charWidth;
                            const rawY = baseY + pt.y * charHeight;
                            const dx = rawX - rotCenterX;
                            const dy = rawY - rotCenterY;
                            const px = rotCenterX + dx * cosR - dy * sinR;
                            const py = rotCenterY + dx * sinR + dy * cosR;
                            ctx.beginPath();
                            ctx.arc(px, py, Math.max(1, settings.strokeThickness / 2), 0, Math.PI * 2);
                            ctx.fillStyle = charColor;
                            ctx.fill();
                        } else {
                            // Draw Stroke
                            ctx.beginPath();
                            let first = true;
                            const pointsToDraw = Math.max(2, Math.floor(stroke.points.length * charProgress));
                            for (let pIndex = 0; pIndex < pointsToDraw; pIndex++) {
                                const pt = stroke.points[pIndex];
                                const rawX = baseX + pt.x * charWidth;
                                const rawY = baseY + pt.y * charHeight;
                                const dx = rawX - rotCenterX;
                                const dy = rawY - rotCenterY;
                                const px = rotCenterX + dx * cosR - dy * sinR;
                                const py = rotCenterY + dx * sinR + dy * cosR;
                                if (first) { ctx.moveTo(px, py); first = false; }
                                else { ctx.lineTo(px, py); }
                            }
                            ctx.stroke();
                        }
                    }
                }
            }

            cursorX += getCharAdvance(fontSize, char) + jitter.spacing * charWidth;
            i++;
        }

        if (isActive && field.cursorPos === field.text.length && cursorVisible) {
            drawCursor(ctx, cursorX, cursorY, charHeight);
        }

        return animating;
    }

    /**
     * Draw text cursor
     */
    function drawPreview(ctx, fields) {
        if (!fontData) return false;
        // Use the exact glyph variants, per-character colors, spacing and
        // word-wrap logic from the live writer, without its editor UI or
        // screen-zoom raster cache. The caller supplies the preview transform.
        const completed = { fromIndex: Infinity };
        for (const field of fields || []) {
            if (!field?.text) continue;
            ctx.save();
            drawFieldLegacy(ctx, field, false, 0, completed);
            ctx.restore();
        }
        return true;
    }

    function drawCursor(ctx, x, y, height) {
        const currentZoom = window.zoom || 1;
        const isDarkTheme = typeof isDarkMode !== 'undefined' ? isDarkMode : true;
        // Use black cursor in light mode for visibility, otherwise use current color
        ctx.strokeStyle = isDarkTheme
            ? (typeof currentColor !== 'undefined' ? currentColor : '#ffffff')
            : '#000000';
        ctx.lineWidth = 2 / currentZoom;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height);
        ctx.stroke();
    }

    /**
     * Start cursor blinking
     */
    function startCursorBlink() {
        stopCursorBlink();
        cursorVisible = true;
        cursorInterval = setInterval(() => {
            if(document.hidden||window.DialogFocus?.active)return;
            cursorVisible = !cursorVisible;
            if (typeof redrawCanvas === 'function') redrawCanvas();
        }, 530);
    }

    /**
     * Stop cursor blinking
     */
    function stopCursorBlink() {
        if (cursorInterval) {
            clearInterval(cursorInterval);
            cursorInterval = null;
        }
        cursorVisible = true;
    }

    function setActiveColor(color) {
        if (!activeField) return;
        if (!activeField.charColors) activeField.charColors = [];
        if (hasSelection()) {
            const start = Math.min(activeField.selectionStart, activeField.selectionEnd);
            const end = Math.max(activeField.selectionStart, activeField.selectionEnd);
            for (let i = start; i < end; i++) {
                activeField.charColors[i] = color;
            }
        } else {
            activeField.color = color;
            activeField.charColors = new Array(activeField.text.length).fill(color);
        }

        // Invalidate cache to ensure color update renders
        activeField.lastHash = null;

        if (typeof redrawCanvas === 'function') redrawCanvas();
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    /**
     * Check if there's an active text field
     */
    function hasActiveField() {
        return activeField !== null;
    }

    /**
     * Reload font data (call after training new characters)
     */
    async function reloadFont() {
        fontData = null;
        await loadFontData();
        // Invalidate all field caches
        if (textFields) {
            textFields.forEach(field => {
                field.lastHash = null;
                field.cacheCanvas = null;
            });
        }
        if (typeof redrawCanvas === 'function') redrawCanvas();
    }

    /**
     * External pointer down handler - called from main event system (09_events.js)
     * @param {PointerEvent} e - The original event
     * @param {number} canvasX - Pre-calculated canvas X coordinate
     * @param {number} canvasY - Pre-calculated canvas Y coordinate
     * @param {HTMLCanvasElement} canvas - The canvas element
     * @returns {boolean} - True if event was handled (should stop propagation)
     */
    function handlePointerDown(e, canvasX, canvasY, canvas, options = {}) {
        if (e.pointerType === 'pen') return false;
        // Only handle single touch/click for text field
        if (e.pointerType === 'touch' && e.isPrimary === false) return false;

        // Touch selection guard: only allow mouse/pen to select text fields.
        // Touch can only select via triple-tap.
        const isTouch = e.pointerType === 'touch';
        if (isTouch) {
            const now = Date.now();
            // Record tap
            tapHistory.push({ time: now, x: canvasX, y: canvasY });
            // Prune old taps
            tapHistory = tapHistory.filter(t => now - t.time < TRIPLE_TAP_TIMEOUT * 3);
        }

        function isTripleTap() {
            if (tapHistory.length < 3) return false;
            const recent = tapHistory.slice(-3);
            const timeDiffs = [
                recent[1].time - recent[0].time,
                recent[2].time - recent[1].time
            ];
            if (timeDiffs[0] > TRIPLE_TAP_TIMEOUT || timeDiffs[1] > TRIPLE_TAP_TIMEOUT) return false;
            // Check all taps are close together
            for (let i = 0; i < 2; i++) {
                const dx = recent[i + 1].x - recent[i].x;
                const dy = recent[i + 1].y - recent[i].y;
                if (Math.sqrt(dx * dx + dy * dy) > TRIPLE_TAP_DISTANCE) return false;
            }
            return true;
        }

        const touchAllowed = !isTouch || isTripleTap();

        const currentZoom = window.zoom || 1;
        const allowSelect = options.allowSelect !== false;
        if (!activeField) {
            if (!allowSelect) return false;
            // Block touch selection unless triple-tap
            if (!touchAllowed) return false;
            const existingField = getFieldAtPosition(canvasX, canvasY);
            if (existingField) {
                activeField = existingField;
                activeField.cursorPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
                activeField.selectionStart = activeField.cursorPos;
                activeField.selectionEnd = activeField.cursorPos;
                isSelecting = true;
                selectionAnchor = activeField.cursorPos;
                startCursorBlink();
                if (typeof redrawCanvas === 'function') redrawCanvas();
                // Clear tap history after successful triple-tap selection
                if (isTouch) tapHistory = [];
                return true;
            }
            return false;
        }

        // Check if we have an active field
        if (activeField) {
            const bounds = getFieldBounds(activeField);

            // Calculate button positions dynamically based on current zoom
            // This ensures hit testing works even if zoom changed since last draw
            const btnSize = 40 / currentZoom;
            const btnSpacing = 8 / currentZoom;
            const btnMargin = 15 / currentZoom;
            const rightEdge = bounds.x + bounds.width + 8;
            const toolbarX = rightEdge + btnMargin;
            const toolbarY = bounds.y;
            const cancelY = toolbarY + btnSize + btnSpacing;
            const settingsY = cancelY + btnSize + btnSpacing;

            // Check Apply button
            if (canvasX >= toolbarX && canvasX <= toolbarX + btnSize &&
                canvasY >= toolbarY && canvasY <= toolbarY + btnSize) {
                commitAndDeselect();
                return true;
            }

            // Check Cancel button
            if (canvasX >= toolbarX && canvasX <= toolbarX + btnSize &&
                canvasY >= cancelY && canvasY <= cancelY + btnSize) {
                // Cancel - remove without committing
                textFields = textFields.filter(f => f.id !== activeField.id);
                activeField = null;
                stopCursorBlink();
                toggleSettingsPanel(false);
                if (typeof redrawCanvas === 'function') redrawCanvas();
                return true;
            }

            // Check Settings button
            if (canvasX >= toolbarX && canvasX <= toolbarX + btnSize &&
                canvasY >= settingsY && canvasY <= settingsY + btnSize) {
                toggleSettingsPanel();
                return true;
            }

            // Check resize handle (right edge) - larger touch zone
            const handleZone = 30 / currentZoom; // World-space hit zone

            if (canvasX >= rightEdge - handleZone && canvasX <= rightEdge + handleZone &&
                canvasY >= bounds.y - 20/currentZoom && canvasY <= bounds.y + bounds.height + 20/currentZoom) {
                isResizing = true;
                resizeHandle = 'right';
                resizeStart = {
                    x: canvasX,
                    y: canvasY,
                    width: activeField.width || bounds.width
                };
                canvas.setPointerCapture(e.pointerId);
                return true;
            }

            // Check if clicking inside the text area (with padding for the box)
            const padding = 15 / currentZoom;
            if (canvasX >= bounds.x - padding && canvasX <= bounds.x + bounds.width + padding &&
                canvasY >= bounds.y - padding && canvasY <= bounds.y + bounds.height + padding) {

                // Check if clicking near top edge to drag (move the text box)
                const topDragZone = 25 / currentZoom;
                if (canvasY <= bounds.y + topDragZone) {
                    // Start dragging
                    isDragging = true;
                    dragStart = {
                        x: canvasX,
                        y: canvasY,
                        fieldX: activeField.x,
                        fieldY: activeField.y
                    };
                    canvas.setPointerCapture(e.pointerId);
                    return true;
                }

                // Position cursor
                activeField.cursorPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
                activeField.selectionStart = activeField.cursorPos;
                activeField.selectionEnd = activeField.cursorPos;
                isSelecting = true;
                selectionAnchor = activeField.cursorPos;
                startCursorBlink();
                if (typeof redrawCanvas === 'function') redrawCanvas();
                return true;
            }

            // Clicked outside - DO NOT deselect, only X button deselects
            // But allow highlighter/eraser tools to pass through so they can still draw
            if (options.allowSelect === false) {
                return false; // Let the drawing tool handle it
            }
            return true;
        }

        return false;  // Not handled
    }

    /**
     * External pointer move handler - called from main event system
     * @param {PointerEvent} e - The original event
     * @returns {boolean} - True if event was handled
     */
    function handlePointerMove(e) {
        if (!activeField) return false;

        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const currentZoom = window.zoom || 1;
        const currentPanX = window.panX || 0;
        const currentPanY = window.panY || 0;

        const canvasX = (e.clientX - rect.left - currentPanX) / currentZoom;
        const canvasY = (e.clientY - rect.top - currentPanY) / currentZoom;

        // Handle dragging (moving the text box)
        if (isDragging && dragStart) {
            const deltaX = canvasX - dragStart.x;
            const deltaY = canvasY - dragStart.y;
            activeField.x = dragStart.fieldX + deltaX;
            activeField.y = dragStart.fieldY + deltaY;

            // Check if dragging over recycle bin
            if (typeof updateTrashHover === 'function') {
                updateTrashHover(e.clientX, e.clientY);
            }

            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        // Handle resizing
        if (isResizing && resizeStart) {
            // Width resize
            const newWidth = Math.max(MIN_BOX_WIDTH, resizeStart.width + (canvasX - resizeStart.x));
            activeField.width = newWidth;
            activeField.autoWidth = false;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        if (isSelecting && selectionAnchor !== null) {
            const newPos = getCursorPosAtPoint(activeField, canvasX, canvasY);
            activeField.cursorPos = newPos;
            activeField.selectionStart = selectionAnchor;
            activeField.selectionEnd = newPos;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            return true;
        }

        return false;
    }

    /**
     * External pointer up handler - called from main event system
     * @param {PointerEvent} e - The original event
     * @returns {boolean} - True if event was handled
     */
    function handlePointerUp(e) {
        let handled = false;

        if (isDragging) {
            // Check if dropped on recycle bin
            if (e && typeof isOverRecycleBin === 'function' && isOverRecycleBin(e.clientX, e.clientY)) {
                if (typeof playTrashSuckAnimation === 'function') {
                    playTrashSuckAnimation(e.clientX, e.clientY, () => {
                        // Remove the text field
                        textFields = textFields.filter(f => f.id !== activeField.id);
                        activeField = null;
                        stopCursorBlink();
                        toggleSettingsPanel(false);
                        if (typeof redrawCanvas === 'function') redrawCanvas();
                        if (typeof triggerAutoSave === 'function') triggerAutoSave();
                    });
                } else {
                    textFields = textFields.filter(f => f.id !== activeField.id);
                    activeField = null;
                    stopCursorBlink();
                    toggleSettingsPanel(false);
                    if (typeof redrawCanvas === 'function') redrawCanvas();
                    if (typeof triggerAutoSave === 'function') triggerAutoSave();
                }
                isDragging = false;
                dragStart = null;
                if (e.target && e.target.releasePointerCapture) {
                    try { e.target.releasePointerCapture(e.pointerId); } catch(ex) {}
                }
                return true;
            }

            if (typeof clearTrashHover === 'function') clearTrashHover();
            isDragging = false;
            dragStart = null;
            handled = true;
        }

        if (isResizing) {
            isResizing = false;
            resizeHandle = null;
            resizeStart = null;
            handled = true;
        }

        if (isSelecting) {
            isSelecting = false;
            selectionAnchor = null;
            handled = true;
        }

        if (handled && e.target && e.target.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch(ex) {}
        }

        if (handled && typeof triggerAutoSave === 'function') triggerAutoSave();

        return handled;
    }

    /**
     * Get character bounds for hit testing (used by marker recolor)
     * Returns array of { index, x, y, width, height } for each character
     * This MUST match the exact logic in drawField for selection highlighting
     */
    function getCharacterBounds(field) {
        if (!field || !field.text) return [];

        const fontSize = field.fontSize || settings.fontSize;
        const charWidth = fontSize * (CELL_WIDTH / CELL_HEIGHT);
        const charHeight = fontSize;
        const lineHeightPx = getLineHeightPx(fontSize);
        const maxWidth = field.autoWidth ? Infinity : field.width;

        const bounds = [];
        let cursorX = field.x;
        let cursorY = field.y;

        // Helper to measure word width (same as in drawField)
        const measureWord = (text, startIdx) => {
            let width = 0;
            let idx = startIdx;
            while (idx < text.length && !isWordBreakChar(text[idx])) {
                width += getCharAdvance(fontSize, text[idx]);
                idx++;
            }
            return { width, endIdx: idx };
        };

        // Use while loop to exactly match drawField logic
        let i = 0;
        while (i < field.text.length) {
            const char = field.text[i];

            // Handle newline
            if (char === '\n') {
                bounds.push({ index: i, x: cursorX, y: cursorY, width: 0, height: charHeight, char });
                cursorX = field.x;
                cursorY += lineHeightPx;
                i++;
                continue;
            }

            // Handle space
            if (char === ' ') {
                // If at start of line, skip the space (same as drawField)
                if (cursorX === field.x) {
                    bounds.push({ index: i, x: cursorX, y: cursorY, width: 0, height: charHeight, char });
                    i++;
                    continue;
                }
                const spaceWidth = getSpaceAdvance(fontSize);
                bounds.push({ index: i, x: cursorX, y: cursorY, width: spaceWidth, height: charHeight, char });
                cursorX += spaceWidth;
                i++;
                continue;
            }

            if (char === '\t') {
                const tabWidth = getTabAdvance(fontSize, cursorX - field.x);
                bounds.push({ index: i, x: cursorX, y: cursorY, width: tabWidth, height: charHeight, char });
                cursorX += tabWidth;
                i++;
                continue;
            }

            // Word wrap check (same as drawField)
            if (!field.autoWidth && isWordStartAt(field.text, i)) {
                const wordInfo = measureWord(field.text, i);
                const lineWidth = cursorX - field.x + wordInfo.width;
                if (lineWidth > maxWidth && cursorX > field.x) {
                    cursorX = field.x;
                    cursorY += lineHeightPx;
                }
            }

            // Add bounds at current cursor position (matches selection highlight position)
            const charAdvance = getCharAdvance(fontSize, char);
            bounds.push({ index: i, x: cursorX, y: cursorY, width: charAdvance, height: charHeight, char });

            // Advance cursor (NOTE: drawField adds jitter.spacing here, but we ignore jitter for hit testing
            // since jitter is random visual variation, not logical position)
            cursorX += charAdvance;
            i++;
        }

        return bounds;
    }

    // Initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }

    return {
        handleCanvasClick,
        draw,
        drawPreview,
        hasFontData: () => !!fontData,
        hasActiveField,
        deselect,
        reloadFont,
        createTextField,
        commitAndDeselect,
        // External pointer handlers for main event system
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        // Settings access for adjusting text appearance
        getSettings,
        setSettings,
        setTextFields,
        getTextFields,
        setActiveColor,
        toggleSettingsPanel,
        getCharacterBounds,
        get activeField() { return activeField; },
        get textFields() { return textFields; },
        get isResizing() { return isResizing; },
        get isDragging() { return isDragging; }
    };
})();

window.HandwrittenTextField = HandwrittenTextField;
