/** Presentation of a grounded car on the shared track elevation model. */
export interface ElevationTrack {
  id?:string;
  heightAt(x:number,z:number):number;
  gradeAt(distance:number):number;
  gradeAlongHeadingAt?(x:number,z:number,heading:number):number;
  nearest(x:number,z:number):{distance:number;tangent:{x:number;z:number}};
}
export function roadPose(track:ElevationTrack|undefined,x:number,z:number,heading:number){
  if(!track||track.id==='monza')return{height:.11,pitch:0};
  const near=track.nearest(x,z),alignment=Math.sin(heading)*near.tangent.x+Math.cos(heading)*near.tangent.z;
  const grade=track.gradeAlongHeadingAt?.(x,z,heading)??track.gradeAt(near.distance)*alignment;
  return{height:track.heightAt(x,z)+.11,pitch:-Math.atan(grade)};
}
