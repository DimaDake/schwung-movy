/* browser-test/logic/font-parity.mjs — movy's normal face IS Schwung's param-page
 * font (font4x5). The table in src/font/glyphs.ts is a generated copy, so the
 * thing to pin is that it still equals the PINNED tag's file: a hand-edit, or a
 * schwung pin bump that redrew a letter, would otherwise leave the chrome and
 * the Schwung pages drawing two different alphabets again.
 *
 * Run by browser-test/logic.mjs.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq, ok, _log } from './harness.mjs';
import { pinnedSchwungRoot } from '../../scripts/lib/schwung-pinned.mjs';

export async function run() {
    _log('font-parity');
    const { CHARS4, G4, CHARS4_EXTRA, G4_EXTRA } = await import('../../dist/esm/font/glyphs.js');
    const { fontWidth } = await import('../../dist/esm/font/index.js');

    const up = await import(pathToFileURL(
        join(pinnedSchwungRoot(), 'src', 'shared', 'param_pages', 'font4x5.mjs')).href);

    eq('movy covers exactly the characters the pinned font4x5 does', CHARS4, up.CHARS);
    eq('every movy glyph row equals the pinned font4x5 table',
       JSON.stringify(G4), JSON.stringify(up.GLYPHS_FOR_TEST));
    for (const s of ['AMPLITUDE', 'LOW PASS', 'C#4 -12.5%', 'SAW/SINE']) {
        eq(`fontWidth(${s}) matches Schwung's measure`, fontWidth(s), up.fontWidth4x5(s));
    }

    /* The extras exist because font4x5 draws nothing for them; each must have ink
     * and must not shadow an upstream character. */
    eq('one glyph per extra character', G4_EXTRA.length, CHARS4_EXTRA.length);
    for (let i = 0; i < CHARS4_EXTRA.length; i++) {
        ok(`extra '${CHARS4_EXTRA[i]}' is not an upstream character`, !CHARS4.includes(CHARS4_EXTRA[i]));
        ok(`extra '${CHARS4_EXTRA[i]}' has ink`, G4_EXTRA[i].slice(4).some((r) => r));
    }

    /* Lowercase folds onto the capitals instead of vanishing. */
    eq('lowercase measures as its capital', fontWidth('saw sine'), fontWidth('SAW SINE'));
}
