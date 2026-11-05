/** Interactive pit-stop review QA against Vite DEV diagnostics.
 * Uses real UI controls; never writes car/rig transforms or animation state.
 * PP_URL, PP_OUTPUT, CHROME_PATH and PP_VIDEO=1 can be supplied by the caller.
 */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';

// Read the shipped timing map, while keeping all geometry samples in the rig's
// existing authoring-pose coordinates. Only the real UI range is changed.
const timingBundle=await build({entryPoints:['src/pit-stop-timing.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {toPitRaceTime}=await import(`data:text/javascript;base64,${Buffer.from(timingBundle.outputFiles[0].text).toString('base64')}`);

const url=process.env.PP_URL??'http://127.0.0.1:5173/pit-stop.html';
const out=path.resolve(process.env.PP_OUTPUT??'outputs/pit-stop-preview-v5');
await fs.mkdir(out,{recursive:true});
const report={version:5,status:'running',url,createdAt:new Date().toISOString(),method:'Actual UI seeking, playback, camera, team and compound inputs; read-only GLB geometry/world-matrix observations, independent clean FleetCar control, torso-surface contact distances and fixed-signal world geometry.',limitations:['Headless Chrome on this computer; no additional physical computer or controller tested.','The 2.6-second stop uses eight authoring-pose units for visual review; it is illustrative choreography, not measured team telemetry.','Holding distances sample real attachment vertices against every actual torso triangle; they are conservative surface-distance estimates, not physical hand simulation.'],checks:[],phases:[],layouts:[],holding:[],errors:[],networkErrors:[]};
const save=()=>fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2));
const check=(name,details={})=>{report.checks.push({name,...details});console.log(JSON.stringify(report.checks.at(-1)));};
const executablePath=process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();page.setDefaultTimeout(20000);
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
page.on('requestfailed',r=>{if(!r.url().endsWith('/favicon.ico'))report.networkErrors.push({url:r.url(),error:r.failure()?.errorText});});
const snap=()=>page.evaluate(()=>window.__PIT.snapshot());
const settle=()=>page.waitForFunction(()=>window.__PIT?.snapshot().ready===true,undefined,{timeout:40000});
const pause=async()=>{if((await snap()).playing)await page.locator('#pp-play').click();await page.waitForTimeout(60);assert.equal((await snap()).playing,false);};
const seekReal=async seconds=>{await pause();await page.locator('#pp-timeline').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},seconds);await page.waitForTimeout(90);const s=await snap();assert.ok(Math.abs(s.time-seconds)<.0021,`Real timeline requested ${seconds}, actual ${s.time}`);return s;};
const seek=async poseSeconds=>{const s=await seekReal(toPitRaceTime(poseSeconds));const actualPose=s.poseTime??s.rig?.time;assert.ok(Number.isFinite(actualPose)&&Math.abs(actualPose-poseSeconds)<.021,`Authoring pose requested ${poseSeconds}, actual ${actualPose} at real time ${s.time}`);return s;};
const shot=async name=>{await page.screenshot({path:path.join(out,`${name}.png`),animations:'disabled'});return `${name}.png`;};

