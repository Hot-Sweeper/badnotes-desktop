// ============== Radial Menu ==============
// A customizable radial/pie menu for quick tool access via pen barrel button

(function() {
    'use strict';

    // ==================== Configuration ====================

    // Default available actions for menu slices
    function activateTool(toolId) {
        const button = document.querySelector(`.tool-btn[data-tool="${toolId}"]`);
        if (button) button.click();
        else currentTool = toolId;
    }

    const RADIAL_ACTIONS = {
        pen: {
            id: 'pen',
            label: 'Pen',
            icon: '✎',
            type: 'tool',
            action: () => activateTool('pen')
        },
        eraser: {
            id: 'eraser',
            label: 'Eraser',
            icon: '▱',
            type: 'tool',
            action: () => activateTool('eraser')
        },
        highlighter: {
            id: 'highlighter',
            label: 'Highlighter',
            icon: '▰',
            type: 'tool',
            action: () => activateTool('highlighter')
        },
        undo: {
            id: 'undo',
            label: 'Undo',
            icon: '↶',
            type: 'action',
            action: () => {
                if (typeof undo === 'function') undo();
            }
        },
        redo: {
            id: 'redo',
            label: 'Redo',
            icon: '↷',
            type: 'action',
            action: () => {
                if (typeof redo === 'function') redo();
            }
        },
        lasso: {
            id: 'lasso',
            label: 'Lasso',
            icon: '◯',
            type: 'action',
            action: () => {
                window.__radialLassoArmed = true;
                showToast('Drag on the page to lasso-select', 'info');
            }
        },
        color: {
            id: 'color',
            label: 'Pick Color',
            icon: '◉',
            type: 'action',
            action: () => {
                // Open color picker
                const colorPicker = document.getElementById('colorPicker');
                if (colorPicker) colorPicker.click();
            }
        },
        clear: {
            id: 'clear',
            label: 'Clear',
            icon: '×',
            type: 'action',
            action: () => {
                if (typeof clearCanvas === 'function') {
                    if (confirm('Clear all strokes on this page?')) {
                        clearCanvas();
                    }
                }
            }
        },
        // Color preset actions - switch to pen with specific color
        color_red: {
            id: 'color_red',
            label: 'Red',
            type: 'color',
            colorValue: '#ff4444',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#ff4444');
            }
        },
        color_green: {
            id: 'color_green',
            label: 'Green',
            type: 'color',
            colorValue: '#44ff44',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#44ff44');
            }
        },
        color_blue: {
            id: 'color_blue',
            label: 'Blue',
            type: 'color',
            colorValue: '#4488ff',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#4488ff');
            }
        },
        color_yellow: {
            id: 'color_yellow',
            label: 'Yellow',
            type: 'color',
            colorValue: '#ffdd44',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#ffdd44');
            }
        },
        color_orange: {
            id: 'color_orange',
            label: 'Orange',
            type: 'color',
            colorValue: '#ff8844',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#ff8844');
            }
        },
        color_purple: {
            id: 'color_purple',
            label: 'Purple',
            type: 'color',
            colorValue: '#aa44ff',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#aa44ff');
            }
        },
        color_white: {
            id: 'color_white',
            label: 'White',
            type: 'color',
            colorValue: '#ffffff',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#ffffff');
            }
        },
        color_black: {
            id: 'color_black',
            label: 'Black',
            type: 'color',
            colorValue: '#222222',
            action: () => {
                currentTool = 'pen';
                if (typeof setColor === 'function') setColor('#222222');
            }
        },
        none: {
            id: 'none',
            label: 'Empty',
            icon: '➖',
            type: 'none',
            action: () => {}
        }
    };

    // ==================== State ====================

    let radialMenuState = {
        isOpen: false,
        centerX: 0,
        centerY: 0,
        hoveredSlice: -1,
        config: null // Will be loaded from localStorage
    };

    // Default configuration
    const DEFAULT_CONFIG = {
        sliceCount: 8,
        slices: ['color_red', 'color_orange', 'color_yellow', 'color_green', 'color_blue', 'color_purple', 'color', 'eraser'],
        innerRadius: 40,
        outerRadius: 120,
        animationDuration: 150
    };

    // ==================== Initialization ====================

    function initRadialMenu() {
        loadRadialConfig();
        createRadialMenuElement();
        setupRadialEventListeners();
    }

    function loadRadialConfig() {
        const saved = localStorage.getItem('radial_menu_config');
        if (saved) {
            try {
                const loaded = JSON.parse(saved);
                const sliceCount = Math.max(3, Math.min(12, Math.round(Number(loaded.sliceCount) || DEFAULT_CONFIG.sliceCount)));
                const slices = Array.isArray(loaded.slices) ? loaded.slices : DEFAULT_CONFIG.slices;
                radialMenuState.config = {
                    ...DEFAULT_CONFIG,
                    ...loaded,
                    sliceCount,
                    slices: Array.from({ length: sliceCount }, (_, i) =>
                        RADIAL_ACTIONS[slices[i]] ? slices[i] : (DEFAULT_CONFIG.slices[i] || 'none')),
                    innerRadius: Math.max(28, Math.min(70, Number(loaded.innerRadius) || DEFAULT_CONFIG.innerRadius)),
                    outerRadius: Math.max(96, Math.min(132, Number(loaded.outerRadius) || DEFAULT_CONFIG.outerRadius))
                };
                if (radialMenuState.config.outerRadius < radialMenuState.config.innerRadius + 40) {
                    radialMenuState.config.outerRadius = radialMenuState.config.innerRadius + 40;
                }
            } catch (e) {
                radialMenuState.config = { ...DEFAULT_CONFIG };
            }
        } else {
            radialMenuState.config = { ...DEFAULT_CONFIG };
        }
    }

    function saveRadialConfig() {
        localStorage.setItem('radial_menu_config', JSON.stringify(radialMenuState.config));
    }

    // ==================== DOM Creation ====================

    function createRadialMenuElement() {
        // Check if already exists
        if (document.getElementById('radialMenu')) return;

        const menu = document.createElement('div');
        menu.id = 'radialMenu';
        menu.className = 'radial-menu';
        menu.innerHTML = `
            <div class="radial-menu-backdrop"></div>
            <div class="radial-menu-container">
                <svg class="radial-menu-svg" viewBox="-150 -150 300 300">
                    <g class="radial-slices"></g>
                    <circle class="radial-center" cx="0" cy="0" r="35" />
                    <text class="radial-center-text" x="0" y="5" text-anchor="middle">×</text>
                </svg>
            </div>
        `;

        document.body.appendChild(menu);
        renderSlices();
    }

    function renderSlices() {
        const container = document.querySelector('.radial-slices');
        if (!container) return;

        container.innerHTML = '';

        const config = radialMenuState.config;
        const sliceCount = config.sliceCount;
        const angleStep = (Math.PI * 2) / sliceCount;
        const startOffset = -Math.PI / 2 - angleStep / 2; // Start from top

        const innerR = config.innerRadius;
        const outerR = config.outerRadius;

        for (let i = 0; i < sliceCount; i++) {
            const startAngle = startOffset + i * angleStep;
            const endAngle = startAngle + angleStep;

            const actionId = config.slices[i] || 'none';
            const action = RADIAL_ACTIONS[actionId] || RADIAL_ACTIONS.none;

            // Create slice path
            const slice = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            slice.classList.add('radial-slice');
            slice.dataset.index = i;
            slice.dataset.action = actionId;

            // Arc path - neutral color (handled by CSS)
            const path = createArcPath(innerR, outerR, startAngle, endAngle);
            const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.setAttribute('d', path);
            pathEl.classList.add('radial-slice-path');

            // Icon position (center of slice)
            const midAngle = (startAngle + endAngle) / 2;
            const iconR = (innerR + outerR) / 2;
            const iconX = Math.cos(midAngle) * iconR;
            const iconY = Math.sin(midAngle) * iconR;

            slice.appendChild(pathEl);

            // For color-type actions, show a colored circle instead of icon
            if (action.type === 'color' && action.colorValue) {
                const circleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circleEl.setAttribute('cx', iconX);
                circleEl.setAttribute('cy', iconY);
                circleEl.setAttribute('r', 14);
                circleEl.setAttribute('fill', action.colorValue);
                circleEl.classList.add('radial-slice-color-circle');
                slice.appendChild(circleEl);
            } else if (action.icon) {
                // Icon text for non-color actions
                const iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                iconEl.setAttribute('x', iconX);
                iconEl.setAttribute('y', iconY + 8);
                iconEl.setAttribute('text-anchor', 'middle');
                iconEl.classList.add('radial-slice-icon');
                iconEl.textContent = action.icon;
                slice.appendChild(iconEl);
            }

            // Label (shown on hover)
            const labelR = outerR + 20;
            const labelX = Math.cos(midAngle) * labelR;
            const labelY = Math.sin(midAngle) * labelR;

            const labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            labelEl.setAttribute('x', labelX);
            labelEl.setAttribute('y', labelY + 4);
            labelEl.setAttribute('text-anchor', 'middle');
            labelEl.classList.add('radial-slice-label');
            labelEl.textContent = action.label;

            slice.appendChild(labelEl);
            container.appendChild(slice);
        }
    }

    function createArcPath(innerR, outerR, startAngle, endAngle) {
        const gap = 0.02; // Small gap between slices
        const adjustedStart = startAngle + gap;
        const adjustedEnd = endAngle - gap;

        const x1 = Math.cos(adjustedStart) * outerR;
        const y1 = Math.sin(adjustedStart) * outerR;
        const x2 = Math.cos(adjustedEnd) * outerR;
        const y2 = Math.sin(adjustedEnd) * outerR;
        const x3 = Math.cos(adjustedEnd) * innerR;
        const y3 = Math.sin(adjustedEnd) * innerR;
        const x4 = Math.cos(adjustedStart) * innerR;
        const y4 = Math.sin(adjustedStart) * innerR;

        const largeArc = (adjustedEnd - adjustedStart) > Math.PI ? 1 : 0;

        return `
            M ${x1} ${y1}
            A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}
            L ${x3} ${y3}
            A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}
            Z
        `;
    }

    // ==================== Event Handling ====================

    function setupRadialEventListeners() {
        const menu = document.getElementById('radialMenu');
        if (!menu) return;

        // Slice hover detection
        menu.addEventListener('pointermove', handleRadialMove);
        menu.addEventListener('pointerup', (e) => {
            // A pen may be pointer-captured by the canvas even though the menu
            // is visually above it. Keep the same press-drag-release selection
            // behavior for captured and uncaptured Linux tablet events.
            if (e.pointerType === 'pen' && typeof handleHPPenUp === 'function') {
                handleHPPenUp(e);
            }
            handleRadialSelect(e);
        });

        // Center button to close
        const center = menu.querySelector('.radial-center');
        if (center) {
            center.addEventListener('pointerup', (e) => {
                e.stopPropagation();
                closeRadialMenu();
            });
        }

        // Backdrop click to close
        const backdrop = menu.querySelector('.radial-menu-backdrop');
        if (backdrop) {
            backdrop.addEventListener('pointerup', closeRadialMenu);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && radialMenuState.isOpen) closeRadialMenu();
        });
    }

    function handleRadialMove(e) {
        if (!radialMenuState.isOpen) return;

        const menu = document.getElementById('radialMenu');
        const container = menu.querySelector('.radial-menu-container');
        const rect = container.getBoundingClientRect();

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const config = radialMenuState.config;
        const innerR = config.innerRadius * (rect.width / 300);
        const outerR = config.outerRadius * (rect.width / 300);

        // Check if within ring
        if (distance < innerR || distance > outerR + 30) {
            setHoveredSlice(-1);
            return;
        }

        // Calculate which slice
        let angle = Math.atan2(dy, dx);
        const angleStep = (Math.PI * 2) / config.sliceCount;
        const startOffset = -Math.PI / 2 - angleStep / 2;

        // Normalize angle
        angle = angle - startOffset;
        if (angle < 0) angle += Math.PI * 2;

        const sliceIndex = Math.floor(angle / angleStep) % config.sliceCount;
        setHoveredSlice(sliceIndex);
    }

    function setHoveredSlice(index) {
        if (radialMenuState.hoveredSlice === index) return;

        radialMenuState.hoveredSlice = index;

        const slices = document.querySelectorAll('.radial-slice');
        slices.forEach((slice, i) => {
            if (i === index) {
                slice.classList.add('hovered');
            } else {
                slice.classList.remove('hovered');
            }
        });

        // Update center text with action label
        const centerText = document.querySelector('.radial-center-text');
        if (centerText) {
            if (index >= 0) {
                const config = radialMenuState.config;
                const actionId = config.slices[index] || 'none';
                const action = RADIAL_ACTIONS[actionId] || RADIAL_ACTIONS.none;
                centerText.textContent = action.label;
            } else {
                centerText.textContent = '×';
            }
        }
    }

    function handleRadialSelect(e) {
        if (!radialMenuState.isOpen) return;

        const index = radialMenuState.hoveredSlice;
        if (index >= 0) {
            const config = radialMenuState.config;
            const actionId = config.slices[index] || 'none';
            const action = RADIAL_ACTIONS[actionId] || RADIAL_ACTIONS.none;

            // Execute action
            if (action.action) {
                action.action();
            }
        }

        closeRadialMenu();
    }

    // ==================== Open/Close ====================

    function openRadialMenu(x, y) {
        if (radialMenuState.isOpen) return;

        const menu = document.getElementById('radialMenu');
        if (!menu) return;

        const container = menu.querySelector('.radial-menu-container');
        const size = Math.max(220, Math.min(300, window.innerWidth - 32, window.innerHeight - 32));
        const margin = size / 2 + 8;
        const requestedX = Number.isFinite(Number(x)) ? Number(x) : window.innerWidth / 2;
        const requestedY = Number.isFinite(Number(y)) ? Number(y) : window.innerHeight / 2;
        x = Math.max(margin, Math.min(window.innerWidth - margin, requestedX));
        y = Math.max(margin, Math.min(window.innerHeight - margin, requestedY));

        radialMenuState.isOpen = true;
        radialMenuState.centerX = x;
        radialMenuState.centerY = y;
        radialMenuState.hoveredSlice = -1;

        // Position the menu
        container.style.width = `${size}px`;
        container.style.height = `${size}px`;
        container.style.left = x + 'px';
        container.style.top = y + 'px';

        // Refresh slices in case config changed
        renderSlices();

        // Show with animation
        menu.classList.add('open');
        menu.classList.remove('closing');

        // Animate slices in
        const slices = menu.querySelectorAll('.radial-slice');
        slices.forEach((slice, i) => {
            slice.style.animationDelay = (i * 30) + 'ms';
        });
    }

    function closeRadialMenu() {
        if (!radialMenuState.isOpen) return;

        radialMenuState.isOpen = false;
        radialMenuState.hoveredSlice = -1;

        const menu = document.getElementById('radialMenu');
        if (!menu) return;

        menu.classList.remove('open');
        menu.classList.add('closing');

        setTimeout(() => {
            menu.classList.remove('closing');
        }, 150);
    }

    function toggleRadialMenu(x, y) {
        if (radialMenuState.isOpen) {
            closeRadialMenu();
        } else {
            openRadialMenu(x, y);
        }
    }

    // ==================== Configuration API ====================

    function setRadialSliceCount(count) {
        count = Math.max(3, Math.min(12, count)); // Clamp 3-12
        radialMenuState.config.sliceCount = count;

        // Ensure slices array has correct length
        while (radialMenuState.config.slices.length < count) {
            radialMenuState.config.slices.push('none');
        }
        radialMenuState.config.slices = radialMenuState.config.slices.slice(0, count);

        saveRadialConfig();
        renderSlices();
    }

    function setRadialSliceAction(index, actionId) {
        if (index < 0 || index >= radialMenuState.config.sliceCount) return;
        if (!RADIAL_ACTIONS[actionId]) actionId = 'none';

        radialMenuState.config.slices[index] = actionId;
        saveRadialConfig();
        renderSlices();
    }

    function getRadialConfig() {
        return { ...radialMenuState.config };
    }

    function getAvailableActions() {
        return Object.keys(RADIAL_ACTIONS).map(id => {
            const action = RADIAL_ACTIONS[id];
            return {
                id,
                label: action.label,
                icon: action.icon || null,
                type: action.type,
                colorValue: action.colorValue || null
            };
        });
    }

    function isRadialMenuOpen() {
        return radialMenuState.isOpen;
    }

    /**
     * Update radial menu hover from external coordinates (for HP Pen integration)
     * Called during pointer move when radial menu is open
     */
    function updateRadialMenuHover(clientX, clientY) {
        if (!radialMenuState.isOpen) return;

        const menu = document.getElementById('radialMenu');
        if (!menu) return;

        const container = menu.querySelector('.radial-menu-container');
        const rect = container.getBoundingClientRect();

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const config = radialMenuState.config;
        const innerR = config.innerRadius * (rect.width / 300);
        const outerR = config.outerRadius * (rect.width / 300);

        // Check if within ring
        if (distance < innerR || distance > outerR + 30) {
            setHoveredSlice(-1);
            return;
        }

        // Calculate which slice
        let angle = Math.atan2(dy, dx);
        const angleStep = (Math.PI * 2) / config.sliceCount;
        const startOffset = -Math.PI / 2 - angleStep / 2;

        // Normalize angle
        angle = angle - startOffset;
        if (angle < 0) angle += Math.PI * 2;

        const sliceIndex = Math.floor(angle / angleStep) % config.sliceCount;
        setHoveredSlice(sliceIndex);
    }

    /**
     * Select hovered slice and close menu (for HP Pen barrel release)
     */
    function selectRadialMenuSlice() {
        if (!radialMenuState.isOpen) {
            return;
        }

        const index = radialMenuState.hoveredSlice;

        if (index >= 0) {
            const config = radialMenuState.config;
            const actionId = config.slices[index] || 'none';
            const action = RADIAL_ACTIONS[actionId] || RADIAL_ACTIONS.none;

            // Execute action
            if (action.action) {
                action.action();
            }
        }

        closeRadialMenu();
    }

    // ==================== Expose Global Functions ====================

    window.initRadialMenu = initRadialMenu;
    window.openRadialMenu = openRadialMenu;
    window.closeRadialMenu = closeRadialMenu;
    window.toggleRadialMenu = toggleRadialMenu;
    window.isRadialMenuOpen = isRadialMenuOpen;
    window.updateRadialMenuHover = updateRadialMenuHover;
    window.selectRadialMenuSlice = selectRadialMenuSlice;
    window.setRadialSliceCount = setRadialSliceCount;
    window.setRadialSliceAction = setRadialSliceAction;
    window.getRadialConfig = getRadialConfig;
    window.getAvailableActions = getAvailableActions;
    window.renderRadialSlices = renderSlices;

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRadialMenu);
    } else {
        initRadialMenu();
    }
})();
