import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {teams} from './team-catalog';

/** Small deterministic textures are generated locally, with no image/CDN fetch. */
export function asphaltTexture():THREE.CanvasTexture|undefined {
  if(typeof document==='undefined')return;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d')!;let seed=31871;
  const image=ctx.createImageData(256,256);
  for(let i=0;i<image.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const c=148+(seed>>>26);image.data[i]=c;image.data[i+1]=c;image.data[i+2]=c;image.data[i+3]=255;}
  ctx.putImageData(image,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;return texture;
}

export function catchFenceMaterial():THREE.MeshBasicMaterial {
  let texture:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.strokeStyle='#cad0ce';ctx.lineWidth=1.8;
    for(let x=-128;x<=256;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+128,128);ctx.stroke();ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-128,128);ctx.stroke();}
    texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(4,3);texture.anisotropy=4;
  }
  const mat=new THREE.MeshBasicMaterial({color:0xb8c1bf,map:texture??null,alphaTest:.37,side:THREE.DoubleSide,alphaToCoverage:true});
  mat.name='galvanised-catch-fence';return mat;
}

export function pitGlazingMaterial():THREE.MeshStandardMaterial {
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=128;
  const ctx=canvas.getContext('2d')!,gradient=ctx.createLinearGradient(0,0,0,128);
  gradient.addColorStop(0,'#b9d1d9');gradient.addColorStop(.45,'#7f9ba5');gradient.addColorStop(.51,'#40585d');gradient.addColorStop(1,'#73908f');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,64,128);
  ctx.fillStyle='#d6e6e4';ctx.globalAlpha=.25;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(22,0);ctx.lineTo(64,96);ctx.lineTo(64,128);ctx.closePath();ctx.fill();
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshStandardMaterial({color:0xffffff,map,roughness:.23,metalness:.28});material.name='monza-pit-glazing';return material;
}

/** One atlas and one draw for all twelve numbered garages and team headers. */
export function addGarageHeaders(parent:THREE.Group):void {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
  const ctx=canvas.getContext('2d')!,parts:THREE.BufferGeometry[]=[];
  for(let i=0;i<12;i++){
    const y=i*80,team=teams[i];ctx.fillStyle='#e7e7df';ctx.fillRect(0,y,1024,78);
    ctx.fillStyle=team?.color??'#38434a';ctx.fillRect(0,y,1024,8);ctx.fillRect(0,y+8,128,70);
    ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.font='bold 48px Arial';ctx.fillText(String(i+1).padStart(2,'0'),64,y+45);
    ctx.fillStyle='#273238';ctx.font='bold 37px Arial';ctx.fillText(team?.name.toUpperCase()??'AUTODROMO MONZA',575,y+45,835);
    const g=new THREE.PlaneGeometry(11.5,.95);g.rotateY(-Math.PI/2);g.translate(-49.66,6.8,-43+i*13.2);
    const uv=g.attributes.uv;for(let k=0;k<uv.count;k++)uv.setY(k,1-(y+(1-uv.getY(k))*78)/1024);
    parts.push(g);
  }
  const geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));mesh.name='pit-garage-number-and-team-atlas';parent.add(mesh);
}

/** Geometry rods are merged later with the static architecture cells. */
export function structuralRod(parent:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,radius:number,material:THREE.Material):THREE.Mesh {
  const direction=b.clone().sub(a);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,direction.length(),6),material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());parent.add(mesh);return mesh;
}
