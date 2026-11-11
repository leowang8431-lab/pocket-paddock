import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics, type Controls, type PhysicsTrack, type Surface } from '../src/physics.ts';
import {KMH_PER_SPEED_UNIT,TRACK_SPEED_SCALE} from '../src/speed-scale.ts';
import {resolveRaceContact} from '../src/race-contact.ts';

const idle: Controls = { throttle: false, brake: false, left: false, right: false };
const gas: Controls = { ...idle, throttle: true };
const brake: Controls = { ...idle, brake: true };

/** A long straight isolates vehicle handling from the authored track geometry. */
function straight(surface: Surface = 'asphalt'): PhysicsTrack {
  return {
    width: 16,
    nearest(_x, z) { return { point: { x: 0, z }, tangent: { x: 0, z: 1 }, distance: z }; },
    surfaceAt() { return surface; },
  };
}

function drive(vehicle: VehiclePhysics, seconds: number, controls: Controls, track: PhysicsTrack) {
  for (let i = 0; i < Math.round(seconds * 60); i++) vehicle.update(1 / 60, controls, track);
}

test('throttle accelerates from rest in the heading direction and respects maximum speed', () => {
  const vehicle = new VehiclePhysics();
  const track = straight();
  drive(vehicle, 1, gas, track);
  assert.ok(vehicle.speed > 8 && vehicle.speed < 20);
  assert.ok(vehicle.z > 3);
  assert.ok(Math.abs(vehicle.x) < 0.001);
  drive(vehicle, 20, gas, track);
  assert.ok(vehicle.speed <= 40*TRACK_SPEED_SCALE);
  assert.ok(vehicle.speed > 35*TRACK_SPEED_SCALE);
});

test('the displayed speed maps to the faster world-space pace',()=>{
  const car=new VehiclePhysics();car.speed=car.vz=120/KMH_PER_SPEED_UNIT;
  const speed=car.speed,dt=1/120;
  car.update(dt,idle,straight());
  assert.ok(speed>20*1.07);
  assert.ok(Math.abs(car.z/dt-car.speed)<1e-9);
  assert.ok(Math.abs(car.speed*KMH_PER_SPEED_UNIT-120)<.2);
});

test('compound and tread change the car’s sustained speed, and resetting on track keeps wear',()=>{
  const road=straight(),soft=new VehiclePhysics(),hard=new VehiclePhysics();
  soft.tires.fit('soft');hard.tires.fit('hard');
  drive(soft,20,gas,road);drive(hard,20,gas,road);
  const warmSpeed=soft.speed;
  assert.ok(warmSpeed>hard.speed+1);
  drive(soft,160,gas,road);drive(hard,160,gas,road);
  assert.ok(soft.speed<warmSpeed-2);
  assert.ok(soft.tires.summary.wear>hard.tires.summary.wear);
  const wornSpeed=soft.speed,wear=soft.tires.summary.wear;
  soft.reset(0,0,0);
  assert.equal(soft.tires.summary.wear,wear);
  soft.tires.fit('soft');drive(soft,20,gas,road);
  assert.ok(soft.speed>wornSpeed+2);
});

test('exhausted tires gradually force a large loss of full-throttle speed until replaced', () => {
  const road = straight();
  const car = new VehiclePhysics();
  const step = 1 / 120;
  car.tires.fit('soft');
  drive(car, 20, gas, road);
  const freshSpeed = car.speed;
  let largestSpeedDrop = 0;

  for (let tick = 0; tick < 480 / step && car.tires.summary.remaining > 0; tick++) {
    const before = car.speed;
    car.update(step, gas, road);
    largestSpeedDrop = Math.max(largestSpeedDrop, before - car.speed);
  }

  assert.equal(car.tires.summary.remaining, 0);
  assert.ok(car.tires.summary.wheels.every((wheel) => wheel.wear === 1));
  assert.ok(largestSpeedDrop < freshSpeed * 0.01, 'wear slows the car without a one-tick speed clamp');
  const start = car.z;
  drive(car, 4, gas, road);
  assert.ok(car.speed < freshSpeed * 0.7, 'full throttle cannot sustain near-fresh speed on exhausted tires');
  assert.ok((car.z - start) / 4 < freshSpeed * 0.7, 'the car also covers less distance at full throttle');

  car.tires.fit('soft');
  assert.equal(car.tires.summary.remaining, 1);
  drive(car, 20, gas, road);
  assert.ok(car.speed > freshSpeed * 0.9, 'a new set restores near-fresh speed');
});

