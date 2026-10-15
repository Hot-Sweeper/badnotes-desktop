// ============== Modal ==============
        function showModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.classList.add('show');
            window.DialogFocus?.activate(modal,{close:()=>modalId==='settingsModal'?closeSettingsModal():modalId==='recycleBinModal'?hideRecycleBin():hideModal(modalId),initialFocus:modalId==='newNotebookModal'?'#newNotebookTitle':undefined});
            if(modalId === 'newNotebookModal') {
                document.getElementById('newNotebookHeading').textContent=notebookEditingId ? 'Edit notebook' : 'A new notebook';
                document.getElementById('createNotebookBtn').textContent=notebookEditingId ? 'Save changes' : 'Create notebook';
                document.getElementById('deleteNotebookMetadataBtn').hidden=!notebookEditingId || notebooks.find(n=>n.id===notebookEditingId)?.isFontBook;
                modal.querySelector('.template-grid').closest('.input-group').style.display=notebookEditingId ? 'none' : '';
                updateNotebookCoverPreview();
                requestAnimationFrame(()=>{const title=document.getElementById('newNotebookTitle');title.focus();title.select();});
            }
        }

        function hideModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.classList.remove('show');
            window.DialogFocus?.deactivate(modal);
            if(modalId==='newNotebookModal') {
                if(notebookEditingId)document.getElementById('newNotebookTitle').value='Untitled Notebook';
                notebookEditingId=null;
            }
        }

        function setupModal() {
            setupSettingsNavigation();
            const colorGrid = document.getElementById('colorGrid');
            if (colorGrid) {
                const coverColors=[['#6055d8','Iris'],['#499bff','Sky'],['#355c9b','Midnight blue'],['#428b85','Lagoon'],['#577b58','Forest'],['#9aab79','Sage'],['#d2ad69','Honey'],['#c8815b','Terracotta'],['#b45e78','Rose'],['#86678e','Plum'],['#777d8d','Slate'],['#34374b','Graphite']];
                const colors=coverColors.map(([color])=>color);
                let selectedColor=colors[0];
                colorGrid.innerHTML = colors.map(c => `
                    <button type="button" class="color-option ${c === selectedColor ? 'selected' : ''}"
                         style="background: ${c}" data-color="${c}" title="${coverColors.find(([color])=>color===c)[1]}" aria-label="${coverColors.find(([color])=>color===c)[1]} cover" aria-pressed="${c === selectedColor}"></button>
                `).join('');

                colorGrid.addEventListener('click',e=>{
                    const opt=e.target.closest('.color-option');if(!opt)return;
                        colorGrid.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                        opt.classList.add('selected');
                        selectedColor = opt.dataset.color;
                        colorGrid.querySelectorAll('.color-option').forEach(o=>o.setAttribute('aria-pressed',String(o===opt)));
                        updateNotebookCoverPreview();
                });
            }
            const iconGrid=document.getElementById('notebookIconGrid');
            if(iconGrid){
                iconGrid.innerHTML=Object.keys(notebookEmblems).map(icon=>`<button type="button" class="emblem-option ${icon==='book'?'selected':''}" data-icon="${icon}" aria-label="${icon} emblem" aria-pressed="${icon==='book'}">${notebookEmblemSvg(icon)}</button>`).join('');
                iconGrid.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;iconGrid.querySelectorAll('button').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});updateNotebookCoverPreview();});
            }
            document.getElementById('deleteNotebookMetadataBtn')?.addEventListener('click',async()=>{
                const notebook=notebooks.find(n=>n.id===notebookEditingId);
                if(!notebook || notebook.isFontBook || !confirm(`Move "${notebook.name}" and its pages to Recycle Bin?`))return;
                if(await deleteNotebook(notebook.id))hideModal('newNotebookModal');
            });

            document.querySelectorAll('.template-option').forEach(opt => {
                opt.tabIndex=0;
                opt.setAttribute('role','button');
                opt.setAttribute('aria-pressed',String(opt.classList.contains('selected')));
                opt.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();opt.click();}});
                opt.addEventListener('click', () => {
                    const parent = opt.parentElement;
                    if (parent) {
                        parent.querySelectorAll('.template-option').forEach(o => o.classList.remove('selected'));
                    }
                    opt.classList.add('selected');
                    parent?.querySelectorAll('.template-option').forEach(o=>o.setAttribute('aria-pressed',String(o===opt)));

                    // Specific logic based on which modal it is
                    if (opt.closest('#newNotebookModal')) {
                        selectedTemplate = opt.dataset.template;
                        updateNotebookCoverPreview();
                    } else if (opt.closest('#settingsModal')) {
                        // Apply immediately to CURRENT PAGE for per-page templates
                        currentPageTemplate = opt.dataset.template;
                        redrawCanvas();
                        triggerAutoSave();
                    }
                });
            });
            document.getElementById('newNotebookTitle')?.addEventListener('input',updateNotebookCoverPreview);
            document.getElementById('newNotebookTitle')?.addEventListener('keydown',e=>{
                if(e.key==='Enter'){e.preventDefault();document.getElementById('createNotebookBtn').click();}
            });
        }

        function setupSettingsNavigation() {
            const modal=document.getElementById('settingsModal');
            const nav=modal?.querySelector('.settings-nav');if(!nav)return;
            const body=modal.querySelector('.modal-body');body.id='settingsCategoryPanel';body.setAttribute('role','tabpanel');
            const groups={'Interface':'appearance','Page Background':'appearance','Smoothing & Input':'drawing','Pressure Thickness':'drawing','HP Pen Buttons':'buttons','Barrel Menu Customization':'buttons','Toolbar Customization':'toolbar'};
            const sections=Array.from(body.querySelectorAll(':scope > .settings-section'));
            sections.forEach(section=>{
                const heading=section.querySelector('h3').textContent.trim();section.dataset.settingsCategory=groups[heading]||'drawing';
                section.querySelectorAll('.settings-item').forEach(item=>{const label=item.querySelector('.settings-label'),control=item.querySelector('input,select');if(label&&control?.id)label.htmlFor=control.id;});
            });
            // Theme first, then paper; all existing controls and listeners stay intact.
            const appearance=sections.find(s=>s.querySelector('h3').textContent==='Interface');if(appearance)body.prepend(appearance);
            modal.querySelectorAll('select option').forEach(option=>option.textContent=option.textContent.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').trim());
            const tabs=Array.from(nav.querySelectorAll('button'));
            const select=tab=>{
                tabs.forEach(button=>{const active=button===tab;button.id='settingsTab-'+button.dataset.settingsTab;button.setAttribute('aria-controls',body.id);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
                sections.forEach(section=>section.hidden=section.dataset.settingsCategory!==tab.dataset.settingsTab);
                body.setAttribute('aria-labelledby',tab.id);body.scrollTop=0;
            };
            tabs.forEach((tab,index)=>{
                tab.addEventListener('click',()=>select(tab));
                tab.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=tabs[(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];select(next);next.focus();}});
            });
            select(tabs[0]);
            // Native controls apply on each slider sample or committed toggle.
            // Bind once to the sheet, not once on every open/reopen.
            modal.addEventListener('input',e=>{
                if(e.target.matches('input[type="range"]'))applyLiveSettingsControl(e.target);
            });
            modal.addEventListener('change',e=>{
                if(e.target.matches('input:not([type="range"]),select'))applyLiveSettingsControl(e.target);
            });
        }

        function updateNotebookCoverPreview() {
            const modal=document.getElementById('newNotebookModal');
            if(!modal)return;
            const cover=document.getElementById('newNotebookCover');
            if(!cover)return;
            cover.style.background='';
            cover.style.setProperty('--cover-color',modal.querySelector('.color-option.selected')?.dataset.color || '#5c55d9');
            cover.innerHTML=`<span class="cover-emblem">${notebookEmblemSvg(modal.querySelector('.emblem-option.selected')?.dataset.icon || 'book')}</span>`;
            document.getElementById('newNotebookPreviewTitle').textContent=document.getElementById('newNotebookTitle').value.trim() || 'Untitled Notebook';
            const paper=modal.querySelector('.template-option.selected')?.dataset.template || 'blank';
            document.getElementById('newNotebookPreviewPaper').textContent=notebookEditingId ? 'Cover preview · Your pages stay unchanged' : paper.charAt(0).toUpperCase()+paper.slice(1)+' paper · Ready for your first page';
        }

// ============== Settings Modal ==============
        function applyLiveSettingsControl(control){
            switch(control.id){
                case 'smoothnessSlider':
                    settings.smoothness=Math.max(0,Math.min(200,Number(control.value)));
                    document.getElementById('smoothnessValue').textContent=settings.smoothness;break;
                case 'minDistanceSlider':
                    settings.minDistance=Math.max(0,Number(control.value));
                    document.getElementById('minDistanceValue').textContent=settings.minDistance+'px';break;
                case 'settingsPressureMultiplier':
                    settings.pressureMultiplier=Math.max(.1,Math.min(3,Number(control.value)));
                    document.getElementById('pressureMultiplierValue').textContent=settings.pressureMultiplier+'x';break;
                case 'settingsDynamicBrush':
                    settings.dynamicBrushEnabled=dynamicBrushEnabled=control.checked;
                    if(document.getElementById('dynamicBrushToggle'))document.getElementById('dynamicBrushToggle').checked=control.checked;
                    break;
                case 'settingsFingerDraw':settings.fingerDrawing=control.checked;break;
                case 'settingsCrosshairRotated':
                    settings.crosshairRotated=control.checked;applyCrosshairRotation(control.checked);break;
                case 'settingsTheme':
                    window.AppearanceSettings?.selectMode(control.value);return;
                case 'settingsEraserMode':
                    if(typeof setEraserButtonMode==='function')setEraserButtonMode(control.value);
                    updateBarrelMenuSectionVisibility();return;
                case 'settingsBarrelMode':
                    if(typeof setBarrelButtonMode==='function')setBarrelButtonMode(control.value);
                    updateBarrelMenuSectionVisibility();return;
                default:return; // Toolbar/radial controls already have live handlers.
            }
            saveSettings();
        }
        function openSettingsModal() {
            // Populate current settings into the modal
            document.getElementById('smoothnessSlider').value = settings.smoothness;
            document.getElementById('smoothnessValue').textContent = settings.smoothness;
            document.getElementById('minDistanceSlider').value = settings.minDistance;
            document.getElementById('minDistanceValue').textContent = settings.minDistance + 'px';
            document.getElementById('settingsFingerDraw').checked = settings.fingerDrawing;

            // Dynamic brush / pressure thickness settings
            const dynamicBrushCheck = document.getElementById('settingsDynamicBrush');
            if(dynamicBrushCheck) {
                dynamicBrushCheck.checked = settings.dynamicBrushEnabled || dynamicBrushEnabled || false;
            }
            const pressureMultiplier = settings.pressureMultiplier || 1.0;
            const pressureMultiplierSlider = document.getElementById('settingsPressureMultiplier');
            const pressureMultiplierValue = document.getElementById('pressureMultiplierValue');
            if(pressureMultiplierSlider) {
                pressureMultiplierSlider.value = pressureMultiplier;
            }
            if(pressureMultiplierValue) {
                pressureMultiplierValue.textContent = pressureMultiplier + 'x';
            }

            // Set Page Template - show CURRENT PAGE template
            const pageTemplate = currentPageTemplate || currentNotebook?.template || 'blank';
            const grid = document.getElementById('settingsTemplateGrid');
            if (grid) {
                grid.querySelectorAll('.template-option').forEach(opt => {
                    if (opt.dataset.template === pageTemplate) {
                        opt.classList.add('selected');
                    } else {
                        opt.classList.remove('selected');
                    }
                });
            }

            // Set Theme
            const themeSelect = document.getElementById('settingsTheme');
            if(themeSelect) themeSelect.value = settings.theme || 'dark';
            window.AppearanceSettings?.sync();

            // Set Crosshair Rotation
            const crosshairRotatedCheck = document.getElementById('settingsCrosshairRotated');
            if(crosshairRotatedCheck) crosshairRotatedCheck.checked = settings.crosshairRotated || false;

            // Set Eraser Button Mode
            const eraserModeSelect = document.getElementById('settingsEraserMode');
            if(eraserModeSelect) {
                eraserModeSelect.value = localStorage.getItem('hp_pen_eraser_mode') || 'eraser';
            }

            // Set Barrel Mode
            const barrelModeSelect = document.getElementById('settingsBarrelMode');
            if(barrelModeSelect) {
                barrelModeSelect.value = localStorage.getItem('hp_pen_barrel_mode') || 'color';
                updateBarrelMenuSectionVisibility();
            }

            // Initialize barrel menu customization UI
            initBarrelMenuSettingsUI();

            showModal('settingsModal');
        }

        function updateBarrelMenuSectionVisibility() {
            const barrelModeSelect = document.getElementById('settingsBarrelMode');
            const eraserModeSelect = document.getElementById('settingsEraserMode');
            const barrelMenuSection = document.getElementById('barrelMenuSection');
            if (barrelMenuSection) {
                // Show radial menu section if either button is set to radial
                const showRadial = (barrelModeSelect && barrelModeSelect.value === 'radial') ||
                                   (eraserModeSelect && eraserModeSelect.value === 'radial');
                barrelMenuSection.style.display = showRadial ? 'block' : 'none';
            }
        }

        function initBarrelMenuSettingsUI() {
            const sliceList = document.getElementById('barrelMenuSliceList');
            const countValue = document.getElementById('barrelMenuCountValue');
            const countMinus = document.getElementById('barrelMenuCountMinus');
            const countPlus = document.getElementById('barrelMenuCountPlus');
            const previewBtn = document.getElementById('barrelMenuPreviewBtn');

            if (!sliceList || typeof getRadialConfig !== 'function') return;

            const config = getRadialConfig();
            const actions = typeof getAvailableActions === 'function' ? getAvailableActions() : [];

            // Update count display
            if (countValue) countValue.textContent = config.sliceCount;

            // Render slice list
            renderBarrelMenuSliceList(config, actions);

            // Count buttons
            if (countMinus) {
                countMinus.onclick = () => {
                    const config = getRadialConfig();
                    if (config.sliceCount > 3) {
                        setRadialSliceCount(config.sliceCount - 1);
                        countValue.textContent = config.sliceCount - 1;
                        renderBarrelMenuSliceList(getRadialConfig(), actions);
                    }
                };
            }

            if (countPlus) {
                countPlus.onclick = () => {
                    const config = getRadialConfig();
                    if (config.sliceCount < 12) {
                        setRadialSliceCount(config.sliceCount + 1);
                        countValue.textContent = config.sliceCount + 1;
                        renderBarrelMenuSliceList(getRadialConfig(), actions);
                    }
                };
            }

            // Preview button
            if (previewBtn) {
                previewBtn.onclick = () => {
                    if (typeof openRadialMenu === 'function') {
                        openRadialMenu(window.innerWidth / 2, window.innerHeight / 2);
                    }
                };
            }
        }

        function renderBarrelMenuSliceList(config, actions) {
            const sliceList = document.getElementById('barrelMenuSliceList');
            if (!sliceList) return;

            sliceList.innerHTML = '';

            for (let i = 0; i < config.sliceCount; i++) {
                const currentActionId = config.slices[i] || 'none';
                const currentAction = actions.find(a => a.id === currentActionId) || actions.find(a => a.id === 'none');

                // Determine display for icon area - color swatch or icon
                const isColorType = currentAction && currentAction.type === 'color' && currentAction.colorValue;
                const iconDisplay = isColorType
                    ? `<span class="barrel-menu-slice-color-swatch" style="background: ${currentAction.colorValue}"></span>`
                    : `<span class="barrel-menu-slice-icon">${currentAction && currentAction.icon ? currentAction.icon : '➖'}</span>`;

                const item = document.createElement('div');
                item.className = 'barrel-menu-slice-item';
                item.innerHTML = `
                    <span class="barrel-menu-slice-number">${i + 1}</span>
                    ${iconDisplay}
                    <select class="barrel-menu-slice-select" data-slice-index="${i}">
                        <optgroup label="Tools">
                            ${actions.filter(a => a.type === 'tool').map(a => `
                                <option value="${a.id}" ${a.id === currentActionId ? 'selected' : ''}>
                                    ${a.icon || ''} ${a.label}
                                </option>
                            `).join('')}
                        </optgroup>
                        <optgroup label="Actions">
                            ${actions.filter(a => a.type === 'action').map(a => `
                                <option value="${a.id}" ${a.id === currentActionId ? 'selected' : ''}>
                                    ${a.icon || ''} ${a.label}
                                </option>
                            `).join('')}
                        </optgroup>
                        <optgroup label="Colors">
                            ${actions.filter(a => a.type === 'color').map(a => `
                                <option value="${a.id}" ${a.id === currentActionId ? 'selected' : ''}>
                                    ● ${a.label}
                                </option>
                            `).join('')}
                        </optgroup>
                        <optgroup label="Other">
                            ${actions.filter(a => a.type === 'none').map(a => `
                                <option value="${a.id}" ${a.id === currentActionId ? 'selected' : ''}>
                                    ${a.icon || ''} ${a.label}
                                </option>
                            `).join('')}
                        </optgroup>
                    </select>
                `;

                sliceList.appendChild(item);

                // Add change listener
                const select = item.querySelector('select');
                select.addEventListener('change', (e) => {
                    const sliceIndex = parseInt(e.target.dataset.sliceIndex);
                    const actionId = e.target.value;

                    if (typeof setRadialSliceAction === 'function') {
                        setRadialSliceAction(sliceIndex, actionId);
                    }

                    // Re-render to update the icon/color display
                    renderBarrelMenuSliceList(getRadialConfig(), actions);
                });
            }
        }

        function closeSettingsModal() {
            hideModal('settingsModal');
        }

        function saveSettingsFromModal() {
            settings.smoothness = parseInt(document.getElementById('smoothnessSlider').value);
            settings.minDistance = parseFloat(document.getElementById('minDistanceSlider').value);
            settings.fingerDrawing = document.getElementById('settingsFingerDraw').checked;

            // Dynamic brush / pressure thickness settings
            const dynamicBrushCheck = document.getElementById('settingsDynamicBrush');
            if(dynamicBrushCheck) {
                settings.dynamicBrushEnabled = dynamicBrushCheck.checked;
                dynamicBrushEnabled = dynamicBrushCheck.checked;
                // Sync toolbar toggle
                const toolbarToggle = document.getElementById('dynamicBrushToggle');
                if(toolbarToggle) toolbarToggle.checked = dynamicBrushCheck.checked;
            }

            const pressureMultiplierSlider = document.getElementById('settingsPressureMultiplier');
            if(pressureMultiplierSlider) {
                settings.pressureMultiplier = parseFloat(pressureMultiplierSlider.value);
            }

            // Save Theme and apply it
            const themeSelect = document.getElementById('settingsTheme');
            if(themeSelect) {
                if(settings.theme!==themeSelect.value||document.documentElement.dataset.theme!==themeSelect.value)applyTheme(themeSelect.value);
                updateThemeIcon();
            }

            // Save Crosshair Rotation and apply it
            const crosshairRotatedCheck = document.getElementById('settingsCrosshairRotated');
            if(crosshairRotatedCheck) {
                settings.crosshairRotated = crosshairRotatedCheck.checked;
                applyCrosshairRotation(settings.crosshairRotated);
            }

            // Save Eraser Button Mode (HP Pen)
            const eraserModeSelect = document.getElementById('settingsEraserMode');
            if(eraserModeSelect && typeof setEraserButtonMode === 'function') {
                setEraserButtonMode(eraserModeSelect.value);
            }

            // Save Barrel Mode (HP Pen)
            const barrelModeSelect = document.getElementById('settingsBarrelMode');
            if(barrelModeSelect && typeof setBarrelButtonMode === 'function') {
                setBarrelButtonMode(barrelModeSelect.value);
            }

            saveSettings();
            closeSettingsModal();
            // All controls are already persisted live; Done simply dismisses.
        }

        function resetSettingsToDefault() {
            settings = {
                smoothness: 60,
                minDistance: 1.5,
                fingerDrawing: false,
                theme: 'dark',
                accentTheme: 'iris',
                crosshairRotated: false,
                dynamicBrushEnabled: false,
                pressureMultiplier: 1.0
            };

            // Update modal UI
            document.getElementById('smoothnessSlider').value = settings.smoothness;
            document.getElementById('smoothnessValue').textContent = settings.smoothness;
            document.getElementById('minDistanceSlider').value = settings.minDistance;
            document.getElementById('minDistanceValue').textContent = settings.minDistance + 'px';
            document.getElementById('settingsFingerDraw').checked = settings.fingerDrawing;

            // Dynamic brush / pressure settings
            document.getElementById('settingsDynamicBrush').checked = settings.dynamicBrushEnabled;
            document.getElementById('settingsPressureMultiplier').value = settings.pressureMultiplier;
            document.getElementById('pressureMultiplierValue').textContent = settings.pressureMultiplier + 'x';
            dynamicBrushEnabled = false;
            document.getElementById('dynamicBrushToggle').checked = false;

            const crosshairRotatedCheck = document.getElementById('settingsCrosshairRotated');
            if(crosshairRotatedCheck) crosshairRotatedCheck.checked = false;
            applyCrosshairRotation(false);

            const themeSelect = document.getElementById('settingsTheme');
            if(themeSelect) themeSelect.value = 'dark';

            // Apply dark theme
            applyTheme('dark');
            updateThemeIcon();

            // Reset eraser button mode to default (eraser)
            const eraserModeSelect = document.getElementById('settingsEraserMode');
            if(eraserModeSelect) eraserModeSelect.value = 'eraser';
            if(typeof setEraserButtonMode === 'function') setEraserButtonMode('eraser');

            // Reset barrel mode to default (color)
            const barrelModeSelect = document.getElementById('settingsBarrelMode');
            if(barrelModeSelect) barrelModeSelect.value = 'color';
            if(typeof setBarrelButtonMode === 'function') setBarrelButtonMode('color');

            // Update radial menu section visibility
            updateBarrelMenuSectionVisibility();

            saveSettings();
            showToast('Settings reset to defaults', 'info');
        }

// ============== Palette & Pipette ==============
        let isPipetteActive = false;
        let customPalette = JSON.parse(localStorage.getItem('badnotes_palette')) || [
            '#ffffff', '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#6c5ce7'
        ];
        const defaultKeyboardColorSlots = [
            '#ffffff', '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
            '#6c5ce7', '#ff9f43', '#00cec9', '#fd79a8', '#2d3436'
        ];
        let keyboardColorSlots = (() => {
            try {
                const saved = JSON.parse(localStorage.getItem('badnotes_keyboard_color_slots') || 'null');
                return defaultKeyboardColorSlots.map((fallback, index) =>
                    typeof saved?.[index] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[index])
                        ? saved[index]
                        : fallback
                );
            } catch (_) {
                return [...defaultKeyboardColorSlots];
            }
        })();

        function renderPalette() {
            if(window.PaletteWorkbench)return PaletteWorkbench.render();
            const container = document.getElementById('colorPresets');
            const overflowIndicator = document.getElementById('colorOverflowIndicator');
            if (container) container.title = '1–9 / 0 select saved colors · Shift + key saves the current color · Hold Alt and slide across number keys to scrub the palette.';
            const maxVisibleColors = 6; // Maximum colors to show before overflow

            const visibleColors = customPalette.slice(0, maxVisibleColors);
            const hasOverflow = customPalette.length > maxVisibleColors;

            container.innerHTML = visibleColors.map((color, index) => {
                const rgb = color.replace('#', '').match(/.{2}/g)?.map(value => parseInt(value, 16));
                const keyColor = rgb?.length === 3 && (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) > 150 ? '#171717' : '#ffffff';
                const slotIndex = keyboardColorSlots.indexOf(color);
                const shortcut = slotIndex < 0 ? '' : (slotIndex === 9 ? '0' : String(slotIndex + 1));
                const keyHint = shortcut ? `Key ${shortcut} · ` : '';
                return `
                    <div class="color-preset ${color === currentColor ? 'active' : ''}"
                         style="background: ${color}; --palette-key-color: ${keyColor}"
                         data-color="${color}"
                         data-index="${index}"
                         draggable="true"
                         title="${keyHint}Drag to reorder or fill">
                         ${shortcut ? `<span class="color-key-badge">${shortcut}</span>` : ''}
                    </div>
                `;
            }).join('');

            // Show/hide overflow indicator
            if (overflowIndicator) {
                if (hasOverflow) {
                    overflowIndicator.classList.add('visible');
                    overflowIndicator.title = `${customPalette.length - maxVisibleColors} more colors`;
                } else {
                    overflowIndicator.classList.remove('visible');
                }
            }

            // Add listeners
            container.querySelectorAll('.color-preset').forEach(preset => {
                // Click to select
                preset.addEventListener('click', (e) => {
                    if (e.target.classList.contains('remove-color-btn')) return;
                    setColor(preset.dataset.color);
                });

                // Long presses/right clicks must never silently delete ink colors.
                preset.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    window.PaletteWorkbench?.open(preset.dataset.color);
                });

                // Drag and Drop
                preset.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', preset.dataset.index);
                    e.dataTransfer.setData('application/x-badnotes-color', preset.dataset.color);
                    e.dataTransfer.effectAllowed = 'copyMove';
                    preset.classList.add('dragging');
                    document.body.classList.add('is-dragging-color');
                });

                preset.addEventListener('dragend', () => {
                    preset.classList.remove('dragging');
                    document.body.classList.remove('is-dragging-color');
                });

                preset.addEventListener('dragover', (e) => {
                    e.preventDefault();
                });

                preset.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                    const toIndex = parseInt(preset.dataset.index);

                    if (fromIndex !== toIndex && !isNaN(fromIndex)) {
                        // Reorder array
                        const item = customPalette.splice(fromIndex, 1)[0];
                        customPalette.splice(toIndex, 0, item);
                        savePalette();
                        renderPalette();
                    }
                });
            });
        }

        function removeColor(color) {
            // Move to trash
            let deletedColors = JSON.parse(localStorage.getItem('badnotes_deleted_colors')) || [];
            deletedColors.unshift({
                color: color,
                deletedAt: new Date().toISOString(),
                id: Date.now().toString()
            });
            localStorage.setItem('badnotes_deleted_colors', JSON.stringify(deletedColors));

            customPalette = customPalette.filter(c => c !== color);
            savePalette();
            renderPalette();
            showToast('Color moved to Recycle Bin', 'info');
        }

