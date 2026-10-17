/* Regenerates src/font/glyphs.ts from Schwung's font4x5.mjs.
 *   node scripts/gen-font-from-schwung.mjs [path/to/font4x5.mjs]
 * Default is the checkout's copy; the drift test compares against the PINNED
 * tag, so regenerate from that tag's file after a pin bump. */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? resolve(HERE, '../../schwung/src/shared/param_pages/font4x5.mjs'));
const { CHARS, GLYPHS_FOR_TEST: G } = await import(pathToFileURL(src).href);
const esc = c => c === '\\' ? "'\\\\'" : c === "'" ? `"'"` : `'${c}'`;
let out = `// Movy's normal 5px face: Schwung's param-page font (font4x5), so the chrome and
// the Schwung pages draw the SAME letterforms. Proportional, 5 rows tall, the 1px
// inter-glyph gap folded INTO each advance. Uppercase only — index.ts folds
// lowercase onto it.
//
// Glyph format: [advance, yOff, w, h, ...rowBytes]  bit0=leftmost pixel
// GENERATED from schwung/src/shared/param_pages/font4x5.mjs (pinned tag); a
// logic test fails if this drifts from the pinned file. Re-sync by re-running
// the generator, do not hand-edit rows that exist upstream.
export const CHARS4 = ${JSON.stringify(CHARS)};

export const G4: number[][] = [
`;
G.forEach((g, i) => { out += `  [${g.join(',')}],// ${esc(CHARS[i])}\n`; });
out += `];

// Characters font4x5 does not draw (it has no ; $ @ [ ] { } | ~ \`) — movy shows
// file and Set names, which contain them, and a blank glyph there reads as a
// dropped character. Drawn in font4x5's construction (5 rows, gap in the
// advance); NOT upstream, so the drift test leaves them alone.
export const CHARS4_EXTRA = ';$@[]{}|~\`';
export const G4_EXTRA: number[][] = [
  [3,0,2,5,0,2,0,2,1],// ';'
  [5,0,4,5,14,5,6,10,7],// '$'
  [5,0,4,5,6,9,13,1,14],// '@'
  [3,0,2,5,3,1,1,1,3],// '['
  [3,0,2,5,3,2,2,2,3],// ']'
  [4,0,3,5,6,2,1,2,6],// '{'
  [4,0,3,5,3,2,4,2,3],// '}'
  [2,0,1,5,1,1,1,1,1],// '|'
  [5,0,4,5,0,6,9,0,0],// '~'
  [3,0,2,5,1,2,0,0,0],// '\`'
];
`;
import fs from 'node:fs';
fs.writeFileSync(resolve(HERE, '../src/font/glyphs.ts'), out);
