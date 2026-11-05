/** Build the model-review page as one self-contained HTML, alongside the game.
 * Its own bundle does not change the game's single-entry/offline build. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';

const result=await build({entryPoints:['src/pit-stop-preview.ts'],bundle:true,write:false,
  outdir:'work/pit-preview-build',format:'iife',platform:'browser',target:'es2022',minify:true,
  legalComments:'none',define:{'import.meta.env':JSON.stringify({DEV:false,BASE_URL:'./'}),'import.meta.url':JSON.stringify('file:///pocket-paddock/pit-preview.js')}});
const js=result.outputFiles.find(file=>file.path.endsWith('.js'))?.text;
const css=result.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
if(!js||!css)throw new Error('Missing pit-preview JavaScript or CSS output.');
const models={};for(const file of ['car.glb','helmet.glb','palettes.json'])models[`models/${file}`]=(await fs.readFile(path.join('public/models',file))).toString('base64');
for(const file of ['wheel-gun','jack','tyre'])models[`audio/pit-stop/${file}.wav`]=(await fs.readFile(`public/audio/pit-stop/${file}.wav`)).toString('base64');
const bootstrap=`(()=>{const data=${JSON.stringify(models)},cache=new Map(),original=globalThis.fetch?.bind(globalThis);globalThis.fetch=(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input?.url??'';const name=url.match(/(?:^|\\/)((?:models\\/(?:car\\.glb|helmet\\.glb|palettes\\.json))|(?:audio\\/pit-stop\\/(?:wheel-gun|jack|tyre)\\.wav))(?:[?#]|$)/)?.[1];if(name&&data[name]){let bytes=cache.get(name);if(!bytes){bytes=Uint8Array.from(atob(data[name]),c=>c.charCodeAt(0));cache.set(name,bytes);}return Promise.resolve(new Response(bytes,{status:200,headers:{'Content-Type':name.endsWith('.json')?'application/json':name.endsWith('.wav')?'audio/wav':'model/gltf-binary'}}));}return original?original(input,init):Promise.reject(Error('Offline asset missing: '+url));};})();`;
const favicon=(await fs.readFile('public/favicon.svg')).toString('base64');
const notices=await fs.readFile('THIRD_PARTY_NOTICES.txt','utf8');
const safe=value=>value.replace(/<\/script/gi,'<\\/script');
const localLinks=`document.addEventListener('DOMContentLoaded',()=>{if(location.protocol==='file:')document.querySelectorAll('a.pit-brand,a.pit-back').forEach(link=>{link.href=location.href;link.setAttribute('aria-label','换胎动画预览首页');if(link.classList.contains('pit-back'))link.innerHTML='换胎预览 V5';});});`;
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eeeee5"><title>换胎动作预览 V5 · Pocket Paddock</title><link rel="icon" href="data:image/svg+xml;base64,${favicon}"><style>${css}</style></head><body><!--${notices.replace(/--/g,'—')}--><div id="pit-app"></div><script>${safe(bootstrap)}\n${safe(localLinks)}\n${safe(js)}</script></body></html>`;
await fs.mkdir('dist',{recursive:true});await fs.mkdir('outputs',{recursive:true});
await fs.writeFile('dist/pit-stop.html',html);
await fs.writeFile('dist/THIRD_PARTY_NOTICES.txt',notices);
const artifact='outputs/Pocket-Paddock-Pit-Stop-Preview-V5.html';await fs.writeFile(artifact,html);
console.log(JSON.stringify({page:'dist/pit-stop.html',artifact,bytes:Buffer.byteLength(html),embeddedModels:Object.keys(models),networkRequired:false}));
