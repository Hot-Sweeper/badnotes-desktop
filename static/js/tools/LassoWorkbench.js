/** Selection controls and grouped edits, layered onto the existing lasso API. */
window.LassoWorkbench=(()=>{
    const state={rectangle:false,includeInk:true,includeImages:true};let menu,options,clipboard=null,frame=0,pending=null,transaction=null,preview=null,preparing=false,dropPending=false;
    const clone=value=>structuredClone(value);
    const selectionColors=()=>getSelectionThemePalette();
    const snapshots=()=>({strokes:lassoSelection.strokes.filter(i=>strokes[i]).map(index=>({index,item:clone(strokes[index])})),images:lassoSelection.images.map(id=>{const index=images.findIndex(img=>img.id===id);return{index,item:index>=0?clone(images[index]):null};}).filter(record=>record.item)});
    function record(before,after){if(JSON.stringify(before)===JSON.stringify(after))return;historyStack.push({type:'lasso-edit',before,after});redoStack=[];}
    function restore(action,which){
        const state=action[which],strokeIds=new Set([...action.before.strokes,...action.after.strokes].map(r=>r.item.id)),imageIds=new Set([...action.before.images,...action.after.images].map(r=>r.item.id));
        strokes=strokes.filter(s=>!strokeIds.has(s.id));images=images.filter(img=>!imageIds.has(img.id));
        for(const record of [...state.strokes].sort((a,b)=>a.index-b.index))strokes.splice(Math.min(record.index,strokes.length),0,clone(record.item));
        for(const record of [...state.images].sort((a,b)=>a.index-b.index))images.splice(Math.min(record.index,images.length),0,clone(record.item));
        clearLassoSelection();invalidateStrokeCache();
    }
    function ensure(){
        if(menu)return;menu=document.createElement('div');menu.id='lassoActionMenu';menu.hidden=true;menu.setAttribute('role','toolbar');menu.setAttribute('aria-label','Selection actions');
        const icons={Copy:'<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 4H6a2 2 0 0 0-2 2v9"/>',Cut:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20 4"/>',Paste:'<path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="6" rx="2"/>',Duplicate:'<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M15 3H6a3 3 0 0 0-3 3v9M11 14h7M14.5 10.5v7"/>',Color:'<path d="M12 3a9 9 0 0 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.1-2.5H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7" cy="10" r=".8"/><circle cx="10" cy="6.5" r=".8"/><circle cx="15" cy="7" r=".8"/>',Delete:'<path d="M4 6h16M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7"/>',Done:'<path d="m5 12 4 4L19 6"/>'};
        menu.innerHTML='<span class="lasso-count" aria-live="polite"></span>'+Object.entries(icons).map(([name,path],i)=>`<button type="button" tabindex="${i===0?0:-1}" data-lasso-action="${name.toLowerCase()}" aria-label="${name} selection"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg><span>${name}</span></button>`).join('');
        document.body.appendChild(menu);menu.addEventListener('pointerdown',e=>e.stopPropagation());menu.addEventListener('click',e=>{const button=e.target.closest('[data-lasso-action]');if(button)action(button.dataset.lassoAction);});
        menu.addEventListener('focusin',e=>{const button=e.target.closest('button');if(button)menu.querySelectorAll('button').forEach(b=>b.tabIndex=b===button?0:-1);});
        menu.querySelector('[data-lasso-action="color"]').title='Apply the current palette color';
        for(const name of['copy','cut','paste'])menu.querySelector(`[data-lasso-action="${name}"]`).title='Selection clipboard within BadNotes';
        menu.addEventListener('keydown',e=>{
            if(e.key==='Enter'||e.key===' '){e.stopPropagation();return;}
            if(e.key==='Escape'){e.preventDefault();e.stopPropagation();action('done');canvas.tabIndex=0;canvas.focus({preventScroll:true});return;}
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();
            const buttons=[...menu.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
            buttons.forEach((b,n)=>b.tabIndex=n===next?0:-1);buttons[next].focus({preventScroll:true});
        });
        options=document.createElement('div');options.id='lassoOptions';options.hidden=true;options.innerHTML='<strong>Lasso selection</strong><div><button type="button" data-lasso-type="freehand">Freehand</button><button type="button" data-lasso-type="rectangle">Rectangle</button></div><label><input type="checkbox" data-lasso-filter="includeInk" checked> Ink and shapes</label><label><input type="checkbox" data-lasso-filter="includeImages" checked> Images</label><p>Circle strokes, then drag inside the selection.<br>Corner dots resize · outer corner arrows rotate.<br>Ctrl / Shift adds to selection · Esc deselects.</p>';document.body.appendChild(options);
        options.onclick=e=>{const button=e.target.closest('[data-lasso-type]');if(button){state.rectangle=button.dataset.lassoType==='rectangle';options.querySelectorAll('[data-lasso-type]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.lassoType==='rectangle')===state.rectangle)));}};
        options.onchange=e=>{if(e.target.dataset.lassoFilter)state[e.target.dataset.lassoFilter]=e.target.checked;};
        options.querySelector('[data-lasso-type="freehand"]').setAttribute('aria-pressed','true');
    }
    function sync(){
        ensure();const active=hasLassoSelection();menu.hidden=!active||lassoSelection.isDragging||lassoSelection.isResizing||lassoSelection.isRotating||lassoMode;if(!active){if(currentTool==='lasso')canvas.style.cursor='crosshair';return;}
        if(menu.hidden)return;
        const bounds=lassoSelection.bounds;if(!bounds)return;const rect=canvas.getBoundingClientRect();
        const count=lassoSelection.strokes.length+lassoSelection.images.length,chip=menu.querySelector('.lasso-count'),label=count+' selected';if(chip.textContent!==label)chip.textContent=label;
        menu.querySelector('[data-lasso-action="paste"]').disabled=!clipboard;
        const width=menu.offsetWidth,left=rect.left+panX+(bounds.x+bounds.width/2)*zoom-width/2;
        const above=rect.top+panY+bounds.y*zoom-menu.offsetHeight-52;
        const top=above<28?rect.top+panY+(bounds.y+bounds.height)*zoom+52:above;
        menu.style.left=Math.max(16,Math.min(innerWidth-width-16,left))+'px';menu.style.top=Math.max(28,Math.min(innerHeight-70,top))+'px';
    }
    function selectInserted(strokeIds,imageIds){lassoSelection.strokes=strokes.map((s,i)=>strokeIds.has(s.id)?i:-1).filter(i=>i>=0);lassoSelection.images=[...imageIds];lassoSelection.originalStrokes=lassoSelection.strokes.map(i=>clone(strokes[i]));lassoSelection.originalImages=images.filter(img=>imageIds.has(img.id)).map(clone);calculateSelectionBounds();sync();}
    function action(type){
        if(isDrawing||lassoMode)return;
        if(type==='done'){const focused=menu?.contains(document.activeElement);clearLassoSelection();redrawCanvas();if(focused){canvas.tabIndex=0;canvas.focus({preventScroll:true});}return;}
        const before=snapshots();
        if(type==='copy'||type==='cut'){clipboard=clone(before);if(type==='copy'){sync();showToast('Selection copied','success');return;}}
        if(type==='delete'||type==='cut'){
            const ids=new Set(before.strokes.map(r=>r.item.id)),imageIds=new Set(before.images.map(r=>r.item.id));strokes=strokes.filter(s=>!ids.has(s.id));images=images.filter(img=>!imageIds.has(img.id));record(before,{strokes:[],images:[]});clearLassoSelection();
        }else if(type==='duplicate'||type==='paste'){
            const data=type==='paste'?clipboard:before;if(!data)return;const newStrokes=[],newImages=[];
            for(const source of data.strokes){const item=clone(source.item);item.id=Date.now()+Math.random();item.points.forEach(p=>{p.x+=24/zoom;p.y+=24/zoom;});for(const key of['bounds','_bezierCP','_bezierPath','_fillPath'])delete item[key];newStrokes.push({index:strokes.length,item:clone(item)});strokes.push(item);}
            for(const source of data.images){const item=clone(source.item);item.id='lasso-'+Date.now()+'-'+Math.random();item.x+=24/zoom;item.y+=24/zoom;newImages.push({index:images.length,item:clone(item)});images.push(item);}
            record({strokes:[],images:[]},{strokes:newStrokes,images:newImages});selectInserted(new Set(newStrokes.map(r=>r.item.id)),new Set(newImages.map(r=>r.item.id)));
        }else if(type==='color'){for(const index of lassoSelection.strokes)strokes[index].color=currentColor;lassoSelection.originalStrokes=lassoSelection.strokes.map(i=>clone(strokes[i]));record(before,snapshots());showToast('Selection recolored to the active palette color','success');}
        invalidateStrokeCache();redrawCanvas(true);triggerAutoSave();sync();
    }
    const originalDown=handleLassoPointerDown,originalMove=handleLassoPointerMove,originalUp=handleLassoPointerUp,originalStart=startLasso,originalEnd=endLasso;
    const originalPath=drawLassoPath,originalClear=clearLassoSelection;
    drawLassoPath=function(context){
        if(preparing||!lassoMode&&currentTool!=='ai-select')return;
        // Keep region data for additive selection/AI, but only show the live
        // lasso gesture. A committed ordinary selection has one clean box.
        if(currentTool==='ai-select'){originalPath(context);return;}
        if(lassoPath.length<2)return;
        context.save();context.strokeStyle=selectionColors().accent;context.lineWidth=2/zoom;context.setLineDash([8/zoom,4/zoom]);context.lineCap=context.lineJoin='round';
        context.beginPath();lassoPath.forEach((point,i)=>{i?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y);});context.stroke();context.restore();
    };
    drawLassoSelectionHandles=function(context){
        if(preparing||!hasLassoSelection()||!lassoSelection.bounds)return;
        const handles=getLassoHandles(),colors=selectionColors(),unit=1/zoom;if(!handles)return;
        context.save();context.strokeStyle=getSelectionStroke(context,handles.nw.x,handles.nw.y,handles.se.x,handles.se.y);context.fillStyle=colors.surface;context.lineWidth=1.5*unit;context.setLineDash([5*unit,3*unit]);context.lineJoin='round';
        context.beginPath();['nw','ne','se','sw'].forEach((name,i)=>{const p=handles[name];i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y);});context.closePath();context.stroke();context.setLineDash([]);
        for(const corner of ['nw','ne','se','sw']){
            const point=handles[corner],rotation=handles['rotate'+corner.toUpperCase()];
            context.globalAlpha=.35;context.beginPath();context.moveTo(point.x,point.y);context.lineTo(rotation.x,rotation.y);context.stroke();context.globalAlpha=1;
            context.beginPath();context.arc(point.x,point.y,5*unit,0,Math.PI*2);context.fill();context.stroke();
            context.save();context.translate(rotation.x,rotation.y);context.beginPath();context.arc(0,0,9*unit,0,Math.PI*2);context.fill();context.stroke();
            context.lineCap='round';const radius=4*unit,end=Math.PI*.6;context.beginPath();context.arc(0,0,radius,-Math.PI*.8,end);context.stroke();
            const ax=radius*Math.cos(end),ay=radius*Math.sin(end),tx=-Math.sin(end),ty=Math.cos(end);
            context.beginPath();context.moveTo(ax-tx*3*unit-ty*2*unit,ay-ty*3*unit+tx*2*unit);context.lineTo(ax,ay);context.lineTo(ax-tx*3*unit+ty*2*unit,ay-ty*3*unit-tx*2*unit);context.stroke();context.restore();
        }context.restore();
    };
    clearLassoSelection=function(){const wasPreview=!!preview;preview=null;dropPending=false;if(currentTool!=='ai-select')multiLassoSelections=[];const result=originalClear();if(wasPreview)invalidateStrokeCache(false);return result;};
    function prepareBackground(){
        const allStrokes=strokes,allImages=images,indices=new Set(lassoSelection.strokes),ids=new Set(lassoSelection.images);
        preparing=true;
        try{strokes=strokes.filter((s,i)=>!indices.has(i));images=images.filter(img=>!ids.has(img.id));invalidateStrokeCache(false);_redrawCanvas();}
        finally{strokes=allStrokes;images=allImages;preparing=false;}
        preview.camera=[panX,panY,zoom,canvas.width,canvas.height,settings.theme,settings.accentTheme].join(':');
    }
    function paintDrag(){
        if(preparing||!preview||(!lassoSelection.isDragging&&!dropPending))return false;
        const camera=[panX,panY,zoom,canvas.width,canvas.height,settings.theme,settings.accentTheme].join(':');
        if(camera!==preview.camera)prepareBackground();
        activeCtx.setTransform(1,0,0,1,0,0);activeCtx.clearRect(0,0,activeCanvas.width,activeCanvas.height);
        if(dropPending)return true;
        activeCtx.setTransform(zoom*baseDPR,0,0,zoom*baseDPR,panX*baseDPR,panY*baseDPR);
        activeCtx.save();activeCtx.translate(preview.dx,preview.dy);
        for(const index of lassoSelection.strokes)drawStrokeToContext(strokes[index],activeCtx);
        for(const id of lassoSelection.images){const item=images.find(img=>img.id===id),img=window.imageCache?.get(id);if(!item||!img?.complete||!img.naturalWidth)continue;activeCtx.save();activeCtx.translate(item.x+item.width/2,item.y+item.height/2);activeCtx.rotate(item.rotation||0);activeCtx.globalAlpha=item.opacity??1;activeCtx.filter=isDarkMode&&item.inverted?'invert(1)':'none';drawFilteredBitmap(activeCtx,img,-item.width/2,-item.height/2,item.width,item.height);activeCtx.restore();}
        activeCtx.restore();drawLassoPath(activeCtx);drawLassoSelectionHandles(activeCtx);return true;
    }
    function transformOutline(map){
        const start=lassoSelection.dragStart;if(!start?.outline)return;
        lassoSelection.path=start.outline.map(map);
        multiLassoSelections=start.regions.map(region=>{const path=region.path.map(map);return{...region,path,bounds:calculatePathBounds(path)};});
    }
    function commitTranslation(){
        if(!preview||!lassoSelection.isDragging)return;
        const{dx,dy}=preview;
        for(const index of lassoSelection.strokes){const item=strokes[index];if(!item)continue;for(const p of item.points){p.x+=dx;p.y+=dy;}for(const key of['bounds','_bezierCP','_bezierPath','_fillPath'])delete item[key];}
        for(const id of lassoSelection.images){const item=images.find(img=>img.id===id);if(item){item.x+=dx;item.y+=dy;}}
        transformOutline(p=>({x:p.x+dx,y:p.y+dy}));preview.dx=preview.dy=0;
    }
    startLasso=function(e){originalStart(e);isCtrlHeld=!!(e.ctrlKey||e.metaKey||e.shiftKey);sync();};
    endLasso=function(){originalEnd();sync();};
    handleLassoPointerDown=function(e,x,y){if(dropPending)return true;const result=originalDown(e,x,y);if(result&&lassoSelection.dragStart){transaction=snapshots();lassoSelection.pointerId=e.pointerId;lassoSelection.dragStart.outline=structuredClone(lassoSelection.path||[]);lassoSelection.dragStart.regions=structuredClone(multiLassoSelections);if(lassoSelection.isDragging){preview={dx:0,dy:0,sampler:DragMotion.tracker(e.clientX,e.clientY)};prepareBackground();paintDrag();}sync();}return result;};
    function flush(){if(frame)cancelAnimationFrame(frame);frame=0;if(!pending)return;const p=pending;pending=null;
        if(preview&&lassoSelection.isDragging){const start=lassoSelection.dragStart,b=lassoSelection.bounds;preview.dx=p.x-start.x;preview.dy=p.y-start.y;Object.assign(b,{x:start.bounds.x+preview.dx,y:start.bounds.y+preview.dy,centerX:start.bounds.centerX+preview.dx,centerY:start.bounds.centerY+preview.dy});DragMotion.hint(p.e.clientX,p.e.clientY,preview.sampler);}
        else{originalMove(p.e,p.x,p.y);const start=lassoSelection.dragStart;if(start){const cx=start.bounds.centerX,cy=start.bounds.centerY;if(lassoSelection.isRotating){const angle=lassoSelection.bounds.rotation-start.bounds.rotation,c=Math.cos(angle),s=Math.sin(angle);transformOutline(p=>({x:cx+(p.x-cx)*c-(p.y-cy)*s,y:cy+(p.x-cx)*s+(p.y-cy)*c}));}else if(lassoSelection.isResizing){const scale=lassoSelection.bounds.width/start.bounds.width;transformOutline(p=>({x:cx+(p.x-cx)*scale,y:cy+(p.y-cy)*scale}));}}}
        redrawCanvas(true);sync();}
    handleLassoPointerMove=function(e,x,y){if(!lassoSelection.dragStart||e.pointerId!==lassoSelection.pointerId){if(!isDrawing&&(currentTool==='lasso'||hasLassoSelection())){const handle=getLassoHandleAt(x,y,e.pointerType);canvas.style.cursor=handle?.startsWith('rotate')?'grab':handle?(handle==='nw'||handle==='se'?'nwse-resize':'nesw-resize'):pointInSelectionBounds(x,y)?'grab':currentTool==='lasso'?'crosshair':'default';}return false;}canvas.style.cursor=lassoSelection.isDragging?'grabbing':'crosshair';preview?.sampler.move(e.clientX,e.clientY);pending={e,x,y};if(!frame)frame=requestAnimationFrame(flush);return true;};
    handleLassoPointerUp=function(e){
        if(e&&lassoSelection.dragStart&&e.pointerId!==lassoSelection.pointerId)return false;
        if(lassoSelection.dragStart&&e)pending={e,x:getCanvasPoint(e).x,y:getCanvasPoint(e).y};flush();const oldHistoryLength=historyStack.length,before=transaction;
        const plan=before&&lassoSelection.isDragging&&e?DragMotion.resolve(e.clientX,e.clientY,preview?.sampler):null;
        commitTranslation();
        if(before&&plan){
            const bookId=currentNotebook?.id,pageId=pages[currentPageIndex]?.id;
            const visible=snapshots();transaction=null;dropPending=true;lassoSelection.isDragging=false;lassoSelection.dragStart=null;paintDrag();sync();
            TrashWorkbench.dropSelection(before,visible,e,()=>{
                selectInserted(new Set(before.strokes.map(r=>r.item.id)),new Set(before.images.map(r=>r.item.id)));
                action('delete');historyStack.pop();record(before,{strokes:[],images:[]});
            },plan).then(ok=>{if(!ok&&currentNotebook?.id===bookId&&pages[currentPageIndex]?.id===pageId)restore({before,after:visible},'before');}).finally(()=>{dropPending=false;preview=null;invalidateStrokeCache(false);redrawCanvas(true);sync();});clearTrashHover();return true;
        }
        preview=null;const result=originalUp(e);if(before&&result){historyStack.splice(oldHistoryLength);record(before,snapshots());transaction=null;}redrawCanvas(true);sync();return result;
    };
    function cancel(e){
        if(e&&lassoSelection.pointerId!==e.pointerId)return;
        if(frame)cancelAnimationFrame(frame);frame=0;pending=null;
        if(transaction){restore({before:transaction,after:snapshots()},'before');transaction=null;}
        lassoMode=false;lassoPath=[];clearLassoSelection();redrawCanvas();sync();
    }
    deleteSelectedItems=()=>action('delete');
    window.recolorLassoSelection=color=>{if(!hasLassoSelection())return false;const before=snapshots();for(const i of lassoSelection.strokes)strokes[i].color=color;lassoSelection.originalStrokes=lassoSelection.strokes.map(i=>clone(strokes[i]));record(before,snapshots());invalidateStrokeCache(false);redrawCanvas();triggerAutoSave();sync();return true;};
    document.addEventListener('click',e=>{const tool=e.target.closest('[data-tool]');if(!tool)return;if(tool.dataset.tool==='lasso'){ensure();const again=currentTool==='lasso'&&tool.dataset.lassoWasActive==='true';currentTool='lasso';options.hidden=!again;tool.dataset.lassoWasActive='true';}else{document.querySelector('[data-tool="lasso"]')?.removeAttribute('data-lasso-was-active');if(options)options.hidden=true;clearLassoSelection();redrawCanvas();}sync();});
    document.addEventListener('pointerdown',e=>{const button=e.target.closest('[data-tool="lasso"]');if(button)button.dataset.lassoWasActive=String(currentTool==='lasso');});
    document.addEventListener('keydown',e=>{
        if(e.target.closest('input,textarea,[contenteditable="true"]'))return;
        if(e.key.toLowerCase()==='l'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!selectedImage){currentTool='lasso';document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool==='lasso'));updateCanvasToolCursor();e.preventDefault();}
        if(!(e.ctrlKey||e.metaKey))return;const key=e.key.toLowerCase();if(['c','x','d'].includes(key)&&hasLassoSelection()){e.preventDefault();action({c:'copy',x:'cut',d:'duplicate'}[key]);}else if(key==='v'&&clipboard){e.preventDefault();action('paste');}
    });
    document.addEventListener('pointerdown',e=>{if(options&&!options.hidden&&!options.contains(e.target)&&!e.target.closest('[data-tool="lasso"]'))options.hidden=true;});
    window.addEventListener('resize',sync);window.addEventListener('toolbarRendered',sync);
    document.addEventListener('pointerup',e=>{if(e.target!==canvas&&e.pointerId===lassoSelection.pointerId){if(lassoMode)endLasso();else if(lassoSelection.dragStart)handleLassoPointerUp(e);}});
    Object.assign(state,{sync,action,restore,cancel,paintDrag});Object.defineProperty(state,'isPreviewDragging',{get:()=>!!preview&&lassoSelection.isDragging});return state;
})();
