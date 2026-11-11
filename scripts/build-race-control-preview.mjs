/** Package the Race Control review and its playable game handoff into one offline file. */
import fs from 'node:fs/promises';
import { build } from 'esbuild';

const artifact = 'outputs/Pocket-Paddock-Race-Control-Preview.html';
const modelFiles = ['models/car.glb', 'models/helmet.glb', 'models/palettes.json'];
const audioFiles = ['wheel-gun', 'jack', 'tyre'].map(name => `audio/pit-stop/${name}.wav`);

async function bundle(entry, name) {
  const { outputFiles } = await build({
    entryPoints: [entry], bundle: true, write: false,
    outfile: `work/race-control-build/${name}.js`,
    format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    legalComments: 'none',
    define: {
      'import.meta.env': JSON.stringify({ DEV: false, BASE_URL: './' }),
      'import.meta.url': JSON.stringify(`file:///pocket-paddock/${name}.js`),
    },
  });
  const js = outputFiles.find(file => file.path.endsWith('.js'))?.text;
  const css = outputFiles.find(file => file.path.endsWith('.css'))?.text;
  if (!js || !css) throw new Error(`Missing JavaScript or CSS for ${entry}`);
  return { js, css };
}

function installAssetFetch(assets) {
  const bytesByName = new Map();
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split(/[?#]/, 1)[0];
    const name = Object.keys(assets).find(file => path === file || path.endsWith(`/${file}`));
    if (!name) return original(input, init);
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
    if (!bytesByName.has(name)) {
      const raw = atob(assets[name]);
      bytesByName.set(name, Uint8Array.from(raw, char => char.charCodeAt(0)));
    }
    const contentType = name.endsWith('.json') ? 'application/json'
      : name.endsWith('.wav') ? 'audio/wav' : 'model/gltf-binary';
    return Promise.resolve(new Response(bytesByName.get(name), {
      headers: { 'Content-Type': contentType },
    }));
  };
}

function prepareGame(settings, token) {
  // The embedded game reads these through its existing settings API.
  // Keep its writes in this frame so preview choices cannot modify the main game's save.
  function memoryStorage(initial) {
    const data = new Map(Object.entries(initial));
    return {
      get length() { return data.size; },
      key: index => [...data.keys()][index] ?? null,
      getItem: key => data.get(String(key)) ?? null,
      setItem: (key, value) => { data.set(String(key), String(value)); },
      removeItem: key => { data.delete(String(key)); },
      clear: () => { data.clear(); },
    };
  }
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: memoryStorage({
      'pocket-paddock.circuit': settings.circuit,
      'pocket-paddock.garage.v1': JSON.stringify({ team: settings.team, driver: settings.driver }),
      'pocket-paddock.mode': settings.mode,
      'pocket-paddock.starting-compound': settings.compound,
      'pocket-paddock.sound': settings.sound ? 'on' : 'off',
      'pocket-paddock.language': settings.language,
      'pocket-paddock.weather': settings.weather,
    }) },
    sessionStorage: { configurable: true, value: memoryStorage({
      'pocket-paddock.travel.arrived': settings.circuit,
    }) },
  });

  // The preview may have already exposed a controller before this frame exists.
  // Prefer a controller available directly in the game, then read the same-origin
  // preview's native Gamepad API. The browser still decides which pads to expose.
  try {
    if (window.frameElement?.id === 'rc-game') {
      const previewNavigator = window.parent.navigator;
      if (typeof previewNavigator.getGamepads === 'function') {
        const readLocal = navigator.getGamepads?.bind(navigator);
        const hasStandardPad = pads => pads && Array.prototype.some.call(pads,
          pad => pad?.connected !== false && pad?.mapping === 'standard');
        Object.defineProperty(navigator, 'getGamepads', {
          configurable: true,
          value() {
            let localPads;
            try { localPads = readLocal?.(); } catch { /* Try the preview's exposed pads. */ }
            if (hasStandardPad(localPads)) return localPads;
            try {
              const previewPads = previewNavigator.getGamepads();
              if (!localPads || hasStandardPad(previewPads)) return previewPads;
            } catch (error) {
              if (!localPads) throw error;
            }
            return localPads;
          },
        });
      }
    }
  } catch { /* Keep the browser's Gamepad API if the preview cannot be reached. */ }

  if (settings.sound && window.AudioContext) {
    // An automatic click can reach the game before the iframe has received a gesture.
    // Retry suspended contexts at the first trusted input without restarting the race.
    const pending = new Set();
    const nativeResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      const result = nativeResume.call(this);
      if (this.state === 'suspended') {
        pending.add(this);
        void result.then(() => pending.delete(this), () => pending.delete(this));
      }
      return result;
    };
    function resumeOnInput(event) {
      if (!event.isTrusted || !pending.size) return;
      for (const context of pending) void nativeResume.call(context).catch(() => {});
    }
    window.addEventListener('pointerdown', resumeOnInput, { capture: true });
    window.addEventListener('keydown', resumeOnInput, { capture: true });
  }

  // Changing circuit is handled by the review screen, which has the flight transition.
  document.addEventListener('change', event => {
    if (event.target.id !== 'circuit') return;
    event.target.value = settings.circuit;
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('a.brand')) event.preventDefault();
  });

  let done = false;
  let started = false;
  const observer = new MutationObserver(check);
  function report(error) {
    if (done) return;
    done = true;
    observer.disconnect();
    window.parent.postMessage({ type: 'pocket-paddock-race-control', token, error }, '*');
  }
  function check() {
    const failure = document.querySelector('.error-box');
    if (failure) {
      report(failure.querySelector('p')?.textContent || 'Could not load the race.');
      return;
    }
    const state = document.body.dataset.state;
    if (state === 'countdown' || state === 'racing') {
      report(null);
      return;
    }
    const start = document.querySelector('#start');
    const loading = document.querySelector('#loading');
    if (!started && start && !start.disabled && loading?.hidden) {
      started = true;
      start.click();
    }
  }
  window.addEventListener('error', event => report(event.message || 'Could not load the race.'));
  window.addEventListener('unhandledrejection', event => report(String(event.reason)));
  observer.observe(document.body, { childList: true, attributes: true, subtree: true });
}

