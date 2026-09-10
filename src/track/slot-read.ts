/* Reading a schwung shadow slot — the ONLY place movy does it.
 *
 * The migration is the last thing that talks to schwung's slots, and schwung is
 * a moving target: its chain is a LIST of positions, not a fixed set, and key
 * spellings have been refactored under us before. So every read lives here, and
 * a key that does not answer is REPORTED rather than treated as absence — a
 * migration that quietly reads nothing looks exactly like a set with nothing in
 * it, and the difference is the user's instruments.
 *
 * `scripts/test-migrate.sh`'s contract-canary arm reads these same keys off a
 * real device and fails naming whichever one stopped answering. */

import { persistableComponents } from './chain-persist.js';
import { moduleReadKey } from '../chain/config.js';
import { hostPort } from './registry.js';
import { lfoStateKeys, packLfoState } from './lfo-persist.js';

export interface SlotComponent { c: string; m: string; s?: string }

export interface SlotChain {
    slot: number;
    comp: SlotComponent[];
    lfo?: string[];
    volume: number | null;
    /** Positions holding a module that movy's UI has no place to show. */
    leftovers: string[];
    /** Keys that answered null while their component was present. */
    unreadable: string[];
}

/** The schwung slots a track could have come from. */
export const LEGACY_SLOTS = 4;

/* Chain positions schwung can hold and movy cannot draw. Probed so the user can
 * be TOLD what did not come across; never migrated. schwung's list is
 * open-ended, so this is a reasonable depth rather than a guarantee — a slot
 * with an fx5 in it is beyond what anyone has built. */
export const EXTRA_POSITIONS = ['fx3', 'fx4'];

/* schwung's own slot fader. Spelled here rather than imported from the mixer:
 * it is a schwung key, and this file is where schwung keys live — the mixer
 * stopped having a second shape for a track's level the moment there was one
 * host. */
const SLOT_VOLUME_KEY = 'slot:volume';

/** The four slots' module ids as one string, for the stability comparison.
 *  Cheap: schwung serves these from its own param cache. */
export function slotSignature(): string {
    const comps = persistableComponents();
    const out: string[] = [];
    for (let slot = 0; slot < LEGACY_SLOTS; slot++) {
        const port = hostPort(slot);
        out.push(comps.map((c) => port.getParam(moduleReadKey(c)) ?? '').join('|'));
    }
    return out.join(';');
}

/** Everything movy can see in one slot. Never throws and never guesses. */
export function readSlotChain(slot: number): SlotChain {
    const port = hostPort(slot);
    const out: SlotChain = { slot, comp: [], volume: null, leftovers: [], unreadable: [] };

    for (const c of persistableComponents()) {
        const m = port.getParam(moduleReadKey(c));
        if (!m) continue;
        const comp: SlotComponent = { c, m };
        /* A module with no preset blob is normal — plenty publish none. A blob
         * that reads empty when the module IS loaded is not distinguishable
         * from that, so it is reported and the component still migrates: the
         * module in place at defaults beats no module at all. */
        const s = port.getParam(c + ':state');
        if (s) comp.s = s;
        else out.unreadable.push(c + ':state');
        out.comp.push(comp);
    }

    /* Nothing movy can show means nothing to carry: an empty slot has no level
     * worth migrating and no LFO that could be targeting anything. */
    if (out.comp.length === 0) return out;

    for (const c of EXTRA_POSITIONS) {
        if (port.getParam(moduleReadKey(c))) out.leftovers.push(c);
    }

    const lfo = packLfoState(lfoStateKeys().map((k) => port.getParam(k)));
    if (lfo) out.lfo = lfo;

    const raw = port.getParam(SLOT_VOLUME_KEY);
    const v = raw === null ? NaN : parseFloat(raw);
    out.volume = Number.isFinite(v) ? v : null;

    return out;
}
