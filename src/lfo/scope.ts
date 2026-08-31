/* Which pair of LFOs a page is editing.
 *
 * There are two: a track's own two (schwung's slot LFOs on tracks 1-4, the chain
 * instance's on 5-16) and the master chain's two, which live in the shim under a
 * `master_fx:` namespace. They are the same LFOs — same params, same shapes,
 * same sync — differing only in where the keys are written and what they may
 * target. Everything above this file takes a scope and stops caring which.
 *
 * The port is the ONLY way keys are written. Reaching past it to a slot-
 * addressed API is what left tracks 5-16 unable to assign an LFO at all. */

import type { TrackPort } from '../track/port.js';
import { hostPort, portFor } from '../track/registry.js';

export interface LfoScope {
    /** Where the `lfoN:*` keys live. */
    readonly port: TrackPort;
    /** '' for a track chain, `master_fx:` for the master chain. */
    readonly keyPrefix: string;
    /** Slot the undo log records against — the master chain rides slot 0, its
     *  keys already being namespaced. */
    readonly slot: number;
    /** Undo-entry subject, e.g. `T7` / `MASTER`. */
    readonly label: string;
    /** Distinguishes gesture-grouping keys between scopes. */
    readonly id: string;
    /** Components an LFO here can target, in display order. */
    readonly components: string[];
    /** The master bus has no notes to retrigger on, and the shim has no key
     *  for it. */
    readonly hasRetrigger: boolean;
}

/* A track's chain: its synth, its FX, its MIDI FX. */
const TRACK_COMPONENTS = ['synth', 'fx1', 'fx2', 'midi_fx1', 'midi_fx2'];

/* The master chain's four FX slots. Bare `fx1`-`fx4`, not the `master_fx:fx1`
 * form movy's slot config uses: the value stored in `master_fx:lfoN:target` is
 * parsed by the shim as a slot NUMBER (shadow_chain_mgmt.c), so a namespaced
 * target would never match a slot. */
const MASTER_COMPONENTS = ['fx1', 'fx2', 'fx3', 'fx4'];

export function trackScope(track: number): LfoScope {
    return {
        port: portFor(track),
        keyPrefix: '',
        slot: track,
        label: 'T' + (track + 1),
        id: 't' + track,
        components: TRACK_COMPONENTS,
        hasRetrigger: true,
    };
}

/* The master chain is not a track. Its params are global to the shim and reach
 * it through any slot, so slot 0 carries them — the `master_fx:` prefix in the
 * key is what does the addressing.
 *
 * A SLOT, though, not track 0: `chtracks` can make that track a movy chain,
 * whose port would namespace these keys `ch0:master_fx:…` and send the master
 * LFOs' edits into a synth. */
export function masterScope(): LfoScope {
    return {
        port: hostPort(0),
        keyPrefix: 'master_fx:',
        slot: 0,
        label: 'MASTER',
        id: 'm',
        components: MASTER_COMPONENTS,
        hasRetrigger: false,
    };
}

/** Full param key for one of `scope`'s LFOs, e.g. `master_fx:lfo2:depth`. */
export function lfoKey(scope: LfoScope, lfoIdx: number, key: string): string {
    return scope.keyPrefix + 'lfo' + (lfoIdx + 1) + ':' + key;
}

/** Component key as this scope names it in a param key: a master FX component is
 *  addressed `master_fx:fx1:…` even though its LFO target value is bare `fx1`. */
export function componentKey(scope: LfoScope, comp: string): string {
    return scope.keyPrefix + comp;
}

/** The component a held knob belongs to, as an LFO target. A master FX model's
 *  component key is already namespaced (`master_fx:fx1`); the target is not. */
export function targetComponent(scope: LfoScope, componentKeyOfKnob: string): string {
    return scope.keyPrefix && componentKeyOfKnob.startsWith(scope.keyPrefix)
        ? componentKeyOfKnob.slice(scope.keyPrefix.length)
        : componentKeyOfKnob;
}
