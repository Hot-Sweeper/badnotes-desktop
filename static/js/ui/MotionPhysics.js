/* Time-based springs and coast, shared by shelf and camera limits. */
(() => {
    const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
    function spring(position,velocity,target,seconds,omega=16,damping=.86){
        const t=Math.max(0,seconds),x=position-target,decay=Math.exp(-damping*omega*t),w=omega*Math.sqrt(Math.max(0,1-damping*damping));
        if(w<1e-5){const b=velocity+omega*x;return{position:target+(x+b*t)*decay,velocity:(velocity-omega*b*t)*decay};}
        const a=(velocity+damping*omega*x)/w,c=Math.cos(w*t),s=Math.sin(w*t),next=decay*(x*c+a*s);
        return{position:target+next,velocity:decay*(-x*w*s+a*w*c)-damping*omega*next};
    }
    function coast(position,velocity,seconds,tau=.27){const decay=Math.exp(-Math.max(0,seconds)/tau);return{position:position+velocity*tau*(1-decay),velocity:velocity*decay};}
    // Exact velocity-dependent drag + surface friction. Units are seconds and
    // units/second; integration remains identical at different refresh rates.
    function drift(speed,seconds,drag=3.8,friction=350){
        if(speed<=0||seconds<=0)return{speed:Math.max(0,speed),distance:0};
        const offset=friction/drag,stop=Math.log1p(speed/offset)/drag,t=Math.min(seconds,stop),decay=Math.exp(-drag*t);
        return{speed:seconds>=stop?0:Math.max(0,(speed+offset)*decay-offset),distance:Math.max(0,(speed+offset)*-Math.expm1(-drag*t)/drag-offset*t)};
    }
    function glideSpring(position,velocity,target,seconds,springOptions){
        const rate=springOptions?.omega??16,omega=typeof rate==='function'?rate(velocity,position-target):rate;
        const state={...spring(position,velocity,target,seconds,omega,springOptions?.damping??.86),target};
        if(springOptions)state.omega=omega;
        return state;
    }
    function glide(position,velocity,seconds,min,max,target=null,drag=3.8,friction=350,springOptions=null){
        if(position<min||position>max)target=clamp(position,min,max);
        if(target!==null)return glideSpring(position,velocity,clamp(target,min,max),seconds,springOptions);
        const sign=Math.sign(velocity),next=drift(Math.abs(velocity),seconds,drag,friction),end=position+sign*next.distance;
        if(end>=min&&end<=max)return{position:end,velocity:sign*next.speed,target:null};
        // Arrive with the real remaining velocity, then integrate the spring
        // for the rest of this frame. No clamped position or zero-speed handoff.
        const edge=clamp(end,min,max),distance=Math.abs(edge-position);let low=0,high=seconds;
        for(let i=0;i<28;i++){const mid=(low+high)/2;if(drift(Math.abs(velocity),mid,drag,friction).distance<distance)low=mid;else high=mid;}
        const hit=(low+high)/2,at=drift(Math.abs(velocity),hit,drag,friction);
        return glideSpring(edge,sign*at.speed,edge,Math.max(0,seconds-hit),springOptions);
    }
    const rubber=(n,length=90)=>Math.sign(n)*length*Math.abs(n)/(length+Math.abs(n));
    const unRubber=(n,length=90)=>Math.sign(n)*length*Math.abs(n)/Math.max(.001,length-Math.min(Math.abs(n),length-.001));
    // Estimate the velocity of the visible motion, not the faster uncompressed
    // finger motion. Recent samples matter most; a pause before release removes
    // stale momentum smoothly, independent of the input/display refresh rate.
    function sampleVelocity(samples,time,limit=5500){
        if(samples.length<2)return 0;
        const last=samples.at(-1),recent=samples.filter(s=>last.time-s.time<=75);
        if(recent.length<2)return 0;
        let weight=0,t=0,x=0;
        for(const s of recent){const w=Math.exp((s.time-last.time)/35);weight+=w;t+=(s.time-last.time)*w;x+=s.position*w;}
        t/=weight;x/=weight;let variance=0,covariance=0;
        for(const s of recent){const w=Math.exp((s.time-last.time)/35),dt=s.time-last.time-t;variance+=w*dt*dt;covariance+=w*dt*(s.position-x);}
        if(variance<1)return 0;
        const age=Math.max(0,time-last.time);
        return clamp(covariance/variance*1000*Math.exp(-((age/45)**2)),-limit,limit);
    }
    function step(position,velocity,seconds,min,max,target=null){
        if(position<min||position>max)target=clamp(position,min,max);
        if(target!==null){target=clamp(target,min,max);const next=spring(position,velocity,target,seconds);if(Math.abs(next.position-target)<.3&&Math.abs(next.velocity)<8)return{position:target,velocity:0,target:null};return{...next,target};}
        const next=coast(position,velocity,seconds);
        if(next.position<min||next.position>max){const edge=clamp(next.position,min,max),distance=edge-position,travel=velocity*.27,ratio=travel?distance/travel:0,hit=ratio>=0&&ratio<1?-.27*Math.log1p(-ratio):0;
            const at=coast(position,velocity,hit);return{...spring(edge,at.velocity,edge,Math.max(0,seconds-hit)),target:edge};}
        return{...next,target:null};
    }
    const api={clamp,spring,coast,drift,glide,rubber,unRubber,sampleVelocity,step};if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.MotionPhysics=api;
})();
