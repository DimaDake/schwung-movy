/* Every generator, in one list: the selector draws from it (select.ts), the
 * knob property test walks it (browser-test/logic/gen-presets.mjs). */

import type { Preset } from '../preset.js';
import { withSeed } from '../seeded.js';
import { withDrift } from '../drift.js';
import { ARP, DEVELOP } from './var-arp.js';
import { FOLLOW } from './var-follow.js';
import { BASSLINE } from './var-bass.js';
import { STYLE, STYLE_D } from './var-style.js';
import { LOOPER } from './var-turing.js';
import { FORM, FORM_D } from './var-form.js';
import { HARMONIZE, PULSE } from './var-pulse.js';
import { ANSWER, NEWLINE, NEXT, REVOICE } from './var-close.js';
import { HALFTIME, MOTIF, ORNAMENT, RETRO } from './var-exp.js';
import { HOLD, THIN, WALK } from './var-held.js';
import { COMP, EUCLID, RECOMBINE } from './var-pattern.js';
import { CONNECT, DISPLACE } from './var-rhythm.js';
import { FILL, GHOSTS, HATS, KICK, SHIFT } from './var-drums.js';
import { DEVELOP_D, FEEL, GRIDS } from './var-drums-exp.js';
import { ANSWER_Q, EMBELLISH, SHAPED, TIGHT } from './quant-melodic.js';
import { FILL_D, GHOSTS_D, TIGHT_D } from './quant-drums.js';
import { HUMANIZE, MODE, MUTATE, OCTAVES, RATCHET, SHIFT as SHIFT_Q } from './quant-mutate.js';
import { HUMANIZE_D, MUTATE_D, RATCHET_D } from './quant-mutate-drums.js';
import { CADENCE, PUSH, RUN, TURNAROUND } from './dbl-lines.js';
import { ECHO, STOP, STYLE_X } from './dbl-melodic.js';
import { EVOLVE } from './dbl-evolve.js';
import { CHORDS, PAD, STABS } from './new-chords.js';
import { ARP as ARP_N, BASS } from './new-lines.js';
import { COUNTER, MELODY, RIFF } from './new-melody.js';
import { PAD_EUCLID, PAD_PATTERN } from './new-drums-pad.js';
import { BROKEN, EUCLID_KIT, PERC } from './new-drums-kit.js';
import { DRUM_MAP } from './new-drums-map.js';
import { FOLLOW_N, HARMONIZE_N, HOLD_N, LOOPER_N, PULSE_N, WALK_N } from './new-adopted.js';
import { BREAK_D, FILL_X, REPEAT, ROLL, STYLE_XD } from './dbl-drums.js';

const LISTED: Preset[] = [
    NEXT, FOLLOW, PULSE, HARMONIZE, REVOICE, NEWLINE, ANSWER, ARP, HOLD,
    BASSLINE, DISPLACE, CONNECT, RECOMBINE, EUCLID, COMP, WALK, THIN,
    MOTIF, RETRO, HALFTIME, ORNAMENT, DEVELOP, STYLE, LOOPER, FORM,
    KICK, HATS, GHOSTS, FILL, SHIFT, FEEL, GRIDS, DEVELOP_D, STYLE_D, FORM_D,
    TIGHT, SHAPED, EMBELLISH, ANSWER_Q, MUTATE, MODE, OCTAVES, RATCHET, SHIFT_Q, HUMANIZE,
    TIGHT_D, GHOSTS_D, FILL_D, MUTATE_D, RATCHET_D, HUMANIZE_D,
    TURNAROUND, CADENCE, PUSH, RUN, ECHO, STYLE_X, STOP, EVOLVE,
    FILL_X, ROLL, REPEAT, BREAK_D, STYLE_XD,
    /* New Clip: shown in this order, one option each. */
    CHORDS, PAD, STABS, BASS, ARP_N, MELODY, RIFF, COUNTER, HOLD_N, PULSE_N, WALK_N, LOOPER_N, HARMONIZE_N, FOLLOW_N,
    PAD_EUCLID, PAD_PATTERN, DRUM_MAP, EUCLID_KIT, BROKEN, PERC,
];

/* The ones that roll dice and had knobs to spare get SEED (seeded.ts). */
const SEEDED = new Set(['v-connect', 'v-recombine', 'v-thin', 'v-ornament', 'v-hold', 'v-walk', 'v-retro', 'd-fill',
    'q-embellish', 'xd-fill']);

/* DRIFT wherever a knob is free, except on Smart Quantize, which fixes a
 * take rather than looks for one (drift.ts). */
const drifts = (p: Preset) => p.task !== 'quantize' && p.task !== 'create' && p.knobs.length < 8;

export const PRESETS: Preset[] = LISTED.map((p) => (SEEDED.has(p.id) ? withSeed(p) : p)).map((p) => (drifts(p) ? withDrift(p) : p));

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);
