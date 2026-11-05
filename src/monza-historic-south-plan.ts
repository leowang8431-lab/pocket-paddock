import * as THREE from 'three';
import type {Track} from './track';

type PlanTrack=Pick<Track,'nearest'|'sampleAt'|'widthAt'>;
export interface HistoricSouthPlan {
  curve:THREE.CubicBezierCurve3;
  length:number;splitArc:number;splitT:number;
  modernDistance:number;modernTangent:THREE.Vector3;
  sampleAtArc(arc:number):{point:THREE.Vector3;tangent:THREE.Vector3};
}
const plans=new WeakMap<object,HistoricSouthPlan>();

/** One convex sweep replaces both the former wavy control polygon and the
 * separate return hook. The split is an authoring boundary on the same curve,
 * so the old road and its connection share position, tangent and curvature. */
export function createHistoricSouthPlan(track:PlanTrack):HistoricSouthPlan {
  const cached=plans.get(track);if(cached)return cached;
  const modern=track.sampleAt(track.nearest(-85,190).distance);
  // The finite-width strip enters the GP paving; its renderer clips the
  // actual intersecting triangles against that road's edge to form a wide
  // common boundary instead of tapering the road to a needle.
  const end=modern.point.clone();
  const handle=(300-end.z)/-modern.tangent.z;
  const curve=new THREE.CubicBezierCurve3(new THREE.Vector3(185,0,140),new THREE.Vector3(185,0,300),end.clone().addScaledVector(modern.tangent,-handle),end);
  curve.arcLengthDivisions=12000;
  const lengths=curve.getLengths(curve.arcLengthDivisions),length=lengths.at(-1)!,splitT=.70,splitArc=lengths[Math.round(splitT*curve.arcLengthDivisions)];
  const plan:HistoricSouthPlan={curve,length,splitT,splitArc,modernDistance:modern.distance,modernTangent:modern.tangent.clone(),sampleAtArc(arc){
    const u=THREE.MathUtils.clamp(arc/length,0,1);
    return {point:curve.getPointAt(u),tangent:u===0?new THREE.Vector3(0,0,1):u===1?modern.tangent.clone():curve.getTangentAt(u).setY(0).normalize()};
  }};
  plans.set(track,plan);return plan;
}
