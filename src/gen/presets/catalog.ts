/* Every generator, in one list: the selector draws from it (select.ts), the
 * knob property test walks it (browser-test/logic/gen-presets.mjs). */

import type { Preset } from '../preset.js';
import { withSeed } from '../seeded.js';
import { ARP, DEVELOP } from './var-arp.js';
import { FOLLOW } from './var-follow.js';
import { BASSLINE } from './var-bass.js';
import { STYLE, STYLE_D } from './var-style.js';
import { LOOPER } from './var-turing.js';
import { FORM, FORM_D } from './var-form.js';
import { HARMONIZE, PULSE } from './var-pulse.js';
import { ANSWER, NEWLINE, NEXT, REVOICE, SPREAD } from './var-close.js';
import { HALFTIME, MOTIF, ORNAMENT, REGISTER, RETRO } from './var-exp.js';
import { DRONE, OCTAVE, PEDAL, THIN, WALK } from './var-held.js';
import { COMP, EUCLID, RECOMBINE } from './var-pattern.js';
import { ANTICIPATE, CONNECT, DISPLACE } from './var-rhythm.js';
import { FILL, GHOSTS, HATS, KICK, SHIFT, TURN } from './var-drums.js';
import { DEVELOP_D, EUCLID_D, FEEL, GRIDS } from './var-drums-exp.js';
import { ANSWER_Q, EMBELLISH, FULL, GROOVE, SHAPED, TIDY, TIGHT } from './quant-melodic.js';
import { FILL_D, FULL_D, GHOSTS_D, GROOVE_D, TIDY_D, TIGHT_D } from './quant-drums.js';
import { CADENCE, PUSH, RUN, TURNAROUND } from './dbl-lines.js';
import { ECHO, STOP, STYLE_X, TURN_X } from './dbl-melodic.js';
import { EVOLVE } from './dbl-evolve.js';
import { CHORDS, PAD, STABS } from './new-chords.js';
import { ARP as ARP_N, BASS } from './new-lines.js';
import { COUNTER, MELODY, RIFF } from './new-melody.js';
import { PAD_EUCLID, PAD_PATTERN } from './new-drums-pad.js';
import { BROKEN, EUCLID_KIT, GROOVE as GROOVE_N, PERC } from './new-drums-kit.js';
import { BREAK_D, FILL_X, PICKUP_D, REPEAT, ROLL, STYLE_XD } from './dbl-drums.js';

const LISTED: Preset[] = [
    NEXT, FOLLOW, PULSE, HARMONIZE, REVOICE, NEWLINE, ANSWER, SPREAD, ARP, DRONE,
    BASSLINE, DISPLACE, ANTICIPATE, CONNECT, RECOMBINE, EUCLID, COMP, OCTAVE, WALK, THIN,
    MOTIF, RETRO, HALFTIME, ORNAMENT, REGISTER, PEDAL, DEVELOP, STYLE, LOOPER, FORM,
    KICK, HATS, GHOSTS, FILL, SHIFT, TURN, FEEL, GRIDS, EUCLID_D, DEVELOP_D, STYLE_D, FORM_D,
    TIGHT, TIDY, GROOVE, SHAPED, EMBELLISH, ANSWER_Q, FULL,
    TIGHT_D, TIDY_D, GROOVE_D, GHOSTS_D, FILL_D, FULL_D,
    TURNAROUND, CADENCE, PUSH, RUN, ECHO, STYLE_X, STOP, TURN_X, EVOLVE,
    FILL_X, PICKUP_D, ROLL, REPEAT, BREAK_D, STYLE_XD,
    /* New Clip: shown in this order, one option each. */
    CHORDS, PAD, STABS, BASS, ARP_N, MELODY, RIFF, COUNTER,
    PAD_EUCLID, PAD_PATTERN, GROOVE_N, EUCLID_KIT, BROKEN, PERC,
];

/* The ones that roll dice and had knobs to spare get SEED (seeded.ts). */
const SEEDED = new Set(['v-connect', 'v-recombine', 'v-thin', 'v-ornament', 'v-pedal', 'v-octave', 'v-walk', 'v-retro', 'd-fill',
    'q-embellish', 'xd-fill']);

export const PRESETS: Preset[] = LISTED.map((p) => (SEEDED.has(p.id) ? withSeed(p) : p));

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);
