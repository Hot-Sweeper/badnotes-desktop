/**
 * PageNavigator - Page thumbnail navigation
 */
class PageNavigator extends EventEmitter {
    constructor(options = {}) {
        super();

        this.element = document.querySelector('.page-navigator');
        this.thumbnailContainer = this.element?.querySelector('.page-thumbnails');

        this.pages = [];
        this.currentPageIndex = 0;
        this.thumbnailSize = options.thumbnailSize || { width: 120, height: 160 };

        // Thumbnail generation queue
        this.thumbnailQueue = [];
        this.isGenerating = false;

        // Initialize
        this.init();
    }

    /**
     * Initialize page navigator
     */
    init() {
        this.bindEvents();
    }

    /**
     * Bind events
     */
    bindEvents() {
        // Add page button
        const addBtn = this.element?.querySelector('[data-action="add-page"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.emit('addPage'));
        }

        // Page thumbnails click
        if (this.thumbnailContainer) {
            this.thumbnailContainer.addEventListener('click', (e) => {
                const thumbnail = e.target.closest('.page-thumbnail');
                if (thumbnail) {
                    const pageIndex = parseInt(thumbnail.dataset.index, 10);
                    this.selectPage(pageIndex);
                }
            });

            // Context menu
            this.thumbnailContainer.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const thumbnail = e.target.closest('.page-thumbnail');
                if (thumbnail) {
                    this.showContextMenu(e, parseInt(thumbnail.dataset.index, 10));
                }
            });

