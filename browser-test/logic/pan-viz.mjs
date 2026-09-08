/* browser-test/logic/pan-viz.mjs — which params get the bipolar pan bar
 *
 * Run by browser-test/logic.mjs. Every case below is a real key/label pair
 * from docs/module-dump/device-dump.json, because the risk in this feature is
 * not the drawing — it is that one loose word promotes ~60 params across 15
 * third-party modules to a widget that claims they have a centre.
 */

import { isPanParam, isFaderParam, drawPanDial, eq, _log } from './harness.mjs';

const P = (key, label, type = 'float', min = -1, max = 1) => ({
    key, label, shortLabel: null, type, min, max, step: 0.01,
    options: null, renderStyle: 'arc', automatable: true,
});

export async function run() {

_log('\nTest: pan detection — real params that ARE a stereo position');
{
    eq('freak pan',            isPanParam(P('pan', 'Pan')), true);
    eq('forge cv_pan',         isPanParam(P('cv_pan', 'Voice Pan')), true);
    eq('forge v1_pan',         isPanParam(P('v1_pan', 'V1 Pan')), true);
    eq('mrdrums p01_pan',      isPanParam(P('p01_pan', 'P01 Pan')), true);
    eq('mrdrums pad_pan',      isPanParam(P('pad_pan', 'Pan')), true);
    eq('essaim v_pan',         isPanParam(P('v_pan', 'Pan')), true);

    /* Unipolar ranges whose CENTRE is the midpoint — the widget reads
     * normalizedValue, so 0..100 and 0..127 centre themselves. */
    eq('obxd pan_1 (0..100)',  isPanParam(P('pan_1', 'Pan 1', 'int', 0, 100)), true);
    eq('osirus panorama',      isPanParam(P('panorama', 'Panorama', 'int', 0, 127)), true);
    eq('magneto input_pan',    isPanParam(P('input_pan', 'Pan', 'float', 0, 1)), true);
    eq('minijv tone pan',      isPanParam(P('nvram_tone_0_pan', 'Pan', 'int', -64, 63)), true);

    /* One glued token, no separator for the word split to find. */
    eq('minijv partpan',       isPanParam(P('partpan', 'Part Pan', 'int', 0, 127)), true);
    eq('minijv patchpan',
        isPanParam(P('nvram_patchCommon_patchpan', 'Patch Pan', 'int', 0, 127)), true);

    /* Key says pan, label says Balance. The key is what decides. */
    eq('usefulity pan/Balance', isPanParam(P('pan', 'Balance')), true);
}

_log('\nTest: pan detection — params that only SAY pan');
{
    eq('essaim rnd_pan',       isPanParam(P('rnd_pan', 'Rnd Pan', 'float', 0, 1)), false);
    eq('mrdrums rand pan amt',
        isPanParam(P('p01_rand_pan_amt', 'P01 Rand Pan', 'float', 0, 1)), false);
    eq('granular pan_width',   isPanParam(P('pan_width', 'Pan Width', 'float', 0, 100)), false);
    eq('osirus unison_pan_spread',
        isPanParam(P('unison_pan_spread', 'Unison Pan', 'int', 0, 127)), false);
    eq('minijv Pan KF',
        isPanParam(P('nvram_tone_0_panningkeyfollow', 'Pan KF', 'int', 0, 15)), false);
    eq('osirus pan_lfo2_amount',
        isPanParam(P('pan_lfo2_amount', 'Pan LFO2', 'int', 0, 127)), false);
    eq('osirus panorama_velocity',
        isPanParam(P('panorama_velocity', 'Pan Velocity', 'int', 0, 127)), false);
    eq('signal mod_pan',       isPanParam(P('mod_pan', 'Pan Mod', 'float', 0, 1)), false);
    eq('chordism pan_morph_index',
        isPanParam(P('pan_morph_index', 'Pan Morph', 'float', 0, 1)), false);
    eq('chordism pan_morph_intensity',
        isPanParam(P('pan_morph_intensity', 'Pan Int', 'float', 0, 1)), false);

    /* A crossfade between two SOURCES, not two speakers. */
    eq('osirus osc_balance',
        isPanParam(P('osc_balance', 'Osc Balance', 'int', 0, 127)), false);
    eq('surge f_balance',      isPanParam(P('f_balance', 'Filter Balance')), false);
    eq('fizzik balance',       isPanParam(P('balance', 'Balance', 'float', 0, 1)), false);

    /* One-sided positions: each is 0..100 with no centre of its own. */
    eq('smack pan_l',          isPanParam(P('pan_l', 'Pan L', 'int', 0, 100)), false);
    eq('smack pan_r',          isPanParam(P('pan_r', 'Pan R', 'int', 0, 100)), false);

    /* surge names the key pan2 and the label Width — the label is the truth. */
    eq('surge pan2/Width',     isPanParam(P('pan2', 'Width')), false);

    eq('magneto pan_mode (enum)',
        isPanParam({ ...P('pan_mode', 'Pan Mode'), type: 'enum' }), false);
    eq('a mod-matrix row to pan', isPanParam(P('mat_1_dst', 'LFO2->Pan')), false);
    eq('unturnable (max == min)', isPanParam(P('pan', 'Pan', 'float', 0, 0)), false);
}

_log('\nTest: pan and fader stay disjoint');
{
    /* fader.ts already lists `pan` as not-a-level; this pins that the two
     * inferences can never both fire on one param and race for the style. */
    for (const p of [P('pan', 'Pan'), P('pad_pan', 'Pan'), P('panorama', 'Panorama', 'int', 0, 127)])
        eq(`${p.key}: pan yes, fader no`, isPanParam(p) && !isFaderParam(p), true);
    const vol = P('volume', 'Volume', 'float', 0, 1);
    eq('volume: fader yes, pan no', isFaderParam(vol) && !isPanParam(vol), true);
}

_log('\nTest: pan bar geometry');
{
    /* The renderer is pure and the display is 1-bit, so the pixels can be
     * captured directly. cellX 0, ky 0 → cx 16, cy 8. */
    const lit = new Set();
    const prev = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => {
        for (let yy = y; yy < y + h; yy++)
            for (let xx = x; xx < x + w; xx++) {
                if (v) lit.add(`${xx},${yy}`); else lit.delete(`${xx},${yy}`);
            }
    };
    const shot = (norm) => { lit.clear(); drawPanDial(0, 0, norm); return new Set(lit); };
    /* The bar's columns, deduped — it is 6px tall, so every column appears
     * six times in the pixel set. */
    const barCells = (s) => [...new Set([...s].filter((k) => {
        const y = +k.split(',')[1]; return y >= 6 && y <= 11;
    }).map((k) => +k.split(',')[0]))].sort((a, b) => a - b);

    const centre = shot(0.5);
    eq('centred: bar is the 1px seed at cx', barCells(centre).join(), '16');
    eq('centred: detent tick above',  centre.has('16,1') && centre.has('16,3'), true);
    /* The rail steps by 2 from cx-11 = 5, so its dots land on ODD x and never
     * on the centre column itself. The tick above is what marks the middle. */
    eq('centred: rail below',         centre.has('5,13') && centre.has('27,13'), true);

    /* The rail must NOT reach the cell edges, or a row of pan knobs merges its
     * rails into one line across the screen. 32px cell, cx 16 → ±11 = 5..27. */
    const railX = [...centre].filter((k) => k.endsWith(',13')).map((k) => +k.split(',')[0]);
    eq('rail starts inside the cell', Math.min(...railX), 5);
    eq('rail ends inside the cell',   Math.max(...railX), 27);

    const left = barCells(shot(0));
    eq('hard left: bar reaches cx-11', Math.min(...left), 5);
    eq('hard left: bar stops at cx',   Math.max(...left), 16);
    const right = barCells(shot(1));
    eq('hard right: bar starts at cx', Math.min(...right), 16);
    eq('hard right: bar reaches cx+11', Math.max(...right), 27);

    /* The whole point of choosing this widget: the value has real travel, so
     * neighbouring values must actually differ. A wedge fill gave 7 steps. */
    const seen = new Set();
    for (let i = 0; i <= 40; i++) seen.add([...shot(i / 40)].sort().join('|'));
    eq('distinct states across the sweep >= 20', seen.size >= 20, true, `got ${seen.size}`);

    /* Never outside the 16px knob row — the label sits at rowY+16. */
    const ys = [...shot(0)].map((k) => +k.split(',')[1]);
    eq('stays inside the row', Math.min(...ys) >= 0 && Math.max(...ys) <= 15, true);

    globalThis.fill_rect = prev;
}

}
