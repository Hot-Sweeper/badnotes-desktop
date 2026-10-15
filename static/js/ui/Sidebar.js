/**
 * Sidebar - Notebook and page management
 */
class Sidebar extends EventEmitter {
    constructor(options = {}) {
        super();

        this.element = document.querySelector('.sidebar');
        this.isCollapsed = false;

        // Drag state
        this.isDragging = false;
        this.dragMode = null; // 'TOGGLE' or 'RESIZE'
        this.dragStartX = 0;
        this.dragStartWidth = 0;
        this.toggleBtn = null;
        this.resizer = null;

        // Settings
        this.minWidth = 240;
        this.maxWidth = 600;
        this.collapsedWidth = 60; // Approximate, aligns with CSS

        // Current state
        this.notebooks = [];
        this.currentNotebook = null;

        // Initialize
        this.init();
    }

    /**
     * Initialize sidebar
     */
    init() {
        this.createResizer();
        this.bindEvents();
        this.loadNotebooks();
    }

    /**
     * Create resize handle
     */
    createResizer() {
        this.resizer = document.createElement('div');
        this.resizer.className = 'sidebar-resizer';
        this.element.appendChild(this.resizer);
    }

    /**
     * Bind sidebar events
     */
    bindEvents() {
        // Toggle button - Check for ID first, then class
        this.toggleBtn = this.element.querySelector('#sidebar-toggle') || this.element.querySelector('.sidebar-toggle');

        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', (e) => {
                // Prevent toggle if we were dragging
                if (this.isDragging || this.hasDragged) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                this.toggle();
            });

            // Add drag listeners to the button/arrow
            this.toggleBtn.style.touchAction = 'none'; // Ensure JS enforces this
            this.toggleBtn.addEventListener('pointerdown', (e) => this.handleDragStart(e, 'TOGGLE'));
        }

        // Resizer listeners
        if (this.resizer) {
             this.resizer.style.touchAction = 'none'; // Ensure JS enforces this
             this.resizer.addEventListener('pointerdown', (e) => this.handleDragStart(e, 'RESIZE'));
        }

        // Add global pointer events for drag handling
        document.addEventListener('pointermove', (e) => this.handleDragMove(e));
        document.addEventListener('pointerup', (e) => this.handleDragEnd(e));
        document.addEventListener('pointercancel', (e) => this.handleDragEnd(e));

        // New notebook button
        const newNotebookBtn = this.element.querySelector('[data-action="new-notebook"]');
        if (newNotebookBtn) {
            newNotebookBtn.addEventListener('click', () => this.emit('newNotebook'));
        }

        // Search input
        const searchInput = this.element.querySelector('.sidebar-search input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterNotebooks(e.target.value);
            });
        }

        // Notebook list
        const notebookList = this.element.querySelector('.notebook-list');
        if (notebookList) {
            notebookList.addEventListener('click', (e) => {
                const notebookItem = e.target.closest('.notebook-item');
                if (notebookItem) {
                    const notebookId = notebookItem.dataset.id;
                    this.selectNotebook(notebookId);
                }
            });

            // Context menu
            notebookList.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const notebookItem = e.target.closest('.notebook-item');
                if (notebookItem) {
                    this.showContextMenu(e, notebookItem.dataset.id);
                }
            });
        }
    }

    /**
     * Load notebooks from storage
     */
    async loadNotebooks() {
        try {
            this.notebooks = await StorageManager.getNotebooks();
            this.renderNotebookList();

            // Select first notebook if exists
            if (this.notebooks.length > 0 && !this.currentNotebook) {
                this.selectNotebook(this.notebooks[0].id);
            }
        } catch (error) {
            console.error('Failed to load notebooks:', error);
        }
    }

    /**
     * Render notebook list
     */
    renderNotebookList() {
        const listElement = this.element.querySelector('.notebook-list');
        if (!listElement) return;

        listElement.innerHTML = '';

        for (const notebook of this.notebooks) {
            const item = this.createNotebookItem(notebook);
            listElement.appendChild(item);
        }

        // Show empty state if no notebooks
        if (this.notebooks.length === 0) {
            listElement.innerHTML = `
                <div class="empty-state">
                    <i class="icon icon-notebook"></i>
                    <p>No notebooks yet</p>
                    <button class="btn btn-primary" data-action="new-notebook">
                        Create Notebook
                    </button>
                </div>
            `;
        }
    }

    /**
     * Create notebook list item
     */
    createNotebookItem(notebook) {
        const item = document.createElement('div');
        item.className = 'notebook-item';
        item.dataset.id = notebook.id;

        if (this.currentNotebook?.id === notebook.id) {
            item.classList.add('active');
        }

        // Format date
        const date = new Date(notebook.modifiedAt || notebook.createdAt);
        const dateStr = date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });

        item.innerHTML = `
            <div class="notebook-cover" style="background-color: ${notebook.color || 'var(--bg-tertiary)'}">
                <i class="icon icon-notebook"></i>
            </div>
            <div class="notebook-info">
                <span class="notebook-title">${this.escapeHtml(notebook.name)}</span>
                <span class="notebook-meta">${notebook.pageCount || 0} pages · ${dateStr}</span>
            </div>
            <button class="notebook-menu-btn" data-action="menu">
                <i class="icon icon-more"></i>
            </button>
        `;

        // Menu button
        const menuBtn = item.querySelector('.notebook-menu-btn');
        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showContextMenu(e, notebook.id);
            });
        }

        return item;
    }

    /**
     * Select a notebook
     */
    selectNotebook(notebookId) {
        const notebook = this.notebooks.find(n => n.id === notebookId);
        if (!notebook) return;

        // Update UI
        const items = this.element.querySelectorAll('.notebook-item');
        items.forEach(item => {
            item.classList.toggle('active', item.dataset.id === notebookId);
        });

        this.currentNotebook = notebook;
        this.emit('notebookSelected', notebook);
    }

    /**
     * Add a new notebook
     */
    async addNotebook(notebook) {
        this.notebooks.unshift(notebook);
        this.renderNotebookList();
        this.selectNotebook(notebook.id);
    }

    /**
     * Update a notebook
     */
    async updateNotebook(notebookId, updates) {
        const index = this.notebooks.findIndex(n => n.id === notebookId);
        if (index === -1) return;

        this.notebooks[index] = { ...this.notebooks[index], ...updates };
        this.renderNotebookList();
    }

    /**
     * Delete a notebook
     */
    async deleteNotebook(notebookId) {
        const index = this.notebooks.findIndex(n => n.id === notebookId);
        if (index === -1) return;

        this.notebooks.splice(index, 1);
        this.renderNotebookList();

        if (this.currentNotebook?.id === notebookId) {
            this.currentNotebook = null;
            if (this.notebooks.length > 0) {
                this.selectNotebook(this.notebooks[0].id);
            }
        }

        this.emit('notebookDeleted', notebookId);
    }

    /**
     * Filter notebooks by search term
     */
    filterNotebooks(searchTerm) {
        const items = this.element.querySelectorAll('.notebook-item');
        const term = searchTerm.toLowerCase();

        items.forEach(item => {
            const title = item.querySelector('.notebook-title')?.textContent.toLowerCase() || '';
            const visible = title.includes(term);
            item.style.display = visible ? '' : 'none';
        });
    }

    /**
     * Show context menu for notebook
     */
    showContextMenu(event, notebookId) {
        // Remove existing context menu
        const existing = document.querySelector('.context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <button class="context-menu-item" data-action="rename">
                <i class="icon icon-edit"></i>
                Rename
            </button>
            <button class="context-menu-item" data-action="duplicate">
                <i class="icon icon-copy"></i>
                Duplicate
            </button>
            <button class="context-menu-item" data-action="export">
                <i class="icon icon-export"></i>
                Export
            </button>
            <div class="context-menu-divider"></div>
            <button class="context-menu-item recycle" data-action="recycle">
                <i class="icon icon-recycle"></i>
                Move to Recycling Bin
            </button>
        `;

        // Position menu
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;

        document.body.appendChild(menu);

        // Handle menu actions
        menu.addEventListener('click', (e) => {
            const action = e.target.closest('.context-menu-item')?.dataset.action;
            if (action) {
                this.handleContextMenuAction(action, notebookId);
            }
            menu.remove();
        });

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
    }

    /**
     * Handle context menu action
     */
    handleContextMenuAction(action, notebookId) {
        switch (action) {
            case 'rename':
                this.emit('renameNotebook', notebookId);
                break;
            case 'duplicate':
                this.emit('duplicateNotebook', notebookId);
                break;
            case 'export':
                this.emit('exportNotebook', notebookId);
                break;
            case 'recycle':
                this.emit('recycleNotebook', notebookId);
                break;
        }
    }

    /**
     * Toggle sidebar collapsed state
     */
    toggle() {
        this.isCollapsed = !this.isCollapsed;
        this.element.classList.toggle('collapsed', this.isCollapsed);
        this.emit('toggle', this.isCollapsed);
    }

    /**
     * Show sidebar
     */
    show() {
        this.isCollapsed = false;
        this.element.classList.remove('collapsed');
        this.emit('toggle', false);
    }

    hide() {
        this.isCollapsed = true;
        this.element.classList.add('collapsed');
        this.emit('toggle', true);
    }

    handleDragStart(e, mode) {
        // Allow mouse (left button) or touch
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        this.isDragging = true;
        this.hasDragged = false;
        this.dragMode = mode;
        this.dragStartX = e.clientX;

        // Get current width
        const rect = this.element.getBoundingClientRect();
        this.dragStartWidth = rect.width;

        // pointer capture
        if (e.target.setPointerCapture) {
             try {
                e.target.setPointerCapture(e.pointerId);
            } catch (err) { /* Ignore */ }
        }

        if (mode === 'RESIZE') {
            this.resizer.classList.add('active');
            document.body.style.cursor = 'ew-resize';
        }
    }

    /**
     * Handle drag move
     */
    handleDragMove(e) {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.dragStartX;

        // Only consider it a drag if moved more than threshold
        if (Math.abs(deltaX) > 5 || this.dragMode === 'RESIZE') {
            this.hasDragged = true;

            // Disable transition for direct manipulation
            this.element.style.transition = 'none';

            let newWidth = this.dragStartWidth + deltaX;

            // Logic based on mode
            if (this.dragMode === 'RESIZE') {
                // Hard constraints for resizing
                newWidth = Math.max(this.minWidth, Math.min(newWidth, this.maxWidth));

                // Update CSS var or width
                this.element.style.width = `${newWidth}px`;

                // Prevent collapsing while resizing unless explicitly small?
                // No, resize allows min width
                if (this.isCollapsed) {
                    this.show(); // Auto show if resizing from collapsed
                }
            } else {
                // TOGGLE MODE (Elastic pull)
                // Allow pulling smaller than minWidth (to simulate collapse)
                // Allow pulling larger to simulate expand
                newWidth = Math.max(this.collapsedWidth, Math.min(newWidth, 320));
                this.element.style.width = `${newWidth}px`;

                // Visual feedback
                if (newWidth > 150 && this.element.classList.contains('collapsed')) {
                    this.element.classList.remove('collapsed');
                    // Ensure opacity transitions happen
                    this.element.style.transition = 'width 0s';
                }
            }
        }
    }

    /**
     * Handle drag end
     */
    handleDragEnd(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        if (this.resizer) this.resizer.classList.remove('active');
        document.body.style.cursor = '';

        // Release capture
        try {
             if (e.target.releasePointerCapture) e.target.releasePointerCapture(e.pointerId);
        } catch (err) { /* Ignore */ }

        if (this.hasDragged) {
            // Restore transition
            this.element.style.transition = '';

            const currentWidth = parseFloat(this.element.style.width);

            if (this.dragMode === 'RESIZE') {
                // Commit the resize
                // If dragged extremely small, maybe collapse?
                if (currentWidth < 150) {
                    this.hide();
                    this.element.style.width = ''; // Reset to class default
                } else {
                    // Update variable to PERSIST this width even after toggle
                    document.documentElement.style.setProperty('--sidebar-width', `${currentWidth}px`);
                    this.element.style.width = ''; // Use the var now
                    this.show();
                }
            } else {
                // TOGGLE MODE - Snap logic
                this.element.style.width = ''; // Clear manual width

                if (currentWidth > 150) {
                    this.show();
                } else {
                    this.hide();
                }
            }
        }

        this.dragMode = null;
        if (this.hasDragged) {
            // Restore transition
            this.element.style.transition = '';

            // Snap to state
            const width = parseFloat(this.element.style.width);
            this.element.style.width = ''; // Clear manual width

            if (width > 150) {
                // Snap Open
                this.show();
            } else {
                // Snap Closed
                this.hide();
            }
        }
    }

    /**
     * Escape HTML for security
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}


// Make available globally
window.Sidebar = Sidebar;
