/**
 * LayerManager - Layer management for canvas elements
 * Supports multiple layers with visibility, opacity, and locking
 */
class LayerManager extends EventEmitter {
    constructor() {
        super();

        this.layers = [];
        this.activeLayerId = null;
        this.maxLayers = 20;
    }

    /**
     * Initialize with default layer
     */
    init() {
        this.createLayer('Layer 1', true);
        this.emit('initialized');
    }

    /**
     * Create a new layer
     * @param {string} name - Layer name
     * @param {boolean} setActive - Whether to set as active layer
     * @returns {Object} Created layer
     */
    createLayer(name, setActive = false) {
        if (this.layers.length >= this.maxLayers) {
            this.emit('error', { message: 'Maximum layers reached' });
            return null;
        }

        const layer = {
            id: this._generateId(),
            name: name || `Layer ${this.layers.length + 1}`,
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            elements: [],
            order: this.layers.length,
            createdAt: Date.now(),
        };

        this.layers.push(layer);

        if (setActive || this.layers.length === 1) {
            this.setActiveLayer(layer.id);
        }

        this.emit('layerCreated', layer);
        return layer;
    }

    /**
     * Delete a layer
     * @param {string} layerId - Layer ID
     */
    deleteLayer(layerId) {
        if (this.layers.length <= 1) {
            this.emit('error', { message: 'Cannot delete last layer' });
            return false;
        }

        const index = this.layers.findIndex(l => l.id === layerId);
        if (index === -1) return false;

        const layer = this.layers.splice(index, 1)[0];

        // Update order for remaining layers
        this.layers.forEach((l, i) => l.order = i);

        // Set new active layer if needed
        if (this.activeLayerId === layerId) {
            this.setActiveLayer(this.layers[Math.max(0, index - 1)].id);
        }

        this.emit('layerDeleted', layer);
        return true;
    }

    /**
     * Duplicate a layer
     * @param {string} layerId - Layer ID to duplicate
     * @returns {Object} Duplicated layer
     */
    duplicateLayer(layerId) {
        const layer = this.getLayer(layerId);
        if (!layer) return null;

        const duplicate = this.createLayer(`${layer.name} Copy`);
        if (!duplicate) return null;

        // Deep copy elements
        duplicate.elements = JSON.parse(JSON.stringify(layer.elements));
        duplicate.visible = layer.visible;
        duplicate.opacity = layer.opacity;
        duplicate.blendMode = layer.blendMode;

        // Assign new IDs to elements
        duplicate.elements.forEach(el => {
            el.id = this._generateId();
        });

        this.emit('layerDuplicated', { original: layer, duplicate });
        return duplicate;
    }

    /**
     * Merge a layer down
     * @param {string} layerId - Layer ID to merge down
     */
    mergeLayerDown(layerId) {
        const index = this.layers.findIndex(l => l.id === layerId);
        if (index <= 0) {
            this.emit('error', { message: 'Cannot merge bottom layer' });
            return false;
        }

        const topLayer = this.layers[index];
        const bottomLayer = this.layers[index - 1];

        if (bottomLayer.locked) {
            this.emit('error', { message: 'Cannot merge into locked layer' });
            return false;
        }

        // Move elements to bottom layer
        bottomLayer.elements.push(...topLayer.elements);

        // Delete top layer
        this.deleteLayer(layerId);

        this.emit('layersMerged', { merged: bottomLayer });
        return true;
    }

    /**
     * Flatten all layers
     * @returns {Object} Flattened layer
     */
    flattenAll() {
        if (this.layers.length <= 1) return this.layers[0];

        const flattened = this.createLayer('Flattened');
        if (!flattened) return null;

        // Collect all elements from visible layers in order
        for (const layer of this.getLayersInOrder()) {
            if (layer.visible && layer.id !== flattened.id) {
                flattened.elements.push(...layer.elements.map(el => ({
                    ...el,
                    id: this._generateId(),
                })));
            }
        }

        // Delete all other layers
        const layerIds = this.layers
            .filter(l => l.id !== flattened.id)
            .map(l => l.id);

        for (const id of layerIds) {
            const index = this.layers.findIndex(l => l.id === id);
            if (index !== -1) {
                this.layers.splice(index, 1);
            }
        }

        flattened.order = 0;
        this.setActiveLayer(flattened.id);

        this.emit('layersFlattened', flattened);
        return flattened;
    }

