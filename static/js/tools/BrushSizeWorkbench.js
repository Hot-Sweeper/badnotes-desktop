/** Compact nib button; existing size/pressure controls keep their integrations. */
window.BrushSizeWorkbench=(()=>{
    let panel,observer,positionFrame=0;
    const bound=new WeakSet(),presets=[.5,1,1.5,2,3,5,8,10];
    const format=value=>Number(Number(value).toFixed(1)).toString();
    const button=()=>document.getElementById('brushSizeButton');
    const slider=()=>document.getElementById('sizeSlider');
    function createPanel(){
        if(panel)return;
        panel=document.createElement('section');panel.id='brushSizePanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','brushSizeTitle');
        panel.innerHTML=`<header><div class="brush-size-heading"><strong id="brushSizeTitle">Stroke size</strong><small>Width in page pixels.</small></div><button id="brushSizeClose" type="button" aria-label="Close stroke size"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
            <div class="brush-size-body"><div class="brush-size-preview" aria-hidden="true"><svg viewBox="0 0 280 86"><path id="brushSizeSample" d="M18 57 C55 78 73 5 115 24 S164 78 198 47 S245 15 262 28" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="brush-size-presets" aria-label="Stroke width presets">${presets.map(size=>`<button type="button" class="brush-size-preset" data-brush-size="${size}" aria-pressed="false" aria-label="${size} pixels"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="${Math.max(1,size/2)}" fill="currentColor"/></svg><span>${size}</span></button>`).join('')}</div>
            <div class="brush-size-adjustment"><div id="brushSizeSliderHost"></div><label class="brush-size-number-wrap"><input id="brushSizeNumber" type="number" min="0.5" max="10" step="0.1" aria-label="Stroke width in pixels"><span>px</span></label></div><div id="brushSizeValueHost"></div>
            <label class="brush-pressure-row" for="dynamicBrushToggle"><span class="brush-pressure-copy"><strong>Pressure-sensitive ink</strong><small>Let the pen vary the line width.</small></span><span class="brush-pressure-control" id="brushSizePressureHost"></span></label></div>`;
        document.body.append(panel);
        panel.querySelector('#brushSizeClose').onclick=()=>close(true);
        panel.querySelector('#brushSizeNumber').addEventListener('input',e=>{if(e.target.value!==''&&e.target.validity.badInput===false)setSize(Number(e.target.value));});
        panel.querySelector('#brushSizeNumber').addEventListener('change',e=>{e.target.value=format(currentSize);sync();});
        panel.addEventListener('click',e=>{const preset=e.target.closest('[data-brush-size]');if(preset)setSize(Number(preset.dataset.brushSize));});
        document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!e.target.closest('#brushSizeButton'))close();});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close(true);e.stopPropagation();}},true);
        window.addEventListener('resize',schedulePosition);
        // The toolbar itself is draggable. Track only while this panel is open.
        document.addEventListener('pointermove',e=>{if(!panel.hidden&&e.target.closest?.('.toolbar-drag-handle'))schedulePosition();});
    }
    function mount(){
        createPanel();close();baseBrushSize=currentSize;
        const toolbar=document.querySelector('.floating-toolbar'),input=toolbar?.querySelector('#sizeSlider'),value=toolbar?.querySelector('#sizeValue'),pressure=toolbar?.querySelector('#dynamicBrushToggle');
        if(input){
            close();const slot=input.closest('.size-slider-wrapper')||input;
            button()?.remove();
            const control=document.createElement('button');control.type='button';control.className='tool-btn';control.id='brushSizeButton';control.dataset.toolbarItem='sizeSlider';control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-controls','brushSizePanel');control.setAttribute('aria-expanded','false');
            control.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><circle id="brushSizeDot" cx="10" cy="10" r="1" fill="currentColor"/></svg><span class="brush-size-label"></span>';
            slot.before(control);control.onclick=open;
            if(slot.draggable)control.draggable=true;
            panel.querySelector('#brushSizeSliderHost').replaceChildren(input);input.setAttribute('aria-label','Stroke width');input.value=currentSize;
            if(value)panel.querySelector('#brushSizeValueHost').replaceChildren(value);
            if(slot!==input)slot.remove();
        }
        if(pressure){
            const label=pressure.closest('label');panel.querySelector('#brushSizePressureHost').replaceChildren(pressure);
            pressure.setAttribute('role','switch');pressure.setAttribute('aria-label','Pressure-sensitive ink');label?.remove();
        }
        // Hidden/customized size sections still need these IDs for pen-barrel
        // adjustment and the existing Settings integration.
        if(!slider()){
            const input=document.createElement('input');input.id='sizeSlider';input.className='size-slider';input.type='range';input.min='.5';input.max='10';input.step='.1';input.value=currentSize;input.setAttribute('aria-label','Stroke width');panel.querySelector('#brushSizeSliderHost').append(input);
        }
        if(!document.getElementById('sizeValue')){const value=document.createElement('span');value.id='sizeValue';panel.querySelector('#brushSizeValueHost').append(value);}
        if(!document.getElementById('dynamicBrushToggle')){const input=document.createElement('input');input.type='checkbox';input.id='dynamicBrushToggle';input.setAttribute('role','switch');input.setAttribute('aria-label','Pressure-sensitive ink');panel.querySelector('#brushSizePressureHost').append(input);}
        const toggle=document.getElementById('dynamicBrushToggle');
        if(!panel.querySelector('.brush-pressure-track')){const track=document.createElement('span');track.className='brush-pressure-track';track.setAttribute('aria-hidden','true');panel.querySelector('#brushSizePressureHost').append(track);}
        // Replacing the checkbox above also replaces its old track.
        if(!bound.has(slider())){bound.add(slider());slider().addEventListener('input',()=>{currentSize=Number(slider().value);baseBrushSize=currentSize;sync();});}
        if(!bound.has(toggle)){bound.add(toggle);toggle.addEventListener('change',()=>{dynamicBrushEnabled=toggle.checked;settings.dynamicBrushEnabled=dynamicBrushEnabled;sync();});}
        observer?.disconnect();observer=new MutationObserver(sync);observer.observe(document.getElementById('sizeValue'),{childList:true,subtree:true,characterData:true});
        sync();
    }
    function sync(){
        if(!panel)return;
        const input=slider();if(!input)return;
        const size=Number.isFinite(currentSize)?currentSize:1.5,label=format(size),control=button(),ink=getThemedColor(currentColor);
        input.value=size;
        const value=document.getElementById('sizeValue');if(value&&value.textContent!==label+'px')value.textContent=label+'px';
        const numeric=panel.querySelector('#brushSizeNumber');numeric.min=input.min;numeric.max=input.max;numeric.step=input.step;
        if(document.activeElement!==numeric)numeric.value=label;
        if(control){control.title=`Stroke size: ${label}px`;control.setAttribute('aria-label',`Stroke size, ${label} pixels`);control.querySelector('.brush-size-label').textContent=label;control.querySelector('circle').setAttribute('r',Math.max(1,size/2));control.querySelector('svg').style.color=ink;}
        panel.querySelector('#brushSizeSample').setAttribute('stroke',ink);panel.querySelector('#brushSizeSample').setAttribute('stroke-width',size);
        panel.querySelectorAll('[data-brush-size]').forEach(el=>el.setAttribute('aria-pressed',String(Math.abs(Number(el.dataset.brushSize)-size)<.05)));
        document.getElementById('dynamicBrushToggle').checked=!!dynamicBrushEnabled;
    }
    function setSize(value){
        const input=slider();if(!input||!Number.isFinite(value))return;
        input.value=Math.max(Number(input.min),Math.min(Number(input.max),value));input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    function close(focus=false){if(!panel)return;panel.hidden=true;const control=button();control?.setAttribute('aria-expanded','false');control?.classList.remove('active');if(focus)control?.focus();}
    function open(){
        if(!panel)mount();if(!button())return;if(!panel.hidden){close();return;}
        sync();panel.hidden=false;button().setAttribute('aria-expanded','true');button().classList.add('active');position();slider().focus({preventScroll:true});
    }
    function schedulePosition(){if(!positionFrame)positionFrame=requestAnimationFrame(()=>{positionFrame=0;position();});}
    function position(){
        if(!panel||panel.hidden)return;
        const anchor=button()?.getBoundingClientRect();if(!anchor){close();return;}
        const margin=12,gap=12,width=panel.offsetWidth,above=anchor.top-gap-margin,below=innerHeight-anchor.bottom-gap-margin,up=above>=below;
        const height=Math.max(90,up?above:below);panel.style.maxHeight=height+'px';panel.querySelector('.brush-size-body').style.maxHeight=Math.max(40,height-64)+'px';
        panel.style.left=Math.max(margin,Math.min(innerWidth-width-margin,anchor.left+anchor.width/2-width/2))+'px';
        panel.style.top=(up?Math.max(margin,anchor.top-gap-panel.offsetHeight):anchor.bottom+gap)+'px';
    }
    const originalColor=setColor;setColor=function(...args){const result=originalColor(...args);sync();return result;};
    const originalTheme=applyTheme;applyTheme=function(...args){const result=originalTheme(...args);sync();return result;};
    window.addEventListener('toolbarRendered',mount);
    return{open,close,sync,setSize,mount};
})();
