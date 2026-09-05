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

/** The engine param carrying a chain's mixer state. */
export const MIX_KEY = 'mix';

interface Mix { gain: number; pan: number; muted: boolean; send: [number, number] }

/** Fields of the value, in the order the engine writes and reads them.
 *
 *  Three fields is the legacy form every set saved before sends existed
 *  carries, and it must keep restoring — at zero sends. A lone fourth field is
 *  half a pair and is refused WHOLE, exactly as `parse_mix` refuses it: a value
 *  the engine rejects would leave the chain at a level nothing wrote. */
function parseMix(value: string): Mix | null {
    const f = value.split(',');
    if (f.length !== 3 && f.length !== 5) return null;
    const gain = parseFloat(f[0]), pan = parseFloat(f[1]);
    if (!isFinite(gain) || !isFinite(pan)) return null;
    const send: [number, number] = [0, 0];
    if (f.length === 5) {
        send[0] = parseFloat(f[3]);
        send[1] = parseFloat(f[4]);
        if (!isFinite(send[0]) || !isFinite(send[1])) return null;
    }
    return { gain, pan, muted: f[2].trim() !== '0', send };
}

/** The value to save, or undefined when the track is at unity, centred, unmuted
 *  and sending nothing — an untouched track writes nothing into the set file, so
 *  an old set and a new one both restore to the same default. */
export function packMix(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string' || value === '') return undefined;
    const m = parseMix(value);
    if (!m) return undefined;
    if (m.gain === 1 && m.pan === 0 && !m.muted && m.send[0] === 0 && m.send[1] === 0) {
        return undefined;
    }
    return value;
}

/** A saved value as a write pair, or null when it is not one this build can
 *  honour — refused whole rather than half-applied, because a malformed mix
 *  the engine rejects would leave the chain at a level nothing wrote. */
export function mixPair(saved: unknown): [string, string] | null {
    if (typeof saved !== 'string' || !parseMix(saved)) return null;
    return [MIX_KEY, saved];
}
