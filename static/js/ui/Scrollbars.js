/** Quiet native scrollbars: fade after inactivity, reveal near their gutter.
 * No custom scroll physics, overlays, per-frame JS animation or input capture. */
(() => {
    const idleMs=1200,states=new WeakMap(),active=new Set();
    const selectors='#notebookList,#pageList,#recycleList,.modal-body,.bn-sheet-body,.geometry-body,.toolbox-drawer-items,.dropdown-menu,#lassoActionMenu,#lassoOptions,#textfield-settings-panel';
    function register(element){
        if(!(element instanceof HTMLElement))return null;
        let state=states.get(element);if(state)return state;
        state={element,timer:0,hover:false,pointer:null};states.set(element,state);
        // Append this one property to existing transitions, never replace a
        // palette's transform/opacity animation with the scrollbar's fade.
        const transition=getComputedStyle(element).transition;
        element.style.transition=transition+', --scrollbar-visibility .32s ease';
        element.classList.add('scrollbar-auto');
        element.addEventListener('pointerleave',()=>{state.hover=false;element.classList.remove('scrollbar-gutter-hover');schedule(state);},{passive:true});
        return state;
    }
    function schedule(state){
        clearTimeout(state.timer);
        state.timer=setTimeout(()=>{
            state.timer=0;
            if(state.element.isConnected&&(state.hover||state.pointer!==null))return;
            state.element.style.setProperty('--scrollbar-visibility','0');active.delete(state);
        },idleMs);
    }
    function show(element){
        const state=register(element);if(!state)return;
        state.element.style.setProperty('--scrollbar-visibility','1');active.add(state);schedule(state);
    }
    function scrollerFor(target){
        let element=target instanceof Element?target.closest('.scrollbar-auto,'+selectors):null;
        while(element){
            if(element.scrollHeight>element.clientHeight+1||element.scrollWidth>element.clientWidth+1){register(element);return element;}
            element=element.parentElement?.closest('.scrollbar-auto,'+selectors);
        }
        return null;
    }
    document.querySelectorAll(selectors).forEach(register);
    // Capture scroll events (which do not bubble), including newly created
    // popovers. Unregistered scrollers are discovered on their first scroll.
    document.addEventListener('scroll',e=>show(e.target),{capture:true,passive:true});
    document.addEventListener('wheel',e=>{const element=scrollerFor(e.target);if(element)show(element);},{capture:true,passive:true});
    document.addEventListener('pointermove',e=>{
        if(e.pointerType==='touch')return;
        const element=scrollerFor(e.target);if(!element)return;
        const state=states.get(element),rect=element.getBoundingClientRect();
        const near=element.scrollHeight>element.clientHeight+1&&e.clientX>=rect.right-14||element.scrollWidth>element.clientWidth+1&&e.clientY>=rect.bottom-14;
        if(near){state.hover=true;element.classList.add('scrollbar-gutter-hover');show(element);}
        else if(state.hover){state.hover=false;element.classList.remove('scrollbar-gutter-hover');schedule(state);}
    },{capture:true,passive:true});
    document.addEventListener('pointerdown',e=>{
        const element=scrollerFor(e.target);if(!element)return;
        const state=states.get(element);if(state.hover){state.pointer=e.pointerId;show(element);}
    },{capture:true,passive:true});
    const release=e=>{for(const state of active)if(state.pointer===e.pointerId){state.pointer=null;schedule(state);}};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(event,release,{capture:true,passive:true});
    window.addEventListener('blur',()=>{for(const state of active){state.hover=false;state.pointer=null;state.element.classList.remove('scrollbar-gutter-hover');schedule(state);}});
})();
