const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{dispatchEvent(){}},CustomEvent:class{}};vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/tools/GeometryEngine.js','utf8'),context);
const engine=context.window.GeometryDetector;
function curve(start,segments){const result=[start];let a=start;for(const[b,c,d]of segments){for(let i=1;i<=24;i++){const t=i/24,u=1-t;result.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});}a=d;}return result;}
const p=(x,y)=>({x,y});
// Reconstructed rough outlines from the user's screenshot, not generated
// ideal shape templates: deep heart notches, a closure tail and rounded corners.
const heart=curve(p(535,287),[
    [p(407,295),p(398,140),p(510,100)],
    [p(559,78),p(532,164),p(528,215)],
    [p(581,160),p(595,90),p(649,106)],
    [p(722,138),p(618,268),p(527,310)],
    [p(522,308),p(528,296),p(531,289)]
]);
const triangle=curve(p(309,985),[
    [p(342,913),p(397,744),p(421,737)],
    [p(447,714),p(505,933),p(491,977)],
    [p(467,995),p(367,986),p(303,984)]
]);
const polygon=[p(96,688),p(300,688),p(278,858),p(104,898),p(127,835),p(96,689)];
const arrow=[p(137,496),p(529,654),p(487,603),p(529,654),p(462,663)];
const cases={heart,triangle,polygon,arrow};const report={};
for(const[name,points]of Object.entries(cases)){const detected=engine.detectShape(points);report[name]={type:detected.type,confidence:detected.confidence};assert.equal(detected.type,name,name+' rough screenshot case');
    for(const scale of[.05,1,15])for(const reverse of[false,true]){const transformed=points.map((p,i)=>({x:p.x*scale+Math.sin(i)*.1*scale,y:p.y*scale+Math.cos(i)*.1*scale}));if(reverse)transformed.reverse();const result=engine.detectShape(transformed);assert.equal(result.type,name,name+' scales and reverses');}}
engine.setEnabled(true);const now=Date.now();const shaft=engine.createShape('line',p(0,0),p(200,0),{id:now,tool:'pen',size:2,color:'#fff'});
const rawHead={id:now+1,tool:'pen',size:2,color:'#fff',points:[p(165,-20),p(200,0),p(165,20)]};
assert.equal(engine.joinArrowGroup([shaft],rawHead)?.stroke.geometryType,'arrow','Shaft plus separate V head');
const wing=engine.createShape('line',p(165,-20),p(200,0),{id:now+2,tool:'pen',size:2,color:'#fff'});
const second={...rawHead,points:[p(200,0),p(165,20)]};const combined=engine.joinArrowGroup([shaft,wing],second);assert.equal(combined?.stroke.geometryType,'arrow','Three-stroke arrow');assert.deepEqual([...combined.remove],[0,1]);
assert.equal(engine.joinArrowGroup([{...shaft,id:now-10000}],rawHead),null,'Never merge old notebook content');
assert.equal(engine.joinArrowGroup([shaft],{...rawHead,points:[p(200,0),p(200,50),p(200,90)]}),null,'Do not merge unrelated lines');
console.log(JSON.stringify({passed:true,report,multiStrokeArrows:true}));
