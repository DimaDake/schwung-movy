#!/usr/bin/env node
/* fixture-ui-state.mjs — render the device fixture's ui-state.json with each
 * movy chain component's preset blob filled in from the matching slot_<N>.json.
 *
 *   node scripts/fixture-ui-state.mjs <fixture-dir>      # prints to stdout
 *
 * The fixture declares its PARAMETER values once, in schwung's own slot format:
 * `load_file` restores a schwung slot from it, and a movy chain takes the same
 * values as its `<component>:state` blob. Keeping a second copy inside
 * ui-state.json would let the two hosts drift into testing different sounds
 * while both still looked like "the fixture".
 *
 * The blob is not optional. Without it a movy chain comes up at the module's
 * shipped defaults — a fixed state only for as long as the chain is created
 * fresh, and `ChainSlots::set_chain_set` deliberately leaves a chain that
 * already holds the module alone rather than dlclosing and dlopening back to
 * where it started. So on every run after the first it would keep whatever the
 * previous suite dragged its parameters to, which is exactly the drift the
 * schwung half of the fixture exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: fixture-ui-state.mjs <fixture-dir>');
    process.exit(2);
}

const ui = JSON.parse(readFileSync(join(dir, 'ui-state.json'), 'utf8'));

/* schwung's slot file nests the component's parameter values under
 * `chain.<component>.config.state`; the chain host serves that same object as
 * `<component>:state`. */
function stateFor(track, component) {
    const slot = JSON.parse(readFileSync(join(dir, `slot_${track}.json`), 'utf8'));
    const state = slot?.chain?.[component]?.config?.state;
    if (!state) throw new Error(`slot_${track}.json has no ${component} state`);
    return JSON.stringify(state);
}

for (const t of ui.chains ?? []) {
    for (const c of t.comp ?? []) {
        /* A component the slot file does not describe is a fixture error, not a
         * chain to quietly leave at its defaults. */
        c.s = stateFor(t.t, c.c);
    }
}
process.stdout.write(JSON.stringify(ui) + '\n');