            // Drag and drop for reordering
            this.initDragAndDrop();
        }

        // Navigation buttons
        const prevBtn = this.element?.querySelector('[data-action="prev-page"]') || document.getElementById('prev-page-btn');
        const nextBtn = this.element?.querySelector('[data-action="next-page"]') || document.getElementById('next-page-btn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.previousPage());
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextPage());
        }
    }

    /**
     * Initialize drag and drop
     */
    initDragAndDrop() {
        let draggedElement = null;
        let draggedIndex = -1;

        this.thumbnailContainer.addEventListener('dragstart', (e) => {
            const thumbnail = e.target.closest('.page-thumbnail');
            if (thumbnail) {
                draggedElement = thumbnail;
                draggedIndex = parseInt(thumbnail.dataset.index, 10);
                thumbnail.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        this.thumbnailContainer.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.classList.remove('dragging');
                draggedElement = null;
            }
        });

        this.thumbnailContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const thumbnail = e.target.closest('.page-thumbnail');
            if (thumbnail && thumbnail !== draggedElement) {
                const rect = thumbnail.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                if (e.clientY < midY) {
                    thumbnail.classList.add('drop-before');
                    thumbnail.classList.remove('drop-after');
                } else {
                    thumbnail.classList.add('drop-after');
                    thumbnail.classList.remove('drop-before');
                }
            }
        });

        this.thumbnailContainer.addEventListener('dragleave', (e) => {
            const thumbnail = e.target.closest('.page-thumbnail');
            if (thumbnail) {
                thumbnail.classList.remove('drop-before', 'drop-after');
            }
        });

        this.thumbnailContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            const thumbnail = e.target.closest('.page-thumbnail');

            if (thumbnail && draggedElement && thumbnail !== draggedElement) {
                const targetIndex = parseInt(thumbnail.dataset.index, 10);
                const insertBefore = thumbnail.classList.contains('drop-before');

                thumbnail.classList.remove('drop-before', 'drop-after');

                const newIndex = insertBefore ? targetIndex : targetIndex + 1;
                this.movePage(draggedIndex, newIndex);
            }
        });
    }

    /**
     * Set pages
     */
    setPages(pages) {
        this.pages = pages;
        this.renderThumbnails();
    }

    /**
     * Render all thumbnails
     */
    renderThumbnails() {
        if (!this.thumbnailContainer) return;

        this.thumbnailContainer.innerHTML = '';

        this.pages.forEach((page, index) => {
            const thumbnail = this.createThumbnail(page, index);
            this.thumbnailContainer.appendChild(thumbnail);
        });

        // Generate thumbnail previews
        this.queueThumbnailGeneration();
    }

    /**
     * Create thumbnail element
     */
    createThumbnail(page, index) {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'page-thumbnail';
        thumbnail.dataset.index = index;
        thumbnail.dataset.pageId = page.id;
        thumbnail.draggable = true;

        if (index === this.currentPageIndex) {
            thumbnail.classList.add('active');
        }

        thumbnail.innerHTML = `
            <div class="thumbnail-preview">
                <canvas width="${this.thumbnailSize.width}" height="${this.thumbnailSize.height}"></canvas>
            </div>
            <span class="page-number">${index + 1}</span>
        `;

        return thumbnail;
    }

    /**
     * Queue thumbnail generation
     */
    queueThumbnailGeneration() {
        this.thumbnailQueue = [...this.pages.map((p, i) => i)];
        this.processThumbnailQueue();
    }

    /**
     * Process thumbnail generation queue
     */
    async processThumbnailQueue() {
        if (this.isGenerating || this.thumbnailQueue.length === 0) return;

        this.isGenerating = true;

        while (this.thumbnailQueue.length > 0) {
            const index = this.thumbnailQueue.shift();
            await this.generateThumbnail(index);

            // Yield to UI
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        this.isGenerating = false;
    }

    /**
     * Generate thumbnail for a page
     */
    async generateThumbnail(pageIndex) {
        const page = this.pages[pageIndex];
        if (!page) return;

        const thumbnail = this.thumbnailContainer.querySelector(`[data-index="${pageIndex}"]`);
        const canvas = thumbnail?.querySelector('canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Use theme-aware background color with OLED support
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        let thumbBg;
        if (currentTheme === 'oled') {
            thumbBg = '#000000';
        } else if (currentTheme === 'light') {
            thumbBg = '#ffffff';
        } else {
            thumbBg = page.backgroundColor || '#1a1a1a';
        }
        ctx.fillStyle = thumbBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Scale factor for thumbnail
        const scaleX = canvas.width / (page.width || 800);
        const scaleY = canvas.height / (page.height || 1100);
        const scale = Math.min(scaleX, scaleY);

        ctx.save();
        ctx.scale(scale, scale);

        // Render strokes
        if (page.strokes) {
            for (const stroke of page.strokes) {
                StrokeRenderer.render(ctx, stroke);
            }
        }

        // Render shapes
        if (page.shapes) {
            for (const shape of page.shapes) {
                ShapeRenderer.render(ctx, shape);
            }
        }

        // Render text
        if (page.textElements) {
            for (const text of page.textElements) {
                TextRenderer.render(ctx, text);
            }
        }

        ctx.restore();
    }

    /**
     * Update thumbnail for a specific page
     */
    updateThumbnail(pageIndex) {
        // Add to front of queue for priority
        this.thumbnailQueue.unshift(pageIndex);
        this.processThumbnailQueue();
    }

    /**
     * Select a page
     */
    selectPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= this.pages.length) return;

        // Update UI
        const thumbnails = this.thumbnailContainer?.querySelectorAll('.page-thumbnail');
        thumbnails?.forEach((t, i) => {
            t.classList.toggle('active', i === pageIndex);
        });

        // Scroll to thumbnail
        const activeThumbnail = this.thumbnailContainer?.querySelector(`[data-index="${pageIndex}"]`);
        if (activeThumbnail) {
            activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // Update page indicator if present
        const indicator = document.getElementById('page-indicator');
        if (indicator) {
            indicator.textContent = `${pageIndex + 1} / ${Math.max(this.pages.length, 1)}`;
        }

        this.currentPageIndex = pageIndex;
        this.emit('pageSelected', { index: pageIndex, page: this.pages[pageIndex] });
    }

    /**
     * Go to previous page
     */
    previousPage() {
        if (this.currentPageIndex > 0) {
            this.selectPage(this.currentPageIndex - 1);
        }
    }

    /**
     * Go to next page
     */
    nextPage() {
        if (this.currentPageIndex < this.pages.length - 1) {
            this.selectPage(this.currentPageIndex + 1);
        }
    }

    /**
     * Add a new page
     */
    addPage(page, index = -1) {
        if (index === -1) {
            this.pages.push(page);
            index = this.pages.length - 1;
        } else {
            this.pages.splice(index, 0, page);
        }

        this.renderThumbnails();
        this.selectPage(index);
    }

    /**
     * Remove a page
     */
    removePage(pageIndex) {
        if (this.pages.length <= 1) return; // Keep at least one page

        this.pages.splice(pageIndex, 1);
        this.renderThumbnails();

        // Adjust current page if needed
        if (this.currentPageIndex >= this.pages.length) {
            this.selectPage(this.pages.length - 1);
        } else {
            this.selectPage(this.currentPageIndex);
        }
    }

    /**
     * Move a page
     */
    movePage(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        const [page] = this.pages.splice(fromIndex, 1);
        const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        this.pages.splice(adjustedIndex, 0, page);

        this.renderThumbnails();
        this.selectPage(adjustedIndex);

        this.emit('pagesReordered', { pages: this.pages });
    }

    /**
     * Duplicate a page
     */
    duplicatePage(pageIndex) {
        const page = this.pages[pageIndex];
        if (!page) return;

        const duplicate = {
            ...JSON.parse(JSON.stringify(page)),
            id: `page_${Date.now()}`,
        };

        this.addPage(duplicate, pageIndex + 1);
        this.emit('pageDuplicated', { original: page, duplicate });
    }

    /**
     * Show context menu for page
     */
    showContextMenu(event, pageIndex) {
        const existing = document.querySelector('.context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <button class="context-menu-item" data-action="duplicate">
                <i class="icon icon-copy"></i>
                Duplicate
            </button>
            <button class="context-menu-item" data-action="template">
                <i class="icon icon-template"></i>
                Change Template
            </button>
            <div class="context-menu-divider"></div>
            <button class="context-menu-item recycle" data-action="recycle" ${this.pages.length <= 1 ? 'disabled' : ''}>
                <i class="icon icon-recycle"></i>
                Move to Recycling Bin
            </button>
        `;

        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;

        document.body.appendChild(menu);

        menu.addEventListener('click', (e) => {
            const action = e.target.closest('.context-menu-item')?.dataset.action;
            if (action) {
                this.handleContextMenuAction(action, pageIndex);
            }
            menu.remove();
        });

        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
    }

    /**
     * Handle context menu action
     */
    handleContextMenuAction(action, pageIndex) {
        switch (action) {
            case 'duplicate':
                this.duplicatePage(pageIndex);
                break;
            case 'template':
                this.emit('changeTemplate', pageIndex);
                break;
            case 'recycle':
                this.emit('recyclePage', { pageIndex, page: this.pages[pageIndex] });
                break;
        }
    }

    /**
     * Get current page
     */
    getCurrentPage() {
        return this.pages[this.currentPageIndex];
    }

    /**
     * Get current page index
     */
    getCurrentPageIndex() {
        return this.currentPageIndex;
    }

    /**
     * Get total page count
     */
    getPageCount() {
        return this.pages.length;
    }
}


// Make available globally
window.PageNavigator = PageNavigator;
