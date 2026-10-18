/* mixer-contract.ts — the Session mixer's virtual component (hold Session).
 *
 * Sixteen fader cells, `t1`..`t16`, each the MIX page's own VOL cell for that
 * track (`mixCell`): fader POSITION 0..1, the same rate and the same writer,
 * so undo, persistence and the automation base are exactly the MIX page's.
 *
 * Two custom pages of eight (`withCanvasPages`), named by the tracks their
 * knobs drive; both DRAW all sixteen strips, which is why the drawer reads
 * the engine's `mtr` field rather than the page's own values — eight of the
 * sixteen are not on the page. */

import { createVirtualSource } from '../renderer/schwung-virtual-source.js';
import { withCanvasPages } from '../renderer/schwung-virtual-canvas.js';
import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { drawMixerBody } from '../renderer/mixer-view.js';
import { MIXER_COMPONENT } from '../chain/config.js';
import { seqState } from '../seq/state.js';
import { mixCell } from './mix-schwung-cells.js';
import { decodeMeter, METER_TRACKS } from './meter.js';

export const MIXER_KNOBS = 8;

export const mixerKey = (track: number): string => 't' + (track + 1);

/** The track a page key names, or -1. */
export function trackOfMixerKey(key: string | undefined): number {
    const m = key ? /^t(\d+)$/.exec(key) : null;
    const t = m ? Number(m[1]) - 1 : -1;
    return t >= 0 && t < METER_TRACKS ? t : -1;
}

function build(): PageParamSource {
    const cells = Array.from({ length: METER_TRACKS }, (_, t) => mixCell(t, 'gain', {
        key: mixerKey(t), name: `Track ${t + 1} Volume`, short: `T${t + 1}`,
    }));
    const pages = [0, 1].map((p) => {
        const first = p * MIXER_KNOBS;
        return {
            canvasKey: 'mix' + (p + 1),
            name: `${first + 1}-${first + MIXER_KNOBS}`,
            knobs: cells.slice(first, first + MIXER_KNOBS).map((c) => c.key),
        };
    });
    return withCanvasPages(createVirtualSource(MIXER_COMPONENT, cells), MIXER_COMPONENT, pages,
        (ctx, band, _canvas, payload) => {
            const keys = payload.keys || [];
            const touched = typeof payload.touched === 'number' ? payload.touched : -1;
            drawMixerBody(ctx, band, decodeMeter(seqState.mixMeter), trackOfMixerKey(keys[touched]));
        });
}

/* One for the process, like Set/Clip Params: the cells resolve their track's
 * port on every read, so nothing here goes stale. */
let source: PageParamSource | null = null;
export function mixerSource(): PageParamSource {
    if (!source) source = build();
    return source;
}
