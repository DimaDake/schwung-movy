/* Reading and writing movy's summing mixer for one track.
 *
 * The engine parses `gain,pan,muted[,send1..sendN]` as ONE value, so every edit
 * is a read-modify-write of the whole thing — writing a single field would
 * discard whatever the set file had restored into the others. The same reason
 * the volume gesture carries a tail (`track-volume.ts`).
 *
 * A host track has no movy mixer: its level is schwung's `slot:volume`, which
 * Move's own fader reads too, and it has no pan and no sends at all. */

import { setChainParam } from '../chain/set-param.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';
import { portFor } from '../track/registry.js';
import { trackKind } from '../track/ref.js';
import { SEND_BUSES } from '../chain/config.js';
import { VOL_MAX, VOL_MIN } from './db-ladder.js';

/* One-based, because the name is what the knob is LABELLED and the engine
 * parses the same spelling (`MixField::parse`). Written out rather than a
 * template type so that every switch over a field stays exhaustive; the count
 * is held to SEND_BUSES by a test, not by the compiler. */
export type MixFieldName = 'gain' | 'pan' | 'send1' | 'send2' | 'send3';

export interface MixVals {
    gain: number;
    pan: number;
    muted: boolean;
    send: number[];
}

/** The engine param carrying a chain's mixer state. */
export const MIX_KEY = 'mix';

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
    send3: { min: 0,       max: SEND_MAX, type: 'float' },
};

/** The field name for bus `n`, one-based on the wire. */
export function sendField(bus: number): MixFieldName {
    return ('send' + (bus + 1)) as MixFieldName;
}

/** The bus a send field drives, or -1 when the field is not a send. */
export function busOfField(field: MixFieldName): number {
    return field.startsWith('send') ? Number(field.slice(4)) - 1 : -1;
}

/* Knob position → field, with holes: VOL and PAN on line 1, every send
 * together on line 2 under encoders 5-7. The sends are a group and read as one
 * — splitting them across the two lines put SND1 beside PAN and SND3 alone
 * below it, which invites reading the first two as belonging to the fader.
 *
 * The holes are why every caller checks for `undefined` rather than trusting
 * the index: a knob with no field must not open an undo group or claim a lane. */
export const FIELD_AT: (MixFieldName | undefined)[] = [
    'gain', 'pan', undefined, undefined,
    ...Array.from({ length: SEND_BUSES }, (_, n) => sendField(n)),
];

export function defaultMix(): MixVals {
    return { gain: 1, pan: 0, muted: false, send: new Array(SEND_BUSES).fill(0) as number[] };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Field counts this build reads: no sends, the two-send width every set
 *  written before send 3 carries, and the full width. Kept as a list rather
 *  than a range because a count in between is a TRUNCATED value, never a shape
 *  movy wrote — the send block has only ever grown as a unit. The engine's
 *  `parse_mix` holds exactly the same list. */
const SEND_WIDTHS = [0, 2, SEND_BUSES];

/** Whether a value is one this build can honour WHOLE.
 *
 *  The strict half of the codec, and the same rule the engine's `parse_mix`
 *  applies: a width off the list, or a field that is not a finite number, means
 *  refuse — never half-apply. `parseMixValue` is the lenient half, for the live
 *  read where showing defaults beats showing nothing; persistence uses this one,
 *  because writing a value the engine will reject leaves a track at a level
 *  nothing chose. */
export function isMixValue(raw: unknown): raw is string {
    if (typeof raw !== 'string') return false;
    const f = raw.split(',');
    if (!SEND_WIDTHS.includes(f.length - 3)) return false;
    return f.every((x, i) => i === 2 || Number.isFinite(parseFloat(x)));
}

export function parseMixValue(raw: string | null): MixVals {
    const m = defaultMix();
    if (!raw) return m;
    const f = raw.split(',');
    if (!SEND_WIDTHS.includes(f.length - 3)) return m;
    const num = (s: string, d: number) => {
        const v = parseFloat(s);
        return Number.isFinite(v) ? v : d;
    };
    m.gain = clamp(num(f[0], 1), VOL_MIN, VOL_MAX);
    m.pan = clamp(num(f[1], 0), PAN_MIN, PAN_MAX);
    m.muted = f[2].trim() !== '0';
    /* Sends beyond what the value carries keep the default zero — a set written
     * before this bus existed must not have a level invented for it. */
    for (let i = 0; i + 3 < f.length; i++) {
        m.send[i] = clamp(num(f[i + 3], 0), 0, SEND_MAX);
    }
    return m;
}

/** The SHORTEST width that carries the truth, never narrower than the two-send
 *  form.
 *
 *  This string is what the engine stores and what `mix_persist` copies into the
 *  set file, so its width decides whether an older build can still open the
 *  set. A trailing send at zero says nothing that build does not already
 *  assume, and a value it cannot parse is refused WHOLE — the track would come
 *  back unmuted, at unity, at a level nobody chose. So a set stays readable by
 *  a two-send build right up until somebody actually turns send 3 up.
 *
 *  Never three fields: that width is only what older builds wrote, and
 *  re-emitting it would buy nothing. `mix_csv` in the engine packs to the same
 *  rule — this one is what a knob turn writes, that one is what a save reads. */
export function packMixValue(v: MixVals): string {
    let n = v.send.length;
    while (n > 2 && (v.send[n - 1] ?? 0) === 0) n--;
    const out = [v.gain.toFixed(4), v.pan.toFixed(4), v.muted ? '1' : '0'];
    for (let i = 0; i < n; i++) out.push((v.send[i] ?? 0).toFixed(4));
    return out.join(',');
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
