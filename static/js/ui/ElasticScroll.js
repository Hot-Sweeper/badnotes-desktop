/* Shelf scrolling uses visible, physical coordinates. Finger resistance is
 * applied once during contact; released motion keeps that velocity and follows
 * an analytic coast/spring, with no timed return animation or hard edge stop. */
window.ElasticScroll=(()=>{
    const states=new Map(),P=MotionPhysics,reduced=matchMedia('(prefers-reduced-motion:reduce)');
    const dragFor=e=>e.id==='notebookList'?notebookDrag:pageDrag;
    const springRate=(velocity,offset)=>16+12*Math.tanh((Math.abs(velocity)+16*Math.abs(offset))/2200);
    function bounds(s){
        const previous=s.max;s.max=Math.max(0,s.element.scrollHeight-s.element.clientHeight);
        if(s.target!==null&&previous>0&&s.target===previous)s.target=s.max;
        return s.max;
    }
    function outside(s){return s.position<0||s.position>s.max;}
    function contactPosition(raw,max,length){const edge=P.clamp(raw,0,max);return edge+P.rubber(raw-edge,length);}
    function rawPosition(position,max,length){const edge=P.clamp(position,0,max);return edge+P.unRubber(position-edge,length);}
    function sample(samples,position,time){
        const last=samples.at(-1);
        if(last&&time<=last.time){if(time===last.time)last.position=position;return;}
        samples.push({position,time});while(samples.length>2&&time-samples[0].time>100)samples.shift();
    }
    function paint(s){
        const actual=P.clamp(s.position,0,s.max),pull=actual-s.position;
        if(Math.abs(s.element.scrollTop-actual)>.1)s.element.scrollTop=actual;
        s.written=s.element.scrollTop;
        const value=Math.abs(pull)<.05?'0px':pull.toFixed(3)+'px';
        if(s.element.style.getPropertyValue('--shelf-pull')!==value)s.element.style.setProperty('--shelf-pull',value);
    }
    function stop(s){
        if(s.frame)cancelAnimationFrame(s.frame);
        s.frame=0;s.velocity=0;s.target=null;s.omega=null;
    }
    function cancel(element,reset=false){
        const s=states.get(element);if(!s)return;stop(s);
        clearTimeout(s.wheelTimer);s.wheelTimer=0;s.wheelSamples=[];s.wheelDistance=0;s.contact=null;
        if(reset){s.position=element.scrollTop;element.style.setProperty('--shelf-pull','0px');s.written=element.scrollTop;}
    }
    function animate(s){
        if(s.frame)return;s.last=performance.now();
        const tick=time=>{
            s.frame=0;if(s.contact||dragFor(s.element).active||!s.element.isConnected)return;
            // RAF's timestamp can precede a mid-frame release. Never rewind
            // the clock, and integrate real elapsed time even after a slow
            // frame: these analytic equations need no fixed-step time clamp.
            bounds(s);const nextTime=Math.max(s.last,time),dt=(nextTime-s.last)/1000;s.last=nextTime;
            Object.assign(s,P.glide(s.position,s.velocity,dt,0,s.max,s.target,3.8,140,{omega:s.omega??springRate,damping:.82}));
            paint(s);
            const error=s.position-(s.target??P.clamp(s.position,0,s.max));
            if(Math.abs(s.velocity)<8&&Math.abs(error)<.15){
                s.position=s.target??P.clamp(s.position,0,s.max);s.velocity=0;s.target=null;s.omega=null;paint(s);return;
            }
            s.frame=requestAnimationFrame(tick);
        };
        s.frame=requestAnimationFrame(tick);
    }
    function suppressPickup(s){
        const d=dragFor(s.element);clearTimeout(d.holdTimer);d.holdTimer=null;
        d.el?.classList.remove('pressing');d.pressing=false;d.suppressClickUntil=performance.now()+500;
    }
    function moveContact(s,c,y,time){
        c.raw-=y-c.lastY;c.lastY=y;
        s.position=contactPosition(c.raw,s.max,c.length);
        sample(c.samples,s.position,time);
    }
    function attach(element){
        if(!element||states.has(element))return;
        const s={element,position:element.scrollTop,velocity:0,target:null,omega:null,max:0,frame:0,written:element.scrollTop,contact:null,wheelTimer:0,wheelSamples:[],wheelDistance:0,suppressUntil:0};
        states.set(element,s);bounds(s);element.classList.add('shelf-elastic');
        element.addEventListener('pointerdown',e=>{
            if(e.pointerType!=='touch'){cancel(element,true);return;}
            if(s.contact||e.target.closest('button,input,select,textarea,a'))return;
            cancel(element);bounds(s);
            if(Math.abs(element.scrollTop-s.written)>1)s.position=element.scrollTop;
            // Catching a bounce preserves the exact visible pose, even when
            // kinetic overshoot is larger than a normal finger-held pull.
            const length=Math.max(90,Math.abs(s.position-P.clamp(s.position,0,s.max))+24);
            s.contact={id:e.pointerId,startX:e.clientX,startY:e.clientY,lastY:e.clientY,active:false,length,
                raw:rawPosition(s.position,s.max,length),samples:[{position:s.position,time:e.timeStamp}]};
        },{capture:true,passive:true});
        document.addEventListener('pointermove',e=>{
            const c=s.contact;if(c?.id!==e.pointerId)return;
            if(dragFor(element).active){cancel(element,true);return;}
            if(!c.active&&Math.hypot(e.clientX-c.startX,e.clientY-c.startY)<6)return;
            if(!c.active){c.active=true;suppressPickup(s);try{element.setPointerCapture(e.pointerId);}catch{}}
            e.preventDefault();suppressPickup(s);
            const events=e.getCoalescedEvents?.()||[];
            for(const event of events)moveContact(s,c,event.clientY,event.timeStamp);
            moveContact(s,c,e.clientY,e.timeStamp);paint(s);
        },{capture:true,passive:false});
        const end=e=>{
            const c=s.contact;if(c?.id!==e.pointerId)return;
            if(c.active&&e.type==='pointerup'&&Math.abs(e.clientY-c.lastY)>.01){moveContact(s,c,e.clientY,e.timeStamp);paint(s);}
            s.contact=null;
            if(!c.active){
                if(outside(s)){if(reduced.matches){s.position=P.clamp(s.position,0,s.max);paint(s);}else animate(s);}
                return;
            }
            s.suppressUntil=performance.now()+400;suppressPickup(s);e.preventDefault();
            s.velocity=e.type==='pointerup'?P.sampleVelocity(c.samples,e.timeStamp):0;
            s.target=null;s.omega=null;
            if(reduced.matches){s.position=P.clamp(s.position,0,s.max);s.velocity=0;paint(s);}else animate(s);
        };
        document.addEventListener('pointerup',end,{capture:true,passive:false});
        document.addEventListener('pointercancel',end,{capture:true,passive:false});
        element.addEventListener('click',e=>{if(performance.now()<s.suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
        element.addEventListener('wheel',e=>{
            if(e.ctrlKey||e.metaKey||dragFor(element).active||s.contact)return;
            const unit=e.deltaMode===1?18:e.deltaMode===2?element.clientHeight:1,dy=e.deltaY*unit;
            if(!dy)return;e.preventDefault();bounds(s);
            if(!s.frame&&!s.wheelTimer)s.position=element.scrollTop;
            if(reduced.matches){cancel(element);s.position=P.clamp(s.position+dy,0,s.max);paint(s);return;}
            clearTimeout(s.wheelTimer);
            if(e.deltaMode||Math.abs(dy)>=60){
                s.wheelTimer=0;s.wheelSamples=[];s.wheelDistance=0;
                s.velocity=P.clamp(s.velocity+dy/.27,-5500,5500);s.target=null;s.omega=null;animate(s);
            }else{
                // Pixel streams already include OS momentum. Move them 1:1
                // inside the list; only the elastic edge retains their visible
                // velocity. The spring runs between events, not after a fixed
                // idle delay followed by a zero-velocity snap-back.
                const now=performance.now(),before=s.position;
                const length=Math.max(90,Math.abs(before-P.clamp(before,0,s.max))+24);
                if(!s.wheelSamples.length)sample(s.wheelSamples,0,now);
                s.position=contactPosition(rawPosition(before,s.max,length)+dy,s.max,length);
                s.wheelDistance+=s.position-before;sample(s.wheelSamples,s.wheelDistance,now);
                const velocity=P.sampleVelocity(s.wheelSamples,now);
                stop(s);s.velocity=outside(s)?velocity:0;paint(s);
                if(outside(s))animate(s);
                // This timer only groups input samples; it never drives motion.
                s.wheelTimer=setTimeout(()=>{s.wheelTimer=0;s.wheelSamples=[];s.wheelDistance=0;},100);
            }
        },{passive:false});
        element.addEventListener('scroll',()=>{
            if(Math.abs(element.scrollTop-s.written)>1){cancel(element,true);s.position=element.scrollTop;s.written=element.scrollTop;}
        },{passive:true});
        element.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key))cancel(element,true);},{capture:true});
    }
    ['notebookList','pageList'].forEach(id=>attach(document.getElementById(id)));
    reduced.addEventListener?.('change',()=>{if(reduced.matches)for(const s of states.values())if(!s.contact)cancel(s.element,true);});
    window.addEventListener('blur',()=>{for(const e of states.keys())cancel(e,true);});
    return{attach,cancel,snapshot(element){const s=states.get(element);return s&&{position:s.position,velocity:s.velocity,max:s.max,offset:parseFloat(element.style.getPropertyValue('--shelf-pull'))||0,animating:!!s.frame,contact:!!s.contact,omega:s.omega};}};
})();