test('brakes shed speed much faster than simply releasing the throttle', () => {
  const braking = new VehiclePhysics();
  const coasting = new VehiclePhysics();
  braking.speed = coasting.speed = 25;
  drive(braking, 0.5, brake, straight());
  drive(coasting, 0.5, idle, straight());
  assert.ok(braking.speed > 0 && braking.speed < 12);
  assert.ok(coasting.speed > 20);
  assert.ok(braking.speed < coasting.speed - 10);
});

test('grass slows the car and gravel is more restrictive than grass', () => {
  const asphalt = new VehiclePhysics();
  const grass = new VehiclePhysics();
  const gravel = new VehiclePhysics();
  asphalt.speed = grass.speed = gravel.speed = 30;
  drive(asphalt, 1, idle, straight('asphalt'));
  drive(grass, 1, idle, straight('grass'));
  drive(gravel, 1, idle, straight('gravel'));
  assert.equal(grass.surface, 'grass');
  assert.equal(gravel.surface, 'gravel');
  assert.ok(asphalt.speed > grass.speed * 2);
  assert.ok(gravel.speed < grass.speed);
});

test('throttle cannot maintain road speed after entering grass or gravel', () => {
  const grass = new VehiclePhysics();
  const gravel = new VehiclePhysics();
  grass.speed = gravel.speed = 35;
  drive(grass, 3, gas, straight('grass'));
  drive(gravel, 3, gas, straight('gravel'));
  assert.ok(grass.speed < 20);
  assert.ok(gravel.speed < 14);
  assert.ok(gravel.speed < grass.speed);
});

test('left and right steer in opposite directions, with gradual steering input', () => {
  const left = new VehiclePhysics();
  const right = new VehiclePhysics();
  left.speed = right.speed = 10;
  left.update(1 / 60, { ...idle, left: true }, straight());
  right.update(1 / 60, { ...idle, right: true }, straight());
  assert.ok(left.steering > 0 && left.steering < 0.5);
  assert.ok(right.steering < 0 && right.steering > -0.5);
  assert.ok(left.heading > 0);
  assert.ok(right.heading < 0);
  assert.ok(Math.abs(left.heading + right.heading) < 0.00001);
});

test('off-road steering has less grip than steering on asphalt', () => {
  const road = new VehiclePhysics();
  const grass = new VehiclePhysics();
  road.speed = grass.speed = 8;
  const controls = { ...gas, left: true };
  drive(road, 0.5, controls, straight('asphalt'));
  drive(grass, 0.5, controls, straight('grass'));
  assert.ok(road.heading > grass.heading);
});

test('a barrier impact confines the car, reduces speed and produces collision feedback', () => {
  const vehicle = new VehiclePhysics();
  vehicle.x = 26;
  vehicle.speed = 20;
  vehicle.vx = 15;
  vehicle.update(1 / 60, idle, straight('grass'));
  assert.ok(vehicle.x < 24);
  assert.ok(vehicle.speed < 8);
  assert.equal(vehicle.collision, 1);
  vehicle.speed = vehicle.vx = vehicle.vz = 0;
  vehicle.update(0.1, idle, straight('grass'));
  assert.ok(vehicle.collision < 1);
  assert.ok(Number.isFinite(vehicle.x) && Number.isFinite(vehicle.z));
});

test('a solid building collides on asphalt, including the vehicle radius on every side', () => {
  const cases = [
    { x: 1.4, z: 0, heading: Math.PI/2, box: { minX: 2, maxX: 3, minZ: -10, maxZ: 10 }, axis: 'x', limit: 1.05 },
    { x: 3.6, z: 0, heading: -Math.PI/2, box: { minX: 2, maxX: 3, minZ: -10, maxZ: 10 }, axis: 'x', limit: 3.95 },
    { x: 0, z: 1.4, heading: 0, box: { minX: -10, maxX: 10, minZ: 2, maxZ: 3 }, axis: 'z', limit: 1.05 },
    { x: 0, z: 3.6, heading: Math.PI, box: { minX: -10, maxX: 10, minZ: 2, maxZ: 3 }, axis: 'z', limit: 3.95 },
  ] as const;
  for (const { x, z, heading, box, axis, limit } of cases) {
    const vehicle = new VehiclePhysics();
    vehicle.reset(x,z,heading);
    vehicle.speed = 10;
    const impact=vehicle.update(1 / 120, idle, { ...straight(), colliders: [box] });
    assert.ok(Math.abs(vehicle[axis] - limit) < 1e-10);
    assert.ok(impact>9.9);
    assert.ok(vehicle.speed< -1&&vehicle.speed> -1.3);
  }
});

