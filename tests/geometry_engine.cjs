const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}};vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/tools/GeometryEngine.js','utf8'),context);
const engine=context.window.GeometryDetector;
const original={id:21,tool:'pen',size:3,color:'#6c5ce7',opacity:0,points:[]};
let shapes=0;
for(const[type]of engine.catalog.filter(([type])=>type!=='auto'))for(const[start,end]of[[{x:30,y:40},{x:190,y:170}],[{x:190,y:170},{x:30,y:40}],[{x:30,y:40},{x:30,y:40}]]){
    const shape=engine.createShape(type,start,end,original);
    assert(shape.points.length>=2,type);assert(shape.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),type+' finite');assert.equal(shape.id,21);assert.equal(shape.opacity,0);assert.equal(shape.isGeometric,true);assert.equal(shape.color,original.color);assert.equal(JSON.parse(JSON.stringify(shape)).geometryType,type);shapes++;
}
const sample=points=>{const result=[];for(let i=1;i<points.length;i++){if(points[i].break)continue;for(let j=0;j<20;j++){const t=j/20;result.push({x:points[i-1].x+(points[i].x-points[i-1].x)*t,y:points[i-1].y+(points[i].y-points[i-1].y)*t});}}result.push(points.at(-1));return result;};
const recognition={};
for(const type of['line','rectangle','square','rounded-rectangle','heart','triangle','right-triangle','diamond','parallelogram','trapezoid','pentagon','hexagon','heptagon','octagon','star','cross','chevron','circle','ellipse','arc']){
    const size=['rectangle','ellipse'].includes(type)?{x:220,y:140}:{x:180,y:180};const shape=engine.createShape(type,{x:20,y:20},size,original);const raw=sample(shape.points);
    const detected=engine.detectShape(raw);recognition[type]=detected.type;assert.equal(detected.type,type==='diamond'?'square':type,type+' recognized');
    engine.setEnabled(true);const clean=engine.processStroke({...original,points:raw});assert(clean.isGeometric,type+' refined');assert.equal(clean.geometryType,detected.type);
}
const ellipse=engine.createShape('ellipse',{x:0,y:0},{x:250,y:120},original),angle=.47;
const rotated=ellipse.points.map(p=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)}));assert.equal(engine.detectShape(rotated).type,'ellipse','rotated ellipse');
const rotatedRectangle=engine.createShape('rectangle',{x:0,y:0},{x:240,y:100},original).points.map(p=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)}));assert.equal(engine.detectShape(sample(rotatedRectangle)).type,'rectangle','rotated rectangle');
for(const type of['circle','ellipse','triangle','rectangle','hexagon']){const shape=engine.createShape(type,{x:20,y:20},{x:220,y:180},original),rough=sample(shape.points).map((p,i)=>({x:p.x+Math.sin(i*1.73)*1.4,y:p.y+Math.cos(i*2.31)*1.4}));assert.notEqual(engine.detectShape(rough).type,'freehand',type+' tolerates hand jitter');}
const handArrow=sample([{x:0,y:0},{x:180,y:0},{x:145,y:-20},{x:180,y:0},{x:145,y:20}]);assert.equal(engine.detectShape(handArrow).type,'arrow');
engine.mode='polyline';engine.setEnabled(true);assert.equal(engine.processStroke({...original,points:handArrow}).geometryType,'polyline');engine.mode='auto';
engine.fill=true;engine.dashed=true;const filled=engine.createShape('rectangle',{x:0,y:0},{x:100,y:100},original);assert(filled.geometryFill&&filled.geometryDashed);assert.equal(engine.createShape('arrow',{x:0,y:0},{x:100,y:100},original).geometryFill,false);engine.fill=false;engine.dashed=false;
assert.equal(engine.detectShape([{x:2,y:2},{x:2,y:2}]).type,'freehand');
engine.setEnabled(false);const free={...original,points:sample(ellipse.points)};assert.equal(engine.processStroke(free),free,'disabled never transforms ink');
const arrow=engine.createShape('double-arrow',{x:0,y:0},{x:100,y:0},original);assert.equal(arrow.points.filter(p=>p.break).length,2,'arrowheads use separate paths');
const circle=engine.createShape('circle',{x:200,y:200},{x:150,y:100},original);const bounds=engine.getBounds(circle.points);assert(Math.abs(bounds.width-bounds.height)<.1,'circle proportions');
let variations=0;const failures=[];
for(const type of['line','rectangle','triangle','parallelogram','trapezoid','hexagon','star','cross','chevron','circle','ellipse','arc']){
    const shape=engine.createShape(type,{x:20,y:20},{x:type==='ellipse'||type==='rectangle'?250:180,y:180},original),raw=sample(shape.points);
    for(const scale of[.02,1,20])for(const rotation of[0,.41,1.1])for(const reverse of[false,true]){
        const rough=raw.map((p,i)=>{const x=(p.x+Math.sin(i*1.71)*1.1)*scale,y=(p.y+Math.cos(i*2.19)*1.1)*scale;return{x:x*Math.cos(rotation)-y*Math.sin(rotation)+400,y:x*Math.sin(rotation)+y*Math.cos(rotation)-200};});if(reverse)rough.reverse();
        const result=engine.detectShape(rough);if(result.type==='freehand')failures.push({type,scale,rotation,reverse});variations++;
    }
}
assert.deepEqual(failures,[],'Recognition must survive jitter, clockwise/counterclockwise, rotation and scale');
const repeatedCircle=engine.ellipsePoints(100,100,60,60,0,0,Math.PI*6);assert.equal(engine.detectShape(repeatedCircle).type,'freehand','Do not force multi-loop scribbles into one circle');
const rectangle=engine.createCleanStroke(engine.detectShape(sample(engine.createShape('rectangle',{x:0,y:0},{x:230,y:130},original).points).map((p,i)=>({x:p.x+Math.sin(i)*2,y:p.y+Math.cos(i)*2}))),original);
for(let i=0;i<4;i++){const a=rectangle.points[i],b=rectangle.points[i+1],c=rectangle.points[(i+2)%4];assert(Math.abs((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))<1e-7,'Refined rectangles must have actual right-angle corners');}
console.log(JSON.stringify({passed:true,shapeCases:shapes,recognition,variations}));
