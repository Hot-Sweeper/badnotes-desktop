// ============== Collapsible Panels ==============
        function setupCollapsiblePanels() {
            const sidebar = document.getElementById('sidebar');
            const pageNav = document.getElementById('pageNav');
            const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
            const togglePageNavBtn = document.getElementById('togglePageNavBtn');
            const canvasContainer = document.querySelector('.canvas-container');

            const BASE_PADDING = 40;

            // Track current offsets
            // Sidebar: 0 = open (visible), -width = closed (hidden left)
            // PageNav: 0 = open (visible), +width = closed (hidden right)
            let sidebarOffset = 0;
            let pageNavOffset = 0;

            // Get actual panel width (respects resize)
            function getSidebarWidth() {
                return sidebar ? sidebar.offsetWidth : 280;
            }

            function getPageNavWidth() {
                return pageNav ? pageNav.offsetWidth : 200;
            }

            // Update canvas container padding based on panel states
            function updateCanvasPadding() {
                if (!canvasContainer) return;

                const sidebarWidth = getSidebarWidth();
                const pageNavWidth = getPageNavWidth();

                // sidebarOffset is 0 (open) to -width (closed)
                // pageNavOffset is 0 (open) to +width (closed)
                const sidebarVisible = Math.max(0, sidebarWidth + sidebarOffset);
                const pageNavVisible = Math.max(0, pageNavWidth - pageNavOffset);

                canvasContainer.style.paddingLeft = (sidebarVisible + BASE_PADDING) + 'px';
                canvasContainer.style.paddingRight = (pageNavVisible + BASE_PADDING) + 'px';
            }

            // ===== Unified Draggable Panel System =====
            function setupDraggablePanel(toggleBtn, panel, isLeftPanel, storageKey) {
                if (!toggleBtn || !panel) return;

                let isDragging = false;
                let dragStartX = 0;
                let startOffset = 0;
                let isOpen = !panel.classList.contains('collapsed');
                let pointerId=null,hideTimer=0,snapTimer=0,hovered=false,anchor=10,buttonWidth=48,buttonHeight=48;
                const feedbackTransition='opacity .24s ease, background-color .16s ease, color .16s ease, box-shadow .16s ease';
                function wake() {
                    toggleBtn.classList.add('shelf-handle-awake');clearTimeout(hideTimer);
                    hideTimer=setTimeout(()=>{if(!isDragging&&!hovered&&!(isResizing&&resizeTarget===panel)&&document.activeElement!==toggleBtn)toggleBtn.classList.remove('shelf-handle-awake');},1200);
                }
                toggleBtn.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch'){hovered=true;wake();}});
                toggleBtn.addEventListener('pointerleave',()=>{hovered=false;wake();});
                toggleBtn.addEventListener('focus',wake);toggleBtn.addEventListener('blur',wake);
                panel.addEventListener('pointerdown',wake,{passive:true});
                panel.addEventListener('pointerup',wake,{passive:true});
                document.addEventListener('pointermove',e=>{
                    if(e.pointerType==='touch'||e.buttons||isDragging)return;
                    // Cached layout geometry: no per-ink-frame style/layout reads.
                    const x=isLeftPanel?e.clientX:innerWidth-e.clientX;
                    if(Math.abs(x-anchor-buttonWidth/2)<buttonWidth/2+44&&Math.abs(e.clientY-innerHeight/2-buttonHeight/2)<buttonHeight/2+36)wake();
                },{passive:true});
                new ResizeObserver(entries=>{const box=entries[0].borderBoxSize?.[0];if(box){buttonWidth=box.inlineSize;buttonHeight=box.blockSize;}}).observe(toggleBtn);

                toggleBtn.style.touchAction = 'none';

                // Get current panel width
                function getPanelWidth() {
                    return panel.offsetWidth;
                }

                // Update arrow direction based on state
                // Left panel open: arrow points LEFT (to close/hide left)
                // Left panel closed: arrow points RIGHT (to open/reveal from left)
                // Right panel open: arrow points RIGHT (to close/hide right)
                // Right panel closed: arrow points LEFT (to open/reveal from right)
                function updateArrowDirection() {
                    const name=isLeftPanel?'notebook shelf':'page shelf';
                    toggleBtn.title=(isOpen?'Hide ':'Show ')+name;
                    toggleBtn.setAttribute('aria-label',toggleBtn.title);toggleBtn.setAttribute('aria-expanded',String(isOpen));
                    const svg = toggleBtn.querySelector('svg');
                    if (!svg) return;

                    if (isLeftPanel) {
                        // Left panel
                        svg.innerHTML = isOpen
                            ? '<polyline points="15 18 9 12 15 6"/>'  // Arrow LEFT (close)
                            : '<polyline points="9 18 15 12 9 6"/>';  // Arrow RIGHT (open)
                    } else {
                        // Right panel
                        svg.innerHTML = isOpen
                            ? '<polyline points="9 18 15 12 9 6"/>'   // Arrow RIGHT (close)
                            : '<polyline points="15 18 9 12 15 6"/>'; // Arrow LEFT (open)
                    }
                }

                // Position toggle button based on actual panel width and offset
                function positionToggleBtn() {
                    const panelWidth = getPanelWidth();
                    const currentOffset = isLeftPanel ? sidebarOffset : pageNavOffset;

                    if (isLeftPanel) {
                        // Button at right edge of sidebar
                        const btnPos = panelWidth + currentOffset - 5;
                        toggleBtn.style.left = Math.max(10, btnPos) + 'px';
                        anchor=Math.max(10,btnPos);
                        toggleBtn.style.right = 'auto';
                    } else {
                        // Button at left edge of page-nav
                        const btnPos = panelWidth - currentOffset - 5;
                        toggleBtn.style.right = Math.max(10, btnPos) + 'px';
                        anchor=Math.max(10,btnPos);
                        toggleBtn.style.left = 'auto';
                    }
                }

                // Apply panel position (for smooth dragging)
                function applyPanelPosition(offset, animate = false) {
                    const panelWidth = getPanelWidth();

                    if (animate) {
                        panel.style.transition = 'transform 0.3s ease-out';
                        toggleBtn.style.transition = feedbackTransition+', left 0.3s ease-out, right 0.3s ease-out';
                        if (canvasContainer) canvasContainer.style.transition = 'padding 0.3s ease-out';
                    } else {
                        panel.style.transition = 'none';
                        toggleBtn.style.transition = feedbackTransition;
                        if (canvasContainer) canvasContainer.style.transition = 'none';
                    }

                    if (isLeftPanel) {
                        // Left panel: offset 0 = open, -panelWidth = closed
                        const clampedOffset = Math.max(-panelWidth, Math.min(0, offset));
                        panel.style.transform = `translateX(${clampedOffset}px)`;
                        const btnPos = panelWidth + clampedOffset - 5;
                        toggleBtn.style.left = Math.max(10, btnPos) + 'px';
                        anchor=Math.max(10,btnPos);
                        sidebarOffset = clampedOffset;
                    } else {
                        // Right panel: offset 0 = open, +panelWidth = closed
                        const clampedOffset = Math.max(0, Math.min(panelWidth, offset));
                        panel.style.transform = `translateX(${clampedOffset}px)`;
                        const btnPos = panelWidth - clampedOffset - 5;
                        toggleBtn.style.right = Math.max(10, btnPos) + 'px';
                        anchor=Math.max(10,btnPos);
                        pageNavOffset = clampedOffset;
                    }

                    updateCanvasPadding();
                }

                // Snap to open or closed
                function snapPanel(toOpen) {
                    const panelWidth = getPanelWidth();
                    isOpen = toOpen;

                    if (toOpen) {
                        applyPanelPosition(0, true);
                        panel.classList.remove('collapsed');
                    } else {
                        applyPanelPosition(isLeftPanel ? -panelWidth : panelWidth, true);
                        panel.classList.add('collapsed');
                    }

                    toggleBtn.classList.add('visible');
                    wake();
                    updateArrowDirection();
                    localStorage.setItem(storageKey, toOpen ? 'false' : 'true');

                    clearTimeout(snapTimer);snapTimer=setTimeout(() => {
                        panel.style.transition = '';
                        toggleBtn.style.transition = '';
                        if (canvasContainer) canvasContainer.style.transition = '';
                    }, 300);
                }

                // Pointer down
                toggleBtn.addEventListener('pointerdown', (e) => {
                    if(e.button!==0||isDragging)return;
                    clearTimeout(snapTimer);
                    const offset=new DOMMatrix(getComputedStyle(panel).transform).m41;
                    applyPanelPosition(offset,false);
                    isDragging = true;
                    pointerId=e.pointerId;wake();
                    dragStartX = e.clientX;
                    startOffset = isLeftPanel ? sidebarOffset : pageNavOffset;
                    toggleBtn.setPointerCapture(e.pointerId);
                    toggleBtn.style.cursor = 'grabbing';
                    e.preventDefault();
                });

                // Pointer move - REAL-TIME dragging
                document.addEventListener('pointermove', (e) => {
                    if (!isDragging||e.pointerId!==pointerId) return;

                    const deltaX = e.clientX - dragStartX;
                    let newOffset;

                    // LEFT PANEL:
                    //   Drag RIGHT (deltaX > 0) = open (offset goes toward 0)
                    //   Drag LEFT (deltaX < 0) = close (offset goes toward -width)
                    //   Formula: newOffset = startOffset + deltaX
                    //
                    // RIGHT PANEL:
                    //   Drag LEFT (deltaX < 0) = open (offset goes toward 0)
                    //   Drag RIGHT (deltaX > 0) = close (offset goes toward +width)
                    //   Formula: newOffset = startOffset + deltaX (same! because positive offset = closed)

                    newOffset = startOffset + deltaX;
                    applyPanelPosition(newOffset, false);
                });

                // Pointer up - snap based on position
                document.addEventListener('pointerup', (e) => {
                    if (!isDragging||e.pointerId!==pointerId) return;
                    isDragging = false;
                    if(toggleBtn.hasPointerCapture(pointerId))toggleBtn.releasePointerCapture(pointerId);pointerId=null;
                    toggleBtn.style.cursor = 'grab';

                    const panelWidth = getPanelWidth();
                    const deltaX = e.clientX - dragStartX;
                    const threshold = panelWidth * 0.3;

                    // Only snap if there was significant movement
                    if (Math.abs(deltaX) < 5) {
                        snapPanel(!isOpen);
                        return;
                    }

                    const newOffset = startOffset + deltaX;

                    if (isLeftPanel) {
                        // Left panel: open at 0, closed at -panelWidth
                        // If currently open, close if dragged past threshold left
                        // If currently closed, open if dragged past threshold right
                        if (isOpen) {
                            snapPanel(newOffset > -threshold);
                        } else {
                            snapPanel(newOffset > -panelWidth + threshold);
                        }
                    } else {
                        // Right panel: open at 0, closed at +panelWidth
                        // If currently open, close if dragged past threshold right
                        // If currently closed, open if dragged past threshold left
                        if (isOpen) {
                            snapPanel(newOffset < threshold);
                        } else {
                            snapPanel(newOffset < panelWidth - threshold);
                        }
                    }
                });

                const cancelDrag = (e) => {
                    if (isDragging&&(!e||e.pointerId===pointerId)) {
                        isDragging = false;
                        if(toggleBtn.hasPointerCapture(pointerId))toggleBtn.releasePointerCapture(pointerId);pointerId=null;
                        toggleBtn.style.cursor = 'grab';
                        snapPanel(isOpen);
                    }
                };
                document.addEventListener('pointercancel',cancelDrag);toggleBtn.addEventListener('lostpointercapture',cancelDrag);
                window.addEventListener('blur',()=>{cancelDrag();hovered=false;toggleBtn.classList.remove('shelf-handle-awake');});
                toggleBtn.addEventListener('click',e=>{if(e.detail===0&&!isDragging)snapPanel(!isOpen);});
                toggleBtn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat)toggleBtn.click();}});
                toggleBtn.addEventListener('keyup',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();}});

                // Listen for panel resize - reposition button when panel width changes
                const resizeObserver = new ResizeObserver(() => {
                    if (!isDragging) {
                        const width=getPanelWidth();
                        // A collapsed shelf must remain completely offscreen
                        // when its persisted width or window size changes.
                        applyPanelPosition(isOpen?0:isLeftPanel?-width:width,false);
                        positionToggleBtn();
                        updateCanvasPadding();
                    }
                });
                resizeObserver.observe(panel);

                // Initialize state
                const savedCollapsed = localStorage.getItem(storageKey) === 'true';
                if (savedCollapsed) {
                    isOpen = false;
                    panel.classList.add('collapsed');
                    const panelWidth = getPanelWidth();
                    if (isLeftPanel) {
                        sidebarOffset = -panelWidth;
                        panel.style.transform = `translateX(-${panelWidth}px)`;
                    } else {
                        pageNavOffset = panelWidth;
                        panel.style.transform = `translateX(${panelWidth}px)`;
                    }
                }
                toggleBtn.classList.add('visible');
                positionToggleBtn();
                updateArrowDirection();
                wake();

                return { positionToggleBtn, updateCanvasPadding };
            }

            // Setup both panels
            setupDraggablePanel(toggleSidebarBtn, sidebar, true, 'badnotes_sidebarCollapsed');
            setupDraggablePanel(togglePageNavBtn, pageNav, false, 'badnotes_pageNavCollapsed');

            // Initialize canvas padding
            updateCanvasPadding();
        }
