/* Every generator, in one list: the selector draws from it (select.ts), the
 * knob property test walks it (browser-test/logic/gen-presets.mjs). */

import type { Preset } from '../preset.js';
import { ARP, DEVELOP } from './var-arp.js';
import { FOLLOW } from './var-follow.js';
import { BASSLINE } from './var-bass.js';
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

export const PRESETS: Preset[] = [
    NEXT, FOLLOW, PULSE, HARMONIZE, REVOICE, NEWLINE, ANSWER, SPREAD, ARP, DRONE,
    BASSLINE, DISPLACE, ANTICIPATE, CONNECT, RECOMBINE, EUCLID, COMP, OCTAVE, WALK, THIN,
    MOTIF, RETRO, HALFTIME, ORNAMENT, REGISTER, PEDAL, DEVELOP,
    KICK, HATS, GHOSTS, FILL, SHIFT, TURN, FEEL, GRIDS, EUCLID_D, DEVELOP_D,
    TIGHT, TIDY, GROOVE, SHAPED, EMBELLISH, ANSWER_Q, FULL,
    TIGHT_D, TIDY_D, GROOVE_D, GHOSTS_D, FILL_D, FULL_D,
];

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);
