/* Touch contact is not reliably reflected by Chromium's :active pseudo-class.
 * Visual feedback only: leave native clicks, scrolling and capture untouched. */
(() => {
    const selector='#addPageBtn,#newNotebookBtn,#addColorBtn,.theme-choice,.accent-choice,#lassoActionMenu button',contacts=new Map();
    const buttonFor=event=>event.target instanceof Element?event.target.closest(selector):null;
    function release(id){
        const button=contacts.get(id);contacts.delete(id);
        if(button&&![...contacts.values()].includes(button))button.classList.remove('touch-feedback');
    }
    document.addEventListener('pointerdown',event=>{
        if(event.pointerType!=='touch')return;
        const button=buttonFor(event);if(!button||button.disabled)return;
        button.dataset.touchInput='true';contacts.set(event.pointerId,button);
        button.classList.add('touch-feedback');
    },{capture:true,passive:true});
    document.addEventListener('pointermove',event=>{
        const button=contacts.get(event.pointerId);
        if(button){
            const r=button.getBoundingClientRect();
            button.classList.toggle('touch-feedback',event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom);
        }else if(event.pointerType!=='touch'&&!event.sourceCapabilities?.firesTouchEvents){
            // An actual mouse/pen movement restores normal cursor hover. Touch
            // release itself must not leave Chromium's sticky hover highlighted.
            const target=buttonFor(event);if(target)delete target.dataset.touchInput;
        }
    },{capture:true,passive:true});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>release(event.pointerId),{capture:true,passive:true});
    window.addEventListener('blur',()=>{for(const id of [...contacts.keys()])release(id);});
})();
