/* Palette-drop fill uses the actual vector boundary. Commit once, then reveal
 * the result on a bounded overlay; animation never postpones saving/history. */
window.PaintFill=(()=>{
    const hit=document.createElement('canvas').getContext('2d');let overlay=null,frame=0;
    function cancel(){if(frame)cancelAnimationFrame(frame);frame=0;overlay?.remove();overlay=null;}
    function boundary(stroke){
        if(!stroke?.points?.length||stroke.isFill||stroke.points.some(p=>p.break))return null;
        const first=stroke.points[0],last=stroke.points.at(-1),path=new Path2D();
        if(stroke.isShape&&stroke.tool==='circle'){path.arc(first.x,first.y,Math.hypot(last.x-first.x,last.y-first.y),0,Math.PI*2);return path;}
        if(stroke.isShape&&stroke.tool==='rectangle'){path.rect(first.x,first.y,last.x-first.x,last.y-first.y);return path;}
        if(stroke.points.length<3)return null;
        const bounds=getStrokeBounds(stroke.points),gap=Math.hypot(first.x-last.x,first.y-last.y);
        if(gap>Math.max(12,Math.hypot(bounds.width,bounds.height)*.13))return null;
        const vector=getVectorPenPath(stroke);if(!vector)return null;path.addPath(vector);path.closePath();return path;
    }
    function drop(x,y,color){
        if(x<0||y<0||x>baseWidth||y>baseHeight||!/^#[0-9a-f]{6}$/i.test(color))return false;
        cancel();window.HistoryMotion?.finish();
        let target=-1,path;
        for(let i=strokes.length-1;i>=0;i--){const p=boundary(strokes[i]);if(p&&hit.isPointInPath(p,x,y,'evenodd')){target=i;path=p;break;}}
        if(target<0){showToast('Drop inside a closed shape to fill it.','info');return false;}
        const source=strokes[target],bounds=getStrokeBounds(source.points);
        if(source.isShape&&source.tool==='circle'){const a=source.points[0],b=source.points.at(-1),r=Math.hypot(b.x-a.x,b.y-a.y);Object.assign(bounds,{minX:a.x-r,minY:a.y-r,maxX:a.x+r,maxY:a.y+r,width:r*2,height:r*2});}
        const sx=Math.max(0,Math.floor(bounds.minX*zoom+panX-8)),sy=Math.max(0,Math.floor(bounds.minY*zoom+panY-8)),right=Math.min(viewportWidth,Math.ceil(bounds.maxX*zoom+panX+8)),bottom=Math.min(viewportHeight,Math.ceil(bounds.maxY*zoom+panY+8));
        let layer,layerCtx;
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&right>sx&&bottom>sy){
            layer=document.createElement('canvas');layer.className='fill-reveal-overlay';layer.width=Math.ceil((right-sx)*baseDPR);layer.height=Math.ceil((bottom-sy)*baseDPR);const r=canvas.getBoundingClientRect();layer.style.cssText=`position:fixed;left:${r.left+sx}px;top:${r.top+sy}px;width:${right-sx}px;height:${bottom-sy}px;pointer-events:none;z-index:50;`;
            layerCtx=layer.getContext('2d');layerCtx.drawImage(canvas,sx*baseDPR,sy*baseDPR,layer.width,layer.height,0,0,layer.width,layer.height);document.body.append(layer);overlay=layer;
        }
        const fill={id:crypto.randomUUID(),tool:source.isShape?source.tool:'path',isShape:!!source.isShape,isGeometric:!!source.isGeometric,geometryCurve:source.geometryCurve,geometryType:source.geometryType,isFill:true,fillExact:true,fillRule:'evenodd',size:0,color,fillColor:color,originalStrokeId:source.id,points:source.points.map(p=>({...p}))};
        strokes.splice(target,0,fill);historyStack.push({type:'add',stroke:fill,index:target});redoStack=[];invalidateStrokeCache(false);redrawCanvas(true);triggerAutoSave();window.PageThumbnails?.dirty(pages[currentPageIndex]?.id);
        if(layer){const start=performance.now(),px=(x*zoom+panX-sx)*baseDPR,py=(y*zoom+panY-sy)*baseDPR,maxRadius=Math.max(...[[0,0],[layer.width,0],[0,layer.height],[layer.width,layer.height]].map(([a,b])=>Math.hypot(a-px,b-py)))+2;
            const tick=time=>{if(overlay!==layer)return;const progress=Math.min(1,(time-start)/300),radius=maxRadius*(1-(1-progress)**3);layerCtx.globalCompositeOperation='destination-out';layerCtx.beginPath();layerCtx.arc(px,py,radius,0,Math.PI*2);layerCtx.fill();if(progress<1)frame=requestAnimationFrame(tick);else cancel();};frame=requestAnimationFrame(tick);
        }
        return fill;
    }
    document.addEventListener('pointerdown',e=>{if(e.target.closest('#canvasContainer'))cancel();},{capture:true,passive:true});
    window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);
    return{drop,boundary,cancel};
})();
