// ============== Initialize ==============
        async function init() {
            try {
                loadSettings(); // Load saved settings first
                initTheme();    // Initialize theme from localStorage
                updateThemeIcon(); // Update theme toggle button icon
                initCrosshairRotation(); // Apply crosshair rotation from settings
                setupCanvas();
                initStrokeCache(); // Initialize stroke caching for performance
                setupModal();

                // Initialize modular toolbar before event listeners
                if (typeof ModularToolbar !== 'undefined') {
                    ModularToolbar.init('.floating-toolbar');
                }

                setupEventListeners();
                setupResizablePanels();
                setupCollapsiblePanels();
                await loadNotebooks();

                // Setup toolbar customization in settings
                setupToolbarSettings();

                // Initialize toolbox
                if (typeof Toolbox !== 'undefined') {
                    Toolbox.init();
                }

                // Ensure Fontbook exists (creates it if needed)
                if (typeof FontBook !== 'undefined') {
                    await FontBook.ensureFontbook();
                }
            } catch (error) {
                console.error('Initialization error:', error);
                document.getElementById('app').style.display = 'flex';
                document.getElementById('loading').style.display = 'none';
                showToast('Error loading app: ' + error.message, 'error');
            }
        }

        // Setup toolbar customization controls in settings modal
        function setupToolbarSettings() {
            const editModeToggle = document.getElementById('settingsToolbarEditMode');
            const resetBtn = document.getElementById('resetToolbarBtn');
            const sectionsList = document.getElementById('toolbarSectionsList');

            if (editModeToggle && typeof ModularToolbar !== 'undefined') {
                editModeToggle.addEventListener('change', () => {
                    const isEnabled = ModularToolbar.toggleEditMode();
                    if (isEnabled) {
                        showToast('Drag toolbar sections to rearrange', 'info');
                    }
                });
            }

            if (resetBtn && typeof ModularToolbar !== 'undefined') {
                resetBtn.addEventListener('click', () => {
                    if (confirm('Reset toolbar to default layout?')) {
                        ModularToolbar.resetConfig();
                        if (editModeToggle) editModeToggle.checked = false;
                        showToast('Toolbar reset to default', 'success');
                        populateToolbarSectionsList();
                    }
                });
            }

            // Populate sections list
            populateToolbarSectionsList();

            // Double-click drag handle to toggle edit mode
            const dragHandle = document.getElementById('toolbarDragHandle');
            if (dragHandle) {
                dragHandle.addEventListener('dblclick', () => {
                    if (typeof ModularToolbar !== 'undefined') {
                        const isEnabled = ModularToolbar.toggleEditMode();
                        if (editModeToggle) editModeToggle.checked = isEnabled;
                        showToast(isEnabled ? 'Edit mode: drag to rearrange' : 'Edit mode disabled', 'info');
                    }
                });
            }
        }

        // Populate the list of toolbar sections with checkboxes
        function populateToolbarSectionsList() {
            const sectionsList = document.getElementById('toolbarSectionsList');
            if (!sectionsList || typeof ModularToolbar === 'undefined') return;

            const config = ModularToolbar.getConfig();
            if (!config) return;

            const sectionNames = {
                'drawing-tools': 'Drawing Tools (Pen, Highlighter, Eraser)',
                'import-tools': 'Import & Text Tools',
                'shapes': 'Shape Tools',
                'color-section': 'Color Picker & Presets',
                'size-section': 'Brush Size',
                'actions': 'Actions (Undo, Redo, Settings, etc.)'
            };

            let html = '';
            config.forEach(item => {
                if (item.type === 'section') {
                    const name = sectionNames[item.id] || item.id;
                    const checked = !item.hidden ? 'checked' : '';
                    html += `<label class="toolbar-section-toggle">
                        <input type="checkbox" ${checked} data-section-id="${item.id}">
                        <span>${name}</span>
                    </label>`;
                }
            });

            sectionsList.innerHTML = html;

            // Bind change events
            sectionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const sectionId = cb.dataset.sectionId;
                    ModularToolbar.toggleSection(sectionId, cb.checked);
                });
            });
        }

        // Apply crosshair rotation class to body
        function applyCrosshairRotation(rotated) {
            if (rotated) {
                document.body.classList.add('crosshair-rotated');
            } else {
                document.body.classList.remove('crosshair-rotated');
            }
        }

        // Initialize crosshair rotation from settings
        function initCrosshairRotation() {
            applyCrosshairRotation(settings.crosshairRotated || false);
        }

        // Update theme toggle button icon to show current theme
        function updateThemeIcon() {
            const btn=document.getElementById('themeToggleBtn');if(!btn)return;
            const light=settings.theme==='light';
            const icon=light
                ? '<path d="M20.8 13A8.8 8.8 0 1 1 11 3.2 7 7 0 0 0 20.8 13Z"/>'
                : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>';
            btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icon+'</svg>';
            btn.dataset.themeIcon=light?'moon':'sun';
            btn.title=light?'Switch to dark mode':'Switch to light mode';
            btn.setAttribute('aria-label',btn.title);
        }
        window.addEventListener('themeChanged',updateThemeIcon);

        init();
