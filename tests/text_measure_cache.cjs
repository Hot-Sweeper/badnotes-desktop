const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/modules/29_simple_text_field.js'),'utf8');
let measured=0;const ctx={font:'16px Test',measureText:text=>{measured++;return{width:text.length*7.25};}};
const context=vm.createContext({Map,fontMeasureCaches:new Map()});
vm.runInContext(source.slice(source.indexOf('    function getMeasureCacheForFont('),source.indexOf('    function init()')),context);
assert.equal(context.measurePlainTextCached(ctx,'hot line'),58);let hotCalls=0;
for(let i=0;i<6000;i++){
    context.measurePlainTextCached(ctx,'cold-'+i);const before=measured;
    assert.equal(context.measurePlainTextCached(ctx,'hot line'),58);hotCalls+=measured-before;
}
assert.equal(hotCalls,0,'LRU keeps frequently painted text through cache pressure');
let cache=context.getMeasureCacheForFont(ctx);assert(cache.textWidths.size<=4096&&cache.textChars<=131072);
for(let i=0;i<3000;i++)context.measurePlainTextCached(ctx,'x'.repeat(1000)+i);
cache=context.getMeasureCacheForFont(ctx);assert(cache.textChars<=131072,'Variable-length cache keys have an explicit memory budget');
const big='y'.repeat(10000);assert.equal(context.measurePlainTextCached(ctx,big),72500);assert(!cache.textWidths.has(big),'Long paragraph keys cannot consume the retained width budget');
for(let i=0;i<80;i++){
    ctx.font=i+'px Cold';context.measurePlainTextCached(ctx,'new size');ctx.font='16px Test';context.measurePlainTextCached(ctx,'hot line');
}
assert.equal(context.fontMeasureCaches.size,32);assert(context.fontMeasureCaches.has('16px Test'),'The currently used font survives size-preview churn');
vm.runInContext(source.slice(source.indexOf('    function getCharAdvanceWithTabs('),source.indexOf('    function measureTextWithTabs(')),context);
ctx.font='12px International';context.getCharAdvanceWithTabs(ctx,'a',0);let charCalls=0;
for(let i=0;i<1200;i++){
    context.getCharAdvanceWithTabs(ctx,String.fromCodePoint(0x400+i),0);const before=measured;
    assert.equal(context.getCharAdvanceWithTabs(ctx,'a',0),7.25);charCalls+=measured-before;
}
assert.equal(charCalls,0);assert.equal(context.getMeasureCacheForFont(ctx).charWidths.size,512);
console.log(JSON.stringify({passed:true,hotLineRemeasures:hotCalls,hotCharacterRemeasures:charCalls,fontLimit:32,textCharBudget:131072,exactWidths:true}));
