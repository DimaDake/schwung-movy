/* The mixer half of a movy-hosted chain's saved state.
 *
 * A track's level is movy's own summing mixer — the `gain,pan,muted` triple
 * under `mix` — and no component's `:state` blob carries it. So without
 * this the level was gone the moment the Set was reopened, which is what "movy
 * track volume is not saved" was.
 *
 * The restore rides the batch `chain-persist` already issues per track, so it
 * costs no extra round trip. */

/* The value codec lives in `../mixer/mix-io.js` — one reader, one writer, one
 * rule about which widths are honoured. */
import { MIX_KEY, isMixValue } from '../mixer/mix-io.js';

/** A saved value as a write pair, or null when it is not one this build can
 *  honour — refused whole rather than half-applied, because a malformed mix
 *  the engine rejects would leave the chain at a level nothing wrote. */
export function mixPair(saved: unknown): [string, string] | null {
    return isMixValue(saved) ? [MIX_KEY, saved] : null;
}