    /**
     * Set active layer
     * @param {string} layerId - Layer ID
     */
    setActiveLayer(layerId) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        this.activeLayerId = layerId;
        this.emit('activeLayerChanged', layer);
        return true;
    }

    /**
     * Get active layer
     * @returns {Object} Active layer
     */
    getActiveLayer() {
        return this.getLayer(this.activeLayerId);
    }

    /**
     * Get layer by ID
     * @param {string} layerId - Layer ID
     * @returns {Object} Layer
     */
    getLayer(layerId) {
        return this.layers.find(l => l.id === layerId);
    }

    /**
     * Get all layers in order (bottom to top)
     * @returns {Array} Ordered layers
     */
    getLayersInOrder() {
        return [...this.layers].sort((a, b) => a.order - b.order);
    }

    /**
     * Set layer visibility
     * @param {string} layerId - Layer ID
     * @param {boolean} visible - Visibility state
     */
    setLayerVisibility(layerId, visible) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        layer.visible = visible;
        this.emit('layerVisibilityChanged', { layer, visible });
        return true;
    }

    /**
     * Set layer lock state
     * @param {string} layerId - Layer ID
     * @param {boolean} locked - Lock state
     */
    setLayerLocked(layerId, locked) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        layer.locked = locked;
        this.emit('layerLockChanged', { layer, locked });
        return true;
    }

    /**
     * Set layer opacity
     * @param {string} layerId - Layer ID
     * @param {number} opacity - Opacity (0-1)
     */
    setLayerOpacity(layerId, opacity) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        layer.opacity = Math.max(0, Math.min(1, opacity));
        this.emit('layerOpacityChanged', { layer, opacity: layer.opacity });
        return true;
    }

    /**
     * Set layer blend mode
     * @param {string} layerId - Layer ID
     * @param {string} blendMode - Blend mode
     */
    setLayerBlendMode(layerId, blendMode) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        layer.blendMode = blendMode;
        this.emit('layerBlendModeChanged', { layer, blendMode });
        return true;
    }

    /**
     * Rename a layer
     * @param {string} layerId - Layer ID
     * @param {string} name - New name
     */
    renameLayer(layerId, name) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        layer.name = name;
        this.emit('layerRenamed', { layer, name });
        return true;
    }

    /**
     * Move layer to new position
     * @param {string} layerId - Layer ID
     * @param {number} newOrder - New order index
     */
    moveLayer(layerId, newOrder) {
        const layer = this.getLayer(layerId);
        if (!layer) return false;

        newOrder = Math.max(0, Math.min(this.layers.length - 1, newOrder));
        const oldOrder = layer.order;

        if (oldOrder === newOrder) return true;

        // Update other layer orders
        for (const l of this.layers) {
            if (l.id === layerId) continue;

            if (oldOrder < newOrder) {
                if (l.order > oldOrder && l.order <= newOrder) {
                    l.order--;
                }
            } else {
                if (l.order >= newOrder && l.order < oldOrder) {
                    l.order++;
                }
            }
        }

        layer.order = newOrder;

        this.emit('layerMoved', { layer, oldOrder, newOrder });
        return true;
    }

    /**
     * Add element to active layer
     * @param {Object} element - Element to add
     */
    addElement(element) {
        const layer = this.getActiveLayer();
        if (!layer || layer.locked) {
            this.emit('error', { message: 'Cannot add to locked layer' });
            return false;
        }

        layer.elements.push(element);
        this.emit('elementAdded', { layer, element });
        return true;
    }

    /**
     * Remove element from its layer
     * @param {string} elementId - Element ID
     */
    removeElement(elementId) {
        for (const layer of this.layers) {
            const index = layer.elements.findIndex(el => el.id === elementId);
            if (index !== -1) {
                if (layer.locked) {
                    this.emit('error', { message: 'Cannot remove from locked layer' });
                    return false;
                }

                const element = layer.elements.splice(index, 1)[0];
                this.emit('elementRemoved', { layer, element });
                return true;
            }
        }
        return false;
    }

    /**
     * Move element to different layer
     * @param {string} elementId - Element ID
     * @param {string} targetLayerId - Target layer ID
     */
    moveElementToLayer(elementId, targetLayerId) {
        const targetLayer = this.getLayer(targetLayerId);
        if (!targetLayer || targetLayer.locked) {
            return false;
        }

        for (const layer of this.layers) {
            const index = layer.elements.findIndex(el => el.id === elementId);
            if (index !== -1) {
                if (layer.locked) return false;

                const element = layer.elements.splice(index, 1)[0];
                targetLayer.elements.push(element);

                this.emit('elementMoved', { element, fromLayer: layer, toLayer: targetLayer });
                return true;
            }
        }
        return false;
    }

    /**
     * Get all visible elements in render order
     * @returns {Array} Elements
     */
    getVisibleElements() {
        const elements = [];

        for (const layer of this.getLayersInOrder()) {
            if (layer.visible) {
                for (const element of layer.elements) {
                    elements.push({
                        ...element,
                        layerId: layer.id,
                        layerOpacity: layer.opacity,
                        layerBlendMode: layer.blendMode,
                    });
                }
            }
        }

        return elements;
    }

    /**
     * Export layers data
     * @returns {Object} Layers data
     */
    export() {
        return {
            layers: this.layers.map(layer => ({
                ...layer,
                elements: layer.elements.map(el => ({ ...el })),
            })),
            activeLayerId: this.activeLayerId,
        };
    }

    /**
     * Import layers data
     * @param {Object} data - Layers data
     */
    import(data) {
        if (!data || !data.layers) return false;

        this.layers = data.layers.map(layer => ({
            ...layer,
            elements: layer.elements.map(el => ({ ...el })),
        }));

        this.activeLayerId = data.activeLayerId || this.layers[0]?.id;

        this.emit('layersImported', this.layers);
        return true;
    }

    /**
     * Clear all layers
     */
    clear() {
        this.layers = [];
        this.activeLayerId = null;
        this.createLayer('Layer 1', true);
    }

    _generateId() {
        return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Global layer manager instance
window.LayerManager = new LayerManager();