test('driving beside a building does not report a false collision', () => {
  const vehicle = new VehiclePhysics();
  const track = { ...straight(), colliders: [{ minX: 2, maxX: 3, minZ: -100, maxZ: 100 }] };
  drive(vehicle, 1, gas, track);
  assert.equal(vehicle.collision, 0);
  assert.ok(vehicle.speed > 8);
  assert.equal(vehicle.x, 0);
});

test('a thin wall cannot be crossed at maximum speed with the production physics step', () => {
  const vehicle = new VehiclePhysics();
  const track = { ...straight(), colliders: [{ minX: 2, maxX: 2.2, minZ: -10, maxZ: 10 }] };
  vehicle.speed = 40;
  vehicle.vx = 40;
  vehicle.heading = Math.PI / 2;
  let maximumImpact=0;
  for (let i = 0; i < 120; i++){
    maximumImpact=Math.max(maximumImpact,vehicle.update(1 / 120, gas, track));
    assert.ok(vehicle.x <= 1.05+1e-10);
  }
  assert.ok(maximumImpact>39);
  assert.ok(Math.abs(vehicle.speed)<1);
});

test('a shallow wall strike largely keeps the velocity parallel to the wall',()=>{
  const vehicle=new VehiclePhysics();vehicle.x=1.04;vehicle.vx=2.4;vehicle.vz=26;
  vehicle.speed=Math.hypot(vehicle.vx,vehicle.vz);
  const track={...straight(),colliders:[{minX:2,maxX:3,minZ:-10,maxZ:100}]};
  const impact=vehicle.update(1/120,idle,track);
  assert.ok(impact>0&&impact<3);
  assert.ok(vehicle.vx<=0&&vehicle.vz>24.7);
  assert.equal(vehicle.speed,Math.hypot(vehicle.vx,vehicle.vz));
});

test('reset clears velocity, steering and collision while restoring the requested position', () => {
  const vehicle = new VehiclePhysics();
  Object.assign(vehicle, { speed: 20, vx: 8, vz: 15, steering: 1, collision: 1,
    gripUsage: 1.5, sliding: true, lateralSpeed: 4, yawRate: .8 });
  vehicle.reset(2, 3, Math.PI);
  assert.equal(vehicle.x, 2);
  assert.equal(vehicle.z, 3);
  assert.equal(vehicle.heading, Math.PI);
  assert.equal(vehicle.speed, 0);
  assert.equal(vehicle.vx, 0);
  assert.equal(vehicle.vz, 0);
  assert.equal(vehicle.steering, 0);
  assert.equal(vehicle.collision, 0);
  assert.equal(vehicle.gripUsage, 0);
  assert.equal(vehicle.sliding, false);
  assert.equal(vehicle.lateralSpeed, 0);
  assert.equal(vehicle.yawRate, 0);
});

test('holding the brake from rest permits bounded reversing', () => {
  const vehicle = new VehiclePhysics();
  drive(vehicle, 2, brake, straight());
  assert.ok(vehicle.speed < 0);
  assert.ok(vehicle.speed >= -7);
  assert.ok(vehicle.z < 0);
});

test('brake pressure builds progressively and releases promptly for trail braking',()=>{
  const vehicle=new VehiclePhysics();vehicle.speed=30;vehicle.vz=30;
  drive(vehicle,.05,brake,straight());const early={pressure:vehicle.brakePressure,speed:vehicle.speed};
  drive(vehicle,.05,brake,straight());const middle={pressure:vehicle.brakePressure,speed:vehicle.speed};
  drive(vehicle,.1,brake,straight());
  assert.ok(early.pressure>.15&&early.pressure<.4);assert.ok(middle.pressure>.4&&middle.pressure<.7);assert.equal(vehicle.brakePressure,1);
  assert.ok((early.speed-middle.speed)>(30-early.speed),'braking strengthens as pressure builds');
  drive(vehicle,.05,idle,straight());assert.ok(vehicle.brakePressure>0&&vehicle.brakePressure<.5);
  drive(vehicle,.05,idle,straight());assert.equal(vehicle.brakePressure,0);
});

test('brake has priority over simultaneous throttle and stopping does not kick backwards',()=>{
  const car=new VehiclePhysics();car.speed=18;car.vz=18;
  drive(car,.6,{...gas,brake:true},straight());assert.ok(car.speed<3);
  for(let i=0;i<120&&car.speed>0;i++)car.update(1/120,brake,straight());
  assert.equal(car.speed,0);
  drive(car,.1,brake,straight());assert.equal(car.speed,0,'a short full stop cannot immediately jolt into reverse');
  drive(car,.5,idle,straight());assert.equal(car.speed,0,'released residual brake pressure cannot reverse the car');
});

