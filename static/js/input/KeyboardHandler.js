/**
 * KeyboardHandler - Keyboard shortcuts and input handling
 */
class KeyboardHandler extends EventEmitter {
    constructor() {
        super();

        this.shortcuts = new Map();
        this.activeModifiers = {
            ctrl: false,
            shift: false,
            alt: false,
            meta: false,
        };

        // Default shortcuts
        this._registerDefaults();

        // Bind handlers
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
    }

    /**
     * Initialize keyboard handling
     */
    init() {
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        this.emit('initialized');
    }

    /**
     * Destroy keyboard handling
     */
    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
    }

    /**
     * Register default shortcuts
     */
    _registerDefaults() {
        // Tool shortcuts
        this.register('v', 'select', 'Select tool');
        this.register('p', 'pen', 'Pen tool');
        this.register('h', 'highlighter', 'Highlighter tool');
        this.register('e', 'eraser', 'Eraser tool');
        this.register('l', 'lasso', 'Lasso select');
        this.register('s', 'shape', 'Shape tool');
        this.register('t', 'text', 'Text tool');
        this.register('i', 'image', 'Insert image');

        // Edit shortcuts
        this.register('ctrl+z', 'undo', 'Undo');
        this.register('ctrl+shift+z', 'redo', 'Redo');
        this.register('ctrl+y', 'redo', 'Redo');
        this.register('ctrl+c', 'copy', 'Copy');
        this.register('ctrl+x', 'cut', 'Cut');
        this.register('ctrl+v', 'paste', 'Paste');
        this.register('ctrl+a', 'selectAll', 'Select all');
        this.register('delete', 'delete', 'Delete');
        this.register('backspace', 'delete', 'Delete');

        // View shortcuts
        this.register('ctrl+=', 'zoomIn', 'Zoom in');
        this.register('ctrl+-', 'zoomOut', 'Zoom out');
        this.register('ctrl+0', 'zoomReset', 'Reset zoom');
        this.register('ctrl+1', 'zoomFit', 'Fit to screen');
        this.register('space', 'panMode', 'Pan mode (hold)');

        // File shortcuts
        this.register('ctrl+s', 'save', 'Save');
        this.register('ctrl+shift+s', 'saveAs', 'Save as');
        this.register('ctrl+n', 'newPage', 'New page');
        this.register('ctrl+shift+n', 'newNotebook', 'New notebook');
        this.register('ctrl+o', 'open', 'Open');
        this.register('ctrl+e', 'export', 'Export');

        // Navigation shortcuts
        this.register('pageup', 'prevPage', 'Previous page');
        this.register('pagedown', 'nextPage', 'Next page');
        this.register('home', 'firstPage', 'First page');
        this.register('end', 'lastPage', 'Last page');

        // UI shortcuts
        this.register('escape', 'escape', 'Cancel/Escape');
        this.register('f11', 'fullscreen', 'Toggle fullscreen');
        this.register('ctrl+alt+f', 'fullscreen', 'Toggle fullscreen');
        this.register('ctrl+b', 'toggleSidebar', 'Toggle sidebar');
        this.register('ctrl+f', 'search', 'Search');

        // Color shortcuts
        this.register('1', 'color1', 'Quick color 1');
        this.register('2', 'color2', 'Quick color 2');
        this.register('3', 'color3', 'Quick color 3');
        this.register('4', 'color4', 'Quick color 4');
        this.register('5', 'color5', 'Quick color 5');

        // Size shortcuts
        this.register('[', 'decreaseSize', 'Decrease brush size');
        this.register(']', 'increaseSize', 'Increase brush size');
    }

    /**
     * Register a keyboard shortcut
     * @param {string} combo - Key combination (e.g., 'ctrl+z')
     * @param {string} action - Action name
     * @param {string} description - Human-readable description
     */
    register(combo, action, description = '') {
        const normalizedCombo = this._normalizeCombo(combo);
        this.shortcuts.set(normalizedCombo, { action, description });
    }

    /**
     * Unregister a shortcut
     * @param {string} combo - Key combination
     */
    unregister(combo) {
        const normalizedCombo = this._normalizeCombo(combo);
        this.shortcuts.delete(normalizedCombo);
    }

    /**
     * Handle keydown event
     */
    _onKeyDown(event) {
        // Update modifier state
        this.activeModifiers.ctrl = event.ctrlKey;
        this.activeModifiers.shift = event.shiftKey;
        this.activeModifiers.alt = event.altKey;
        this.activeModifiers.meta = event.metaKey;

        // Don't handle shortcuts when typing in inputs
        if (this._isTyping(event)) {
            return;
        }

        // Build combo string
        const combo = this._buildCombo(event);

        // Check for registered shortcut
        const shortcut = this.shortcuts.get(combo);

        if (shortcut) {
            event.preventDefault();
            event.stopPropagation();

            this.emit('shortcut', {
                action: shortcut.action,
                combo,
                event,
            });

            // Also emit specific action event
            this.emit(shortcut.action, { combo, event });
        }

        // Always emit raw keydown
        this.emit('keydown', { key: event.key, code: event.code, combo, event });
    }

    /**
     * Handle keyup event
     */
    _onKeyUp(event) {
        // Update modifier state
        this.activeModifiers.ctrl = event.ctrlKey;
        this.activeModifiers.shift = event.shiftKey;
        this.activeModifiers.alt = event.altKey;
        this.activeModifiers.meta = event.metaKey;

        this.emit('keyup', { key: event.key, code: event.code, event });

        // Emit specific key release events
        if (event.key === ' ') {
            this.emit('panModeEnd');
        }
    }

    /**
     * Check if user is typing in an input
     */
    _isTyping(event) {
        const target = event.target;
        const tagName = target.tagName.toLowerCase();

        return tagName === 'input' ||
               tagName === 'textarea' ||
               target.isContentEditable;
    }

    /**
     * Build combo string from event
     */
    _buildCombo(event) {
        const parts = [];

        if (event.ctrlKey || event.metaKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');

        // Normalize key name
        let key = event.key.toLowerCase();

        // Handle special keys
        const keyMap = {
            ' ': 'space',
            'arrowup': 'up',
            'arrowdown': 'down',
            'arrowleft': 'left',
            'arrowright': 'right',
            'escape': 'escape',
            'enter': 'enter',
            'tab': 'tab',
            '+': '=', // For zoom in
        };

        key = keyMap[key] || key;

        // Don't add modifier keys as the main key
        if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
            parts.push(key);
        }

        return parts.join('+');
    }

    /**
     * Normalize a combo string
     */
    _normalizeCombo(combo) {
        return combo.toLowerCase()
            .replace('cmd', 'ctrl')
            .replace('command', 'ctrl')
            .replace('option', 'alt')
            .split('+')
            .sort((a, b) => {
                // Sort modifiers first, then main key
                const order = ['ctrl', 'shift', 'alt'];
                const aIdx = order.indexOf(a);
                const bIdx = order.indexOf(b);

                if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
                if (aIdx >= 0) return -1;
                if (bIdx >= 0) return 1;
                return 0;
            })
            .join('+');
    }

    /**
     * Get all registered shortcuts
     * @returns {Array} Array of shortcut objects
     */
    getShortcuts() {
        const result = [];

        for (const [combo, data] of this.shortcuts) {
            result.push({
                combo,
                action: data.action,
                description: data.description,
            });
        }

        return result;
    }

    /**
     * Check if a modifier is currently pressed
     * @param {string} modifier - 'ctrl', 'shift', 'alt', 'meta'
     * @returns {boolean}
     */
    isModifierPressed(modifier) {
        return this.activeModifiers[modifier] || false;
    }

    /**
     * Check if space is held (for pan mode)
     */
    isSpaceHeld() {
        return this._spaceHeld || false;
    }
}

// Global keyboard handler instance
window.KeyboardHandler = new KeyboardHandler();
