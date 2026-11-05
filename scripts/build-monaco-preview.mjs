/** Separate, network-free map review; does not add a racing circuit yet. */
import fs from 'node:fs/promises';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/monaco-preview.ts'],bundle:true,write:false,outdir:'work/monaco-build',format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'none',define:{'import.meta.env':JSON.stringify({DEV:false,BASE_URL:'./'}),'import.meta.url':JSON.stringify('file:///pocket-paddock/monaco.js')}});
const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text;if(!js||!css)throw Error('Monaco build is incomplete.');
const favicon=(await fs.readFile('public/favicon.svg')).toString('base64'),notices=await fs.readFile('THIRD_PARTY_NOTICES.txt','utf8');
const localLinks=`document.addEventListener('DOMContentLoaded',()=>{if(location.protocol==='file:')document.querySelectorAll('a.mc-brand,a.mc-back').forEach(a=>{a.href=location.href;if(a.classList.contains('mc-back'))a.textContent='离线模型预览';});});`;
const safe=s=>s.replace(/<\/script/gi,'<\\/script');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#e6eeeb"><title>摩纳哥地图初版 · Pocket Paddock</title><link rel="icon" href="data:image/svg+xml;base64,${favicon}"><style>${css}</style></head><body><!--${notices.replace(/--/g,'—')}--><div id="monaco-app"></div><script>${safe(localLinks)}\n${safe(js)}</script></body></html>`;
await fs.mkdir('dist',{recursive:true});await fs.mkdir('outputs',{recursive:true});await fs.writeFile('dist/monaco.html',html);await fs.writeFile('outputs/Pocket-Paddock-Monaco-Preview-V1.html',html);console.log(JSON.stringify({page:'dist/monaco.html',artifact:'outputs/Pocket-Paddock-Monaco-Preview-V1.html',bytes:Buffer.byteLength(html),networkRequired:false}));
