/* Document history commits immediately. Only a small disposable canvas shows
 * the line being drawn/un-drawn; fast repeated undo never waits for animation. */
window.HistoryMotion=(()=>{
    let overlay=null,frame=0;
    function finish(){if(frame)cancelAnimationFrame(frame);frame=0;overlay?.remove();overlay=null;}
    function prepare(stroke){
        if(matchMedia('(prefers-reduced-motion:reduce)').matches||!stroke.points?.length||stroke.isFill)return null;
        const b=getStrokeBounds(stroke.points);if(stroke.isShape&&stroke.tool==='circle'){const a=stroke.points[0],z=stroke.points.at(-1),r=Math.hypot(z.x-a.x,z.y-a.y);Object.assign(b,{minX:a.x-r,minY:a.y-r,maxX:a.x+r,maxY:a.y+r});}
        const pad=Math.max(stroke.size||1,...stroke.points.map(p=>p.size||0))*zoom+8,x=Math.max(0,Math.floor(b.minX*zoom+panX-pad)),y=Math.max(0,Math.floor(b.minY*zoom+panY-pad)),right=Math.min(viewportWidth,Math.ceil(b.maxX*zoom+panX+pad)),bottom=Math.min(viewportHeight,Math.ceil(b.maxY*zoom+panY+pad));
        if(right<=x||bottom<=y)return null;const w=Math.ceil((right-x)*baseDPR),h=Math.ceil((bottom-y)*baseDPR),before=document.createElement('canvas');before.width=w;before.height=h;before.getContext('2d').drawImage(canvas,x*baseDPR,y*baseDPR,w,h,0,0,w,h);
        return{x,y,w,h,before,camera:[zoom,panX,panY],page:pages[currentPageIndex]?.id};
    }
    function play(stroke,show,region){
        finish();if(!region)return;
        const {x,y,w,h,before,camera,page}=region,base=show?before:document.createElement('canvas');if(!show){base.width=w;base.height=h;base.getContext('2d').drawImage(canvas,x*baseDPR,y*baseDPR,w,h,0,0,w,h);}
        const layer=document.createElement('canvas');layer.className='history-stroke-motion';layer.width=w;layer.height=h;const r=canvas.getBoundingClientRect();layer.style.cssText=`position:fixed;left:${r.left+x}px;top:${r.top+y}px;width:${w/baseDPR}px;height:${h/baseDPR}px;z-index:45;pointer-events:none;`;document.body.append(layer);overlay=layer;
        const drawing=layer.getContext('2d'),lengths=[0];for(let i=1;i<stroke.points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(stroke.points[i].x-stroke.points[i-1].x,stroke.points[i].y-stroke.points[i-1].y));const total=lengths.at(-1)||1;
        const vector=isBatchableVectorPenStroke(stroke)||stroke.isGeometric?getVectorPenPath(stroke):stroke.isShape?PaintFill.boundary(stroke):null;
        let vectorLength=total;
        if(vector&&!stroke.isShape&&(!stroke.isGeometric||stroke.geometryCurve)&&stroke.points.length>2){
            const cp=stroke._bezierCP||getRealtimePenControlPoints(stroke.points);if(cp){vectorLength=0;for(let i=0;i<stroke.points.length-1;i++){const a=stroke.points[i],b=cp.firstControlPoints[i],c=cp.secondControlPoints[i],d=stroke.points[i+1];let previous=a;for(let j=1;j<=16;j++){const t=j/16,u=1-t,p={x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};vectorLength+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;}}}
        }
        if(stroke.isShape&&stroke.tool==='circle')vectorLength=Math.PI*2*Math.hypot(stroke.points.at(-1).x-stroke.points[0].x,stroke.points.at(-1).y-stroke.points[0].y);
        if(stroke.isShape&&stroke.tool==='rectangle')vectorLength=2*(Math.abs(stroke.points.at(-1).x-stroke.points[0].x)+Math.abs(stroke.points.at(-1).y-stroke.points[0].y));
        const start=performance.now(),duration=Math.min(340,Math.max(170,Math.sqrt(total*zoom)*12));
        function paint(fraction){
            drawing.setTransform(1,0,0,1,0,0);drawing.globalCompositeOperation='copy';drawing.drawImage(base,0,0);drawing.globalCompositeOperation='source-over';
            if(fraction<=0)return;drawing.setTransform(zoom*baseDPR,0,0,zoom*baseDPR,(panX-x)*baseDPR,(panY-y)*baseDPR);
            if(vector&&!stroke.geometryDashed&&stroke.tool!=='highlighter'){
                drawing.strokeStyle=getThemedColor(stroke.color);drawing.lineWidth=stroke.size;drawing.lineCap='round';drawing.lineJoin='round';drawing.setLineDash(fraction>=1?[]:[vectorLength*fraction,1e12]);drawing.stroke(vector);drawing.setLineDash([]);
            }else{
                const end=total*fraction;let i=1;while(i<lengths.length&&lengths[i]<end)i++;const points=stroke.points.slice(0,i);if(i<stroke.points.length){const a=stroke.points[i-1],b=stroke.points[i],t=(end-lengths[i-1])/(lengths[i]-lengths[i-1]||1);points.push({...b,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
                const partial={...stroke,points};delete partial._bezierPath;delete partial._bezierCP;drawStrokeToContext(partial,drawing);
            }
        }
        paint(show?0:1);
        const tick=time=>{if(overlay!==layer)return;if(page!==pages[currentPageIndex]?.id||camera.some((n,i)=>n!==[zoom,panX,panY][i])){finish();return;}const t=Math.min(1,(time-start)/duration),ease=t*t*(3-2*t);paint(show?ease:1-ease);if(t<1)frame=requestAnimationFrame(tick);else finish();};frame=requestAnimationFrame(tick);
    }
    // Pen/touch activation uses contact-up directly rather than relying on a
    // compatibility click that Linux barrel/proximity handling can suppress.
    let pressed=null,ignoreClickUntil=0;
    document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;const b=e.target.closest('#undoBtn,#redoBtn');if(!b||e.button!==0)return;pressed={button:b,id:e.pointerId};e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch{};b.classList.add('touch-feedback');},{capture:true,passive:false});
    document.addEventListener('pointerup',e=>{if(pressed?.id!==e.pointerId)return;const {button}=pressed;pressed=null;button.classList.remove('touch-feedback');const r=button.getBoundingClientRect();if(e.clientX>=r.left-6&&e.clientX<=r.right+6&&e.clientY>=r.top-6&&e.clientY<=r.bottom+6){e.preventDefault();ignoreClickUntil=performance.now()+450;if(button.id==='undoBtn')undo();else redo();}},{capture:true,passive:false});
    document.addEventListener('click',e=>{if(e.target.closest('#undoBtn,#redoBtn')&&performance.now()<ignoreClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
    document.addEventListener('pointercancel',e=>{if(pressed?.id===e.pointerId){pressed.button.classList.remove('touch-feedback');pressed=null;}},true);
    document.addEventListener('pointerdown',e=>{if(e.target.closest('#canvasContainer'))finish();},{capture:true,passive:true});
    window.addEventListener('blur',()=>{finish();pressed?.button.classList.remove('touch-feedback');pressed=null;});
    window.addEventListener('resize',finish);
    return{prepare,play,finish};
})();
