/**
 * HistoryManager - Undo/Redo system for canvas operations
 * Supports grouped actions and memory-efficient state storage
 */
class HistoryManager extends EventEmitter {
    constructor(options = {}) {
        super();

        this.maxHistory = options.maxHistory || 100;
        this.undoStack = [];
        this.redoStack = [];
        this.groupStack = [];
        this.isGrouping = false;
        this.currentGroup = null;

        // Debounce for rapid changes
        this.debounceTimeout = null;
        this.debounceDelay = options.debounceDelay || 100;
    }

    /**
     * Push an action to history
     * @param {Object} action - Action object with type and data
     */
    push(action) {
        const historyItem = {
            id: this._generateId(),
            timestamp: Date.now(),
            type: action.type,
            data: action.data,
            undo: action.undo,
            redo: action.redo,
        };

        if (this.isGrouping && this.currentGroup) {
            this.currentGroup.actions.push(historyItem);
        } else {
            this.undoStack.push(historyItem);

            // Clear redo stack when new action is added
            this.redoStack = [];

            // Limit history size
            while (this.undoStack.length > this.maxHistory) {
                this.undoStack.shift();
            }
        }

        this._updateState();
    }

    /**
     * Push a stroke action (most common)
     * @param {Object} strokeData - Stroke information
     * @param {string} pageId - Page identifier
     */
    pushStroke(strokeData, pageId) {
        this.push({
            type: 'stroke',
            data: { stroke: strokeData, pageId },
            undo: () => this._undoStroke(strokeData, pageId),
            redo: () => this._redoStroke(strokeData, pageId),
        });
    }

    /**
     * Push an erase action
     * @param {Array} erasedStrokes - Array of erased stroke data
     * @param {string} pageId - Page identifier
     */
    pushErase(erasedStrokes, pageId) {
        this.push({
            type: 'erase',
            data: { strokes: erasedStrokes, pageId },
            undo: () => this._undoErase(erasedStrokes, pageId),
            redo: () => this._redoErase(erasedStrokes, pageId),
        });
    }

    /**
     * Push a transform action (move, scale, rotate)
     * @param {Object} transformData - Transform information
     */
    pushTransform(transformData) {
        this.push({
            type: 'transform',
            data: transformData,
            undo: () => this._undoTransform(transformData),
            redo: () => this._redoTransform(transformData),
        });
    }

    /**
     * Start grouping actions (for compound operations)
     * @param {string} [name] - Optional group name
     */
    beginGroup(name = 'Group') {
        if (this.isGrouping) {
            this.groupStack.push(this.currentGroup);
        }

        this.isGrouping = true;
        this.currentGroup = {
            id: this._generateId(),
            name,
            timestamp: Date.now(),
            actions: [],
        };
    }

    /**
     * End current action group
     */
    endGroup() {
        if (!this.isGrouping) return;

        const group = this.currentGroup;

        if (this.groupStack.length > 0) {
            this.currentGroup = this.groupStack.pop();
            if (group.actions.length > 0) {
                this.currentGroup.actions.push(group);
            }
        } else {
            this.isGrouping = false;
            this.currentGroup = null;

            if (group.actions.length > 0) {
                this.undoStack.push({
                    id: group.id,
                    timestamp: group.timestamp,
                    type: 'group',
                    name: group.name,
                    data: group,
                    undo: () => this._undoGroup(group),
                    redo: () => this._redoGroup(group),
                });

                this.redoStack = [];
                this._updateState();
            }
        }
    }

    /**
     * Undo last action
     * @returns {boolean} Success status
     */
    undo() {
        if (!this.canUndo()) return false;

        const action = this.undoStack.pop();

        try {
            if (typeof action.undo === 'function') {
                action.undo();
            }

            this.redoStack.push(action);
            this._updateState();
            this.emit('undo', action);

            return true;
        } catch (error) {
            console.error('Undo failed:', error);
            this.undoStack.push(action);
            return false;
        }
    }

    /**
     * Redo last undone action
     * @returns {boolean} Success status
     */
    redo() {
        if (!this.canRedo()) return false;

        const action = this.redoStack.pop();

        try {
            if (typeof action.redo === 'function') {
                action.redo();
            }

            this.undoStack.push(action);
            this._updateState();
            this.emit('redo', action);

            return true;
        } catch (error) {
            console.error('Redo failed:', error);
            this.redoStack.push(action);
            return false;
        }
    }

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * Clear all history
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.groupStack = [];
        this.isGrouping = false;
        this.currentGroup = null;
        this._updateState();
        this.emit('clear');
    }

    /**
     * Get history info
     * @returns {Object} History information
     */
    getInfo() {
        return {
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length,
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            isGrouping: this.isGrouping,
        };
    }

    // Private methods

    _generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    _updateState() {
        EventBus.emit('history:update', this.getInfo());
    }

    _undoStroke(strokeData, pageId) {
        EventBus.emit('stroke:remove', { stroke: strokeData, pageId });
    }

    _redoStroke(strokeData, pageId) {
        EventBus.emit('stroke:add', { stroke: strokeData, pageId });
    }

    _undoErase(strokes, pageId) {
        strokes.forEach(stroke => {
            EventBus.emit('stroke:add', { stroke, pageId });
        });
    }

    _redoErase(strokes, pageId) {
        strokes.forEach(stroke => {
            EventBus.emit('stroke:remove', { stroke, pageId });
        });
    }

    _undoTransform(transformData) {
        EventBus.emit('transform:apply', {
            elements: transformData.elements,
            transform: transformData.before,
        });
    }

    _redoTransform(transformData) {
        EventBus.emit('transform:apply', {
            elements: transformData.elements,
            transform: transformData.after,
        });
    }

    _undoGroup(group) {
        // Undo actions in reverse order
        for (let i = group.actions.length - 1; i >= 0; i--) {
            const action = group.actions[i];
            if (typeof action.undo === 'function') {
                action.undo();
            } else if (action.actions) {
                this._undoGroup(action);
            }
        }
    }

    _redoGroup(group) {
        // Redo actions in original order
        for (const action of group.actions) {
            if (typeof action.redo === 'function') {
                action.redo();
            } else if (action.actions) {
                this._redoGroup(action);
            }
        }
    }
}

// Global history manager instance
window.HistoryManager = new HistoryManager();
