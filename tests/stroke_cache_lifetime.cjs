const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/modules/03_canvas_core.js'),'utf8'),jobs=[],surfaces=[],freed=[];let clock=0;
const factory=()=>{const c={width:300,height:150,getContext:()=>({setTransform(){}})};surfaces.push(c);return c;};
const old={width:2000,height:2000};
const context=vm.createContext({Math,baseDPR:1.4,baseWidth:800,baseHeight:1100,zoom:2,strokeCacheVersion:1,strokeCacheBuildId:0,strokes:Array.from({length:40},()=>({tool:'pen'})),
    strokeCacheValid:false,strokeCacheCanvas:old,strokeCacheCtx:null,lastCachedStrokeCount:0,lastCachedStrokeVersion:0,lastCachedZoom:1,
    isDrawing:false,gesturePreviewActive:true,isPinching:false,isPanning:false,isPointerPanning:false,isWheelZooming:false,
    window:{},document:{createElement:factory},performance:{now:()=>clock+=.25},requestIdleCallback:f=>jobs.push(f),drawStrokeToContext(){},
    invalidateBitmapSampling:c=>freed.push(c),primeInkSamplingLevels(){},vectorStrokeCommandsCache:{version:1},settings:{theme:'light'},isDarkMode:false,redrawCanvas(){}});
vm.runInContext(source.slice(source.indexOf('        let strokeCacheBuildSurface ='),source.indexOf('        // Derived vector batches')),context);
vm.runInContext(source.slice(source.indexOf('        function getStrokeCacheZoom('),source.indexOf('        // Reusable temp canvas for highlighter')),context);
context.beginStrokeCacheBuild(2);const first=surfaces.at(-1);assert.equal(first.width,300,'A paused build does not allocate the full page');jobs.shift()();assert.equal(first.width,300,'Interaction leaves allocation deferred');
context.beginStrokeCacheBuild(2);assert.equal(first.width,0,'Superseding a build releases its storage immediately');
context.gesturePreviewActive=false;while(jobs.length)jobs.shift()();
assert(context.strokeCacheValid);assert(context.strokeCacheCanvas.width>1000);assert.equal(old.width,0,'A completed build releases the retired full-page surface');assert(freed.includes(old));
context.strokeCacheValid=false;context.beginStrokeCacheBuild(3);jobs.shift()();const cancelled=surfaces.at(-1);assert(cancelled.width>1000);context.strokeCacheBuildId++;context.releasePendingStrokeCacheBuild();assert.equal(cancelled.width,0,'Cancelling a partially rendered build frees its GPU backing');while(jobs.length)jobs.shift()();
console.log('Stroke cache lifetime: deferred allocation, cancelled builds and retired raster/mip storage released safely.');
