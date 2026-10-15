/**
 * EventEmitter - Core event handling system
 * Provides pub/sub functionality for decoupled module communication
 */
class EventEmitter {
    constructor() {
        this._events = new Map();
        this._onceEvents = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        this._events.get(event).add(callback);

        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event once
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     */
    once(event, callback) {
        if (!this._onceEvents.has(event)) {
            this._onceEvents.set(event, new Set());
        }
        this._onceEvents.get(event).add(callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Event handler to remove
     */
    off(event, callback) {
        if (this._events.has(event)) {
            this._events.get(event).delete(callback);
        }
        if (this._onceEvents.has(event)) {
            this._onceEvents.get(event).delete(callback);
        }
    }

    /**
     * Emit an event
     * PERFORMANCE: Optimized with fast-path for common case (no listeners)
     * @param {string} event - Event name
     * @param {...any} args - Arguments to pass to handlers
     */
    emit(event, ...args) {
        // PERFORMANCE: Get references once and check size
        const listeners = this._events.get(event);
        const onceListeners = this._onceEvents.get(event);

        // Fast path: no listeners at all
        if (!listeners && !onceListeners) return;

        // Call regular subscribers
        if (listeners && listeners.size > 0) {
            for (const callback of listeners) {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in event handler for "${event}":`, error);
                }
            }
        }

        // Call once subscribers and remove them
        if (onceListeners && onceListeners.size > 0) {
            for (const callback of onceListeners) {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in once handler for "${event}":`, error);
                }
            }
            this._onceEvents.delete(event);
        }
    }

    /**
     * Remove all listeners for an event or all events
     * @param {string} [event] - Optional event name
     */
    removeAllListeners(event) {
        if (event) {
            this._events.delete(event);
            this._onceEvents.delete(event);
        } else {
            this._events.clear();
            this._onceEvents.clear();
        }
    }

    /**
     * Get listener count for an event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
        let count = 0;
        if (this._events.has(event)) {
            count += this._events.get(event).size;
        }
        if (this._onceEvents.has(event)) {
            count += this._onceEvents.get(event).size;
        }
        return count;
    }
}

// Global event bus for cross-module communication
window.EventBus = new EventEmitter();

// Export for module use
window.EventEmitter = EventEmitter;
