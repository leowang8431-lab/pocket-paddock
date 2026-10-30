import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics, type Controls, type PhysicsTrack, type Surface } from '../src/physics.ts';

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
  assert.ok(vehicle.speed <= 40);
  assert.ok(vehicle.speed > 35);
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
    { x: 1.4, z: 0, box: { minX: 2, maxX: 3, minZ: -10, maxZ: 10 }, axis: 'x', limit: 1.05 },
    { x: 3.6, z: 0, box: { minX: 2, maxX: 3, minZ: -10, maxZ: 10 }, axis: 'x', limit: 3.95 },
    { x: 0, z: 1.4, box: { minX: -10, maxX: 10, minZ: 2, maxZ: 3 }, axis: 'z', limit: 1.05 },
    { x: 0, z: 3.6, box: { minX: -10, maxX: 10, minZ: 2, maxZ: 3 }, axis: 'z', limit: 3.95 },
  ] as const;
  for (const { x, z, box, axis, limit } of cases) {
    const vehicle = new VehiclePhysics();
    vehicle.x = x;
    vehicle.z = z;
    vehicle.speed = 10;
    vehicle.update(1 / 120, idle, { ...straight(), colliders: [box] });
    assert.ok(Math.abs(vehicle[axis] - limit) < 1e-10);
    assert.ok(vehicle.speed < 3.1);
    assert.equal(vehicle.collision, 1);
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
  for (let i = 0; i < 120; i++) vehicle.update(1 / 120, gas, track);
  assert.ok(vehicle.x <= 1.05);
  assert.equal(vehicle.collision, 1);
  assert.ok(vehicle.speed < 1);
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
  closed.speed=open.speed=40;closed.vz=open.vz=40;closed.throttlePressure=open.throttlePressure=1;open.drsActive=true;
  open.update(1/120,gas,straight());assert.ok(open.speed>40&&open.speed<40.05,'no velocity jump when the wing opens');
  drive(closed,10,gas,straight());drive(open,10,gas,straight());assert.ok(closed.speed<=40);assert.ok(open.speed>43.5&&open.speed<=44.5);
  const before=open.speed;open.drsActive=false;open.update(1/120,gas,straight());assert.ok(open.speed>before-.05&&open.speed<=before,'closing the wing decelerates without a hard speed clamp');
  drive(open,4,gas,straight());assert.ok(open.speed<40);
  const wet=new VehiclePhysics();wet.weather='rainy';wet.drsActive=true;drive(wet,20,gas,straight());assert.ok(wet.speed<=40,'wet conditions never receive the DRS speed gain');
});

test('reset clears pedal pressure, actual wheel angle and DRS state while retaining weather',()=>{
  const car=new VehiclePhysics();car.weather='rainy';Object.assign(car,{brakePressure:.6,throttlePressure:.8,frontWheelAngle:.2,drsActive:true});
  car.reset(0,0,0);assert.equal(car.brakePressure,0);assert.equal(car.throttlePressure,0);assert.equal(car.frontWheelAngle,0);assert.equal(car.drsActive,false);assert.equal(car.weather,'rainy');
});
