/* One palette interaction path for mouse, finger and pen. Color removal is an
 * explicit editor action, never a long-press, drag cancel or broad trash hit. */
(() => {
    const colors=['#ffffff','#171717','#8d94a4','#c8ceda','#ff6b6b','#f08bb4','#c6456f','#923961','#ffd93d','#ffb75e','#e48a4d','#aa6139','#6bcb77','#9acb8f','#39ad88','#227763','#4d96ff','#83bbec','#4271c7','#254f95','#6c5ce7','#ab91ef','#9666d4','#614196','#00b6bb','#64d4d0','#e795d5','#cc62a9'];
    let panel,editing=null,choice='#7640fd',drag=null,frame=0,suppressUntil=0;
    const valid=s=>/^#[0-9a-f]{6}$/i.test(s),normalize=s=>String(s).toLowerCase();
    const contrast=color=>{const c=color.slice(1).match(/../g).map(n=>parseInt(n,16)/255),y=c.map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);return y>.18?'#171717':'#fff';};
    function render(){
        const container=document.getElementById('colorPresets');if(!container)return;
        container.setAttribute('role','group');container.setAttribute('aria-label','Ink colors');
        container.title='Drag a color onto a closed shape to fill it, or onto another color to reorder. Right-click to edit.';
        const visible=customPalette.slice(0,6),activeIndex=customPalette.indexOf(currentColor);
        if(activeIndex>=6)visible[5]=customPalette[activeIndex]; // Active ink is never hidden in overflow.
        container.innerHTML=visible.map((color)=>{
            const index=customPalette.indexOf(color);
            const slot=keyboardColorSlots.indexOf(color),key=slot<0?'':slot===9?'0':String(slot+1),active=normalize(color)===normalize(currentColor);
            return `<button type="button" class="color-preset${active?' active':''}" data-color="${color}" data-index="${index}" draggable="false" aria-pressed="${active}" aria-label="${color}${key?' · shortcut '+key:''}" title="${color} · drag to fill or reorder" style="background:${color};--palette-key-color:${contrast(color)}">${key?'<span class="color-key-badge">'+key+'</span>':''}</button>`;
        }).join('');
        const overflow=document.getElementById('colorOverflowIndicator');if(overflow){overflow.classList.toggle('visible',customPalette.length>6);overflow.textContent='+'+Math.max(0,customPalette.length-6);overflow.title='Show all '+customPalette.length+' colors';overflow.onclick=()=>open();}
        const add=document.getElementById('addColorBtn');if(add){add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';add.title='Add or manage ink colors';add.setAttribute('aria-label','Add or manage ink colors');add.setAttribute('aria-expanded',String(!!panel&&!panel.hidden));}
        if(panel&&!panel.hidden)refresh();
    }
    function build(){
        if(panel)return;panel=document.createElement('section');panel.id='palettePanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Ink palette');
        panel.innerHTML=`<header><div><strong>Ink palette</strong><small>Make room for your colors.</small></div><button type="button" data-palette-close aria-label="Close ink palette"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="palette-panel-body"><div class="palette-section-heading">Your colors <span id="paletteCount"></span></div><div class="palette-saved-grid" role="group" aria-label="Saved ink colors"></div><div class="palette-section-heading">Choose a color</div><div class="palette-choice-grid" role="group" aria-label="Suggested colors"></div><div class="palette-custom-row"><label class="palette-custom-well" title="Choose a custom color"><input type="color" aria-label="Custom color"><span>Custom</span></label><label class="palette-hex-field"><span>HEX</span><input type="text" maxlength="7" spellcheck="false" aria-label="Hex color" value="#7640fd"></label><span class="palette-color-preview" aria-hidden="true"></span></div><p class="palette-hint">Drag a saved color onto a closed shape to fill it.</p></div><footer><button type="button" data-palette-remove hidden>Remove color</button><button type="button" data-palette-save>Add color</button></footer>`;
        document.body.append(panel);
        panel.querySelector('[data-palette-close]').onclick=()=>close(true);
        panel.querySelector('.palette-choice-grid').innerHTML=colors.map(c=>`<button type="button" data-palette-choice="${c}" aria-label="Choose ${c}" style="--swatch:${c}"></button>`).join('');
        panel.addEventListener('click',e=>{const select=e.target.closest('[data-palette-choice]'),saved=e.target.closest('[data-palette-saved]');if(select){choice=select.dataset.paletteChoice;refresh();}if(saved){setColor(saved.dataset.paletteSaved);choice=saved.dataset.paletteSaved;refresh();}});
        panel.querySelector('input[type=color]').oninput=e=>{choice=normalize(e.target.value);refresh();};
        const hex=panel.querySelector('input[type=text]');hex.oninput=()=>{const c=normalize(hex.value.startsWith('#')?hex.value:'#'+hex.value);hex.setAttribute('aria-invalid',String(!valid(c)));if(valid(c)){choice=c;refresh(false);}else panel.querySelector('[data-palette-save]').disabled=true;};
        panel.querySelector('[data-palette-save]').onclick=()=>{
            if(!valid(choice))return;
            if(editing){const index=customPalette.indexOf(editing);if(index>=0){if(customPalette.includes(choice)&&choice!==editing){setColor(choice);close(true);return;}customPalette[index]=choice;keyboardColorSlots=keyboardColorSlots.map(c=>c===editing?choice:c);localStorage.setItem('badnotes_keyboard_color_slots',JSON.stringify(keyboardColorSlots));savePalette();}}
            else if(!customPalette.includes(choice)){customPalette.push(choice);savePalette();}
            const added=choice;setColor(added);editing=null;refresh();const swatch=panel.querySelector('[data-palette-saved="'+added+'"]');swatch?.animate([{transform:'scale(.8)',opacity:.3},{transform:'scale(1)',opacity:1}],{duration:230,easing:'cubic-bezier(.2,.8,.2,1)'});
        };
        panel.querySelector('[data-palette-remove]').onclick=()=>{if(editing){const color=editing;editing=null;removeColor(color);if(currentColor===color&&customPalette.length)setColor(customPalette[0]);refresh();}};
        panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close(true);}});
    }
    function refresh(updateHex=true){
        if(!panel)return;
        panel.querySelector('#paletteCount').textContent=customPalette.length;
        panel.querySelector('.palette-saved-grid').innerHTML=customPalette.map(c=>`<button type="button" data-palette-saved="${c}" aria-pressed="${c===currentColor}" aria-label="Use ${c}" title="${c} · right-click to edit" style="--swatch:${c};--palette-key-color:${contrast(c)}">${c===currentColor?'<svg viewBox="0 0 16 16"><path d="m4 8 2.5 2.5L12 5"/></svg>':''}</button>`).join('');
        panel.querySelectorAll('[data-palette-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.paletteChoice===choice)));
        panel.querySelector('input[type=color]').value=choice;if(updateHex){const input=panel.querySelector('input[type=text]');input.value=choice;input.setAttribute('aria-invalid','false');}
        panel.querySelector('.palette-color-preview').style.background=choice;
        const save=panel.querySelector('[data-palette-save]');save.textContent=editing?'Save color':customPalette.includes(choice)?'Already in palette':'Add color';save.disabled=!editing&&customPalette.includes(choice);
        panel.querySelector('[data-palette-remove]').hidden=!editing;
        if(!panel.hidden)position();
    }
    function position(){const anchor=document.getElementById('addColorBtn')?.getBoundingClientRect();panel.style.left=Math.max(12,Math.min(innerWidth-panel.offsetWidth-12,(anchor?.left||innerWidth/2)-panel.offsetWidth/2))+'px';panel.style.top=Math.max(12,(anchor?.top||innerHeight)-panel.offsetHeight-14)+'px';}
    function open(color=null){
        build();editing=valid(color)?color:null;choice=editing||(valid(currentColor)?currentColor:'#7640fd');panel.hidden=false;render();
    }
    function close(focus=false){if(panel){if(panel.contains(document.activeElement))document.activeElement.blur();panel.hidden=true;}editing=null;document.getElementById('addColorBtn')?.setAttribute('aria-expanded','false');if(focus)document.getElementById('addColorBtn')?.focus({preventScroll:true});}
    function cleanup(){
        if(frame)cancelAnimationFrame(frame);frame=0;drag?.ghost?.remove();drag?.source?.classList.remove('palette-drag-source');document.body.classList.remove('is-dragging-color');drag=null;
    }
    function move(){frame=0;if(drag?.ghost)drag.ghost.style.transform=`translate3d(${drag.x-16}px,${drag.y-16}px,0)`;}
    document.addEventListener('pointerdown',e=>{
        const source=e.target instanceof Element?e.target.closest('.color-preset,[data-palette-saved]'):null;
        if(!source){if(panel&&!panel.hidden&&!panel.contains(e.target)&&!e.target.closest('#addColorBtn,#colorOverflowIndicator'))close();return;}
        if(e.button!==0||drag)return;
        window.cancelCanvasInertia?.();window.ViewLimits?.cancel();window.HistoryMotion?.finish();
        e.preventDefault();e.stopPropagation();drag={id:e.pointerId,source,color:source.dataset.color||source.dataset.paletteSaved,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,active:false};
        try{source.setPointerCapture(e.pointerId);}catch{}
    },true);
    document.addEventListener('pointermove',e=>{
        if(!drag||e.pointerId!==drag.id)return;
        e.preventDefault();e.stopPropagation();drag.x=e.clientX;drag.y=e.clientY;
        if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>=7){drag.active=true;drag.source.classList.add('palette-drag-source');const ghost=document.createElement('div');ghost.className='palette-drag-ghost';ghost.style.background=drag.color;document.body.append(ghost);drag.ghost=ghost;document.body.classList.add('is-dragging-color');close();}
        if(drag.active&&!frame)frame=requestAnimationFrame(move);
    },{capture:true,passive:false});
    document.addEventListener('pointerup',e=>{
        if(!drag||e.pointerId!==drag.id)return;e.preventDefault();e.stopPropagation();
        const d=drag;const target=document.elementFromPoint(e.clientX,e.clientY),swatch=target?.closest('.color-preset,[data-palette-saved]');suppressUntil=performance.now()+400;
        cleanup();
        if(!d.active){setColor(d.color);return;}
        if(swatch){const color=swatch.dataset.color||swatch.dataset.paletteSaved,from=customPalette.indexOf(d.color),to=customPalette.indexOf(color);if(from>=0&&to>=0&&from!==to){customPalette.splice(to,0,customPalette.splice(from,1)[0]);savePalette();render();}return;}
        if(target?.closest('#canvasContainer')){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-panX)/zoom,y=(e.clientY-r.top-panY)/zoom;window.PaintFill?.drop(x,y,d.color);}
    },true);
    document.addEventListener('pointercancel',e=>{if(drag?.id===e.pointerId)cleanup();},true);
    document.addEventListener('click',e=>{if(performance.now()<suppressUntil&&e.target.closest('.color-preset,[data-palette-saved]')){e.preventDefault();e.stopImmediatePropagation();return;}const s=e.target.closest('.color-preset');if(s)setColor(s.dataset.color);},true);
    document.addEventListener('contextmenu',e=>{const s=e.target.closest('.color-preset,[data-palette-saved]');if(s){e.preventDefault();e.stopPropagation();if(!drag?.active)open(s.dataset.color||s.dataset.paletteSaved);}},true);
    window.addEventListener('blur',cleanup);window.addEventListener('resize',()=>close());
    window.PaletteWorkbench={render,open,close,restore(color){const deleted=JSON.parse(localStorage.getItem('badnotes_deleted_colors')||'[]');if(!customPalette.includes(color))customPalette.splice(Math.min(Math.max(0,defaultKeyboardColorSlots.indexOf(color)),customPalette.length),0,color);localStorage.setItem('badnotes_deleted_colors',JSON.stringify(deleted.filter(c=>c.color!==color)));savePalette();render();}};
})();
