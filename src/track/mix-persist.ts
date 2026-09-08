/* The mixer half of a movy-hosted chain's saved state.
 *
 * A host track's level is schwung's `slot:volume` and rides Move's own set
 * file. A movy track's is movy's own summing mixer — the `gain,pan,muted`
 * triple under `mix` — and no component's `:state` blob carries it. So without
 * this the level was gone the moment the Set was reopened, which is what "movy
 * track volume is not saved" was.
 *
 * Rides the batch `chain-persist` already issues per track, so it costs no
 * extra round trip in either direction. The consequence is that a chain with
 * no modules is not captured at all: a level set on a silent chain does not
 * survive a reopen. That is the same bargain the LFO state already takes, and
 * a chain with nothing in it has no level to hear. */

/* The value codec lives in `../mixer/mix-io.js` — one reader, one writer, one
 * rule about which widths are honoured. It used to be duplicated here, which is
 * how the two could have disagreed about whether a value was worth saving. */
export { MIX_KEY } from '../mixer/mix-io.js';
import { MIX_KEY, isMixValue, parseMixValue } from '../mixer/mix-io.js';

/** The value to save, or undefined when the track is at unity, centred, unmuted
 *  and sending nothing — an untouched track writes nothing into the set file, so
 *  an old set and a new one both restore to the same default. */
export function packMix(value: string | null | undefined): string | undefined {
    if (!isMixValue(value)) return undefined;
    const m = parseMixValue(value);
    if (m.gain === 1 && m.pan === 0 && !m.muted && m.send.every((s) => s === 0)) {
        return undefined;
    }
    return value;
}

/** A saved value as a write pair, or null when it is not one this build can
 *  honour — refused whole rather than half-applied, because a malformed mix
 *  the engine rejects would leave the chain at a level nothing wrote. */
export function mixPair(saved: unknown): [string, string] | null {
    return isMixValue(saved) ? [MIX_KEY, saved] : null;
}
