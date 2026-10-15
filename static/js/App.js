/**
 * BadNotes - Professional Note Taking App
 * Main Application Entry Point
 *
 * Features:
 * - 4096 pressure level pen support
 * - Dark mode
 * - 120Hz rendering
 * - Touch and pen input for laptops
 * - Modular architecture
 */

class App extends EventEmitter {
    constructor() {
        super();

        // Core components
        this.stateManager = null;
        this.historyManager = null;
        this.storageManager = null;
        this.renderEngine = null;

        // Input handlers
        this.pointerHandler = null;
        this.gestureRecognizer = null;
        this.penPressure = null;
        this.keyboardHandler = null;

        // Canvas management
        this.canvasManager = null;
        this.layerManager = null;
        this.viewportManager = null;

        // Tools
        this.tools = {};
        this.currentTool = null;

        // UI Components
        this.toolbar = null;
        this.sidebar = null;
        this.pageNavigator = null;
        this.recyclingBin = null;
        this.floodFillTool = null;
        this.draggableManager = null;

        // Data
        this.currentNotebook = null;
        this.currentPage = null;
        this.pages = [];

        // Settings
        this.settings = {
            autoSave: true,
            autoSaveInterval: 30000,
            pressureEnabled: true,
            pressureCurve: 'linear',
            strokeSmoothing: 5,
            theme: 'dark',
            highRefreshRate: true,
        };
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Load settings first
            await this.loadSettings();

            // Initialize core components
            await this.initCore();

            // Initialize input handlers
            this.initInput();

            // Initialize canvas
            await this.initCanvas();

            // Initialize tools
            this.initTools();

            // Initialize UI
            this.initUI();

            // Bind global events
            this.bindGlobalEvents();

            // Load last notebook or create new
            await this.loadInitialData();

            // Start auto-save
            this.startAutoSave();

            Toast.success('Welcome to BadNotes!', { duration: 3000 });
        } catch (error) {
            Toast.error('Failed to initialize application');
        }
    }

    /**
     * Initialize core components
     */
    async initCore() {
        // State manager
        this.stateManager = new StateManager({
            currentTool: 'pen',
            currentColor: '#ffffff',
            currentSize: 1.5,
            zoom: 1,
            pan: { x: 0, y: 0 },
            selection: { active: false, elements: [], bounds: null },
        });

        // Make globally available
        window.AppState = this.stateManager;

        // History manager
        this.historyManager = new HistoryManager({
            maxSize: 100,
        });
        window.HistoryManager = this.historyManager;

        // Storage manager
        this.storageManager = new StorageManager();
        await this.storageManager.init();
        window.StorageManager = this.storageManager;
    }

    /**
     * Initialize input handlers
     */
    initInput() {
        const canvasElement = document.querySelector('.canvas-layers');

        // Pointer handler
        this.pointerHandler = new PointerHandler(canvasElement, {
            coalescedEvents: true,
        });

        // Gesture recognizer
        this.gestureRecognizer = new GestureRecognizer(canvasElement);

        // Pen pressure
        this.penPressure = new PenPressure({
            levels: 4096,
            curve: this.settings.pressureCurve,
        });

        // Keyboard handler
        this.keyboardHandler = new KeyboardHandler();
        this.setupKeyboardShortcuts();

        // Connect pointer events to current tool
        this.pointerHandler.on('pointerdown', (data) => {
            if (this.currentTool) {
                const processed = this.penPressure.process(data);
                this.currentTool.onPointerDown({ ...data, ...processed });
            }
        });

        this.pointerHandler.on('pointermove', (data) => {
            if (this.currentTool) {
                // Process all points
                const processedPoints = data.points.map(p => ({
                    ...p,
                    ...this.penPressure.process(p),
                }));

                this.currentTool.onPointerMove({
                    ...data,
                    points: processedPoints,
                    current: { ...data.current, ...this.penPressure.process(data.current) },
                });
            }
        });

        this.pointerHandler.on('pointerup', (data) => {
            if (this.currentTool) {
                const processed = this.penPressure.process(data);
                this.currentTool.onPointerUp({ ...data, ...processed });
            }
        });

        // Connect gestures to viewport
        this.gestureRecognizer.on('pinch', (data) => {
            if (this.viewportManager) {
                this.viewportManager.handlePinch(data);
            }
        });

        this.gestureRecognizer.on('pan', (data) => {
            if (this.viewportManager && data.touches === 2) {
                this.viewportManager.handlePan(data);
            }
        });
    }

    /**
     * Initialize canvas
     */
    async initCanvas() {
        const container = document.querySelector('.canvas-layers');

        // Canvas manager
        this.canvasManager = new CanvasManager(container, {
            width: 800,
            height: 1100,
        });
        await this.canvasManager.init();
        window.CanvasManager = this.canvasManager;

        // Layer manager
        this.layerManager = this.canvasManager.layerManager;
        window.LayerManager = this.layerManager;

        // Viewport manager
        this.viewportManager = this.canvasManager.viewportManager;
        window.ViewportManager = this.viewportManager;

        // Render engine
        this.renderEngine = this.canvasManager.renderEngine;
        window.RenderEngine = this.renderEngine;
    }

    /**
     * Initialize tools
     */
    initTools() {
        // Create tools
        this.tools = {
            pen: new PenTool({ pressureEnabled: this.settings.pressureEnabled }),
            highlighter: new HighlighterTool(),
            eraser: new EraserTool(),
            lasso: new LassoTool(),
            shape: new ShapeTool(),
            text: new TextTool(),
            image: new ImageTool(),
        };

        // Set canvas manager for each tool
        for (const tool of Object.values(this.tools)) {
            tool.canvasManager = this.canvasManager;
        }

        // Connect tool events
        for (const [name, tool] of Object.entries(this.tools)) {
            tool.on('strokeCreated', (stroke) => {
                this.canvasManager.addStroke(stroke);
                this.historyManager.push('stroke', stroke, this.currentPage?.id);
            });

            tool.on('shapeCreated', (shape) => {
                this.canvasManager.addShape(shape);
                this.historyManager.push('shape', shape, this.currentPage?.id);
            });

            tool.on('textCreated', (text) => {
                this.historyManager.push('text', text, this.currentPage?.id);
            });
        }// Select default tool
        this.selectTool('pen');
    }

    /**
     * Initialize UI components
     */
    initUI() {
        // Toolbar
        this.toolbar = new Toolbar();

        this.toolbar.on('toolSelected', (tool) => {
            this.selectTool(tool);
        });

        this.toolbar.on('colorChanged', (color) => {
            this.stateManager.set('currentColor', color);
            if (this.currentTool) {
                this.currentTool.setOption('color', color);
            }
        });

        this.toolbar.on('sizeChanged', (size) => {
            this.stateManager.set('currentSize', size);
            if (this.currentTool) {
                this.currentTool.setOption('size', size);
            }
        });

        this.toolbar.on('undo', () => this.undo());
        this.toolbar.on('redo', () => this.redo());

        // Sidebar
        this.sidebar = new Sidebar();

        this.sidebar.on('notebookSelected', (notebook) => {
            this.loadNotebook(notebook);
        });

        this.sidebar.on('newNotebook', () => {
            this.createNewNotebook();
        });

        this.sidebar.on('recycleNotebook', async (id) => {
            const notebook = this.sidebar.notebooks.find(n => n.id === id);
            if (notebook && this.recyclingBin) {
                this.recyclingBin.addItem('notebook', notebook);
                await this.deleteNotebook(id);
            }
        });

        // Page navigator
        this.pageNavigator = new PageNavigator();

        this.pageNavigator.on('pageSelected', ({ index, page }) => {
            this.goToPage(index);
        });

        this.pageNavigator.on('addPage', () => {
            this.addPage();
        });

        this.pageNavigator.on('recyclePage', ({ pageIndex, page }) => {
            if (this.recyclingBin && this.pages.length > 1) {
                this.recyclingBin.addItem('page', { ...page, pageNumber: pageIndex + 1 });
                this.pageNavigator.removePage(pageIndex);
                this.pages.splice(pageIndex, 1);
                this.saveNotebookPages();
            }
        });

        this.pageNavigator.on('pagesReordered', ({ pages }) => {
            this.pages = pages;
            this.saveNotebookPages();
        });

        // Update history buttons
        this.historyManager.on('change', () => {
            this.toolbar.updateHistoryButtons(
                this.historyManager.canUndo(),
                this.historyManager.canRedo()
            );
        });

        // Initialize Recycling Bin
        this.recyclingBin = new RecyclingBin();

        this.recyclingBin.on('itemRestored', async ({ type, data, category }) => {
            await this.handleItemRestored(type, data);
        });

        // Initialize Flood Fill Tool
        this.floodFillTool = new FloodFillTool({
            canvasManager: this.canvasManager
        });

        // Initialize Draggable Manager
        this.draggableManager = new DraggableManager({
            recyclingBin: this.recyclingBin,
            canvasManager: this.canvasManager
        });

        // Setup canvas drop for color fill
        const canvasContainer = document.querySelector('#canvas-container');
        if (canvasContainer) {
            this.draggableManager.initCanvasDrop(canvasContainer, (color, x, y) => {
                this.floodFillTool.fillAt(x, y, color, canvasContainer);
            });
        }

        // Initialize draggable colors in quick toolbar
        this.initDraggableColors();
    }

    /**
     * Initialize draggable colors
     */
    initDraggableColors() {
        const quickColors = document.querySelector('.quick-colors');
        if (quickColors && this.draggableManager) {
            this.draggableManager.initColorSwatches(
                quickColors,
                () => this.getQuickColors(),
                (from, to) => this.reorderQuickColor(from, to),
                (index) => this.removeQuickColor(index)
            );
        }
    }

    /**
     * Initialize draggable pages in sidebar
     */
    initDraggablePages() {
        const pagesGrid = document.querySelector('#pages-grid');
        if (pagesGrid && this.draggableManager) {
            this.draggableManager.initPageThumbnails(
                pagesGrid,
                () => this.pages,
                (from, to) => this.reorderPage(from, to),
                (index) => this.recyclePage(index)
            );
        }
    }

    /**
     * Reorder page in sidebar
     */
    reorderPage(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        const [page] = this.pages.splice(fromIndex, 1);
        const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        this.pages.splice(adjustedIndex, 0, page);

        this.pageNavigator.setPages(this.pages);
        this.saveNotebookPages();

        // Re-init drag handlers after DOM update
        setTimeout(() => this.initDraggablePages(), 100);
    }

    /**
     * Recycle a page
     */
    recyclePage(index) {
        if (this.pages.length <= 1) return;

        const page = this.pages[index];
        if (page && this.recyclingBin) {
            this.recyclingBin.addItem('page', { ...page, pageNumber: index + 1 });
            this.pages.splice(index, 1);
            this.pageNavigator.setPages(this.pages);
            this.saveNotebookPages();

            // Go to first page if current was deleted
            if (this.currentPage?.id === page.id) {
                this.goToPage(0);
            }

            // Re-init drag handlers after DOM update
            setTimeout(() => this.initDraggablePages(), 100);
        }
    }

    /**
     * Initialize draggable notebooks
     */
    initDraggableNotebooks() {
        const notebooksList = document.querySelector('#notebooks-list, .notebooks-list');
        if (notebooksList && this.draggableManager) {
            this.draggableManager.initNotebooks(
                notebooksList,
                () => this.sidebar.notebooks,
                null,
                (index) => this.recycleNotebook(index)
            );
        }
    }

    /**
     * Recycle a notebook by index
     */
    recycleNotebook(index) {
        const notebook = this.sidebar.notebooks[index];
        if (notebook && this.recyclingBin) {
            this.recyclingBin.addItem('notebook', notebook);
            this.deleteNotebook(notebook.id);
        }
    }

    /**
     * Get quick colors array
     */
    getQuickColors() {
        const quickColors = document.querySelectorAll('.quick-color-btn');
        return Array.from(quickColors).map(btn => btn.dataset.color);
    }

    /**
     * Reorder quick colors
     */
    reorderQuickColor(fromIndex, toIndex) {
        const quickColors = document.querySelector('.quick-colors');
        const buttons = Array.from(quickColors.querySelectorAll('.quick-color-btn'));

        if (fromIndex >= 0 && fromIndex < buttons.length &&
            toIndex >= 0 && toIndex < buttons.length) {
            const btn = buttons[fromIndex];
            const targetBtn = buttons[toIndex];

            // Animate the reorder
            btn.classList.add('reorder-animation');

            if (fromIndex < toIndex) {
                targetBtn.after(btn);
            } else {
                targetBtn.before(btn);
            }

            setTimeout(() => btn.classList.remove('reorder-animation'), 300);

            // Re-init drag handlers
            this.initDraggableColors();
        }
    }

    /**
     * Remove a quick color (send to recycling bin)
     */
    removeQuickColor(index) {
        const quickColors = document.querySelector('.quick-colors');
        const buttons = quickColors.querySelectorAll('.quick-color-btn');

        if (index >= 0 && index < buttons.length && this.recyclingBin) {
            const btn = buttons[index];
            this.recyclingBin.addItem('color', { value: btn.dataset.color });
        }
    }

    /**
     * Handle restored items from recycling bin
     */
    async handleItemRestored(type, data) {
        switch (type) {
            case 'notebook':
                // Re-create the notebook
                await this.storageManager.saveNotebook(data);
                this.sidebar.addNotebook(data);
                Toast.success(`Notebook "${data.name}" restored`);
                break;

            case 'page':
                // Add page back
                const page = { ...data };
                delete page.pageNumber;
                this.pages.push(page);
                await this.storageManager.savePage(page);
                this.pageNavigator.addPage(page);
                await this.saveNotebookPages();
                Toast.success('Page restored');
                break;

            case 'color':
                // Add color back to quick colors
                const quickColors = document.querySelector('.quick-colors');
                if (quickColors) {
                    const btn = document.createElement('button');
                    btn.className = 'quick-color-btn';
                    btn.dataset.color = data.value;
                    btn.style.setProperty('--color', data.value);
                    quickColors.appendChild(btn);
                    this.initDraggableColors();
                }
                Toast.success('Color restored');
                break;
        }
    }

    /**
     * Save notebook pages
     */
    async saveNotebookPages() {
        if (this.currentNotebook) {
            this.currentNotebook.pages = this.pages.map(p => p.id);
            this.currentNotebook.pageCount = this.pages.length;
            await this.storageManager.saveNotebook(this.currentNotebook);
        }
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        // Tool shortcuts
        this.keyboardHandler.register('p', () => this.selectTool('pen'));
        this.keyboardHandler.register('h', () => this.selectTool('highlighter'));
        this.keyboardHandler.register('e', () => this.selectTool('eraser'));
        this.keyboardHandler.register('l', () => this.selectTool('lasso'));
        this.keyboardHandler.register('s', () => this.selectTool('shape'));
        this.keyboardHandler.register('t', () => this.selectTool('text'));

        // Undo/Redo
        this.keyboardHandler.register('ctrl+z', () => this.undo());
        this.keyboardHandler.register('ctrl+shift+z', () => this.redo());
        this.keyboardHandler.register('ctrl+y', () => this.redo());

        // Save
        this.keyboardHandler.register('ctrl+s', async (e) => {
            e.preventDefault();
            await this.save();
            Toast.success('Saved');
        });

        // New page
        this.keyboardHandler.register('ctrl+n', (e) => {
            e.preventDefault();
            this.addPage();
        });

        // Page navigation
        this.keyboardHandler.register('pageup', () => this.pageNavigator.previousPage());
        this.keyboardHandler.register('pagedown', () => this.pageNavigator.nextPage());

        // Zoom
        this.keyboardHandler.register('ctrl+=', (e) => {
            e.preventDefault();
            this.viewportManager.zoomIn();
        });
        this.keyboardHandler.register('ctrl+-', (e) => {
            e.preventDefault();
            this.viewportManager.zoomOut();
        });
        this.keyboardHandler.register('ctrl+0', (e) => {
            e.preventDefault();
            this.viewportManager.resetZoom();
        });

        // Delete selection
        this.keyboardHandler.register('delete', () => {
            if (this.tools.lasso.selectedElements.length > 0) {
                this.deleteSelection();
            }
        });
        this.keyboardHandler.register('backspace', () => {
            if (this.tools.lasso.selectedElements.length > 0) {
                this.deleteSelection();
            }
        });

        // Escape
        this.keyboardHandler.register('escape', () => {
            if (this.tools.lasso) {
                this.tools.lasso.clearSelection();
            }
        });
    }

    /**
     * Bind global events
     */
    bindGlobalEvents() {
        // Window resize
        window.addEventListener('resize', () => {
            this.canvasManager?.handleResize();
        });

        // Before unload - save
        window.addEventListener('beforeunload', async (e) => {
            if (this.hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '';
                await this.save();
            }
        });

        // Visibility change - save when hidden
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) {
                await this.save();
            }
        });

        // Settings button
        const settingsBtn = document.querySelector('[data-action="settings"]');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.showSettings();
            });
        }
    }

    /**
     * Load initial data
     */
    async loadInitialData() {
        try {
            // Get last notebook
            const lastNotebookId = await this.storageManager.getSetting('lastNotebook');

            if (lastNotebookId) {
                const notebook = await this.storageManager.getNotebook(lastNotebookId);
                if (notebook) {
                    await this.loadNotebook(notebook);
                    return;
                }
            }

            // No last notebook or not found - check for any notebooks
            const notebooks = await this.storageManager.getNotebooks();

            if (notebooks.length > 0) {
                await this.loadNotebook(notebooks[0]);
            } else {
                // Create first notebook
                await this.createNewNotebook(true);
            }
        } catch (error) {
            console.error('Failed to load initial data:', error);
            await this.createNewNotebook(true);
        }
    }

    /**
     * Select a tool
     */
    selectTool(toolName) {
        if (!this.tools[toolName]) {
            console.warn(`Tool not found: ${toolName}`);
            return;
        }

        // Deactivate current tool
        if (this.currentTool) {
            this.currentTool.deactivate();
        }

        // Activate new tool
        this.currentTool = this.tools[toolName];
        this.currentTool.activate();

        // Update state
        this.stateManager.set('currentTool', toolName);

        // Update UI
        this.toolbar.selectTool(toolName);

        // Update cursor
        const cursor = this.currentTool.getCursor();
        document.querySelector('.canvas-wrapper').style.cursor = cursor;
    }

    /**
     * Create new notebook
     */
    async createNewNotebook(silent = false) {
        if (!silent) {
            const modal = new NewNotebookModal();

            modal.on('create', async (notebook) => {
                await this.createNotebook(notebook);
            });

            modal.open();
        } else {
            // Create default notebook
            const notebook = {
                id: `notebook_${Date.now()}`,
                name: 'My Notebook',
                color: '#6c5ce7',
                template: 'blank',
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
                pageCount: 1,
            };

            await this.createNotebook(notebook);
        }
    }

    /**
     * Create notebook
     */
    async createNotebook(notebook) {
        // Create first page
        const page = this.createDefaultPage(notebook.template);
        notebook.pages = [page.id];

        // Save to storage
        await this.storageManager.saveNotebook(notebook);
        await this.storageManager.savePage(page);

        // Update sidebar
        this.sidebar.addNotebook(notebook);

        // Load the notebook
        await this.loadNotebook(notebook);
    }

    /**
     * Load notebook
     */
    async loadNotebook(notebook) {
        LoadingOverlay.show('Loading notebook...');

        try {
            this.currentNotebook = notebook;

            // Load pages
            this.pages = [];

            if (notebook.pages) {
                for (const pageId of notebook.pages) {
                    const page = await this.storageManager.getPage(pageId);
                    if (page) {
                        this.pages.push(page);
                    }
                }
            }

            // Ensure at least one page
            if (this.pages.length === 0) {
                const page = this.createDefaultPage(notebook.template);
                this.pages.push(page);
                await this.storageManager.savePage(page);
            }

            // Update page navigator
            this.pageNavigator.setPages(this.pages);

            // Load first page
            this.goToPage(0);

            // Save as last notebook
            await this.storageManager.setSetting('lastNotebook', notebook.id);

            // Initialize draggables for pages and notebooks
            setTimeout(() => {
                this.initDraggablePages();
                this.initDraggableNotebooks();
            }, 100);

            LoadingOverlay.hide();
        } catch (error) {
            console.error('Failed to load notebook:', error);
            LoadingOverlay.hide();
            Toast.error('Failed to load notebook');
        }
    }

    /**
     * Delete notebook
     */
    async deleteNotebook(notebookId) {
        try {
            await this.storageManager.deleteNotebook(notebookId);
            this.sidebar.deleteNotebook(notebookId);

            if (this.currentNotebook?.id === notebookId) {
                this.currentNotebook = null;
                this.pages = [];

                // Load another notebook or create new
                const notebooks = await this.storageManager.getNotebooks();
                if (notebooks.length > 0) {
                    await this.loadNotebook(notebooks[0]);
                } else {
                    await this.createNewNotebook(true);
                }
            }

            Toast.success('Notebook deleted');
        } catch (error) {
            console.error('Failed to delete notebook:', error);
            Toast.error('Failed to delete notebook');
        }
    }

    /**
     * Create default page
     */
    createDefaultPage(template = 'blank') {
        return {
            id: `page_${Date.now()}`,
            width: 800,
            height: 1100,
            backgroundColor: '#1a1a2e',
            template: template,
            strokes: [],
            shapes: [],
            textElements: [],
            images: [],
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
        };
    }

    /**
     * Go to page
     */
    goToPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= this.pages.length) return;

        // Save current page first
        if (this.currentPage) {
            this.saveCurrentPageData();
        }

        this.currentPage = this.pages[pageIndex];

        // Load page data into canvas
        this.canvasManager.loadPage(this.currentPage);

        // Update page navigator
        this.pageNavigator.selectPage(pageIndex);

        // Clear history for new page
        this.historyManager.clear();
    }

    /**
     * Add new page
     */
    async addPage() {
        const page = this.createDefaultPage(this.currentNotebook?.template);

        // Insert after current page
        const currentIndex = this.pageNavigator.getCurrentPageIndex();
        this.pages.splice(currentIndex + 1, 0, page);

        // Save page
        await this.storageManager.savePage(page);

        // Update notebook
        this.currentNotebook.pages = this.pages.map(p => p.id);
        this.currentNotebook.pageCount = this.pages.length;
        await this.storageManager.saveNotebook(this.currentNotebook);

        // Update UI
        this.pageNavigator.addPage(page, currentIndex + 1);

        Toast.info('Page added');
    }

    /**
     * Save current page data
     */
    saveCurrentPageData() {
        if (!this.currentPage) return;

        // Get data from canvas manager
        const data = this.canvasManager.getPageData();

        this.currentPage.strokes = data.strokes;
        this.currentPage.shapes = data.shapes;
        this.currentPage.textElements = data.textElements;
        this.currentPage.images = data.images;
        this.currentPage.modifiedAt = new Date().toISOString();
    }

    /**
     * Save
     */
    async save() {
        if (!this.currentNotebook || !this.currentPage) return;

        try {
            // Save current page data
            this.saveCurrentPageData();

            // Save page to storage
            await this.storageManager.savePage(this.currentPage);

            // Update notebook modified time
            this.currentNotebook.modifiedAt = new Date().toISOString();
            await this.storageManager.saveNotebook(this.currentNotebook);

            // Update thumbnail
            this.pageNavigator.updateThumbnail(
                this.pageNavigator.getCurrentPageIndex()
            );

            this.emit('saved');
        } catch (error) {
            console.error('Failed to save:', error);
            Toast.error('Failed to save');
        }
    }

    /**
     * Start auto-save
     */
    startAutoSave() {
        if (!this.settings.autoSave) return;

        setInterval(async () => {
            if (this.hasUnsavedChanges()) {
                await this.save();
            }
        }, this.settings.autoSaveInterval);
    }

    /**
     * Check for unsaved changes
     */
    hasUnsavedChanges() {
        return this.historyManager.getLength() > 0;
    }

    /**
     * Undo
     */
    undo() {
        const action = this.historyManager.undo();
        if (action) {
            this.applyHistoryAction(action, true);
        }
    }

    /**
     * Redo
     */
    redo() {
        const action = this.historyManager.redo();
        if (action) {
            this.applyHistoryAction(action, false);
        }
    }

    /**
     * Apply history action
     */
    applyHistoryAction(action, isUndo) {
        switch (action.type) {
            case 'stroke':
                if (isUndo) {
                    this.canvasManager.removeStroke(action.data.id);
                } else {
                    this.canvasManager.addStroke(action.data);
                }
                break;
            case 'shape':
                if (isUndo) {
                    this.canvasManager.removeShape(action.data.id);
                } else {
                    this.canvasManager.addShape(action.data);
                }
                break;
            case 'text':
                if (isUndo) {
                    this.canvasManager.removeText(action.data.id);
                } else {
                    this.canvasManager.addText(action.data);
                }
                break;
            case 'erase':
                if (isUndo) {
                    // Re-add erased strokes
                    for (const stroke of action.data) {
                        this.canvasManager.addStroke(stroke);
                    }
                } else {
                    // Remove strokes again
                    for (const stroke of action.data) {
                        this.canvasManager.removeStroke(stroke.id);
                    }
                }
                break;
        }
    }

    /**
     * Delete selection
     */
    deleteSelection() {
        const selected = this.tools.lasso.selectedElements;

        this.historyManager.beginGroup();

        for (const element of selected) {
            switch (element.type) {
                case 'stroke':
                    this.canvasManager.removeStroke(element.data.id);
                    this.historyManager.push('erase', [element.data], this.currentPage?.id);
                    break;
                case 'shape':
                    this.canvasManager.removeShape(element.data.id);
                    break;
                case 'text':
                    this.canvasManager.removeText(element.data.id);
                    break;
            }
        }

        this.historyManager.endGroup();
        this.tools.lasso.clearSelection();
    }

    /**
     * Show settings modal
     */
    showSettings() {
        const modal = new SettingsModal({ settings: this.settings });

        modal.on('save', async (newSettings) => {
            this.settings = { ...this.settings, ...newSettings };
            await this.applySettings();
            await this.storageManager.setSetting('appSettings', this.settings);
            Toast.success('Settings saved');
        });

        modal.open();
    }

    /**
     * Apply settings
     */
    async applySettings() {
        // Apply theme
        document.body.classList.toggle('light-theme', this.settings.theme === 'light');

        // Apply pressure settings
        if (this.penPressure) {
            this.penPressure.setCurve(this.settings.pressureCurve);
        }

        // Apply to tools
        if (this.tools.pen) {
            this.tools.pen.setOption('pressureEnabled', this.settings.pressureEnabled);
            this.tools.pen.setStabilization(this.settings.strokeSmoothing);
        }

        // Apply render settings
        if (this.renderEngine) {
            this.renderEngine.setHighRefreshRate(this.settings.highRefreshRate);
        }
    }

    /**
     * Load settings
     */
    async loadSettings() {
        try {
            const saved = await this.storageManager?.getSetting('appSettings');
            if (saved) {
                this.settings = { ...this.settings, ...saved };
            }
        } catch (error) {
            console.warn('Failed to load settings:', error);
        }
    }

    /**
     * Export current notebook
     */
    async exportNotebook(format) {
        if (!this.currentNotebook) return;

        // Save current page first
        this.saveCurrentPageData();

        await ExportHandler.export(this.currentNotebook, this.pages, format);
    }
}


// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    window.app = new App();
    await window.app.init();
});
