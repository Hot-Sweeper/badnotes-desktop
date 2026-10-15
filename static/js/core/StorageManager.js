/**
 * StorageManager - Persistent storage for notebooks, pages, and settings
 * Uses IndexedDB for efficient binary data storage with localStorage fallback
 */
class StorageManager extends EventEmitter {
    constructor() {
        super();

        this.dbName = 'GoodNotesClone';
        this.dbVersion = 1;
        this.db = null;
        this.isReady = false;

        // Storage keys
        this.STORES = {
            NOTEBOOKS: 'notebooks',
            PAGES: 'pages',
            STROKES: 'strokes',
            SETTINGS: 'settings',
            ASSETS: 'assets',
        };

        this._init();
    }

    /**
     * Initialize IndexedDB
     */
    async _init() {
        try {
            this.db = await this._openDatabase();
            this.isReady = true;
            this.emit('ready');
        } catch (error) {
            console.error('IndexedDB initialization failed:', error);
            this.emit('error', error);
        }
    }

    /**
     * Open/create the database
     */
    _openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Notebooks store
                if (!db.objectStoreNames.contains(this.STORES.NOTEBOOKS)) {
                    const notebooksStore = db.createObjectStore(this.STORES.NOTEBOOKS, { keyPath: 'id' });
                    notebooksStore.createIndex('createdAt', 'createdAt', { unique: false });
                    notebooksStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    notebooksStore.createIndex('name', 'name', { unique: false });
                }

                // Pages store
                if (!db.objectStoreNames.contains(this.STORES.PAGES)) {
                    const pagesStore = db.createObjectStore(this.STORES.PAGES, { keyPath: 'id' });
                    pagesStore.createIndex('notebookId', 'notebookId', { unique: false });
                    pagesStore.createIndex('order', 'order', { unique: false });
                }

                // Strokes store (for efficient stroke storage)
                if (!db.objectStoreNames.contains(this.STORES.STROKES)) {
                    const strokesStore = db.createObjectStore(this.STORES.STROKES, { keyPath: 'id' });
                    strokesStore.createIndex('pageId', 'pageId', { unique: false });
                }

                // Settings store
                if (!db.objectStoreNames.contains(this.STORES.SETTINGS)) {
                    db.createObjectStore(this.STORES.SETTINGS, { keyPath: 'key' });
                }

