/** Recoverable trash and pointer-driven, two-dimensional drop targets. */
window.TrashWorkbench=(()=>{
    const state={tab:'all',items:[],query:'',generation:0,busy:false};
    let receiving=0,animations=0;
    const recoil={x:0,y:0,vx:0,vy:0,angle:0,angularVelocity:0,size:0,sizeVelocity:0,lift:0,liftVelocity:0,liftTarget:0,last:0};
    let recoilFrame=0,recoilTimer=0;
    function paintRecoil(){
        const bin=document.getElementById('recycleBinBtn');if(!bin)return;
        bin.style.setProperty('--trash-impact-x',recoil.x+'px');bin.style.setProperty('--trash-impact-y',recoil.y+'px');
        bin.style.setProperty('--trash-impact-angle',recoil.angle+'deg');bin.style.setProperty('--trash-impact-scale',String(1+recoil.lift+recoil.size));
        bin.style.setProperty('--trash-lid-open',String(Math.max(0,Math.min(1,recoil.lift/.14))));bin.style.setProperty('--trash-lid-wobble',(-recoil.angle*.65+recoil.size*65)+'deg');
    }
    function advanceRecoil(now){
        const dt=Math.max(0,(now-recoil.last)/1000);recoil.last=now;
        for(const [position,velocity,frequency,damping]of [['x','vx',18,.54],['y','vy',18,.54],['angle','angularVelocity',19,.56],['size','sizeVelocity',21,.66]]){
            const next=DragMotion.spring(recoil[position],recoil[velocity],dt,frequency,damping);recoil[position]=next.value;recoil[velocity]=next.velocity;
        }
        const lift=DragMotion.critical(recoil.lift-recoil.liftTarget,recoil.liftVelocity,dt,14);recoil.lift=recoil.liftTarget+lift.value;recoil.liftVelocity=lift.velocity;
    }
    function stopRecoil(){
        cancelAnimationFrame(recoilFrame);recoilFrame=0;clearTimeout(recoilTimer);
        Object.assign(recoil,{x:0,y:0,vx:0,vy:0,angle:0,angularVelocity:0,size:0,sizeVelocity:0,lift:0,liftVelocity:0});paintRecoil();
        document.getElementById('recycleBinBtn')?.classList.remove('trash-reacting');
    }
    function impact(vx,vy,type='content',contact={x:0,y:0}){
        if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
        const speed=Math.hypot(vx,vy);if(!Number.isFinite(speed)||speed<1)return;
        const now=performance.now(),bin=document.getElementById('recycleBinBtn');
        if(recoilFrame)advanceRecoil(now);else{recoil.last=now;const m=new DOMMatrix(getComputedStyle(bin).transform);recoil.lift=Math.max(0,Math.min(.16,Math.hypot(m.a,m.b)-1));}
        const force=Math.min(330,100+speed*.07)*(type==='notebook'?1.18:1),ux=vx/speed,uy=vy/speed;
        recoil.vx=Math.max(-420,Math.min(420,recoil.vx+ux*force));recoil.vy=Math.max(-420,Math.min(420,recoil.vy+uy*force));
        const torque=Math.max(-85,Math.min(85,(contact.x*vy-contact.y*vx)*.0006));
        recoil.angularVelocity=Math.max(-220,Math.min(220,recoil.angularVelocity+ux*115+torque));recoil.sizeVelocity-=Math.min(4.4,1.2+speed/1500);
        paintRecoil();
        document.getElementById('recycleBinBtn')?.classList.add('trash-reacting');
        clearTimeout(recoilTimer);recoilTimer=setTimeout(stopRecoil,1300);
        if(recoilFrame)return;
        function step(now){
            recoilFrame=0;advanceRecoil(now);paintRecoil();
            const resting=Math.hypot(recoil.x,recoil.y)<.03&&Math.hypot(recoil.vx,recoil.vy)<.4&&Math.abs(recoil.angle)<.02&&Math.abs(recoil.angularVelocity)<.3&&Math.abs(recoil.size)<.0002&&Math.abs(recoil.lift-recoil.liftTarget)<.0003&&Math.abs(recoil.liftVelocity)<.004;
            if(resting)stopRecoil();else recoilFrame=requestAnimationFrame(step);
        }recoilFrame=requestAnimationFrame(step);
    }
    function feedback({plan=null,proximity=0,type='content'}={},force=false){
        const bin=document.getElementById('recycleBinBtn');if(!bin||receiving&&!force)return;
        const value=String(proximity);if(bin.style.getPropertyValue('--trash-proximity')!==value)bin.style.setProperty('--trash-proximity',value);
        recoil.liftTarget=proximity*.14;
        bin.classList.toggle('trash-near',proximity>0);bin.classList.toggle('drag-over',!!plan);
        document.body.classList.toggle('trash-drop-zone-active',!!plan);
        bin.dataset.trashKind=type;
        const name=type==='page'?'page':type==='notebook'?'notebook':'selection';
        bin.title=plan?`Release to move ${name} to Recycle Bin`:'Recycle Bin';
    }
    function receive(type){
        receiving++;const bin=document.getElementById('recycleBinBtn');bin?.classList.add('trash-incoming');
        feedback({plan:{},proximity:1,type},true);let ended=false;
        return()=>{if(ended)return;ended=true;receiving--;if(!receiving){bin?.classList.remove('trash-incoming');clearTrashHover();}};
    }
    const svg=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    const icons={notebook:svg('<path d="M5 3h13a2 2 0 0 1 2 2v16H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3M7 3v14M4 18h16"/>'),page:svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>'),content:svg('<path d="M4 17c3-12 6-13 8-7s4 9 8-6M4 21h16"/>'),color:svg('<circle cx="12" cy="12" r="8"/>'),restore:svg('<path d="M3 10h7M3 10V3M3 10a9 9 0 1 1 0 7"/>'),delete:svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>')};
    const local=key=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return[];}};
    const safeCopy=value=>JSON.parse(JSON.stringify(value,(key,v)=>key.startsWith('_')||['tempCanvas','tempCtx','cacheCanvas','cursorMap','lastHash'].includes(key)?undefined:v));
    async function request(url,method='GET',body){const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to update Recycle Bin');return data;}
    function notify(error){console.error(error);showToast(error.message||'Could not move item. Your content is unchanged.','error');}
    function copyVisual(source){const copy=source.cloneNode(true);copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));copy.removeAttribute('id');const originals=[...source.querySelectorAll('canvas')],copies=[...copy.querySelectorAll('canvas')];originals.forEach((c,i)=>{const img=document.createElement('img');img.src=c._trashSnapshot||(c._trashSnapshot=c.toDataURL());img.style.cssText=c.style.cssText;img.className=c.className;img.style.width='100%';img.style.height='100%';copies[i].replaceWith(img);});return copy;}
    function animate(source,x,y,momentum=null){
        const bin=document.getElementById('recycleBinBtn');if(!bin){source?.remove();return;}
        const target=DragMotion.binRect(),r=source?.getBoundingClientRect()||{left:x-24,top:y-24,width:48,height:48};
        const style=source?getComputedStyle(source):null;
        const box=key=>{if(!style)return r[key];const size=parseFloat(style[key]);if(!Number.isFinite(size))return r[key];if(style.boxSizing==='border-box')return size;const horizontal=key==='width';return size+(parseFloat(style[horizontal?'paddingLeft':'paddingTop'])||0)+(parseFloat(style[horizontal?'paddingRight':'paddingBottom'])||0)+(parseFloat(style[horizontal?'borderLeftWidth':'borderTopWidth'])||0)+(parseFloat(style[horizontal?'borderRightWidth':'borderBottomWidth'])||0);};
        const width=box('width'),height=box('height'),matrix=new DOMMatrix(style?.transform==='none'||!style?.transform?undefined:style.transform);
        // Recover the real pickup pose, including tilt/scale/transform origin.
        // Row strips start in that same affine pose, not a stretched bounding
        // rectangle. This removes the jump-cut at the start of the suction.
        const cornerX=[0,matrix.a*width,matrix.c*height,matrix.a*width+matrix.c*height],cornerY=[0,matrix.b*width,matrix.d*height,matrix.b*width+matrix.d*height];
        const originX=r.left-Math.min(...cornerX),originY=r.top-Math.min(...cornerY);
        const residual=Math.exp(-(momentum?.duration||0)/(momentum?.tau||220));
        const vx=source?._releaseMotion?.vx??(momentum?.accelerating||momentum?.curved?momentum.endVx:(momentum?.vx||0)*residual),vy=source?._releaseMotion?.vy??(momentum?.accelerating||momentum?.curved?momentum.endVy:(momentum?.vy||0)*residual);
        const speed=Math.hypot(vx,vy),attraction=Math.min(34,16+speed/900);
        const distance=Math.hypot(originX+matrix.a*width/2+matrix.c*height/2-target.left-target.width/2,originY+matrix.b*width/2+matrix.d*height/2-target.top-target.height/2);
        const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
        const root=document.createElement('div');root.className='trash-genie';root.setAttribute('aria-hidden','true');document.body.appendChild(root);
        const strips=[],count=reduced?1:24,visual=source&&!source.matches('canvas')?copyVisual(source):null;
        if(visual){visual.style.boxShadow=style.boxShadow;const paper=visual.querySelector('.page-paper'),original=source.querySelector('.page-paper');if(paper&&original)paper.style.boxShadow=getComputedStyle(original).boxShadow;}
        for(let i=0;i<count;i++){
            const strip=document.createElement('div');strip.className='trash-genie-strip';strip.style.cssText=`width:${width}px;height:${height/count+1}px;`;
            let copy;
            if(source?.matches('canvas')){copy=document.createElement('canvas');copy.width=source.width;const first=Math.floor(i*source.height/count),last=Math.ceil((i+1)*source.height/count);copy.height=Math.max(1,last-first);copy.getContext('2d').drawImage(source,0,first,source.width,copy.height,0,0,source.width,copy.height);copy.style.cssText=`position:absolute;inset:0;width:100%;height:100%;`;}
            else{copy=visual?visual.cloneNode(true):document.createElement('div');copy.style.cssText+=`;position:absolute!important;left:0!important;top:${-i*height/count}px!important;width:${width}px!important;height:${height}px!important;transform:none!important;margin:0!important;opacity:1!important;transition:none!important;`;}
            if(!source){copy.style.background='var(--brand-fill)';copy.style.borderRadius='12px';}
            strip.appendChild(copy);root.appendChild(strip);strips.push(strip);
        }
        source?._liftAnimation?.cancel();source?.remove();animations++;bin.classList.add('sucking');
        const start=performance.now(),duration=reduced?150:Math.max(480,Math.min(760,520+distance/4-Math.hypot(vx,vy)/110)),targetX=target.left+target.width/2,targetY=target.top+target.height*.44;
        let struck=false;
        let resolve,finished=false,raf=0;const complete=new Promise(r=>resolve=r);
        const finish=()=>{if(finished)return;finished=true;clearTimeout(cleanup);cancelAnimationFrame(raf);root.remove();animations--;if(!animations)bin.classList.remove('sucking');if(!receiving)clearTrashHover();resolve();};
        const cleanup=setTimeout(finish,duration+100);
        const ease=t=>t*t*(3-2*t);
        function frame(now){if(!root.isConnected){finish();return;}const elapsed=Math.max(0,(now-start)/1000),t=Math.min(1,elapsed*1000/duration);
            for(let i=0;i<count;i++){
                const u=i/count,v=(i+1)/count;
                const row=f=>{
                    const p=ease(Math.max(0,Math.min(1,t*1.45-(1-f)*.38))),squeeze=Math.pow(1-p,1.4),sx=originX+matrix.a*width/2+matrix.c*height*f,sy=originY+matrix.b*width/2+matrix.d*height*f;
                    if(reduced)return{x:sx,y:sy,vx:0,vy:0,w:1};
                    const tx=targetX+recoil.x,ty=targetY+(f-.5)*3+recoil.y;
                    // The leading edge enters first; the rest of the paper
                    // follows as a curved, tapering ribbon, carrying momentum
                    // even before its own row reaches the suction field.
                    const delay=(1-f)*Math.min(.11,duration/1000*.22),coast=Math.min(elapsed,delay),friction=Math.max(.025,.09/(1+speed/5000)),decay=Math.exp(-coast/friction),travel=friction*(1-decay);
                    if(elapsed<delay)return{x:sx+vx*travel,y:sy+vy*travel,vx:vx*decay,vy:vy*decay,w:Math.max(.001,squeeze)};
                    const px=DragMotion.critical(sx+vx*travel-tx,vx*decay,elapsed-delay,attraction),py=DragMotion.critical(sy+vy*travel-ty,vy*decay,elapsed-delay,attraction);
                    return{x:tx+px.value,y:ty+py.value,vx:px.velocity,vy:py.velocity,w:Math.max(.001,squeeze)};
                };
                const a=row(u),b=row(v),squeeze=(a.w+b.w)/2,hx=matrix.a*squeeze,hy=matrix.b*squeeze;
                strips[i].style.transform=`matrix(${hx},${hy},${(b.x-a.x)/(height/count)},${(b.y-a.y)/(height/count)},${a.x-width*hx/2},${a.y-width*hy/2})`;
                strips[i].style.opacity=String(reduced?1-t:t>.88?(1-t)/.12:1);
                if(!struck&&t>.06&&(Math.hypot(a.x-targetX,a.y-targetY)<target.width/2+6||t>.8)){
                    struck=true;const incoming=Math.hypot(vx,vy)>100;impact(incoming?vx:a.vx,incoming?vy:a.vy,momentum?.type||'content',{x:a.x-targetX,y:a.y-targetY});
                }
            }
            if(t<1)raf=requestAnimationFrame(frame);else finish();
        }frame(start);return complete;
    }
    function selectionVisual(selection){
        const items=[...selection.strokes.map(r=>r.item),...selection.images.map(r=>r.item)];if(!items.length)return null;
        let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
        for(const item of items){if(item.points){for(const p of item.points){left=Math.min(left,p.x-(item.size||2));top=Math.min(top,p.y-(item.size||2));right=Math.max(right,p.x+(item.size||2));bottom=Math.max(bottom,p.y+(item.size||2));}}else{const pad=Math.hypot(item.width,item.height)/2;left=Math.min(left,item.x+item.width/2-pad);top=Math.min(top,item.y+item.height/2-pad);right=Math.max(right,item.x+item.width/2+pad);bottom=Math.max(bottom,item.y+item.height/2+pad);}}
        const r=canvas.getBoundingClientRect(),preview=document.createElement('canvas'),w=Math.max(1,(right-left)*zoom),h=Math.max(1,(bottom-top)*zoom),density=Math.min(devicePixelRatio||1,1600/Math.max(w,h));preview.width=Math.max(1,Math.ceil(w*density));preview.height=Math.max(1,Math.ceil(h*density));
        preview.style.cssText=`position:fixed;pointer-events:none;left:${r.left+panX+left*zoom}px;top:${r.top+panY+top*zoom}px;width:${w}px;height:${h}px;z-index:9998;`;document.body.appendChild(preview);
        const context=preview.getContext('2d');context.scale(zoom*density,zoom*density);context.translate(-left,-top);
        for(const record of selection.strokes)drawStrokeToContext(record.item,context);
        for(const{item}of selection.images){const img=imageCache.get(item.id);if(img?.complete&&img.naturalWidth){context.save();context.translate(item.x+item.width/2,item.y+item.height/2);context.rotate(item.rotation||0);context.filter=isDarkMode&&item.inverted?'invert(1)':'none';drawFilteredBitmap(context,img,-item.width/2,-item.height/2,item.width,item.height);context.restore();}}
        return preview;
    }
    async function stash(selection){
        if(!currentNotebook||!pages[currentPageIndex])return null;
        const book=currentNotebook,entry={id:crypto.randomUUID(),pageId:pages[currentPageIndex].id,deletedAt:new Date().toISOString(),...safeCopy(selection)};
        book.contentTrash??=[];book.contentTrash.unshift(entry);
        try{await request(`/api/notebooks/${book.id}`,'PUT',book);}catch(error){book.contentTrash=book.contentTrash.filter(item=>item.id!==entry.id);throw error;}return entry;
    }
    async function dropSelection(original,visible,e,remove,plan=null){
        const book=currentNotebook,pageId=pages[currentPageIndex]?.id,preview=selectionVisual(visible),done=receive('content'),flight=DragMotion.fly(preview,plan);
        try{const entry=await stash(original);if(!entry)throw Error('The original page is unavailable. Your content is unchanged.');
            if(currentNotebook?.id!==book.id||pages[currentPageIndex]?.id!==pageId){
                book.contentTrash=book.contentTrash.filter(item=>item.id!==entry.id);await request(`/api/notebooks/${book.id}`,'PUT',book);await flight;preview?.remove();showToast('Drop cancelled because you switched pages','info');return false;
            }
            remove();await flight;await animate(preview,plan?.x??e.clientX,plan?.y??e.clientY,plan);showToast('Selection moved to Recycle Bin','success');return true;}
        catch(error){await flight;preview?.remove();notify(error);return false;}
        finally{done();}
    }
    deleteNotebook=async function(id){
        const book=notebooks.find(n=>n.id===id);if(!book)return false;if(book.isFontBook){showToast('Fontbook is protected','error');return false;}
        try{if(currentNotebook?.id===id)await saveCurrentPage();await request(`/api/notebooks/${id}/trash`,'POST',{originalIndex:notebooks.indexOf(book)});await loadNotebooks();if(notebooks.length)await saveNotebookOrder();else{currentNotebook=null;pages=[];strokes=[];images=[];renderPageList();redrawCanvas(true);}showToast('Notebook moved to Recycle Bin','success');return true;}catch(error){notify(error);return false;}
    };
    async function drop(type,id,source,x,y,plan=null){
        const done=receive(type),flight=DragMotion.fly(source,plan);
        const returnToShelf=()=>{
            const destination=type==='notebook'?[...document.querySelectorAll('#notebookList .notebook-item')].find(el=>el.dataset.id===id):[...document.querySelectorAll('#pageList .page-thumb')].find(el=>pages[parseInt(el.dataset.index)]?.id===id);
            return DragMotion.settle(source,destination);
        };
        let result=false;try{if(type==='notebook')result=await deleteNotebook(id);else{const index=pages.findIndex(p=>p.id===id);if(index>=0){await deletePage(index);result=true;}}await flight;if(result)await animate(source,plan?.x??x,plan?.y??y,plan||{type});else{done();await returnToShelf();}}catch(error){await flight;done();notify(error);await returnToShelf();}finally{done();}
        return result;
    }
    async function collect(){
        const archived=await request('/api/trash/notebooks');const items=archived.map(book=>({type:'notebook',id:book.id,title:book.name,detail:`${book.pages?.length||0} pages · Notebook`,date:book.deletedAt,data:book}));
        for(const book of notebooks){const data=book.id===currentNotebook?.id?currentNotebook:book;
            for(const page of data.trash||[])items.push({type:'page',id:page.id,bookId:book.id,title:`Page ${page.originalIndex+1}`,detail:book.name,date:page.deletedAt,data:page});
            for(const content of data.contentTrash||[])items.push({type:'content',id:content.id,bookId:book.id,title:`${(content.strokes?.length||0)+(content.images?.length||0)} selected item${(content.strokes?.length||0)+(content.images?.length||0)===1?'':'s'}`,detail:book.name,date:content.deletedAt,data:content});
        }
        for(const color of local('badnotes_deleted_colors'))items.push({type:'color',id:String(color.id),title:color.color,detail:'Palette color',date:color.deletedAt,data:color});
        for(const book of local('badnotes_deleted_notebooks'))if(!archived.some(b=>b.id===book.id))items.push({type:'legacy',id:book.id,title:book.name,detail:'Legacy entry · original pages unavailable',date:book.deletedAt,data:book});
        return items.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    }
    function render(){
        const list=document.getElementById('recycleList');list.replaceChildren();
        for(const tab of document.querySelectorAll('.recycle-tab')){const filter=tab.dataset.tab;const count=state.items.filter(item=>filter==='all'||item.type===filter).length;tab.querySelector('span').textContent=count;tab.classList.toggle('active',filter===state.tab);tab.setAttribute('aria-selected',String(filter===state.tab));}
        const items=state.items.filter(item=>(state.tab==='all'||state.tab===item.type)&&(!state.query||(item.title+' '+item.detail).toLowerCase().includes(state.query)));
        document.getElementById('trashSummary').textContent=`${state.items.length} item${state.items.length===1?'':'s'} · Restore whenever you need them`;
        document.getElementById('emptyRecycleBin').disabled=!state.items.length||state.busy;
        if(!items.length){const empty=document.createElement('div');empty.className='trash-empty';empty.innerHTML=icons.delete+'<h3></h3><p></p>';empty.querySelector('h3').textContent=state.query?'Nothing matches':'A little breathing room';empty.querySelector('p').textContent=state.query?'Try a different name.':'Drag notebooks, pages or a selection here. You can bring them back.';list.appendChild(empty);return;}
        for(const item of items){const row=document.createElement('article');row.className='trash-item';const visual=document.createElement('div');visual.className='trash-item-visual';visual.innerHTML=icons[item.type]||icons.notebook;if(item.type==='notebook'&&/^#[\da-f]{3,8}$/i.test(item.data.color))visual.style.color=item.data.color;if(item.type==='color'&&/^#[\da-f]{3,8}$/i.test(item.title))visual.style.color=item.title;
            const info=document.createElement('div');info.className='trash-item-info';const name=document.createElement('h3');name.textContent=item.title;const detail=document.createElement('p');detail.textContent=item.detail;const date=document.createElement('time');date.textContent=new Date(item.date).toLocaleDateString(undefined,{month:'short',day:'numeric'});info.append(name,detail,date);
            const actions=document.createElement('div');actions.className='trash-item-actions';const restore=document.createElement('button');restore.className='trash-restore';restore.innerHTML=icons.restore+'<span>Restore</span>';restore.disabled=state.busy||item.type==='legacy';restore.title=item.type==='legacy'?'The old bin did not preserve original page files':'Restore to the original notebook';restore.onclick=()=>operate(item,false);
            const remove=document.createElement('button');remove.className='trash-delete';remove.innerHTML=icons.delete;remove.setAttribute('aria-label',`Delete ${item.title} permanently`);remove.disabled=state.busy;remove.onclick=()=>{if(confirm(`Permanently delete “${item.title}”? This cannot be undone.`))operate(item,true);};actions.append(restore,remove);row.append(visual,info,actions);list.appendChild(row);
        }
    }
    async function refresh(){const generation=++state.generation;try{const items=await collect();if(generation!==state.generation)return;state.items=items;render();}catch(error){notify(error);}}
    async function operate(item,permanent,refreshAfter=true){
        state.busy=true;render();try{
            if(item.type==='notebook'){await request(`/api/trash/notebooks/${item.id}${permanent?'':'/restore'}`,permanent?'DELETE':'POST');if(!permanent){await loadNotebooks();await saveNotebookOrder();}}
            else if(item.type==='legacy'||item.type==='color'){const key=item.type==='legacy'?'badnotes_deleted_notebooks':'badnotes_deleted_colors';if(!permanent&&item.type==='color')addToPalette(item.data.color);localStorage.setItem(key,JSON.stringify(local(key).filter(entry=>String(entry.id)!==String(item.id))));}
            else{
                await saveCurrentPage();if(currentNotebook?.id!==item.bookId)await selectNotebook(item.bookId);const book=currentNotebook;if(!book)throw Error('Original notebook is unavailable');
                if(item.type==='page'){
                    if(permanent){await request(`/api/notebooks/${book.id}/pages/${item.id}`,'DELETE');book.trash=(book.trash||[]).filter(p=>p.id!==item.id);await request(`/api/notebooks/${book.id}`,'PUT',book);}
                    else{const page=await request(`/api/notebooks/${book.id}/pages/${item.id}`),active=pages[currentPageIndex]?.id,index=Math.min(pages.length,Math.max(0,item.data.originalIndex));pages.splice(index,0,page);book.pages=pages.map(p=>p.id);book.trash=(book.trash||[]).filter(p=>p.id!==item.id);await request(`/api/notebooks/${book.id}`,'PUT',book);currentPageIndex=Math.max(0,pages.findIndex(p=>p.id===active));renderPageList();}
                }else{
                    if(!permanent){const index=pages.findIndex(page=>page.id===item.data.pageId);if(index<0)throw Error('Restore this selection’s original page first');currentPageIndex=index;loadPage(index);
                        const before={strokes:[],images:[]},after={strokes:[],images:[]};for(const record of item.data.strokes||[])if(!strokes.some(s=>s.id===record.item.id)){const index=Math.min(record.index,strokes.length);strokes.splice(index,0,safeCopy(record.item));after.strokes.push({index,item:safeCopy(record.item)});}for(const record of item.data.images||[])if(!images.some(img=>img.id===record.item.id)){const index=Math.min(record.index,images.length);images.splice(index,0,safeCopy(record.item));after.images.push({index,item:safeCopy(record.item)});}if(after.strokes.length||after.images.length){historyStack.push({type:'lasso-edit',before,after});redoStack=[];}invalidateStrokeCache();redrawCanvas(true);await saveCurrentPage();renderPageList();}
                    book.contentTrash=(book.contentTrash||[]).filter(entry=>entry.id!==item.id);await request(`/api/notebooks/${book.id}`,'PUT',book);
                }
            }
            if(refreshAfter)showToast(permanent?'Permanently removed':'Restored','success');
        }catch(error){notify(error);}finally{state.busy=false;if(refreshAfter)await refresh();}
    }
    showRecycleBin=function(){showModal('recycleBinModal');state.tab='all';state.query='';document.getElementById('trashSearch').value='';refresh();};
    renderRecycleList=function(tab='all'){state.tab=({pages:'page',notebooks:'notebook',colors:'color'})[tab]||tab;render();};
    emptyRecycleBin=async function(){if(state.busy||!state.items.length||!confirm(`Permanently delete all ${state.items.length} items? This cannot be undone.`))return;for(const item of [...state.items])await operate(item,true,false);await refresh();};
    setupRecycleBinListeners=function(){
        const bin=document.getElementById('recycleBinBtn');bin.tabIndex=0;bin.setAttribute('role','button');bin.setAttribute('aria-label','Open Recycle Bin');bin.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showRecycleBin();}});
        bin.addEventListener('dragover',e=>{e.preventDefault();updateTrashHover(e.clientX,e.clientY,e.dataTransfer.getData('application/x-badnotes-type')||'content');});bin.addEventListener('dragleave',clearTrashHover);bin.addEventListener('drop',async e=>{e.preventDefault();const type=e.dataTransfer.getData('application/x-badnotes-type');let data;try{data=JSON.parse(e.dataTransfer.getData('application/x-badnotes-data')||'{}');}catch{return;}if(type==='color')removeColor(data.value);else if(type==='notebook')await drop(type,data.id,null,e.clientX,e.clientY);else if(type==='page')await drop(type,pages[data.index]?.id,null,e.clientX,e.clientY);});
        document.querySelectorAll('.recycle-tab').forEach(tab=>tab.onclick=()=>{state.tab=tab.dataset.tab;render();});document.getElementById('trashSearch').oninput=e=>{state.query=e.target.value.trim().toLowerCase();render();};
        document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('recycleBinModal').classList.contains('show')){hideRecycleBin();bin.focus();}});
    };
    // One shared definition for hints, direct drops and momentum trajectories.
    // Ordinary clicks/scrolling never enter this path or move items to trash.
    const activeKind=()=>typeof pageDrag!=='undefined'&&pageDrag.active?'page':typeof notebookDrag!=='undefined'&&notebookDrag.active?'notebook':'content';
    isOverRecycleBin=function(x,y,type){return !!DragMotion.target(x,y,{x:0,y:0},DragMotion.binRect(),type||activeKind());};
    updateTrashHover=function(x,y,type,sampler){return DragMotion.hint(x,y,sampler,type||activeKind());};
    clearTrashHover=function(){if(receiving)return;feedback();const bin=document.getElementById('recycleBinBtn');if(!animations)bin?.classList.remove('sucking');};
    playTrashSuckAnimation=function(x,y,callback,source){animate(source,x,y);callback?.();};
    return{drop,dropSelection,stash,animate,selectionVisual,feedback,impact,refresh,state};
})();
