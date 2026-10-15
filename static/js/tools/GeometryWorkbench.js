/** Touch-friendly geometry palette and native-resolution live construction. */
window.GeometryWorkbench=(()=>{
    const engine=window.GeometryDetector;
    let panel,previewFrame=0,category='shapes';
    const groups={
        shapes:['rectangle','square','rounded-rectangle','circle','ellipse','arc','semicircle','triangle','right-triangle','diamond'],
        lines:['line','arrow','double-arrow','polyline','axes'],
        polygons:['parallelogram','trapezoid','pentagon','hexagon','heptagon','octagon'],
        symbols:['star','heart','chevron','cross']
    };
    const title=type=>engine.catalog.find(([id])=>id===type)?.[1]||type;
    function icon(type){
        if(type==='auto')return '<svg viewBox="0 0 40 32" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M19 24 28 7 37 24Z M4 25h10"/></svg>';
        if(type==='polyline')return '<svg viewBox="0 0 40 32" aria-hidden="true"><path d="m5 25 10-16 10 13 10-16"/></svg>';
        const constrained=['circle','square'].includes(type);
        const stroke=engine.createShape(type,{x:constrained?8:5,y:4},{x:constrained?32:35,y:28},{size:1.5});let d='';
        stroke.points.forEach((p,i)=>d+=(i===0||p.break?'M':'L')+p.x.toFixed(2)+' '+p.y.toFixed(2)+' ');
        return '<svg viewBox="0 0 40 32" aria-hidden="true"><path d="'+d+'"/></svg>';
    }
    function createPanel(){
        if(panel)return;
        panel=document.createElement('section');panel.id='geometryPanel';panel.hidden=true;panel.setAttribute('aria-label','Geometry tools');panel.setAttribute('role','dialog');
        const toggle=(id,label,tag='label')=>`<${tag} class="geometry-switch"><input type="checkbox" role="switch" id="${id}" aria-label="${label}"><span class="geometry-switch-track" aria-hidden="true"></span></${tag}>`;
        panel.innerHTML=`<header><div class="geometry-heading"><strong>Geometry</strong><span id="geometryStatus"></span></div><div class="geometry-header-actions">${toggle('geometryEnabled','Enable geometry')}<button type="button" data-geometry-close aria-label="Close geometry tools"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header>
            <div class="geometry-body"><button class="geometry-auto" type="button" data-geometry-shape="auto" aria-pressed="false">${icon('auto')}<span><strong>Auto recognize</strong><small>Sketch a shape. Lift to refine.</small></span><svg class="geometry-check" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg></button>
            <div class="geometry-browse"><div class="geometry-categories" role="tablist" aria-label="Shape categories">${Object.keys(groups).map(id=>`<button type="button" role="tab" id="geometry-tab-${id}" data-geometry-category="${id}" aria-controls="geometryShapeGrid" aria-selected="false">${id[0].toUpperCase()+id.slice(1)}</button>`).join('')}</div><button class="geometry-search-toggle" type="button" aria-label="Search shapes" aria-expanded="false"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></button></div>
            <input class="geometry-search" hidden type="search" placeholder="Search shapes…" aria-label="Find a shape">
            <div class="geometry-shapes" id="geometryShapeGrid" role="tabpanel">${engine.catalog.filter(([id])=>id!=='auto').map(([id,name])=>`<button type="button" data-geometry-shape="${id}" aria-pressed="false" title="${name}">${icon(id)}<span>${name}</span></button>`).join('')}</div><p class="geometry-empty" hidden>No matching shapes</p>
            <p class="geometry-tip" id="geometryHint"></p>
            <div class="geometry-style"><label class="geometry-style-option" for="geometrySnap"><svg viewBox="0 0 24 24"><path d="M5 5v14h14M5 14a5 5 0 0 1 5 5"/></svg><span>Snap angles</span>${toggle('geometrySnap','Snap angles','span')}</label><label class="geometry-style-option" for="geometryFill"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" fill-opacity=".2"/></svg><span>Soft fill</span>${toggle('geometryFill','Soft fill','span')}</label><label class="geometry-style-option" for="geometryDashed"><svg viewBox="0 0 24 24"><path d="M4 12h16" stroke-dasharray="3 3"/></svg><span>Dashed</span>${toggle('geometryDashed','Dashed outline','span')}</label></div>
            <details class="geometry-inspector"><summary><span>Edit last shape</span><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></summary><p id="geometryLast">Draw a shape to edit it here.</p><div class="geometry-dimensions"><label>Width<input type="number" id="geometryWidth" min="0" max="100000" step="1"></label><label>Height<input type="number" id="geometryHeight" min="0" max="100000" step="1"></label><label>Rotation °<input type="number" id="geometryRotation" value="0" min="-360" max="360"></label></div><div class="geometry-actions"><button type="button" data-geometry-edit="apply">Apply</button><button type="button" data-geometry-edit="duplicate">Duplicate</button></div></details></div>`;
        document.body.appendChild(panel);
        panel.querySelector('[data-geometry-close]').onclick=()=>close(true);
        panel.querySelector('#geometryEnabled').onchange=e=>{if(e.target.checked)selectPen();engine.setEnabled(e.target.checked);};
        panel.querySelector('#geometrySnap').onchange=e=>{engine.snap=e.target.checked;localStorage.setItem('badnotes_geometry_snap',String(engine.snap));sync();};
        panel.querySelector('#geometryFill').onchange=e=>{engine.fill=e.target.checked;sync();};
        panel.querySelector('#geometryDashed').onchange=e=>{engine.dashed=e.target.checked;sync();};
        const search=panel.querySelector('.geometry-search'),searchButton=panel.querySelector('.geometry-search-toggle');
        searchButton.onclick=()=>{search.hidden=!search.hidden;searchButton.setAttribute('aria-expanded',String(!search.hidden));if(!search.hidden)search.focus();else{search.value='';filterShapes();}position();};
        search.oninput=filterShapes;
        panel.addEventListener('click',e=>{
            const tab=e.target.closest('[data-geometry-category]');if(tab){category=tab.dataset.geometryCategory;search.value='';filterShapes();}
            const button=e.target.closest('[data-geometry-shape]');if(button){engine.mode=button.dataset.geometryShape;selectPen();engine.setEnabled(true);localStorage.setItem('badnotes_geometry_mode',engine.mode);sync();}
            const edit=e.target.closest('[data-geometry-edit]');if(edit)editLast(edit.dataset.geometryEdit);
        });
        panel.querySelector('.geometry-categories').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...panel.querySelectorAll('[data-geometry-category]')],index=tabs.indexOf(document.activeElement);const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});
        panel.querySelector('.geometry-inspector').addEventListener('toggle',position);
        document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!e.target.closest('#geometryToggleBtn'))close();});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close(true);e.stopPropagation();}},true);
        window.addEventListener('resize',position);
    }
    function selectPen(){currentTool='pen';document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool==='pen'));if(typeof updateCanvasToolCursor==='function')updateCanvasToolCursor();}
    function close(focus=false){panel.hidden=true;document.getElementById('geometryToggleBtn')?.setAttribute('aria-expanded','false');if(focus)document.getElementById('geometryToggleBtn')?.focus();}
    function position(){
        if(!panel||panel.hidden)return;
        const anchor=document.getElementById('geometryToggleBtn')?.getBoundingClientRect();
        const gap=12,margin=12,width=panel.offsetWidth;
        const above=anchor?anchor.top-gap:innerHeight-90;
        // Anchor to the tool, with a scrolling body on small windows; never cover the dock.
        const below=anchor?innerHeight-anchor.bottom-gap:0,up=above>=Math.min(420,innerHeight*.6)||above>=below;
        const available=Math.max(100,(up?above:below)-margin);
        panel.style.maxHeight=available+'px';
        panel.style.left=Math.max(margin,Math.min(innerWidth-width-margin,anchor?anchor.left+anchor.width/2-width/2:innerWidth-width-margin))+'px';
        panel.style.top=(up?Math.max(margin,above-panel.offsetHeight):anchor.bottom+gap)+'px';
    }
    function filterShapes(){
        const query=panel.querySelector('.geometry-search').value.trim().toLowerCase();let visible=0;
        panel.querySelectorAll('.geometry-shapes [data-geometry-shape]').forEach(button=>{button.hidden=query?!title(button.dataset.geometryShape).toLowerCase().includes(query):!groups[category].includes(button.dataset.geometryShape);if(!button.hidden)visible++;});
        panel.querySelectorAll('[data-geometry-category]').forEach(tab=>{const active=!query&&tab.dataset.geometryCategory===category;tab.setAttribute('aria-selected',String(active));tab.tabIndex=tab.dataset.geometryCategory===category?0:-1;});
        panel.querySelector('#geometryShapeGrid').setAttribute('aria-label',query?'Search results':category+' shapes');
        panel.querySelector('.geometry-empty').hidden=visible!==0;position();
    }
    function sync(){
        const button=document.getElementById('geometryToggleBtn');if(button){button.classList.toggle('active',engine.enabled);button.setAttribute('aria-pressed',String(engine.enabled));button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded',String(!!panel&&!panel.hidden));button.setAttribute('aria-controls','geometryPanel');button.title=`Geometry: ${title(engine.mode)} (G) · Click for shapes`;}
        if(panel){for(const[id,value]of Object.entries({geometryEnabled:engine.enabled,geometrySnap:engine.snap,geometryFill:engine.fill,geometryDashed:engine.dashed}))panel.querySelector('#'+id).checked=value;
            panel.querySelector('#geometryStatus').textContent=engine.enabled?title(engine.mode):'Off · freehand drawing';
            panel.querySelector('#geometryHint').textContent=!engine.enabled?'Choose a shape to start drawing.':engine.mode==='auto'?'Sketch freely; shapes refine when you lift your pen.':engine.mode==='polyline'?'Sketch connected segments. Lift to straighten.':'Drag to draw · Shift locks proportions · Alt draws from center';
            panel.querySelectorAll('[data-geometry-shape]').forEach(b=>b.setAttribute('aria-pressed',String(engine.enabled&&b.dataset.geometryShape===engine.mode)));updateInspector();filterShapes();}
    }
    function lastShape(){for(let i=strokes.length-1;i>=0;i--)if(strokes[i].isGeometric)return{i,stroke:strokes[i]};return null;}
    function updateInspector(){if(!panel)return;const last=lastShape();panel.querySelector('.geometry-inspector').hidden=!last;panel.querySelectorAll('[data-geometry-edit]').forEach(b=>b.disabled=!last);if(!last){panel.querySelector('#geometryLast').textContent='Draw a shape to edit it here.';return;}const bounds=engine.getBounds(last.stroke.points);panel.querySelector('#geometryLast').textContent=title(last.stroke.geometryType)+' · vector, editable';panel.querySelector('#geometryWidth').value=Math.round(bounds.width*10)/10;panel.querySelector('#geometryHeight').value=Math.round(bounds.height*10)/10;}
    function editLast(action){
        const last=lastShape();if(!last||isDrawing)return;const before=structuredClone(last.stroke),after=structuredClone(last.stroke),bounds=engine.getBounds(before.points);
        if(action==='duplicate'){after.id=Date.now()+Math.random();after.points=after.points.map(p=>({...p,x:p.x+20,y:p.y+20}));strokes.push(after);historyStack.push({type:'add',stroke:after});}
        else{const width=Number(panel.querySelector('#geometryWidth').value),height=Number(panel.querySelector('#geometryHeight').value),angle=Number(panel.querySelector('#geometryRotation').value)*Math.PI/180;if(!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(angle)||width<0||height<0||width>100000||height>100000)return;after.points=after.points.map(p=>{const x=(p.x-bounds.centerX)*(bounds.width?width/bounds.width:1),y=(p.y-bounds.centerY)*(bounds.height?height/bounds.height:1);return{...p,x:bounds.centerX+x*Math.cos(angle)-y*Math.sin(angle),y:bounds.centerY+x*Math.sin(angle)+y*Math.cos(angle)};});strokes[last.i]=after;historyStack.push({type:'transform',strokeIndices:[last.i],beforeStrokes:[before],afterStrokes:[structuredClone(after)]});panel.querySelector('#geometryRotation').value='0';}
        redoStack=[];invalidateStrokeCache();redrawCanvas(true);triggerAutoSave();updateInspector();
    }
    function open(){createPanel();if(!panel.hidden){close();return;}panel.hidden=false;category=Object.keys(groups).find(key=>groups[key].includes(engine.mode))||'shapes';panel.querySelector('.geometry-search').value='';sync();position();}
    function start(e){
        if(currentTool!=='pen'||!engine.enabled||engine.mode==='auto'||engine.mode==='polyline')return false;
        const point=getCanvasPoint(e);isDrawing=true;drawingPointerId=e.pointerId;canvas.setPointerCapture(e.pointerId);
        currentStroke={id:Date.now()+Math.random(),tool:'pen',color:currentColor,size:currentSize,points:[point,point],geometryDraft:true,draftType:engine.mode,draftStart:point,draftEnd:point};update(e);return true;
    }
    function paint(){
        previewFrame=0;if(!currentStroke?.geometryDraft)return;
        const draft=currentStroke,clean=engine.createShape(draft.draftType,draft.draftStart,draft.draftEnd,{id:draft.id,color:draft.color,size:draft.size},draft.draftOptions||{});
        currentStroke={...clean,geometryDraft:true,draftType:draft.draftType,draftStart:draft.draftStart,draftEnd:draft.draftEnd,draftOptions:draft.draftOptions};clearActiveCanvas();drawStrokeToContext(currentStroke,activeCtx);
    }
    function update(e){if(!currentStroke?.geometryDraft)return false;currentStroke.draftEnd=getCanvasPoint(e);currentStroke.draftOptions={constrain:!!e.shiftKey,center:!!e.altKey};if(!previewFrame)previewFrame=requestAnimationFrame(paint);return true;}
    function finish(e){
        if(!currentStroke?.geometryDraft)return false;if(e)update(e);if(previewFrame)cancelAnimationFrame(previewFrame);paint();
        const draft=currentStroke;isDrawing=false;drawingPointerId=null;currentStroke=null;clearActiveCanvas();
        if(engine.distance(draft.draftStart,draft.draftEnd)*zoom<3){redrawCanvas();return true;}
        for(const key of['geometryDraft','draftType','draftStart','draftEnd','draftOptions'])delete draft[key];strokes.push(draft);historyStack.push({type:'add',stroke:draft});redoStack=[];invalidateStrokeCache(false);redrawCanvas(true);triggerAutoSave();updateInspector();return true;
    }
    try{const saved=localStorage.getItem('badnotes_geometry_mode');if(engine.catalog.some(([id])=>id===saved))engine.mode=saved;engine.snap=localStorage.getItem('badnotes_geometry_snap')!=='false';}catch(_){}
    document.addEventListener('click',e=>{if(e.target.closest('#geometryToggleBtn'))open();});
    window.addEventListener('toolbarRendered',sync);window.addEventListener('geometryChanged',sync);
    window.addEventListener('geometryRecognized',e=>{requestAnimationFrame(updateInspector);if(typeof showToast==='function')showToast(title(e.detail.type)+' refined','info');});
    return{open,start,update,finish,sync};
})();
