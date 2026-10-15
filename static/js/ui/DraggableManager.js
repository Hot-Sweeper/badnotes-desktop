/**
 * DraggableManager - Handles drag and drop with Apple-style animations
 * Supports reordering, recycling bin drops, and canvas color fills
 */
class DraggableManager {
    constructor(options = {}) {
        this.recyclingBin = options.recyclingBin;
        this.canvasManager = options.canvasManager;

        // Track drag state
        this.isDragging = false;
        this.dragElement = null;
        this.dragGhost = null;
        this.dragType = null;
        this.dragData = null;
        this.dragSource = null;
        this.dragIndex = -1;

        // Placeholder for reordering
        this.placeholder = null;

        // Drop targets
        this.dropTargets = new Map();

        // Animation settings
        this.animationDuration = 300;
    }

    /**
     * Make color swatches draggable with reordering
     */
    initColorSwatches(container, getColors, onReorder, onRemove) {
        if (!container) return;

        const swatches = container.querySelectorAll('.quick-color-btn, .preset-color');

        swatches.forEach((swatch, index) => {
            this.makeColorDraggable(swatch, index, container, getColors, onReorder, onRemove);
        });
    }

    /**
     * Make a single color swatch draggable
     */
    makeColorDraggable(element, index, container, getColors, onReorder, onRemove) {
        element.draggable = true;
        element.dataset.dragIndex = index;
        element.classList.add('draggable-color');

        element.addEventListener('dragstart', (e) => {
            this.startDrag(e, 'color', {
                value: element.dataset.color || element.style.backgroundColor,
                index: index
            }, element, container);
        });

        element.addEventListener('dragend', (e) => {
            this.endDrag(e);
        });

        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.dragType === 'color' && this.dragSource === container) {
                this.handleColorReorderOver(e, element, container);
            }
        });

        element.addEventListener('dragleave', (e) => {
            element.classList.remove('drag-before', 'drag-after');
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.dragType === 'color' && this.dragSource === container) {
                const targetIndex = parseInt(element.dataset.dragIndex);
                if (targetIndex !== this.dragIndex) {
                    onReorder(this.dragIndex, targetIndex);
                }
            }
            element.classList.remove('drag-before', 'drag-after');
        });
    }

    /**
     * Handle color reorder drag over
     */
    handleColorReorderOver(e, element, container) {
        e.preventDefault();
        const rect = element.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;

        // Remove previous indicators
        container.querySelectorAll('.drag-before, .drag-after').forEach(el => {
            if (el !== element) {
                el.classList.remove('drag-before', 'drag-after');
            }
        });

        if (e.clientX < midX) {
            element.classList.add('drag-before');
            element.classList.remove('drag-after');
        } else {
            element.classList.add('drag-after');
            element.classList.remove('drag-before');
        }
    }

    /**
     * Make page thumbnails draggable with reordering
     */
    initPageThumbnails(container, getPages, onReorder, onRemove) {
        if (!container) return;

        const thumbnails = container.querySelectorAll('.page-thumbnail');

        thumbnails.forEach((thumb, index) => {
            this.makePageDraggable(thumb, index, container, getPages, onReorder, onRemove);
        });
    }

    /**
     * Make a page thumbnail draggable
     */
    makePageDraggable(element, index, container, getPages, onReorder, onRemove) {
        element.draggable = true;
        element.dataset.dragIndex = index;
        element.classList.add('draggable-page');

        element.addEventListener('dragstart', (e) => {
            const pageData = {
                id: element.dataset.pageId,
                pageNumber: index + 1,
                index: index
            };
            this.startDrag(e, 'page', pageData, element, container);
        });

        element.addEventListener('dragend', (e) => {
            this.endDrag(e);
        });

        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.dragType === 'page' && this.dragSource === container) {
                this.handlePageReorderOver(e, element, container);
            }
        });

        element.addEventListener('dragleave', (e) => {
            element.classList.remove('drop-before', 'drop-after');
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.dragType === 'page' && this.dragSource === container) {
                const targetIndex = parseInt(element.dataset.dragIndex);
                if (targetIndex !== this.dragIndex) {
                    onReorder(this.dragIndex, targetIndex);
                }
            }
            element.classList.remove('drop-before', 'drop-after');
        });
    }

    /**
     * Handle page reorder drag over
     */
    handlePageReorderOver(e, element, container) {
        e.preventDefault();
        const rect = element.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        // Remove previous indicators
        container.querySelectorAll('.drop-before, .drop-after').forEach(el => {
            if (el !== element) {
                el.classList.remove('drop-before', 'drop-after');
            }
        });

        if (e.clientY < midY) {
            element.classList.add('drop-before');
            element.classList.remove('drop-after');
        } else {
            element.classList.add('drop-after');
            element.classList.remove('drop-before');
        }
    }

    /**
     * Make notebooks draggable
     */
    initNotebooks(container, getNotebooks, onReorder, onRemove) {
        if (!container) return;

        const notebooks = container.querySelectorAll('.notebook-item');

        notebooks.forEach((notebook, index) => {
            this.makeNotebookDraggable(notebook, index, container, getNotebooks, onReorder, onRemove);
        });
    }

    /**
     * Make a notebook item draggable
     */
    makeNotebookDraggable(element, index, container, getNotebooks, onReorder, onRemove) {
        element.draggable = true;
        element.dataset.dragIndex = index;
        element.classList.add('draggable-notebook');

        element.addEventListener('dragstart', (e) => {
            const notebookData = {
                id: element.dataset.id,
                name: element.querySelector('.notebook-name, .notebook-title')?.textContent || 'Untitled',
                color: element.querySelector('.notebook-icon, .notebook-cover')?.style.backgroundColor || '#6c5ce7',
                index: index
            };
            this.startDrag(e, 'notebook', notebookData, element, container);
        });

        element.addEventListener('dragend', (e) => {
            this.endDrag(e);
        });
    }

    /**
     * Start drag operation
     */
    startDrag(e, type, data, element, source) {
        this.isDragging = true;
        this.dragType = type;
        this.dragData = data;
        this.dragElement = element;
        this.dragSource = source;
        this.dragIndex = data.index;

        // Set transfer data
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-badnotes-type', type);
        e.dataTransfer.setData('application/x-badnotes-data', JSON.stringify(data));

        // Create custom drag image
        this.createDragGhost(e, type, data, element);

        // Add dragging class
        element.classList.add('dragging');
        document.body.classList.add('is-dragging');

        // Emit event
        this.emit('dragstart', { type, data, element });
    }

    /**
     * Create custom drag ghost
     */
    createDragGhost(e, type, data, element) {
        this.dragGhost = document.createElement('div');
        this.dragGhost.className = `drag-ghost drag-ghost-${type}`;

        switch (type) {
            case 'color':
                this.dragGhost.innerHTML = `
                    <div class="ghost-color" style="background-color: ${data.value}"></div>
                `;
                break;
            case 'page':
                this.dragGhost.innerHTML = `
                    <div class="ghost-page">
                        <svg class="icon" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
                        </svg>
                        <span>Page ${data.pageNumber}</span>
                    </div>
                `;
                break;
            case 'notebook':
                this.dragGhost.innerHTML = `
                    <div class="ghost-notebook" style="background-color: ${data.color}">
                        <svg class="icon" viewBox="0 0 24 24">
                            <path fill="white" d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
                        </svg>
                        <span>${data.name}</span>
                    </div>
                `;
                break;
        }

        document.body.appendChild(this.dragGhost);

        // Position ghost
        const rect = element.getBoundingClientRect();
        this.dragGhost.style.left = `${e.clientX}px`;
        this.dragGhost.style.top = `${e.clientY}px`;

        // Use custom drag image
        e.dataTransfer.setDragImage(this.dragGhost, 20, 20);
    }

    /**
     * End drag operation
     */
    endDrag(e) {
        this.isDragging = false;

        // Remove dragging class
        if (this.dragElement) {
            this.dragElement.classList.remove('dragging');
        }
        document.body.classList.remove('is-dragging');

        // Remove ghost
        if (this.dragGhost) {
            this.dragGhost.remove();
            this.dragGhost = null;
        }

        // Remove all drop indicators
        document.querySelectorAll('.drag-before, .drag-after, .drop-before, .drop-after').forEach(el => {
            el.classList.remove('drag-before', 'drag-after', 'drop-before', 'drop-after');
        });

        // Reset state
        this.dragType = null;
        this.dragData = null;
        this.dragElement = null;
        this.dragSource = null;
        this.dragIndex = -1;

        this.emit('dragend', e);
    }

    /**
     * Register canvas as drop target for color fill
     */
    initCanvasDrop(canvasContainer, onColorDrop) {
        if (!canvasContainer) return;

        canvasContainer.addEventListener('dragover', (e) => {
            if (this.dragType === 'color') {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                canvasContainer.classList.add('canvas-drop-target');
            }
        });

        canvasContainer.addEventListener('dragleave', (e) => {
            canvasContainer.classList.remove('canvas-drop-target');
        });

        canvasContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            canvasContainer.classList.remove('canvas-drop-target');

            if (this.dragType === 'color') {
                const rect = canvasContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                onColorDrop(this.dragData.value, x, y);
            }
        });
    }

    /**
     * Simple event emitter methods
     */
    emit(event, data) {
        const handlers = this._handlers?.[event];
        if (handlers) {
            handlers.forEach(fn => fn(data));
        }
    }

    on(event, handler) {
        if (!this._handlers) this._handlers = {};
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
    }

    off(event, handler) {
        if (!this._handlers?.[event]) return;
        const index = this._handlers[event].indexOf(handler);
        if (index > -1) {
            this._handlers[event].splice(index, 1);
        }
    }
}

// Make available globally
window.DraggableManager = DraggableManager;
