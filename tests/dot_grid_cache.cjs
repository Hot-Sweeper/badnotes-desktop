const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/modules/03_canvas_core.js'),'utf8');
let builds=0,arcs=0;
class Path2D{constructor(){builds++;this.dots=[];}moveTo(){}arc(x,y,r){arcs++;this.dots.push([x,y,r]);}}
const context=vm.createContext({Path2D,Math,Map});
vm.runInContext(source.slice(source.indexOf('        let _dotGridPath ='),source.indexOf('        function drawPaperEdgeShadow(')),context);
const first=context.getDotGridPath(64,48);context.getDotGridPath(8,8);
assert.equal(context.getDotGridPath(64,48),first,'Back-and-forth zoom reuses the exact existing vector path');
const before=arcs;for(let i=0;i<120;i++)context.getDotGridPath(i%2?8:64,i%2?8:48);
assert.equal(arcs,before,'Warm pinch frames create no new circle geometry');
assert.deepEqual(first.dots[0],[0,0,1.5]);assert.deepEqual(first.dots.at(-1),[63*24,47*24,1.5]);
for(let n=1;n<=100;n++)context.getDotGridPath(n,n+10);
assert(vm.runInContext('dotGridCachedCount<=MAX_CACHED_DOT_COUNT&&dotGridPaths.size<=32',context),'Total retained geometry must stay bounded');
assert.equal(context.getDotGridPath(200,251),null,'Huge custom pages keep their existing visible-only fallback');
console.log(JSON.stringify({passed:true,builds,warmArcs:0,boundedDots:vm.runInContext('dotGridCachedCount',context)}));
