// ============== Notebooks ==============
        async function loadNotebooks() {
            notebooks = await API.get('/api/notebooks') || [];
            renderNotebookList();

            if (notebooks.length > 0) {
                // Try to restore last notebook
                const lastNotebookId = localStorage.getItem('badnotes_lastNotebook');
                const lastNotebook = notebooks.find(n => n.id === lastNotebookId);

                if (lastNotebook) {
                    await selectNotebook(lastNotebook.id);
                } else {
                    await selectNotebook(notebooks[0].id);
                }
            } else {
                document.getElementById('app').style.display = 'flex';
                document.getElementById('loading').style.display = 'none';
            }
        }

// ============== Notebook Drag State ==============
        // Deliberate pickup, shared by both shelves and input methods. Moving
        // before this expires still cancels pickup so scrolling stays native.
        const SHELF_DRAG_HOLD_MS = 450;
        const notebookDrag = {
            active: false,
            el: null,
            index: -1,
            dropIndex: -1,
            clone: null,
            offsetY: 0,
            holdTimer: null,
            initialized: false,
            pressing: false
        };

// ============== Pointer-Based Reorder System ==============
        // Works with touch, pen, and mouse (unlike HTML5 drag-and-drop)
        function setupPointerReorder(container, itemSelector, options = {}) {
            const {
                onReorder = () => {},     // Called when item is dropped at new position
                dataAttribute = 'index',  // data-* attribute to use for identification
                direction = 'vertical',   // 'vertical' or 'horizontal'
                ghostClass = 'dragging',  // Class added to dragged item
                dragDelay = 150           // Delay before drag starts (ms)
            } = options;

            let dragItem = null;
            let dragIndex = -1;
            let ghostElement = null;
            let dragTimeout = null;
            let isDragging = false;
            let initialY = 0, initialX = 0;
            let scrollInterval = null;

            function createGhost(item) {
                const rect = item.getBoundingClientRect();
                const ghost = item.cloneNode(true);
                ghost.classList.add('drag-ghost');
                ghost.style.cssText = `
                    position: fixed;
                    width: ${rect.width}px;
                    height: ${rect.height}px;
                    pointer-events: none;
                    z-index: 10000;
                    opacity: 0.9;
                    transform: scale(1.02);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                    transition: none;
                `;
                document.body.appendChild(ghost);
                return ghost;
            }

            function updateGhostPosition(e) {
                if (!ghostElement) return;
                const x = e.clientX - ghostElement.offsetWidth / 2;
                const y = e.clientY - ghostElement.offsetHeight / 2;
                ghostElement.style.left = x + 'px';
                ghostElement.style.top = y + 'px';
            }

            function findDropIndex(e) {
                const items = Array.from(container.querySelectorAll(itemSelector));
                const isVertical = direction === 'vertical';

                for (let i = 0; i < items.length; i++) {
                    if (items[i] === dragItem) continue;

                    const rect = items[i].getBoundingClientRect();
                    const mid = isVertical
                        ? rect.top + rect.height / 2
                        : rect.left + rect.width / 2;
                    const pos = isVertical ? e.clientY : e.clientX;

                    if (pos < mid) {
                        return parseInt(items[i].dataset[dataAttribute]);
                    }
                }

                // At the end
                return items.length;
            }

            function handlePointerDown(e) {
                const item = e.target.closest(itemSelector);
                if (!item || e.target.closest('button')) return; // Ignore buttons

                initialX = e.clientX;
                initialY = e.clientY;

                // Start drag after delay (allows for tap/click)
                dragTimeout = setTimeout(() => {
                    startDrag(item, e);
                }, dragDelay);

                item.addEventListener('pointerup', cancelDragStart, { once: true });
                item.addEventListener('pointercancel', cancelDragStart, { once: true });
            }

            function cancelDragStart() {
                clearTimeout(dragTimeout);
                dragTimeout = null;
            }

            function startDrag(item, e) {
                isDragging = true;
                dragItem = item;
                dragIndex = parseInt(item.dataset[dataAttribute]);

                item.classList.add(ghostClass);
                item.style.opacity = '0.4';

                ghostElement = createGhost(item);
                updateGhostPosition(e);

                item.setPointerCapture(e.pointerId);

                // Auto-scroll near edges
                scrollInterval = setInterval(() => {
                    if (!isDragging) return;
                    const containerRect = container.getBoundingClientRect();
                    const scrollSpeed = 8;

                    if (direction === 'vertical') {
                        if (e.clientY < containerRect.top + 40) {
                            container.scrollTop -= scrollSpeed;
                        } else if (e.clientY > containerRect.bottom - 40) {
                            container.scrollTop += scrollSpeed;
                        }
                    }
                }, 16);
            }

            function handlePointerMove(e) {
                if (!isDragging) {
                    // Check if moved enough to cancel the drag delay
                    const dx = e.clientX - initialX;
                    const dy = e.clientY - initialY;
                    if (Math.sqrt(dx*dx + dy*dy) > 10) {
                        cancelDragStart();
                    }
                    return;
                }

                e.preventDefault();
                updateGhostPosition(e);

                // Visual feedback for drop position
                const items = container.querySelectorAll(itemSelector);
                items.forEach(item => {
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                    if (item === dragItem) return;

                    const rect = item.getBoundingClientRect();
                    const mid = direction === 'vertical'
                        ? rect.top + rect.height / 2
                        : rect.left + rect.width / 2;
                    const pos = direction === 'vertical' ? e.clientY : e.clientX;

                    if (pos < mid) {
                        item.classList.add('drag-over-top');
                    } else {
                        item.classList.add('drag-over-bottom');
                    }
                });
            }

            function handlePointerUp(e) {
                cancelDragStart();

                if (!isDragging) return;

                const toIndex = findDropIndex(e);

                // Cleanup
                if (ghostElement) {
                    ghostElement.remove();
                    ghostElement = null;
                }

                if (dragItem) {
                    dragItem.classList.remove(ghostClass);
                    dragItem.style.opacity = '';
                    dragItem.releasePointerCapture(e.pointerId);
                }

                container.querySelectorAll(itemSelector).forEach(item => {
                    item.classList.remove('drag-over-top', 'drag-over-bottom');
                });

                clearInterval(scrollInterval);

                const fromIndex = dragIndex;
                isDragging = false;
                dragItem = null;
                dragIndex = -1;

                // Trigger callback if position changed
                let adjustedTo = toIndex;
                if (fromIndex < toIndex) adjustedTo--;

                if (fromIndex !== adjustedTo && adjustedTo >= 0) {
                    onReorder(fromIndex, adjustedTo);
                }
            }

            container.addEventListener('pointerdown', handlePointerDown);
            container.addEventListener('pointermove', handlePointerMove);
            container.addEventListener('pointerup', handlePointerUp);
            container.addEventListener('pointercancel', handlePointerUp);

            // Return cleanup function
            return () => {
                container.removeEventListener('pointerdown', handlePointerDown);
                container.removeEventListener('pointermove', handlePointerMove);
                container.removeEventListener('pointerup', handlePointerUp);
                container.removeEventListener('pointercancel', handlePointerUp);
            };
        }

        // A cursor has an explicit pressed button, unlike a finger scrolling a
        // shelf. Start its drag on movement; keep touch's deliberate hold.
        function bindShelfCursorDrag(container, selector, state, {begin, move, finish, onStart}) {
            let pointer=null;
            function clearPointer() {
                const previous=pointer;pointer=null;
                clearTimeout(state.holdTimer);state.holdTimer=null;
                if(previous)try{if(previous.item.hasPointerCapture(previous.id))previous.item.releasePointerCapture(previous.id);}catch{}
            }
            function pickup() {
                if(!pointer)return;
                begin(pointer.x,pointer.y);
                if(state.active)try{pointer.item.setPointerCapture(pointer.id);}catch{}
            }
            container.addEventListener('pointerdown',e=>{
                if(e.pointerType==='touch'||e.button!==0||pointer||state.active||state.holdTimer)return;
                const item=e.target.closest(selector);
                if(!item||e.target.closest('button,input,select,textarea,a'))return;
                onStart?.();
                pointer={id:e.pointerId,item,x:e.clientX,y:e.clientY};
                state.index=parseInt(item.dataset.index);state.dropIndex=state.index;
                state.el=item;state.pressing=true;item.classList.add('pressing');
                state.holdTimer=setTimeout(pickup,SHELF_DRAG_HOLD_MS);
                e.preventDefault();
            });
            document.addEventListener('pointermove',e=>{
                if(!pointer||e.pointerId!==pointer.id)return;
                if(!(e.buttons&1)){clearPointer();finish(true);return;}
                if(!state.active&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>=6)pickup();
                if(state.active){e.preventDefault();move(e.clientX,e.clientY);}
            });
            document.addEventListener('pointerup',e=>{
                if(!pointer||e.pointerId!==pointer.id)return;
                if(state.active)move(e.clientX,e.clientY);
                clearPointer();finish(false);
            });
            const cancel=()=>{clearPointer();finish(true);};
            document.addEventListener('pointercancel',e=>{if(pointer?.id===e.pointerId)cancel();});
            // Pen contact may begin with implicit capture on a child (canvas,
            // emblem), then transfer to the item. That child's lost-capture
            // event is not a cancelled drag.
            container.addEventListener('lostpointercapture',e=>{if(state.active&&pointer?.id===e.pointerId&&e.target===pointer.item&&!pointer.item.hasPointerCapture(e.pointerId))cancel();});
            window.addEventListener('blur',cancel);
            document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();});
        }

        let notebookEditingId=null;
        const notebookEmblems={
            book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM20 4h-4a3 3 0 0 0-3 3M20 4v15h-3',
            pen:'m4 20 1-5L16 4a2 2 0 0 1 4 4L9 19zM14 6l4 4',
            grid:'M4 4h16v16H4zM4 12h16M12 4v16',
            math:'M5 6h6M8 3v6M15 6h6M5 15l6 6M11 15l-6 6M16 16h5M16 20h5',
            code:'m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
            flask:'M9 3h6M10 3v7L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 16h10',
            leaf:'M20 3C8 2 2 8 5 16s15 4 15-13ZM5 19l10-10',
            music:'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3h3M21 16a3 3 0 1 1-3-3h3',
            work:'M3 7h18v13H3zM8 7V3h8v4M3 12h18M10 12v3h4v-3'
        };
        function notebookEmblemSvg(icon='book') {
            return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${notebookEmblems[icon] || notebookEmblems.book}"/></svg>`;
        }
        function notebookText(value) {const span=document.createElement('span');span.textContent=value;return span.innerHTML.replaceAll('"','&quot;');}
        function openNotebookEditor(id) {
            const notebook=notebooks.find(n=>n.id===id);if(!notebook)return;
            notebookEditingId=id;
            document.getElementById('newNotebookTitle').value=notebook.name;
            const colorGrid=document.getElementById('colorGrid');
            let colorButton=Array.from(colorGrid.children).find(b=>b.dataset.color===notebook.color);
            if(!colorButton){colorButton=document.createElement('button');colorButton.type='button';colorButton.className='color-option';colorButton.dataset.color=notebook.color;colorButton.style.background=notebook.color;colorButton.setAttribute('aria-label','Current cover color');colorGrid.appendChild(colorButton);}
            colorGrid.querySelectorAll('.color-option').forEach(b=>{b.classList.toggle('selected',b===colorButton);b.setAttribute('aria-pressed',String(b===colorButton));});
            document.querySelectorAll('#notebookIconGrid button').forEach(b=>{const selected=b.dataset.icon===(notebook.icon||(notebook.isFontBook ? 'pen' : 'book'));b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
            showModal('newNotebookModal');
        }
        function renderNotebookList() {
            const list = document.getElementById('notebookList');

            if (notebooks.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
                        </svg>
                        <p>No notebooks yet</p>
                    </div>
                `;
                return;
            }

            list.innerHTML = notebooks.map((nb, idx) => `
                <div class="notebook-item ${currentNotebook?.id === nb.id ? 'active' : ''}" data-id="${nb.id}" data-index="${idx}">
                    <div class="notebook-cover" style="--cover-color: ${/^#[0-9a-f]{3,8}$/i.test(nb.color) ? nb.color : '#6055d8'}">
                        <span class="cover-emblem">${notebookEmblemSvg(nb.icon || (nb.isFontBook ? 'pen' : 'book'))}</span>
                    </div>
                    <div class="notebook-info">
                        <div class="notebook-name">${notebookText(nb.name)}</div>
                        <div class="notebook-meta">${nb.pages?.length || 0} ${(nb.pages?.length || 0) === 1 ? 'page' : 'pages'}</div>
                    </div>
                    <button class="notebook-edit" data-id="${nb.id}" title="Edit notebook" aria-label="Edit ${notebookText(nb.name)}">${notebookEmblemSvg('pen')}</button>
                    ${nb.isFontBook ? '' : `<button class="notebook-delete" data-id="${nb.id}">✕</button>`}
                </div>
            `).join('');
            list.querySelectorAll('.notebook-edit').forEach(btn=>{
                btn.addEventListener('mousedown',e=>e.stopPropagation());
                btn.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
                btn.addEventListener('click',e=>{e.stopPropagation();openNotebookEditor(btn.dataset.id);});
            });

            // Delete button listeners
            list.querySelectorAll('.notebook-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this notebook?')) {
                        await deleteNotebook(btn.dataset.id);
                    }
                });
            });

            // Setup iOS-style drag reordering (only once)
            if (!notebookDrag.initialized) {
                initNotebookDragSystem(list);
                notebookDrag.initialized = true;
            }
        }

        function initNotebookDragSystem(container) {
            // Use touch events for touch devices, pointer events for mouse
            let startY = 0;
            let startX = 0;
            let scrolling = false;

            // Touch events for mobile
            container.addEventListener('touchstart', (e) => {
                const item = e.target.closest('.notebook-item');
                if (!item || notebookDrag.active || e.target.closest('.notebook-delete')) return;

                const touch = e.touches[0];
                startY = touch.clientY;
                startX = touch.clientX;
                scrolling = false;
                notebookDrag.index = parseInt(item.dataset.index);
                notebookDrag.el = item;
                notebookDrag.dropIndex = notebookDrag.index;
                notebookDrag.pressing = true;

                item.classList.add('pressing');

                // Hold still before picking up; scrolling cancels the timer.
                notebookDrag.holdTimer = setTimeout(() => {
                    if (!scrolling) {
                        e.preventDefault();
                        beginNotebookDrag(touch.clientX, touch.clientY);
                    }
                }, SHELF_DRAG_HOLD_MS);
            }, { passive: false });

            container.addEventListener('touchmove', (e) => {
                const touch = e.touches[0];
                const deltaY = Math.abs(touch.clientY - startY);
                const deltaX = Math.abs(touch.clientX - startX);

                // If moved significantly before hold timer, it's a scroll
                if (notebookDrag.holdTimer && (deltaY > 15 || deltaX > 15)) {
                    clearTimeout(notebookDrag.holdTimer);
                    notebookDrag.holdTimer = null;
                    scrolling = true;
                    if (notebookDrag.el && notebookDrag.pressing) {
                        notebookDrag.el.classList.remove('pressing');
                        notebookDrag.pressing = false;
                    }
                }

                if (!notebookDrag.active) return;
                e.preventDefault(); // Only prevent when actually dragging

                moveNotebookDrag(touch.clientX, touch.clientY, container);
            }, { passive: false });

            container.addEventListener('touchend', (e) => finishNotebookDrag(container));
            container.addEventListener('touchcancel', (e) => finishNotebookDrag(container,true));

            bindShelfCursorDrag(container,'.notebook-item',notebookDrag,{
                onStart:()=>{scrolling=false;},
                begin:beginNotebookDrag,
                move:(x,y)=>moveNotebookDrag(x,y,container),
                finish:cancelled=>finishNotebookDrag(container,cancelled)
            });

            // Click handler for notebook selection
            container.addEventListener('click', (e) => {
                if (notebookDrag.active || scrolling || performance.now() < (notebookDrag.suppressClickUntil||0)) return;
                const item = e.target.closest('.notebook-item');
                if (!item || e.target.closest('.notebook-delete')) return;
                selectNotebook(item.dataset.id);
            });

            function beginNotebookDrag(clientX, clientY) {
                if(notebookDrag.active||!notebookDrag.el)return;
                window.ElasticScroll?.cancel(container,true);
                clearTimeout(notebookDrag.holdTimer);notebookDrag.holdTimer=null;
                notebookDrag.active = true;
                const rect = notebookDrag.el.getBoundingClientRect();
                notebookDrag.pressing = false;
                notebookDrag.el.classList.remove('pressing');
                notebookDrag.offsetY = clientY - rect.top;
                notebookDrag.offsetX = clientX - rect.left;
                notebookDrag.clientX=clientX;notebookDrag.clientY=clientY;

                notebookDrag.clone = DragMotion.cloneNotebook(notebookDrag.el);
                document.body.appendChild(notebookDrag.clone);
                notebookDrag.motion=DragMotion.create(notebookDrag.clone,clientX,clientY,rect);
                notebookDrag.items=Array.from(container.querySelectorAll('.notebook-item'));
                notebookDrag.el.classList.add('dragging-source');
            }

            function moveNotebookDrag(clientX, clientY, container) {
                if (!notebookDrag.clone) return;

                notebookDrag.motion.move(clientX,clientY);
                notebookDrag.clientX=clientX;notebookDrag.clientY=clientY;
                if(isOverRecycleBin(clientX,clientY,'notebook'))return;

                const items = notebookDrag.items;
                const containerRect = container.getBoundingClientRect();
                const scrollTop = container.scrollTop;

                const firstItem = items.find((t, i) => i !== notebookDrag.index);
                if (!firstItem) return;

                const itemHeight = firstItem.offsetHeight + 6;
                const relativeY = clientY - containerRect.top + scrollTop;

                let newDrop = Math.floor(relativeY / itemHeight);
                newDrop = Math.max(0, Math.min(newDrop, items.length - 1));

                if (newDrop !== notebookDrag.dropIndex) {
                    notebookDrag.dropIndex = newDrop;
                    updateNotebookDropIndicators(container);
                }

                // Auto scroll
                if (clientY < containerRect.top + 50) container.scrollTop -= 6;
                if (clientY > containerRect.bottom - 50) container.scrollTop += 6;
            }

            function updateNotebookDropIndicators(container) {
                const items = container.querySelectorAll('.notebook-item');
                const gap = 6;

                items.forEach((t, i) => {
                    if (i === notebookDrag.index) return;

                    let offset = 0;
                    if (notebookDrag.dropIndex < notebookDrag.index) {
                        if (i >= notebookDrag.dropIndex && i < notebookDrag.index) offset = 1;
                    } else if (notebookDrag.dropIndex > notebookDrag.index) {
                        if (i > notebookDrag.index && i <= notebookDrag.dropIndex) offset = -1;
                    }

                    const itemHeight = t.offsetHeight + gap;
                    t.style.transform = offset !== 0 ? `translateY(${offset * itemHeight}px)` : '';
                });
            }

            async function finishNotebookDrag(container,cancelled=false) {
                clearTimeout(notebookDrag.holdTimer);
                notebookDrag.holdTimer = null;

                if (notebookDrag.el && notebookDrag.pressing) {
                    notebookDrag.el.classList.remove('pressing');
                    notebookDrag.pressing = false;
                }

                if (!notebookDrag.active) return;

                const from = notebookDrag.index;
                const to = notebookDrag.dropIndex;
                const plan=notebookDrag.motion?.release(cancelled);
                const dropped=!!plan;
                const dropX=notebookDrag.clientX,dropY=notebookDrag.clientY,id=notebooks[from]?.id;
                // The vertical insertion slot survives a sideways flick out of
                // the shelf: spring home to that new slot, not the old order.
                const didMove = !cancelled && !dropped && from !== to && from !== -1 && to !== -1;

                const cloneToRemove = notebookDrag.clone;
                const elToClean = notebookDrag.el;

                notebookDrag.active = false;
                notebookDrag.el = null;
                notebookDrag.index = -1;
                notebookDrag.dropIndex = -1;
                notebookDrag.clone = null;
                notebookDrag.suppressClickUntil=performance.now()+500;
                if(!dropped)elToClean?.classList.add('spring-return-slot');
                elToClean?.classList.remove('dragging-source');
                container.querySelectorAll('.notebook-item').forEach(t=>t.style.transform='');
                clearTrashHover();
                if(dropped){await TrashWorkbench.drop('notebook',id,cloneToRemove,dropX,dropY,plan);return;}

                if (didMove) {
                    const [moved] = notebooks.splice(from, 1);
                    notebooks.splice(to, 0, moved);
                    renderNotebookList();
                    saveNotebookOrder();
                } else {
                    if (elToClean) elToClean.classList.remove('dragging-source');
                    container.querySelectorAll('.notebook-item').forEach(t => t.style.transform = '');
                }
                const destination=Array.from(container.querySelectorAll('.notebook-item')).find(el=>notebooks[parseInt(el.dataset.index)]?.id===id);
                DragMotion.settle(cloneToRemove,destination);
            }
        }

        async function saveNotebookOrder() {
            // Save notebook order to server (just update the order, no feedback needed)
            try {
                const order = notebooks.map(nb => nb.id);
                await API.put('/api/notebooks/order', { order });
            } catch(err) {
                console.error('Failed to save notebook order:', err);
            }
        }

        async function selectNotebook(notebookId) {
            const data = await API.get(`/api/notebooks/${notebookId}`);

            if (!data || !data.notebook) {
                showToast('Failed to load notebook', 'error');
                return;
            }

            // Save current page before switching
            if (currentNotebook) {
                await saveCurrentPage();
            }

            currentNotebook = data.notebook;
            pages = data.pages || [];

            // Try to restore last page index for this notebook
            const savedPageIndex = parseInt(localStorage.getItem(`badnotes_lastPage_${notebookId}`)) || 0;
            currentPageIndex = Math.min(savedPageIndex, Math.max(0, pages.length - 1));

            // Ensure at least one page exists
            if (pages.length === 0) {
                const newPage = await API.post(`/api/notebooks/${notebookId}/pages`, {
                    template: currentNotebook.template || 'blank'
                });
                if (newPage) {
                    pages.push(newPage);
                    currentNotebook.pages = [newPage.id];
                }
            }

            renderNotebookList();
            renderPageList();

            if (pages.length > 0) {
                loadPage(currentPageIndex);
            }

            document.getElementById('app').style.display = 'flex';
            document.getElementById('loading').style.display = 'none';

            // Save as last notebook
            localStorage.setItem('badnotes_lastNotebook', notebookId);
        }

        async function createNotebook(name, color, template) {
            const icon=document.querySelector('#notebookIconGrid .selected')?.dataset.icon || 'book';
            if(notebookEditingId) {
                const id=notebookEditingId;
                const updated=await API.put(`/api/notebooks/${id}`,{name:name.trim()||'Untitled Notebook',color,icon});
                const existing=notebooks.find(n=>n.id===id);Object.assign(existing,updated);
                if(currentNotebook?.id===id)Object.assign(currentNotebook,updated);
                renderNotebookList();showToast('Notebook updated','success');return;
            }
            const result = await API.post('/api/notebooks', { name, color, template, icon });
            notebooks.unshift(result.notebook);
            // Save notebook order to persist the new notebook at the top
            await saveNotebookOrder();
            await selectNotebook(result.notebook.id);
            showToast('Notebook created!', 'success');
        }

// ============== Pages ==============
        // Page drag state - single instance
        const pageDrag = {
            active: false,
            el: null,
            index: -1,
            dropIndex: -1,
            clone: null,
            offsetY: 0,
            holdTimer: null,
            initialized: false,
            pressing: false
        };

        function renderPageList() {
            const list = document.getElementById('pageList');
            const indicator=document.getElementById('pageIndicator');
            if(indicator)indicator.textContent=`${pages.length ? currentPageIndex+1 : 0} / ${pages.length}`;

            // Keep the same paper/canvas layers when selecting or sorting.
            // Replacing their DOM uploaded fresh textures at the drag handoff.
            const existing=new Map(Array.from(list.children).map(thumb=>[thumb.dataset.pageId,thumb]));
            const retained=new Set(),scrollTop=list.scrollTop;
            pages.forEach((page,i)=>{
                let thumb=existing.get(String(page.id));
                if(!thumb){
                    thumb=document.createElement('div');thumb.className='page-thumb';
                    thumb.innerHTML='<div class="page-paper"><canvas width="200" height="266"></canvas><span class="page-number"></span></div>';
                }
                thumb.dataset.pageId=page.id;thumb.dataset.index=i;
                thumb.classList.toggle('active',i===currentPageIndex);
                thumb.querySelector('.page-number').textContent=i+1;
                retained.add(thumb);
                if(list.children[i]!==thumb)list.insertBefore(thumb,list.children[i]||null);
            });
            Array.from(list.children).forEach(thumb=>{if(!retained.has(thumb))thumb.remove();});
            list.scrollTop=scrollTop;

            // Generate thumbnails
            list.querySelectorAll('.page-thumb').forEach((thumb, i) => {
                generateThumbnail(thumb.querySelector('canvas'), pages[i]);
            });

            // Setup drag only once
            if (!pageDrag.initialized) {
                initPageDragSystem(list);
                pageDrag.initialized = true;
            }
        }

        function initPageDragSystem(container) {
            // Use touch events for touch devices, pointer events for mouse
            let startY = 0;
            let startX = 0;
            let scrolling = false;

            // Touch events for mobile
            container.addEventListener('touchstart', (e) => {
                const thumb = e.target.closest('.page-thumb');
                if (!thumb || pageDrag.active) return;

                const touch = e.touches[0];
                startY = touch.clientY;
                startX = touch.clientX;
                scrolling = false;
                pageDrag.index = parseInt(thumb.dataset.index);
                pageDrag.el = thumb;
                pageDrag.dropIndex = pageDrag.index;
                pageDrag.pressing = true;

                thumb.classList.add('pressing');

                // Hold still before picking up; scrolling cancels the timer.
                pageDrag.holdTimer = setTimeout(() => {
                    if (!scrolling) {
                        e.preventDefault();
                        beginPageDrag(touch.clientX, touch.clientY);
                    }
                }, SHELF_DRAG_HOLD_MS);
            }, { passive: false });

            container.addEventListener('touchmove', (e) => {
                const touch = e.touches[0];
                const deltaY = Math.abs(touch.clientY - startY);
                const deltaX = Math.abs(touch.clientX - startX);

                // If moved significantly before hold timer, it's a scroll
                if (pageDrag.holdTimer && (deltaY > 15 || deltaX > 15)) {
                    clearTimeout(pageDrag.holdTimer);
                    pageDrag.holdTimer = null;
                    scrolling = true;
                    if (pageDrag.el && pageDrag.pressing) {
                        pageDrag.el.classList.remove('pressing');
                        pageDrag.pressing = false;
                    }
                }

                if (!pageDrag.active) return;
                e.preventDefault(); // Only prevent when actually dragging

                movePageDrag(touch.clientX, touch.clientY, container);
            }, { passive: false });

            container.addEventListener('touchend', (e) => finishPageDrag(container));
            container.addEventListener('touchcancel', (e) => finishPageDrag(container,true));

            bindShelfCursorDrag(container,'.page-thumb',pageDrag,{
                onStart:()=>{scrolling=false;},
                begin:beginPageDrag,
                move:(x,y)=>movePageDrag(x,y,container),
                finish:cancelled=>finishPageDrag(container,cancelled)
            });

            // Click handler for page switching
            container.addEventListener('click', async (e) => {
                if (pageDrag.active || scrolling || performance.now() < (pageDrag.suppressClickUntil || 0)) return;
                const thumb = e.target.closest('.page-thumb');
                if (!thumb) return;

                const i = parseInt(thumb.dataset.index);
                if (i === currentPageIndex) return;

                await saveCurrentPage();
                currentPageIndex = i;
                loadPage(i);
                renderPageList();
            });

            function beginPageDrag(clientX, clientY) {
                if(pageDrag.active || !pageDrag.el)return;
                window.ElasticScroll?.cancel(container,true);
                clearTimeout(pageDrag.holdTimer);
                pageDrag.holdTimer=null;
                pageDrag.active = true;
                const rect = pageDrag.el.getBoundingClientRect();
                pageDrag.pressing = false;
                pageDrag.el.classList.remove('pressing');
                pageDrag.offsetY = clientY - rect.top;
                pageDrag.offsetX=clientX-rect.left;pageDrag.originLeft=rect.left;
                pageDrag.clientX=clientX;pageDrag.clientY=clientY;

                pageDrag.clone = DragMotion.clonePage(pageDrag.el);
                document.body.appendChild(pageDrag.clone);

                pageDrag.el.classList.add('dragging-source');
                pageDrag.motion=DragMotion.create(pageDrag.clone,clientX,clientY,rect);
                const listTop=container.getBoundingClientRect().top;
                pageDrag.layout=Array.from(container.querySelectorAll('.page-thumb')).map(el=>{const r=el.getBoundingClientRect();return{el,center:r.top-listTop+container.scrollTop+r.height/2};});
            }

            function movePageDrag(clientX, clientY, container) {
                if (!pageDrag.clone) return;

                pageDrag.motion.move(clientX,clientY);
                pageDrag.clientX=clientX;pageDrag.clientY=clientY;
                if(isOverRecycleBin(clientX,clientY,'page'))return;

                const thumbs = pageDrag.layout.map(item=>item.el);
                const containerRect = container.getBoundingClientRect();
                const scrollTop = container.scrollTop;

                const firstThumb = thumbs.find((t, i) => i !== pageDrag.index);
                if (!firstThumb) return;

                // Pages have different aspect ratios; use their actual layout,
                // not a fixed-height division which jumps on resized pages.
                let newDrop=0,nearest=Infinity;
                pageDrag.layout.forEach((item,i)=>{const distance=Math.abs(clientY-containerRect.top+scrollTop-item.center);if(distance<nearest){nearest=distance;newDrop=i;}});

                if (newDrop !== pageDrag.dropIndex) {
                    pageDrag.dropIndex = newDrop;
                    updatePageDropIndicators(container);
                }

                // Auto scroll
                if (clientY < containerRect.top + 50) container.scrollTop -= 6;
                if (clientY > containerRect.bottom - 50) container.scrollTop += 6;
            }

            function updatePageDropIndicators(container) {
                const thumbs = container.querySelectorAll('.page-thumb');
                const gap = parseFloat(getComputedStyle(container).rowGap)||8;

                thumbs.forEach((t, i) => {
                    if (i === pageDrag.index) return;

                    let offset = 0;
                    if (pageDrag.dropIndex < pageDrag.index) {
                        if (i >= pageDrag.dropIndex && i < pageDrag.index) offset = 1;
                    } else if (pageDrag.dropIndex > pageDrag.index) {
                        if (i > pageDrag.index && i <= pageDrag.dropIndex) offset = -1;
                    }

                    const thumbHeight = (pageDrag.el?.offsetHeight||t.offsetHeight) + gap;
                    t.style.transform = offset !== 0 ? `translateY(${offset * thumbHeight}px)` : '';
                });
            }

            async function finishPageDrag(container,cancelled=false) {
                clearTimeout(pageDrag.holdTimer);
                pageDrag.holdTimer = null;

                if (pageDrag.el && pageDrag.pressing) {
                    pageDrag.el.classList.remove('pressing');
                    pageDrag.pressing = false;
                }

                if (!pageDrag.active) return;

                const from = pageDrag.index;
                const to = pageDrag.dropIndex;
                const plan=pageDrag.motion?.release(cancelled),dropped=!!plan,dropX=pageDrag.clientX,dropY=pageDrag.clientY,id=pages[from]?.id;
                const didMove = !cancelled && !dropped && from !== to && from !== -1 && to !== -1;

                const cloneToRemove = pageDrag.clone;
                const elToClean = pageDrag.el;

                pageDrag.active = false;
                pageDrag.el = null;
                pageDrag.index = -1;
                pageDrag.dropIndex = -1;
                pageDrag.clone = null;
                pageDrag.marker?.remove();pageDrag.marker=null;
                pageDrag.suppressClickUntil=performance.now()+350;
                container.querySelectorAll('.page-thumb').forEach(t=>t.style.transform='');
                if(!dropped)elToClean?.classList.add('spring-return-slot');
                elToClean?.classList.remove('dragging-source');clearTrashHover();
                if(dropped){await TrashWorkbench.drop('page',id,cloneToRemove,dropX,dropY,plan);return;}

                const returnToShelf=()=>{
                    const destination=Array.from(container.querySelectorAll('.page-thumb')).find(el=>pages[parseInt(el.dataset.index)]?.id===id);
                    DragMotion.settle(cloneToRemove,destination);
                };
                if (didMove) {
                    let returning=false;
                    try{await movePage(from,to,()=>{returning=true;returnToShelf();});}
                    catch(error){if(!returning)returnToShelf();console.error('Could not reorder page:',error);showToast('Could not save the page order. Please try again.','error');}
                } else returnToShelf();
            }
        }

        function confirmDeletePage(index) {
            if (confirm('Are you sure you want to delete this page? It will be moved to the Recycle Bin.')) {
                deletePage(index);
            }
        }

        async function deletePage(index) {
            if(!currentNotebook||!pages[index])return;
            const pageId=pages[index].id,activeId=pages[currentPageIndex]?.id;
            await saveCurrentPage();
            index=pages.findIndex(p=>p.id===pageId);if(index<0)return;
            const page = pages[index];

            const trash=[...(currentNotebook.trash||[]),{
                id: page.id,
                deletedAt: new Date().toISOString(),
                originalIndex: index
            }];
            const remaining=pages.filter(p=>p.id!==pageId);
            if(!remaining.length){const blank=await API.post(`/api/notebooks/${currentNotebook.id}/pages`,{template:currentNotebook.template||'blank'});if(!blank?.id)throw Error('Could not create a replacement page. Your page is unchanged.');remaining.push(blank);}
            const saved=await API.put(`/api/notebooks/${currentNotebook.id}`,{...currentNotebook,pages:remaining.map(p=>p.id),trash});
            if(saved===null)throw Error('Could not move this page to Recycle Bin. Your page is unchanged.');
            // Commit UI only after recoverable metadata is on disk.
            pages=remaining;currentNotebook.pages=remaining.map(p=>p.id);currentNotebook.trash=trash;
            currentPageIndex=activeId===pageId?Math.min(index,pages.length-1):Math.max(0,pages.findIndex(p=>p.id===activeId));loadPage(currentPageIndex);
            renderPageList();
            showToast('Page moved to Recycle Bin', 'info');
        }

        const pageOrderWrites = new Map();
        async function movePage(fromIndex, toIndex, onReordered) {
            if (fromIndex === toIndex) return;
            if (!currentNotebook || !pages[fromIndex] || !pages[toIndex]) return;

            // Reordering keeps the same active document and its live ink. It
            // needs no page snapshot, thumbnail replay or awaited page save.
            // Start the return in this input task, even on slow disks/heavy ink.

            // Optimistic UI update
            const [page] = pages.splice(fromIndex, 1);
            pages.splice(toIndex, 0, page);

            // Update current notebook pages array
            const [pageId] = currentNotebook.pages.splice(fromIndex, 1);
            currentNotebook.pages.splice(toIndex, 0, pageId);

            // Update current page index if needed
            if (currentPageIndex === fromIndex) {
                currentPageIndex = toIndex;
            } else if (fromIndex < toIndex) {
                if (currentPageIndex > fromIndex && currentPageIndex <= toIndex) {
                    currentPageIndex--;
                }
            } else {
                if (currentPageIndex >= toIndex && currentPageIndex < fromIndex) {
                    currentPageIndex++;
                }
            }

            localStorage.setItem(`badnotes_lastPage_${currentNotebook.id}`,currentPageIndex);
            renderPageList({preservePreviews:true});
            onReordered?.(); // Begin the visual return before waiting on disk.

            // Persist only ordering, not a stale copy of name/trash/etc. Capture
            // the book and order now; successive flicks must reach disk in order
            // even if the user switches books while the first write is pending.
            const notebookId=currentNotebook.id,order=currentNotebook.pages.slice();
            const previous=pageOrderWrites.get(notebookId)||Promise.resolve();
            const write=previous.catch(()=>{}).then(async()=>{
                const result=await API.put(`/api/notebooks/${notebookId}`,{pages:order});
                if(result===null)throw Error('Could not save the page order.');
            });
            pageOrderWrites.set(notebookId,write);
            try{await write;}finally{if(pageOrderWrites.get(notebookId)===write)pageOrderWrites.delete(notebookId);}
        }

        async function addPage(insertIndex = -1) {
            // Save current page before creating new one
            await saveCurrentPage();

            const index = insertIndex === -1 ? currentPageIndex + 1 : insertIndex;

            const result = await API.post(`/api/notebooks/${currentNotebook.id}/pages`, {
                template: currentNotebook.template || 'blank',
                insertIndex: index
            });

            // Check for API failure
            if (!result || !result.id) {
                console.error('Failed to create page - API returned:', result);
                showToast('Failed to create page', 'error');
                return;
            }

            const previousLayout=new Map();document.querySelectorAll('#pageList .page-thumb').forEach(thumb=>{const pageId=pages[parseInt(thumb.dataset.index)]?.id,paper=thumb.querySelector('.page-paper');if(pageId&&paper)previousLayout.set(pageId,paper.getBoundingClientRect());});
            pages.splice(index, 0, result);
            currentNotebook.pages.splice(index, 0, result.id);

            // Switch to new page - this will reset strokes and images via loadPage
            currentPageIndex = index;
            loadPage(currentPageIndex);
            renderPageList();
            window.DragMotion?.animatePageAdded(result.id,previousLayout);

            // Save notebook structure to ensure order is persisted
            await API.put(`/api/notebooks/${currentNotebook.id}`, currentNotebook);

            showToast('Page added', 'success');
        }

        // Image cache for thumbnails
        const thumbImageCache = new Map();

        function generateThumbnail(thumbCanvas, page) {
            if (!thumbCanvas || !page) return;

            const thumbCtx = thumbCanvas.getContext('2d');

            // Use a fixed standard preview size (original default page dimensions)
            // This ensures previews always show the same "viewport" regardless of page size
            const PREVIEW_WIDTH = 800;
            const PREVIEW_HEIGHT = 1100;

            const scaleX = thumbCanvas.width / PREVIEW_WIDTH;
            const scaleY = thumbCanvas.height / PREVIEW_HEIGHT;
            const scale = Math.min(scaleX, scaleY);

            // Use theme-aware background color with OLED support
            const currentTheme = settings.theme || 'dark';
            let thumbBg;
            if (currentTheme === 'oled') {
                thumbBg = '#000000';
            } else if (currentTheme === 'light') {
                thumbBg = '#ffffff';
            } else {
                thumbBg = '#1a1a1a';
            }
            thumbCtx.fillStyle = thumbBg;
            thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
            thumbCtx.save();
            thumbCtx.scale(scale, scale);
            thumbCtx.lineCap = 'round';
            thumbCtx.lineJoin = 'round';

            // Clip to preview area (content outside won't show in thumbnail)
            thumbCtx.beginPath();
            thumbCtx.rect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
            thumbCtx.clip();

            // Render images first (behind strokes)
            for (const imgData of (page.images || [])) {
                // Use page ID + image ID as cache key to avoid cross-page conflicts
                const cacheKey = `${page.id}_${imgData.id}`;
                let img = thumbImageCache.get(cacheKey);
                if (!img) {
                    img = new Image();
                    // Store reference to re-render when loaded
                    const pageRef = page;
                    const canvasRef = thumbCanvas;
                    img.onload = () => {
                        // Only re-render if canvas is still in DOM
                        if (canvasRef && canvasRef.isConnected) {
                            generateThumbnail(canvasRef, pageRef);
                        }
                    };
                    img.src = imgData.dataUrl;
                    thumbImageCache.set(cacheKey, img);
                } else if (img.complete && img.naturalWidth > 0) {
                    thumbCtx.save();
                    thumbCtx.translate(imgData.x + imgData.width/2, imgData.y + imgData.height/2);
                    thumbCtx.rotate(imgData.rotation || 0);
                    thumbCtx.drawImage(img, -imgData.width/2, -imgData.height/2, imgData.width, imgData.height);
                    thumbCtx.restore();
                }
            }

            for (const stroke of (page.strokes || [])) {
                if (stroke.points.length < 2) continue;

                const points = stroke.points;
                // Use theme-aware color for strokes (white↔black swap in light mode)
                thumbCtx.strokeStyle = getThemedColor(stroke.color);
                thumbCtx.globalAlpha = stroke.tool === 'highlighter' ? 0.4 : 1;

                if (stroke.isShape) {
                    // Render shapes
                    thumbCtx.lineWidth = stroke.size;
                    thumbCtx.beginPath();
                    const start = points[0];
                    const end = points[points.length - 1];

                    switch (stroke.tool) {
                        case 'line':
                            thumbCtx.moveTo(start.x, start.y);
                            thumbCtx.lineTo(end.x, end.y);
                            break;
                        case 'rectangle':
                            thumbCtx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
                            break;
                        case 'circle':
                            const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
                            thumbCtx.arc(start.x, start.y, radius, 0, Math.PI * 2);
                            break;
                        case 'arrow':
                            const headLen = 15 * scale;
                            const angle = Math.atan2(end.y - start.y, end.x - start.x);
                            thumbCtx.moveTo(start.x, start.y);
                            thumbCtx.lineTo(end.x, end.y);
                            thumbCtx.lineTo(end.x - headLen * Math.cos(angle - Math.PI/6), end.y - headLen * Math.sin(angle - Math.PI/6));
                            thumbCtx.moveTo(end.x, end.y);
                            thumbCtx.lineTo(end.x - headLen * Math.cos(angle + Math.PI/6), end.y - headLen * Math.sin(angle + Math.PI/6));
                            break;
                    }
                    thumbCtx.stroke();
                } else if (points.length < 4) {
                    // Simple quadratic curve for short strokes
                    thumbCtx.lineWidth = stroke.size;
                    thumbCtx.beginPath();
                    thumbCtx.moveTo(points[0].x, points[0].y);
                    if (points.length === 2) {
                        thumbCtx.lineTo(points[1].x, points[1].y);
                    } else {
                        thumbCtx.quadraticCurveTo(points[1].x, points[1].y, points[2].x, points[2].y);
                    }
                    thumbCtx.stroke();
                } else {
                    // Smooth quadratic curves through midpoints
                    thumbCtx.lineWidth = stroke.size;
                    thumbCtx.beginPath();
                    thumbCtx.moveTo(points[0].x, points[0].y);

                    const firstMidX = (points[0].x + points[1].x) / 2;
                    const firstMidY = (points[0].y + points[1].y) / 2;
                    thumbCtx.lineTo(firstMidX, firstMidY);

                    for (let i = 1; i < points.length - 1; i++) {
                        const p1 = points[i];
                        const p2 = points[i + 1];
                        const midX = (p1.x + p2.x) / 2;
                        const midY = (p1.y + p2.y) / 2;
                        thumbCtx.quadraticCurveTo(p1.x, p1.y, midX, midY);
                    }

                    const last = points[points.length - 1];
                    const secondLast = points[points.length - 2];
                    thumbCtx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
                    thumbCtx.stroke();
                }
                thumbCtx.globalAlpha = 1;
            }

            // Render simple text fields (if any)
            if (page.textFields && page.textFields.length > 0) {
                thumbCtx.save();
                thumbCtx.textBaseline = 'top';
                for (const field of page.textFields) {
                    const fontSize = field.fontSize || 24;
                    const lineHeight = fontSize * 1.25;
                    const paddingX = 12;
                    const paddingY = 10;
                    const width = Math.max(field.width || 0, 80);
                    thumbCtx.font = `${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
                    thumbCtx.fillStyle = getThemedColor(field.color || '#ffffff');

                    const tokens = (field.text || '').match(/\n|[^\s]+|\s+/g) || [];
                    let lineText = '';
                    let lineWidth = 0;
                    const lines = [];

                    const pushLine = () => {
                        lines.push(lineText);
                        lineText = '';
                        lineWidth = 0;
                    };

                    for (const token of tokens) {
                        if (token === '\n') {
                            pushLine();
                            continue;
                        }
                        const tokenWidth = thumbCtx.measureText(token).width;
                        if (lineText && lineWidth + tokenWidth > width) {
                            pushLine();
                        }
                        lineText += token;
                        lineWidth += tokenWidth;
                    }
                    if (lineText || (field.text || '').endsWith('\n') || lines.length === 0) {
                        pushLine();
                    }

                    lines.forEach((line, idx) => {
                        const x = field.x + paddingX;
                        const y = field.y + paddingY + idx * lineHeight;
                        thumbCtx.fillText(line, x, y);
                    });
                }
                thumbCtx.restore();
            }

            thumbCtx.restore();
        }

        function showRecycleBin() {
            const modal = document.getElementById('recycleBinModal');
            const list = document.getElementById('recycleList');
            const trash = currentNotebook.trash || [];

            if (trash.length === 0) {
                list.innerHTML = '<div class="empty-state">Recycle Bin is empty</div>';
            } else {
                list.innerHTML = trash.map((item, i) => `
                    <div class="recycle-item">
                        <div class="recycle-info">
                            <h4>Page ${item.originalIndex + 1}</h4>
                            <p>Deleted: ${new Date(item.deletedAt).toLocaleString()}</p>
                        </div>
                        <div class="recycle-actions">
                            <button class="btn btn-sm btn-primary" onclick="restorePage('${item.id}')">Restore</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteForever('${item.id}')">Delete</button>
                        </div>
                    </div>
                `).join('');
            }

            modal.classList.add('show');
        }

        function hideRecycleBin() {
            hideModal('recycleBinModal');
        }

        async function restorePage(pageId) {
            const trash = currentNotebook.trash || [];
            const itemIndex = trash.findIndex(t => t.id === pageId);
            if (itemIndex === -1) return;

            const item = trash[itemIndex];

            // Fetch the page content (it still exists on server)
            // We just need to add it back to the pages list
            const pageRes = await fetch(`/api/notebooks/${currentNotebook.id}/pages/${pageId}`);
            if (!pageRes.ok) {
                showToast('Error restoring page', 'error');
                return;
            }
            const page = await pageRes.json();

            // Remove from trash
            currentNotebook.trash.splice(itemIndex, 1);

            // Add back to pages (try to restore to original index, or append)
            let restoreIndex = item.originalIndex;
            if (restoreIndex > pages.length) restoreIndex = pages.length;

            pages.splice(restoreIndex, 0, page);
            currentNotebook.pages.splice(restoreIndex, 0, page.id);

            // Save notebook structure
            await API.put(`/api/notebooks/${currentNotebook.id}`, currentNotebook);

            // Refresh UI
            showRecycleBin(); // Refresh list
            renderPageList();
            showToast('Page restored', 'success');

            // If we restored to current view or it's the only page
            if (pages.length === 1 || currentPageIndex === restoreIndex) {
                currentPageIndex = restoreIndex;
                loadPage(currentPageIndex);
            }
        }

        async function deleteForever(pageId) {
            if (!confirm('Permanently delete this page? This cannot be undone.')) return;

            const trash = currentNotebook.trash || [];
            const itemIndex = trash.findIndex(t => t.id === pageId);
            if (itemIndex === -1) return;

            // Remove from trash list
            currentNotebook.trash.splice(itemIndex, 1);

            // Save notebook structure first
            await API.put(`/api/notebooks/${currentNotebook.id}`, currentNotebook);

            // Refresh UI
            showRecycleBin();
            showToast('Page permanently deleted', 'info');
        }

        async function emptyRecycleBin() {
            if (!confirm('Empty Recycle Bin? All pages in it will be permanently lost.')) return;

            currentNotebook.trash = [];
            await API.put(`/api/notebooks/${currentNotebook.id}`, currentNotebook);

            showRecycleBin();
            showToast('Recycle Bin emptied', 'info');
        }

        function updateCanvasDimensions(width, height) {
            if (!width || !height || width <= 0 || height <= 0) {
                console.warn('Invalid canvas dimensions:', width, height);
                return;
            }

            // Update logical page size
            baseWidth = width;
            baseHeight = height;

            // In Camera Model, the canvas buffer size is handled by updateBufferSize() in core.
            // We do NOT resize the canvas here based on page size.
            // The canvas is always viewport-sized.

            // Just trigger a redraw to show the new page boundaries
            if (typeof redrawCanvas === 'function') {
                redrawCanvas();
            }
        }

        function loadPage(index) {
            if (!pages[index]) return;
            // End all visual work owned by the previous page before swapping
            // its model. The new scene is painted atomically below, not in a
            // later frame after stale camera/selection overlays have run.
            window.HistoryMotion?.finish();window.PaintFill?.cancel();
            window.cancelCanvasInertia?.();window.ViewLimits?.cancel();
            if(typeof clearLassoSelection==='function')clearLassoSelection();
            if(typeof deselectImage==='function')deselectImage();
            currentStroke=null;isDrawing=false;drawingPointerId=null;
            isPageResizing=false;isResizeReady=false;window.tempResize=null;
            clearActiveCanvas();

            // Update current page index and save to localStorage
            currentPageIndex = index;
            if (currentNotebook) {
                localStorage.setItem(`badnotes_lastPage_${currentNotebook.id}`, index);
            }
            const titlebarContext = document.getElementById('windowTitlebarContext');
            if (titlebarContext) {
                const notebookName = currentNotebook?.name || 'Notebook';
                titlebarContext.textContent = `${notebookName}  ·  ${index + 1} / ${pages.length}`;
            }

            // Restore page dimensions
            gridShiftX=pages[index].gridShiftX||0;gridShiftY=pages[index].gridShiftY||0;
            updateCanvasDimensions(
                pages[index].width || 800,
                pages[index].height || 1100
            );

            // Lightweight copy to avoid blocking on large pages
            strokes = (pages[index].strokes || []).map(s => ({ ...s, points: s.points ? s.points.slice() : [] }));
            images = (pages[index].images || []).map(img => ({ ...img }));
            if (typeof SimpleTextField !== 'undefined') {
                SimpleTextField.setTextFields(pages[index].textFields || []);
            }
            if (typeof HandwrittenTextField !== 'undefined') {
                HandwrittenTextField.setTextFields(pages[index].handwrittenTextFields || []);
            }

            // Invalidate stroke cache when page changes
            if (typeof invalidateStrokeCache === 'function') invalidateStrokeCache();

            // Load page-specific template, fallback to notebook template, then to 'blank'
            currentPageTemplate = pages[index].template || currentNotebook?.template || 'blank';
            historyStack = [];
            redoStack = [];
            if(window.ViewLimits){const p=ViewLimits.pan(panX,panY);panX=p.x;panY=p.y;}
            redrawCanvas(true);
        }

        function updateCurrentThumbnail() {
            const thumb = document.querySelector(`.page-thumb[data-index="${currentPageIndex}"] canvas`);
            if (thumb && pages[currentPageIndex]) {
                generateThumbnail(thumb, pages[currentPageIndex]);
            }
        }

        async function saveCurrentPage() {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = null;
            if (autoSaveIdle !== null) cancelIdleCallback(autoSaveIdle);
            autoSaveIdle = null;
            if (!currentNotebook || !pages[currentPageIndex]) return;

            // Deep copy using structuredClone for better performance
            pages[currentPageIndex].strokes = structuredClone(strokes.map(stroke => {
                const { _bezierPath, _fillPath, _bezierCP, ...data } = stroke;
                return data;
            }));
            pages[currentPageIndex].images = structuredClone(images);
            if (typeof SimpleTextField !== 'undefined') {
                pages[currentPageIndex].textFields = structuredClone(SimpleTextField.getTextFields());
            }
            if (typeof HandwrittenTextField !== 'undefined') {
                // Strip non-serializable cache properties (cacheCanvas, cursorMap, etc.)
                const hwFields = HandwrittenTextField.getTextFields().map(f => {
                    const { cacheCanvas, cursorMap, lastHash, cachePadding, ...serializable } = f;
                    return serializable;
                });
                pages[currentPageIndex].handwrittenTextFields = structuredClone(hwFields);
            }
            pages[currentPageIndex].template = currentPageTemplate;
            pages[currentPageIndex].width=baseWidth;pages[currentPageIndex].height=baseHeight;
            pages[currentPageIndex].gridShiftX=gridShiftX;pages[currentPageIndex].gridShiftY=gridShiftY;
            pages[currentPageIndex].modifiedAt = new Date().toISOString();

            // Update thumbnail immediately
            updateCurrentThumbnail();

            const result = await API.put(
                `/api/notebooks/${currentNotebook.id}/pages/${pages[currentPageIndex].id}`,
                pages[currentPageIndex]
            );

            if (result===null) {
                console.error('Failed to save page');
                throw Error('Could not save this page. Your window and notes have been kept open.');
            }
        }

        // Auto-save on any change with debounce
        let autoSaveTimeout = null;
        let autoSaveIdle = null;
        function triggerAutoSave() {
            if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
            if (autoSaveIdle !== null) cancelIdleCallback(autoSaveIdle);
            autoSaveIdle = null;
            const whenQuiet = () => {
                if (isDrawing || isPointerPanning || isPinching || isPanning || gesturePreviewActive || isWheelZooming || window.DragMotion?.shelfBusy) {
                    autoSaveTimeout = setTimeout(whenQuiet, 100);
                    return;
                }
                autoSaveIdle = requestIdleCallback(() => {
                    autoSaveIdle = null;
                    if (isDrawing || isPointerPanning || isPinching || isPanning || gesturePreviewActive || isWheelZooming || window.DragMotion?.shelfBusy) {
                        autoSaveTimeout = setTimeout(whenQuiet, 100);
                    } else {
                        saveCurrentPage().catch(error => console.error('Autosave failed', error));
                    }
                });
            };
            autoSaveTimeout = setTimeout(whenQuiet, 300);
        }

        // Note: The primary addPage function is defined earlier in the file (line ~882)
        // This duplicate was removed to prevent override issues