async function geometry(){
  return page.evaluate(()=>{
    const p=window.__PIT,{car,rig}=p;
    car.group.updateMatrixWorld(true);rig.group.updateMatrixWorld(true);
    const v=rig.group.position.clone(),round=n=>Math.round(n*1e7)/1e7,imageHashes=new Map();
    const hash=array=>{if(!array)return null;let h=2166136261;const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);for(const value of bytes)h=Math.imul(h^value,16777619);return(h>>>0).toString(16);};
    const bounds=o=>{
      const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};let count=0;
      o.traverseVisible(c=>{if(!c.isMesh||!c.geometry?.attributes?.position)return;const positions=c.geometry.attributes.position;for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i).applyMatrix4(c.matrixWorld);for(const axis of ['x','y','z']){min[axis]=Math.min(min[axis],v[axis]);max[axis]=Math.max(max[axis],v[axis]);}count++;}});
      return{min,max,size:{x:max.x-min.x,y:max.y-min.y,z:max.z-min.z},vertices:count};
    };
    const wheelFinish=o=>{
      const result=[];o.traverse(c=>{if(!c.isMesh)return;
        const attributes=Object.fromEntries(Object.entries(c.geometry.attributes).map(([name,a])=>[name,hash(a.array??a.data?.array)]));
        const materials=(Array.isArray(c.material)?c.material:[c.material]).map(m=>({name:m.name,color:m.color?.getHexString()??null,roughness:m.roughness??null,metalness:m.metalness??null}));
        result.push({name:c.name,attributes,index:hash(c.geometry.index?.array),materials});
      });return result;
    };
    const detail=c=>{
      const colors=c.geometry.attributes.color,sections=(c.userData.paletteSections??[]).map(section=>{
        const data=colors?.array.subarray(section.offset*colors.itemSize,(section.offset+section.count)*colors.itemSize);let maximumChroma=0;
        if(data)for(let i=0;i<data.length;i+=colors.itemSize)maximumChroma=Math.max(maximumChroma,Math.abs(data[i]-data[i+1]),Math.abs(data[i]-data[i+2]));
        return{...section,hash:hash(data),maximumChroma};
      });
      return{geometryUuid:c.geometry.uuid,sourceGeometryUuid:c.userData.sourceGeometryUuid??c.geometry.userData.sourceGeometryUuid,previewWheelAccent:c.userData.previewWheelAccent,neutralizedSections:c.userData.neutralizedSections,sections};
    };
    const describe=o=>{
      let triangles=0,meshes=0,visibleMeshes=0;const names=[],materials=[],shapes=[],details=[],poseParts=[];
      o.traverse(c=>{
        if(['pit-person-torso','pit-person-helmet-pose','pit-steady-support-pad'].includes(c.name)){
          c.getWorldPosition(v);poseParts.push({name:c.name,matrix:c.matrixWorld.elements.map(round),position:{x:v.x,y:v.y,z:v.z}});
        }
        if(!c.isMesh)return;meshes++;if(c.visible)visibleMeshes++;names.push(c.name);triangles+=(c.geometry.index?.count??c.geometry.attributes.position?.count??0)/3;
        if(c.name==='pit-person-torso'||c.name==='pit-person-chest-stripe')shapes.push({name:c.name,type:c.geometry.type,scale:{x:c.scale.x,y:c.scale.y,z:c.scale.z},parameters:c.geometry.parameters,shape:c.userData.shape,curved:c.userData.curved});
        if(c.name==='wheel-detail-batch')details.push(detail(c));
        for(const m of Array.isArray(c.material)?c.material:[c.material])materials.push({name:m.name,color:m.color?.getHexString()??null});});
      const body=o.getObjectByName('pit-person-torso'),shirt=o.getObjectByName('pit-person-chest-stripe');let shirtFit=null;
      if(body&&shirt){const inverse=body.matrixWorld.clone().invert(),a=shirt.geometry.attributes.position;let minimumRadius=Infinity,maximumRadius=0;for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(shirt.matrixWorld).applyMatrix4(inverse);const radius=v.length();minimumRadius=Math.min(minimumRadius,radius);maximumRadius=Math.max(maximumRadius,radius);}shirtFit={minimumRadius,maximumRadius};}
      o.getWorldPosition(v);const position={x:v.x,y:v.y,z:v.z};return{name:o.name,role:o.userData.role,wheelId:o.userData.wheelId,job:o.userData.job,side:o.userData.side,style:o.userData.style,motion:o.userData.motion,supportTarget:o.userData.supportTarget,visible:o.visible,position,matrix:o.matrixWorld.elements.map(round),triangles,meshes,visibleMeshes,names,materials,shapes,details,poseParts,shirtFit,bounds:bounds(o)};
    };
    const crew=[],oldWheels=[],newWheels=[],badges=[],rings=[],matrices=[];
    rig.group.traverse(o=>{
      if(o.userData.role==='pit-crew')crew.push(describe(o));
      if(o.userData.role==='old-wheel')oldWheels.push(describe(o));
      if(o.userData.role==='new-wheel')newWheels.push(describe(o));
      if(o.name==='pit-tyre-compound-ring')rings.push(o.name);
      if(o.name==='pit-tyre-compound-badge'){
        const material=Array.isArray(o.material)?o.material[0]:o.material,image=material.map?.image;
        if(image&&!imageHashes.has(image)){const context=image.getContext?.('2d'),pixels=context?.getImageData(0,0,image.width,image.height)?.data;imageHashes.set(image,hash(pixels));}
        badges.push({parentRole:o.parent?.userData.role,wheelId:o.parent?.userData.wheelId,compound:o.userData.compound,label:o.userData.label,type:o.geometry.type,size:bounds(o).size,width:o.geometry.parameters?.width,height:o.geometry.parameters?.height,color:material.userData.markerColor,materialLabel:material.userData.label,imageLabel:image?.dataset?.label,imageCompound:image?.dataset?.compound,texturePixelsHash:imageHashes.get(image)??null});
      }
      matrices.push([o.uuid,o.visible,o.matrixWorld.elements.map(round)]);
    });
    car.group.traverse(o=>matrices.push([o.uuid,o.visible,o.matrixWorld.elements.map(round)]));
    const sourceWheels=['front-left','front-right','rear-left','rear-right'].map(id=>{const o=car.group.getObjectByName(`wheel-${id}`);o.getWorldPosition(v);const batch=o.getObjectByName('wheel-detail-batch');return{id,position:{x:v.x,y:v.y,z:v.z},finish:wheelFinish(o),detail:detail(batch)};});
    const signal=rig.group.getObjectByName('pit-release-signal'),frontJack=rig.group.getObjectByName('pit-front-jack'),signalNodes=[],signalMeshes=[],lamps=[];
    signal?.traverse(o=>{signalNodes.push({uuid:o.uuid,name:o.name,matrix:o.matrixWorld.elements.map(round)});if(!o.isMesh)return;signalMeshes.push({name:o.name,bounds:bounds(o)});if(o.name.includes('lamp')){o.getWorldPosition(v);lamps.push({name:o.name,color:(Array.isArray(o.material)?o.material[0]:o.material).color?.getHexString(),position:{x:v.x,y:v.y,z:v.z}});}});
    return{summary:rig.summary,car:car.summary,carPosition:{x:car.group.position.x,y:car.group.position.y,z:car.group.position.z},carBounds:bounds(car.group),sourceWheels,crew,oldWheels,newWheels,badges,rings,matrices,frontJack:frontJack?describe(frontJack):null,releaseSignal:signal?{data:signal.userData,parentIsRig:signal.parent===rig.group,nodes:signalNodes,meshes:signalMeshes,lamps,bounds:bounds(signal)}:null};
  });
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const byId=(items,id)=>items.find(o=>o.wheelId===id);
const sameGeometry=(a,b)=>assert.deepEqual(b.matrices,a.matrices,'Seeking back to the same time changed the model transforms');
const lampColor=(hex,kind)=>{
  if(!/^[0-9a-f]{6}$/i.test(hex??''))return false;
  const [r,g,b]=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  if(kind==='off')return Math.max(r,g,b)<.35;
  return kind==='red'?r>.65&&r>g*1.3&&r>b*1.3:g>.65&&g>r*1.2&&g>b*1.2;
};

