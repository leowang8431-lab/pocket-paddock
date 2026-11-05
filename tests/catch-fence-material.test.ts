import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {catchFenceMaterial} from '../src/monza-details.ts';

test('fine catch fencing keeps fractional mip coverage instead of opaque alpha clipping',()=>{
  const material=catchFenceMaterial();
  assert.ok(material instanceof THREE.MeshBasicMaterial);
  assert.equal(material.transparent,true,'standard glTF must export the wire as BLEND rather than MASK');
  assert.ok(material.alphaTest>=0&&material.alphaTest<.01,'subpixel wire coverage must survive the cutoff');
  assert.equal(material.depthWrite,false,'empty mesh openings must not hide cars or other scenery');
  assert.equal(material.depthTest,true);assert.equal(material.side,THREE.DoubleSide);
  assert.equal(material.alphaToCoverage,false,'wire coverage must work when antialiasing is disabled');
  assert.equal(material.forceSinglePass,true,'the flat two-sided fence must not double every instanced draw');
  assert.equal(material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile,'the exported viewer needs the same standard material');
});
