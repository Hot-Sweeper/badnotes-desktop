/* Appearance is chrome, not document data. Never recolor ink/covers or rebuild
 * the ink cache when only the interface tone changes. Preview roles come directly
 * from the same stylesheet used by the real canvas and thumbnails. */
(() => {
    const root = document.documentElement;
    const modes = [['light','Light','Clear & airy'],['dark','Dark','Soft charcoal'],['oled','OLED','True black']];
    const accents = {
        iris: {name:'Iris',solid:'#7640fd'},
        rose: {name:'Rose',solid:'#9e365f'},
        lagoon: {name:'Lagoon',solid:'#236d6d'},
        ocean: {name:'Ocean',solid:'#325faf'},
        sage: {name:'Sage',solid:'#386847'},
        amber: {name:'Amber',solid:'#865910'}
    };
    const toneRoles=['surround','shelf','surface','field','hover','selected','notebook-selected','text','secondary','muted','disabled','border','divider','scrim','shadow','sheet-shadow','paper-shadow','paper-active-shadow'];
    const selectionRoles=['--selection-accent','--selection-highlight','--selection-surface'];
    const paperRoles=['--ui-paper','--ui-grid','--ui-dots','--ui-paper-edge','--ui-thumbnail-edge','--ui-thumbnail-active-edge'];
    const overrideKeys = [...toneRoles.map(role=>'--ui-'+role),...selectionRoles,...paperRoles,'--ui-accent','--ui-accent-hover','--ui-accent-soft','--ui-action-solid','--brand-fill','--brand-fill-hover','--brand-wash','--brand-wash-hover'];
    let roleCache;
    function palette(mode) {
        if (!roleCache) {
            roleCache = {};
            const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/theme-palettes.css'));
            for (const rule of sheet?.cssRules || []) {
                const match = /html\[data-theme="(dark|light|oled)"\]$/.exec(rule.selectorText || '');
                if (!match) continue;
                roleCache[match[1]] = Object.fromEntries([...rule.style].filter(k => k.startsWith('--ui-')).map(k => [k,rule.style.getPropertyValue(k).trim()]));
            }
        }
        return {...roleCache.dark,...roleCache[mode]};
    }
    const toneCache=new Map();
    const linear=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
    const gamma=n=>n<=.0031308?n*12.92:1.055*n**(1/2.4)-.055;
    const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    function parseColor(color){
        if(color.startsWith('#')){let hex=color.slice(1);if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');return[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),1];}
        const numbers=color.match(/[\d.]+/g)?.map(Number);return numbers?.length>=3?[...numbers.slice(0,3),numbers[3]??1]:null;
    }
    function lab(rgb){
        const [r,g,b]=rgb.map(n=>linear(n/255));
        const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
        return[.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
    }
    function fromLab(L,a,b){
        const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
        return[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
    }
    function rotateColor(color,offset,vivid=false,action=false){
        const parsed=parseColor(color);if(!parsed)return color;
        const [L,a,b]=lab(parsed.slice(0,3)),chroma=Math.hypot(a,b)*(vivid?1.35:1);if(chroma<.0001)return color; // Exact white/black/neutral values.
        const hue=Math.atan2(b,a)+offset,originalY=luminance(parsed.slice(0,3).map(n=>linear(n/255))),Y=action?Math.min(.18,originalY*1.10):vivid?Math.min(.95,originalY*1.10):originalY;
        const candidate=C=>{const rgb=fromLab(L,C*Math.cos(hue),C*Math.sin(hue)),scale=Y/luminance(rgb);return rgb.map(n=>n*scale);};
        const inGamut=rgb=>rgb.every(n=>Number.isFinite(n)&&n>=-1e-8&&n<=1+1e-8);
        let rgb=candidate(chroma);
        if(!inGamut(rgb)){
            // Reduce only out-of-gamut chroma, never clip channels (which would
            // change hue or brightness). Materials keep Iris's luminance;
            // interactive accents may be vivid, with readable white labels.
            let low=0,high=chroma;for(let i=0;i<18;i++){const mid=(low+high)/2;if(inGamut(candidate(mid)))low=mid;else high=mid;}rgb=candidate(low);
        }
        return`rgba(${rgb.map(n=>(gamma(Math.max(0,Math.min(1,n)))*255).toFixed(3)).join(',')},${parsed[3]})`;
    }
    function tonedPalette(mode,accent){
        const original=palette(mode);if(accent==='iris'||!accents[accent])return original;
        const key=mode+':'+accent;if(toneCache.has(key))return toneCache.get(key);
        const reference=lab(parseColor(accents.iris.solid).slice(0,3)),target=lab(parseColor(accents[accent].solid).slice(0,3));
        const offset=Math.atan2(target[2],target[1])-Math.atan2(reference[2],reference[1]);
        const resolve=value=>value.replace(/var\((--brand-[\w-]+)\)/g,(_,name)=>getComputedStyle(root).getPropertyValue(name).trim());
        const recolor=(value,vivid=false,action=false)=>resolve(value).replace(/#[\da-f]{6}|#[\da-f]{3}\b|rgba?\([^)]*\)/gi,color=>rotateColor(color,offset,vivid,action));
        const roles={...original};
        for(const name of [...toneRoles.map(role=>'--ui-'+role),...paperRoles,'--ui-accent','--ui-accent-hover','--ui-accent-soft','--ui-action-solid'])if(original[name])roles[name]=recolor(original[name],['--ui-accent','--ui-accent-hover','--ui-action-solid'].includes(name),name==='--ui-action-solid');
        const light=mode==='light',oled=mode==='oled';
        roles['--selection-accent']=rotateColor(light?'#7640fd':'#c39cf8',offset,true);
        roles['--selection-highlight']=rotateColor(light?'#9a4cfd':'#edd3fd',offset,true);
        roles['--selection-surface']=rotateColor(light?'#f4e8fb':oled?'#201527':'#302439',offset);
        roles['--brand-fill']=`linear-gradient(115deg,${rotateColor('#7640fd',offset,true,true)},${rotateColor('#7f43fd',offset,true,true)})`;
        roles['--brand-fill-hover']=`linear-gradient(115deg,${rotateColor('#5b23c5',offset,true,true)},${rotateColor('#7640fd',offset,true,true)})`;
        roles['--brand-wash']=`linear-gradient(110deg,color-mix(in srgb,${rotateColor('#7640fd',offset)} 10%,transparent),color-mix(in srgb,${rotateColor('#edd3fd',offset)} 26%,transparent))`;
        roles['--brand-wash-hover']=`linear-gradient(110deg,color-mix(in srgb,${rotateColor('#7640fd',offset)} 20%,transparent),color-mix(in srgb,${rotateColor('#edd3fd',offset)} 34%,transparent))`;
        toneCache.set(key,roles);return roles;
    }
    const check = '<span class="appearance-check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6"/></svg></span>';
    function build() {
        const themes = document.getElementById('themeChoices'), colors = document.getElementById('accentChoices');
        if (!themes || !colors) return;
        themes.innerHTML = modes.map(([id,name,description]) => `<button type="button" class="theme-choice" role="radio" aria-checked="false" aria-label="${name}: ${description}" data-theme-choice="${id}" tabindex="-1">
            <span class="appearance-mini" aria-hidden="true"><span class="mini-shelf mini-shelf-left"><i class="mini-book"></i><i></i><i></i><i></i></span><span class="mini-shelf mini-shelf-right"><i></i><i></i></span><span class="mini-clock"></span><span class="mini-page"><svg viewBox="0 0 60 70"><path d="M10 19c8-8 13 9 21-2s11-3 17-7M10 32c6-5 13 6 20 1s12-2 16-5M13 49c8-13 24-12 29 0s-8 10-12 6"/></svg></span><span class="mini-dock"><i class="mini-tool"></i><i></i><i></i><i></i><i></i></span></span>
            <span class="theme-choice-caption"><span>${name}</span>${check}</span><span class="theme-choice-description">${description}</span></button>`).join('');
        colors.innerHTML = Object.entries(accents).map(([id,a]) => `<button type="button" class="accent-choice" role="radio" aria-checked="false" data-accent-choice="${id}" tabindex="-1"><span class="accent-dot" aria-hidden="true"></span><span>${a.name}</span>${check}</button>`).join('');
        bindGroup(themes,'themeChoice',selectMode);
        bindGroup(colors,'accentChoice',selectAccent);
    }
    function bindGroup(group,key,select) {
        const buttons = [...group.querySelectorAll('[role="radio"]')];
        group.addEventListener('click',e => {
            const button = e.target.closest('[role="radio"]');
            if (button && group.contains(button)) select(button.dataset[key]);
        });
        group.addEventListener('keydown',e => {
            const index = buttons.indexOf(e.target);
            if (index < 0 || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End',' ','Enter'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const next = e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:['ArrowRight','ArrowDown'].includes(e.key)?1:0)+buttons.length)%buttons.length;
            select(buttons[next].dataset[key]); buttons[next].focus({preventScroll:true});
        });
    }
    function sync() {
        const mode = modes.some(([id]) => id===settings.theme)?settings.theme:'dark';
        const accent = Object.hasOwn(accents,settings.accentTheme)?settings.accentTheme:'iris';
        const selected = accents[accent];
        const input = document.getElementById('settingsTheme'); if (input) input.value=mode;
        document.querySelectorAll('[data-theme-choice]').forEach(button => {
            const id=button.dataset.themeChoice, roles=tonedPalette(id,accent), mini=button.querySelector('.appearance-mini');
            const colors=[roles['--ui-accent'],roles['--ui-accent-hover'],roles['--ui-accent-soft']];
            for (const role of ['surround','shelf','paper','surface','border','dots']) mini.style.setProperty('--preview-'+role,roles['--ui-'+role]);
            mini.style.setProperty('--preview-accent',colors[0]); mini.style.setProperty('--preview-soft',colors[2]); mini.style.setProperty('--preview-ink',id==='light'?'#000000':'#ffffff');
            button.setAttribute('aria-checked',String(id===mode)); button.tabIndex=id===mode?0:-1;
        });
        document.querySelectorAll('[data-accent-choice]').forEach(button => {
            const id=button.dataset.accentChoice;
            button.style.setProperty('--choice-color',tonedPalette(mode,id)['--ui-accent']);
            button.setAttribute('aria-checked',String(id===accent)); button.tabIndex=id===accent?0:-1;
        });
        const label=document.getElementById('appearanceAccentName'); if (label) label.textContent=selected.name;
    }
    function applyAccent(mode,accent) {
        if (!Object.hasOwn(accents,accent)) accent='iris';
        settings.accentTheme=accent;
        root.dataset.accent=accent;
        for (const key of overrideKeys) root.style.removeProperty(key);
        if (accent!=='iris') {
            const roles=tonedPalette(mode,accent);
            for(const role of ['--ui-accent','--ui-accent-hover','--ui-accent-soft','--ui-action-solid','--brand-fill','--brand-fill-hover','--brand-wash','--brand-wash-hover'])root.style.setProperty(role,roles[role]);
            for(const role of toneRoles)if(roles['--ui-'+role])root.style.setProperty('--ui-'+role,roles['--ui-'+role]);
            for(const role of selectionRoles)root.style.setProperty(role,roles[role]);
            for(const role of paperRoles)if(roles[role])root.style.setProperty(role,roles[role]);
        }
        sync();
    }
    function persist() {
        try {
            let stored;
            try { stored=JSON.parse(localStorage.getItem('badnotes_settings')||'{}'); } catch { stored={}; }
            if (!stored || typeof stored!=='object' || Array.isArray(stored)) stored={};
            localStorage.setItem('badnotes_settings',JSON.stringify({...stored,theme:settings.theme,accentTheme:settings.accentTheme}));
            localStorage.setItem('badnotes-theme',settings.theme);
        } catch(e) { console.warn('Failed to save appearance:',e); }
    }
    function selectMode(mode) {
        if (!modes.some(([id]) => id===mode)) return;
        if (settings.theme!==mode) { applyTheme(mode); updateThemeIcon(); }
        else sync();
        persist();
    }
    function selectAccent(accent) {
        if (!Object.hasOwn(accents,accent)) return;
        const changed=settings.accentTheme!==accent;
        applyAccent(settings.theme,accent); persist();
        if(changed){
            // The surround is a canvas color, not just CSS. Refresh its cheap
            // palette snapshot and repaint, but retain all ink/glyph caches.
            refreshCanvasThemePalette();redrawCanvas(true);window.PageThumbnails?.refreshAppearance();
            window.dispatchEvent(new CustomEvent('appearanceChanged',{detail:{theme:settings.theme,accent}}));
        }
    }
    window.AppearanceSettings={applyAccent,sync,selectMode,selectAccent,palette:tonedPalette};
    build(); sync();
})();
