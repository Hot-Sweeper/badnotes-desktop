// Resizable side panels: captured pointer input, frame batching and persistence.
let isResizing=false, resizeTarget=null, resizeStartX=0, resizeStartWidth=0;
function setupResizablePanels() {
    const storageKey='badnotes_panel_widths';
    let widths={};
    try{widths=JSON.parse(localStorage.getItem(storageKey)||'{}') || {};}catch{}
    let pointer=null,handle=null,frame=0,pendingWidth=null;
    const clamp=(panel,width)=>{
        const style=getComputedStyle(panel);
        const min=parseFloat(style.minWidth)||160;
        const max=Math.max(min,Math.min(parseFloat(style.maxWidth)||520,innerWidth*.45));
        return Math.max(min,Math.min(max,width));
    };
    const apply=()=>{
        frame=0;if(!resizeTarget||pendingWidth===null)return;
        const width=clamp(resizeTarget,pendingWidth);
        resizeTarget.style.width=width+'px';handle.setAttribute('aria-valuenow',Math.round(width));
    };
    const persist=panel=>{
        widths[panel.id]=Math.round(panel.getBoundingClientRect().width);
        localStorage.setItem(storageKey,JSON.stringify(widths));
    };
    const finish=e=>{
        if(!isResizing||(e&&e.pointerId!==pointer))return;
        if(frame)cancelAnimationFrame(frame);apply();persist(resizeTarget);
        const oldHandle=handle,oldPointer=pointer;
        isResizing=false;resizeTarget=null;pendingWidth=null;pointer=null;handle=null;
        oldHandle.classList.remove('active');document.body.classList.remove('resizing-panels');
        if(oldHandle.hasPointerCapture(oldPointer))oldHandle.releasePointerCapture(oldPointer);
    };
    for(const [panelId,handleId,direction] of [['sidebar','sidebarResize',1],['pageNav','pageNavResize',-1]]){
        const panel=document.getElementById(panelId),grip=document.getElementById(handleId);
        if(!panel||!grip)continue;
        if(Number.isFinite(widths[panelId]))panel.style.width=clamp(panel,widths[panelId])+'px';
        grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');
        grip.setAttribute('aria-label',panelId==='sidebar'?'Resize notebook panel':'Resize page panel');
        grip.title='Drag to resize · Double-click to reset';
        grip.addEventListener('pointerdown',e=>{
            if(isResizing||e.button!==0)return;
            isResizing=true;resizeTarget=panel;handle=grip;pointer=e.pointerId;
            resizeStartX=e.clientX;resizeStartWidth=panel.getBoundingClientRect().width;pendingWidth=resizeStartWidth;
            grip.setPointerCapture(pointer);grip.classList.add('active');document.body.classList.add('resizing-panels');
            e.preventDefault();e.stopPropagation();
        });
        document.addEventListener('pointermove',e=>{
            if(!isResizing||pointer!==e.pointerId||handle!==grip)return;
            pendingWidth=resizeStartWidth+(e.clientX-resizeStartX)*direction;
            if(!frame)frame=requestAnimationFrame(apply);e.preventDefault();e.stopPropagation();
        },true);
        grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
        grip.addEventListener('lostpointercapture',e=>{if(handle===grip)finish(e);});
        grip.addEventListener('dblclick',()=>{panel.style.width='';persist(panel);});
        grip.addEventListener('keydown',e=>{
            if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
            panel.style.width=clamp(panel,panel.getBoundingClientRect().width+(e.key==='ArrowRight'?1:-1)*direction*(e.shiftKey?40:16))+'px';
            persist(panel);e.preventDefault();
        });
    }
    for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>{
        if(isResizing&&e.pointerId===pointer){finish(e);e.preventDefault();e.stopPropagation();}
    },true);
    window.addEventListener('blur',()=>finish());
}
