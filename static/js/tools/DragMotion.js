/** Pointer-anchored pickup and frictional throws. A near miss never deletes. */
window.DragMotion=(()=>{
    const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tracker(x,y,limit=5){
        let samples=[{x,y,t:performance.now()}];
        return{move(x,y,t=performance.now()){const last=samples.at(-1);if(x===last.x&&y===last.y)return;samples.push({x,y,t});samples=samples.filter(p=>t-p.t<100).slice(-16);},
            velocity(now=performance.now()){const end=samples.at(-1);if(now-end.t>100||samples.length<2)return{x:0,y:0};const first=[...samples].reverse().find(p=>end.t-p.t>=32)||samples[0],dt=end.t-first.t;if(dt<8)return{x:0,y:0};return{x:clamp((end.x-first.x)/dt,-limit,limit),y:clamp((end.y-first.y)/dt,-limit,limit)};}};
    }
    // Pages are easy to toss; a whole notebook needs a more deliberate aim.
    // These are logical pixels, independent of the bin's animated scale.
    const catchProfiles={
        page:{padding:150,tau:300,maxTime:650,maxLead:1300,minSpeed:.45},
        notebook:{padding:46,tau:210,maxTime:460,maxLead:440,minSpeed:.55},
        content:{padding:14,tau:220,maxTime:600,maxLead:Infinity,minSpeed:.55}
    };
    function catchRadius(rect,type='content',speed=0){return Math.max(rect.width,rect.height)/2+(catchProfiles[type]||catchProfiles.content).padding+(type==='page'?Math.min(520,Math.max(0,speed-.8)**2*24):0);}
    function binRect(){
        const bin=document.getElementById('recycleBinBtn');if(!bin)return null;
        // Layout coordinates do not move when an impact makes the bin recoil.
        return{left:bin.offsetLeft,top:bin.offsetTop,width:bin.offsetWidth,height:bin.offsetHeight};
    }
    function target(x,y,velocity,rect,type='content'){
        if(!rect)return null;
        const profile=catchProfiles[type]||catchProfiles.content;
        const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,baseRadius=catchRadius(rect,type);
        const vx=velocity.x*1000,vy=velocity.y*1000;
        const ox=x-cx,oy=y-cy;if(Math.hypot(ox,oy)<=baseRadius)return{duration:0,dx:0,dy:0,x,y,type,vx,vy,capture:'direct'};
        if(reduced())return null;
        const speed=Math.hypot(velocity.x,velocity.y);if(speed<profile.minSpeed)return null;
        const r=catchRadius(rect,type,speed),ux=velocity.x/speed,uy=velocity.y/speed,b=ox*ux+oy*uy,disc=b*b-(ox*ox+oy*oy-r*r);
        const tau=profile.tau,maxDistance=Math.min(profile.maxLead,speed*tau*(1-Math.exp(-profile.maxTime/tau)));
        if(b<0&&disc>=0){
            const distance=Math.max(0,-b-Math.sqrt(disc));
            if(distance<=maxDistance){
                const plan={duration:distance?-tau*Math.log(1-distance/(speed*tau)):0,dx:distance*ux,dy:distance*uy,x:x+distance*ux,y:y+distance*uy,tau,type,vx,vy,capture:'momentum'};
                if(type==='page'&&distance>0){plan.duration=distance/(speed*1.35);accelerate(plan);}return plan;
            }
        }
        // An unmistakable strong leftward page throw can arc down into the
        // bottom-left bin. Vertical reordering, slow drags and notebooks never
        // use this larger intent zone. More speed gives more reach/forgiveness.
        const leftSpeed=-velocity.x,reach=leftSpeed*360*(1-Math.exp(-800/360))+r*.85;
        if(type!=='page'||leftSpeed<2.2||ox<=baseRadius||Math.abs(velocity.y)>leftSpeed*.6||ox>reach||Math.abs(oy)>baseRadius+leftSpeed*leftSpeed*55)return null;
        const distance=Math.hypot(ox,oy),endX=cx+ox/distance*baseRadius*.65,endY=cy+oy/distance*baseRadius*.65;
        const dx=endX-x,dy=endY-y,duration=Math.min(600,Math.abs(dx)/(leftSpeed*1.35));
        const plan={duration,dx,dy,x:endX,y:endY,type,vx,vy,curved:true,capture:'arc'};accelerate(plan);return plan;
    }
    function accelerate(plan){const seconds=plan.duration/1000;plan.accelerating=true;plan.ax=2*(plan.dx-plan.vx*seconds)/(seconds*seconds);plan.ay=2*(plan.dy-plan.vy*seconds)/(seconds*seconds);plan.endVx=plan.vx+plan.ax*seconds;plan.endVy=plan.vy+plan.ay*seconds;}
    function resolve(x,y,sampler,type='content'){return target(x,y,sampler?.velocity()||{x:0,y:0},binRect(),type);}
    function hint(x,y,sampler,type='content'){
        const rect=binRect();if(!rect)return null;
        const plan=target(x,y,sampler?.velocity()||{x:0,y:0},rect,type);
        const distance=Math.hypot(x-rect.left-rect.width/2,y-rect.top-rect.height/2),radius=catchRadius(rect,type);
        const proximity=plan?1:clamp(1-(distance-radius)/72,0,1);
        window.TrashWorkbench?.feedback({plan,proximity,type});return plan;
    }
    function clonePage(source){
        const clone=source.cloneNode(true),style=getComputedStyle(source);
        clone.classList.remove('pressing','dragging-source','spring-return-slot');clone.classList.add('drag-clone');
        clone.style.cssText=`position:fixed;left:0;top:0;width:${style.width};height:${style.height};margin:0;z-index:9999;pointer-events:none;`;
        clone.setAttribute('aria-hidden','true');
        const paper=clone.querySelector('.page-paper'),original=source.querySelector('.page-paper'),appearance=getComputedStyle(original);
        for(const key of ['backgroundColor','borderColor','borderRadius','cornerShape','boxShadow','outlineColor','outlineStyle','outlineWidth','outlineOffset'])paper.style[key]=appearance[key];
        const grip=clone.querySelector('.page-grip');if(grip)grip.style.opacity=getComputedStyle(source.querySelector('.page-grip')).opacity;
        const number=clone.querySelector('.page-number'),sourceNumber=source.querySelector('.page-number');if(number&&sourceNumber){const style=getComputedStyle(sourceNumber);number.style.color=style.color;number.style.backgroundColor=style.backgroundColor;}
        const originals=source.querySelectorAll('canvas');clone.querySelectorAll('canvas').forEach((canvas,i)=>{canvas.width=originals[i].width;canvas.height=originals[i].height;canvas.getContext('2d').drawImage(originals[i],0,0);});
        return clone;
    }
    function cloneNotebook(source){
        const clone=source.cloneNode(true),style=getComputedStyle(source);
        clone.classList.remove('pressing','dragging-source','spring-return-slot');clone.classList.add('notebook-drag-clone');
        clone.style.cssText=`position:fixed;left:0;top:0;width:${style.width};height:${style.height};margin:0;z-index:9999;pointer-events:none;`;
        for(const key of ['display','alignItems','boxSizing','minHeight','minWidth','backgroundColor','borderColor','borderStyle','borderWidth','borderRadius','cornerShape','boxShadow','color'])clone.style[key]=style[key];
        clone.style.setProperty('padding',style.padding,'important');clone.style.setProperty('gap',style.gap,'important');
        const edit=clone.querySelector('.notebook-edit');if(edit)edit.style.opacity=getComputedStyle(source.querySelector('.notebook-edit')).opacity;
        clone.setAttribute('aria-hidden','true');return clone;
    }
    function create(element,x,y,sourceRect){
        const rect=sourceRect||element.getBoundingClientRect(),page=element.classList.contains('page-thumb'),book=element.classList.contains('notebook-item'),initialScale=page||book?rect.width/Math.max(1,parseFloat(getComputedStyle(element).width)):1;
        const offsetX=(x-rect.left)/initialScale,offsetY=(y-rect.top)/initialScale,sampler=tracker(x,y,page?8:5),type=page?'page':book?'notebook':'content';
        let px=x,py=y,angle=0,angularVelocity=0,lift=initialScale,frame=0,last=performance.now(),stopped=false;
        element.style.left=element.style.top='0';element.style.transition='none';element.style.transformOrigin=`${offsetX}px ${offsetY}px`;element.style.willChange='transform';element.classList.add('picked-up');
        if((page||book)&&!reduced()){const surface=page?element.querySelector('.page-paper'):element;element._liftAnimation=surface.animate([{boxShadow:getComputedStyle(surface).boxShadow},{boxShadow:'0 18px 34px rgba(0,0,0,.16), 0 4px 10px rgba(0,0,0,.08)'}],{duration:180,easing:'ease-out',fill:'forwards'});}
        function paint(now=performance.now(),advance=true){
            frame=0;const dt=Math.min(.032,Math.max(.001,(now-last)/1000));last=now;
            const desired=reduced()?0:clamp(sampler.velocity(now).x*2.2+(offsetX/Math.max(rect.width,1)-.5)*2,-7,7);
            if(advance){angularVelocity+=(150*(desired-angle)-24*angularVelocity)*dt;angle+=angularVelocity*dt;}
            const targetLift=reduced()?1:1.035;if(advance)lift+=(targetLift-lift)*(1-Math.exp(-dt*35));
            element.style.transform=`translate3d(${px-offsetX}px,${py-offsetY}px,0) rotate(${angle}deg) scale(${lift})`;
            if(!stopped)hint(px,py,sampler,type);
            if(!stopped&&(Math.abs(desired-angle)>.02||Math.abs(angularVelocity)>.1||Math.abs(targetLift-lift)>.0001))frame=requestAnimationFrame(paint);
        }
        paint(last,false);
        return{element,sampler,move(x,y){px=x;py=y;sampler.move(x,y);if(!stopped)hint(x,y,sampler,type);if(!frame&&!stopped)frame=requestAnimationFrame(paint);},
            release(cancelled=false){stopped=true;if(frame)cancelAnimationFrame(frame);paint();const velocity=cancelled?{x:0,y:0}:sampler.velocity();element._releaseMotion={x:px-offsetX,y:py-offsetY,vx:velocity.x*1000,vy:velocity.y*1000,angle,angularVelocity,scale:lift,offsetX,offsetY};return cancelled?null:resolve(px,py,sampler,type);},
            flight(plan){return fly(element,plan);},settle(destination){settle(element,destination);}};
    }
    function fly(element,plan){
        if(!element||!plan?.duration)return Promise.resolve();
        const transform=element.style.transform||'',duration=plan.duration,start=performance.now();
        return new Promise(resolve=>{let done=false,frame=0;const finish=()=>{if(done)return;done=true;cancelAnimationFrame(frame);element.style.transform=`translate3d(${plan.dx}px,${plan.dy}px,0) ${transform}`;
                const motion=element._releaseMotion;if(motion){motion.x+=plan.dx;motion.y+=plan.dy;const end=flightAt(plan,duration);motion.vx=end.vx;motion.vy=end.vy;motion.angularVelocity=0;}resolve();};
            const timer=setTimeout(finish,duration+80);
            function step(now){if(done)return;const t=Math.min(duration,now-start),pose=flightAt(plan,t);element.style.transform=`translate3d(${pose.x}px,${pose.y}px,0) ${transform}`;if(t<duration)frame=requestAnimationFrame(step);else{clearTimeout(timer);finish();}}
            frame=requestAnimationFrame(step);
        });
    }
    function flightAt(plan,time){
        const duration=plan.duration;if(!(duration>0))return{x:plan.dx||0,y:plan.dy||0,vx:plan.vx||0,vy:plan.vy||0};time=clamp(time,0,duration);const t=time/duration;
        if(plan.accelerating){const seconds=time/1000;return{x:plan.vx*seconds+.5*plan.ax*seconds*seconds,y:plan.vy*seconds+.5*plan.ay*seconds*seconds,vx:plan.vx+plan.ax*seconds,vy:plan.vy+plan.ay*seconds};}
        if(!plan.curved){const tau=plan.tau||220,decay=Math.exp(-duration/tau),f=(1-Math.exp(-time/tau))/(1-decay),velocity=Math.exp(-time/tau)/(tau*(1-decay))*1000;return{x:plan.dx*f,y:plan.dy*f,vx:plan.dx*velocity,vy:plan.dy*velocity};}
        // Cubic Hermite arc: exact release velocity and exact landing velocity.
        const seconds=duration/1000,h01=t*t*(3-2*t),h10=t*(1-t)*(1-t),h11=t*t*(t-1),dh01=6*t*(1-t),dh10=3*t*t-4*t+1,dh11=3*t*t-2*t;
        return{x:h01*plan.dx+h10*plan.vx*seconds+h11*plan.endVx*seconds,y:h01*plan.dy+h10*plan.vy*seconds+h11*plan.endVy*seconds,vx:dh01*plan.dx/seconds+dh10*plan.vx+dh11*plan.endVx,vy:dh01*plan.dy/seconds+dh10*plan.vy+dh11*plan.endVy};
    }
    // Exact damped spring: release velocity carries through the first frames,
    // acceleration pulls toward the slot, and a small overshoot settles out.
    function spring(displacement,velocity,time,frequency=13,damping=.72){
        const decay=frequency*damping,oscillation=frequency*Math.sqrt(1-damping*damping),b=(velocity+decay*displacement)/oscillation;
        const envelope=Math.exp(-decay*time),c=Math.cos(oscillation*time),s=Math.sin(oscillation*time),wave=displacement*c+b*s;
        return{value:envelope*wave,velocity:envelope*(-decay*wave+oscillation*(-displacement*s+b*c))};
    }
    // Critically damped attraction carries incoming velocity into suction.
    // Closed-form physics stays identical at 60/120 Hz or after a late frame.
    function critical(displacement,velocity,time,frequency=16){
        const b=velocity+frequency*displacement,envelope=Math.exp(-frequency*time);
        return{value:(displacement+b*time)*envelope,velocity:(velocity-frequency*b*time)*envelope};
    }
    function settle(element,destination){if(!element)return;const node=destination?.getBoundingClientRect?destination:null,rect=node?.getBoundingClientRect()||destination;if(!rect){element.remove();return Promise.resolve();}
        const matrix=new DOMMatrix(getComputedStyle(element).transform),release=element._releaseMotion||{},ox=release.offsetX||0,oy=release.offsetY||0;
        const layout=getComputedStyle(element),sx=rect.width/Math.max(1,parseFloat(layout.width)||element.offsetWidth),sy=rect.height/Math.max(1,parseFloat(layout.height)||element.offsetHeight),tx=rect.left-ox*(1-sx),ty=rect.top-oy*(1-sy);
        const startX=release.x??matrix.m41,startY=release.y??matrix.m42,angle=release.angle??Math.atan2(matrix.b,matrix.a)*180/Math.PI,scale=release.scale??Math.hypot(matrix.a,matrix.b);
        node?._springReturnCancel?.();
        const hideSlot=node&&!node.classList.contains('pressing')&&!node.classList.contains('dragging-source');if(hideSlot)node.classList.add('spring-return-slot');
        element.classList.add('spring-returning');
        const book=element.classList.contains('notebook-item'),paper=book?element:element.querySelector('.page-paper'),targetPaper=book?node:node?.querySelector('.page-paper');
        let returnAppearance=null;
        if(paper&&targetPaper){
            const current=getComputedStyle(paper),target=getComputedStyle(targetPaper),from={},to={};
            for(const key of ['boxShadow','borderColor','borderRadius','backgroundColor','outlineColor','outlineWidth','outlineOffset']){from[key]=current[key];to[key]=target[key];}
            paper.style.outlineStyle=target.outlineStyle;
            element._liftAnimation?.cancel();for(const key of Object.keys(to))paper.style[key]=to[key];
            const changed=Object.keys(to).filter(key=>from[key]!==to[key]);
            if(changed.length)returnAppearance=paper.animate([Object.fromEntries(changed.map(key=>[key,from[key]])),Object.fromEntries(changed.map(key=>[key,to[key]]))],{duration:reduced()?100:650,easing:'ease-out'});
            const number=element.querySelector('.page-number'),targetNumber=node.querySelector('.page-number');if(number&&targetNumber){
                number.textContent=targetNumber.textContent;
                // Selection/hover badges can differ outside the shelf selector.
                // Match the destination before revealing it, rather than pop.
                const sourceStyle=getComputedStyle(number),targetStyle=getComputedStyle(targetNumber),from={},to={};
                for(const key of ['color','backgroundColor']){from[key]=sourceStyle[key];to[key]=targetStyle[key];number.style[key]=to[key];}
                if(Object.keys(to).some(key=>from[key]!==to[key]))number.animate([from,to],{duration:reduced()?100:180});
            }
            const grip=element.querySelector('.page-grip'),targetGrip=node.querySelector('.page-grip');if(grip&&targetGrip){const opacity=getComputedStyle(targetGrip).opacity,previous=getComputedStyle(grip).opacity;grip.style.opacity=opacity;if(previous!==opacity)grip.animate([{opacity:previous},{opacity}],{duration:180});}
            const edit=element.querySelector('.notebook-edit'),targetEdit=node.querySelector('.notebook-edit');if(edit&&targetEdit){const opacity=getComputedStyle(targetEdit).opacity,previous=getComputedStyle(edit).opacity;edit.style.opacity=opacity;if(previous!==opacity)edit.animate([{opacity:previous},{opacity}],{duration:180});}
        }
        const started=performance.now(),minimal=reduced();let frame=0,finished=false;
        return new Promise(resolve=>{
            const cleanup=()=>{if(finished)return;finished=true;cancelAnimationFrame(frame);clearTimeout(timer);returnAppearance?.cancel();element._liftAnimation?.cancel();
                if(hideSlot){
                    node.classList.add('spring-return-landed');node.classList.remove('spring-return-slot');
                    requestAnimationFrame(()=>requestAnimationFrame(()=>node.classList.remove('spring-return-landed')));
                }
                if(node?._springReturnCancel===cleanup)delete node._springReturnCancel;element.remove();resolve();};
            const timer=setTimeout(cleanup,minimal?180:1650);
            if(node)node._springReturnCancel=cleanup;
            function step(now){if(finished)return;if(!element.isConnected||node&&!node.isConnected){cleanup();return;}
                const t=(now-started)/1000;
                const x=spring(startX-tx,release.vx||0,t),y=spring(startY-ty,release.vy||0,t),rotation=spring(angle,release.angularVelocity||0,t,16,.78),sizeX=spring(scale-sx,0,t,17,.76),sizeY=spring(scale-sy,0,t,17,.76);
                if(minimal){element.style.opacity=String(Math.max(0,1-t/.1));}
                else element.style.transform=`translate3d(${tx+x.value}px,${ty+y.value}px,0) rotate(${rotation.value}deg) scale(${sx+sizeX.value},${sy+sizeY.value})`;
                const resting=Math.hypot(x.value,y.value)<.15&&Math.hypot(x.velocity,y.velocity)<1.5&&Math.abs(rotation.value)<.03&&Math.max(Math.abs(sizeX.value),Math.abs(sizeY.value))<.0002;
                const appearanceFinished=!returnAppearance||returnAppearance.playState==='finished';
                if(minimal?t>=.1:t>.14&&resting&&appearanceFinished||t>1.5)cleanup();else frame=requestAnimationFrame(step);
            }frame=requestAnimationFrame(step);
        });
    }
    const pageAnimations=new Set();
    function playPageAnimation(element,frames,options){if(!element)return;const animation=element.animate(frames,options);pageAnimations.add(animation);animation.finished.catch(()=>{}).finally(()=>pageAnimations.delete(animation));}
    function animatePageAdded(id,previous){
        const thumbs=[...document.querySelectorAll('#pageList .page-thumb')],added=thumbs.find(el=>pages[parseInt(el.dataset.index)]?.id===id);if(!added)return;
        added.scrollIntoView({block:'nearest',behavior:'instant'});
        const preview=window.PageThumbnails?.records.get(id);if(preview){preview.visible=true;PageThumbnails.dirty(id);}
        if(!reduced())for(const thumb of thumbs){const pageId=pages[parseInt(thumb.dataset.index)]?.id,paper=thumb.querySelector('.page-paper'),old=previous?.get(pageId);if(!old||!paper||pageId===id)continue;const r=paper.getBoundingClientRect(),dy=old.top-r.top;if(Math.abs(dy)>1&&r.bottom>0&&r.top<innerHeight)playPageAnimation(paper,[{transform:`translate3d(0,${dy}px,0)`},{transform:'translate3d(0,0,0)'}],{duration:360,easing:'cubic-bezier(.2,.8,.2,1)'});}
        const paper=added.querySelector('.page-paper');
        if(reduced())playPageAnimation(paper,[{opacity:.35},{opacity:1}],{duration:100});
        else{const frames=Array.from({length:31},(_,i)=>{const t=i/30*.55;return{offset:i/30,opacity:Math.min(1,t/.13),transform:`translate3d(0,${spring(-22,0,t,16,.7).value}px,0) scale(${1+spring(-.09,0,t,16,.66).value})`};});frames[30]={offset:1,opacity:1,transform:'translate3d(0,0,0) scale(1)'};playPageAnimation(paper,frames,{duration:550,easing:'linear'});}
        // Only opacity changes on the main canvas: ink and the grid stay native
        // resolution, and the first interaction immediately finishes the reveal.
        playPageAnimation(canvas,[{opacity:.7},{opacity:1}],{duration:140,easing:'ease-out'});
    }
    let imagePreview=null,imagePreparing=false,imagePending=false;
    const originalImageHandles=drawImageSelectionHandles;drawImageSelectionHandles=function(context){if(!imagePreparing)originalImageHandles(context);};
    function beginImage(e){imagePending=false;imagePreview={sampler:tracker(e.clientX,e.clientY),camera:null};}
    function imageSample(e){if(!imagePreview)beginImage(e);imagePreview.sampler.move(e.clientX,e.clientY);hint(e.clientX,e.clientY,imagePreview.sampler);}
    function releaseImage(e){const plan=e?resolve(e.clientX,e.clientY,imagePreview?.sampler):null;imagePending=!!plan;if(!plan)imagePreview=null;return plan;}
    function finishImageDrop(){imagePending=false;imagePreview=null;redrawCanvas(true);}
    function paintImage(){
        if(imagePending&&imagePreview?.camera){activeCtx.setTransform(1,0,0,1,0,0);activeCtx.clearRect(0,0,activeCanvas.width,activeCanvas.height);return true;}
        if(imagePreparing||!imageManipulation.isDragging||!selectedImage){if(!imagePreparing)imagePreview=null;return false;}
        imagePreview??={camera:null};
        const camera=[panX,panY,zoom,canvas.width,canvas.height,settings.theme,settings.accentTheme].join(':');
        if(camera!==imagePreview.camera){const allImages=images;imagePreparing=true;try{images=images.filter(item=>item.id!==selectedImage.id);_redrawCanvas();}finally{images=allImages;imagePreparing=false;}imagePreview.camera=camera;}
        activeCtx.setTransform(1,0,0,1,0,0);activeCtx.clearRect(0,0,activeCanvas.width,activeCanvas.height);
        activeCtx.setTransform(zoom*baseDPR,0,0,zoom*baseDPR,panX*baseDPR,panY*baseDPR);
        const item=selectedImage,img=window.imageCache?.get(item.id);
        if(img?.complete&&img.naturalWidth){activeCtx.save();activeCtx.translate(item.x+item.width/2,item.y+item.height/2);activeCtx.rotate(item.rotation||0);activeCtx.filter=isDarkMode&&item.inverted?'invert(1)':'none';drawFilteredBitmap(activeCtx,img,-item.width/2,-item.height/2,item.width,item.height);activeCtx.restore();}
        drawImageSelectionHandles(activeCtx);return true;
    }
    if(typeof document!=='undefined')document.addEventListener('pointerdown',event=>{event.target.closest?.('.spring-return-slot')?._springReturnCancel?.();for(const animation of pageAnimations){try{animation.finish();}catch{animation.cancel();}}pageAnimations.clear();},{capture:true});
    return{get shelfBusy(){return !!document.querySelector('.drag-clone,.notebook-drag-clone');},tracker,target,catchRadius,binRect,resolve,hint,clonePage,cloneNotebook,create,fly,flightAt,settle,spring,critical,animatePageAdded,beginImage,imageSample,releaseImage,finishImageDrop,paintImage};
})();
