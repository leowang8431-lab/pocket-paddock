import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {VehiclePhysics} from '../src/physics.ts';
import {PitLaneController,PIT_SPEED_LIMIT} from '../src/pit-lane-controller.ts';
import {teams} from '../src/team-catalog.ts';

const track=new Track(),dt=1/120;
test('the complete Monza entry asphalt captures across its full width, including beyond the former gate',()=>{
  const path=track.pitPath;let captures=0,farEdges=0,beyondGate=0;
  for(let i=1;i<path.length-1;i+=2){
    const p=path[i],next=path[i+1];if(p.z<122)break;
    const dx=next.x-p.x,dz=next.z-p.z,length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length;
    for(const offset of [-5.8,-4,0,4,5.8]){
      const x=p.x+tz*offset,z=p.z-tx*offset;if(!track.isPitLane(x,z))continue;
      const pit=new PitLaneController(track,()=>.5),vehicle=new VehiclePhysics();
      vehicle.reset(x-tx*.08,z-tz*.08,Math.atan2(tx,tz));vehicle.speed=10;
      assert.equal(pit.update(dt,vehicle,teams[0].id,'soft'),false,'one observation cannot certify a teleport');
      vehicle.x=x;vehicle.z=z;const before={x,z};
      assert.equal(pit.update(dt,vehicle,teams[0].id,'soft'),true,`missed entry pavement at ${x},${z}, offset ${offset}`);
      assert.deepEqual({x:vehicle.x,z:vehicle.z},before,'capture must not snap the car to the centreline');
      assert.ok(vehicle.speed<=PIT_SPEED_LIMIT);assert.equal(pit.summary.controlled,true);assert.equal(pit.summary.serviceDuration,3);
      captures++;if(Math.abs(offset)>3.3)farEdges++;if(z<150)beyondGate++;
    }
  }
  assert.ok(captures>80&&farEdges>40&&beyondGate>30,'the full area and its outer edges must be exercised');
});

test('entering from the side needs no gate crossing while GP kerbs, wrong way and teleports remain excluded',()=>{
  const pit=new PitLaneController(track),vehicle=new VehiclePhysics(),point=track.pitPath.find(p=>p.z<140&&p.z>130)!;
  const x=point.x+5.85,z=point.z;
  vehicle.reset(x+.08,z,Math.PI*1.5);vehicle.speed=10;pit.update(dt,vehicle,teams[1].id,'hard');
  vehicle.x=x;assert.equal(pit.update(dt,vehicle,teams[1].id,'hard'),true,'side-entry asphalt should receive assistance');
  pit.cancel();vehicle.reset(point.x,point.z,0);vehicle.speed=10;pit.update(dt,vehicle,teams[1].id,'soft');vehicle.z+=.08;
  assert.equal(pit.update(dt,vehicle,teams[1].id,'soft'),false,'wrong-way movement cannot start a visit');
  pit.cancel();vehicle.reset(-85,100,Math.PI);vehicle.speed=30;pit.update(dt,vehicle,teams[1].id,'soft');vehicle.x=point.x;vehicle.z=point.z;
  assert.equal(pit.update(dt,vehicle,teams[1].id,'soft'),false,'teleporting into the area cannot create a legal pit visit');
});

test('late full-width entry still parks at every selected garage without passing its stop',()=>{
  const point=track.pitPath.find(p=>p.z<126&&p.z>123)!;
  for(const team of teams){
    const pit=new PitLaneController(track,()=>.25),vehicle=new VehiclePhysics(),offset=teams.indexOf(team)%2?5.8:-5.8;
    vehicle.reset(point.x+offset,point.z+.08,Math.PI);vehicle.speed=30;pit.update(dt,vehicle,team.id,'hard');vehicle.z-=.08;
    assert.equal(pit.update(dt,vehicle,team.id,'hard'),true);
    for(let step=0;pit.summary.state==='approach'&&step<10000;step++){
      const x=vehicle.x,z=vehicle.z;pit.update(dt,vehicle,team.id,'hard');
      assert.ok(Math.hypot(vehicle.x-x,vehicle.z-z)<=PIT_SPEED_LIMIT*dt+1e-8,'approach cannot jump from a road edge to a bay');
    }
    assert.equal(pit.summary.state,'service',`${team.id} passed its garage after a late entry`);
    assert.ok(Math.hypot(vehicle.x-pit.summary.stop.x,vehicle.z-pit.summary.stop.z)<1e-7);
    assert.equal(pit.summary.serviceDuration,2.5);
  }
});
