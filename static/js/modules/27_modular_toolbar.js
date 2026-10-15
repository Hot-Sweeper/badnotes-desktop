// ============== Modular Toolbar System ==============
// Allows full customization and rearrangement of toolbar items

const ModularToolbar = (function() {
    'use strict';

    // SVG icons for all tools
    const ICONS = {
        fingerDraw: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>`,
        pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
        </svg>`,
        highlighter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l-6 6v3h9l3-3"/>
            <path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4"/>
        </svg>`,
        eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.4 3a2 2 0 012.8 0L21 7.8c.8.8.8 2 0 2.8L12 19"/>
        </svg>`,
        importFile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>`,
        handwrittenText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            <path d="m15 5 4 4"/>
        </svg>`,
        simpleText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16"/>
            <path d="M12 6v12"/>
            <path d="M8 18h8"/>
        </svg>`,
        shapes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="4" y1="20" x2="20" y2="4"/>
        </svg>`,
        shapeLine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="4" y1="20" x2="20" y2="4"/>
        </svg>`,
        shapeRectangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>`,
        shapeCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="8"/>
        </svg>`,
        shapeArrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="12" x2="20" y2="12"/>
            <polyline points="14,6 20,12 14,18"/>
        </svg>`,
        lasso: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="3 3"><path d="M18 17c4-2 5-7 1-10S7 3 4 7s0 10 5 12 10 0 8-4-6-1-5 2c1 2 4 3 6 5"/></svg>`,
        geometry: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12,2 22,20 2,20"/>
            <circle cx="12" cy="14" r="4" stroke-dasharray="2,2"/>
        </svg>`,
        pipette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 11.5l-7-7a2 2 0 0 0-2.8 0L4.5 9.2a2 2 0 0 0 0 2.8l7 7L19 11.5z"/>
            <path d="M13.5 5.5l3 3"/>
            <path d="M2 22l5-5"/>
        </svg>`,
        theme: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>`,
        undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10h10a5 5 0 0 1 5 5v2"/>
            <path d="M3 10l5-5"/>
            <path d="M3 10l5 5"/>
        </svg>`,
        redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10H11a5 5 0 0 0-5 5v2"/>
            <path d="M21 10l-5-5"/>
            <path d="M21 10l-5 5"/>
        </svg>`,
        fontTrainer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            <path d="M4 7V4h3"/>
        </svg>`,
        settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.65 9.65L21.90 10.59L21.90 13.41L19.65 14.35L19.07 15.74L20.00 18.00L18.00 20.00L15.74 19.07L14.35 19.65L13.41 21.90L10.59 21.90L9.65 19.65L8.26 19.07L6.00 20.00L4.00 18.00L4.93 15.74L4.35 14.35L2.10 13.41L2.10 10.59L4.35 9.65L4.93 8.26L4.00 6.00L6.00 4.00L8.26 4.93L9.65 4.35L10.59 2.10L13.41 2.10L14.35 4.35L15.74 4.93L18.00 4.00L20.00 6.00L19.07 8.26Z"/>
        </svg>`,
        fullscreen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
            <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
            <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
            <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>`,
        collapse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
        </svg>`,
        dragHandle: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
            <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>`,
        colorSwap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M7 16l-4-4 4-4"/>
            <path d="M17 8l4 4-4 4"/>
        </svg>`,
        dynamicBrush: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4"/>
            <path d="M12 18v4"/>
            <path d="M4.93 4.93l2.83 2.83"/>
            <path d="M16.24 16.24l2.83 2.83"/>
            <path d="M2 12h4"/>
            <path d="M18 12h4"/>
            <path d="M4.93 19.07l2.83-2.83"/>
            <path d="M16.24 7.76l2.83-2.83"/>
        </svg>`,
    };

    // Default toolbar configuration - defines all available items
    const DEFAULT_CONFIG = [
        {
            type: 'section',
            id: 'drawing-tools',
            items: [
                { type: 'button', id: 'fingerDrawBtn', icon: 'fingerDraw', title: 'Toggle Finger Drawing', toggleable: true },
                { type: 'separator' },
                { type: 'tool', id: 'pen', icon: 'pen', title: 'Pen (P)', shortcut: 'P', default: true },
                { type: 'tool', id: 'highlighter', icon: 'highlighter', title: 'Highlighter (H)', shortcut: 'H' },
                { type: 'tool', id: 'lasso', icon: 'lasso', title: 'Lasso selection (L)', shortcut: 'L' },
                { type: 'dropdown', id: 'eraser-dropdown', items: [
                    { type: 'tool', id: 'eraser', icon: 'eraser', title: 'Eraser (E)', shortcut: 'E' }
                ], submenu: [
                    { type: 'mode', id: 'point', label: 'Point', default: true },
                    { type: 'mode', id: 'object', label: 'Object' }
                ]}
            ]
        },
        { type: 'separator' },
        {
            type: 'section',
            id: 'import-tools',
            items: [
                { type: 'button', id: 'importFileBtn', icon: 'importFile', title: 'Import File (I)', shortcut: 'I' },
                { type: 'button', id: 'handwrittenTextBtn', icon: 'simpleText', title: 'Handwritten Text (T)', shortcut: 'T' }
            ]
        },
        {
            type: 'section',
            id: 'geometry',
            items: [
                { type: 'button', id: 'geometryToggleBtn', icon: 'geometry', title: 'Geometry Mode (G) - Auto-detect shapes', toggleable: true, shortcut: 'G' }
            ]
        },
        { type: 'separator' },
        {
            type: 'section',
            id: 'color-section',
            className: 'color-section',
            items: [
                { type: 'color-presets' }
            ]
        },
        { type: 'separator' },
        {
            type: 'section',
            id: 'size-section',
            className: 'size-section',
            items: [
                { type: 'size-slider', id: 'sizeSlider', min: 0.5, max: 10, step: 0.1, default: 1.5 },
                { type: 'dynamic-brush-toggle', id: 'dynamicBrushToggle' }
            ]
        },
        { type: 'separator' },
        {
            type: 'section',
            id: 'actions',
            items: [
                { type: 'button', id: 'themeToggleBtn', icon: 'theme', title: 'Toggle Light/Dark Mode' },
                { type: 'button', id: 'undoBtn', icon: 'undo', title: 'Undo (Ctrl+Z)' },
                { type: 'button', id: 'redoBtn', icon: 'redo', title: 'Redo (Ctrl+Y)' },
                { type: 'zoom-display', id: 'zoomValue', title: 'Click to reset zoom' },
                { type: 'button', id: 'settingsBtn', icon: 'settings', title: 'Settings' },
                { type: 'button', id: 'fullscreenBtn', icon: 'fullscreen', title: 'Fullscreen (F11)' }
            ]
        }
    ];

    // Current toolbar configuration (can be customized by user)
    let currentConfig = null;
    let toolbarElement = null;
    let contentElement = null;
    let dragState = { isDragging: false, draggedItem: null, placeholder: null };
    let editMode = false;

    // Load configuration from localStorage or use default
    function loadConfig() {
        try {
            const saved = localStorage.getItem('badnotes_toolbar_config');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate saved config has all required items (in case new features added)
                currentConfig = mergeWithDefault(parsed);
            } else {
                currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            }
        } catch (e) {
            console.warn('Failed to load toolbar config:', e);
            currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
        return currentConfig;
    }

    // Merge saved config with default to include any new items
    function mergeWithDefault(saved) {
        // For now, just use saved config
        // Future: merge logic to add new items from DEFAULT_CONFIG
        return saved;
    }

    // Migrate existing customized layouts without resetting their ordering.
    function simplifyPaletteToolbar(items) {
        return items.filter(item=>!['pipetteBtn','simpleTextBtn','fontTrainerBtn','gestureControlBtn'].includes(item.id) && item.type!=='color-picker').map(item=>{
            const result={...item};
            if(result.items)result.items=simplifyPaletteToolbar(result.items);
            if(result.id==='handwrittenTextBtn')result.icon='simpleText';
            return result;
        });
    }

    // Save configuration to localStorage
    function saveConfig() {
        try {
            localStorage.setItem('badnotes_toolbar_config', JSON.stringify(currentConfig));
        } catch (e) {
            console.warn('Failed to save toolbar config:', e);
        }
    }

    // Reset configuration to default
    function resetConfig() {
        currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        saveConfig();
        render();
    }

    // Get icon SVG by name
    function getIcon(name) {
        return ICONS[name] || '';
    }

    // Render a single toolbar item
    function renderItem(item) {
        switch (item.type) {
            case 'button':
                return renderButton(item);
            case 'tool':
                return renderTool(item);
            case 'separator':
                return '<div class="toolbar-separator"></div>';
            case 'dropdown':
                return renderDropdown(item);
            case 'shapes-dropdown':
                return renderShapesDropdown(item);
            case 'color-picker':
                return renderColorPicker();
            case 'color-presets':
                return renderColorPresets();
            case 'size-slider':
                return renderSizeSlider(item);
            case 'dynamic-brush-toggle':
                return renderDynamicBrushToggle(item);
            case 'zoom-display':
                return renderZoomDisplay(item);
            default:
                return '';
        }
    }

    // Render button
    function renderButton(item) {
        const activeClass = item.toggleable && item.active ? ' active' : '';
        const draggableAttr = editMode ? 'draggable="true"' : '';
        let html = `<button class="tool-btn${activeClass}" id="${item.id}" title="${item.title}" ${draggableAttr} data-toolbar-item="${item.id}">
            ${getIcon(item.icon)}
        </button>`;

        // Add hidden file input for import button
        if (item.id === 'importFileBtn') {
            html += `<input type="file" id="fileInput" accept="image/*" style="display: none;">`;
        }

        return html;
    }

    // Render tool button (with data-tool attribute)
    function renderTool(item) {
        const activeClass = item.default ? ' active' : '';
        const draggableAttr = editMode ? 'draggable="true"' : '';
        return `<button class="tool-btn${activeClass}" data-tool="${item.id}" title="${item.title}" ${draggableAttr} data-toolbar-item="${item.id}">
            ${getIcon(item.icon)}
        </button>`;
    }

    // Render eraser dropdown
    function renderDropdown(item) {
        const draggableAttr = editMode ? 'draggable="true"' : '';
        let html = `<div class="eraser-dropdown" ${draggableAttr} data-toolbar-item="${item.id}">`;
        item.items.forEach(subItem => {
            html += renderItem(subItem);
        });
        if (item.submenu) {
            html += `<div class="eraser-modes" id="eraserModes">`;
            item.submenu.forEach(mode => {
                const activeClass = mode.default ? ' active' : '';
                html += `<button class="eraser-mode${activeClass}" data-mode="${mode.id}" title="${mode.label} Eraser">${mode.label}</button>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    // Render shapes dropdown
    function renderShapesDropdown(item) {
        const defaultShape = item.shapes.find(s => s.default) || item.shapes[0];
        const draggableAttr = editMode ? 'draggable="true"' : '';
        let html = `<div class="shapes-dropdown" ${draggableAttr} data-toolbar-item="${item.id}">
            <button class="tool-btn" id="shapeDropdownBtn" data-tool="line" title="Shapes">
                ${getIcon(defaultShape.icon)}
            </button>
            <div class="shapes-menu" id="shapesMenu">`;
        item.shapes.forEach(shape => {
            const activeClass = shape.default ? ' active' : '';
            html += `<button class="tool-btn${activeClass}" data-shape="${shape.id}" title="${shape.title}">
                ${getIcon(shape.icon)}
            </button>`;
        });
        html += `</div></div>`;
        return html;
    }

    // Render color picker
    function renderColorPicker() {
        const draggableAttr = editMode ? 'draggable="true"' : '';
        return `<div class="color-swap-container" id="colorSwapContainer" title="Click to swap colors (X)" ${draggableAttr} data-toolbar-item="color-picker">
            <div class="primary-color-swatch" id="primaryColorSwatch">
                <input type="color" id="colorPicker" class="color-input-hidden" value="#ffffff">
            </div>
            <div class="secondary-color-swatch" id="secondaryColorSwatch" title="Secondary color (Barrel button)">
                <input type="color" id="secondaryColorPicker" class="color-input-hidden" value="#ff4444">
            </div>
            <button class="color-swap-btn" id="colorSwapBtn" title="Swap colors (X)">
                ${getIcon('colorSwap')}
            </button>
        </div>`;
    }

    // Render color presets
    function renderColorPresets() {
        const draggableAttr = editMode ? 'draggable="true"' : '';
        return `<div class="color-presets" id="colorPresets" ${draggableAttr} data-toolbar-item="color-presets">
            <!-- Presets generated by existing JS -->
        </div>
        <div class="color-overflow-indicator" id="colorOverflowIndicator" title="More colors available">...</div>
        <button class="add-color-btn" id="addColorBtn" title="Add current color to palette">+</button>`;
    }

    // Render size slider
    function renderSizeSlider(item) {
        const draggableAttr = editMode ? 'draggable="true"' : '';
        return `<div class="size-slider-wrapper" ${draggableAttr} data-toolbar-item="${item.id}">
            <input type="range" class="size-slider" id="sizeSlider" min="${item.min}" max="${item.max}" step="${item.step}" value="${item.default}">
            <span class="size-value" id="sizeValue">${item.default}px</span>
        </div>`;
    }

    // Render dynamic brush toggle
    function renderDynamicBrushToggle(item) {
        const draggableAttr = editMode ? 'draggable="true"' : '';
        return `<label class="dynamic-brush-toggle" title="Dynamic brush size based on pressure" ${draggableAttr} data-toolbar-item="${item.id}">
            <input type="checkbox" id="dynamicBrushToggle">
            <div class="dynamic-brush-icon">
                ${getIcon('dynamicBrush')}
            </div>
        </label>`;
    }

    // Render zoom display
    function renderZoomDisplay(item) {
        const draggableAttr = editMode ? 'draggable="true"' : '';
        return `<span class="zoom-value" id="zoomValue" title="${item.title}" ${draggableAttr} data-toolbar-item="${item.id}">100%</span>`;
    }

    // Render a section
    function renderSection(section) {
        const className = section.className ? ` ${section.className}` : '';
        const draggableAttr = editMode ? 'draggable="true"' : '';
        let html = `<div class="toolbar-section${className}" data-section-id="${section.id}" ${draggableAttr}>`;
        section.items.forEach(item => {
            html += renderItem(item);
        });
        html += `</div>`;
        return html;
    }

    // Main render function
    function render() {
        currentConfig=simplifyPaletteToolbar(currentConfig || DEFAULT_CONFIG);
        const drawing=currentConfig.find(item=>item.id==='drawing-tools');
        if(drawing&&!drawing.items.some(item=>item.id==='lasso'))drawing.items.splice(3,0,{type:'tool',id:'lasso',icon:'lasso',title:'Lasso selection (L)',shortcut:'L'});
        if (!contentElement) {
            console.warn('Toolbar content element not found');
            return;
        }

        // Filter out hidden sections
        let html = '';
        currentConfig.forEach(item => {
            if (item.type === 'section' && !item.hidden) {
                html += renderSection(item);
            } else if (item.type === 'separator' && !item.hidden) {
                html += '<div class="toolbar-separator"></div>';
            }
        });

        // Retain a hidden color input for palette/radial-menu integration;
        // no primary/secondary swatches occupy space in the toolbar.
        contentElement.innerHTML = html+'<input type="color" id="colorPicker" value="#ffffff" hidden style="display:none">';

        // Re-bind core events after render
        bindToolbarEvents();
        if(typeof updateThemeIcon==='function')updateThemeIcon();

        // Trigger event for other modules to rebind their specific events
        window.dispatchEvent(new CustomEvent('toolbarRendered'));
    }

    // Bind toolbar events (tools, buttons, etc.)
    function bindToolbarEvents() {
        // Tool buttons
        contentElement.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = btn.dataset.tool;
                if (tool && typeof setTool === 'function') {
                    setTool(tool);
                    // Update active states
                    contentElement.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });
        });

        // Eraser modes
        contentElement.querySelectorAll('.eraser-mode').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = btn.dataset.mode;
                if (mode && typeof setEraserMode === 'function') {
                    setEraserMode(mode);
                }
                contentElement.querySelectorAll('.eraser-mode').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Shape buttons
        contentElement.querySelectorAll('[data-shape]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const shape = btn.dataset.shape;
                if (shape && typeof setCurrentShape === 'function') {
                    setCurrentShape(shape);
                }
                contentElement.querySelectorAll('[data-shape]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update dropdown button icon
                const dropdownBtn = document.getElementById('shapeDropdownBtn');
                if (dropdownBtn) {
                    dropdownBtn.innerHTML = btn.innerHTML;
                    dropdownBtn.dataset.tool = shape;
                }

                // Close menu
                const menu = document.getElementById('shapesMenu');
                if (menu) menu.classList.remove('open');
            });
        });

        // Setup drag-drop for edit mode
        if (editMode) {
            setupDragDrop();
        }
    }

    // Toggle edit mode for rearranging
    function toggleEditMode() {
        editMode = !editMode;
        if (toolbarElement) {
            toolbarElement.classList.toggle('edit-mode', editMode);
        }
        render();
        return editMode;
    }

    // Setup drag and drop for reordering sections
    function setupDragDrop() {
        const sections = contentElement.querySelectorAll('.toolbar-section');

        sections.forEach(section => {
            section.addEventListener('dragstart', handleDragStart);
            section.addEventListener('dragend', handleDragEnd);
            section.addEventListener('dragover', handleDragOver);
            section.addEventListener('drop', handleDrop);
            section.addEventListener('dragenter', handleDragEnter);
            section.addEventListener('dragleave', handleDragLeave);
        });
    }

    function handleDragStart(e) {
        dragState.isDragging = true;
        dragState.draggedItem = e.target.closest('.toolbar-section');
        if (dragState.draggedItem) {
            dragState.draggedItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragState.draggedItem.dataset.sectionId);
        }
    }

    function handleDragEnd(e) {
        if (dragState.draggedItem) {
            dragState.draggedItem.classList.remove('dragging');
        }
        contentElement.querySelectorAll('.toolbar-section').forEach(s => {
            s.classList.remove('drag-over');
        });
        dragState.isDragging = false;
        dragState.draggedItem = null;
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDragEnter(e) {
        e.preventDefault();
        const section = e.target.closest('.toolbar-section');
        if (section && section !== dragState.draggedItem) {
            section.classList.add('drag-over');
        }
    }

    function handleDragLeave(e) {
        const section = e.target.closest('.toolbar-section');
        if (section) {
            section.classList.remove('drag-over');
        }
    }

    function handleDrop(e) {
        e.preventDefault();
        const targetSection = e.target.closest('.toolbar-section');
        if (!targetSection || targetSection === dragState.draggedItem) return;

        const draggedId = e.dataTransfer.getData('text/plain');
        const targetId = targetSection.dataset.sectionId;

        // Reorder config
        reorderSections(draggedId, targetId);
        saveConfig();
        render();
    }

    // Reorder sections in config
    function reorderSections(draggedId, targetId) {
        const draggedIndex = currentConfig.findIndex(s => s.type === 'section' && s.id === draggedId);
        const targetIndex = currentConfig.findIndex(s => s.type === 'section' && s.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        const [removed] = currentConfig.splice(draggedIndex, 1);
        currentConfig.splice(targetIndex, 0, removed);
    }

    // Initialize the modular toolbar
    function init(toolbarSelector = '.floating-toolbar') {
        toolbarElement = document.querySelector(toolbarSelector);
        if (!toolbarElement) {
            console.warn('Toolbar element not found');
            return;
        }

        contentElement = toolbarElement.querySelector('.toolbar-content') || toolbarElement.querySelector('#toolbarContent');
        if (!contentElement) {
            console.warn('Toolbar content element not found');
            return;
        }

        loadConfig();
        render();
    }

    // Get current configuration
    function getConfig() {
        return currentConfig;
    }

    // Set configuration
    function setConfig(config) {
        currentConfig = config;
        saveConfig();
        render();
    }

    // Toggle visibility of a section
    function toggleSection(sectionId, visible) {
        const section = currentConfig.find(s => s.type === 'section' && s.id === sectionId);
        if (section) {
            section.hidden = !visible;
            saveConfig();
            render();
        }
    }

    // Public API
    return {
        init,
        render,
        loadConfig,
        saveConfig,
        resetConfig,
        getConfig,
        setConfig,
        toggleEditMode,
        toggleSection,
        ICONS,
        DEFAULT_CONFIG
    };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.ModularToolbar = ModularToolbar;
}
