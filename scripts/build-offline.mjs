/** Pack the validated production build into a self-contained file:// game.
 * No Node runtime, server, CDN, model requests or VPN is needed by the player. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {transform} from 'esbuild';
const root=process.cwd(),dist=path.join(root,'dist'),out=path.join(root,'outputs');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const files=await fs.readdir(path.join(dist,'assets'));
const scripts=files.filter(f=>f.endsWith('.js')),styles=files.filter(f=>f.endsWith('.css'));
if(scripts.length!==1)throw Error('Offline packaging expects one bundled production entry. Rebuild or update the packer for code splitting.');
const bundled=await transform(await fs.readFile(path.join(dist,'assets',scripts[0]),'utf8'),{format:'iife',target:'es2022',minify:true,legalComments:'none',define:{'import.meta.url':JSON.stringify('file:///pocket-paddock/index.js')}});
const css=(await Promise.all(styles.map(file=>fs.readFile(path.join(dist,'assets',file),'utf8')))).join('\n');
const models={};for(const file of ['car.glb','helmet.glb','palettes.json'])models[`models/${file}`]=(await fs.readFile(path.join(dist,'models',file))).toString('base64');
for(const file of ['wheel-gun','jack','tyre'])models[`audio/pit-stop/${file}.wav`]=(await fs.readFile(path.join(dist,'audio/pit-stop',`${file}.wav`))).toString('base64');
const bootstrap=`(()=>{const assets=${JSON.stringify(models)},decoded=new Map(),original=globalThis.fetch?.bind(globalThis);globalThis.fetch=(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input?.url??'';const file=url.match(/(?:^|\\/)((?:models\\/(?:car\\.glb|helmet\\.glb|palettes\\.json))|(?:audio\\/pit-stop\\/(?:wheel-gun|jack|tyre)\\.wav))(?:[?#]|$)/)?.[1];if(file&&assets[file]){let bytes=decoded.get(file);if(!bytes){const raw=atob(assets[file]);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));decoded.set(file,bytes);}return Promise.resolve(new Response(bytes,{status:200,headers:{'Content-Type':file.endsWith('.json')?'application/json':file.endsWith('.wav')?'audio/wav':'model/gltf-binary'}}));}return original?original(input,init):Promise.reject(new Error('No offline resource for '+url));};})();`;
const notices=await fs.readFile(path.join(root,'THIRD_PARTY_NOTICES.txt'),'utf8');
const safe=value=>value.replace(/<\/script/gi,'<\\/script');
const favicon=(await fs.readFile(path.join(dist,'favicon.svg'))).toString('base64');
const localHome=`document.addEventListener('DOMContentLoaded',()=>{const home=document.querySelector('a.brand');if(home)home.setAttribute('href',location.href);});`;
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#173f38"><title>Pocket Paddock 离线版 ${pkg.version}</title><link rel="icon" href="data:image/svg+xml;base64,${favicon}"><style>${css}</style></head><body><!--${notices.replace(/--/g,'—')}--><div id="app"></div><script>${safe(bootstrap)}\n${safe(localHome)}\n${safe(bundled.code)}</script></body></html>`;
await fs.mkdir(out,{recursive:true});const file=path.join(out,`Pocket-Paddock-Offline-${pkg.version}.html`);await fs.writeFile(file,html);
console.log(JSON.stringify({version:pkg.version,file,bytes:Buffer.byteLength(html),embeddedModels:Object.keys(models),networkRequired:false}));