test('DRS reduces drag with a gradual speed gain and retains momentum on closure',()=>{
  const closed=new VehiclePhysics(),open=new VehiclePhysics();
  const cap=40*TRACK_SPEED_SCALE;
  closed.speed=open.speed=cap;closed.vz=open.vz=cap;closed.throttlePressure=open.throttlePressure=1;open.drsActive=true;
  open.update(1/120,gas,straight());assert.ok(open.speed>cap&&open.speed<cap+.05,'no velocity jump when the wing opens');
  drive(closed,10,gas,straight());drive(open,10,gas,straight());assert.ok(closed.speed<=cap);assert.ok(open.speed>43.5*TRACK_SPEED_SCALE&&open.speed<=44.5*TRACK_SPEED_SCALE);
  const before=open.speed;open.drsActive=false;open.update(1/120,gas,straight());assert.ok(open.speed>before-.05&&open.speed<=before,'closing the wing decelerates without a hard speed clamp');
  drive(open,4,gas,straight());assert.ok(open.speed<cap);
  const wet=new VehiclePhysics();wet.weather='rainy';wet.drsActive=true;drive(wet,20,gas,straight());assert.ok(wet.speed<=cap,'wet conditions never receive the DRS speed gain');
});

test('a broadside contact preserves initial momentum then scrubs speed through the tires',()=>{
  const car=new VehiclePhysics();car.vx=18;car.receiveContact(18);
  assert.equal(car.speed,18);
  car.update(1/120,idle,{...straight(),barrierOffset:100});
  assert.ok(car.x>.13&&car.x<.15);
  for(let i=0;i<119;i++)car.update(1/120,idle,{...straight(),barrierOffset:100});
  assert.ok(car.speed<8);
  assert.ok(Math.abs(car.z)<.1);
});

test('throttle pulls the car forward while the contact-induced sideways momentum decays',()=>{
  const car=new VehiclePhysics(),road=straight(),step=1/120;
  car.vx=18;car.receiveContact(18);
  for(let i=0;i<60;i++)car.update(step,gas,road);
  assert.ok(car.vx>4&&car.vx<18,'the slide dissipates progressively');
  assert.ok(car.vz>2&&car.z>.5,'the rear tires drive the car along its heading during the slide');
});

test('a centered rear impact leaves both cars rolling and carries the impulse into the next driving step',()=>{
  const player=new VehiclePhysics(),step=1/120;
  player.speed=player.vz=32;
  const leader={x:0,z:4.65,vx:0,vz:16,yawRate:0,heading:0};
  player.receiveContact(resolveRaceContact(player,leader,step));
  const transferred=player.vz;
  assert.ok(transferred>20&&transferred<25&&leader.vz>25);
  player.update(step,idle,straight());
  assert.ok(player.vz>transferred-.1&&player.z>0);
  assert.ok(Math.abs(player.vx)<1e-9&&player.yawRate===0);
});

test('the driving step carries high-speed, low-speed lateral and braking rebound impulses forward',()=>{
  const road=straight(),step=1/120;
  const fast=new VehiclePhysics();fast.vx=40;fast.vz=43;fast.receiveContact(22);
  assert.equal(fast.speed,Math.hypot(40,43));
  fast.update(step,idle,road);
  assert.ok(Math.hypot(fast.vx,fast.vz)>57);

  const slow=new VehiclePhysics();slow.vx=.3;slow.receiveContact(.3);
  slow.update(step,idle,road);
  assert.ok(slow.vx>0&&Math.abs(slow.vz)<.03);

  const braking=new VehiclePhysics();braking.speed=braking.vz=20;
  braking.update(step,brake,road);braking.vz=-12;braking.receiveContact(20);
  braking.update(step,brake,road);
  assert.ok(braking.speed< -11&&braking.vz< -11);
});

test('reset clears pedal pressure, actual wheel angle and DRS state while retaining weather',()=>{
  const car=new VehiclePhysics();car.weather='rainy';Object.assign(car,{brakePressure:.6,throttlePressure:.8,frontWheelAngle:.2,drsActive:true});
  car.reset(0,0,0);assert.equal(car.brakePressure,0);assert.equal(car.throttlePressure,0);assert.equal(car.frontWheelAngle,0);assert.equal(car.drsActive,false);assert.equal(car.weather,'rainy');
});
