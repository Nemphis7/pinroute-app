// Bundles the planner (its script, the MCP Apps client and its styles) into one self-contained HTML file: dist/planner.html.
// One file means the host's sandbox needs no outside script or style domains.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const out = await build({
  entryPoints: [new URL('ui/planner.js', root).pathname],
  bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');   // never close the inline script early
const html = read('ui/planner.html')
  .replace('/*CSS*/', () => read('ui/planner.css'))
  .replace('/*JS*/', () => js);

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/planner.html', root), html);
console.log(`dist/planner.html: ${(html.length / 1024).toFixed(1)} KB`);
