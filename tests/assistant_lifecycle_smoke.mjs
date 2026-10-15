// Exercise actual assistant flows with a mocked provider only. No costs,
// document mutations, clipboard writes or preference changes are permitted.
import assert from 'node:assert/strict';
import {connect,wait} from './helpers/cdp.mjs';
const c=await connect(),{call,evaluate}=c;let storage;
try{
    await evaluate('saveCurrentPage()');storage=await evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))');
    await call('Page.reload',{ignoreCache:true});await wait(1800);await call('Page.bringToFront');
    await evaluate(`(()=>{
        saveCurrentPage=async()=>{};triggerAutoSave=()=>{};API.put=API.post=API.delete=async()=>{throw Error('Assistant fixtures cannot write notes');};
        pages=[{id:'assistant-fixture-page',width:800,height:1100,template:'blank',strokes:[],images:[],textFields:[],handwrittenTextFields:[]}];currentNotebook={id:'assistant-fixture',name:'Assistant QA',pages:pages.map(p=>p.id),trash:[],contentTrash:[]};notebooks=[currentNotebook];currentPageIndex=0;loadPage(0);clearMultiLassoSelections();
        window.aiCalls=[];window.aiDelay=200;window.aiFail=false;
        const original=fetch;fetch=async(url,o={})=>{if(url==='/api/ai/chat'){aiCalls.push(JSON.parse(o.body));await new Promise(r=>setTimeout(r,aiDelay));return new Response(JSON.stringify(aiFail?{error:'Mock service unavailable'}:{content:'## A clear answer\\n\\nThe result is **42**.'}),{status:aiFail?503:200,headers:{'Content-Type':'application/json'}});}if(o.method&&o.method!=='GET')throw Error('Assistant fixture write forbidden');return original(url,o);};
    })()`);
    const behavior=await evaluate(`(async()=>{
        const first=AIHelper.handleAIShortcut('general','Test question'),duplicate=AIHelper.handleAIShortcut('quick','Duplicate question');
        await new Promise(r=>setTimeout(r,40));const whilePending={calls:aiCalls.length,visible:!document.getElementById('ai-loading-preview').hidden};
        await Promise.all([first,duplicate]);const after={visible:document.getElementById('ai-response-modal').classList.contains('visible'),previewHidden:document.getElementById('ai-loading-preview').hidden,imagesRetained:document.querySelectorAll('.ai-preview-image').length,requestModel:aiCalls[0].model};
        AIHelper.closeResponse();aiFail=true;await AIHelper.handleAIShortcut('quick','Failure test');
        const failureHidden=document.getElementById('ai-loading-preview').hidden;
        aiFail=false;AIHelper.showPrompt();document.getElementById('aiPromptInput').value='New question';document.getElementById('aiModeSelect').value='general';document.getElementById('aiModelSelect').value='gemini-3.7-flash';document.querySelector('#ai-prompt-dialog form').requestSubmit();
        await new Promise(r=>setTimeout(r,300));return{whilePending,after,failureHidden,submits:aiCalls.length,lastModel:aiCalls.at(-1).model,context:aiCalls.at(-1).messages.at(-1).content};
    })()`);
    assert.deepEqual(behavior.whilePending,{calls:1,visible:true});assert(behavior.after.visible&&behavior.after.previewHidden);assert.equal(behavior.after.imagesRetained,0);assert(behavior.failureHidden);assert.equal(behavior.submits,3);assert.equal(behavior.lastModel,'gemini-3.7-flash');assert(behavior.context.endsWith('New question'));
    await evaluate('AIHelper.closeResponse()');
    await call('Fetch.enable',{patterns:[{urlPattern:'*cdn.jsdelivr.net/npm/katex*'}]});c.on('Fetch.requestPaused',e=>call('Fetch.failRequest',{requestId:e.requestId,errorReason:'InternetDisconnected'}));
    const immediate=await evaluate(`(async()=>{const start=performance.now();await AIHelper.showResponse('A formula: $x^2$.','general');return{elapsed:performance.now()-start,visible:document.getElementById('ai-response-modal').classList.contains('visible')};})()`);
    assert(immediate.visible&&immediate.elapsed<100,'Math CDN failure cannot delay the answer dialog: '+JSON.stringify(immediate));
    await wait(100);assert(await evaluate(`document.querySelector('.ai-modal-body').textContent.includes('x^2')`));
    console.log(JSON.stringify({passed:true,behavior,mathFallback:immediate}));
}finally{
    await call('Fetch.disable').catch(()=>{});await evaluate('AIHelper.closePrompt();AIHelper.closeResponse()').catch(()=>{});
    if(storage)await evaluate(`(()=>{localStorage.clear();for(const[k,v]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem(k,v);})()`);
    await call('Page.reload',{ignoreCache:true});await wait(1800);c.close();
}
