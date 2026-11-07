/* New Clip adopts five Variation generators (plans/2026-11-01-generator-ux-design.md
 * §2.9): HOLD NOTE, PULSE, WALK and LOOPER from the scene's chords alone,
 * HARMONIZE and FOLLOW as a second line where another track plays a melody.
 * Each works from a seed part (create/seed-part.ts) through the Variation
 * generator itself, its knobs the New Clip layout's (§4.1), mapped by name
 * onto the generator's; a second line keeps only the notes it adds, and
 * follows the chords the melody already sets (no HARMONY). */

import type { RoleKind } from '../../ai/role.js';
import { choice, drawn, HARMONY, LINE_REGISTER as L, register, runPlan, SEED } from '../create/common.js';
import { withFeel } from '../create/feel.js';
import { patternAt, patternKnob } from '../create/pattern-knob.js';
import { asSource, otherMelody, seedPart, type SeedKind } from '../create/seed-part.js';
import type { SparseKind } from '../create/sparse.js';
import { count, custom, K, type KnobDef } from '../knobs.js';
import { defaults, knobIndex, type Preset } from '../preset.js';
import { withSeed } from '../seeded.js';
import type { PresetClass } from '../types.js';
import { BASS_MAP } from './new-lines.js';
import { HARMONIZE, PULSE } from './var-pulse.js';
import { FOLLOW } from './var-follow.js';
import { HOLD, WALK } from './var-held.js';
import { LOOPER } from './var-turing.js';

interface Spec {
    id: string; name: string; cls: PresetClass; base: Preset; seed: SeedKind; role: RoleKind;
    own: KnobDef[]; g: [number, number]; sp: SparseKind;
    /** Where the seed part sits, from the knobs by name. */
    centre: (at: (name: string) => number) => number;
    /** A knob whose position is not the base generator's: name → its position there. */
    map?: Record<string, (v: number) => number>;
}

const LINE_CENTRES = [36, 48, 60, 72, 84];
const BASS_CENTRES = [28, 40, 52, 64];

function adopt(s: Spec): Preset {
    const second = s.seed === 'melody';
    return withFeel({
        id: s.id, name: s.name, task: 'create', drum: false, cls: s.cls, knobs: s.own,
        ...(second ? { accepts: (ctx) => otherMelody(ctx).length > 0 } : {}),
        generate: (ctx, v, seed) => {
            const at = (name: string) => v[s.own.findIndex((k) => k.name === name)] ?? 0;
            const h = s.own.some((k) => k.name === 'HARMONY') ? at('HARMONY') : runPlan(ctx);
            const pk = s.own.findIndex((k) => k.name === 'PATTERN');
            const steps = pk >= 0 ? patternAt(ctx, BASS_MAP, v[pk]) : undefined;
            const src = seedPart(ctx, s.seed, h, s.centre(at), steps);
            if (!src.length) return [];
            const c2 = asSource(ctx, src, s.role, h, second);
            const d = defaults(s.base, c2);
            s.own.forEach((k, i) => { const j = knobIndex(s.base, k.name); if (j >= 0) d[j] = s.map?.[k.name]?.(v[i]) ?? v[i]; });
            const out = s.base.generate(c2, d, seed);
            if (!second) return out;
            const sung = new Set(src.map((n) => `${n.tick}.${n.pitch}`));
            return out.filter((n) => !sung.has(`${n.tick}.${n.pitch}`));
        },
    }, s.g, false, s.sp);
}

/* Takes lean on the kick as BASS's do (index LIB.length, the lock figure):
 * over real scenes PULSE and WALK took figures that met neither the kick
 * nor its gaps (paths bench leave-one-out: 54-57% as good as the real bass,
 * BASS 85%). */
const BASS_PATTERN = patternKnob(BASS_MAP, [0, 9, 9, 9, 1, 3, 4, 6, 8]);

