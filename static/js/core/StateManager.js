/**
 * StateManager - Centralized application state management
 * Immutable state updates with subscription support
 */
class StateManager extends EventEmitter {
    constructor(initialState = {}) {
        super();

        // Private state storage
        this._state = this._deepFreeze({
            // App state
            app: {
                initialized: false,
                loading: false,
                sidebarOpen: false,
                fullscreen: false,
            },

            // Current tool settings
            tool: {
                active: 'pen',
                color: '#ffffff',
                strokeSize: 1.5,
                opacity: 1,
                pressure: true,
                tilt: true,
            },

            // Pen presets
            penPresets: [
                { id: 'pen1', name: 'Fine Pen', color: '#ffffff', size: 2 },
                { id: 'pen2', name: 'Medium Pen', color: '#ffffff', size: 4 },
                { id: 'pen3', name: 'Thick Pen', color: '#ffffff', size: 8 },
            ],

            // Highlighter presets
            highlighterPresets: [
                { id: 'hl1', name: 'Yellow', color: 'rgba(255, 235, 59, 0.4)', size: 20 },
                { id: 'hl2', name: 'Green', color: 'rgba(76, 175, 80, 0.4)', size: 20 },
                { id: 'hl3', name: 'Blue', color: 'rgba(33, 150, 243, 0.4)', size: 20 },
                { id: 'hl4', name: 'Pink', color: 'rgba(233, 30, 99, 0.4)', size: 20 },
            ],

            // Viewport state
            viewport: {
                zoom: 1,
                panX: 0,
                panY: 0,
                rotation: 0,
            },

            // Canvas state
            canvas: {
                width: 1920,
                height: 1080,
                dpr: window.devicePixelRatio || 1,
                template: 'blank',
                paperMode: 'light',
            },

            // Selection state
            selection: {
                active: false,
                elements: [],
                bounds: null,
            },

            // Current notebook/page
            document: {
                notebookId: null,
                pageId: null,
                pageIndex: 0,
                totalPages: 1,
            },

            // Settings
            settings: {
                palmRejection: true,
                pressureSensitivity: 50,
                tiltSensitivity: 50,
                highRefreshRate: true,
                smoothScrolling: true,
                autosaveInterval: 30,
                exportFormat: 'pdf',
            },

            // Recent colors
            recentColors: [
                '#ffffff', '#ff4444', '#ffbb33', '#00C851', '#33b5e5', '#aa66cc'
            ],

            // Custom color presets
            colorPresets: [
                '#ffffff', '#000000', '#ff4444', '#ff8a65', '#ffbb33', '#ffeb3b',
                '#00C851', '#4caf50', '#33b5e5', '#2196f3', '#aa66cc', '#9c27b0',
                '#795548', '#607d8b', '#9e9e9e', '#ff1744'
            ],

            ...initialState
        });

        // State history for debugging
        this._history = [];
        this._maxHistory = 50;
    }

    /**
     * Get current state or specific path
     * @param {string} [path] - Dot-notation path to state value
     * @returns {any} State value
     */
    get(path) {
        if (!path) return this._state;

        return path.split('.').reduce((obj, key) => {
            return obj && obj[key] !== undefined ? obj[key] : undefined;
        }, this._state);
    }

    /**
     * Update state with partial updates
     * @param {string|Object} pathOrUpdates - Path string or update object
     * @param {any} [value] - Value if path string provided
     */
    set(pathOrUpdates, value) {
        let updates;

        if (typeof pathOrUpdates === 'string') {
            updates = this._setPath({}, pathOrUpdates, value);
        } else {
            updates = pathOrUpdates;
        }

        // Create new state with updates
        const prevState = this._state;
        this._state = this._deepFreeze(this._deepMerge(this._state, updates));

        // Store in history
        this._history.push({
            timestamp: Date.now(),
            updates,
            prevState
        });

        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }

        // Emit change events
        this.emit('change', this._state, prevState);

        // Emit specific path changes
        this._emitPathChanges(updates, '');
    }

    /**
     * Set a value at a path in an object
     */
    _setPath(obj, path, value) {
        const keys = path.split('.');
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }

        current[keys[keys.length - 1]] = value;
        return obj;
    }

    /**
     * Deep merge two objects
     */
    _deepMerge(target, source) {
        const result = { ...target };

        for (const key in source) {
            if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this._deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }

        return result;
    }

    /**
     * Deep freeze an object
     * PERFORMANCE: Disabled — recursive Object.freeze was causing significant overhead
     * on every state update during drawing (called on every pointer move, zoom, pan).
     * State immutability is now maintained by convention.
     */
    _deepFreeze(obj) {
        return obj;
    }

    /**
     * Emit change events for specific paths
     */
    _emitPathChanges(updates, prefix) {
        for (const key in updates) {
            const path = prefix ? `${prefix}.${key}` : key;

            if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])) {
                this._emitPathChanges(updates[key], path);
            }

            this.emit(`change:${path}`, this.get(path));
        }
    }

    /**
     * Subscribe to state changes at a specific path
     * @param {string} path - Dot-notation path
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
        return this.on(`change:${path}`, callback);
    }

    /**
     * Get state history
     * @returns {Array} State history
     */
    getHistory() {
        return [...this._history];
    }

    /**
     * Reset state to initial
     */
    reset() {
        this._state = this._deepFreeze({
            app: { initialized: false, loading: false, sidebarOpen: false, fullscreen: false },
            tool: { active: 'pen', color: '#ffffff', strokeSize: 1.5, opacity: 1, pressure: true, tilt: true },
            viewport: { zoom: 1, panX: 0, panY: 0, rotation: 0 },
            canvas: { width: 1920, height: 1080, dpr: window.devicePixelRatio || 1, template: 'blank', paperMode: 'light' },
            selection: { active: false, elements: [], bounds: null },
            document: { notebookId: null, pageId: null, pageIndex: 0, totalPages: 1 },
        });
        this._history = [];
        this.emit('reset');
    }
}

// Global state instance
window.AppState = new StateManager();