function installGameLauncher(game, assets, installFetchSource, prepareGameSource) {
  let nextToken = 0;
  const pendingFrames = new WeakMap();
  function safeScript(source) { return source.replace(/<\/script/gi, '<\\/script'); }
  window.startRaceControlGame = (frame, settings) => {
    pendingFrames.get(frame)?.(new Error('This race was replaced by another launch.'));
    const token = ++nextToken;
    const language = settings.language === 'zh' ? 'zh-CN' : 'en';
    const bootstrap = `(${installFetchSource})(${JSON.stringify(assets)});\n`
      + `(${prepareGameSource})(${JSON.stringify(settings)}, ${token});`;
    const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<style>${game.css}</style></head><body><div id="app"></div>`
      + `<script>${safeScript(bootstrap)}<\/script><script>${safeScript(game.js)}<\/script></body></html>`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('The race took too long to load. Return to the garage and try again.')), 45000);
      function finish(error) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        pendingFrames.delete(frame);
        if (error) reject(error);
        else resolve();
      }
      function onMessage(event) {
        if (event.source !== frame.contentWindow || event.data?.type !== 'pocket-paddock-race-control'
          || event.data.token !== token) return;
        finish(event.data.error ? new Error(event.data.error) : null);
      }
      pendingFrames.set(frame, finish);
      window.addEventListener('message', onMessage);
      frame.srcdoc = html;
    });
  };
}

const [preview, game, assets, favicon, notices] = await Promise.all([
  bundle('src/race-control-preview.ts', 'race-control-preview'),
  bundle('src/main.ts', 'race-control-game'),
  Promise.all([...modelFiles, ...audioFiles].map(async file => [
    file, (await fs.readFile(`public/${file}`)).toString('base64'),
  ])).then(Object.fromEntries),
  fs.readFile('public/favicon.svg').then(data => data.toString('base64')),
  fs.readFile('THIRD_PARTY_NOTICES.txt', 'utf8'),
]);

const safe = value => value.replace(/<\/script/gi, '<\\/script');
const bootstrap = `(() => {\nconst assets = ${JSON.stringify(assets)};\n`
  + `(${installAssetFetch.toString()})(assets);\n`
  + `(${installGameLauncher.toString()})(${JSON.stringify(game)}, assets, `
  + `${JSON.stringify(installAssetFetch.toString())}, ${JSON.stringify(prepareGame.toString())});\n})();`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<meta name="theme-color" content="#081017"><title>Pocket Paddock · Race Control</title>`
  + `<link rel="icon" href="data:image/svg+xml;base64,${favicon}"><style>${preview.css}</style></head>`
  + `<body><!--${notices.replace(/--/g, '—')}--><div id="race-control-preview"></div>`
  + `<script>${safe(bootstrap)}</script><script>${safe(preview.js)}</script></body></html>`;
await fs.mkdir('outputs', { recursive: true });
await fs.writeFile(artifact, html);
console.log(JSON.stringify({ artifact, bytes: Buffer.byteLength(html), networkRequired: false }));
