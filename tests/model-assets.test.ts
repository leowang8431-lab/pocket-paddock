import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { teams } from '../src/team-catalog.ts';

const assetUrl = (filename: string) => new URL(`../public/models/${filename}`, import.meta.url);
const [carBytes, helmetBytes, paletteBytes, reportBytes, teamCsv, helmetCsv] = await Promise.all([
  readFile(assetUrl('car.glb')), readFile(assetUrl('helmet.glb')), readFile(assetUrl('palettes.json')),
  readFile(assetUrl('optimization.json')), readFile(assetUrl('teams_index.csv'), 'utf8'), readFile(assetUrl('helmets_index.csv'), 'utf8'),
]);
type Palette = Record<string, { color: number[]; metalness: number; roughness: number }>;
const palettes = JSON.parse(paletteBytes.toString()) as { teams: Record<string, Palette>; helmets: Record<string, Palette> };
const report = JSON.parse(reportBytes.toString());

function glbJson(bytes: Buffer) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'valid GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'glTF 2.0');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'complete GLB file');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'JSON first chunk');
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
}
function parse(bytes: Buffer) {
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
const assets = Promise.all([parse(carBytes), parse(helmetBytes)]);
function meshes(asset: GLTF): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  asset.scene.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}
function triangleCount(asset: GLTF) {
  return meshes(asset).reduce((sum, mesh) => sum + mesh.geometry.index!.count / 3, 0);
}
function bounds(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}
function materials(asset: GLTF) {
  return [...new Set(meshes(asset).flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.name)))];
}
function csv(text: string) {
  const [header, ...rows] = text.trim().split(/\r?\n/).map(row => row.split(','));
  return rows.map(row => Object.fromEntries(header.map((field, i) => [field, row[i]])));
}

test('shipped GLBs load with the standard Three loader and contain valid standalone geometry', async () => {
  for (const bytes of [carBytes, helmetBytes]) {
    const json = glbJson(bytes);
    assert.ok((json.buffers ?? []).every((buffer: { uri?: string }) => !buffer.uri), 'no external buffer fetch');
    assert.equal((json.images ?? []).length, 0, 'no missing external textures');
    assert.equal((json.extensionsRequired ?? []).length, 0, 'no additional runtime decoder');
    assert.equal(json.asset.extras.userProvided, true);
  }
  for (const asset of await assets) for (const mesh of meshes(asset)) {
    const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal'), index = mesh.geometry.index;
    assert.ok(position && normal && index, `${mesh.name}: indexed positions and normals`);
    assert.equal(position.count, normal.count, `${mesh.name}: one normal per vertex`);
    assert.equal(index.count % 3, 0, `${mesh.name}: complete triangles`);
    assert.ok(position.count > 0 && index.count > 0);
    for (let i = 0; i < position.count; i++) {
      assert.ok([position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)].every(Number.isFinite), `${mesh.name}: finite vertex data`);
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      assert.ok(length > .95 && length < 1.05, `${mesh.name}: valid authored normal`);
    }
    for (let i = 0; i < index.count; i++) assert.ok(Number.isInteger(index.getX(i)) && index.getX(i) >= 0 && index.getX(i) < position.count, `${mesh.name}: index within vertex buffer`);
  }
});

test('optimized shapes retain usable vehicle dimensions, forward direction and geometry budgets', async () => {
  const [car, helmet] = await assets, carBox = bounds(car.scene), helmetBox = bounds(helmet.scene);
  const carSize = carBox.getSize(new THREE.Vector3()), helmetSize = helmetBox.getSize(new THREE.Vector3());
  assert.ok(carSize.x > 1.60 && carSize.x < 1.75 && carSize.z > 3.30 && carSize.z < 3.45);
  assert.ok(carSize.y > .90 && carSize.y < 1.00 && Math.abs(carBox.min.y) < .01, 'car origin is on the road surface');
  assert.ok(carBox.max.z > Math.abs(carBox.min.z), 'longer nose points toward +Z');
  assert.ok([helmetSize.x, helmetSize.y, helmetSize.z].every(value => value > .38 && value < .45));
  assert.ok(helmetBox.getCenter(new THREE.Vector3()).length() < .01, 'helmet remains centered for its cockpit mount');
  assert.ok(triangleCount(car) > 1000 && triangleCount(car) < 25_000);
  assert.ok(triangleCount(helmet) > 500 && triangleCount(helmet) < 2_000);
  assert.ok(materials(car).every(name => !name.startsWith('helm_') && name !== 'visor' && name !== 'num' && name !== 'mark'), 'no embedded head, fixed driver number or obsolete team emblem');
});

