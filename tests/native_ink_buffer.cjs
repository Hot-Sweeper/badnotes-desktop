const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../static/js/modules/03_canvas_core.js'),'utf8');
const start = source.indexOf('        function drawNativeInkSnapshot(');
const end = source.indexOf('        function primeNativeInkSnapshot(',start);
let resizes=0,clears=0,lastBlit;
const offscreen = {setTransform(){},clearRect(){clears++;},drawImage(){}};
const surface = {getContext:()=>offscreen};
for(const dimension of ['width','height']) {
    let value=0;
    Object.defineProperty(surface,dimension,{get:()=>value,set:next=>{value=next;resizes++;}});
}
const context = vm.createContext({strokes:[{tool:'pen'}],settings:{theme:'light'},isDarkMode:false,
    nativeInkSnapshot:null,strokeCacheVersion:1,zoom:1,baseDPR:1.4,
    getNativeInkBounds:()=>null,
    vectorStrokeCommandsCache:null,trimNativeInkTiles(){},nativeInkPixelBudget:()=>Infinity,
    document:{createElement:()=>surface},drawVectorStrokeCommands(){},drawStrokeToContext(){},
    ctx:{save(){},restore(){},setTransform(){},drawImage(...args){lastBlit=args;}}});
vm.runInContext(source.slice(start,end),context);
vm.runInContext(source.slice(source.indexOf('        const inkSamplingPyramids='),source.indexOf('        // Debug-only FPS')),context);
context.drawNativeInkSnapshot({x:0,y:0,w:1200,h:800},0,0,0,0);
assert.equal(resizes,2);
context.zoom=2;
context.drawNativeInkSnapshot({x:0,y:0,w:600,h:400},0,0,0,0);
assert.equal(resizes,2,'Zoom rebuild must reuse the existing GPU allocation');
assert.equal(clears,2,'A reused surface must clear old ink before rebuilding');
assert.equal(lastBlit.length,9,'Blit must sample only the visible source region');
assert(lastBlit[3]<surface.width && lastBlit[4]<surface.height);
assert(context.nativeInkSnapshot.zoom>=context.zoom,'Ink must never be magnified below native detail');
console.log('Native ink buffer: allocation reused, old ink cleared, visible-region crop and native detail passed.');
