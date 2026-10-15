/** Shape recognition and construction; persisted as editable vector points. */
class GeometryEngine {
    constructor(){
        this.enabled=false;this.mode='auto';this.snap=true;this.snapAngleThreshold=6;this.fill=false;this.dashed=false;
        this.catalog=[['auto','Auto recognize'],['line','Line'],['arrow','Arrow'],['double-arrow','Double arrow'],['polyline','Polyline'],['rectangle','Rectangle'],['square','Square'],['rounded-rectangle','Rounded rectangle'],['circle','Circle'],['ellipse','Ellipse'],['arc','Arc'],['semicircle','Semicircle'],['triangle','Triangle'],['right-triangle','Right triangle'],['diamond','Diamond'],['parallelogram','Parallelogram'],['trapezoid','Trapezoid'],['pentagon','Pentagon'],['hexagon','Hexagon'],['heptagon','Heptagon'],['octagon','Octagon'],['star','Star'],['heart','Heart'],['chevron','Chevron'],['cross','Cross'],['axes','Axes']];
    }
    setEnabled(value){this.enabled=!!value;window.dispatchEvent(new CustomEvent('geometryChanged'));}
    toggle(){this.setEnabled(!this.enabled);return this.enabled;}
    isEnabled(){return this.enabled;}
    distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
    getBounds(points){let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);r=Math.max(r,p.x);b=Math.max(b,p.y);}return{x,y,width:r-x,height:b-y,centerX:(x+r)/2,centerY:(y+b)/2};}
    segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return this.distance(p,{x:a.x+t*dx,y:a.y+t*dy});}
    simplify(points,epsilon){
        if(points.length<3)return points.slice();const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
        while(stack.length){const[a,b]=stack.pop();let far=-1,error=epsilon;for(let i=a+1;i<b;i++){const d=this.segmentDistance(points[i],points[a],points[b]);if(d>error){error=d;far=i;}}if(far>=0){keep.add(far);stack.push([a,far],[far,b]);}}
        return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
    }
    resample(points,count=160){
        const clean=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(clean.length<2)return clean;
        const lengths=[0];for(let i=1;i<clean.length;i++)lengths.push(lengths[i-1]+this.distance(clean[i-1],clean[i]));const total=lengths.at(-1);if(total<1e-7)return[clean[0]];
        const result=[];let j=1;for(let i=0;i<count;i++){const d=total*i/(count-1);while(j<clean.length-1&&lengths[j]<d)j++;const t=(d-lengths[j-1])/(lengths[j]-lengths[j-1]||1);result.push({x:clean[j-1].x+(clean[j].x-clean[j-1].x)*t,y:clean[j-1].y+(clean[j].y-clean[j-1].y)*t});}return result;
    }
    snapLineToAngle(start,end,force=false){const length=this.distance(start,end),angle=Math.atan2(end.y-start.y,end.x-start.x),nearest=Math.round(angle/(Math.PI/12))*Math.PI/12;const target=(force||this.snap&&Math.abs(nearest-angle)<this.snapAngleThreshold*Math.PI/180)?nearest:angle;return{start,end:{x:start.x+length*Math.cos(target),y:start.y+length*Math.sin(target)}};}
    ellipseFit(points){
        const sample=points.slice(0,-1),n=sample.length;let cx=0,cy=0;for(const p of sample){cx+=p.x/n;cy+=p.y/n;}let xx=0,xy=0,yy=0;for(const p of sample){xx+=(p.x-cx)**2;xy+=(p.x-cx)*(p.y-cy);yy+=(p.y-cy)**2;}
        const angle=.5*Math.atan2(2*xy,xx-yy),c=Math.cos(angle),s=Math.sin(angle),local=points.map(p=>({x:(p.x-cx)*c+(p.y-cy)*s,y:-(p.x-cx)*s+(p.y-cy)*c})),box=this.getBounds(local),rx=box.width/2,ry=box.height/2;if(Math.min(rx,ry)<2)return null;
        cx+=box.centerX*c-box.centerY*s;cy+=box.centerX*s+box.centerY*c;let error=0,travel=0,previous=null;
        for(const p of local){const x=(p.x-box.centerX)/rx,y=(p.y-box.centerY)/ry,a=Math.atan2(y,x);error+=Math.abs(Math.hypot(x,y)-1);if(previous!==null)travel+=Math.atan2(Math.sin(a-previous),Math.cos(a-previous));previous=a;}return{cx,cy,rx,ry,angle,error:error/points.length,travel:Math.abs(travel)};
    }
    circleFit(points){
        const mean=points.reduce((a,p)=>({x:a.x+p.x/points.length,y:a.y+p.y/points.length}),{x:0,y:0}),m=[[0,0,0,0],[0,0,0,0],[0,0,points.length,0]];
        for(const p of points){const x=p.x-mean.x,y=p.y-mean.y,z=-(x*x+y*y);m[0][0]+=x*x;m[0][1]+=x*y;m[0][2]+=x;m[0][3]+=x*z;m[1][0]+=x*y;m[1][1]+=y*y;m[1][2]+=y;m[1][3]+=y*z;m[2][0]+=x;m[2][1]+=y;m[2][3]+=z;}
        for(let k=0;k<3;k++){let pivot=k;for(let j=k+1;j<3;j++)if(Math.abs(m[j][k])>Math.abs(m[pivot][k]))pivot=j;[m[k],m[pivot]]=[m[pivot],m[k]];const d=m[k][k];if(Math.abs(d)<1e-8)return null;for(let j=k;j<4;j++)m[k][j]/=d;for(let i=0;i<3;i++)if(i!==k){const f=m[i][k];for(let j=k;j<4;j++)m[i][j]-=f*m[k][j];}}
        const x=-m[0][3]/2,y=-m[1][3]/2,r=Math.sqrt(x*x+y*y-m[2][3]);if(!Number.isFinite(r)||r<2)return null;const center={x:x+mean.x,y:y+mean.y};let error=0,sweep=0,travel=0,previous=null;
        for(const p of points){error+=Math.abs(this.distance(p,center)-r)/r;const a=Math.atan2(p.y-center.y,p.x-center.x);if(previous!==null){const delta=Math.atan2(Math.sin(a-previous),Math.cos(a-previous));sweep+=delta;travel+=Math.abs(delta);}previous=a;}
        return{cx:center.x,cy:center.y,rx:r,ry:r,angle:0,startAngle:Math.atan2(points[0].y-center.y,points[0].x-center.x),sweep,error:error/points.length,consistency:Math.abs(sweep)/(travel||1)};
    }
    polygonCorners(points,epsilon){
        const ring=points.slice(0,-1);let far=1;for(let i=2;i<ring.length;i++)if(this.distance(ring[0],ring[i])>this.distance(ring[0],ring[far]))far=i;
        let corners=[...this.simplify(ring.slice(0,far+1),epsilon).slice(0,-1),...this.simplify([...ring.slice(far),ring[0]],epsilon).slice(0,-1)];let changed=true;
        while(changed&&corners.length>3){changed=false;for(let i=0;i<corners.length;i++)if(this.segmentDistance(corners[i],corners[(i+corners.length-1)%corners.length],corners[(i+1)%corners.length])<epsilon){corners.splice(i,1);changed=true;break;}}return corners;
    }
    hasDeepConcavity(points,diagonal){
        const sorted=points.slice(0,-1).sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
        function half(list){const hull=[];for(const p of list){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=0)hull.pop();hull.push(p);}return hull.slice(0,-1);}
        const hull=[...half(sorted),...half([...sorted].reverse())];
        return points.some(p=>Math.min(...hull.map((a,i)=>this.segmentDistance(p,a,hull[(i+1)%hull.length])))>diagonal*.065);
    }
    matchRoundedTemplate(points,type,rough=false){
        const fit=this.ellipseFit(points);if(!fit)return null;let best=null;
        this.templateSamples??={};const template=this.templateSamples[type]??=this.resample(this.createShape(type,{x:0,y:0},{x:100,y:100}).points,64),templateBox=this.getBounds(template);
        const simplified=this.simplify(points,Math.hypot(fit.rx,fit.ry)*.04);let edge=null;
        for(let i=1;i<simplified.length;i++)if(!edge||this.distance(simplified[i-1],simplified[i])>edge.length)edge={length:this.distance(simplified[i-1],simplified[i]),angle:Math.atan2(simplified[i].y-simplified[i-1].y,simplified[i].x-simplified[i-1].x)};
        const angles=[...Array.from({length:4},(_,i)=>fit.angle+i*Math.PI/2),...Array.from({length:4},(_,i)=>(edge?.angle||0)+i*Math.PI/2),...(rough?Array.from({length:24},(_,i)=>i*Math.PI/12):[])];
        for(const angle of angles){
            const c=Math.cos(angle),s=Math.sin(angle),local=points.map(p=>({x:p.x*c+p.y*s,y:-p.x*s+p.y*c})),box=this.getBounds(local),diagonal=Math.hypot(box.width,box.height);
            const aligned=type==='rounded-rectangle'?this.resample(this.createShape(type,{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}).points,64):template.map(p=>({x:box.x+(p.x-templateBox.x)/templateBox.width*box.width,y:box.y+(p.y-templateBox.y)/templateBox.height*box.height}));
            const errors=this.resample(local,48).map(p=>{let nearest=Infinity;for(let i=1;i<aligned.length;i++){const a=aligned[i-1],b=aligned[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1))),x=p.x-a.x-t*dx,y=p.y-a.y-t*dy;nearest=Math.min(nearest,x*x+y*y);}return Math.sqrt(nearest)/diagonal;}).sort((a,b)=>a-b),mean=errors.reduce((sum,n)=>sum+n/errors.length,0);
            // A rough heart must cover both lobes and the point, not merely lie
            // near one part of the template. This rejects spirals and scribbles.
            if(mean>=(rough?.055:.012)||errors[Math.floor(errors.length*.95)]>=(rough?.18:.035))continue;
            const coveragePoints=rough?this.resample(local,64):[];
            let coverage=0;
            if(rough)for(const p of aligned){let nearest=Infinity;for(let i=1;i<coveragePoints.length;i++){const a=coveragePoints[i-1],b=coveragePoints[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1))),x=p.x-a.x-t*dx,y=p.y-a.y-t*dy;nearest=Math.min(nearest,x*x+y*y);}coverage+=Math.sqrt(nearest)/diagonal/aligned.length;}
            const travel=local.slice(1).reduce((sum,p,i)=>sum+this.distance(p,local[i]),0),templateTravel=aligned.slice(1).reduce((sum,p,i)=>sum+this.distance(p,aligned[i]),0);
            if(mean<(rough?.055:.012)&&errors[Math.floor(errors.length*.95)]<(rough?.18:.035)&&(!rough||coverage<.08&&travel/templateTravel<1.4)&&(!best||mean<best.error))best={type,confidence:rough?Math.max(.81,1-mean*3):1-mean*8,error:mean,templatePoints:aligned.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})),curve:type==='heart'};
        }return best;
    }
    detectShape(raw){
        const clean=raw.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(clean.length<2)return{type:'freehand',confidence:0};
        const bounds=this.getBounds(clean),diagonal=Math.hypot(bounds.width,bounds.height);if(diagonal<1e-6)return{type:'freehand',confidence:0};
        // Fit in normalized coordinates: the same gesture at 10% or 1000%
        // zoom must not fall through arbitrary world-unit thresholds.
        const factor=256/diagonal,toWorld=p=>({...p,x:p.x/factor+bounds.x,y:p.y/factor+bounds.y});
        const result=this.detectNormalized(clean.map(p=>({x:(p.x-bounds.x)*factor,y:(p.y-bounds.y)*factor})));
        if(result.start)result.start=toWorld(result.start);if(result.end)result.end=toWorld(result.end);if(result.corners)result.corners=result.corners.map(toWorld);
        if(result.templatePoints)result.templatePoints=result.templatePoints.map(toWorld);
        if(result.ellipse){const e=result.ellipse;e.cx=e.cx/factor+bounds.x;e.cy=e.cy/factor+bounds.y;e.rx/=factor;e.ry/=factor;}
        result.bounds=bounds;return result;
    }
    detectNormalized(raw){
        // Remove a small closure overshoot after the loop first returns near
        // its start. Never trim the main stroke or bridge an arbitrary scribble.
        let source=raw;const rawBox=this.getBounds(raw),rawDiagonal=Math.hypot(rawBox.width,rawBox.height);
        for(let i=Math.floor(raw.length*.82);i<raw.length-2;i++)if(this.distance(raw[i],raw[0])<rawDiagonal*.045&&this.distance(raw.at(-1),raw[0])<rawDiagonal*.2){source=raw.slice(0,i+1);break;}
        const points=this.resample(source);if(points.length<2)return{type:'freehand',confidence:0};const bounds=this.getBounds(points),diagonal=Math.hypot(bounds.width,bounds.height);if(diagonal<8)return{type:'freehand',confidence:0};const start=points[0],end=points.at(-1),closed=this.distance(start,end)<diagonal*.2;
        if(closed){
            const loop=[...points];loop[loop.length-1]=start;let corners=this.polygonCorners(loop,diagonal*.035);
            const smoothEllipse=this.ellipseFit(loop);
            if(smoothEllipse&&smoothEllipse.error<.022&&smoothEllipse.travel>5.4&&smoothEllipse.travel<7.1){const circle=Math.abs(smoothEllipse.rx-smoothEllipse.ry)/Math.max(smoothEllipse.rx,smoothEllipse.ry)<.08;return{type:circle?'circle':'ellipse',confidence:1-smoothEllipse.error*3,ellipse:smoothEllipse,bounds};}
            if(corners.length>=6){
                const heart=this.matchRoundedTemplate(loop,'heart');if(heart)return heart;
                const rounded=this.matchRoundedTemplate(loop,'rounded-rectangle');if(rounded)return rounded;
            }
            const coarse=this.polygonCorners(loop,diagonal*.055);
            if(coarse.length===3&&corners.length>3)corners=coarse;
            const roundedTriangle=this.polygonCorners(loop,diagonal*.085);
            if(roundedTriangle.length===3&&corners.length>3)corners=roundedTriangle;
            if(corners.length>=3&&corners.length<=12){
                const error=points.reduce((sum,p)=>sum+Math.min(...corners.map((a,i)=>this.segmentDistance(p,a,corners[(i+1)%corners.length]))),0)/points.length/diagonal,lengths=corners.map((p,i)=>this.distance(p,corners[(i+1)%corners.length])),turns=corners.map((p,i)=>{const a=corners[(i+corners.length-1)%corners.length],b=corners[(i+1)%corners.length];return Math.atan2((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x),(p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y));});
                if(error<(corners.length===3?.035:.022)&&Math.min(...turns.map(Math.abs))>.32){let type=corners.length===3?(turns.some(a=>Math.abs(Math.abs(a)-Math.PI/2)<.13)?'right-triangle':'triangle'):'polygon';const regular=Math.max(...lengths)/Math.min(...lengths)<1.22;
                    if(corners.length===4){const right=turns.every(a=>Math.abs(Math.abs(a)-Math.PI/2)<.24);const parallel=(a,b)=>Math.abs(Math.sin(Math.atan2(corners[(a+1)%4].y-corners[a].y,corners[(a+1)%4].x-corners[a].x)-Math.atan2(corners[(b+1)%4].y-corners[b].y,corners[(b+1)%4].x-corners[b].x)))<.15;type=right?(regular?'square':'rectangle'):(regular?'diamond':parallel(0,2)&&parallel(1,3)?'parallelogram':parallel(0,2)||parallel(1,3)?'trapezoid':'quadrilateral');}
                    if(corners.length>=5&&corners.length<=8&&regular)type=['pentagon','hexagon','heptagon','octagon'][corners.length-5];
                    const negative=turns.filter(t=>t<0).length,concave=Math.min(negative,corners.length-negative);
                    if(corners.length===10&&concave===5)type='star';
                    if(corners.length===12&&concave===4)type='cross';
                    if(corners.length===6&&concave===1)type='chevron';
                    if(type==='polygon'&&corners.length>=7&&this.hasDeepConcavity(loop,diagonal)){const heart=this.matchRoundedTemplate(loop,'heart',true);if(heart)return heart;}
                    return{type,confidence:Math.max(.81,1-error*8),corners,bounds};
                }
            }
            const ellipse=this.ellipseFit(loop);if(ellipse&&ellipse.error<.065&&ellipse.travel>5.4&&ellipse.travel<7.1){const circle=Math.abs(ellipse.rx-ellipse.ry)/Math.max(ellipse.rx,ellipse.ry)<.08;return{type:circle?'circle':'ellipse',confidence:1-ellipse.error*3,ellipse,bounds};}
            if(corners.length>=7&&this.hasDeepConcavity(loop,diagonal)){const heart=this.matchRoundedTemplate(loop,'heart',true);if(heart)return heart;}
        }else{
            const direct=this.distance(start,end),length=points.slice(1).reduce((sum,p,i)=>sum+this.distance(p,points[i]),0),error=points.reduce((sum,p)=>sum+this.segmentDistance(p,start,end),0)/points.length;
            if(direct>8&&error/direct<.027&&length/direct<1.15)return{type:'line',confidence:1-error/direct*4,start,end,bounds};
            const vertices=this.simplify(points,diagonal*.022);
            if(vertices.length>=4&&vertices.length<=6)for(const candidate of[vertices,[...vertices].reverse()]){const tip=candidate[1],shaft=this.distance(candidate[0],tip),tail=candidate.slice(2);if(shaft>diagonal*.65&&tail.every(p=>this.distance(p,tip)<shaft*.4)&&tail.some(p=>this.distance(p,tip)<shaft*.08))return{type:'arrow',confidence:.9,start:candidate[0],end:tip,bounds};}
            const arc=this.circleFit(points);if(arc&&arc.error<.035&&arc.consistency>.96&&Math.abs(arc.sweep)>.55&&Math.abs(arc.sweep)<5.65)return{type:'arc',confidence:1-arc.error*4,ellipse:arc,bounds};
            if(vertices.length>=3&&vertices.length<=8){const fit=points.reduce((sum,p)=>sum+Math.min(...vertices.slice(1).map((b,i)=>this.segmentDistance(p,vertices[i],b))),0)/points.length/diagonal;if(fit<.007)return{type:'polyline',confidence:.85,corners:vertices,bounds};}
        }return{type:'freehand',confidence:0};
    }
    processStroke(stroke){
        if(!this.enabled||stroke.tool!=='pen'||stroke.isGeometric||!stroke.points?.length)return stroke;
        const box=this.getBounds(stroke.points),screenScale=typeof zoom==='number'?zoom:1;
        if(Math.hypot(box.width,box.height)*screenScale<12)return stroke;
        const detected=this.mode==='polyline'?{type:'polyline',confidence:1,corners:this.simplify(this.resample(stroke.points),Math.max(1,Math.hypot(this.getBounds(stroke.points).width,this.getBounds(stroke.points).height)*.02))}:this.detectShape(stroke.points);if(detected.confidence<.8)return stroke;
        const result=this.createCleanStroke(detected,stroke);window.dispatchEvent(new CustomEvent('geometryRecognized',{detail:{type:result.geometryType,confidence:detected.confidence}}));return result;
    }
    joinArrowGroup(previous,raw){
        if(!this.enabled||this.mode!=='auto'||raw.tool!=='pen'||previous.length===0)return null;
        const first=Math.max(0,previous.length-3),recent=previous.slice(first).map((item,i)=>({item,index:first+i})).filter(({item})=>item.tool==='pen'&&item.color===raw.color&&Number.isFinite(Number(item.id))&&Math.abs(Date.now()-Number(item.id))<6000);
        const rawBox=this.getBounds(raw.points),vertices=this.simplify(this.resample(raw.points,64),Math.hypot(rawBox.width,rawBox.height)*.045);
        const tryHead=(shaft,head,extra=[])=>{
            if(head.length!==3)return null;
            const ends=[shaft.item.points[0],shaft.item.points.at(-1)];
            for(let i=0;i<2;i++){
                const tip=ends[i],start=ends[1-i],length=this.distance(tip,start);if(length<20||this.distance(tip,head[1])>length*.08)continue;
                const dx=(tip.x-start.x)/length,dy=(tip.y-start.y)/length,arms=[head[0],head[2]].map(p=>({back:(tip.x-p.x)*dx+(tip.y-p.y)*dy,side:(p.x-tip.x)*dy-(p.y-tip.y)*dx,length:this.distance(p,tip)}));
                if(!arms.every(a=>a.length>length*.05&&a.length<length*.42&&a.back>length*.025)||arms[0].side*arms[1].side>=0||Math.min(...arms.map(a=>Math.abs(a.side)))<length*.025)continue;
                const stroke=this.makeStroke(this.arrowPoints(start,tip,raw.size),{...shaft.item,size:raw.size},'arrow',false,.9);
                return{remove:[shaft.index,...extra.map(r=>r.index)],index:shaft.index,stroke};
            }return null;
        };
        const shafts=recent.filter(({item})=>item.geometryType==='line'||(!item.isGeometric&&this.detectShape(item.points).type==='line'));
        for(const shaft of shafts){const one=tryHead(shaft,vertices);if(one)return one;
            if(vertices.length!==2)continue;
            for(const wing of recent){if(wing===shaft||wing.index<shaft.index)continue;const ends=wing.item.points;if(ends.length<2)continue;
                for(const a of[ends[0],ends.at(-1)])for(const b of vertices){if(this.distance(a,b)>this.distance(shaft.item.points[0],shaft.item.points.at(-1))*.08)continue;const other=ends[0]===a?ends.at(-1):ends[0],rawOther=vertices[0]===b?vertices[1]:vertices[0];const group=tryHead(shaft,[other,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},rawOther],[wing]);if(group)return group;}
            }
        }return null;
    }
    refineCorners(detected){
        const corners=detected.corners;if(!corners)return[];
        const center=corners.reduce((sum,p)=>({x:sum.x+p.x/corners.length,y:sum.y+p.y/corners.length}),{x:0,y:0});
        if(['rectangle','square'].includes(detected.type)){
            const edge={x:(corners[1].x-corners[0].x)-(corners[3].x-corners[2].x),y:(corners[1].y-corners[0].y)-(corners[3].y-corners[2].y)},length=Math.hypot(edge.x,edge.y)||1,u={x:edge.x/length,y:edge.y/length},v={x:-edge.y/length,y:edge.x/length};
            const projected=corners.map(p=>({x:(p.x-center.x)*u.x+(p.y-center.y)*u.y,y:(p.x-center.x)*v.x+(p.y-center.y)*v.y}));let hx=projected.reduce((sum,p)=>sum+Math.abs(p.x)/4,0),hy=projected.reduce((sum,p)=>sum+Math.abs(p.y)/4,0);if(detected.type==='square')hx=hy=(hx+hy)/2;
            return projected.map(p=>({x:center.x+Math.sign(p.x)*hx*u.x+Math.sign(p.y)*hy*v.x,y:center.y+Math.sign(p.x)*hx*u.y+Math.sign(p.y)*hy*v.y}));
        }
        if(['pentagon','hexagon','heptagon','octagon'].includes(detected.type)){
            const radius=corners.reduce((sum,p)=>sum+this.distance(center,p)/corners.length,0),first=Math.atan2(corners[0].y-center.y,corners[0].x-center.x),direction=Math.sign((corners[1].x-center.x)*(corners[0].y-center.y)-(corners[1].y-center.y)*(corners[0].x-center.x))||-1;
            return corners.map((_,i)=>({x:center.x+radius*Math.cos(first-direction*i*2*Math.PI/corners.length),y:center.y+radius*Math.sin(first-direction*i*2*Math.PI/corners.length)}));
        }return corners;
    }
    createCleanStroke(detected,original){let points,curve=false;if(detected.templatePoints){points=detected.templatePoints;curve=detected.curve;}else if(detected.ellipse){const e=detected.ellipse;if(detected.type==='circle')e.rx=e.ry=(e.rx+e.ry)/2;points=this.ellipsePoints(e.cx,e.cy,e.rx,e.ry,e.angle,e.startAngle||0,e.sweep??Math.PI*2);curve=true;}else if(detected.type==='line'){const line=this.snapLineToAngle(detected.start,detected.end);points=[line.start,line.end];}else if(detected.type==='arrow')points=this.arrowPoints(detected.start,detected.end,original.size,false);else{const corners=this.refineCorners(detected);points=corners.concat(detected.type==='polyline'?[]:[corners[0]]);}return this.makeStroke(points,original,detected.type,curve,detected.confidence);}
    makeStroke(points,original,type,curve=false,confidence=1){
        const closed=points.length>2&&!points.some(p=>p.break)&&this.distance(points[0],points.at(-1))<.01;
        const stroke={...original,tool:'pen',isShape:false,isGeometric:true,geometryType:type,geometryCurve:curve,geometryConfidence:confidence,geometryFill:closed&&this.fill,geometryDashed:this.dashed,points:points.map(p=>({...p,size:original.size,pressure:.5}))};for(const key of Object.keys(stroke))if(key.startsWith('_')||key.startsWith('live')||key==='geometryDraft'||key==='tempCanvas'||key==='tempCtx')delete stroke[key];return stroke;
    }
    ellipsePoints(cx,cy,rx,ry,rotation=0,start=0,sweep=Math.PI*2){const result=[],n=Math.max(16,Math.ceil(Math.abs(sweep)*24)),c=Math.cos(rotation),s=Math.sin(rotation);for(let i=0;i<=n;i++){const a=start+sweep*i/n,x=rx*Math.cos(a),y=ry*Math.sin(a);result.push({x:cx+x*c-y*s,y:cy+x*s+y*c});}return result;}
    arrowPoints(a,b,size=2,double=false){const{start,end}=this.snapLineToAngle(a,b),length=this.distance(start,end),head=Math.min(length*.3,Math.max(size*4,length*.16)),angle=Math.atan2(end.y-start.y,end.x-start.x),points=[start,end];const add=(tip,angle)=>{points.push({x:tip.x-head*Math.cos(angle-.5),y:tip.y-head*Math.sin(angle-.5),break:true},tip,{x:tip.x-head*Math.cos(angle+.5),y:tip.y-head*Math.sin(angle+.5)});};add(end,angle);if(double)add(start,angle+Math.PI);return points;}
    createShape(type,start,end,original={},options={}){
        original={id:Date.now(),color:'#ffffff',size:2,...original};if(type==='line'){const line=this.snapLineToAngle(start,end,options.constrain);return this.makeStroke([line.start,line.end],original,type);}if(type==='arrow'||type==='double-arrow')return this.makeStroke(this.arrowPoints(start,end,original.size,type==='double-arrow'),original,type);
        let w=Math.abs(end.x-start.x),h=Math.abs(end.y-start.y),x=Math.min(start.x,end.x),y=Math.min(start.y,end.y);if(options.constrain||['square','circle'].includes(type)){const d=Math.max(w,h);w=h=d;x=end.x<start.x?start.x-d:start.x;y=end.y<start.y?start.y-d:start.y;}if(options.center){x=start.x-w;y=start.y-h;w*=2;h*=2;}
        const cx=x+w/2,cy=y+h/2,pt=(u,v)=>({x:x+u*w,y:y+v*h});let points=[],curve=false;const regular=(n,inner=1)=>Array.from({length:n},(_,i)=>{const a=-Math.PI/2+i*Math.PI*2/n,r=i%2?inner:1;return{x:cx+w/2*r*Math.cos(a),y:cy+h/2*r*Math.sin(a)};});
        switch(type){
            case'circle':case'ellipse':points=this.ellipsePoints(cx,cy,w/2,h/2);curve=true;break;
            case'arc':points=this.ellipsePoints(cx,cy,w/2,h/2,0,Math.PI,Math.PI*1.5);curve=true;break;
            case'semicircle':points=this.ellipsePoints(cx,y+h,w/2,h,0,Math.PI,Math.PI);curve=true;break;
            case'triangle':points=[pt(.5,0),pt(1,1),pt(0,1)];break;
            case'right-triangle':points=[pt(0,0),pt(1,1),pt(0,1)];break;
            case'diamond':points=[pt(.5,0),pt(1,.5),pt(.5,1),pt(0,.5)];break;
            case'parallelogram':points=[pt(.25,0),pt(1,0),pt(.75,1),pt(0,1)];break;
            case'trapezoid':points=[pt(.25,0),pt(.75,0),pt(1,1),pt(0,1)];break;
            case'pentagon':case'hexagon':case'heptagon':case'octagon':points=regular({pentagon:5,hexagon:6,heptagon:7,octagon:8}[type]);break;
            case'star':points=regular(10,.44);break;
            case'chevron':points=[pt(0,0),pt(.6,0),pt(1,.5),pt(.6,1),pt(0,1),pt(.4,.5)];break;
            case'cross':points=[[.35,0],[.65,0],[.65,.35],[1,.35],[1,.65],[.65,.65],[.65,1],[.35,1],[.35,.65],[0,.65],[0,.35],[.35,.35]].map(([u,v])=>pt(u,v));break;
            case'heart':for(let i=0;i<=160;i++){const t=i*Math.PI*2/160;points.push(pt(.5+(16*Math.sin(t)**3)/32,.48-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/34));}curve=true;break;
            case'rounded-rectangle':{const r=Math.min(w,h)*.18;for(const[a,b,startAngle]of[[x+w-r,y+r,-Math.PI/2],[x+w-r,y+h-r,0],[x+r,y+h-r,Math.PI/2],[x+r,y+r,Math.PI]])points.push(...this.ellipsePoints(a,b,r,r,0,startAngle,Math.PI/2));break;}
            case'axes':points=[pt(0,.5),pt(1,.5),{...pt(.5,1),break:true},pt(.5,0)];break;
            case'polyline':points=[start,end];break;
            default:points=[pt(0,0),pt(1,0),pt(1,1),pt(0,1)];
        }
        if(!['arc','semicircle','axes','polyline'].includes(type)&&points.length>2&&this.distance(points[0],points.at(-1))>.0001)points.push({...points[0]});return this.makeStroke(points,original,type,curve);
    }
}
window.GeometryDetector=new GeometryEngine();
