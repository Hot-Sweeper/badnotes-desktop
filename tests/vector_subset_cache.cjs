const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/modules/03_canvas_core.js'),'utf8');
class Path {constructor(){this.ids=[];}addPath(p){this.ids.push(...p.ids);}}
const members=Array.from({length:64},(_,id)=>({id,points:[{x:id*10,y:0}],bounds:{x:id*10,y:0,w:4,h:4}}));
const batch={kind:'path-batch',path:{ids:members.map(s=>s.id)},members,bounds:{x:0,y:0,w:644,h:4},size:2,color:'#fff'};
let painted;
const context=vm.createContext({Math,Map,Path2D:Path,strokeCacheVersion:1,vectorStrokeCommandsCache:{version:1,commands:[batch]},
    getNativeStrokeBounds:s=>s.bounds,getVectorPenPath:s=>({ids:[s.id]}),getThemedColor:c=>c,
    rectIntersect:(a,b)=>a.x<=b.x+b.w&&a.x+a.w>=b.x&&a.y<=b.y+b.h&&a.y+a.h>=b.y,
    ctx:{save(){},restore(){},stroke:path=>painted=path},drawStrokeToContext(){throw Error('A mostly visible merged batch must not become independent strokes');}});
vm.runInContext(source.slice(source.indexOf('        function drawVectorStrokeCommands('),source.indexOf('        function appendStrokeToCache(')),context);
const view={x:100,y:-10,w:300,h:30};context.drawVectorStrokeCommands(view);const first=painted;
assert.deepEqual(first.ids,members.slice(10,41).map(s=>s.id),'Only intersecting members reach GPU tessellation, in original order');
context.drawVectorStrokeCommands(view);assert.equal(painted,first,'Identical visible geometry retains its GPU path identity');
context.drawVectorStrokeCommands({...view,w:240});context.drawVectorStrokeCommands({...view,x:200});assert.equal(batch.visiblePaths.size,2,'Subset geometry has a bounded LRU');
console.log('Vector subsets: offscreen geometry culled, merged ordering preserved, GPU paths reused and cache bounded.');
