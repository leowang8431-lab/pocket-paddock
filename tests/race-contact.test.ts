import test from 'node:test';
import assert from 'node:assert/strict';
import {RACE_CAR_HALF_LENGTH, RACE_CAR_HALF_WIDTH, resolveRaceContact, resolveWallImpulse, type RaceContactBody} from '../src/race-contact.ts';

const step = 1 / 120;
const car = (pose: Partial<RaceContactBody> = {}) => ({
  x: 0, z: 0, heading: 0, vx: 0, vz: 0, yawRate: 0, ...pose,
});
const yawInertia = (RACE_CAR_HALF_LENGTH ** 2 + RACE_CAR_HALF_WIDTH ** 2) / 3;
const kineticEnergy = (body: RaceContactBody) => .5 * (body.vx ** 2 + body.vz ** 2 + yawInertia * (body.yawRate ?? 0) ** 2);
const angularMomentum = (body: RaceContactBody) => body.z * body.vx - body.x * body.vz + yawInertia * (body.yawRate ?? 0);
const contactVelocityZ = (body: RaceContactBody, x: number) => body.vz - (body.yawRate ?? 0) * (x - body.x);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);

function assertPassiveExchange(a: RaceContactBody, b: RaceContactBody, beforeA: RaceContactBody, beforeB: RaceContactBody) {
  near(a.vx + b.vx, beforeA.vx + beforeB.vx);
  near(a.vz + b.vz, beforeA.vz + beforeB.vz);
  near(a.x + b.x, beforeA.x + beforeB.x);
  near(a.z + b.z, beforeA.z + beforeB.z);
  // The positional overlap correction runs first without changing velocity.
  // Compare angular momentum at those fixed centres during the impulse.
  near(angularMomentum(a) + angularMomentum(b),
    angularMomentum({...beforeA, x: a.x, z: a.z}) + angularMomentum({...beforeB, x: b.x, z: b.z}));
  assert.ok(kineticEnergy(a) + kineticEnergy(b) < kineticEnergy(beforeA) + kineticEnergy(beforeB));
}

test('a rear-end impact transfers momentum to the leading car', () => {
  const trailing = car({vz: 24});
  const leading = car({z: 4.65, vz: 14});
  assert.equal(resolveRaceContact(trailing, leading, step), 10);
  assert.ok(trailing.vz < 24);
  assert.ok(leading.vz > 14);
  assert.ok(Math.abs(trailing.vz + leading.vz - 38) < 1e-9);
  assert.ok(leading.z - trailing.z > 4.65);
  assert.equal(trailing.yawRate, 0);
});

test('a shallow sideswipe preserves most forward speed and moves both cars sideways', () => {
  const inside = car({vx: .8, vz: 20});
  const outside = car({x: 2.36, z: .2, vz: 18});
  const impact = resolveRaceContact(inside, outside, step);
  assert.ok(impact > 0 && impact < 1);
  assert.ok(inside.vz > 19.75 && outside.vz < 18.25);
  assert.ok(inside.vx < .8 && outside.vx > 0);
  assert.ok(outside.x - inside.x > 2.36);
});

test('a head-on impact loses forward momentum while an offset impact adds yaw', () => {
  const first = car({vz: 20});
  const opposing = car({z: 4.7, heading: Math.PI, vz: -20});
  assert.ok(resolveRaceContact(first, opposing, step) > 39);
  assert.ok(first.vz <= 0 && opposing.vz >= 0);
  assert.ok(Math.abs(first.vz) < 5 && Math.abs(opposing.vz) < 5);

  const trailing = car({vz: 24});
  const offset = car({x: .85, z: 4.65, vz: 14});
  assert.ok(resolveRaceContact(trailing, offset, step) > 0);
  assert.ok(Math.abs(trailing.yawRate) > .2);
  assert.ok(Math.abs(offset.yawRate) > .2);
});