                // Assets store (images, audio, etc.)
                if (!db.objectStoreNames.contains(this.STORES.ASSETS)) {
                    const assetsStore = db.createObjectStore(this.STORES.ASSETS, { keyPath: 'id' });
                    assetsStore.createIndex('type', 'type', { unique: false });
                    assetsStore.createIndex('pageId', 'pageId', { unique: false });
                }
            };
        });
    }

    /**
     * Wait for database to be ready
     */
    async waitForReady() {
        if (this.isReady) return;

        return new Promise((resolve, reject) => {
            this.once('ready', resolve);
            this.once('error', reject);
        });
    }

    /**
     * Generic store operation
     */
    async _storeOperation(storeName, mode, operation) {
        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);

            const request = operation(store);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // ===== Notebook Operations =====

    /**
     * Save a notebook
     * @param {Object} notebook - Notebook data
     */
    async saveNotebook(notebook) {
        const data = {
            ...notebook,
            updatedAt: Date.now(),
            createdAt: notebook.createdAt || Date.now(),
        };

        await this._storeOperation(this.STORES.NOTEBOOKS, 'readwrite', (store) => {
            return store.put(data);
        });

        this.emit('notebook:saved', data);
        return data;
    }

    /**
     * Get a notebook by ID
     * @param {string} id - Notebook ID
     */
    async getNotebook(id) {
        return this._storeOperation(this.STORES.NOTEBOOKS, 'readonly', (store) => {
            return store.get(id);
        });
    }

    /**
     * Get all notebooks
     */
    async getAllNotebooks() {
        return this._storeOperation(this.STORES.NOTEBOOKS, 'readonly', (store) => {
            return store.getAll();
        });
    }

    /**
     * Delete a notebook and its pages
     * @param {string} id - Notebook ID
     */
    async deleteNotebook(id) {
        // Delete all pages first
        const pages = await this.getPagesByNotebook(id);
        for (const page of pages) {
            await this.deletePage(page.id);
        }

        await this._storeOperation(this.STORES.NOTEBOOKS, 'readwrite', (store) => {
            return store.delete(id);
        });

        this.emit('notebook:deleted', id);
    }

    // ===== Page Operations =====

    /**
     * Save a page
     * @param {Object} page - Page data
     */
    async savePage(page) {
        const data = {
            ...page,
            updatedAt: Date.now(),
            createdAt: page.createdAt || Date.now(),
        };

        await this._storeOperation(this.STORES.PAGES, 'readwrite', (store) => {
            return store.put(data);
        });

        this.emit('page:saved', data);
        return data;
    }

    /**
     * Get a page by ID
     * @param {string} id - Page ID
     */
    async getPage(id) {
        return this._storeOperation(this.STORES.PAGES, 'readonly', (store) => {
            return store.get(id);
        });
    }

    /**
     * Get all pages for a notebook
     * @param {string} notebookId - Notebook ID
     */
    async getPagesByNotebook(notebookId) {
        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.STORES.PAGES, 'readonly');
            const store = transaction.objectStore(this.STORES.PAGES);
            const index = store.index('notebookId');
            const request = index.getAll(notebookId);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                // Sort by order
                const pages = request.result.sort((a, b) => a.order - b.order);
                resolve(pages);
            };
        });
    }

    /**
     * Delete a page and its strokes
     * @param {string} id - Page ID
     */
    async deletePage(id) {
        // Delete all strokes
        await this.deleteStrokesByPage(id);

        // Delete all assets
        await this.deleteAssetsByPage(id);

        await this._storeOperation(this.STORES.PAGES, 'readwrite', (store) => {
            return store.delete(id);
        });

        this.emit('page:deleted', id);
    }

    // ===== Stroke Operations =====

    /**
     * Save a stroke
     * @param {Object} stroke - Stroke data
     */
    async saveStroke(stroke) {
        await this._storeOperation(this.STORES.STROKES, 'readwrite', (store) => {
            return store.put(stroke);
        });
    }

    /**
     * Save multiple strokes
     * @param {Array} strokes - Array of stroke data
     */
    async saveStrokes(strokes) {
        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.STORES.STROKES, 'readwrite');
            const store = transaction.objectStore(this.STORES.STROKES);

            strokes.forEach(stroke => store.put(stroke));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Get all strokes for a page
     * @param {string} pageId - Page ID
     */
    async getStrokesByPage(pageId) {
        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.STORES.STROKES, 'readonly');
            const store = transaction.objectStore(this.STORES.STROKES);
            const index = store.index('pageId');
            const request = index.getAll(pageId);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    /**
     * Delete a stroke
     * @param {string} id - Stroke ID
     */
    async deleteStroke(id) {
        await this._storeOperation(this.STORES.STROKES, 'readwrite', (store) => {
            return store.delete(id);
        });
    }

    /**
     * Delete all strokes for a page
     * @param {string} pageId - Page ID
     */
    async deleteStrokesByPage(pageId) {
        const strokes = await this.getStrokesByPage(pageId);

        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.STORES.STROKES, 'readwrite');
            const store = transaction.objectStore(this.STORES.STROKES);

            strokes.forEach(stroke => store.delete(stroke.id));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // ===== Asset Operations =====

    /**
     * Save an asset (image, audio, etc.)
     * @param {Object} asset - Asset data with blob
     */
    async saveAsset(asset) {
        const data = {
            ...asset,
            createdAt: asset.createdAt || Date.now(),
        };

        await this._storeOperation(this.STORES.ASSETS, 'readwrite', (store) => {
            return store.put(data);
        });

        return data;
    }

    /**
     * Save an image to storage
     * @param {string} id - Image ID
     * @param {string} dataUrl - Image data URL
     * @param {string} pageId - Optional page ID association
     */
    async saveImage(id, dataUrl, pageId = null) {
        return this.saveAsset({
            id: id,
            type: 'image',
            data: dataUrl,
            pageId: pageId,
        });
    }

    /**
     * Get an image from storage
     * @param {string} id - Image ID
     */
    async getImage(id) {
        const asset = await this.getAsset(id);
        return asset ? asset.data : null;
    }

    /**
     * Get an asset by ID
     * @param {string} id - Asset ID
     */
    async getAsset(id) {
        return this._storeOperation(this.STORES.ASSETS, 'readonly', (store) => {
            return store.get(id);
        });
    }

    /**
     * Get all assets for a page
     * @param {string} pageId - Page ID
     */
    async getAssetsByPage(pageId) {
        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.STORES.ASSETS, 'readonly');
            const store = transaction.objectStore(this.STORES.ASSETS);
            const index = store.index('pageId');
            const request = index.getAll(pageId);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    /**
     * Delete all assets for a page
     * @param {string} pageId - Page ID
     */
    async deleteAssetsByPage(pageId) {
        const assets = await this.getAssetsByPage(pageId);

        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.STORES.ASSETS, 'readwrite');
            const store = transaction.objectStore(this.STORES.ASSETS);

            assets.forEach(asset => store.delete(asset.id));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // ===== Settings Operations =====

    /**
     * Save a setting
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     */
    async saveSetting(key, value) {
        await this._storeOperation(this.STORES.SETTINGS, 'readwrite', (store) => {
            return store.put({ key, value });
        });
    }

    /**
     * Get a setting
     * @param {string} key - Setting key
     * @param {any} defaultValue - Default value if not found
     */
    async getSetting(key, defaultValue = null) {
        const result = await this._storeOperation(this.STORES.SETTINGS, 'readonly', (store) => {
            return store.get(key);
        });

        return result ? result.value : defaultValue;
    }

    /**
     * Get all settings
     */
    async getAllSettings() {
        const results = await this._storeOperation(this.STORES.SETTINGS, 'readonly', (store) => {
            return store.getAll();
        });

        return results.reduce((acc, item) => {
            acc[item.key] = item.value;
            return acc;
        }, {});
    }

    // ===== Utility Methods =====

    /**
     * Generate a unique ID
     */
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export all data
     */
    async exportAll() {
        const notebooks = await this.getAllNotebooks();
        const data = {
            version: this.dbVersion,
            exportedAt: Date.now(),
            notebooks: [],
        };

        for (const notebook of notebooks) {
            const pages = await this.getPagesByNotebook(notebook.id);
            const notebookData = {
                ...notebook,
                pages: [],
            };

            for (const page of pages) {
                const strokes = await this.getStrokesByPage(page.id);
                const assets = await this.getAssetsByPage(page.id);
                notebookData.pages.push({
                    ...page,
                    strokes,
                    assets,
                });
            }

            data.notebooks.push(notebookData);
        }

        return data;
    }

    /**
     * Import data
     * @param {Object} data - Exported data
     */
    async importData(data) {
        for (const notebook of data.notebooks) {
            const { pages, ...notebookData } = notebook;
            await this.saveNotebook(notebookData);

            for (const page of pages) {
                const { strokes, assets, ...pageData } = page;
                await this.savePage(pageData);

                if (strokes) {
                    await this.saveStrokes(strokes);
                }

                if (assets) {
                    for (const asset of assets) {
                        await this.saveAsset(asset);
                    }
                }
            }
        }

        this.emit('import:complete');
    }

    /**
     * Clear all data
     */
    async clearAll() {
        const stores = Object.values(this.STORES);

        await this.waitForReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(stores, 'readwrite');

            stores.forEach(storeName => {
                transaction.objectStore(storeName).clear();
            });

            transaction.oncomplete = () => {
                this.emit('cleared');
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

// Global storage instance
window.Storage = new StorageManager();
