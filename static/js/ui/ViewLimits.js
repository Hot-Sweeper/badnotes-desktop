/* Resting camera range: 20%–40,000%. Fingers can stretch the ends; a bounded
 * spring returns the viewport without changing ordinary pinch sensitivity. */
window.ViewLimits=(()=>{
    const P=MotionPhysics,minZoom=.2,maxZoom=400;let frame=0,pivot=null,measureFrame=0,visible={left:0,right:innerWidth,top:0,bottom:innerHeight};
    function measure(){
        measureFrame=0;const r=canvas.getBoundingClientRect(),left=document.getElementById('sidebar'),right=document.getElementById('pageNav');
        visible={left:Math.max(0,(left&&!left.classList.contains('collapsed')?left.offsetWidth:0)-r.left),right:Math.min(viewportWidth,innerWidth-(right&&!right.classList.contains('collapsed')?right.offsetWidth:0)-r.left),top:0,bottom:viewportHeight};
        if(visible.right<visible.left+80)visible={left:0,right:viewportWidth,top:0,bottom:viewportHeight};
    }
    function scheduleMeasure(){if(!measureFrame)measureFrame=requestAnimationFrame(measure);}
    for(const id of ['sidebar','pageNav']){const panel=document.getElementById(id);if(panel){new ResizeObserver(scheduleMeasure).observe(panel);new MutationObserver(scheduleMeasure).observe(panel,{attributes:true,attributeFilter:['class','style']});}}
    new ResizeObserver(scheduleMeasure).observe(document.getElementById('canvasContainer'));scheduleMeasure();
    function limitZoom(value,elastic=false){
        const raw=Math.log(Math.max(1e-9,Number(value)||minZoom)),low=Math.log(minZoom),high=Math.log(maxZoom),edge=P.clamp(raw,low,high);
        return elastic?Math.exp(edge+P.rubber(raw-edge,.22)):Math.exp(edge);
    }
    function bounds(z=zoom){
        // Keep only a small recoverable sliver on-screen, rather than confining
        // a smaller page to the middle of the workspace. Shelves still count as
        // occlusion, so the sliver is visible in the actual drawing area.
        const axis=(size,low,high)=>{const peek=Math.min(28,(high-low)*.04,size*.12);return[low+peek-size,high-peek];};
        return{x:axis(baseWidth*z,visible.left,visible.right),y:axis(baseHeight*z,visible.top,visible.bottom)};
    }
    function limitPan(x,y,z=zoom,elastic=false){
        const b=bounds(z),axis=(n,[a,c])=>{const edge=P.clamp(n,a,c);return elastic?edge+P.rubber(n-edge,110):edge;};return{x:axis(x,b.x),y:axis(y,b.y)};
    }
    function outside(){const p=limitPan(panX,panY,zoom);return zoom<minZoom-1e-7||zoom>maxZoom+1e-7||Math.abs(p.x-panX)>.1||Math.abs(p.y-panY)>.1;}
    function projectRelease(release,contact){
        if(!release||!contact||!outside())return release;
        // Rubber-band resistance slows the visible camera, not just its travel.
        // Seed the spring with that visible velocity instead of suddenly giving
        // it the full (faster) finger velocity when the fingers leave the glass.
        const derivative=(over,length)=>Math.pow(length/(length+Math.abs(over)),2),rawLog=Math.log(contact.rawZoom),scale=release.scale*derivative(rawLog-P.clamp(rawLog,Math.log(minZoom),Math.log(maxZoom)),.22);
        const b=bounds(),r=canvas.getBoundingClientRect(),pivotX=release.pivotX-r.left,pivotY=release.pivotY-r.top;
        const axis=(raw,velocity,range,size,extent)=>{
            const resistance=derivative(raw-P.clamp(raw,...range),110),peekVelocity=size*.12<Math.min(28,extent*.04)?size*.12*scale:0;
            const edgeVelocity=raw<range[0]?peekVelocity-size*scale:raw>range[1]?-peekVelocity:0;
            return velocity*resistance+edgeVelocity*(1-resistance);
        };
        const x=axis(contact.rawX,release.x-contact.worldX*zoom*scale,b.x,baseWidth*zoom,visible.right-visible.left)+(pivotX-panX)*scale;
        const y=axis(contact.rawY,release.y-contact.worldY*zoom*scale,b.y,baseHeight*zoom,visible.bottom-visible.top)+(pivotY-panY)*scale;
        return{...release,x,y,scale};
    }
    function cancel(){if(frame)cancelAnimationFrame(frame);frame=0;}
    function settle(momentum={}){
        const speed=n=>Number.isFinite(n)?n:0;
        let vx=speed(momentum.x),vy=speed(momentum.y),z={position:Math.log(zoom),velocity:speed(momentum.scale)};
        cancel();if(!outside()&&Math.hypot(vx,vy)<8&&Math.abs(z.velocity)<.0001)return false;
        window.HistoryMotion?.finish();window.PaintFill?.cancel();
        if(matchMedia('(prefers-reduced-motion:reduce)').matches){_setZoomInternal(limitZoom(zoom));const p=limitPan(panX,panY);panX=p.x;panY=p.y;redrawCanvas(true);return true;}
        const anchor=pivot||{x:(visible.left+visible.right)/2,y:viewportHeight/2};let previous=performance.now(),xSide=0,ySide=0;
        const tick=time=>{frame=0;const dt=Math.min(.12,Math.max(0,(time-previous)/1000));previous=time;
            const oldZoom=zoom;z=P.glide(z.position,z.velocity,dt,Math.log(minZoom),Math.log(maxZoom),z.target??null,13.75,1.815);
            _setZoomInternal(Math.exp(z.position),null,null,'settling');const ratio=zoom/oldZoom;panX=anchor.x-(anchor.x-panX)*ratio;panY=anchor.y-(anchor.y-panY)*ratio;
            const b=bounds();
            const x=P.glide(panX,vx,dt,...b.x,xSide?b.x[xSide<0?0:1]:null),y=P.glide(panY,vy,dt,...b.y,ySide?b.y[ySide<0?0:1]:null);
            if(x.target!==null)xSide=x.target===b.x[0]?-1:1;if(y.target!==null)ySide=y.target===b.y[0]?-1:1;
            panX=x.position;panY=y.position;vx=x.velocity;vy=y.velocity;
            const xError=xSide?panX-b.x[xSide<0?0:1]:0,yError=ySide?panY-b.y[ySide<0?0:1]:0;
            redrawCanvas(true);
            if((z.target==null||Math.abs(z.position-z.target)<1e-5)&&Math.abs(z.velocity)<.001&&Math.abs(xError)<.15&&Math.abs(yError)<.15&&Math.abs(vx)+Math.abs(vy)<8){
                const old=zoom;_setZoomInternal(z.target!=null?Math.exp(z.target):P.clamp(zoom,minZoom,maxZoom));panX=anchor.x-(anchor.x-panX)*zoom/old;panY=anchor.y-(anchor.y-panY)*zoom/old;
                const p=limitPan(panX,panY),finalBounds=bounds();panX=xSide?finalBounds.x[xSide<0?0:1]:p.x;panY=ySide?finalBounds.y[ySide<0?0:1]:p.y;redrawCanvas(true);return;
            }
            frame=requestAnimationFrame(tick);
        };frame=requestAnimationFrame(tick);return true;
    }
    document.addEventListener('pointerdown',cancel,{capture:true,passive:true});
    window.addEventListener('blur',cancel);window.addEventListener('resize',()=>{cancel();scheduleMeasure();});
    return{minZoom,maxZoom,zoom:limitZoom,pan:limitPan,bounds,outside,cancel,settle,projectRelease,setPivot(x,y){pivot={x,y};},get animating(){return!!frame;}};
})();
