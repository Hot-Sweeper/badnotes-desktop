/**
 * RecyclingBin - Global recycling bin for notebooks, pages, and colors
 * Supports drag & drop, restore, and permanent deletion
 */
class RecyclingBin {
    constructor(options = {}) {
        this.element = null;
        this.modalElement = null;
        this.isOpen = false;

        // Recycled items by category
        this.items = {
            notebooks: [],
            pages: [],
            colors: []
        };

        // Available categories (modular for future expansion)
        this.categories = [
            { id: 'notebooks', label: 'Notebooks', icon: 'notebook' },
            { id: 'pages', label: 'Pages', icon: 'page' },
            { id: 'colors', label: 'Colors', icon: 'palette' }
        ];

        this.currentCategory = 'notebooks';

        // Event handlers
        this._handlers = {};

        // Load persisted items
        this.loadFromStorage();

        // Initialize
        this.init();
    }

    /**
     * Initialize recycling bin
     */
    init() {
        this.createBinIcon();
        this.createModal();
        this.bindEvents();
        this.setupGlobalDragListeners();
    }

    /**
     * Create the bin icon in bottom left corner
     */
    createBinIcon() {
        this.element = document.createElement('div');
        this.element.className = 'recycling-bin';
        this.element.innerHTML = `
            <div class="recycling-bin-icon">
                <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
                <span class="recycling-bin-count">0</span>
            </div>
        `;

        document.body.appendChild(this.element);
        this.updateCount();
    }

