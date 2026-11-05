/** Browser QA helper: emit actual keyboard input after service. The production
 * controller must not steer, move or accelerate the released car itself. */
export async function driveManualPitExit(page,timeout=120000){
 await page.evaluate(timeout=>{
  const game=window.__PP,nodes=game.track.pitPath,held=new Set(),start=performance.now();
  const result=window.__pitManualExitDrive={done:false,reason:null,trace:[],started:game.snapshot()};let last=0;
  const key=(code,pressed)=>{if(pressed&&!held.has(code)){dispatchEvent(new KeyboardEvent('keydown',{code}));held.add(code);}else if(!pressed&&held.has(code)){dispatchEvent(new KeyboardEvent('keyup',{code}));held.delete(code);}};
  const stop=(reason,s)=>{for(const code of held)dispatchEvent(new KeyboardEvent('keyup',{code}));result.done=true;result.reason=reason;result.final=s;};
  const tick=()=>{
   const s=game.snapshot(),now=performance.now();
   if(!s.pit.active){stop('manual-exit-reached',s);return;}
   if(s.pit.controlled||s.pit.state!=='exit'||s.state!=='racing'){stop('unexpected-control-state',s);return;}
   if(now-start>timeout){stop('timeout',s);return;}
   let best=Infinity,chosen=1,fraction=0;
   for(let i=1;i<nodes.length;i++){const a=nodes[i-1],b=nodes[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((s.x-a.x)*dx+(s.z-a.z)*dz)/(dx*dx+dz*dz))),gap=(s.x-a.x-dx*t)**2+(s.z-a.z-dz*t)**2;if(gap<best){best=gap;chosen=i;fraction=t;}}
   const spa=game.track.id==='spa',lookahead=spa?4+Math.abs(s.speed)*.32:8+Math.abs(s.speed)*.8;let ahead=lookahead,x=nodes[chosen-1].x+(nodes[chosen].x-nodes[chosen-1].x)*fraction,z=nodes[chosen-1].z+(nodes[chosen].z-nodes[chosen-1].z)*fraction;
   for(let i=chosen;i<nodes.length;i++){const p=nodes[i],length=Math.hypot(p.x-x,p.z-z);if(length>=ahead){x+=(p.x-x)*ahead/Math.max(length,1e-9);z+=(p.z-z)*ahead/Math.max(length,1e-9);ahead=0;break;}ahead-=length;x=p.x;z=p.z;}
   if(ahead>0){const a=nodes.at(-2),b=nodes.at(-1),length=Math.hypot(b.x-a.x,b.z-a.z);x+=(b.x-a.x)/length*ahead;z+=(b.z-a.z)/length*ahead;}
   const desired=Math.atan2(x-s.x,z-s.z),error=Math.atan2(Math.sin(desired-s.heading),Math.cos(desired-s.heading)),chord=Math.max(.5,Math.hypot(x-s.x,z-s.z)),curvature=2*Math.sin(error)/chord,targetSpeed=spa&&Math.abs(curvature)>.055?1.5:Math.abs(error)>.7?5:9;
   const steering=spa?(Math.abs(s.speed)*curvature)/Math.max(.01,game.steerYaw(Math.abs(s.speed))):(2*Math.abs(s.speed)*Math.sin(error)/lookahead)/Math.max(.01,game.steerYaw(Math.abs(s.speed)));
   key('KeyW',s.speed<targetSpeed);key('KeyS',s.speed>targetSpeed+.5);key('KeyA',steering>s.steering+.025);key('KeyD',steering<s.steering-.025);
   if(now-last>500){result.trace.push({seconds:(now-start)/1000,x:s.x,z:s.z,speed:s.speed,controlled:s.pit.controlled,limited:s.pit.limited,raceDistance:s.pit.raceDistance,steering:s.steering});last=now;}
   requestAnimationFrame(tick);
  };tick();
 },timeout);
 await page.waitForFunction(()=>window.__pitManualExitDrive?.done,undefined,{timeout:timeout+10000});
 const result=await page.evaluate(()=>window.__pitManualExitDrive);
 if(result.reason!=='manual-exit-reached')throw new Error(`Manual pit-exit driver failed: ${result.reason}`);
 return result;
}
