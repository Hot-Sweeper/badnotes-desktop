/** One keyboard/focus lifecycle for sheets. No polling or per-open listeners. */
window.DialogFocus=(()=>{
    let session=null,focusFrame=0;
    const focusable='button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';
    const visible=element=>element.getClientRects().length&&!element.closest('[hidden],[inert]');
    function deactivate(root,restore=true){
        if(session?.root!==root)return;
        cancelAnimationFrame(focusFrame);focusFrame=0;
        const previous=session.previous;session=null;
        if(restore&&previous?.isConnected&&visible(previous))previous.focus({preventScroll:true});
    }
    function activate(root,{close,initialFocus}={}){
        if(session?.root===root)return;
        cancelAnimationFrame(focusFrame);focusFrame=0;
        const previous=session?.previous||document.activeElement;
        session={root,close,previous};
        const dialog=root.querySelector('[role="dialog"]')||root;
        dialog.tabIndex=-1;
        const opened=session;
        focusFrame=requestAnimationFrame(()=>{
            focusFrame=0;if(session!==opened)return;
            const target=typeof initialFocus==='string'?root.querySelector(initialFocus):initialFocus;
            (target||[...root.querySelectorAll(focusable)].find(visible)||dialog).focus({preventScroll:true});
        });
    }
    document.addEventListener('keydown',event=>{
        if(!session)return;
        if(!session.root.isConnected){session=null;return;}
        if(event.key==='Escape'&&session.close){event.preventDefault();event.stopImmediatePropagation();session.close();return;}
        if(event.key!=='Tab')return;
        const items=[...session.root.querySelectorAll(focusable)].filter(visible),index=items.indexOf(document.activeElement);
        event.preventDefault();event.stopImmediatePropagation();
        const next=index<0?(event.shiftKey?items.length-1:0):(index+(event.shiftKey?-1:1)+items.length)%items.length;
        (items[next]||session.root.querySelector('[role="dialog"]')||session.root).focus({preventScroll:true});
    },true);
    // Input continues to reach its own target handlers/native editing, but not
    // document-wide handwriting, canvas or assistant shortcuts underneath.
    for(const type of ['keydown','keypress','keyup'])document.addEventListener(type,event=>{
        if(session)event.stopImmediatePropagation();
    });
    return{activate,deactivate,get active(){return !!session;}};
})();