async function inspectGarage(){
  return page.evaluate(()=>{
    const p=window.__PIT,stage=p.scene.getObjectByName('pit-stop-review-stage');stage.updateMatrixWorld(true);p.car.group.updateMatrixWorld(true);
    const fascia=stage.getObjectByName('pit-stop-garage-door-fascia'),parking=stage.getObjectByName('pit-stop-parking-frame'),markers=stage.getObjectByName('pit-stop-front-wheel-markers');
    if(!fascia||!parking||!markers)throw new Error('Garage door, parking frame and wheel markers must retain their actual visible geometry');
    const v=p.car.group.position.clone(),normal=v.clone().set(0,0,0),normalTransform=fascia.matrixWorld.clone().invert().transpose();
    for(let i=0;i<fascia.geometry.attributes.normal.count;i++)normal.add(v.fromBufferAttribute(fascia.geometry.attributes.normal,i).transformDirection(normalTransform));normal.normalize();
    const box=o=>{const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};o.traverseVisible(c=>{if(!c.isMesh)return;const a=c.geometry.attributes.position;for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(c.matrixWorld);for(const axis of ['x','y','z']){min[axis]=Math.min(min[axis],v[axis]);max[axis]=Math.max(max[axis],v[axis]);}}});return{min,max,size:{x:max.x-min.x,y:max.y-min.y,z:max.z-min.z}};};
    const axle=(ids)=>{const result=v.clone().set(0,0,0);for(const id of ids)result.add(p.car.group.getObjectByName(`wheel-${id}`).getWorldPosition(v));return result.multiplyScalar(1/ids.length);};
    const front=axle(['front-left','front-right']),rear=axle(['rear-left','rear-right']),left=axle(['front-left','rear-left']),right=axle(['front-right','rear-right']);
    const center=front.clone().add(rear).multiplyScalar(.5),forward=front.clone().sub(rear).setY(0).normalize(),leftSide=left.clone().sub(right).setY(0).normalize();
    const faceBounds=box(fascia),faceCenter=v.clone().set((faceBounds.min.x+faceBounds.max.x)/2,(faceBounds.min.y+faceBounds.max.y)/2,(faceBounds.min.z+faceBounds.max.z)/2),towardsCar=center.clone().sub(faceCenter).setY(0).normalize(),towardsDoor=towardsCar.clone().multiplyScalar(-1);
    const sidepodNormal=leftSide.clone().multiplyScalar(leftSide.dot(towardsDoor)>=0?1:-1),parkingBounds=box(parking),markerBounds=box(markers);
    return{doorGeometryType:fascia.geometry.type,doorPlaneNormal:{...normal},doorBounds:faceBounds,carForward:{...forward},sidepodOutward:{...sidepodNormal},doorFacesCar:normal.dot(towardsCar),doorOpposesSidepod:normal.dot(sidepodNormal),carParallelToGarage:Math.abs(normal.dot(forward)),parkingBounds,markerBounds,metadata:stage.userData.pitStage};
  });
}

