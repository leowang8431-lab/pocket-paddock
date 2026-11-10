import * as THREE from 'three';
import {RACE_CAR_HALF_LENGTH,RACE_CAR_HALF_WIDTH} from './race-contact';

export interface RaceGridSlot {distance:number;lateral:number;}
const firstRow=-5,rowSpacing=7;
export const PLAYER_GRID_LATERAL=-2.5;
export const PLAYER_GRID_DISTANCE=firstRow-rowSpacing;

export function startGridSlot(index:number):RaceGridSlot {
  return {distance:firstRow-Math.floor(index/2)*rowSpacing,lateral:index%2?-PLAYER_GRID_LATERAL:PLAYER_GRID_LATERAL};
}

interface GridSurface {
  sampleAt(distance:number):{point:THREE.Vector3;tangent:THREE.Vector3;right:THREE.Vector3};
  heightAt(x:number,z:number):number;
}

/** Paint the same slots used by the race in the circuit's model units. */
export function addStartGridPaint(root:THREE.Group,track:GridSurface,name:string,roadLift:number,gameScale=1):void {
  const material=new THREE.MeshBasicMaterial({color:0xe5e6d6});
  material.name='start-grid-paint';
  const halfWidth=(RACE_CAR_HALF_WIDTH+.32)/gameScale;
  const halfLength=(RACE_CAR_HALF_LENGTH+.36)/gameScale;
  const halfStroke=.065/gameScale,paintLift=roadLift+.035/gameScale;
  for(let i=0;i<10;i++){
    const slot=startGridSlot(i),sample=track.sampleAt(slot.distance/gameScale),marker=new THREE.Group();
    marker.name=name;
    marker.position.copy(sample.point).addScaledVector(sample.right,slot.lateral/gameScale);
    marker.rotation.y=Math.atan2(sample.tangent.x,sample.tangent.z);
    const fx=Math.sin(marker.rotation.y),fz=Math.cos(marker.rotation.y);
    const positions:number[]=[],indices:number[]=[];
    const stripe=(x0:number,x1:number,z0:number,z1:number,segments:number)=>{
      const first=positions.length/3;
      for(let j=0;j<=segments;j++){
        const z=THREE.MathUtils.lerp(z0,z1,j/segments);
        for(const x of [x0,x1]){
          const worldX=marker.position.x+fz*x+fx*z,worldZ=marker.position.z-fx*x+fz*z;
          positions.push(x,track.heightAt(worldX,worldZ)-marker.position.y+paintLift,z);
        }
        if(j<segments){const k=first+j*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
      }
    };
    // The stop line is in front of the car, with an open approach behind it.
    for(const side of [-1,1])stripe(side*halfWidth-halfStroke,side*halfWidth+halfStroke,-halfLength,halfLength-halfStroke,6);
    stripe(-halfWidth-halfStroke,halfWidth+halfStroke,halfLength-halfStroke,halfLength+halfStroke,1);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    marker.add(new THREE.Mesh(geometry,material));
    root.add(marker);
  }
}