test('four wheel pivots stay at their own axles with local geometry suitable for spin and steering', async () => {
  const [car] = await assets;
  const expected = [
    ['wheel-front-left', -.59, .335, .868], ['wheel-front-right', .59, .335, .868],
    ['wheel-rear-left', -.60, .36, -.868], ['wheel-rear-right', .60, .36, -.868],
  ] as const;
  for (const [name, x, y, z] of expected) {
    const wheel = car.scene.getObjectByName(name);
    assert.ok(wheel, `${name}: separate wheel group`);
    assert.equal(wheel.parent, car.scene, `${name}: axes in car space`);
    assert.ok(wheel.position.distanceTo(new THREE.Vector3(x, y, z)) < .005, `${name}: correct axle center`);
    const wheelBox = bounds(wheel), center = wheel.worldToLocal(wheelBox.getCenter(new THREE.Vector3())), size = wheelBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(center.x) < .06 && Math.abs(center.y) < .01 && Math.abs(center.z) < .01, `${name}: geometry local to pivot`);
    assert.ok(size.y > .64 && size.y < .74 && size.z > .64 && size.z < .74, `${name}: complete wheel diameter`);
    assert.ok(wheel.children.length > 0 && wheel.children.every(child => child instanceof THREE.Mesh));
  }
  const front = car.scene.getObjectByName('wheel-front-left')!, body = car.scene.getObjectByName('body-materialpaint')!;
  const before = bounds(body), wheelBefore = bounds(front);
  front.rotation.y = .3; front.rotation.x = .5;
  assert.ok(before.min.distanceTo(bounds(body).min) < 1e-8 && before.max.distanceTo(bounds(body).max) < 1e-8, 'wheel animation leaves body fixed');
  assert.ok(wheelBefore.min.distanceTo(bounds(front).min) > .01, 'pivot rotates wheel geometry');
  front.rotation.set(0, 0, 0); car.scene.updateMatrixWorld(true);
});

test('every selectable team and driver has a complete finite material palette', async () => {
  const [car, helmet] = await assets;
  const drivers = teams.flatMap(team => team.drivers);
  assert.equal(teams.length, 11); assert.equal(drivers.length, 22);
  assert.deepEqual(Object.keys(palettes.teams).sort(), teams.map(team => team.id).sort());
  assert.deepEqual(Object.keys(palettes.helmets).sort(), drivers.map(driver => driver.id).sort());
  for (const [entries, names] of [[palettes.teams, materials(car)], [palettes.helmets, materials(helmet)]] as const) for (const [id, palette] of Object.entries(entries)) {
    for (const name of names) {
      const material = palette[name];
      assert.ok(material, `${id}: palette includes ${name}`);
      assert.ok([3, 4].includes(material.color.length) && material.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${id}/${name}: linear glTF colors`);
      assert.ok([material.metalness, material.roughness].every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    }
  }
});

test('game catalog preserves every driver/team/number pairing from the supplied index CSVs', () => {
  const indexedTeams = csv(teamCsv), indexedHelmets = csv(helmetCsv), drivers = teams.flatMap(team => team.drivers);
  assert.equal(indexedTeams.length, teams.length); assert.equal(indexedHelmets.length, drivers.length);
  assert.equal(new Set(drivers.map(driver => driver.id)).size, 22);
  for (const team of teams) {
    const row = indexedTeams.find(row => row.team_key === team.id);
    assert.ok(row); assert.equal(row.team, team.name); assert.equal(team.drivers.length, 2);
    assert.ok(team.drivers.some(driver => driver.name === row.driver && driver.number === Number(row.number)), `${team.id}: original primary driver`);
    for (const driver of team.drivers) {
      const helmet = indexedHelmets.find(row => row.glb.split('/').at(-1) === `${driver.id}.glb`);
      assert.ok(helmet); assert.equal(helmet.driver, driver.name); assert.equal(helmet.team, team.name); assert.equal(Number(helmet.number), driver.number); assert.equal(driver.teamId, team.id);
    }
  }
});

test('optimization report matches the shipped byte counts, triangle counts and error budgets', async () => {
  const [car, helmet] = await assets;
  assert.equal(report.after.modelBytes, carBytes.length + helmetBytes.length);
  assert.equal(report.after.paletteBytes, paletteBytes.length);
  assert.equal(report.after.totalRuntimeBytes, carBytes.length + helmetBytes.length + paletteBytes.length);
  assert.equal(report.after.carTriangles, triangleCount(car)); assert.equal(report.after.helmetTriangles, triangleCount(helmet));
  assert.equal(report.after.carBatches, meshes(car).length); assert.equal(report.after.helmetBatches, meshes(helmet).length);
  assert.equal(report.input.length, 33);
  assert.equal(report.before.bytes, report.input.reduce((sum: number, input: { bytes: number }) => sum + input.bytes, 0));
  assert.equal(report.before.triangles, report.input.reduce((sum: number, input: { triangles: number }) => sum + input.triangles, 0));
  assert.ok(report.after.totalRuntimeBytes < report.before.bytes * .05, 'shared geometry prevents a full-fleet download');
  assert.ok(report.input.every((input: { sha256: string }) => /^[a-f0-9]{64}$/.test(input.sha256)), 'source hashes retained');
  for (const part of report.simplification.parts) {
    const limit = part.name.startsWith('helmet-') ? .006 : .003;
    assert.ok(Number.isFinite(part.relativeError) && part.relativeError >= 0 && part.relativeError <= limit + 1e-7);
    assert.ok(Number.isFinite(part.absoluteError) && part.absoluteError >= 0);
    assert.ok(part.triangles > 0 && part.triangles <= part.originalTriangles);
  }
});
