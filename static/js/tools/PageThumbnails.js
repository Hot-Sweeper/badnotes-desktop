/** Native-resolution page previews. Work is visible-only and time-sliced;
 * camera changes never invalidate a page-local preview. */
window.PageThumbnails=(()=>{
    const records=new Map(),imageCache=new Map();let observer,resizeObserver,queued=false,liveFrame=0,resizeFrame=0;
    const ratio=()=>Math.max(2,Math.min(3,devicePixelRatio||1));
    function cancelJob(record){
        const job=record.job;record.job=null;
        if(job)for(const surface of [job.work,job.content,job.ink])surface.width=surface.height=0;
    }
    function current(page){return page===pages[currentPageIndex]&&!!currentNotebook;}
    function model(page){
        if(!current(page))return page;
        const resize=isPageResizing&&window.tempResize,shiftX=resize?.shiftX||0,shiftY=resize?.shiftY||0;
        return{...page,width:resize?.w??baseWidth,height:resize?.h??baseHeight,gridShiftX:gridShiftX+shiftX,gridShiftY:gridShiftY+shiftY,
            previewShiftX:shiftX,previewShiftY:shiftY,template:currentPageTemplate,strokes,images,
            textFields:SimpleTextField?.getTextFields()||[],handwrittenTextFields:HandwrittenTextField?.getTextFields()||[]};
    }
    function dimensions(record,page){
        const width=Math.max(1,page.width||800),height=Math.max(1,page.height||1100);
        record.paper.style.aspectRatio=`${width} / ${height}`;
        // Entrance/pickup transforms must not lower the persistent backing
        // resolution. Measure layout pixels, not the animated screen bounds.
        const cssWidth=record.paper.clientWidth||200;
        const pw=Math.max(1,Math.round(cssWidth*ratio())),ph=Math.max(1,Math.min(4096,Math.round(pw*height/width)));
        return{width,height,pw,ph,scale:pw/width};
    }
    function image(ctx,item,page,record){
        const src=item.dataUrl||item.src;if(!src)return;
        let entry=imageCache.get(item.id);
        if(!entry||entry.src!==src){
            const shared=window.imageCache?.get(item.id),img=shared?.complete&&shared.naturalWidth&&shared.src===src?shared:new Image();
            entry={src,img};imageCache.set(item.id,entry);
            if(img!==shared){img.onload=()=>dirty(page.id);img.src=src;}
        }
        if(!entry.img.complete||!entry.img.naturalWidth)return;
        // Use the same radians and theme-aware inversion as the canvas. A
        // preview is a view of the document, not a separate image treatment.
        ctx.save();ctx.translate(item.x+item.width/2,item.y+item.height/2);ctx.rotate(item.rotation||0);ctx.globalAlpha=item.opacity??1;
        ctx.filter=isDarkMode&&item.inverted?'invert(1)':'none';
        drawFilteredBitmap(ctx,entry.img,-item.width/2,-item.height/2,item.width,item.height);ctx.restore();
    }
    function background(ctx,page,d){
        const palette=getCanvasThemePalette();
        // Match the real page exactly. Contrast comes from the shelf/edge,
        // never from brightening or recoloring the document preview.
        ctx.fillStyle=palette.paper;ctx.fillRect(0,0,d.width,d.height);
        const template=page.template||currentNotebook?.template||'blank';const sx=page.gridShiftX||0,sy=page.gridShiftY||0;
        const mod=(n,s)=>(n%s+s)%s;
        ctx.strokeStyle=palette.grid;ctx.lineWidth=1;
        if(template==='grid'||template==='lined'){
            const spacing=template==='lined'?32:24;ctx.beginPath();
            if(template==='grid')for(let x=mod(sx,spacing);x<d.width;x+=spacing){ctx.moveTo(x,0);ctx.lineTo(x,d.height);}
            for(let y=mod(sy+(template==='lined'?80:0),spacing);y<d.height;y+=spacing){ctx.moveTo(0,y);ctx.lineTo(d.width,y);}ctx.stroke();
        }else if(template==='dotted'||template==='dots'){
            // Bound work for enormous custom pages; regular pages retain every dot.
            const stride=Math.max(1,Math.ceil(Math.sqrt(d.width*d.height/576/45000))),spacing=24*stride;
            ctx.fillStyle=palette.dots;ctx.beginPath();
            for(let x=mod(sx,spacing)||spacing;x<d.width;x+=spacing)for(let y=mod(sy,spacing)||spacing;y<d.height;y+=spacing){ctx.moveTo(x+1.5,y);ctx.arc(x,y,1.5,0,Math.PI*2);}ctx.fill();
        }
    }
    function start(record){
        const page=model(record.page),d=dimensions(record,page),work=document.createElement('canvas');work.width=d.pw;work.height=d.ph;
        const paperCtx=work.getContext('2d');paperCtx.scale(d.scale,d.scale);background(paperCtx,page,d);
        const content=document.createElement('canvas');content.width=d.pw;content.height=d.ph;
        const ctx=content.getContext('2d');ctx.scale(d.scale,d.scale);ctx.translate(page.previewShiftX||0,page.previewShiftY||0);
        // Ink remains an independent layer so pixel erasing cannot erase paper/grid.
        const ink=document.createElement('canvas');ink.width=d.pw;ink.height=d.ph;const inkCtx=ink.getContext('2d');inkCtx.scale(d.scale,d.scale);inkCtx.translate(page.previewShiftX||0,page.previewShiftY||0);
        return{page,d,work,paperCtx,content,ctx,ink,inkCtx,index:0,imageIndex:0,inkCommitted:false,stage:0,fieldIndex:0,version:record.version};
    }
    function queue(){if(queued)return;queued=true;requestIdleCallback(run,{timeout:120});}
    function refreshAppearance(){for(const record of records.values())record.paperDirty=true;queue();}
    function refreshPaper(record){
        const page=model(record.page),d=dimensions(record,page),snapshot=record.snapshot;
        if(!snapshot||snapshot.width!==d.width||snapshot.height!==d.height||record.canvas.width!==d.pw||record.canvas.height!==d.ph){record.dirty=true;record.version++;cancelJob(record);return false;}
        const work=document.createElement('canvas');work.width=d.pw;work.height=d.ph;
        const ctx=work.getContext('2d');ctx.scale(d.scale,d.scale);background(ctx,page,d);ctx.drawImage(snapshot.canvas,0,0,d.width,d.height);
        const display=record.canvas.getContext('2d');display.save();display.setTransform(1,0,0,1,0,0);display.globalCompositeOperation='copy';display.drawImage(work,0,0);display.restore();
        work.width=work.height=0;
        record.paperDirty=false;return true;
    }
    function run(){
        // Panning/zooming changes no thumbnail content. Do not let a queued
        // font/image/ink rebuild steal a gesture frame (one legacy text field
        // can exceed the nominal slice budget). Existing previews stay visible;
        // pen, eraser and page-resize live updates are deliberately unaffected.
        if(gesturePreviewActive||isPinching||isPanning||isPointerPanning||isWheelZooming||window.ViewLimits?.animating||window.DragMotion?.shelfBusy){
            setTimeout(()=>{queued=false;queue();},80);return;
        }
        queued=false;const deadline=performance.now()+3;
        const selected=records.get(pages[currentPageIndex]?.id),ordered=selected?[selected,...[...records.values()].filter(record=>record!==selected)]:records.values();
        for(const record of ordered){
            if(!record.visible||(!record.dirty&&!record.paperDirty)||!record.paper.isConnected)continue;
            // A tone change only recolors paper/grid. Reuse the completed ink,
            // images and glyph layer rather than replaying a heavy document.
            if(record.paperDirty&&!record.dirty&&refreshPaper(record)){if(performance.now()>deadline){queue();return;}continue;}
            // Reuse the page-local content layer during an edge drag. Rebuilding
            // all handwriting on every pointer sample would compete with input.
            if(current(record.page)&&isPageResizing&&window.tempResize&&record.snapshot)continue;
            if(!record.job||record.job.version!==record.version){cancelJob(record);record.job=start(record);}
            const job=record.job;
            while(job.index<(job.page.strokes||[]).length){drawStrokeToContext(job.page.strokes[job.index++],job.inkCtx);if(performance.now()>deadline){queue();return;}}
            if(job.stage===0){
                if(!job.inkCommitted){job.ctx.save();job.ctx.setTransform(1,0,0,1,0,0);job.ctx.drawImage(job.ink,0,0);job.ctx.restore();job.inkCommitted=true;}
                // Image-heavy pages also obey the slice budget. A single image
                // is atomic, but fifty images must not become one long task.
                const items=job.page.images||[];
                while(job.imageIndex<items.length){image(job.ctx,items[job.imageIndex++],record.page,record);if(performance.now()>deadline){queue();return;}}
                job.stage=1;
            }
            const textGroups=[job.page.handwrittenTextFields||[],job.page.textFields||[]];
            while(job.stage<=2){
                const fields=textGroups[job.stage-1],renderer=job.stage===1?HandwrittenTextField:SimpleTextField;
                while(job.fieldIndex<fields.length){renderer.drawPreview(job.ctx,[fields[job.fieldIndex++]]);if(performance.now()>deadline){queue();return;}}
                job.stage++;job.fieldIndex=0;
            }
            if(record.paperDirty){job.paperCtx.setTransform(job.d.scale,0,0,job.d.scale,0,0);background(job.paperCtx,job.page,job.d);record.paperDirty=false;}
            job.paperCtx.setTransform(1,0,0,1,0,0);job.paperCtx.drawImage(job.content,0,0);
            // Setting even the SAME canvas size clears its pixels and replaces
            // its compositor backing. A routine update is one opaque blit.
            if(record.canvas.width!==job.d.pw)record.canvas.width=job.d.pw;
            if(record.canvas.height!==job.d.ph)record.canvas.height=job.d.ph;
            const display=record.canvas.getContext('2d');display.save();display.setTransform(1,0,0,1,0,0);display.globalAlpha=1;display.globalCompositeOperation='copy';display.drawImage(job.work,0,0);display.restore();
            const previousSnapshot=record.snapshot;
            record.snapshot={canvas:job.content,width:job.d.width,height:job.d.height,gridShiftX:job.page.gridShiftX||0,gridShiftY:job.page.gridShiftY||0};
            job.work.width=job.work.height=job.ink.width=job.ink.height=0;
            // Keep only committed content (plus an explicitly held resize
            // snapshot), not the old staging surfaces until a future GC.
            if(previousSnapshot&&previousSnapshot!==record.resizeSnapshot)previousSnapshot.canvas.width=previousSnapshot.canvas.height=0;
            record.renderedTheme=settings.theme;
            record.dirty=false;record.job=null;
            const liveResized=record.live.width!==job.d.pw||record.live.height!==job.d.ph;
            if(record.live.width!==job.d.pw)record.live.width=job.d.pw;
            if(record.live.height!==job.d.ph)record.live.height=job.d.ph;
            // Refreshing committed ink must not momentarily erase an active
            // stroke that is still being drawn on the independent live layer.
            if(!current(record.page)||!isDrawing||!currentStroke||liveResized){const live=record.live.getContext('2d');live.setTransform(1,0,0,1,0,0);live.clearRect(0,0,record.live.width,record.live.height);record.liveStroke=null;record.liveCount=0;}
            if(performance.now()>deadline){queue();return;}
        }
    }
    function attach({preservePreviews=false}={}){
        const previous=new Map(records);
        // Decoded image sources used to survive every notebook switch forever.
        // Keep this notebook's pages plus its unsaved live images; only derived
        // caches are evicted, never original image data or document history.
        const imageIds=new Set([...pages.flatMap(page=>page.images||[]),...(typeof images!=='undefined'?images:[])].map(item=>item.id));
        for(const[id,entry]of imageCache)if(!imageIds.has(id)){entry.img.onload=null;imageCache.delete(id);}
        for(const[id,source]of window.imageCache||[])if(!imageIds.has(id)){invalidateBitmapSampling(source);window.imageCache.delete(id);}
        // A reorder changes placement, not content. Keep completed bitmaps AND
        // in-progress jobs; rebuilding every visible image/text page here can
        // steal the first spring-return frames and replace compositor textures.
        const retained=new Set();
        if(preservePreviews)document.querySelectorAll('#pageList .page-thumb').forEach((thumb,index)=>{
            const cached=previous.get(pages[index]?.id);
            if(cached?.page===pages[index]&&cached.paper===thumb.querySelector('.page-paper'))retained.add(cached);
        });
        for(const record of previous.values())if(!retained.has(record))cancelJob(record);
        observer?.disconnect();resizeObserver?.disconnect();records.clear();
        observer=new IntersectionObserver(entries=>{for(const entry of entries){const record=records.get(entry.target.dataset.pageId);if(record){record.visible=entry.isIntersecting;if(record.visible)queue();}}},{root:document.getElementById('pageList'),rootMargin:'100px'});
        resizeObserver=new ResizeObserver(entries=>{for(const entry of entries){const record=records.get(entry.target.dataset.pageId);if(record&&Math.abs((record.cssWidth||0)-entry.contentRect.width)>.5){record.cssWidth=entry.contentRect.width;record.dirty=true;record.version++;cancelJob(record);}}queue();});
        const prepared=[];
        document.querySelectorAll('#pageList .page-thumb').forEach((thumb,index)=>{
            const page=pages[index],paper=thumb.querySelector('.page-paper');if(!page||!paper)return;
            thumb.dataset.pageId=page.id;paper.dataset.pageId=page.id;
            const preview=model(page),aspect=`${preview.width||800} / ${preview.height||1100}`;if(paper.style.aspectRatio!==aspect)paper.style.aspectRatio=aspect;
            let live=paper.querySelector('.thumbnail-live');if(!live){live=document.createElement('canvas');live.className='thumbnail-live';paper.appendChild(live);}
            prepared.push({thumb,page,paper,preview,live});
        });
        // Finish all geometry writes before reading any bounds. Large shelves
        // need one layout flush, not a write/read flush for every single page.
        const root=document.getElementById('pageList').getBoundingClientRect();
        for(const {thumb,page,paper,preview,live}of prepared){
            const r=paper.getBoundingClientRect();
            // Seed visibility immediately. IntersectionObserver may wait for
            // a compositor frame, otherwise the first preview stays blank.
            const visible=r.bottom>Math.max(root.top,0)-100&&r.top<Math.min(root.bottom,innerHeight)+100&&r.right>0&&r.left<innerWidth;
            const cached=previous.get(page.id);
            const reused=cached?.paper===paper;
            const keep=retained.has(cached);
            const record={...(reused?cached:{}),page,paper,canvas:paper.querySelector('canvas'),live,visible,dirty:keep?cached.dirty:true,job:keep?cached.job:null,version:keep?cached.version:(cached?.version||0)+1,cssWidth:paper.clientWidth};records.set(page.id,record);observer.observe(thumb);resizeObserver.observe(paper);
            if(reused&&cached.renderedTheme&&cached.renderedTheme!==settings.theme){
                // A theme change is an intentional recolor, not a routine
                // refresh. Don't show old light paper on the dark shelf.
                const d=dimensions(record,preview);if(record.canvas.width!==d.pw)record.canvas.width=d.pw;if(record.canvas.height!==d.ph)record.canvas.height=d.ph;
                const context=record.canvas.getContext('2d');context.setTransform(d.scale,0,0,d.scale,0,0);background(context,preview,d);context.setTransform(1,0,0,1,0,0);
                const liveContext=record.live.getContext('2d');liveContext.setTransform(1,0,0,1,0,0);liveContext.clearRect(0,0,record.live.width,record.live.height);
                record.snapshot=null;record.renderedTheme=null;record.liveStroke=null;record.liveCount=0;
            }else if(!reused&&visible&&cached?.snapshot&&cached.renderedTheme===settings.theme&&cached.snapshot.width===preview.width&&cached.snapshot.height===preview.height){
                // Reordering must not replace a finished native preview with a
                // blank canvas while its refreshed idle job is still queued.
                for(const [target,source]of[[record.canvas,cached.canvas],[record.live,cached.live]]){target.width=source.width;target.height=source.height;target.getContext('2d').drawImage(source,0,0);}
                record.snapshot=cached.snapshot;record.renderedTheme=cached.renderedTheme;record.liveStroke=cached.liveStroke;record.liveCount=cached.liveCount;
            }
        }
        // Dispose detached preview surfaces immediately instead of waiting for
        // GC to notice an entire old notebook's canvas backing stores.
        const kept=new Set([...records.values()].flatMap(record=>[record.canvas,record.live,record.snapshot?.canvas,record.resizeSnapshot?.canvas]));
        for(const record of previous.values())if(records.get(record.page.id)?.paper!==record.paper){
            for(const surface of new Set([record.canvas,record.live,record.snapshot?.canvas,record.resizeSnapshot?.canvas]))if(surface&&!kept.has(surface))surface.width=surface.height=0;
        }
        queue();
    }
    function dirty(id=pages[currentPageIndex]?.id){const record=records.get(id);if(record){record.dirty=true;record.version++;cancelJob(record);queue();}}
    function resizePreview(record,page){
        // Layout follows the pointer immediately; rendering is coalesced to one
        // display frame. Keep content in world coordinates, never stretch it to
        // fit the new paper shape, and redraw the grid at native preview density.
        record.paper.style.aspectRatio=`${page.width} / ${page.height}`;
        record.resizeSnapshot??=record.snapshot;
        if(resizeFrame)return;
        resizeFrame=requestAnimationFrame(()=>{
            resizeFrame=0;
            const active=records.get(pages[currentPageIndex]?.id);
            if(!active?.visible||!active.paper.isConnected)return;
            if(!active.dirty||isDrawing){active.resizeSnapshot=null;return;}
            const source=active.resizeSnapshot||active.snapshot;if(!source){queue();return;}
            const preview=model(active.page),d=dimensions(active,preview);
            if(active.canvas.width!==d.pw)active.canvas.width=d.pw;
            if(active.canvas.height!==d.ph)active.canvas.height=d.ph;
            const ctx=active.canvas.getContext('2d');ctx.setTransform(d.scale,0,0,d.scale,0,0);background(ctx,preview,d);
            ctx.drawImage(source.canvas,(preview.gridShiftX||0)-source.gridShiftX,(preview.gridShiftY||0)-source.gridShiftY,source.width,source.height);
            if(active.live.width!==d.pw)active.live.width=d.pw;
            if(active.live.height!==d.ph)active.live.height=d.ph;
            const live=active.live.getContext('2d');live.setTransform(1,0,0,1,0,0);live.clearRect(0,0,active.live.width,active.live.height);
            if(!isPageResizing||!window.tempResize)active.resizeSnapshot=null;
        });
    }
    function tick(){
        liveFrame=0;const record=records.get(pages[currentPageIndex]?.id);if(!record?.visible||!record.paper.isConnected)return;
        const s=currentStroke;
        if(!s||!isDrawing){if(record.liveStroke){record.liveStroke=null;dirty();}return;} // Keep live pixels until the committed preview is ready.
        if(!['pen','highlighter'].includes(s.tool)||s.isShape)return;
        const ctx=record.live.getContext('2d'),scale=record.live.width/(baseWidth||800);
        if(record.liveStroke!==s){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,record.live.width,record.live.height);record.liveStroke=s;record.liveCount=0;}
        ctx.setTransform(scale,0,0,scale,0,0);ctx.strokeStyle=ctx.fillStyle=getThemedColor(s.color);ctx.lineCap=ctx.lineJoin='round';ctx.globalAlpha=s.tool==='highlighter'?.5:1;
        const points=s.points||[];const from=record.liveCount;ctx.beginPath();
        if(from===0&&points.length){ctx.arc(points[0].x,points[0].y,(points[0].size||s.size)/2,0,Math.PI*2);ctx.fill();}
        for(let i=Math.max(1,from);i<points.length;i++){ctx.lineWidth=points[i].size||s.size;ctx.beginPath();ctx.moveTo(points[i-1].x,points[i-1].y);ctx.lineTo(points[i].x,points[i].y);ctx.stroke();}
        record.liveCount=points.length;
    }
    function live(){if(!liveFrame)liveFrame=requestAnimationFrame(tick);}
    const originalList=renderPageList;renderPageList=function(options){originalList();attach(options);};
    // The old generator is retained only as a compatibility name. Attach queues
    // sharp replacements, rather than drawing every notebook page synchronously.
    generateThumbnail=function(){queue();};
    updateCurrentThumbnail=function(){dirty();};
    const originalInvalidate=invalidateStrokeCache;invalidateStrokeCache=function(...args){const result=originalInvalidate(...args);dirty();return result;};
    const originalRedraw=redrawCanvas;let lastPage,lastWidth,lastHeight,lastShiftX,lastShiftY,lastResizing,lastVersion=-1,lastTemplate='',lastEdit=0;
    redrawCanvas=function(...args){const result=originalRedraw(...args),page=pages[currentPageIndex],record=records.get(page?.id);
        const active=page&&current(page),resize=active&&isPageResizing&&window.tempResize;
        const width=active?(resize?.w??baseWidth):page?.width,height=active?(resize?.h??baseHeight):page?.height;
        const sx=active?gridShiftX+(resize?.shiftX||0):page?.gridShiftX,sy=active?gridShiftY+(resize?.shiftY||0):page?.gridShiftY;
        const geometryChanged=page!==lastPage||width!==lastWidth||height!==lastHeight||sx!==lastShiftX||sy!==lastShiftY||!!resize!==lastResizing;
        if(geometryChanged||lastVersion!==strokeCacheVersion||lastTemplate!==currentPageTemplate){
            lastPage=page;lastWidth=width;lastHeight=height;lastShiftX=sx;lastShiftY=sy;lastResizing=!!resize;lastVersion=strokeCacheVersion;lastTemplate=currentPageTemplate;
            // Camera-only frames do not need a new document model, text-field
            // lookups or a freshly allocated string fingerprint.
            if(record){record.paper.style.aspectRatio=`${width} / ${height}`;if(geometryChanged&&(record.snapshot||resize))resizePreview(record,model(page));}
            dirty();
        }
        if((imageManipulation?.isDragging||imageManipulation?.isResizing||imageManipulation?.isRotating||(lassoSelection?.isDragging&&!window.LassoWorkbench?.isPreviewDragging)||lassoSelection?.isResizing||lassoSelection?.isRotating)&&performance.now()-lastEdit>50){lastEdit=performance.now();dirty();}
        if(isDrawing||records.get(pages[currentPageIndex]?.id)?.liveStroke)live();return result;
    };
    const originalSave=triggerAutoSave;triggerAutoSave=function(...args){dirty();return originalSave(...args);};
    const originalDraw=draw;draw=function(...args){const result=originalDraw(...args);if(isDrawing)live();return result;};
    const originalStart=startDrawing;startDrawing=function(...args){const result=originalStart(...args);if(isDrawing)live();return result;};
    window.addEventListener('handwrittenPreviewChanged',()=>{for(const record of records.values())if(record.page.handwrittenTextFields?.length||current(record.page)&&HandwrittenTextField.getTextFields().length)dirty(record.page.id);});
    return{attach,dirty,live,refreshAppearance,records};
})();
