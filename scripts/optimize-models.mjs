/** Offline conversion of the user-supplied procedural GLBs. Runtime needs no
 * decoder: output is plain glTF 2.0 with welded, simplified indexed geometry.
 * Usage: node scripts/optimize-models.mjs [folder containing models + CSVs]
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';

const source = resolve(process.argv[2] ?? 'work/model-source');
const output = resolve('public/models');
const CAR_MATERIALS = ['paint', 'paint2', 'white', 'carbon', 'tire', 'rim', 'chrome', 'dark', 'red'];
const HELMET_MATERIALS = ['visor', 'helm_shell', 'helm_ring', 'helm_cap'];
const q = value => Math.round(value * 1e6);
const hash = value => createHash('sha256').update(value).digest('hex');
const csv = text => {
  const [header, ...rows] = text.trim().split(/\r?\n/).map(line => line.split(','));
  return rows.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
};
const teamIndex = await readFile(join(source, 'teams_index.csv'), 'utf8');
const helmetIndex = await readFile(join(source, 'helmets_index.csv'), 'utf8');
const teams = csv(teamIndex);
const drivers = csv(helmetIndex);
await mkdir(output, { recursive: true });
await MeshoptSimplifier.ready;

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw Error('Expected glTF 2.0 GLB');
  let json, binary;
  for (let cursor = 12; cursor < buffer.length;) {
    const size = buffer.readUInt32LE(cursor), type = buffer.readUInt32LE(cursor + 4);
    const chunk = buffer.subarray(cursor + 8, cursor + 8 + size);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    cursor += 8 + size;
  }
  if (!json || !binary) throw Error('Missing GLB chunks');
  if (json.images?.length || json.animations?.length || json.extensionsRequired?.length) throw Error('Unexpected textures, animation or required extensions');
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function accessor(index) {
    const item = json.accessors[index], view = json.bufferViews[item.bufferView];
    const size = sizes[item.type], bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[item.componentType];
    const values = item.componentType === 5126 ? new Float32Array(item.count * size) : new Uint32Array(item.count * size);
    for (let i = 0; i < item.count; i++) for (let c = 0; c < size; c++) {
      const offset = (view.byteOffset ?? 0) + (item.byteOffset ?? 0) + i * (view.byteStride ?? size * bytes) + c * bytes;
      values[i * size + c] = item.componentType === 5126 ? binary.readFloatLE(offset) : item.componentType === 5125 ? binary.readUInt32LE(offset) : item.componentType === 5123 ? binary.readUInt16LE(offset) : binary.readUInt8(offset);
    }
    return values;
  }
  const parts = new Map();
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) !== 4) throw Error('Nontriangle primitive');
    const name = json.materials[primitive.material].name;
    if (parts.has(name)) throw Error(`Unexpected repeated primitive material ${name}`);
    parts.set(name, { positions: accessor(primitive.attributes.POSITION), normals: accessor(primitive.attributes.NORMAL), indices: accessor(primitive.indices) });
  }
  return { json, parts, buffer };
}

async function load(row) {
  const file = basename(row.glb), buffer = await readFile(join(source, file));
  return { file, ...parseGlb(buffer), sha256: hash(buffer), bytes: buffer.length };
}
const carInputs = await Promise.all(teams.map(load));
const helmetInputs = await Promise.all(drivers.map(load));

function triangleKey(part, offset) {
  return [0, 1, 2].map(c => {
    const i = part.indices[offset + c];
    return [0, 1, 2].map(k => q(part.positions[i * 3 + k])).join(',') + '/' + [0, 1, 2].map(k => q(part.normals[i * 3 + k])).join(',');
  }).join('|');
}
function commonTriangles(inputs, name) {
  const sets = inputs.map(input => {
    const part = input.parts.get(name), set = new Set();
    for (let i = 0; i < part.indices.length; i += 3) set.add(triangleKey(part, i));
    return set;
  });
  return new Set([...sets[0]].filter(key => sets.every(set => set.has(key))));
}
function select(part, keys) {
  const indices = [];
  for (let i = 0; i < part.indices.length; i += 3) if (keys.has(triangleKey(part, i))) indices.push(...part.indices.subarray(i, i + 3));
  return { ...part, indices: new Uint32Array(indices) };
}
const comparisons = [];
const sharedCar = new Map();
for (const name of CAR_MATERIALS) {
  const common = commonTriangles(carInputs, name), counts = carInputs.map(input => input.parts.get(name).indices.length / 3);
  if (!['white', 'paint2'].includes(name) && counts.some(count => count !== common.size)) throw Error(`Nonshared retained geometry ${name}`);
  if (name === 'white' && common.size !== 200) throw Error('White livery base no longer matches expected 200 triangles');
  if (name === 'paint2' && counts.some(count => count - common.size > 6)) throw Error('Unexpected accent geometry differs between teams');
  sharedCar.set(name, select(carInputs[0].parts.get(name), common));
  comparisons.push({ material: name, commonTriangles: common.size, inputTriangles: Object.fromEntries(teams.map((team, i) => [team.team_key, counts[i]])), differences: name === 'white' ? 'Removed only front-wing driver numbers; shared white stripes retained.' : name === 'paint2' ? 'Ferrari/Cadillac have six tiny nose-emblem fill triangles; removed with geometric team emblem.' : 'Shared geometry matches all eleven teams (positions and normals to 1e-6).' });
}
const sharedHelmet = new Map();
for (const name of HELMET_MATERIALS) {
  const common = commonTriangles(helmetInputs, name), part = helmetInputs[0].parts.get(name);
  if (helmetInputs.some(input => input.parts.get(name).indices.length / 3 !== common.size)) throw Error(`Helmet geometry differs: ${name}`);
  sharedHelmet.set(name, part);
}

function connectedComponents(part) {
  const positionIds = new Map(), vertexIds = [];
  for (let i = 0; i < part.positions.length / 3; i++) {
    const key = [0, 1, 2].map(k => q(part.positions[i * 3 + k])).join(',');
    if (!positionIds.has(key)) positionIds.set(key, positionIds.size);
    vertexIds.push(positionIds.get(key));
  }
  const parents = Array.from({ length: positionIds.size }, (_, i) => i);
  const find = a => { while (parents[a] !== a) { parents[a] = parents[parents[a]]; a = parents[a]; } return a; };
  for (let i = 0; i < part.indices.length; i += 3) {
    const a = find(vertexIds[part.indices[i]]);
    parents[find(vertexIds[part.indices[i + 1]])] = a;
    parents[find(vertexIds[part.indices[i + 2]])] = a;
  }
  const groups = new Map();
  for (let i = 0; i < part.indices.length; i += 3) {
    const key = find(vertexIds[part.indices[i]]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...part.indices.subarray(i, i + 3));
  }
  return [...groups.values()].map(indices => ({ ...part, indices: new Uint32Array(indices) }));
}

const wheels = [
  { name: 'wheel-front-left', center: [-.59, .335, .868], radius: .335 },
  { name: 'wheel-front-right', center: [.59, .335, .868], radius: .335 },
  { name: 'wheel-rear-left', center: [-.60, .36, -.868], radius: .36 },
  { name: 'wheel-rear-right', center: [.60, .36, -.868], radius: .36 },
];
function wheelFor(part, material) {
  if (!['tire', 'rim', 'chrome', 'paint2'].includes(material)) return null;
  const unique = [...new Set(part.indices)], point = i => part.positions.subarray(i * 3, i * 3 + 3);
  for (const wheel of wheels) if (unique.every(i => {
    const p = point(i);
    return Math.sign(p[0]) === Math.sign(wheel.center[0]) && Math.abs(p[0]) >= .42 && Math.abs(p[2] - wheel.center[2]) <= wheel.radius + .015 && p[1] >= -.001 && p[1] <= .721;
  })) return wheel;
  return null;
}

function combine(parts) {
  const positions = [], normals = [], indices = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...part.positions); normals.push(...part.normals);
    for (const index of part.indices) indices.push(index + offset);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}
function simplify(part, center, ratio, maxError) {
  // Weld position+normal rather than position alone: sharp edges keep their
  // original normal discontinuity, and all surviving normals stay authored.
  const vertices = new Map(), positions = [], normals = [], indices = [];
  for (const original of part.indices) {
    const key = [0, 1, 2].map(k => q(part.positions[original * 3 + k])).join(',') + '/' + [0, 1, 2].map(k => q(part.normals[original * 3 + k])).join(',');
    if (!vertices.has(key)) {
      vertices.set(key, positions.length / 3);
      for (let k = 0; k < 3; k++) { positions.push(part.positions[original * 3 + k] - center[k]); normals.push(part.normals[original * 3 + k]); }
    }
    indices.push(vertices.get(key));
  }
  const p = new Float32Array(positions), n = new Float32Array(normals), original = new Uint32Array(indices);
  const target = Math.max(12, Math.floor(original.length * ratio / 3) * 3);
  const [simplified, error] = MeshoptSimplifier.simplify(original, p, 3, target, maxError);
  const [remap, count] = MeshoptSimplifier.compactMesh(simplified);
  const compactPositions = new Float32Array(count * 3), compactNormals = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let k = 0; k < 3; k++) {
    compactPositions[remap[i] * 3 + k] = p[i * 3 + k]; compactNormals[remap[i] * 3 + k] = n[i * 3 + k];
  }
  return { positions: compactPositions, normals: compactNormals, indices: count < 65536 ? new Uint16Array(simplified) : simplified, originalTriangles: original.length / 3, triangles: simplified.length / 3, relativeError: error, absoluteError: error * MeshoptSimplifier.getScale(p, 3) };
}

function makeGlb(parts, materials, assetExtras) {
  const json = { asset: { version: '2.0', generator: 'Pocket Paddock offline optimizer / source f1-chibi procedural', extras: { userProvided: true, ...assetExtras } }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials, accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  const chunks = [], materialIds = new Map(materials.map((material, i) => [material.name, i]));
  let byteLength = 0;
  function attribute(array, componentType, type, target, bounds = false) {
    const padding = (4 - byteLength % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); byteLength += padding; }
    const view = json.bufferViews.length, bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target }); chunks.push(bytes); byteLength += bytes.length;
    const accessor = { bufferView: view, componentType, count: array.length / (type === 'VEC3' ? 3 : 1), type };
    if (bounds) {
      accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) { const c = i % 3; accessor.min[c] = Math.min(accessor.min[c], array[i]); accessor.max[c] = Math.max(accessor.max[c], array[i]); }
    }
    json.accessors.push(accessor); return json.accessors.length - 1;
  }
  const wheelIds = new Map();
  for (const part of parts) {
    const primitive = { attributes: { POSITION: attribute(part.positions, 5126, 'VEC3', 34962, true), NORMAL: attribute(part.normals, 5126, 'VEC3', 34962) }, indices: attribute(part.indices, part.indices instanceof Uint16Array ? 5123 : 5125, 'SCALAR', 34963), material: materialIds.get(part.material) };
    const mesh = json.meshes.length; json.meshes.push({ name: part.name, primitives: [primitive] });
    const node = json.nodes.length; json.nodes.push({ name: part.name, mesh });
    if (part.wheel) {
      if (!wheelIds.has(part.wheel.name)) {
        const id = json.nodes.length; wheelIds.set(part.wheel.name, id);
        json.nodes.push({ name: part.wheel.name, translation: part.wheel.center, children: [], extras: { wheelRadius: part.wheel.radius } }); json.scenes[0].nodes.push(id);
      }
      json.nodes[wheelIds.get(part.wheel.name)].children.push(node);
    } else json.scenes[0].nodes.push(node);
  }
  json.buffers[0].byteLength = byteLength;
  const binary = Buffer.concat(chunks), jsonBytes = Buffer.from(JSON.stringify(json)), jsonPad = (4 - jsonBytes.length % 4) % 4, binPad = (4 - binary.length % 4) % 4;
  const result = Buffer.alloc(12 + 8 + jsonBytes.length + jsonPad + 8 + binary.length + binPad, 0);
  result.writeUInt32LE(0x46546c67); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(jsonBytes.length + jsonPad, 12); result.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(result, 20); result.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const binOffset = 20 + jsonBytes.length + jsonPad; result.writeUInt32LE(binary.length + binPad, binOffset); result.writeUInt32LE(0x004e4942, binOffset + 4); binary.copy(result, binOffset + 8);
  return result;
}

const grouped = new Map();
for (const [material, geometry] of sharedCar) for (const component of connectedComponents(geometry)) {
  const wheel = wheelFor(component, material), key = `${wheel?.name ?? 'body'}/${material}`;
  if (!grouped.has(key)) grouped.set(key, { wheel, material, components: [] });
  grouped.get(key).components.push(component);
}
const carParts = [...grouped.values()].map(group => ({ ...simplify(combine(group.components), group.wheel?.center ?? [0, 0, 0], .24, .003), wheel: group.wheel, material: group.material, name: group.wheel ? `${group.wheel.name}-${group.material}` : `body-material${group.material}` }));
const helmetParts = [...sharedHelmet].map(([material, geometry]) => ({ ...simplify(geometry, [0, 0, 0], .30, .006), material, name: `helmet-material${material}` }));
const carMaterials = carInputs[0].json.materials.filter(material => CAR_MATERIALS.includes(material.name));
const helmetMaterials = helmetInputs[0].json.materials.filter(material => HELMET_MATERIALS.includes(material.name));
const carGlb = makeGlb(carParts, carMaterials, { forward: '+Z', units: 'original source units', wheelAxes: 'X spin, front wheel Y steering', helmetMount: [0, .752, .0558], originalHelmetScale: [1, 1, 1.24] });
const helmetGlb = makeGlb(helmetParts, helmetMaterials, { forward: '+Z', centered: true, simplifiedPaletteGeometry: true, authenticYearVerified: false });
await writeFile(join(output, 'car.glb'), carGlb); await writeFile(join(output, 'helmet.glb'), helmetGlb);
function palette(input, names) {
  return Object.fromEntries(input.json.materials.filter(material => names.includes(material.name)).map(material => {
    const p = material.pbrMetallicRoughness;
    return [material.name, { color: p.baseColorFactor, metalness: p.metallicFactor, roughness: p.roughnessFactor }];
  }));
}
const palettes = { teams: Object.fromEntries(teams.map((team, i) => [team.team_key, palette(carInputs[i], CAR_MATERIALS)])), helmets: Object.fromEntries(drivers.map((driver, i) => [basename(driver.glb, '.glb'), palette(helmetInputs[i], HELMET_MATERIALS)])) };
await writeFile(join(output, 'palettes.json'), JSON.stringify(palettes));
for (const file of ['teams_index.csv', 'helmets_index.csv']) await copyFile(join(source, file), join(output, file));
const beforeBytes = [...carInputs, ...helmetInputs].reduce((sum, input) => sum + input.bytes, 0);
const report = {
  description: 'User-provided procedural models. Geometric car lettering replaced by runtime decals; palettes are retained, not independently verified official helmet replicas.',
  generator: 'f1-chibi procedural', userProvided: true, optimizer: 'meshoptimizer 0.22.0 (offline only, no runtime extension)',
  command: 'node scripts/optimize-models.mjs <directory containing supplied GLBs and index CSVs>',
  input: [...carInputs, ...helmetInputs].map(input => ({ filename: input.file, bytes: input.bytes, sha256: input.sha256, triangles: [...input.parts.values()].reduce((sum, part) => sum + part.indices.length / 3, 0), metadata: input.json.asset.extras })),
  indexHashes: { 'teams_index.csv': hash(teamIndex), 'helmets_index.csv': hash(helmetIndex) },
  sharedGeometry: { cars: 11, helmets: 22, comparisons, removed: ['Car embedded visor and helm_* geometry (replaced by selected driver helmet)', 'Car num and white front-wing driver-number geometry (runtime decals)', 'Car mark and six Ferrari/Cadillac nose-emblem fill triangles (runtime team wordmark)'], helmetAllInputsMatch: true },
  before: { bytes: beforeBytes, triangles: [...carInputs, ...helmetInputs].reduce((sum, input) => sum + [...input.parts.values()].reduce((n, part) => n + part.indices.length / 3, 0), 0) },
  after: { modelBytes: carGlb.length + helmetGlb.length, paletteBytes: Buffer.byteLength(JSON.stringify(palettes)), totalRuntimeBytes: carGlb.length + helmetGlb.length + Buffer.byteLength(JSON.stringify(palettes)), carTriangles: carParts.reduce((sum, part) => sum + part.triangles, 0), helmetTriangles: helmetParts.reduce((sum, part) => sum + part.triangles, 0), carBatches: carParts.length, helmetBatches: helmetParts.length, files: ['car.glb', 'helmet.glb', 'palettes.json'] },
  simplification: { carMaxRelativeError: .003, helmetMaxRelativeError: .006, errorMetric: 'Approximate MeshoptSimplifier appearance error, normalized per part. absoluteError = reported error * getScale(part); this is not an independently measured Hausdorff bound.', preserve: 'Original authored normals and hard normal discontinuities; no textures or UVs existed in the supplied assets.', parts: [...carParts, ...helmetParts].map(({ name, originalTriangles, triangles, relativeError, absoluteError }) => ({ name, originalTriangles, triangles, relativeError, absoluteError })) },
  wheels,
};
await writeFile(join(output, 'optimization.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ before: report.before, after: report.after, maxCarError: Math.max(...carParts.map(part => part.absoluteError)), maxHelmetError: Math.max(...helmetParts.map(part => part.absoluteError)), wheelNodes: wheels.map(wheel => wheel.name) }, null, 2));
