// ============== Font Book Module ==============
// Single "Fontbook" notebook with font atlas pages
// Each page = one complete font with all characters (3 variants each)

const FontBook = (function() {
    'use strict';

    // The single Fontbook notebook ID (stored in localStorage)
    const FONTBOOK_STORAGE_KEY = 'badnotes_fontbook_id';

    // Character set for the atlas (uses FontCore.CHARACTER_SET)
    const ATLAS_CHARACTERS = [
        ...FontCore.CHARACTER_SET.uppercase,
        ...FontCore.CHARACTER_SET.lowercase,
        ...FontCore.CHARACTER_SET.numbers,
        ...FontCore.CHARACTER_SET.punctuation,
        ...FontCore.CHARACTER_SET.brackets,
        ...FontCore.CHARACTER_SET.math,
        ...FontCore.CHARACTER_SET.symbols,
        ...FontCore.CHARACTER_SET.german
    ];

    // Grid layout for atlas - aligned with 24px dotted grid
    const GRID_SIZE = 24; // Must match dotted grid spacing
    const COLS = 10; // Characters per row
    const VARIANTS_PER_CHAR = 3;
    const CELL_WIDTH = GRID_SIZE * 3;  // 72px = 3 grid cells wide
    const CELL_HEIGHT = GRID_SIZE * 4; // 96px = 4 grid cells tall

    /**
     * Get or create the single Fontbook notebook
     * Called during app initialization
     */
    async function ensureFontbook() {
        // Check if we already have a Fontbook
        const storedId = localStorage.getItem(FONTBOOK_STORAGE_KEY);

        if (storedId) {
            // Verify it still exists
            const existing = notebooks.find(n => n.id === storedId);
            if (existing) {
                return existing;
            }
        }

        // Check if there's already a notebook named "Fontbook"
        const existingFontbook = notebooks.find(n => n.name === '✍️ Fontbook' || n.isFontBook);
        if (existingFontbook) {
            localStorage.setItem(FONTBOOK_STORAGE_KEY, existingFontbook.id);
            return existingFontbook;
        }

        // Create the Fontbook notebook
        return await createFontbook();
    }

    /**
     * Create the Fontbook notebook with one initial atlas page
     */
    async function createFontbook() {
        // Create font data entry
        const font = await FontCore.createFont('My Handwriting');
        if (!font) {
            console.error('Failed to create font data');
            return null;
        }

        // Create the notebook
        const notebookData = {
            name: '✍️ Fontbook',
            color: '#9c27b0', // Purple
            template: 'dotted',
            fontBookId: font.id,
            isFontBook: true
        };

        const result = await API.post('/api/notebooks', notebookData);
        if (!result || !result.notebook) {
            console.error('Failed to create Fontbook notebook');
            return null;
        }

        const notebook = result.notebook;

        // Create the first atlas page (one complete font)
        const pageData = {
            template: 'dotted', // Use dotted grid under the atlas
            isFontAtlas: true,
            fontId: font.id,
            fontName: 'Font 1'
        };

        const page = await API.post(`/api/notebooks/${notebook.id}/pages`, pageData);
        if (page && page.id) {
            notebook.pages = [page.id];
            await API.put(`/api/notebooks/${notebook.id}`, notebook);
        }

        // Store the ID
        localStorage.setItem(FONTBOOK_STORAGE_KEY, notebook.id);

        // Add to notebooks list and re-render
        notebooks.push(notebook);
        if (typeof renderNotebookList === 'function') {
            renderNotebookList();
        }

        return notebook;
    }

    /**
     * Check if current notebook is the Fontbook
     */
    function isFontBook() {
        return currentNotebook?.isFontBook === true;
    }

    /**
     * Check if current page is a font atlas
     */
    function isFontAtlas() {
        if (!pages || currentPageIndex < 0 || currentPageIndex >= pages.length) {
            return false;
        }
        const page = pages[currentPageIndex];
        // Check for both boolean and string "true" (just in case)
        const result = page?.isFontAtlas === true || page?.isFontAtlas === 'true';
        return result;
    }

    /**
     * Get the font ID for the current page
     */
    function getCurrentFontId() {
        if (!pages || currentPageIndex < 0) return null;
        return pages[currentPageIndex]?.fontId || currentNotebook?.fontBookId || null;
    }

    /**
     * Calculate cell dimensions for the atlas grid
     * Cells are aligned to 24px grid
     */
    function getCellLayout(pageWidth, pageHeight) {
        const rows = Math.ceil(ATLAS_CHARACTERS.length / COLS);
        const variantWidth = CELL_WIDTH / VARIANTS_PER_CHAR; // 24px per variant

        return {
            rows,
            cellWidth: CELL_WIDTH,
            cellHeight: CELL_HEIGHT,
            variantWidth,
            gridSize: GRID_SIZE
        };
    }

    /**
     * Get character cell position on the atlas
     */
    function getCharacterCell(charIndex, pageWidth, pageHeight) {
        const { cellWidth, cellHeight } = getCellLayout(pageWidth, pageHeight);
        const row = Math.floor(charIndex / COLS);
        const col = charIndex % COLS;

        return {
            x: col * cellWidth,
            y: row * cellHeight,
            width: cellWidth,
            height: cellHeight
        };
    }

    /**
     * Get which character cell is at a given position
     */
    function getCharacterAtPosition(x, y, pageWidth, pageHeight) {
        const { cellWidth, cellHeight } = getCellLayout(pageWidth, pageHeight);
        const col = Math.floor(x / cellWidth);
        const row = Math.floor(y / cellHeight);
        const index = row * COLS + col;

        if (index >= 0 && index < ATLAS_CHARACTERS.length) {
            return {
                char: ATLAS_CHARACTERS[index],
                index: index,
                cell: getCharacterCell(index, pageWidth, pageHeight)
            };
        }
        return null;
    }

    /**
     * Draw the font atlas grid on the canvas
     * Called by canvas rendering system for font atlas pages
     * Grid-aligned: cells are 72x96px (3x4 grid cells of 24px)
     */
    function drawFontAtlas(ctx, pageWidth, pageHeight) {
        const { rows, cellWidth, cellHeight, variantWidth } = getCellLayout(pageWidth, pageHeight);

        ctx.save();

        // Colors - slightly more visible for the cell borders
        const cellBorderColor = isDarkMode ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';
        const charColor = isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
        const labelColor = isDarkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
        const variantLineColor = isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';

        // Draw cell borders (thicker, on top of dotted grid)
        ctx.strokeStyle = cellBorderColor;
        ctx.lineWidth = 1.5;

        // Vertical cell borders
        for (let c = 0; c <= COLS; c++) {
            ctx.beginPath();
            ctx.moveTo(c * cellWidth, 0);
            ctx.lineTo(c * cellWidth, rows * cellHeight);
            ctx.stroke();
        }

        // Horizontal cell borders
        for (let r = 0; r <= rows; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * cellHeight);
            ctx.lineTo(COLS * cellWidth, r * cellHeight);
            ctx.stroke();
        }

        // Draw character labels and variant dividers
        ATLAS_CHARACTERS.forEach((char, i) => {
            const cell = getCharacterCell(i, pageWidth, pageHeight);

            // Character label at top-left of cell
            ctx.fillStyle = labelColor;
            ctx.font = '12px Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(char, cell.x + 4, cell.y + 2);

            // Draw faint large character as guide (centered in cell)
            ctx.fillStyle = charColor;
            ctx.font = `${cellHeight * 0.6}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(char, cell.x + cellWidth / 2, cell.y + cellHeight / 2 + 6);

            // Draw variant dividers - aligned with grid (at 24px and 48px)
            ctx.strokeStyle = variantLineColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            for (let v = 1; v < VARIANTS_PER_CHAR; v++) {
                const vx = cell.x + v * variantWidth; // 24px intervals
                ctx.beginPath();
                ctx.moveTo(vx, cell.y + 16); // Start below label
                ctx.lineTo(vx, cell.y + cellHeight - 4);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        });

        ctx.restore();
    }

    /**
     * Add a new font page (new font atlas) to the Fontbook
     */
    async function addFontPage(fontName) {
        if (!isFontBook()) {
            showToast('Not in Fontbook', 'error');
            return null;
        }

        // Create new font data
        const font = await FontCore.createFont(fontName || `Font ${pages.length + 1}`);
        if (!font) {
            showToast('Failed to create font', 'error');
            return null;
        }

        // Create atlas page
        const pageData = {
            template: 'dotted', // Use dotted grid under the atlas
            isFontAtlas: true,
            fontId: font.id,
            fontName: fontName || `Font ${pages.length + 1}`
        };

        const page = await API.post(`/api/notebooks/${currentNotebook.id}/pages`, pageData);
        if (page && page.id) {
            pages.push(page);
            currentNotebook.pages.push(page.id);
            await API.put(`/api/notebooks/${currentNotebook.id}`, currentNotebook);

            currentPageIndex = pages.length - 1;
            loadPage(currentPageIndex);
            renderPageList();

            showToast(`Created "${fontName || 'Font ' + pages.length}"`, 'success');
            return page;
        }

        return null;
    }

    // Expose public API
    return {
        ensureFontbook,
        createFontbook,
        isFontBook,
        isFontAtlas,
        getCurrentFontId,
        getCellLayout,
        getCharacterCell,
        getCharacterAtPosition,
        drawFontAtlas,
        addFontPage,
        ATLAS_CHARACTERS,
        COLS,
        VARIANTS_PER_CHAR
    };
})();

// Make globally available
window.FontBook = FontBook;
