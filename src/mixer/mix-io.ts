/* Reading and writing movy's summing mixer for one track.
 *
 * The engine parses `gain,pan,muted[,send1,send2]` as ONE value, so every edit
 * is a read-modify-write of the whole thing — writing a single field would
 * discard whatever the set file had restored into the others. The same reason
 * the volume gesture carries a tail (`track-volume.ts`).
 *
 * A host track has no movy mixer: its level is schwung's `slot:volume`, which
 * Move's own fader reads too, and it has no pan and no sends at all. */

import { setChainParam } from '../chain/set-param.js';
import { MIX_KEY } from '../track/mix-persist.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';
import { portFor } from '../track/registry.js';
import { trackKind } from '../track/ref.js';
import { VOL_MAX, VOL_MIN } from './db-ladder.js';

export type MixFieldName = 'gain' | 'pan' | 'send1' | 'send2';

export interface MixVals {
    gain: number;
    pan: number;
    muted: boolean;
    send: [number, number];
}

export const PAN_MIN = -1;
export const PAN_MAX = 1;
export const SEND_MAX = 1;

/* The lane ranges, and deliberately the same three the engine denormalizes with
 * (`MixField::denorm` in engine/crates/movy-dsp/src/mixer.rs). A lane that
 * scaled differently from the knob would make an automated value jump the
 * moment the knob was released. */
export const FIELD_RANGE: Record<MixFieldName, { min: number; max: number; type: string }> = {
    gain:  { min: VOL_MIN, max: VOL_MAX, type: 'float' },
    pan:   { min: PAN_MIN, max: PAN_MAX, type: 'float' },
    send1: { min: 0,       max: SEND_MAX, type: 'float' },
    send2: { min: 0,       max: SEND_MAX, type: 'float' },
};

/** Knob position → field. Line 2 is blank, hence four entries. */
export const FIELD_AT: MixFieldName[] = ['gain', 'pan', 'send1', 'send2'];

export function defaultMix(): MixVals {
    return { gain: 1, pan: 0, muted: false, send: [0, 0] };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function parseMixValue(raw: string | null): MixVals {
    const m = defaultMix();
    if (!raw) return m;
    const f = raw.split(',');
    if (f.length !== 3 && f.length !== 5) return m;
    const num = (s: string, d: number) => {
        const v = parseFloat(s);
        return Number.isFinite(v) ? v : d;
    };
    m.gain = clamp(num(f[0], 1), VOL_MIN, VOL_MAX);
    m.pan = clamp(num(f[1], 0), PAN_MIN, PAN_MAX);
    m.muted = f[2].trim() !== '0';
    if (f.length === 5) {
        m.send = [clamp(num(f[3], 0), 0, SEND_MAX), clamp(num(f[4], 0), 0, SEND_MAX)];
    }
    return m;
}

/** Always five fields: the engine accepts three for a legacy set, but there is
 *  no reason to write one. */
export function packMixValue(v: MixVals): string {
    return [v.gain.toFixed(4), v.pan.toFixed(4), v.muted ? '1' : '0',
            v.send[0].toFixed(4), v.send[1].toFixed(4)].join(',');
}

export function readMix(track: number): MixVals {
    const port = portFor(track);
    if (trackKind(track) === 'host') {
        /* No mixer, no pan, no sends — only schwung's slot fader. */
        const raw = port.getParam('slot:volume');
        const g = raw === null ? NaN : parseFloat(raw);
        return { ...defaultMix(), gain: Number.isFinite(g) ? clamp(g, VOL_MIN, VOL_MAX) : 1 };
    }
    return parseMixValue(port.getParam(MIX_KEY));
}

/** Write one field, carrying the rest of `v` unchanged. `before` is the packed
 *  value the edit started from, so undo records the same shape the edit wrote —
 *  the engine rejects a partial value, and an inverse it rejects is an undo
 *  that silently does nothing. */
export function writeMix(track: number, v: MixVals, before: string | null): void {
    const port = portFor(track);
    if (trackKind(track) === 'host') {
        setChainParam(port, 'slot:volume', v.gain.toFixed(4), before);
        return;
    }
    setChainParam(port, MIX_KEY, packMixValue(v), before);
    /* A movy track's level lives in movy's own set blob; nothing else marks it. */
    markUiStateDirty();
}

/** Amplitude as the fader reads it. Index 0 on the ladder is true silence. */
export function formatDb(amp: number): string {
    if (amp <= 0) return '-INF';
    return (20 * Math.log10(amp)).toFixed(1) + ' dB';
}

/** Live's own notation: C, L100, R42. */
export function formatPan(pan: number): string {
    const p = Math.round(Math.abs(pan) * 100);
    if (p === 0) return 'C';
    return (pan < 0 ? 'L' : 'R') + p;
}

export function formatSend(level: number): string {
    return level <= 0 ? 'OFF' : formatDb(level);
}