async function cleanGameWheelControl(){
  return page.evaluate(async()=>{
    const {FleetCar}=await import('/src/fleet-car.ts'),{getDriver}=await import('/src/team-catalog.ts'),actual=window.__PIT.car.summary;
    const control=new FleetCar();control.select(actual.team,getDriver(actual.driver));await control.load();if(control.status!=='ready')throw new Error('Clean FleetCar control did not load the provided GLB');
    const hash=array=>{if(!array)return null;let h=2166136261;for(const value of new Uint8Array(array.buffer,array.byteOffset,array.byteLength))h=Math.imul(h^value,16777619);return(h>>>0).toString(16);};
    const wheels=['front-left','front-right','rear-left','rear-right'].map(id=>{
      const result=[];control.group.getObjectByName(`wheel-${id}`).traverse(c=>{if(!c.isMesh)return;result.push({name:c.name,attributes:Object.fromEntries(Object.entries(c.geometry.attributes).map(([name,a])=>[name,hash(a.array??a.data?.array)])),index:hash(c.geometry.index?.array),materials:(Array.isArray(c.material)?c.material:[c.material]).map(m=>({name:m.name,color:m.color?.getHexString()??null,roughness:m.roughness??null,metalness:m.metalness??null}))});});return{id,finish:result};
    });
    // This control was never attached to the rendered scene. Release only its
    // own parsed geometry/materials; FleetCar caches immutable bytes, not models.
    const geometries=new Set(),materials=new Set();control.group.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();control.group.clear();
    return{team:actual.team,driver:actual.driver,wheels};
  });
}

async function inspectHolding(job){
  return page.evaluate(job=>{
    const {rig}=window.__PIT;rig.group.updateMatrixWorld(true);const vector=rig.group.position.clone();
    // Closest point on every real torso triangle (Ericson regions), rather
    // than comparing the tool with the person's group origin or an AABB.
    const triangleDistanceSquared=(p,a,b,c)=>{
      const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2],acx=c[0]-a[0],acy=c[1]-a[1],acz=c[2]-a[2],apx=p[0]-a[0],apy=p[1]-a[1],apz=p[2]-a[2];
      const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
      const distance=(x,y,z)=>(p[0]-x)**2+(p[1]-y)**2+(p[2]-z)**2;
      if(d1<=0&&d2<=0)return distance(...a);
      const bpx=p[0]-b[0],bpy=p[1]-b[1],bpz=p[2]-b[2],d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
      if(d3>=0&&d4<=d3)return distance(...b);
      const vc=d1*d4-d3*d2;
      if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return distance(a[0]+v*abx,a[1]+v*aby,a[2]+v*abz);}
      const cpx=p[0]-c[0],cpy=p[1]-c[1],cpz=p[2]-c[2],d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
      if(d6>=0&&d5<=d6)return distance(...c);
      const vb=d5*d2-d1*d6;
      if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return distance(a[0]+w*acx,a[1]+w*acy,a[2]+w*acz);}
      const va=d3*d6-d5*d4;
      if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/(d4-d3+d5-d6);return distance(b[0]+w*(c[0]-b[0]),b[1]+w*(c[1]-b[1]),b[2]+w*(c[2]-b[2]));}
      const divisor=1/(va+vb+vc),v=vb*divisor,w=vc*divisor;return distance(a[0]+abx*v+acx*w,a[1]+aby*v+acy*w,a[2]+abz*v+acz*w);
    };
    const points=(root,max=Infinity,faceCenters=false)=>{
      const unique=new Map();const add=p=>{const key=p.map(n=>Math.round(n*1e5)).join('/');if(!unique.has(key))unique.set(key,p);};
      root.traverseVisible(o=>{if(!o.isMesh||!o.geometry?.attributes?.position||o.name==='pit-tyre-compound-badge')return;const a=o.geometry.attributes.position;
        for(let i=0;i<a.count;i++){vector.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);add([vector.x,vector.y,vector.z]);}
        if(faceCenters){const ix=o.geometry.index,count=ix?.count??a.count;for(let i=0;i<count;i+=3){let x=0,y=0,z=0;for(let j=0;j<3;j++){vector.fromBufferAttribute(a,ix?ix.getX(i+j):i+j).applyMatrix4(o.matrixWorld);x+=vector.x;y+=vector.y;z+=vector.z;}add([x/3,y/3,z/3]);}}
      });
      const values=[...unique.values()];if(values.length<=max)return values;return Array.from({length:max},(_,i)=>values[Math.floor(i*(values.length-1)/(max-1))]);
    };
    const crew=[];rig.group.traverse(o=>{if(o.userData.role==='pit-crew'&&o.userData.job===job&&o.userData.wheelId)crew.push(o);});
    return crew.map(person=>{
      const wheelId=person.userData.wheelId,body=person.getObjectByName('pit-person-torso'),a=body.geometry.attributes.position,ix=body.geometry.index,vertices=[];
      for(let i=0;i<a.count;i++){vector.fromBufferAttribute(a,i).applyMatrix4(body.matrixWorld);vertices.push([vector.x,vector.y,vector.z]);}
      const triangles=[];for(let i=0;i<(ix?.count??a.count);i+=3)triangles.push([vertices[ix?ix.getX(i):i],vertices[ix?ix.getX(i+1):i+1],vertices[ix?ix.getX(i+2):i+2]]);
      const gun=rig.group.getObjectByName(`pit-wheel-gun-${wheelId}`),attachment=job==='gunner'?gun.getObjectByName('pit-gun-grip'):rig.group.getObjectByName(`pit-${job==='remove'?'old':'new'}-wheel-${wheelId}`),probes=points(attachment,192);
      const toSurface=point=>{let result=Infinity;for(const [a,b,c]of triangles)result=Math.min(result,triangleDistanceSquared(point,a,b,c));return Math.sqrt(result);};
      let minimumGap=Infinity;for(const point of probes)minimumGap=Math.min(minimumGap,toSurface(point));
      let maximumToolPenetration=0,insideSamples=0;
      if(job==='gunner'){
        const inverse=body.matrixWorld.clone().invert();for(const point of points(gun,Infinity,true)){
          vector.set(...point).applyMatrix4(inverse);if(vector.lengthSq()>=.985**2)continue;
          insideSamples++;maximumToolPenetration=Math.max(maximumToolPenetration,toSurface(point));
        }
      }
      return{wheelId,crewName:person.name,job,attachmentName:attachment.name,minimumSurfaceGap:minimumGap,maximumToolPenetration,insideSamples,probes:probes.length,torsoTriangles:triangles.length,bodyWorldMatrix:body.matrixWorld.elements.slice()};
    });
  },job);
}

