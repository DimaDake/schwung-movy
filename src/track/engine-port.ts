/* What a track port addressed at movy's own engine is, minus the addressing.
 *
 * `MovyChainPort` and `EngineRootPort` differ in exactly one thing — how a
 * component key becomes an engine key. Everything else they do is the param
 * channel, and both carried a verbatim copy of it: the same blocking write with
 * the same 50 ms timeout, the same bulk read with the same "a short response is
 * not a page of empty knobs" fallback, the same bulk write. Two copies of the
 * rules for a channel whose rules are subtle is how one of them ends up a
 * version behind the other.
 *
 * So the rules live once in `host/param.ts` and the addressing lives once per
 * subclass, in `key()`. A port is now a namespace plus whatever it does with
 * MIDI — which is all a port ever was.
 */

import type { TrackPort } from './port.js';
import type { TrackRef } from './ref.js';
import { paramGet, paramGetMany, paramSet, paramSetMany } from '../host/param.js';

/* Enough history that a reader draining once a tick can never miss a key: a
 * chord, a lane sweep and a knob stream together are a handful of writes per
 * tick. Beyond it the answer is "everything", which is correct and merely
 * expensive. */
const WRITE_LOG_MAX = 128;

export abstract class EnginePort implements TrackPort {
    abstract readonly track: TrackRef;
    /* Every engine param read is a round trip through the single-slot SHM, so
     * callers that can batch must. */
    readonly bulkReads = true;

    /** A component key (`synth:cutoff`) to the engine key that addresses it. */
    protected abstract key(k: string): string;

    abstract sendMidi(statusType: number, d1: number, d2: number): void;

    /* The write log is kept in PORT-LEVEL keys — the form the caller passed and
     * the form a cache in front of this port holds — not the engine key. */
    private wseq = 0;
    private readonly wlog: string[] = [];

    /* Logged whether or not the slot accepted it. A refused write may still have
     * been taken (host/param.ts's header: the two failures are indistinguishable
     * from here), so treating it as "nothing changed" is the one direction that
     * can leave a cache holding a value the engine does not have. */
    private noteWrite(key: string): void {
        this.wseq++;
        this.wlog.push(key);
        if (this.wlog.length > WRITE_LOG_MAX) this.wlog.shift();
    }

    writeSeq(): number { return this.wseq; }

    writesSince(seq: number): string[] | null {
        const n = this.wseq - seq;
        if (n <= 0) return [];
        if (n > this.wlog.length) return null;   /* overran the log — drop it all */
        return this.wlog.slice(this.wlog.length - n);
    }

    getParam(key: string): string | null {
        return paramGet(this.key(key));
    }

    setParam(key: string, value: string): boolean {
        this.noteWrite(key);
        return paramSet(this.key(key), value);
    }

    setParamTimeout(key: string, value: string, timeoutMs: number): boolean {
        this.noteWrite(key);
        return paramSet(this.key(key), value, timeoutMs);
    }

    getMany(keys: string[]): (string | null)[] {
        return paramGetMany(keys.map((k) => this.key(k)));
    }

    setMany(pairs: [string, string][]): boolean {
        for (const [k] of pairs) this.noteWrite(k);
        return paramSetMany(pairs.map(([k, v]): [string, string] => [this.key(k), v]));
    }
}
