// ============== Handwritten Font Core ==============
// Font data structures, API communication, and storage

const FontCore = (function() {
    'use strict';

    // Current active font
    let currentFont = null;
    let fonts = [];

    // Character set for training (includes German keyboard symbols)
    const CHARACTER_SET = {
        uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        lowercase: 'abcdefghijklmnopqrstuvwxyz'.split(''),
        numbers: '0123456789'.split(''),
        punctuation: '.,!?\'":;-'.split(''),
        brackets: '()[]{}<>'.split(''),
        math: '+-*/=^'.split(''),
        symbols: '@#$%&|~'.split(''),
        german: 'äöüÄÖÜßé€§°'.split(''),
        special: '"\'`´\\/_'.split(''),
        space: [' ']
    };

    // Flatten for easy iteration
    const ALL_CHARACTERS = [
        ...CHARACTER_SET.uppercase,
        ...CHARACTER_SET.lowercase,
        ...CHARACTER_SET.numbers,
        ...CHARACTER_SET.punctuation,
        ...CHARACTER_SET.brackets,
        ...CHARACTER_SET.math,
        ...CHARACTER_SET.symbols,
        ...CHARACTER_SET.german,
        ...CHARACTER_SET.special
    ];

    // ============== API Functions ==============

    async function listFonts() {
        try {
            const response = await fetch('/api/fonts');
            if (!response.ok) throw new Error('Failed to list fonts');
            fonts = await response.json();
            return fonts;
        } catch (error) {
            console.error('FontCore.listFonts error:', error);
            return [];
        }
    }

    async function createFont(name = 'My Handwriting') {
        try {
            const response = await fetch('/api/fonts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!response.ok) throw new Error('Failed to create font');
            const font = await response.json();
            currentFont = font;
            return font;
        } catch (error) {
            console.error('FontCore.createFont error:', error);
            return null;
        }
    }

    async function loadFont(fontId) {
        try {
            const response = await fetch(`/api/fonts/${fontId}`);
            if (!response.ok) throw new Error('Failed to load font');
            currentFont = await response.json();
            return currentFont;
        } catch (error) {
            console.error('FontCore.loadFont error:', error);
            return null;
        }
    }

    async function updateFont(fontId, updates) {
        try {
            const response = await fetch(`/api/fonts/${fontId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!response.ok) throw new Error('Failed to update font');
            const font = await response.json();
            if (currentFont && currentFont.id === fontId) {
                currentFont = font;
            }
            return font;
        } catch (error) {
            console.error('FontCore.updateFont error:', error);
            return null;
        }
    }

    async function deleteFont(fontId) {
        try {
            const response = await fetch(`/api/fonts/${fontId}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete font');
            if (currentFont && currentFont.id === fontId) {
                currentFont = null;
            }
            return true;
        } catch (error) {
            console.error('FontCore.deleteFont error:', error);
            return false;
        }
    }

    async function addCharacterVariant(fontId, char, strokeData) {
        try {
            // URL encode the character for special chars like / \ etc
            const encodedChar = encodeURIComponent(char);
            const response = await fetch(`/api/fonts/${fontId}/characters/${encodedChar}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(strokeData)
            });
            if (!response.ok) throw new Error('Failed to add character variant');
            const variant = await response.json();

            // Update local cache if this is the current font
            if (currentFont && currentFont.id === fontId) {
                if (!currentFont.characters[char]) {
                    currentFont.characters[char] = { variants: [], preferredVariant: 0 };
                }
                currentFont.characters[char].variants.push(variant);
            }

            return variant;
        } catch (error) {
            console.error('FontCore.addCharacterVariant error:', error);
            return null;
        }
    }

    async function deleteCharacterVariant(fontId, char, variantId) {
        try {
            const encodedChar = encodeURIComponent(char);
            const response = await fetch(`/api/fonts/${fontId}/characters/${encodedChar}/${variantId}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete variant');

            // Update local cache
            if (currentFont && currentFont.id === fontId && currentFont.characters[char]) {
                currentFont.characters[char].variants =
                    currentFont.characters[char].variants.filter(v => v.id !== variantId);
                if (currentFont.characters[char].variants.length === 0) {
                    delete currentFont.characters[char];
                }
            }

            return true;
        } catch (error) {
            console.error('FontCore.deleteCharacterVariant error:', error);
            return false;
        }
    }

    // ============== Stroke Normalization ==============

    function normalizeStrokes(strokes, captureStartTime = 0) {
        if (!strokes || strokes.length === 0) return { strokes: [], boundingBox: { width: 1, height: 1 }, totalTime: 0 };

        // Find bounding box of all points
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let maxTime = 0;

        for (const stroke of strokes) {
            if (!stroke.points) continue;
            for (const pt of stroke.points) {
                minX = Math.min(minX, pt.x);
                maxX = Math.max(maxX, pt.x);
                minY = Math.min(minY, pt.y);
                maxY = Math.max(maxY, pt.y);
                if (pt.time !== undefined) {
                    maxTime = Math.max(maxTime, pt.time - captureStartTime);
                }
            }
        }

        // Handle edge cases
        if (minX === Infinity) return { strokes: [], boundingBox: { width: 1, height: 1 }, totalTime: 0 };

        const width = maxX - minX || 1;
        const height = maxY - minY || 1;

        // Normalize strokes
        const normalizedStrokes = strokes.map(stroke => ({
            id: stroke.id || Date.now(),
            points: stroke.points.map(pt => ({
                x: (pt.x - minX) / width,
                y: (pt.y - minY) / height,
                pressure: pt.pressure || 0.5,
                time: pt.time !== undefined ? pt.time - captureStartTime : 0
            })),
            color: 'inherit',
            size: stroke.size || 1.5
        }));

        return {
            strokes: normalizedStrokes,
            boundingBox: {
                width: width / height,  // Aspect ratio (width relative to height=1)
                height: 1.0
            },
            totalTime: maxTime || 500
        };
    }

    // ============== Character Helpers ==============

    function getCharacterVariants(char) {
        if (!currentFont || !currentFont.characters[char]) {
            return [];
        }
        return currentFont.characters[char].variants;
    }

    function getRandomVariant(char) {
        const variants = getCharacterVariants(char);
        if (variants.length === 0) return null;
        const index = Math.floor(Math.random() * variants.length);
        return variants[index];
    }

    function getTrainedCharacters() {
        if (!currentFont) return [];
        return Object.keys(currentFont.characters);
    }

    function getTrainingProgress() {
        if (!currentFont) return { trained: 0, total: ALL_CHARACTERS.length, percentage: 0 };
        const trained = Object.keys(currentFont.characters).length;
        return {
            trained,
            total: ALL_CHARACTERS.length,
            percentage: Math.round((trained / ALL_CHARACTERS.length) * 100)
        };
    }

    function isCharacterTrained(char) {
        if (!currentFont) return false;
        const charData = currentFont.characters[char];
        return charData && charData.variants && charData.variants.length > 0;
    }

    // ============== Public API ==============

    return {
        // Data
        get currentFont() { return currentFont; },
        get fonts() { return fonts; },
        CHARACTER_SET,
        ALL_CHARACTERS,

        // API functions
        listFonts,
        createFont,
        loadFont,
        updateFont,
        deleteFont,
        addCharacterVariant,
        deleteCharacterVariant,

        // Helpers
        normalizeStrokes,
        getCharacterVariants,
        getRandomVariant,
        getTrainedCharacters,
        getTrainingProgress,
        isCharacterTrained
    };
})();
