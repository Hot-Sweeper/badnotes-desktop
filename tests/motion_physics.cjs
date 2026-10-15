const assert=require('node:assert/strict'),P=require('../static/js/ui/MotionPhysics.js');
for(const hz of [30,60,120,240]){
    let position=50,velocity=1600,target=null,pulled=false;
    for(let i=0;i<hz*2;i++){const s=P.step(position,velocity,1/hz,0,200,target);position=s.position;velocity=s.velocity;target=s.target;if(position>200)pulled=true;assert(Number.isFinite(position)&&Number.isFinite(velocity));}
    assert(pulled,'Momentum reaches an elastic edge');assert(Math.abs(position-200)<.05);assert(Math.abs(velocity)<1);
}
const result=hz=>{let s={position:0,velocity:1000};for(let i=0;i<hz;i++)s=P.coast(s.position,s.velocity,1/hz);return s;};
assert(Math.abs(result(60).position-result(120).position)<1e-8);
assert.equal(P.rubber(0),0);assert(P.rubber(500)>P.rubber(100));assert(P.rubber(1e8)<90);assert(P.rubber(-500)>-90);
const spring=P.spring(-80,0,0,1.5);assert(Math.abs(spring.position)<.01&&Math.abs(spring.velocity)<.1);
console.log('Motion physics: frame-independent coast, bounded pull, elastic edge arrival and spring settling passed.');
