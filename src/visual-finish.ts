import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

/** A small, locally generated reflection map. It is lighting only: the studio
 * is never drawn behind the circuit and no HDR file or CDN is required. */
export function createStudioEnvironment(renderer:THREE.WebGLRenderer):THREE.Texture {
  const generator=new THREE.PMREMGenerator(renderer);
  const room=new RoomEnvironment();
  const target=generator.fromScene(room,.06,.1,50,{size:128});
  room.dispose();generator.dispose();
  target.texture.name='pocket-softbox-environment';
  target.texture.userData.generatedLocally=true;
  return target.texture;
}

/** Subtle moulded-rubber grain. RGB stores a tangent-space normal, not colour,
 * so the supplied black tyre colour remains unchanged. */
export function createRubberNormalMap():THREE.DataTexture {
  const size=128,data=new Uint8Array(size*size*4);
  let seed=1181;
  const noise=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296-.5;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    data[i]=128+Math.round(Math.sin(x*.88)*3+noise()*5);
    data[i+1]=128+Math.round(Math.sin(y*.43)*2+noise()*4);
    data[i+2]=255;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);
  texture.name='moulded-rubber-normal';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(7,2);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

/** A normal-only woven pattern for the undertray and wing flaps. */
export function createCarbonNormalMap():THREE.DataTexture {
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,vertical=(Math.floor(x/8)+Math.floor(y/8))%2===0;
    data[i]=128+Math.round((vertical?Math.sin(x/8*Math.PI):Math.sin(x*Math.PI))*(vertical?16:3));
    data[i+1]=128+Math.round((vertical?Math.sin(y*Math.PI):Math.sin(y/8*Math.PI))*(vertical?3:16));
    data[i+2]=255;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);
  texture.name='carbon-weave-normal';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

/** Subtle moulded sidewall marks, with no lettering or supplier logo. */
export function createTyreSidewallTexture():THREE.CanvasTexture {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d')!;
  ctx.strokeStyle='#8b918a';ctx.lineWidth=1.2;
  for(let i=0;i<4;i++){
    const angle=i*Math.PI/2+.18;
    ctx.beginPath();ctx.arc(256,256,246,angle,angle+.22);ctx.stroke();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.name='pocket-tyre-sidewall';
  texture.userData.lettering=false;
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  return texture;
}
