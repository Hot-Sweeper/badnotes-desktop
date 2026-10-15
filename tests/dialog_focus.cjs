const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const listeners=[],frames=new Map();let serial=0,focused=null;
const element=name=>({name,isConnected:true,getClientRects:()=>[{}],closest:()=>null,focus(){focused=this;document.activeElement=this;}});
const previous=element('launch button'),a=element('first'),b=element('last');
const document={activeElement:previous,addEventListener:(type,fn,options)=>listeners.push({type,fn,options})};
const root={...element('dialog'),querySelector:selector=>selector==='[role="dialog"]'?root:a,querySelectorAll:()=>[a,b]};
const context=vm.createContext({window:{},document,requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/js/ui/DialogFocus.js'),'utf8'),context);
const focus=context.window.DialogFocus;
for(let i=0;i<100;i++){focus.activate(root,{initialFocus:a});focus.deactivate(root);}
assert.equal(frames.size,0,'Cancelled sheets retain no pending focus callbacks');assert.equal(listeners.length,4,'Listeners are shared, never per-open');
let closed=0;focus.activate(root,{initialFocus:a,close(){closed++;focus.deactivate(root);}});
const callback=[...frames.values()][0];frames.clear();callback();assert.equal(focused,a);
const handler=listeners.find(l=>l.type==='keydown'&&l.options===true).fn;
function key(key,shiftKey=false){const event={key,shiftKey,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};handler(event);return event;}
assert(key('Tab',true).prevented);assert.equal(focused,b,'Shift+Tab wraps to the final control');key('Tab');assert.equal(focused,a);
assert(key('Escape').stopped);assert.equal(closed,1);assert.equal(focused,previous);assert(!focus.active);
focus.activate(root,{initialFocus:a});focus.activate(root,{initialFocus:b});assert.equal(frames.size,1,'Repeated show on an already-open sheet adds no work');focus.deactivate(root);
console.log(JSON.stringify({passed:true,sharedListeners:4,pendingFramesAfter100Dismissals:frames.size,focusWrap:true,restoration:true}));
