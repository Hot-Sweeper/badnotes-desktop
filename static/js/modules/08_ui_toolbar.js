// ============== Floating Toolbar ==============
        function setupFloatingToolbar() {
            const toolbar = document.querySelector('.floating-toolbar');
            const dragHandle = document.querySelector('.toolbar-drag-handle');
            const collapseBtn = document.getElementById('toolbarCollapseBtn');

            if (!toolbar || !dragHandle) return;

            let isDragging = false;
            let startX, startY;
            let toolbarX = 0, toolbarY = 0;

            // Load saved position and state
            const savedPos = localStorage.getItem('toolbarPosition');
            const savedCollapsed = localStorage.getItem('toolbarCollapsed');

            if (savedPos) {
                try {
                    const pos = JSON.parse(savedPos);
                    toolbarX = pos.x;
                    toolbarY = pos.y;
                    toolbar.style.left = toolbarX + 'px';
                    toolbar.style.bottom = 'auto';
                    toolbar.style.top = toolbarY + 'px';
                    toolbar.style.transform = 'none';
                } catch(e) {}
            }

            if (savedCollapsed === 'true') {
                toolbar.classList.add('collapsed');
            }

            // Drag functionality using pointer events (works with pen/touch/mouse)
            dragHandle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                isDragging = true;
                dragHandle.setPointerCapture(e.pointerId);

                const rect = toolbar.getBoundingClientRect();
                startX = e.clientX - rect.left;
                startY = e.clientY - rect.top;

                toolbar.style.transition = 'none';
                dragHandle.style.cursor = 'grabbing';
            });

            dragHandle.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                e.preventDefault();

                let newX = e.clientX - startX;
                let newY = e.clientY - startY;

                // Keep within viewport bounds
                const toolbarRect = toolbar.getBoundingClientRect();
                const maxX = window.innerWidth - toolbarRect.width;
                const maxY = window.innerHeight - toolbarRect.height;

                newX = Math.max(0, Math.min(newX, maxX));
                newY = Math.max(0, Math.min(newY, maxY));

                toolbarX = newX;
                toolbarY = newY;

                toolbar.style.left = newX + 'px';
                toolbar.style.bottom = 'auto';
                toolbar.style.top = newY + 'px';
                toolbar.style.transform = 'none';
            });

            dragHandle.addEventListener('pointerup', (e) => {
                if (!isDragging) return;
                isDragging = false;
                dragHandle.releasePointerCapture(e.pointerId);
                dragHandle.style.cursor = 'grab';
                toolbar.style.transition = '';

                // Save position
                localStorage.setItem('toolbarPosition', JSON.stringify({ x: toolbarX, y: toolbarY }));
            });

            dragHandle.addEventListener('pointercancel', (e) => {
                isDragging = false;
                dragHandle.style.cursor = 'grab';
                toolbar.style.transition = '';
            });

            // Collapse/expand toggle
            if (collapseBtn) {
                collapseBtn.addEventListener('click', () => {
                    toolbar.classList.toggle('collapsed');
                    localStorage.setItem('toolbarCollapsed', toolbar.classList.contains('collapsed'));
                });
            }
        }