async function inspectLayout(name,width,height){
  await page.setViewportSize({width,height});await page.locator('[data-pit-camera=overview]').click();await page.waitForTimeout(700);
  const layout=await page.evaluate(()=>{
    const p=window.__PIT,camera=p.camera,canvas=p.renderer.domElement,rect=canvas.getBoundingClientRect();camera.updateMatrixWorld();
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,vertices=0,behind=0;const point=p.rig.group.position.clone();
    for(const root of [p.car.group,p.rig.group])root.traverseVisible(o=>{
      if(!o.isMesh||!o.geometry?.attributes?.position)return;
      const materials=Array.isArray(o.material)?o.material:[o.material];if(materials.every(m=>m.visible===false||m.opacity===0))return;
      const positions=o.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        point.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld).project(camera);
        const x=(point.x+1)*rect.width/2,y=(1-point.y)*rect.height/2;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);vertices++;if(point.z<-1||point.z>1)behind++;
      }
    });
    return{viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},bounds:{minX,maxX,minY,maxY},vertices,behind};
  });
  assert.ok(layout.scrollWidth<=width+1,'Horizontal page overflow');assert.ok(layout.vertices>1000,'Expected loaded imported car and animated crew');assert.equal(layout.behind,0,'Animation mesh is outside overview camera depth range');
  assert.ok(layout.bounds.minX>=-8&&layout.bounds.maxX<=layout.canvas.width+8&&layout.bounds.minY>=-8&&layout.bounds.maxY<=layout.canvas.height+8,`Overview clips animation: ${JSON.stringify(layout)}`);
  for(const selector of ['#pp-play','#pp-replay','#pp-timeline','#pp-rate']){
    const control=page.locator(selector);await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=height+1,`${name} control not accessible: ${selector}`);assert.equal(await control.isEnabled(),true);
  }
  await page.evaluate(()=>scrollTo(0,0));layout.screenshot=await shot(`layout-${name}`);report.layouts.push(layout);await save();
  check(`${name}-whole-animation-and-controls-fit`,{width,height,vertices:layout.vertices});
}

