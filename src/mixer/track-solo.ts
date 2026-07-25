import { mlog } from '../log.js';

/* Solo via the host's `slot:soloed`, the same param schwung's own
 * Shift+Mute+Track gesture drives outside movy.
 *
 * Two properties come from the host (shadow_chain_mgmt.c:1625) and shape this
 * module:
 *   - Solo is **exclusive**: setting one slot soloed clears the others, so the
 *     mirror is a single index rather than a flag per track. Soloing a second
 *     track moves the solo; no explicit un-solo of the first is needed.
 *   - It is an audio gate in the shim mixdown, and it beats mute — a soloed
 *     track is heard even if muted, and everything else goes silent including
 *     live pad playing and FX tails.
 *
 * The mirror is local because painting the track LEDs every tick cannot afford
 * four IPC reads; `refreshSolo()` re-syncs it from the host on open, so a solo
 * set elsewhere (schwung's UI, the web UI) still shows up.
 */

let soloedTrack = -1;   /* -1 = no solo anywhere */

export function isSoloed(track: number): boolean { return soloedTrack === track; }
export function anySolo(): boolean { return soloedTrack >= 0; }

/* True when this track is silent because *another* track is soloed — the LED
 * condition, which reads the same as muted (leds.ts). */
export function silencedBySolo(track: number): boolean {
    return soloedTrack >= 0 && soloedTrack !== track;
}

export function soloTrack(track: number): void {
    if (track < 0 || track > 3) return;
    const next = soloedTrack === track ? 0 : 1;
    shadow_set_param(track, 'slot:soloed', String(next));
    soloedTrack = next === 1 ? track : -1;
    mlog('solo t=' + track + ' -> ' + next);
}

/* Re-sync from the host (movy open / resume). */
export function refreshSolo(): void {
    soloedTrack = -1;
    for (let t = 0; t < 4; t++) {
        if (shadow_get_param(t, 'slot:soloed') === '1') { soloedTrack = t; break; }
    }
    mlog('solo refresh t=' + soloedTrack);
}

export function resetTrackSolo(): void { soloedTrack = -1; }
