/* Builds the audition page for publishing (plans/2026-11-07-gen-audition-plan.md,
 * Task 5): the page's modules bundled into index.html, beside one export's
 * case files, in .gen-data/audition/site/. The Artifact is then published
 * from there: index.html as the page, manifest.json and cases-*.json as files.
 *
 *   node scripts/gen-bench/audition/publish.mjs [--build <label>]   (default: the newest export) */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

const DATA = new URL('../../../.gen-data/audition/', import.meta.url).pathname;
const PAGE = new URL('./page/', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const exports = readdirSync(DATA).filter((d) => d !== 'site' && statSync(DATA + d).isDirectory() && readdirSync(DATA + d).includes('manifest.json'));
const label = arg('build', exports.sort((a, b) => statSync(DATA + b).mtimeMs - statSync(DATA + a).mtimeMs)[0]);
if (!label) { console.error('no export: run scripts/gen-bench/audition/export.mjs'); process.exit(1); }

const out = await build({ entryPoints: [PAGE + 'app.mjs'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const site = DATA + 'site/';
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
writeFileSync(site + 'index.html', readFileSync(PAGE + 'index.html', 'utf8').replace('<!--APP-->', () => `<script>${js}</script>`));
const files = readdirSync(DATA + label).filter((f) => f.endsWith('.json'));
for (const f of files) cpSync(DATA + label + '/' + f, site + f);
console.log(`site ${site}: index.html (${Math.round(js.length / 1024)} KB script) + ${files.length} files from ${label}`);
console.log(JSON.stringify(Object.fromEntries(files.map((f) => [f, site + f]))));
