const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/tools/PageThumbnails.js'),'utf8');
const timers=[];let queues=0,clocks=0;
const context=vm.createContext({Map,queued:true,gesturePreviewActive:true,isPinching:false,isPanning:false,isPointerPanning:false,isWheelZooming:false,
    window:{},setTimeout:(fn,ms)=>{timers.push({fn,ms});},queue:()=>queues++,performance:{now:()=>{clocks++;return 0;}},records:new Map(),pages:[],currentPageIndex:0});
vm.runInContext(source.slice(source.indexOf('    function run(){'),source.indexOf('    function attach(')),context);
context.run();assert.equal(timers.length,1);assert.equal(timers[0].ms,80);assert.equal(clocks,0,'Queued thumbnail geometry must not steal a camera frame');assert(context.queued,'Keep one deferred job, not one retry per input event');
context.gesturePreviewActive=false;timers[0].fn();assert.equal(queues,1);assert(!context.queued);context.run();assert.equal(clocks,1,'Idle work resumes after navigation');
context.window.DragMotion={shelfBusy:true};context.queued=true;context.run();assert.equal(clocks,1,'Pickup and spring-return frames also defer heavy thumbnail jobs');
context.window.DragMotion.shelfBusy=false;timers[1].fn();context.run();assert.equal(clocks,2,'Thumbnail work resumes after landing');
console.log('Thumbnail gesture priority: camera and shelf motion defer background work with one retry; idle rendering resumes.');