test('overlapping cars already separating do not receive another speed penalty', () => {
  const first = car({vx: -1, vz: 20});
  const second = car({x: 2.35, vx: 1, vz: 16});
  assert.equal(resolveRaceContact(first, second, step), 0);
  assert.ok(second.x - first.x > 2.35);
  assert.deepEqual([first.vx, first.vz, first.yawRate], [-1, 20, 0]);
  assert.deepEqual([second.vx, second.vz, second.yawRate], [1, 16, 0]);
});

test('the rectangular footprint follows each car heading', () => {
  const first = car({vx: 1});
  const second = car({x: 3.2, vx: -1});
  assert.equal(resolveRaceContact(first, second, step), 0);
  assert.equal(first.x, 0);
  second.heading = Math.PI / 2;
  assert.ok(resolveRaceContact(first, second, step) > 0);
  assert.ok(second.x - first.x > 3.2);
});

test('an off-centre crash conserves linear and angular momentum with an uncapped yaw impulse', () => {
  const a = car({vx: 30, vz: 41});
  const b = car({x: .95, z: 2 * RACE_CAR_HALF_LENGTH - .004, vx: -30, vz: -41});
  const beforeA = {...a}, beforeB = {...b};
  const impact = resolveRaceContact(a, b, step);
  near(impact, 82);
  assert.ok(Math.abs(a.yawRate) > 2.6 && Math.abs(b.yawRate) > 2.6);
  assertPassiveExchange(a, b, beforeA, beforeB);
  near(angularMomentum(a) + angularMomentum(b), angularMomentum(beforeA) + angularMomentum(beforeB));
  const contactX = .475;
  near(contactVelocityZ(b, contactX) - contactVelocityZ(a, contactX), .16 * impact);
  assert.ok(Math.abs(b.vx - beforeB.vx) <= .32 * (b.vz - beforeB.vz) + 1e-9);
});

test('a tilted glancing crash resolves at the clipped incident edge and preserves restitution with friction', () => {
  const angle = .3, sin = Math.sin(angle), cos = Math.cos(angle);
  const a = car({vx: 9, vz: 41, yawRate: .7});
  const b = car({x: .1, z: RACE_CAR_HALF_LENGTH * (1 + cos) + RACE_CAR_HALF_WIDTH * sin - .035,
    heading: angle, vx: -4, vz: 10, yawRate: -.4});
  const beforeA = {...a}, beforeB = {...b};
  const incidentMidX = b.x - RACE_CAR_HALF_LENGTH * sin;
  // Only the outer .035/sin of the angled rear edge reaches the leading face.
  const contactX = incidentMidX + cos * (RACE_CAR_HALF_WIDTH - .035 / (2 * sin));
  const impact = resolveRaceContact(a, b, step);
  assert.ok(impact > 20);
  assert.ok(b.z > beforeB.z);
  near(impact, contactVelocityZ({...beforeA, x: a.x}, contactX) - contactVelocityZ({...beforeB, x: b.x}, contactX));
  near(contactVelocityZ(b, contactX) - contactVelocityZ(a, contactX), .16 * impact);
  assertPassiveExchange(a, b, beforeA, beforeB);
});

test('a fixed wall supplies a passive impulse with bounded friction and exact normal restitution', () => {
  const body = car({x: .7, z: 2.2, vx: 12, vz: -20, yawRate: .3});
  const before = {...body}, contactX = 1.2;
  const impact = resolveWallImpulse(body, 0, 1, contactX, 0);
  near(impact, -contactVelocityZ(before, contactX));
  near(contactVelocityZ(body, contactX), .12 * impact);
  assert.ok(kineticEnergy(body) < kineticEnergy(before));
  assert.ok(Math.abs(body.vx - before.vx) <= .42 * (body.vz - before.vz) + 1e-9);
  const rebound = {...body};
  assert.equal(resolveWallImpulse(body, 0, 1, contactX, 0), 0);
  assert.deepEqual(body, rebound);
});
