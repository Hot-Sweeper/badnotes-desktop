/**
 * Toolbar - Main application toolbar
 * Handles tool selection, color picker, and stroke settings
 */
class Toolbar extends EventEmitter {
    constructor(options = {}) {
        super();

        this.element = document.querySelector('.toolbar');
        this.toolGroups = {};
        this.currentTool = null;

        // Color/size settings
        this.currentColor = '#ffffff';
        this.currentSize = 1.5;

        // Initialize
        this.init();
    }

    /**
     * Initialize toolbar
     */
    init() {
        this.bindEvents();
        this.initColorPicker();
        this.initSizeSlider();
        this.selectTool('pen');
    }

    /**
     * Bind toolbar events
     */
    bindEvents() {
        // Tool buttons
        const toolButtons = this.element.querySelectorAll('.tool-btn[data-tool]');
        toolButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                if (tool) {
                    this.selectTool(tool);
                }
            });
        });

        // Color presets
        const colorPresets = this.element.querySelectorAll('.color-preset');
        colorPresets.forEach(preset => {
            preset.addEventListener('click', () => {
                const color = preset.dataset.color;
                if (color) {
                    this.setColor(color);
                }
            });
        });

        // Custom color input
        const colorInput = this.element.querySelector('#colorInput');
        if (colorInput) {
            colorInput.addEventListener('input', (e) => {
                this.setColor(e.target.value);
            });
        }

        // Undo/Redo buttons
        const undoBtn = this.element.querySelector('[data-action="undo"]');
        const redoBtn = this.element.querySelector('[data-action="redo"]');

        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.emit('undo'));
        }
        if (redoBtn) {
            redoBtn.addEventListener('click', () => this.emit('redo'));
        }

        // Shape type dropdown
        const shapeType = this.element.querySelector('#shapeType');
        if (shapeType) {
            shapeType.addEventListener('change', (e) => {
                this.emit('shapeTypeChanged', e.target.value);
            });
        }

        // Pen type dropdown
        const penType = this.element.querySelector('#penType');
        if (penType) {
            penType.addEventListener('change', (e) => {
                this.emit('penTypeChanged', e.target.value);
            });
        }

        // Fill toggle
        const fillToggle = this.element.querySelector('#fillToggle');
        if (fillToggle) {
            fillToggle.addEventListener('change', (e) => {
                this.emit('fillChanged', e.target.checked);
            });
        }

        // Pressure toggle
        const pressureToggle = this.element.querySelector('#pressureToggle');
        if (pressureToggle) {
            pressureToggle.addEventListener('change', (e) => {
                this.emit('pressureChanged', e.target.checked);
            });
        }

        // Theme toggle
        const themeBtn = this.element.querySelector('#theme-toggle-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                document.body.classList.toggle('dark-theme');
            });
        }
    }

    /**
     * Initialize color picker
     */
    initColorPicker() {
        const colorPickerBtn = this.element.querySelector('.color-picker-btn');
        const colorPickerPanel = this.element.querySelector('.color-picker-panel');

        if (colorPickerBtn && colorPickerPanel) {
            colorPickerBtn.addEventListener('click', () => {
                colorPickerPanel.classList.toggle('visible');
            });

            // Close when clicking outside
            document.addEventListener('click', (e) => {
                if (!colorPickerBtn.contains(e.target) && !colorPickerPanel.contains(e.target)) {
                    colorPickerPanel.classList.remove('visible');
                }
            });
        }
    }

    /**
     * Initialize size slider
     */
    initSizeSlider() {
        const sizeSlider = this.element.querySelector('#sizeSlider');
        const sizeValue = this.element.querySelector('#sizeValue');

        if (sizeSlider) {
            sizeSlider.addEventListener('input', (e) => {
                const size = parseFloat(e.target.value);
                this.setSize(size);

                if (sizeValue) {
                    sizeValue.textContent = `${size}px`;
                }
            });
        }
    }

    /**
     * Select a tool
     */
    selectTool(toolName) {
        // Update UI
        const toolButtons = this.element.querySelectorAll('.tool-btn');
        toolButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === toolName);
        });

        // Show/hide tool-specific options
        this.showToolOptions(toolName);

        this.currentTool = toolName;
        this.emit('toolSelected', toolName);
    }

    /**
     * Show tool-specific options
     */
    showToolOptions(toolName) {
        const toolOptions = this.element.querySelectorAll('.tool-options');
        toolOptions.forEach(options => {
            const forTools = options.dataset.forTools?.split(',') || [];
            options.classList.toggle('visible', forTools.includes(toolName));
        });
    }

    /**
     * Set current color
     */
    setColor(color) {
        this.currentColor = color;

        // Update color preview
        const colorPreview = this.element.querySelector('.current-color');
        if (colorPreview) {
            colorPreview.style.backgroundColor = color;
        }

        // Update active color preset
        const colorPresets = this.element.querySelectorAll('.color-preset');
        colorPresets.forEach(preset => {
            preset.classList.toggle('active', preset.dataset.color === color);
        });

        this.emit('colorChanged', color);
    }

    /**
     * Set current stroke size
     */
    setSize(size) {
        this.currentSize = size;

        const sizeSlider = this.element.querySelector('#sizeSlider');
        if (sizeSlider) {
            sizeSlider.value = size;
        }

        this.emit('sizeChanged', size);
    }

    /**
     * Get current settings
     */
    getSettings() {
        return {
            tool: this.currentTool,
            color: this.currentColor,
            size: this.currentSize,
        };
    }

    /**
     * Update undo/redo button states
     */
    updateHistoryButtons(canUndo, canRedo) {
        const undoBtn = this.element.querySelector('[data-action="undo"]');
        const redoBtn = this.element.querySelector('[data-action="redo"]');

        if (undoBtn) {
            undoBtn.disabled = !canUndo;
            undoBtn.classList.toggle('disabled', !canUndo);
        }
        if (redoBtn) {
            redoBtn.disabled = !canRedo;
            redoBtn.classList.toggle('disabled', !canRedo);
        }
    }

    /**
     * Add custom tool button
     */
    addToolButton(config) {
        const toolGroup = this.element.querySelector('.tool-group');
        if (!toolGroup) return;

        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.dataset.tool = config.name;
        btn.title = config.label;
        btn.innerHTML = `<i class="icon icon-${config.icon}"></i>`;

        if (config.tooltip) {
            btn.setAttribute('data-tooltip', config.tooltip);
        }

        btn.addEventListener('click', () => {
            this.selectTool(config.name);
        });

        toolGroup.appendChild(btn);
    }

    /**
     * Toggle toolbar visibility
     */
    toggle() {
        this.element.classList.toggle('collapsed');
    }

    /**
     * Show toolbar
     */
    show() {
        this.element.classList.remove('hidden');
    }

    /**
     * Hide toolbar
     */
    hide() {
        this.element.classList.add('hidden');
    }
}


// Make available globally
window.Toolbar = Toolbar;
