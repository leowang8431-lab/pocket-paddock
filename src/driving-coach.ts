import type {Track} from './track';
import type {VehiclePhysics} from './physics';
import {t,type Language} from './i18n';

/** Advice only: this never changes the throttle, steering or vehicle velocity. */
export function drivingAdvice(track:Track,distance:number,car:VehiclePhysics,language:Language='zh'){
  if(car.surface!=='asphalt')return {text:t(language,'advice.offroad'),level:'caution'};
  if(car.sliding)return {text:t(language,'advice.limit'),level:'danger'};
  const speed=Math.abs(car.speed);
  let upcoming=40,criticalAhead=Infinity;
  for(let ahead=5;ahead<=75;ahead+=5){
    const a=track.sampleAt(distance+ahead).tangent,b=track.sampleAt(distance+ahead+4).tangent;
    const curvature=Math.acos(Math.min(1,Math.max(-1,a.dot(b))))/4;
    const wet=car.weather==='rainy';
    const safe=Math.min(40,Math.sqrt(10.5*(wet?.68:1)/Math.max(.0001,curvature)));
    const stopping=(speed*speed-safe*safe)/(2*23*(wet?.74:1))+9;
    if(safe<upcoming&&ahead<Math.max(15,stopping+10)){upcoming=safe;criticalAhead=ahead;}
  }
  if(criticalAhead<Infinity&&speed>upcoming+2.5)return {text:t(language,'advice.brake',{speed:Math.round(upcoming*6/5)*5}),level:'caution'};
  if(Math.abs(car.steering)>.16&&speed>8)return {text:t(language,'advice.corner'),level:'normal'};
  if(car.weather==='rainy')return {text:t(language,'advice.rain'),level:'normal'};
  return {text:t(language,'advice.straight'),level:'normal'};
}
