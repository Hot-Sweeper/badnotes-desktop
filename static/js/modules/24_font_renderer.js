// ============== Font Renderer Module ==============
// Extracts character strokes from fontbook and renders handwritten text

const FontRenderer = (function() {
    'use strict';

    // Grid layout constants (must match FontBook)
    const GRID_SIZE = 24;
    const COLS = 10;
    const VARIANTS_PER_CHAR = 3;
    const CELL_WIDTH = GRID_SIZE * 3;   // 72px
    const CELL_HEIGHT = GRID_SIZE * 4;  // 96px
    const VARIANT_WIDTH = CELL_WIDTH / VARIANTS_PER_CHAR; // 24px

    // Cache for extracted font data
    let fontCache = {};

    /**
     * Get the character set from FontBook
     */
    function getCharacterSet() {
        return FontBook.ATLAS_CHARACTERS;
    }

    /**
     * Get the cell bounds for a character at a given index
     */
    function getCellBounds(charIndex) {
        const row = Math.floor(charIndex / COLS);
        const col = charIndex % COLS;

        return {
            x: col * CELL_WIDTH,
            y: row * CELL_HEIGHT,
            width: CELL_WIDTH,
            height: CELL_HEIGHT
        };
    }

    /**
     * Get which variant slot (0, 1, or 2) a point is in within a cell
     */
    function getVariantSlot(x, cellX) {
        const relativeX = x - cellX;
        return Math.floor(relativeX / VARIANT_WIDTH);
    }

    /**
     * Check if a stroke belongs to a character cell
     * Uses the stroke's bounding box center point
     */
    function getStrokeCharacter(stroke, characters) {
        if (!stroke.points || stroke.points.length === 0) return null;

        // Calculate stroke bounding box
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const pt of stroke.points) {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
        }

        // Use center of stroke for cell detection
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Find which cell this stroke belongs to
        const col = Math.floor(centerX / CELL_WIDTH);
        const row = Math.floor(centerY / CELL_HEIGHT);
        const charIndex = row * COLS + col;

        if (charIndex >= 0 && charIndex < characters.length) {
            const cell = getCellBounds(charIndex);
            const variant = getVariantSlot(centerX, cell.x);

            return {
                char: characters[charIndex],
                charIndex: charIndex,
                variant: Math.max(0, Math.min(variant, VARIANTS_PER_CHAR - 1)),
                cell: cell
            };
        }

        return null;
    }

    /**
     * Normalize stroke coordinates relative to cell (0-1 range)
     */
    function normalizeStroke(stroke, cell) {
        const normalizedPoints = stroke.points.map((pt, i) => ({
            x: (pt.x - cell.x) / cell.width,
            y: (pt.y - cell.y) / cell.height,
            pressure: pt.pressure || 0.5,
            time: i * 8 // Approximate timing
        }));

        return {
            points: normalizedPoints,
            color: stroke.color,
            size: stroke.size
        };
    }

    /**
     * Extract all character strokes from a fontbook page
     * Returns font data structure with characters and variants
     */
    async function extractFontFromPage(pageData) {
        const characters = getCharacterSet();
        const fontData = {
            characters: {}
        };

        // Initialize all characters with empty variants
        const variantsPerChar = (typeof FontBook !== 'undefined' && FontBook.VARIANTS_PER_CHAR) ? FontBook.VARIANTS_PER_CHAR : 3;
        characters.forEach(char => {
            fontData.characters[char] = {
                variants: Array.from({ length: variantsPerChar }, () => [])
            };
        });

        // Process each stroke
        if (!pageData.strokes) return fontData;

        for (const stroke of pageData.strokes) {
            const charInfo = getStrokeCharacter(stroke, characters);
            if (!charInfo) continue;

            const normalized = normalizeStroke(stroke, charInfo.cell);

            // Add to the appropriate character and variant
            fontData.characters[charInfo.char].variants[charInfo.variant].push(normalized);
        }

        return fontData;
    }

    /**
     * Load and cache font from fontbook
     */
    async function loadFont(fontId) {
        if (fontCache[fontId]) {
            return fontCache[fontId];
        }

        // Find the fontbook page with this font
        const fontbookId = localStorage.getItem('badnotes_fontbook_id');
        if (!fontbookId) return null;

        try {
            const data = await API.get(`/api/notebooks/${fontbookId}`);
            if (!data || !data.pages) return null;

            // Find the page for this font
            const page = data.pages.find(p => p.fontId === fontId);
            if (!page) return null;

            const fontData = await extractFontFromPage(page);
            fontCache[fontId] = fontData;
            return fontData;
        } catch (err) {
            console.error('Failed to load font:', err);
            return null;
        }
    }

    /**
     * Get a random variant for a character (for natural variation)
     */
    function getRandomVariant(charData) {
        // Find non-empty variants
        const nonEmpty = charData.variants
            .map((v, i) => ({ strokes: v, index: i }))
            .filter(v => v.strokes.length > 0);

        if (nonEmpty.length === 0) return null;

        // Pick random
        const picked = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
        return picked.strokes;
    }

    /**
     * Render a single character at a position
     * Returns the strokes transformed to the target position/size
     */
    function renderCharacter(char, fontData, x, y, size, color) {
        const charData = fontData.characters[char];
        if (!charData) return [];

        const variantStrokes = getRandomVariant(charData);
        if (!variantStrokes) return [];

        // Transform strokes to target position and size
        const renderedStrokes = variantStrokes.map(stroke => {
            const transformedPoints = stroke.points.map(pt => ({
                x: x + pt.x * size,
                y: y + pt.y * size * 1.2, // Slight height adjustment
                pressure: pt.pressure,
                size: stroke.size * (size / CELL_WIDTH)
            }));

            return {
                points: transformedPoints,
                color: color || stroke.color,
                size: stroke.size * (size / CELL_WIDTH),
                tool: 'pen'
            };
        });

        return renderedStrokes;
    }

    /**
     * Render text string as handwritten strokes
     * Returns array of stroke objects ready to be added to page
     */
    function renderText(text, fontData, startX, startY, options = {}) {
        const {
            fontSize = 48,
            color = '#000000',
            letterSpacing = 0.1,  // Fraction of fontSize
            lineHeight = 1.5,
            maxWidth = Infinity
        } = options;

        const allStrokes = [];
        let cursorX = startX;
        let cursorY = startY;
        const charWidth = fontSize * 0.7; // Approximate character width
        const spacing = fontSize * letterSpacing;

        for (const char of text) {
            // Handle newlines
            if (char === '\n') {
                cursorX = startX;
                cursorY += fontSize * lineHeight;
                continue;
            }

            // Handle spaces
            if (char === ' ') {
                cursorX += charWidth * 0.5;
                continue;
            }

            // Word wrap
            if (cursorX + charWidth > startX + maxWidth) {
                cursorX = startX;
                cursorY += fontSize * lineHeight;
            }

            // Render character
            const charStrokes = renderCharacter(char, fontData, cursorX, cursorY, fontSize, color);
            allStrokes.push(...charStrokes);

            cursorX += charWidth + spacing;
        }

        return allStrokes;
    }

    /**
     * Create a text element using handwritten font
     * This can be added to the page
     */
    async function createHandwrittenText(text, x, y, options = {}) {
        // Get current font from fontbook
        const fontbookId = localStorage.getItem('badnotes_fontbook_id');
        if (!fontbookId) {
            showToast('No fontbook found. Please create one first.', 'error');
            return null;
        }

        // Load fontbook data
        try {
            const data = await API.get(`/api/notebooks/${fontbookId}`);
            if (!data || !data.pages || data.pages.length === 0) {
                showToast('No font pages in fontbook', 'error');
                return null;
            }

            // Use first font page
            const page = data.pages[0];
            const fontData = await extractFontFromPage(page);

            // Render the text
            const strokes = renderText(text, fontData, x, y, {
                fontSize: options.fontSize || 48,
                color: options.color || currentColor,
                letterSpacing: options.letterSpacing || 0.1,
                lineHeight: options.lineHeight || 1.5,
                maxWidth: options.maxWidth || 600
            });

            return {
                type: 'handwrittenText',
                text: text,
                x: x,
                y: y,
                strokes: strokes,
                options: options
            };
        } catch (err) {
            console.error('Failed to create handwritten text:', err);
            showToast('Failed to create text', 'error');
            return null;
        }
    }

    /**
     * Add handwritten text strokes directly to current page
     */
    async function addHandwrittenText(text, x, y, options = {}) {
        const result = await createHandwrittenText(text, x, y, options);
        if (!result || !result.strokes) return false;

        // Add each stroke to the page
        for (const stroke of result.strokes) {
            stroke.id = Date.now() + Math.random();
            strokes.push(stroke);
        }

        // Invalidate stroke cache after adding strokes
        if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();

        redrawCanvas();
        markPageDirty();

        return true;
    }

    // Public API
    return {
        extractFontFromPage,
        loadFont,
        renderText,
        renderCharacter,
        createHandwrittenText,
        addHandwrittenText,
        getCharacterSet,
        clearCache: () => { fontCache = {}; }
    };
})();

window.FontRenderer = FontRenderer;