export const HOLD_N = adopt({ id: 'n-hold', name: 'HOLD NOTE', cls: 'close', base: HOLD, seed: 'drone', role: 'drone', g: [8, 10], sp: 'pad',
    own: [choice('NOTE', ['PIVOT', 'ROOT', 'FIFTH', 'THIRD'], [1, 1, 2, 3, 0]), HARMONY, register([L.LOW, L.MID, L.MID], L.labels), choice('SHARED', ['TIE', 'RESTRIKE'], [0, 0, 1])],
    centre: (at) => LINE_CENTRES[at('REGISTER')] });

/* PULSE's takes pulse the root, the fifth one in four: on the third it
 * stands on an inversion, not a bass (leave-one-out: bc.root its top miss). */
export const PULSE_N = adopt({ id: 'n-pulse', name: 'PULSE', cls: 'rhythm', base: PULSE, seed: 'root', role: 'bass', g: [5, 9], sp: 'bass',
    own: [BASS_PATTERN, K.density(5), HARMONY, custom('OCTAVE', ['LOW', 'MIDDLE', 'HIGH', 'OCTAVE UP']),
        drawn(custom('NOTE', ['ROOT', 'FIFTH', 'THIRD']), [0, 0, 0, 1])],
    centre: () => 40 });

export const WALK_N = adopt({ id: 'n-walk', name: 'WALK', cls: 'rhythm', base: withSeed(WALK), seed: 'root', role: 'bass', g: [6, 10], sp: 'bass',
    own: [BASS_PATTERN, drawn(K.density(6), [6, 5, 6, 7]), HARMONY, choice('OCTAVE', ['DEEP', 'LOW', 'MID', 'HIGH'], [1, 1, 2]), drawn(K.tension(4), [4, 3, 5, 6]), SEED],
    centre: (at) => BASS_CENTRES[at('OCTAVE')] });

export const LOOPER_N = adopt({ id: 'n-looper', name: 'LOOPER', cls: 'exp', base: LOOPER, seed: 'line', role: 'lead', g: [2, 7], sp: 'line',
    own: [drawn(custom('LOOP', ['3', '4', '5', '6', '7', '8', '12', '16'], 5), [5, 1, 3, 4, 6, 7]), drawn(count('LOCK', 10, 6), [6, 4, 5, 7, 8]), HARMONY,
        drawn(count('SPREAD', 10, 4), [4, 2, 3, 5, 6]), drawn(custom('CLOCK', ['1/16', '1/8', '1/4'], 1), [1, 1, 0, 2]), SEED],
    centre: () => 64 });

export const HARMONIZE_N = adopt({ id: 'n-harmonize', name: 'HARMONIZE', cls: 'close', base: HARMONIZE, seed: 'melody', role: 'lead', g: [3, 8], sp: 'melody',
    /* No HARMONY: a second line is under a melody that already sets the chords (§2.8). */
    own: [drawn(custom('INTERVAL', ['3RD UP', '6TH UP', '3RD DOWN', '6TH DOWN', '10TH UP'], 2), [2, 0, 1, 2, 3, 4]), drawn(K.amount(10), [10, 6, 8, 10]),
        drawn(K.tension(4), [4, 2, 5])],
    centre: () => 64 });

export const FOLLOW_N = adopt({ id: 'n-follow', name: 'FOLLOW', cls: 'exp', base: FOLLOW, seed: 'melody', role: 'lead', g: [3, 8], sp: 'melody',
    /* RHYTHM, not DIRECTION: with the melody's own chords there is no root motion to follow.
     * DENSITY's takes thin, never fill: filled notes sounded a 2nd against the melody (layers bench). */
    own: [drawn(K.rhythm(0), [0, 0, 1, 2, 3]), drawn(K.density(5), [5, 3, 4, 5]), drawn(custom('VOICES', ['+1', '+2', '+3']), [0, 0, 1, 2]), drawn(K.tension(3), [3, 2, 4, 5])],
    /* Its added voices are the line: VOICES +1 is FOLLOW's +1 (AS IS would be the melody itself). */
    map: { VOICES: (v) => v + 2 },
    centre: () => 64 });
