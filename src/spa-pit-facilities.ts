import * as THREE from 'three';
import {teams} from './team-catalog';
import {SPA_PIT_LAYOUT} from './spa-pit-layout';

/** GP-building details only. Track owns every driven/work-apron surface.
 * Source coordinates match Spa's retained, mirrored shared paddock; no Monza
 * model or material is changed by the Spa-specific removal/repair pass. */
export function addSpaPitFacilities(localRoot:THREE.Group,worldRoot:THREE.Group){
  const materials=new Map<number,THREE.MeshStandardMaterial>();
  const material=(color:number)=>{let result=materials.get(color);if(!result){result=new THREE.MeshStandardMaterial({color,roughness:.79});materials.set(color,result);}return result;};
  const box=(parent:THREE.Object3D,name:string,x:number,y:number,z:number,w:number,h:number,d:number,color:number)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.name=name;mesh.position.set(x,y,z);mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const cylinder=(parent:THREE.Object3D,name:string,x:number,y:number,z:number,r:number,h:number,color:number,sides=10)=>{
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,sides),material(color));mesh.name=name;mesh.position.set(x,y,z);parent.add(mesh);return mesh;
  };
  const equipment=localRoot.getObjectByName('pit-service-apron-equipment');
  const equipmentRetreat=6;
  let removedLegacyPlates=0,removedLegacyPaint=0,shiftedTelemetryVertices=0;
  if(equipment){
    const obsolete:THREE.Mesh[]=[];
    equipment.traverse(object=>{
      if(!(object instanceof THREE.Mesh)||!(object.geometry instanceof THREE.BoxGeometry))return;
      const {width:w,height:h,depth:d}=object.geometry.parameters,eq=(a:number,b:number)=>Math.abs(a-b)<1e-6;
      const plate=eq(w,5.2)&&eq(h,.13)&&eq(d,10.7);
      const paint=eq(h,.025)&&(eq(w,5.5)&&eq(d,.11)||eq(w,.11)&&eq(d,10.55))||eq(w,2.9)&&eq(h,.026)&&eq(d,.15);
      if(plate||paint){obsolete.push(object);if(plate)removedLegacyPlates++;else removedLegacyPaint++;}
    });
    for(const mesh of obsolete){mesh.removeFromParent();mesh.geometry.dispose();}
    // The old stop was on the fast-lane boundary. Moving the stop into its
    // working apron must not put the parked car through the static crew.
    equipment.position.x+=equipmentRetreat;
    equipment.userData.spaSurfaceRepair={removedLegacyPlates,removedLegacyPaint,equipmentRetreat,groundOwner:'Track / SPA_PIT_LAYOUT'};
  }
  const telemetry=localRoot.getObjectByName('pit-telemetry-screen-atlas');
  if(telemetry instanceof THREE.Mesh){
    const old=telemetry.geometry,geometry=old.clone(),position=geometry.attributes.position,indices=geometry.index?.array??Array.from({length:position.count},(_,i)=>i),vertices=new Set<number>();
    // Only the apron monitor/keyboard planes were baked under the moved
    // equipment group. Garage rear displays and all strategy-room planes keep
    // their original coordinates and screen data.
    for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2],x=(position.getX(a)+position.getX(b)+position.getX(c))/3,y=(position.getY(a)+position.getY(b)+position.getY(c))/3;if(x>-50&&x< -47&&y<3.5){vertices.add(a);vertices.add(b);vertices.add(c);}}
    for(const i of vertices)position.setX(i,position.getX(i)+equipmentRetreat);
    position.needsUpdate=true;geometry.computeBoundingSphere();geometry.computeBoundingBox();telemetry.geometry=geometry;old.dispose();shiftedTelemetryVertices=vertices.size;
  }

  const garages:THREE.Group[]=[],parking:THREE.Group[]=[];
  for(const [index,team]of teams.entries()){
    const color=new THREE.Color(team.color).getHex(),garage=new THREE.Group();
    garage.name=`spa-garage-${team.id}`;garage.position.set(-40,0,-43+index*13.2);localRoot.add(garage);garages.push(garage);
    garage.userData={teamId:team.id,index,style:'open-workshop',doorFront:'local-negative-X',opening:{x:-8.84,bottom:0,top:6.5,halfWidth:5.5},wallLayout:{rearX:7.95,sideZ:[-5.95,5.95],bottom:0,top:7.1},floorData:'shared level gray service surface',worldStop:{x:SPA_PIT_LAYOUT.stopX,y:SPA_PIT_LAYOUT.serviceY,z:243-index*13.2}};
    // These walls and equipment are inside the existing 18x165 GP building,
    // rather than a thin frontage hiding the hillside beyond the old canopy.
    box(garage,'spa-garage-dark-rear-wall',7.95,3.55,0,.22,7.1,11.65,0x3d4f50);
    for(const side of [-1,1]){
      box(garage,'spa-garage-room-partition',0,3.55,side*5.95,17.65,7.1,.20,0xb3b9b1);
      box(garage,'spa-garage-front-jamb',-8.74,3.55,side*5.65,.26,7.1,.32,0xd3d8d0);
      box(garage,'spa-garage-shutter-guide',-8.92,3.4,side*5.48,.07,5.85,.075,0x738585);
      box(garage,'spa-garage-jamb-team-stripe',-8.90,1.75,side*5.67,.035,2.6,.24,color);
    }
    box(garage,'spa-garage-raised-shutter-header',-8.77,6.38,0,.25,.38,11.4,0xa6b2b0);
    for(let slat=0;slat<5;slat++)box(garage,'spa-garage-raised-shutter-slat',-8.93,5.91+slat*.09,0,.06,.045,10.75,0x8f9e9b);
    for(const x of [-6.1,-.4,5.3])box(garage,'spa-garage-workshop-light',x,6.64,0,.14,.09,9.3,0xf0efda);

    // Restore the backing/housing for the shared telemetry atlas's retained
    // rear-screen plane: the plane alone previously floated inside the shell.
    box(garage,'spa-garage-rear-monitor-housing',5.52,4.4,-1.0,.14,1.45,3.1,0x243c3d);
    box(garage,'spa-garage-rear-monitor-support',5.75,1.8375,-1.0,.26,3.675,.28,0x6d807b);
    box(garage,'spa-garage-rear-monitor-bench',5.9,1.2,-1.0,2.9,.16,4.3,0xa8b4a6);
    box(garage,'spa-garage-tool-trolley',-5.15,.80,3.65,1.2,1.25,2.3,color);
    for(let drawer=0;drawer<4;drawer++)box(garage,'spa-garage-trolley-drawer',-5.77,.42+drawer*.23,3.65,.035,.045,2.03,0xd4dbd1);
    for(const dx of [-.43,.43])for(const dz of [-.88,.88]){const wheel=cylinder(garage,'spa-garage-trolley-wheel',-5.15+dx,.16,3.65+dz,.16,.14,0x233331,8);wheel.rotation.z=Math.PI/2;}
    box(garage,'spa-garage-rear-storage-rack',6.85,1.25,3.8,1.05,2.5,2.8,0x6b7c77);
    for(let shelf=0;shelf<3;shelf++)box(garage,'spa-garage-storage-shelf',6.18,.35+shelf*.68,3.8,.08,.075,2.55,0xc2ccc0);
    for(const z of [-4.25,-3.0])for(let tyre=0;tyre<3;tyre++)cylinder(garage,'spa-garage-stacked-tyre',-3.4,.17+tyre*.37,z,.48,.34,0x283230,12);
    const hose=new THREE.Mesh(new THREE.TorusGeometry(.45,.055,6,20),material(0x2b4141));hose.name='spa-garage-coiled-air-hose';hose.position.set(-8.3,2.5,4.65);hose.rotation.y=Math.PI/2;garage.add(hose);
    cylinder(garage,'spa-garage-pressure-bottle',-7.65,.725,4.65,.21,1.45,0x65878a);box(garage,'spa-garage-bottle-valve',-7.65,1.525,4.65,.14,.15,.20,0xb6c3b7);
    box(garage,'spa-garage-cable-tray',-7.65,6.89,0,.8,.12,10.6,0x84968c);

    const frame=new THREE.Group();frame.name=`spa-parking-${team.id}`;
    frame.position.set(SPA_PIT_LAYOUT.stopX,SPA_PIT_LAYOUT.serviceY+.06,243-index*13.2);worldRoot.add(frame);parking.push(frame);
    frame.userData={teamId:team.id,index,width:3.4,length:9.5,surface:'gray-working-apron',stop:{x:SPA_PIT_LAYOUT.stopX,y:SPA_PIT_LAYOUT.serviceY,z:243-index*13.2}};
    for(const side of [-1,1]){
      box(frame,'spa-pit-parking-outline',side*1.7,0,0,.07,.02,9.5,0xdcc47b);
      box(frame,'spa-pit-parking-outline',0,0,side*4.75,3.4,.02,.07,0xdcc47b);
    }
    box(frame,'spa-pit-team-stop-mark',0,.01,0,1.5,.025,.12,color);
    box(frame,'spa-pit-longitudinal-stop-guide',0,.009,-1.65,.07,.022,1.25,0xdcc47b);
  }
  const safetyLine=new THREE.Group();safetyLine.name='spa-pit-working-safety-line';worldRoot.add(safetyLine);parking.push(safetyLine);
  const length=SPA_PIT_LAYOUT.serviceMaxZ-SPA_PIT_LAYOUT.serviceMinZ;
  box(safetyLine,'spa-pit-yellow-working-edge',SPA_PIT_LAYOUT.apronMinX+SPA_PIT_LAYOUT.dividerWidth+.23,SPA_PIT_LAYOUT.serviceY+.065,(SPA_PIT_LAYOUT.serviceMinZ+SPA_PIT_LAYOUT.serviceMaxZ)/2,.09,.018,length,0xd7bb6f);
  return{garages,parking,equipment:equipment instanceof THREE.Group?equipment:null,removedLegacyPlates,removedLegacyPaint,equipmentRetreat,shiftedTelemetryVertices,frontage:'eleven genuinely open GP workshops',groundOwner:'Track / SPA_PIT_LAYOUT'};
}
