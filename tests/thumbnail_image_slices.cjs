const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/tools/PageThumbnails.js'),'utf8');
let clock=0,inkCopies=0,commits=0,queued=0;const drawn=[];
const ctx={save(){},restore(){},setTransform(){},drawImage(){inkCopies++;}};
const work={width:100,height:100},ink={width:100,height:100},content={width:100,height:100};
const page={id:'images',strokes:[],images:Array.from({length:8},(_,i)=>({id:i}))};
const display={...ctx,drawImage(){commits++;}},live={...ctx,clearRect(){}};
const job={page,d:{pw:100,ph:100,width:800,height:800},work,ink,content,ctx,paperCtx:{setTransform(){},drawImage(){}},inkCtx:{},index:0,imageIndex:0,inkCommitted:false,stage:0,fieldIndex:0,version:1};
const record={page,paper:{isConnected:true},canvas:{width:100,height:100,getContext:()=>display},live:{width:100,height:100,getContext:()=>live},visible:true,dirty:true,job,version:1};
const context=vm.createContext({Map,window:{},gesturePreviewActive:false,isPinching:false,isPanning:false,isPointerPanning:false,isWheelZooming:false,isPageResizing:false,isDrawing:false,currentStroke:null,settings:{theme:'dark'},queued:true,performance:{now:()=>clock},pages:[page],currentPageIndex:0,records:new Map([['images',record]]),queue:()=>queued++,current:()=>false,drawStrokeToContext(){},image:(_ctx,item)=>{drawn.push(item.id);clock+=4;},HandwrittenTextField:{},SimpleTextField:{}});
vm.runInContext(source.slice(source.indexOf('    function run(){'),source.indexOf('    function attach(')),context);
for(let i=0;i<8;i++){
    context.run();assert.equal(drawn.length,i+1,'Yield after each expensive image');assert.equal(commits,0,'Partially painted previews never replace completed ones');assert.equal(inkCopies,1,'Resuming an image slice must not replay/cover earlier layers');
}
context.run();assert.equal(commits,1);assert.equal(record.dirty,false);assert.equal(record.job,null);assert.deepEqual(drawn,[0,1,2,3,4,5,6,7]);assert.equal(queued,8);
console.log(JSON.stringify({passed:true,slices:8,inkCopies,atomicCommits:commits,orderPreserved:true}));
