import type {Track} from './track';
import type {VehiclePhysics} from './physics';

/** Advice only: this never changes the throttle, steering or vehicle velocity. */
export function drivingAdvice(track:Track,distance:number,car:VehiclePhysics){
  if(car.surface!=='asphalt')return {text:'先松油门，平稳回到路面',level:'caution'};
  if(car.sliding)return {text:'抓地到极限 · 松油减速，收小转向',level:'danger'};
  const speed=Math.abs(car.speed);
  let upcoming=40,criticalAhead=Infinity;
  for(let ahead=5;ahead<=75;ahead+=5){
    const a=track.sampleAt(distance+ahead).tangent,b=track.sampleAt(distance+ahead+4).tangent;
    const curvature=Math.acos(Math.min(1,Math.max(-1,a.dot(b))))/4;
    const safe=Math.min(40,Math.sqrt(10.5/Math.max(.0001,curvature)));
    const stopping=(speed*speed-safe*safe)/(2*23)+9;
    if(safe<upcoming&&ahead<Math.max(15,stopping+10)){upcoming=safe;criticalAhead=ahead;}
  }
  if(criticalAhead<Infinity&&speed>upcoming+2.5)return {text:`提前制动 · 入弯参考 ${Math.round(upcoming*6/5)*5} km/h`,level:'caution'};
  if(Math.abs(car.steering)>.16&&speed>8)return {text:'稳住路线 · 回正方向后再全油门',level:'normal'};
  return {text:'直道加速 · 留意 150 / 100 / 50 制动牌',level:'normal'};
}
