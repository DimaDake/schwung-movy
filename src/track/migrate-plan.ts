/* Turning what a schwung slot holds into what movy's chain set wants.
 *
 * Pure on purpose: the rules that decide whether a user's instrument crosses
 * over are the part worth asserting exactly, and none of them need a device.
 *
 * The output is `ChainTrackState`, the shape `restoreChains` already takes — so
 * a migrated track travels the same document, the same deferred payload and the
 * same retry as a track restored from the set file. There is no second delivery
 * path to keep in step. */

import type { ChainTrackState } from './chain-persist.js';
import type { SlotChain } from './slot-read.js';
import { defaultMix, packMixValue } from '../mixer/mix-io.js';
import { packMix } from './mix-persist.js';

export interface MigrationResult {
    /** The migrated tracks, to merge into `restoreChains`' input. */
    chains: ChainTrackState[];
    migrated: number[];
    /** Tracks whose movy chain already held something. Automatic only. */
    skipped: number[];
    /** One sentence per problem, for the log and the toast. */
    warnings: string[];
}

/** Plan the migration.
 *
 *  `existing` is what the set's own blob restored — a track already in there is
 *  skipped, because a set that carries its own chain for track 1 is not a set
 *  waiting to be migrated. `overwrite` is the manual Settings action, the one
 *  caller allowed past that guard: the two reasons to press it are a migration
 *  that came up partial and a chain since broken by hand, and a guard would
 *  refuse both. */
export function planMigration(
    slots: SlotChain[],
    existing: ChainTrackState[] | undefined | null,
    overwrite: boolean,
): MigrationResult {
    const out: MigrationResult = { chains: [], migrated: [], skipped: [], warnings: [] };
    const occupied = new Set<number>();
    for (const c of Array.isArray(existing) ? existing : []) {
        if (c && typeof c.t === 'number' && Array.isArray(c.comp) && c.comp.length > 0) {
            occupied.add(c.t);
        }
    }

    for (const s of slots) {
        /* A slot's index IS the track's, and a track's chain IS its index. */
        const t = s.slot;
        if (s.comp.length === 0) continue;
        if (occupied.has(t) && !overwrite) { out.skipped.push(t); continue; }

        const track: ChainTrackState = { t, comp: s.comp.map((c) => ({ ...c })) };
        if (s.lfo) track.lfo = s.lfo;
        const mix = mixFromVolume(s.volume);
        if (mix) track.mix = mix;
        out.chains.push(track);
        out.migrated.push(t);

        /* Reported, never fatal: the schwung slot is not cleared, so anything
         * that stayed behind is still in Move's own set file. The user is told
         * so a quiet difference does not read as a bug. */
        for (const pos of s.leftovers) {
            out.warnings.push('track ' + (t + 1) + ': ' + pos + ' stayed in schwung');
        }
        for (const key of s.unreadable) {
            out.warnings.push('track ' + (t + 1) + ': ' + key + ' did not read');
        }
    }
    return out;
}

/** schwung's `slot:volume` as movy's mixer value, or undefined at unity.
 *
 *  Both are linear amplitude with unity at 1.0, so the number carries straight
 *  across onto `gain`; pan and the sends have no schwung equivalent and keep
 *  their defaults. `packMix` returns undefined for an all-default value, which
 *  is what keeps an untouched track out of the set file. */
function mixFromVolume(volume: number | null): string | undefined {
    if (volume === null || !isFinite(volume)) return undefined;
    return packMix(packMixValue({ ...defaultMix(), gain: volume }));
}