    /**
     * Create the recycling bin modal
     */
    createModal() {
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'recycling-bin-modal';
        this.modalElement.hidden = true;
        this.modalElement.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content recycling-bin-panel">
                <div class="modal-header">
                    <h3>Recycling Bin</h3>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="recycling-bin-tabs">
                    ${this.categories.map(cat => `
                        <button class="recycling-tab ${cat.id === this.currentCategory ? 'active' : ''}"
                                data-category="${cat.id}">
                            ${cat.label}
                            <span class="tab-count">${this.items[cat.id]?.length || 0}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="recycling-bin-content">
                    <div class="recycling-items-list"></div>
                    <div class="recycling-empty-state" hidden>
                        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                        <p>No items in this category</p>
                    </div>
                </div>
                <div class="recycling-bin-footer">
                    <button class="btn danger" id="empty-bin-btn">Empty Category</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.modalElement);
    }

    /**
     * Setup global drag listeners for catching drops
     */
    setupGlobalDragListeners() {
        // Listen for drag events on color buttons
        document.addEventListener('dragstart', (e) => {
            const colorBtn = e.target.closest('.quick-color-btn, .preset-color');
            if (colorBtn) {
                const color = colorBtn.dataset.color || colorBtn.style.backgroundColor;
                e.dataTransfer.setData('text/plain', color);
                e.dataTransfer.setData('application/x-badnotes-type', 'color');
                e.dataTransfer.setData('application/x-badnotes-data', JSON.stringify({ value: color }));
                e.dataTransfer.effectAllowed = 'move';
                colorBtn.classList.add('dragging');
            }
        });

        document.addEventListener('dragend', (e) => {
            const colorBtn = e.target.closest('.quick-color-btn, .preset-color');
            if (colorBtn) {
                colorBtn.classList.remove('dragging');
            }
        });
    }

    /**
     * Bind events
     */
    bindEvents() {
        // Click to open modal
        this.element.addEventListener('click', (e) => {
            e.stopPropagation();
            this.open();
        });

        // Drag over bin
        this.element.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            this.element.classList.add('drag-over');
        });

        this.element.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.element.classList.remove('drag-over');
        });

        this.element.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.element.classList.remove('drag-over');

            const type = e.dataTransfer.getData('application/x-badnotes-type');
            const dataStr = e.dataTransfer.getData('application/x-badnotes-data');
            const plainText = e.dataTransfer.getData('text/plain');

            if (type && dataStr) {
                try {
                    const itemData = JSON.parse(dataStr);
                    this.addItem(type, itemData);
                    this.animateReceive();
                } catch (err) {
                    console.error('Failed to parse dropped data:', err);
                }
            } else if (plainText) {
                // Could be a color (hex, rgb, or any color format)
                const colorValue = plainText.trim();
                if (colorValue.startsWith('#') || colorValue.startsWith('rgb') || /^[a-zA-Z]+$/.test(colorValue)) {
                    this.addItem('color', { value: colorValue });
                    this.animateReceive();
                }
            }
        });

        // Modal events
        const closeBtn = this.modalElement.querySelector('.modal-close-btn');
        closeBtn.addEventListener('click', () => this.close());

        const backdrop = this.modalElement.querySelector('.modal-backdrop');
        backdrop.addEventListener('click', () => this.close());

        // Tab switching
        const tabs = this.modalElement.querySelectorAll('.recycling-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchCategory(tab.dataset.category);
            });
        });

        // Empty bin button
        const emptyBtn = this.modalElement.querySelector('#empty-bin-btn');
        emptyBtn.addEventListener('click', () => this.emptyCurrentCategory());

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    /**
     * Open the recycling bin modal
     */
    open() {
        this.isOpen = true;
        this.modalElement.hidden = false;
        this.renderItems();

        requestAnimationFrame(() => {
            this.modalElement.classList.add('show');
        });
    }

    /**
     * Close the modal
     */
    close() {
        this.isOpen = false;
        this.modalElement.classList.remove('show');

        setTimeout(() => {
            this.modalElement.hidden = true;
        }, 200);
    }

    /**
     * Switch category tab
     */
    switchCategory(category) {
        this.currentCategory = category;

        const tabs = this.modalElement.querySelectorAll('.recycling-tab');
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });

        this.renderItems();
    }

    /**
     * Add item to recycling bin
     */
    addItem(type, data) {
        const category = this.getCategoryForType(type);
        if (!category) {
            return;
        }

        const item = {
            id: data.id || `${type}_${Date.now()}`,
            type,
            data,
            deletedAt: new Date().toISOString()
        };

        this.items[category].unshift(item);
        this.saveToStorage();
        this.updateCount();
        this.updateTabCounts();

        this.emit('itemRecycled', { type, data, category });

        // Show toast
        if (window.Toast) {
            Toast.info('Moved to Recycling Bin');
        }
    }

    /**
     * Get category for item type
     */
    getCategoryForType(type) {
        switch (type) {
            case 'notebook':
                return 'notebooks';
            case 'page':
                return 'pages';
            case 'color':
                return 'colors';
            default:
                return null;
        }
    }

    /**
     * Render items for current category
     */
    renderItems() {
        const container = this.modalElement.querySelector('.recycling-items-list');
        const emptyState = this.modalElement.querySelector('.recycling-empty-state');
        const items = this.items[this.currentCategory] || [];

        if (items.length === 0) {
            container.innerHTML = '';
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;
        container.innerHTML = '';

        items.forEach((item, index) => {
            const el = this.createItemElement(item, index);
            container.appendChild(el);
        });
    }

    /**
     * Create item element
     */
    createItemElement(item, index) {
        const el = document.createElement('div');
        el.className = 'recycling-item';
        el.dataset.index = index;

        const deletedDate = new Date(item.deletedAt);
        const dateStr = deletedDate.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        let previewHTML = '';
        let nameHTML = '';

        switch (item.type) {
            case 'notebook':
                previewHTML = `
                    <div class="recycling-item-preview notebook-preview"
                         style="background-color: ${item.data.color || '#6c5ce7'}">
                        <svg class="icon" viewBox="0 0 24 24" fill="white">
                            <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
                        </svg>
                    </div>
                `;
                nameHTML = `
                    <span class="recycling-item-name">${this.escapeHtml(item.data.name || 'Untitled')}</span>
                    <span class="recycling-item-meta">${item.data.pageCount || 0} pages · ${dateStr}</span>
                `;
                break;
            case 'page':
                previewHTML = `
                    <div class="recycling-item-preview page-preview">
                        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                        </svg>
                    </div>
                `;
                nameHTML = `
                    <span class="recycling-item-name">Page ${item.data.pageNumber || '?'}</span>
                    <span class="recycling-item-meta">${dateStr}</span>
                `;
                break;
            case 'color':
                const colorValue = item.data.value || item.data;
                previewHTML = `
                    <div class="recycling-item-preview color-preview"
                         style="background-color: ${colorValue}"></div>
                `;
                nameHTML = `
                    <span class="recycling-item-name">${colorValue}</span>
                    <span class="recycling-item-meta">${dateStr}</span>
                `;
                break;
        }

        el.innerHTML = `
            ${previewHTML}
            <div class="recycling-item-info">
                ${nameHTML}
            </div>
            <div class="recycling-item-actions">
                <button class="btn small secondary restore-btn" title="Restore">↩ Restore</button>
                <button class="btn small danger delete-btn" title="Delete Forever">✕ Delete</button>
            </div>
        `;

        // Bind action buttons
        const restoreBtn = el.querySelector('.restore-btn');
        const deleteBtn = el.querySelector('.delete-btn');

        restoreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.restoreItem(index);
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteItem(index);
        });

        return el;
    }

    /**
     * Restore an item
     */
    restoreItem(index) {
        const items = this.items[this.currentCategory];
        if (index < 0 || index >= items.length) return;

        const item = items[index];
        items.splice(index, 1);

        this.saveToStorage();
        this.updateCount();
        this.updateTabCounts();
        this.renderItems();

        this.emit('itemRestored', { type: item.type, data: item.data, category: this.currentCategory });

        if (window.Toast) {
            Toast.success('Item restored');
        }
    }

    /**
     * Permanently delete an item
     */
    deleteItem(index) {
        const items = this.items[this.currentCategory];
        if (index < 0 || index >= items.length) return;

        const item = items[index];
        const name = item.data.name || item.data.value || 'this item';

        if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) {
            return;
        }

        items.splice(index, 1);

        this.saveToStorage();
        this.updateCount();
        this.updateTabCounts();
        this.renderItems();

        this.emit('itemDeleted', { type: item.type, data: item.data, category: this.currentCategory });

        if (window.Toast) {
            Toast.success('Permanently deleted');
        }
    }

    /**
     * Empty current category
     */
    emptyCurrentCategory() {
        const items = this.items[this.currentCategory];
        if (items.length === 0) return;

        const categoryLabel = this.categories.find(c => c.id === this.currentCategory)?.label || 'items';

        if (!confirm(`Permanently delete all ${items.length} ${categoryLabel.toLowerCase()}?`)) {
            return;
        }

        this.items[this.currentCategory] = [];

        this.saveToStorage();
        this.updateCount();
        this.updateTabCounts();
        this.renderItems();

        if (window.Toast) {
            Toast.success(`Emptied ${categoryLabel}`);
        }
    }

    /**
     * Update the count badge
     */
    updateCount() {
        const total = Object.values(this.items).reduce((sum, arr) => sum + arr.length, 0);
        const countEl = this.element.querySelector('.recycling-bin-count');

        if (countEl) {
            countEl.textContent = total;
            countEl.style.display = total > 0 ? 'flex' : 'none';
        }

        this.element.classList.toggle('has-items', total > 0);
    }

    /**
     * Update tab counts
     */
    updateTabCounts() {
        if (!this.modalElement) return;

        const tabs = this.modalElement.querySelectorAll('.recycling-tab');
        tabs.forEach(tab => {
            const category = tab.dataset.category;
            const count = this.items[category]?.length || 0;
            const countEl = tab.querySelector('.tab-count');
            if (countEl) {
                countEl.textContent = count;
            }
        });
    }

    /**
     * Animate receive
     */
    animateReceive() {
        this.element.classList.add('receive');
        setTimeout(() => {
            this.element.classList.remove('receive');
        }, 400);
    }

    /**
     * Save to localStorage
     */
    saveToStorage() {
        try {
            localStorage.setItem('badnotes_recycling_bin', JSON.stringify(this.items));
        } catch (e) {
            console.error('Failed to save recycling bin:', e);
        }
    }

    /**
     * Load from localStorage
     */
    loadFromStorage() {
        try {
            const data = localStorage.getItem('badnotes_recycling_bin');
            if (data) {
                const parsed = JSON.parse(data);
                this.items = {
                    notebooks: parsed.notebooks || [],
                    pages: parsed.pages || [],
                    colors: parsed.colors || []
                };
            }
        } catch (e) {
            console.error('Failed to load recycling bin:', e);
        }
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Event emitter methods
     */
    on(event, handler) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
    }

    off(event, handler) {
        if (!this._handlers[event]) return;
        const index = this._handlers[event].indexOf(handler);
        if (index > -1) this._handlers[event].splice(index, 1);
    }

    emit(event, data) {
        if (!this._handlers[event]) return;
        this._handlers[event].forEach(fn => {
            try {
                fn(data);
            } catch (e) {
                console.error('Error in event handler:', e);
            }
        });
    }
}

// Make available globally
window.RecyclingBin = RecyclingBin;
