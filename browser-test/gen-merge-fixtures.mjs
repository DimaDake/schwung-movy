/* browser-test/gen-merge-fixtures.mjs — the fixtures the merge no-loss rule
 * compares on (plans/2026-11-01-generator-ux-design.md §2.7): every Set a
 * removed generator served, rebuilt from its key so the recorder and the
 * suite stand on the same ground. */

import { createInput, fixtureInput, messy, ROLES } from './gen-fixtures.mjs';

const SCENES = ['locked', 'partial', 'free'];

/** Every fixture key for one task and kind. */
export function fixtureKeys(task, drum) {
    if (task === 'create') return [`create/${drum ? 'drum' : 'melodic'}/locked/1`, `create/${drum ? 'drum' : 'melodic'}/free/1`];
    const roles = ROLES.filter((r) => (r === 'drums') === drum);
    return roles.flatMap((role) => SCENES.map((scene) => `${task === 'quantize' ? 'messy:' : ''}${role}/${scene}/${task}`));
}

/** The GenInput a key names. */
export function inputOf(key) {
    if (key.startsWith('create/')) {
        const [, kind, scene, nonce] = key.split('/');
        return createInput(kind === 'drum', scene, Number(nonce));
    }
    const m = key.startsWith('messy:');
    const [role, scene, task] = (m ? key.slice(6) : key).split('/');
    const i = fixtureInput(role, { task, scene });
    if (m) i.tracks[0].clips[0].notes = messy(i.tracks[0].clips[0].notes);
    return i;
}

/** The generators removed by the merges, and the survivors they merge into. */
export const REMOVED = ['q-tidy', 'q-groove', 'q-full', 'q-invert', 'qd-tidy', 'qd-groove', 'qd-full',
    'v-anticipate', 'v-spread', 'v-register', 'v-octave', 'v-pedal', 'v-drone', 'd-turn', 'd-euclid', 'x-turn', 'xd-pickup', 'n-groove'];
export const SURVIVORS = ['q-tight', 'qd-tight', 'q-mode', 'v-displace', 'v-revoice', 'v-bassline', 'd-fill', 'd-grids',
    'x-turnaround', 'xd-fill', 'n-drum-map', 'n-chords', 'n-pad'];