// ============== Recycle Bin Logic ==============
        function setupRecycleBinListeners() {
            const bin = document.getElementById('recycleBinBtn');

            bin.addEventListener('dragover', (e) => {
                e.preventDefault();
                bin.classList.add('drag-over');
            });

            bin.addEventListener('dragleave', () => {
                bin.classList.remove('drag-over');
            });

            bin.addEventListener('drop', async (e) => {
                e.preventDefault();

                // Play suck animation
                playTrashSuckAnimation(e.clientX, e.clientY, async () => {
                    // Check new DraggableManager format first
                    const type = e.dataTransfer.getData('application/x-badnotes-type');
                    const dataStr = e.dataTransfer.getData('application/x-badnotes-data');

                    if (type && dataStr) {
                        try {
                            const data = JSON.parse(dataStr);
                            if (type === 'color') {
                                removeColor(data.value);
                                return;
                            } else if (type === 'page') {
                                await deletePage(data.index);
                                return;
                            } else if (type === 'notebook') {
                                const nb = notebooks.find(n => n.id === data.id);
                                if (nb) {
                                    if (confirm(`Move notebook "${nb.name}" to Recycle Bin?`)) {
                                        await deleteNotebook(data.id);
                                    }
                                }
                                return;
                            }
                        } catch (err) {
                            console.error('Error parsing drag data:', err);
                        }
                    }

                    // Fallback: Check legacy format
                    const color = e.dataTransfer.getData('application/x-badnotes-color');
                    const pageIndex = e.dataTransfer.getData('application/x-badnotes-page');
                    const notebookId = e.dataTransfer.getData('application/x-badnotes-notebook');

                    if (color) {
                        removeColor(color);
                    } else if (pageIndex) {
                        await deletePage(parseInt(pageIndex));
                    } else if (notebookId) {
                        // Handle notebook deletion
                        // We need to find the notebook object first
                        const nb = notebooks.find(n => n.id === notebookId);
                        if (nb) {
                            if (confirm(`Move notebook "${nb.name}" to Recycle Bin?`)) {
                                await deleteNotebook(notebookId);
                            }
                        }
                    }
                });
            });

            // Tab switching
            document.querySelectorAll('.recycle-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.recycle-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    renderRecycleList(tab.dataset.tab);
                });
            });
        }

        async function deleteNotebook(id) {
            // Prevent deleting the Fontbook
            const nb = notebooks.find(n => n.id === id);
            if (nb?.isFontBook) {
                showToast('Cannot delete Fontbook', 'error');
                return;
            }

            // Move to deleted notebooks storage
            let deletedNotebooks = JSON.parse(localStorage.getItem('badnotes_deleted_notebooks')) || [];
            if (nb) {
                deletedNotebooks.unshift({
                    ...nb,
                    deletedAt: new Date().toISOString()
                });
                localStorage.setItem('badnotes_deleted_notebooks', JSON.stringify(deletedNotebooks));

                // Delete from API/Main list
                await API.delete(`/api/notebooks/${id}`);
                await loadNotebooks();
                // Save updated order (with deleted notebook removed)
                await saveNotebookOrder();
                showToast('Notebook moved to Recycle Bin', 'success');
            }
        }

        function renderRecycleList(tab = 'pages') {
            const list = document.getElementById('recycleList');
            let items = [];

            if (tab === 'pages') {
                items = (currentNotebook?.trash || []).map(item => ({
                    type: 'page',
                    id: item.id,
                    title: `Page ${item.originalIndex + 1}`,
                    date: item.deletedAt,
                    data: item
                }));
            } else if (tab === 'notebooks') {
                const deletedNotebooks = JSON.parse(localStorage.getItem('badnotes_deleted_notebooks')) || [];
                items = deletedNotebooks.map(item => ({
                    type: 'notebook',
                    id: item.id,
                    title: item.name,
                    date: item.deletedAt,
                    data: item
                }));
            } else if (tab === 'colors') {
                const deletedColors = JSON.parse(localStorage.getItem('badnotes_deleted_colors')) || [];
                items = deletedColors.map(item => ({
                    type: 'color',
                    id: item.id,
                    title: item.color,
                    date: item.deletedAt,
                    data: item,
                    isColor: true
                }));
            }

            if (items.length === 0) {
                list.innerHTML = '<div class="empty-state">No items in this category</div>';
                return;
            }

            list.innerHTML = items.map(item => `
                <div class="recycle-item">
                    <div class="recycle-info">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            ${item.isColor ? `<div style="width: 20px; height: 20px; background: ${item.title}; border-radius: 50%; border: 1px solid #ccc;"></div>` : ''}
                            <h4>${item.title}</h4>
                        </div>
                        <p>Deleted: ${new Date(item.date).toLocaleString()}</p>
                    </div>
                    <div class="recycle-actions">
                        <button class="btn btn-sm btn-primary" onclick="restoreItem('${item.type}', '${item.id}')">Restore</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteItemForever('${item.type}', '${item.id}')">Delete</button>
                    </div>
                </div>
            `).join('');
        }

        // Override showRecycleBin to use new render
        window.showRecycleBin = function() {
            const modal = document.getElementById('recycleBinModal');
            modal.classList.add('show');
            // Default to pages tab
            document.querySelector('.recycle-tab[data-tab="pages"]').click();
        };

        window.restoreItem = async function(type, id) {
            if (type === 'page') {
                await restorePage(id);
            } else if (type === 'notebook') {
                let deletedNotebooks = JSON.parse(localStorage.getItem('badnotes_deleted_notebooks')) || [];
                const index = deletedNotebooks.findIndex(n => n.id === id);
                if (index !== -1) {
                    const nb = deletedNotebooks[index];
                    // Re-create notebook via API
                    await API.post('/api/notebooks', { name: nb.name, color: nb.color, template: nb.template });

                    deletedNotebooks.splice(index, 1);
                    localStorage.setItem('badnotes_deleted_notebooks', JSON.stringify(deletedNotebooks));

                    await loadNotebooks();
                    renderRecycleList('notebooks');
                    showToast('Notebook restored', 'success');
                }
            } else if (type === 'color') {
                let deletedColors = JSON.parse(localStorage.getItem('badnotes_deleted_colors')) || [];
                const index = deletedColors.findIndex(c => c.id === id);
                if (index !== -1) {
                    const color = deletedColors[index].color;
                    addToPalette(color);

                    deletedColors.splice(index, 1);
                    localStorage.setItem('badnotes_deleted_colors', JSON.stringify(deletedColors));

                    renderRecycleList('colors');
                    showToast('Color restored', 'success');
                }
            }
        };

        window.deleteItemForever = async function(type, id) {
            if (!confirm('Permanently delete this item?')) return;

            if (type === 'page') {
                await deleteForever(id);
            } else if (type === 'notebook') {
                let deletedNotebooks = JSON.parse(localStorage.getItem('badnotes_deleted_notebooks')) || [];
                deletedNotebooks = deletedNotebooks.filter(n => n.id !== id);
                localStorage.setItem('badnotes_deleted_notebooks', JSON.stringify(deletedNotebooks));
                renderRecycleList('notebooks');
            } else if (type === 'color') {
                let deletedColors = JSON.parse(localStorage.getItem('badnotes_deleted_colors')) || [];
                deletedColors = deletedColors.filter(c => c.id !== id);
                localStorage.setItem('badnotes_deleted_colors', JSON.stringify(deletedColors));
                renderRecycleList('colors');
            }
        };