try{
  await page.goto(url,{waitUntil:'networkidle'});await settle();await pause();await page.locator('#pp-loop').uncheck();
  assert.equal((await snap()).car.status,'ready');assert.equal((await snap()).car.source,'provided-glb');
  await seek(0);const start=await geometry();
  assert.equal(start.crew.length,16);assert.equal(start.oldWheels.length,4);assert.equal(start.newWheels.length,4);assert.deepEqual(start.rings,[]);
  for(const person of start.crew){
    assert.ok(person.names.includes('pit-person-torso'));assert.ok(person.names.includes('pit-person-team-helmet'));assert.ok(person.names.includes('pit-person-dark-visor'));
    assert.ok(!person.names.some(n=>/(?:^|[-_])(leg|legs|foot|feet|arm|arms|hand|hands)(?:$|[-_])/i.test(n)),`Unrequested limb mesh in ${person.name}`);
    const torso=person.shapes.find(s=>s.name==='pit-person-torso');assert.equal(torso.type,'SphereGeometry');assert.equal(torso.shape,'ellipsoid');assert.ok(torso.scale.y>torso.scale.x&&torso.scale.x>torso.scale.z,`Torso is not an ellipsoid in ${person.name}`);
    assert.ok(2*torso.parameters.radius*torso.scale.x>=.66,`${person.name} has not become wider than its V2 .58-unit body`);assert.ok(2*torso.parameters.radius*torso.scale.z>=.56,`${person.name} has not become deeper than its V2 .44-unit body`);
    const chest=person.shapes.find(s=>s.name==='pit-person-chest-stripe');assert.equal(chest.type,'SphereGeometry');assert.equal(chest.curved,true);
    assert.ok(person.shirtFit.minimumRadius>=.995&&person.shirtFit.maximumRadius<=1.03,`Curved shirt floats away from or cuts into ${person.name}'s actual ellipsoid`);
  }
  const stabilizers=start.crew.filter(p=>p.job==='stabilize');assert.equal(stabilizers.length,2);assert.deepEqual(stabilizers.map(p=>p.side).sort(),['left','right']);for(const person of stabilizers){assert.equal(person.motion,'brace-during-lift');assert.equal(person.supportTarget,'sidepod');}
  for(const wheel of [...start.oldWheels,...start.newWheels])assert.ok(wheel.triangles>=500,`Wheel ${wheel.name} lacks complete provided wheel geometry`);
  const clean=await cleanGameWheelControl();assert.deepEqual(start.sourceWheels.map(w=>({id:w.id,finish:w.finish})),clean.wheels,'The preview polluted the original FleetCar wheel geometry or materials');
  for(const wheel of [...start.oldWheels,...start.newWheels]){
    const source=start.sourceWheels.find(s=>s.id===wheel.wheelId);assert.ok(source);assert.equal(wheel.details.length,1);const detail=wheel.details[0];
    assert.notEqual(detail.geometryUuid,source.detail.geometryUuid);assert.equal(detail.sourceGeometryUuid,source.detail.geometryUuid);assert.equal(detail.previewWheelAccent,'neutral-metal');assert.deepEqual(detail.neutralizedSections,['paint2']);
    for(const section of detail.sections){const original=source.detail.sections.find(s=>s.material===section.material&&s.offset===section.offset);assert.ok(original);if(section.material==='paint2')assert.ok(section.maximumChroma<1e-6,'Preview rim accent is not neutral');else assert.equal(section.hash,original.hash,`Unrelated wheel section ${section.material} changed`);}
  }
  report.cleanGameWheelControl={team:clean.team,driver:clean.driver,originalWheelGeometryAndMaterialsUnchanged:true,onlyPreviewPaint2Neutralized:true};
  check('supplied-GLB-eight-wheels-sixteen-ellipsoid-torso-helmet-crew-and-two-stabilizers',{carTriangles:start.car.triangles,wheelTriangles:start.oldWheels.map(w=>w.triangles),crew:16});
  check('preview-neutral-rim-geometry-is-isolated-from-the-original-game-FleetCar');
  const garage=await inspectGarage();assert.equal(garage.doorGeometryType,'PlaneGeometry');assert.ok(garage.doorFacesCar>.999);assert.ok(garage.doorOpposesSidepod<-.999);assert.ok(garage.carParallelToGarage<.001);assert.ok(garage.doorBounds.size.z>garage.doorBounds.size.x*10);assert.ok(garage.parkingBounds.size.z>garage.parkingBounds.size.x*1.5);assert.ok(garage.markerBounds.min.z>.5&&garage.markerBounds.min.x<0&&garage.markerBounds.max.x>0);report.garage=garage;
  check('actual-garage-plane-faces-the-car-side-and-is-parallel-to-forward-parking-line');
  const observations=[];
  for(const t of [0,1,2.8,4.8,6,7.3,7.8,8]){
    await seek(t);const evidence=await geometry();const screenshot=await shot(`phase-${String(t).replace('.','-')}`);
    observations.push({time:t,...evidence});report.phases.push({time:t,poseTime:t,realTime:toPitRaceTime(t),screenshot,summary:evidence.summary,carPosition:evidence.carPosition,oldWheels:evidence.oldWheels,newWheels:evidence.newWheels,stabilizers:evidence.crew.filter(p=>p.job==='stabilize'),releaseSignal:evidence.releaseSignal,frontJack:evidence.frontJack});await save();
    for(const person of evidence.crew)assert.ok(person.shirtFit.minimumRadius>=.995&&person.shirtFit.maximumRadius<=1.03,`Curved shirt loses contact at ${t}s on ${person.name}`);
  }
  assert.ok(observations[1].carPosition.y>start.carPosition.y+.08,'The car did not lift on its actual model root');
  for(const wheel of observations[2].oldWheels)assert.ok(distance(wheel.position,byId(start.oldWheels,wheel.wheelId).position)>.35,`${wheel.name} was not physically removed`);
  for(const wheel of observations[4].newWheels)assert.ok(distance(wheel.position,byId(start.oldWheels,wheel.wheelId).position)<.4,`${wheel.name} did not reach the original hub`);
  const lowered=observations.at(-1);assert.ok(Math.abs(lowered.carPosition.y-start.carPosition.y)<.015,'The car did not lower to the original floor');
  assert.equal(start.releaseSignal.parentIsRig,true,'The fixed release signal is still attached to a moving jack');
  assert.ok(start.releaseSignal.bounds.min.z>start.carBounds.max.z+.3,'The fixed light does not stand in front of the nose');
  for(const proof of observations){assert.deepEqual(proof.releaseSignal.nodes,start.releaseSignal.nodes,'Release gantry or lamp world transforms move during the animation');for(const lamp of proof.releaseSignal.lamps)assert.ok(lamp.position.y>=2.2,'Fixed lamps are too low above the car path');}
  for(const person of stabilizers){
    const bracing=observations[1].crew.find(p=>p.name===person.name),finished=lowered.crew.find(p=>p.name===person.name);
    for(const name of ['pit-person-torso','pit-person-helmet-pose','pit-steady-support-pad']){
      const initialPart=person.poseParts.find(p=>p.name===name),bracedPart=bracing.poseParts.find(p=>p.name===name),finishedPart=finished.poseParts.find(p=>p.name===name);
      assert.ok(initialPart&&bracedPart&&finishedPart,`Missing actual stabilizer geometry: ${person.name}/${name}`);
      assert.notDeepEqual(bracedPart.matrix,initialPart.matrix,`${person.name}/${name} does not move into bracing position`);
      assert.notDeepEqual(finishedPart.matrix,bracedPart.matrix,`${person.name}/${name} did not release after lowering`);
    }
    const initialPad=person.poseParts.find(p=>p.name==='pit-steady-support-pad'),liftedPad=bracing.poseParts.find(p=>p.name==='pit-steady-support-pad');
    assert.ok(liftedPad.position.y>initialPad.position.y+.08,'Actual sidepod support pad did not follow the lifted car');
  }
  const red=observations.find(p=>p.time===7.3),green=lowered;assert.equal(red.releaseSignal.data.ready,false);assert.equal(green.releaseSignal.data.ready,true);
  assert.equal(red.releaseSignal.lamps.filter(l=>l.name==='pit-release-red-lamp'&&lampColor(l.color,'red')).length,2);assert.equal(red.releaseSignal.lamps.filter(l=>l.name==='pit-release-green-lamp'&&lampColor(l.color,'off')).length,2);
  assert.equal(green.releaseSignal.lamps.filter(l=>l.name==='pit-release-green-lamp'&&lampColor(l.color,'green')).length,2);assert.equal(green.releaseSignal.lamps.filter(l=>l.name==='pit-release-red-lamp'&&lampColor(l.color,'off')).length,2);
  const corridorHalf=Math.max(1.2,green.car.dimensions.width/2+.04),nose=green.carBounds.max.z;
  for(const obstacle of [green.frontJack,...green.crew]){const b=obstacle.bounds;if(b.max.z<=nose+.05||b.min.z>=nose+4)continue;assert.ok(b.max.x<-corridorHalf||b.min.x>corridorHalf,`Release lane is obstructed by ${obstacle.name}`);}
  const post=green.releaseSignal.meshes.find(m=>m.name==='pit-release-sidepost');assert.ok(post);assert.ok(post.bounds.min.x>corridorHalf||post.bounds.max.x<-corridorHalf,'The fixed sidepost occupies the release lane');
  for(const mesh of green.releaseSignal.meshes){const b=mesh.bounds;if(b.min.y>=2||b.max.z<=nose+.05||b.min.z>=nose+8)continue;assert.ok(b.max.x<-corridorHalf||b.min.x>corridorHalf,`A low fixed-signal part blocks the road: ${mesh.name}`);}
  check('actual-lift-old-wheel-removal-new-wheel-installation-and-lowering');
  check('two-stabilizers-brace-and-release-red-green-signal-waits-for-a-clear-forward-lane');
  check('fixed-high-front-release-light-and-sidepost-remain-stationary-and-clear-the-road-at-every-phase');
  for(const [window,job,times]of [
    ['unlock','gunner',[1.4,1.6,1.8]],['remove','remove',[2.4,2.8,3.3]],['fit','fit',[3.6,4.15,4.85]],['tighten','gunner',[5.75,5.95,6.2]],
  ])for(const t of times){
    await seek(t);const proof=await inspectHolding(job);report.holding.push({window,time:t,poseTime:t,realTime:toPitRaceTime(t),contacts:proof});await save();assert.equal(proof.length,4);
    for(const contact of proof){assert.ok(contact.probes>=20&&contact.torsoTriangles>300,'Holding proof lacks actual surface geometry');assert.ok(contact.minimumSurfaceGap<=.20,`${window} ${contact.crewName} floats ${contact.minimumSurfaceGap.toFixed(3)} away from ${contact.attachmentName}`);assert.ok(contact.maximumToolPenetration<=.025,`${window} tool cuts ${contact.maximumToolPenetration.toFixed(3)} into ${contact.crewName}'s actual body`);}
  }
  check('actual-grips-and-carried-tyres-stay-near-their-crew-body-surfaces-without-tools-cutting-the-chest',{
    sampleTimes:report.holding.length,contacts:report.holding.reduce((n,p)=>n+p.contacts.length,0),maximumSurfaceGap:Math.max(...report.holding.flatMap(p=>p.contacts.map(c=>c.minimumSurfaceGap))),maximumToolPenetration:Math.max(...report.holding.flatMap(p=>p.contacts.map(c=>c.maximumToolPenetration))),
  });
  await seek(1.5);await page.locator('[data-pit-camera=wheel]').click();await page.waitForTimeout(550);report.holdingCloseups=[await shot('tool-grip-closeup')];
  await seek(4.7);await page.waitForTimeout(200);report.holdingCloseups.push(await shot('tyre-carry-closeup'));await page.locator('[data-pit-camera=overview]').click();await page.waitForTimeout(500);
  for(const t of [2.8,0,6,0,7.8,0]){await seek(t);if(t===0)sameGeometry(start,await geometry());}
  check('backwards-and-repeated-seeking-has-no-accumulated-transform-drift');
  await seek(0);await page.locator('#pp-rate').selectOption('1');await page.locator('#pp-play').click();await page.waitForTimeout(420);const running=await snap();assert.equal(running.playing,true);assert.ok(running.time>.1&&running.time<1.5);
  await pause();const stopped=await snap(),stoppedGeometry=await geometry();await page.waitForTimeout(350);assert.equal((await snap()).time,stopped.time);sameGeometry(stoppedGeometry,await geometry());
  await page.locator('#pp-replay').click();await page.waitForTimeout(80);const replay=await snap();assert.equal(replay.playing,true);assert.ok(replay.time<.4);await pause();
  await seek(0);await page.locator('#pp-rate').selectOption('0.25');await page.locator('#pp-play').click();await page.waitForTimeout(650);await pause();const slow=await snap();assert.equal(slow.rate,.25);assert.ok(slow.time>.04&&slow.time<.4,`Quarter-speed is inconsistent: ${slow.time}`);
  await page.locator('#pp-rate').selectOption('1');await seekReal((await snap()).duration-.08);await page.locator('#pp-play').click();await page.waitForFunction(()=>!window.__PIT.snapshot().playing);assert.ok(Math.abs((await snap()).time-(await snap()).duration)<.025);
  await page.locator('#pp-loop').check();await seekReal((await snap()).duration-.08);await page.locator('#pp-play').click();await page.waitForTimeout(350);const looped=await snap();assert.equal(looped.playing,true);assert.ok(looped.time<1);await pause();await page.locator('#pp-loop').uncheck();
  check('real-play-pause-replay-quarter-speed-end-and-loop-controls');
  await seek(2.8);const compounds=[],oldCompound=(await geometry()).summary.oldCompound;
  for(const compound of ['soft','medium','hard','wet']){
    await page.locator('#pp-compound').selectOption(compound);await page.waitForTimeout(90);const g=await geometry();assert.deepEqual(g.rings,[]);assert.deepEqual(g.badges,[]);
    assert.equal(g.summary.compound,compound);assert.equal(g.summary.oldCompound,oldCompound);assert.equal(g.summary.compoundMarker,'none');compounds.push(compound);
  }
  assert.equal(new Set(compounds).size,4,'Compound selector did not retain every compound choice');
  await page.locator('#pp-compound').selectOption('medium');
  await page.locator('#pp-team').selectOption('ferrari');await page.waitForTimeout(100);const ferrari=await geometry();
  await page.locator('#pp-team').selectOption('mclaren');await page.waitForTimeout(100);const mclaren=await geometry();assert.equal(mclaren.car.team,'mclaren');assert.notDeepEqual(mclaren.car.bodyColors,ferrari.car.bodyColors);assert.notDeepEqual(mclaren.crew[0].materials,ferrari.crew[0].materials);
  assert.equal((await geometry()).summary.oldCompound,oldCompound,'Changing the new compound changed the fitted old tyres');
  await page.locator('#pp-team').selectOption('ferrari');await seek(4.8);check('all-compounds-retain-selection-without-visible-sidewall-badges-and-team-materials-change-through-UI',{compounds});
  for(const view of ['overview','front','side','wheel','top']){
    await page.locator(`[data-pit-camera=${view}]`).click();await page.waitForTimeout(650);assert.equal((await snap()).view,view);await shot(`camera-${view}`);
  }
  for(const [name,width,height]of [['desktop',1440,900],['portrait',391,844],['landscape',740,391]])await inspectLayout(name,width,height);
  await page.setViewportSize({width:1440,height:900});await page.locator('[data-pit-camera=overview]').click();await page.waitForTimeout(500);await seek(0);await shot('preview-ready');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkErrors,[]);report.status='passed';await save();
  if(process.env.PP_VIDEO==='1'){
    const videoContext=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:path.join(out,'recording'),size:{width:1440,height:900}}});
    const videoPage=await videoContext.newPage();await videoPage.goto(url,{waitUntil:'networkidle'});await videoPage.waitForFunction(()=>window.__PIT?.snapshot().ready,undefined,{timeout:40000});
    if((await videoPage.evaluate(()=>window.__PIT.snapshot())).playing)await videoPage.locator('#pp-play').click();
    await videoPage.locator('#pp-loop').uncheck();await videoPage.locator('#pp-rate').selectOption('0.5');await videoPage.locator('#pp-replay').click();
    await videoPage.waitForFunction(()=>!window.__PIT.snapshot().playing,undefined,{timeout:25000});await videoPage.waitForTimeout(500);const video=videoPage.video();await videoContext.close();const videoPath=path.join(out,'pit-stop-demo.webm');await video.saveAs(videoPath);report.video=path.basename(videoPath);await save();
  }
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,phaseScreenshots:report.phases.length,layouts:report.layouts.length,errors:report.errors,video:report.video??null}));
}catch(error){report.status='failed';report.failure=String(error);report.lastSnapshot=await snap().catch(()=>null);console.error(error);process.exitCode=1;await shot('failure').catch(()=>{});await save();}finally{await browser.close();}
