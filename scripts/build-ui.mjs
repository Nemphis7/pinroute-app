// Bundles the planner (its script, the MCP Apps client, its styles and the world map) into one self-contained HTML
// file: dist/planner.html. One file means the host's sandbox needs no outside script or style domains.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { worldMap } from '../src/world.mjs';
import { DESTS } from '../src/discover.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// The world map is drawn here, once, and bundled as data: import WORLD from 'pinroute:world'
const world = {
  name: 'world',
  setup(b) {
    b.onResolve({ filter: /^pinroute:world$/ }, () => ({ path: 'world', namespace: 'pinroute' }));
    b.onLoad({ filter: /.*/, namespace: 'pinroute' }, () => ({ contents: JSON.stringify(worldMap(DESTS)), loader: 'json' }));
  },
};

const out = await build({
  entryPoints: [new URL('ui/planner.js', root).pathname],
  bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none', plugins: [world],
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');   // never close the inline script early
const html = read('ui/planner.html')
  .replace('/*CSS*/', () => read('ui/planner.css'))
  .replace('/*JS*/', () => js);

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/planner.html', root), html);
console.log(`dist/planner.html: ${(html.length / 1024).toFixed(1)} KB`);
