/**
 * Modal - Modal dialog component
 */
class Modal extends EventEmitter {
    constructor(options = {}) {
        super();

        this.id = options.id || `modal_${Date.now()}`;
        this.title = options.title || '';
        this.content = options.content || '';
        this.size = options.size || 'medium'; // small, medium, large, fullscreen
        this.closable = options.closable !== false;
        this.backdrop = options.backdrop !== false;

        this.element = null;
        this.isOpen = false;
    }

    /**
     * Create modal element
     */
    create() {
        this.element = document.createElement('div');
        this.element.className = `modal modal-${this.size}`;
        this.element.id = this.id;

        this.element.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-dialog">
                <div class="modal-header">
                    <h3 class="modal-title">${this.title}</h3>
                    ${this.closable ? `
                        <button class="modal-close" aria-label="Close">
                            <i class="icon icon-close"></i>
                        </button>
                    ` : ''}
                </div>
                <div class="modal-body">
                    ${this.content}
                </div>
                <div class="modal-footer"></div>
            </div>
        `;

        // Bind events
        if (this.closable) {
            const closeBtn = this.element.querySelector('.modal-close');
            closeBtn?.addEventListener('click', () => this.close());
        }

        if (this.backdrop) {
            const backdrop = this.element.querySelector('.modal-backdrop');
            backdrop?.addEventListener('click', () => {
                if (this.closable) this.close();
            });
        }

        // Escape key
        this.handleKeydown = (e) => {
            if (e.key === 'Escape' && this.closable) {
                this.close();
            }
        };

        return this.element;
    }

    /**
     * Open modal
     */
    open() {
        if (this.isOpen) return;

        if (!this.element) {
            this.create();
        }

        document.body.appendChild(this.element);

        // Trigger animation
        requestAnimationFrame(() => {
            this.element.classList.add('open');
        });

        document.addEventListener('keydown', this.handleKeydown);
        document.body.style.overflow = 'hidden';

        this.isOpen = true;
        this.emit('open');
    }

    /**
     * Close modal
     */
    close() {
        if (!this.isOpen) return;

        this.element.classList.remove('open');

        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }, 300);

        document.removeEventListener('keydown', this.handleKeydown);
        document.body.style.overflow = '';

        this.isOpen = false;
        this.emit('close');
    }

    /**
     * Set modal content
     */
    setContent(content) {
        this.content = content;
        if (this.element) {
            const body = this.element.querySelector('.modal-body');
            if (body) {
                body.innerHTML = content;
            }
        }
    }

    /**
     * Set modal title
     */
    setTitle(title) {
        this.title = title;
        if (this.element) {
            const titleEl = this.element.querySelector('.modal-title');
            if (titleEl) {
                titleEl.textContent = title;
            }
        }
    }

    /**
     * Add footer buttons
     */
    setFooter(buttons) {
        if (!this.element) return;

        const footer = this.element.querySelector('.modal-footer');
        if (!footer) return;

        footer.innerHTML = '';

        for (const btn of buttons) {
            const button = document.createElement('button');
            button.className = `btn ${btn.class || 'btn-secondary'}`;
            button.textContent = btn.text;

            if (btn.onClick) {
                button.addEventListener('click', btn.onClick);
            }

            if (btn.close) {
                button.addEventListener('click', () => this.close());
            }

            footer.appendChild(button);
        }
    }

    /**
     * Get element in modal body
     */
    getElement(selector) {
        return this.element?.querySelector(selector);
    }
}


/**
 * ConfirmModal - Confirmation dialog
 */
class ConfirmModal extends Modal {
    constructor(options = {}) {
        super({
            size: 'small',
            ...options,
        });

        this.message = options.message || 'Are you sure?';
        this.confirmText = options.confirmText || 'Confirm';
        this.cancelText = options.cancelText || 'Cancel';
        this.danger = options.danger || false;
    }

    /**
     * Create confirm modal
     */
    create() {
        this.content = `
            <p class="confirm-message">${this.message}</p>
        `;

        super.create();

        this.setFooter([
            {
                text: this.cancelText,
                class: 'btn-secondary',
                close: true,
            },
            {
                text: this.confirmText,
                class: this.danger ? 'btn-danger' : 'btn-primary',
                onClick: () => {
                    this.emit('confirm');
                    this.close();
                },
            },
        ]);

        return this.element;
    }

    /**
     * Show confirm modal and return promise
     */
    static confirm(options) {
        return new Promise((resolve) => {
            const modal = new ConfirmModal(options);

            modal.on('confirm', () => resolve(true));
            modal.on('close', () => resolve(false));

            modal.open();
        });
    }
}


/**
 * NewNotebookModal - Create new notebook dialog
 */
class NewNotebookModal extends Modal {
    constructor(options = {}) {
        super({
            title: 'Create New Notebook',
            size: 'medium',
            ...options,
        });

        this.colors = [
            '#e74c3c', '#e91e63', '#9c27b0', '#673ab7',
            '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
            '#009688', '#4caf50', '#8bc34a', '#cddc39',
            '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
        ];

        this.selectedColor = this.colors[0];
    }

    create() {
        this.content = `
            <div class="form-group">
                <label for="notebookName">Notebook Name</label>
                <input type="text" id="notebookName" class="form-input"
                       placeholder="My Notebook" autofocus>
            </div>

            <div class="form-group">
                <label>Cover Color</label>
                <div class="color-grid">
                    ${this.colors.map(color => `
                        <button class="color-option ${color === this.selectedColor ? 'active' : ''}"
                                data-color="${color}"
                                style="background-color: ${color}">
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="form-group">
                <label>Page Template</label>
                <div class="template-grid">
                    <button class="template-option active" data-template="blank">
                        <div class="template-preview blank"></div>
                        <span>Blank</span>
                    </button>
                    <button class="template-option" data-template="lined">
                        <div class="template-preview lined"></div>
                        <span>Lined</span>
                    </button>
                    <button class="template-option" data-template="grid">
                        <div class="template-preview grid"></div>
                        <span>Grid</span>
                    </button>
                    <button class="template-option" data-template="dotted">
                        <div class="template-preview dotted"></div>
                        <span>Dotted</span>
                    </button>
                </div>
            </div>
        `;

        super.create();

        // Color selection
        const colorOptions = this.element.querySelectorAll('.color-option');
        colorOptions.forEach(option => {
            option.addEventListener('click', () => {
                colorOptions.forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                this.selectedColor = option.dataset.color;
            });
        });

        // Template selection
        const templateOptions = this.element.querySelectorAll('.template-option');
        templateOptions.forEach(option => {
            option.addEventListener('click', () => {
                templateOptions.forEach(o => o.classList.remove('active'));
                option.classList.add('active');
            });
        });

        this.setFooter([
            {
                text: 'Cancel',
                class: 'btn-secondary',
                close: true,
            },
            {
                text: 'Create Notebook',
                class: 'btn-primary',
                onClick: () => this.handleCreate(),
            },
        ]);

        return this.element;
    }

    handleCreate() {
        const nameInput = this.element.querySelector('#notebookName');
        const activeTemplate = this.element.querySelector('.template-option.active');

        const notebook = {
            id: `notebook_${Date.now()}`,
            name: nameInput.value.trim() || 'Untitled Notebook',
            color: this.selectedColor,
            template: activeTemplate?.dataset.template || 'blank',
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            pageCount: 1,
        };

        this.emit('create', notebook);
        this.close();
    }
}


/**
 * ExportModal - Export options dialog
 */
class ExportModal extends Modal {
    constructor(options = {}) {
        super({
            title: 'Export Notebook',
            size: 'medium',
            ...options,
        });

        this.notebookId = options.notebookId;
    }

    create() {
        this.content = `
            <div class="export-options">
                <button class="export-option" data-format="pdf">
                    <i class="icon icon-pdf"></i>
                    <div class="export-info">
                        <span class="export-title">PDF Document</span>
                        <span class="export-desc">Best for sharing and printing</span>
                    </div>
                </button>

                <button class="export-option" data-format="png">
                    <i class="icon icon-image"></i>
                    <div class="export-info">
                        <span class="export-title">PNG Images</span>
                        <span class="export-desc">One image per page</span>
                    </div>
                </button>

                <button class="export-option" data-format="svg">
                    <i class="icon icon-vector"></i>
                    <div class="export-info">
                        <span class="export-title">SVG Vector</span>
                        <span class="export-desc">Scalable vector graphics</span>
                    </div>
                </button>

                <button class="export-option" data-format="json">
                    <i class="icon icon-code"></i>
                    <div class="export-info">
                        <span class="export-title">JSON Backup</span>
                        <span class="export-desc">Full notebook backup</span>
                    </div>
                </button>
            </div>
        `;

        super.create();

        // Handle export option clicks
        const options = this.element.querySelectorAll('.export-option');
        options.forEach(option => {
            option.addEventListener('click', () => {
                const format = option.dataset.format;
                this.emit('export', { format, notebookId: this.notebookId });
                this.close();
            });
        });

        return this.element;
    }
}


/**
 * SettingsModal - Application settings dialog
 */
class SettingsModal extends Modal {
    constructor(options = {}) {
        super({
            title: 'Settings',
            size: 'large',
            ...options,
        });

        this.settings = options.settings || {};
    }

    create() {
        this.content = `
            <div class="settings-container">
                <div class="settings-nav">
                    <button class="settings-nav-item active" data-section="general">
                        <i class="icon icon-settings"></i>
                        General
                    </button>
                    <button class="settings-nav-item" data-section="pen">
                        <i class="icon icon-pen"></i>
                        Pen & Stylus
                    </button>
                    <button class="settings-nav-item" data-section="appearance">
                        <i class="icon icon-palette"></i>
                        Appearance
                    </button>
                    <button class="settings-nav-item" data-section="backup">
                        <i class="icon icon-cloud"></i>
                        Backup
                    </button>
                </div>

                <div class="settings-content">
                    <div class="settings-section active" data-section="general">
                        <h4>General Settings</h4>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Auto-save</span>
                                <span class="setting-desc">Automatically save changes</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="autoSave" ${this.settings.autoSave !== false ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Auto-save interval</span>
                                <span class="setting-desc">How often to save (seconds)</span>
                            </div>
                            <input type="number" id="autoSaveInterval" class="form-input small"
                                   value="${this.settings.autoSaveInterval || 30}" min="5" max="300">
                        </div>
                    </div>

                    <div class="settings-section" data-section="pen">
                        <h4>Pen & Stylus Settings</h4>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Pressure Sensitivity</span>
                                <span class="setting-desc">Enable pressure-sensitive drawing</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="pressureEnabled" ${this.settings.pressureEnabled !== false ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Pressure Curve</span>
                                <span class="setting-desc">Adjust pressure response</span>
                            </div>
                            <select id="pressureCurve" class="form-input small">
                                <option value="linear" ${this.settings.pressureCurve === 'linear' ? 'selected' : ''}>Linear</option>
                                <option value="soft" ${this.settings.pressureCurve === 'soft' ? 'selected' : ''}>Soft</option>
                                <option value="firm" ${this.settings.pressureCurve === 'firm' ? 'selected' : ''}>Firm</option>
                            </select>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Palm Rejection</span>
                                <span class="setting-desc">Ignore palm touches while using stylus</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="palmRejection" ${this.settings.palmRejection !== false ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Stroke Smoothing</span>
                                <span class="setting-desc">Amount of stroke stabilization</span>
                            </div>
                            <input type="range" id="strokeSmoothing" class="form-range"
                                   min="0" max="10" value="${this.settings.strokeSmoothing || 5}">
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Dynamic Brush (Pressure Thickness)</span>
                                <span class="setting-desc">Vary line thickness based on pen pressure</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="dynamicBrushEnabled" ${this.settings.dynamicBrushEnabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Pressure Thickness Multiplier</span>
                                <span class="setting-desc">How much pressure affects line thickness (${this.settings.pressureMultiplier || 1.0}x)</span>
                            </div>
                            <input type="range" id="pressureMultiplier" class="form-range"
                                   min="0.1" max="3" step="0.1" value="${this.settings.pressureMultiplier || 1.0}">
                        </div>
                    </div>

                    <div class="settings-section" data-section="appearance">
                        <h4>Appearance Settings</h4>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Theme</span>
                                <span class="setting-desc">Choose color theme</span>
                            </div>
                            <select id="theme" class="form-input small">
                                <option value="dark" ${this.settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
                                <option value="light" ${this.settings.theme === 'light' ? 'selected' : ''}>Light</option>
                                <option value="system" ${this.settings.theme === 'system' ? 'selected' : ''}>System</option>
                            </select>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">High Refresh Rate</span>
                                <span class="setting-desc">Enable 120Hz rendering if supported</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="highRefreshRate" ${this.settings.highRefreshRate !== false ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Show Grid</span>
                                <span class="setting-desc">Display canvas grid overlay</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="showGrid" ${this.settings.showGrid ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="settings-section" data-section="backup">
                        <h4>Backup & Sync</h4>

                        <div class="setting-item">
                            <div class="setting-info">
                                <span class="setting-label">Auto Backup</span>
                                <span class="setting-desc">Automatically backup notebooks</span>
                            </div>
                            <label class="toggle">
                                <input type="checkbox" id="autoBackup" ${this.settings.autoBackup ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <div class="backup-actions">
                            <button class="btn btn-secondary" data-action="export-all">
                                <i class="icon icon-download"></i>
                                Export All Notebooks
                            </button>
                            <button class="btn btn-secondary" data-action="import">
                                <i class="icon icon-upload"></i>
                                Import Backup
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        super.create();

        // Section navigation
        const navItems = this.element.querySelectorAll('.settings-nav-item');
        const sections = this.element.querySelectorAll('.settings-section');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.dataset.section;

                navItems.forEach(i => i.classList.remove('active'));
                sections.forEach(s => s.classList.remove('active'));

                item.classList.add('active');
                this.element.querySelector(`.settings-section[data-section="${section}"]`)?.classList.add('active');
            });
        });

        this.setFooter([
            {
                text: 'Cancel',
                class: 'btn-secondary',
                close: true,
            },
            {
                text: 'Save Settings',
                class: 'btn-primary',
                onClick: () => this.handleSave(),
            },
        ]);

        return this.element;
    }

    handleSave() {
        const settings = {
            autoSave: this.element.querySelector('#autoSave').checked,
            autoSaveInterval: parseInt(this.element.querySelector('#autoSaveInterval').value, 10),
            pressureEnabled: this.element.querySelector('#pressureEnabled').checked,
            pressureCurve: this.element.querySelector('#pressureCurve').value,
            palmRejection: this.element.querySelector('#palmRejection').checked,
            strokeSmoothing: parseInt(this.element.querySelector('#strokeSmoothing').value, 10),
            dynamicBrushEnabled: this.element.querySelector('#dynamicBrushEnabled').checked,
            pressureMultiplier: parseFloat(this.element.querySelector('#pressureMultiplier').value),
            theme: this.element.querySelector('#theme').value,
            highRefreshRate: this.element.querySelector('#highRefreshRate').checked,
            showGrid: this.element.querySelector('#showGrid').checked,
            autoBackup: this.element.querySelector('#autoBackup').checked,
        };

        this.emit('save', settings);
        this.close();
    }
}


// Make available globally
window.Modal = Modal;
window.ConfirmModal = ConfirmModal;
window.NewNotebookModal = NewNotebookModal;
window.ExportModal = ExportModal;
window.SettingsModal = SettingsModal;
