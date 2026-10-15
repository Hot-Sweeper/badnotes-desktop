// Stationary creation actions and rounded native window glyphs. No note edits.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const tab=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.title==='BadNotes');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const move=(x,y)=>call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0});
let theme,maximized;const nodes=[],reports=[];
try{
    await evaluate('saveCurrentPage()');await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    theme=await evaluate('settings.theme');maximized=await evaluate(`document.documentElement.classList.contains('window-maximized')`);
    await evaluate('saveSettings=()=>{}');
    await call('DOM.enable');await call('CSS.enable');const {root}=await call('DOM.getDocument');
    for(const selector of ['#newNotebookBtn','#addPageBtn']){const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector});nodes.push({selector,nodeId});}
    await evaluate(`window.actionStyle=q=>{const el=document.querySelector(q),s=getComputedStyle(el),fill=getComputedStyle(el,'::before'),press=getComputedStyle(el,'::after'),r=el.getBoundingClientRect();return{background:s.backgroundColor,fillOpacity:fill.opacity,pressOpacity:press.content==='none'?'0':press.opacity,fill:fill.background,color:s.color,shadow:s.boxShadow,transform:s.transform,border:s.borderTopWidth,radius:s.borderRadius,corner:s.cornerShape,outline:s.outlineWidth,duration:s.transitionDuration,rect:[r.x,r.y,r.width,r.height]};};`);
    for(const current of ['light','dark','oled']){
        await evaluate(`applyTheme(${JSON.stringify(current)});document.activeElement?.blur();`);await move(800,100);await wait(230);
        const actions=[];
        for(const {selector,nodeId}of nodes){
            const rest=await evaluate(`actionStyle(${JSON.stringify(selector)})`);
            assert.equal(rest.background,'rgba(0, 0, 0, 0)');assert.equal(rest.fillOpacity,'0');assert.equal(rest.pressOpacity,'0');assert.equal(rest.shadow,'none');assert.equal(rest.transform,'none');assert.equal(rest.border,'0px');assert.equal(rest.radius,'18px');assert.equal(rest.corner,'superellipse(2)');
            await move(rest.rect[0]+rest.rect[2]/2,rest.rect[1]+rest.rect[3]/2);await wait(230);
            const hover=await evaluate(`actionStyle(${JSON.stringify(selector)})`);assert.equal(hover.fillOpacity,'1',JSON.stringify({theme:current,selector,rest,hover}));assert.notEqual(hover.color,rest.color);assert.equal(hover.shadow,'none');assert.equal(hover.transform,'none');assert.deepEqual(hover.rect,rest.rect);
            await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover','active']});await wait(120);
            const pressed=await evaluate(`actionStyle(${JSON.stringify(selector)})`);assert.equal(pressed.fillOpacity,'1');assert.equal(pressed.pressOpacity,'0');assert.equal(pressed.color,hover.color);assert.equal(pressed.fill,hover.fill);assert.equal(pressed.shadow,'none');assert.equal(pressed.transform,'none');assert.deepEqual(pressed.rect,rest.rect);
            await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});await move(800,100);await wait(230);
            assert.equal((await evaluate(`actionStyle(${JSON.stringify(selector)})`)).fillOpacity,'0');
            await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['focus-visible']});await wait(230);
            const focus=await evaluate(`actionStyle(${JSON.stringify(selector)})`);assert.equal(focus.fillOpacity,'1');assert.equal(focus.fill,hover.fill);assert(parseFloat(focus.outline)>0);assert.equal(focus.shadow,'none');
            await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});actions.push({selector,rest,hover,pressed,focus});
        }
        assert(Math.abs(actions[0].rest.rect[1]-actions[1].rest.rect[1])<1);
        const controls=await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.window-control')];return buttons.map(el=>({action:el.dataset.windowAction,view:el.querySelector('svg').getAttribute('viewBox'),stroke:getComputedStyle(el.querySelector('svg')).strokeWidth,cap:getComputedStyle(el.querySelector('svg')).strokeLinecap,radius:getComputedStyle(el).borderRadius,title:el.title}));})()`);
        assert(controls.every(c=>c.view==='0 0 20 20'&&c.stroke==='1.7px'&&c.cap==='round'&&c.radius==='10px'));
        const right=await evaluate(`document.querySelector('.window-titlebar-controls').getBoundingClientRect().left`);
        const shot=await call('Page.captureScreenshot',{format:'png',clip:{x:right-12,y:0,width:Math.min(120,await evaluate('innerWidth')-right+12),height:54,scale:2}});
        await writeFile('/tmp/badnotes-window-glyphs-'+current+'.png',Buffer.from(shot.data,'base64'));reports.push({theme:current,actions,controls});
    }
    // The native maximize/restore state must keep the bespoke rounded icons.
    await evaluate('badnotesWindow.toggleMaximize()');await wait(450);
    const changed=await evaluate(`({maximized:document.documentElement.classList.contains('window-maximized'),title:document.querySelector('[data-window-action="maximize"]').title,radius:document.querySelector('[data-window-action="maximize"] rect').getAttribute('rx')})`);
    assert.equal(changed.maximized,!maximized);assert.equal(changed.title,changed.maximized?'Restore window':'Maximize window');assert.equal(changed.radius,changed.maximized?'2.8':'3.2');
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await evaluate(`actionStyle('#addPageBtn').duration`),'0s');
    console.log(JSON.stringify({passed:true,reports,changed,reducedMotion:true}));
}finally{
    for(const {nodeId}of nodes)await call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
    await call('Emulation.setEmulatedMedia',{features:[]});
    if(maximized!==undefined&&await evaluate(`document.documentElement.classList.contains('window-maximized')`)!==maximized){await evaluate('badnotesWindow.toggleMaximize()');await wait(450);}
    if(theme)await evaluate(`applyTheme(${JSON.stringify(theme)})`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);ws.close();
}
