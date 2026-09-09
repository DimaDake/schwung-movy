/* browser-test/logic/declarations.mjs — statements a module makes that movy now
 * reads instead of guessing: `access`, `short_name`, and the value a declared
 * `focus_param` actually wants.
 *
 * All three replace a movy-side heuristic with the module's own word, which is
 * the pattern schwung's voices contract (#411) established. None of the 80
 * modules in docs/module-dump/ declares any of them — the dump predates the
 * contracts — so dump-replay proves only that nothing regressed, and the
 * coverage has to be here.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    dedupShortNames, LABEL_BUDGET, fontWidth, portFor, eq, bootModel, _log, env,
} from './harness.mjs';

export async function run() {

/* ── access: "read" — a readout ──────────────────────────────────────────── */

_log('\nTest: access "read" makes a param a readout, not a knob');
{
    const preset = {
        'synth:name': 'keydetect', 'synth_module': 'keydetect',
        'synth:chain_params': JSON.stringify([
            { key: 'detected_key', name: 'Detected Key', type: 'enum',
              options: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G'], access: 'read' },
            { key: 'sens', name: 'Sensitivity', type: 'float', min: 0, max: 1 },
            /* A FLOAT readout, because the automatable assertion below is
             * vacuous on the enum: an enum is not automatable by movy's default
             * heuristic either, so `access` could be ignored entirely and the
             * check would still pass. A float in range is automatable unless
             * something says otherwise, and here the module does. */
            { key: 'level_in', name: 'Input Level', type: 'float', min: 0, max: 1, access: 'read' },
        ]),
        'synth:detected_key': 'D', 'synth:sens': '0.5', 'synth:level_in': '0.7',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 4; i++) m.tick();
    const vm = () => m.getViewModel();

    eq('the readout reaches the ParamVM as one', vm().rows[0][0].readOnly, true);
    eq('an ordinary param is not marked', vm().rows[0][1].readOnly, undefined);
    eq('a float readout is not automatable', vm().rows[0][2].automatable, false);
    eq('its identically-typed neighbour still is', vm().rows[0][1].automatable, true);

    /* The whole point: a turn must not write. A readout's value is the module's
     * own telemetry, so scrubbing it overwrites what movy is displaying. */
    const writes = [];
    const originalSet = globalThis.shadow_set_param;
    globalThis.shadow_set_param = (_s, k, v) => { writes.push([k, v]); return true; };
    m.handleKnobDelta(0, 4); m.tick();
    eq('turning a readout writes nothing', writes.length, 0);
    m.handleKnobDelta(1, 4); m.tick();
    eq('turning its neighbour still writes', writes.length > 0, true);
    globalThis.shadow_set_param = originalSet;

    /* Eight options is past the >6 touch-to-dive threshold, so without the rule
     * this opens a picker over a value nothing can set. */
    m.handleKnobTouch(0); m.tick();
    eq('touching a readout opens no picker', vm().overlay, null);
    m.handleKnobRelease?.(0);
}

_log('\nTest: access "write" is the module declaring a trigger');
{
    /* euclidrum's rnd_preset: two options, and the first is "do nothing". movy's
     * name heuristic cannot see it — `isActionParam` needs an off/on-shaped
     * pair, and "—"/"Rnd!" is not one — so it read as an ordinary setting and a
     * knob scrub could write index 0, which the module fires on. */
    const preset = {
        'synth:name': 'euclidrum', 'synth_module': 'euclidrum',
        'synth:chain_params': JSON.stringify([
            { key: 'rnd_preset', name: 'Rnd Preset', type: 'enum',
              options: ['—', 'Rnd!'], access: 'write' },
        ]),
        'synth:rnd_preset': '—',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 4; i++) m.tick();
    const p = m.getViewModel().rows[0][0];
    eq('a declared trigger gets the badge', p.trigger, 'armed');
    eq('and is not automatable', p.automatable, false);
    eq('and is not a readout', p.readOnly, undefined);
}

_log('\nTest: an undeclared param keeps movy’s own guesses');
{
    const preset = {
        'synth:name': 'plain', 'synth_module': 'plain',
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float', min: 0, max: 1 },
        ]),
        'synth:cutoff': '0.3',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 4; i++) m.tick();
    const p = m.getViewModel().rows[0][0];
    eq('no access declared: not a readout', p.readOnly, undefined);
    eq('no access declared: still automatable', p.automatable, true);
}

/* ── short_name — the module’s own cell label ─────────────────────────── */

_log('\nTest: a declared short_name beats movy’s abbreviation');
{
    const preset = {
        'synth:name': 'shorty', 'synth_module': 'shorty',
        'synth:chain_params': JSON.stringify([
            { key: 'osc1_pitch', name: 'Osc 1 Pitch', short_name: 'Pitch', type: 'float', min: 0, max: 1 },
            { key: 'osc2_pitch', name: 'Osc 2 Pitch', type: 'float', min: 0, max: 1 },
        ]),
        'synth:osc1_pitch': '0.5', 'synth:osc2_pitch': '0.5',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 4; i++) m.tick();
    const rows = m.getViewModel().rows[0];
    eq('the declared label is drawn as typed', rows[0].shortName, 'PITCH');
    eq('the full name still names the header', rows[0].fullName, 'Osc 1 Pitch');
    eq('an undeclared sibling is still abbreviated', rows[1].shortName !== 'PITCH', true);
}

_log('\nTest: short_name precedence — the LEVEL overrides the parameter');
{
    /* The reverse of every other field: `short_name` belongs to the param, but
     * the same param sits on several pages, so a level’s inline entry wins on
     * its own page. */
    const preset = {
        'synth:name': 'lvlshort', 'synth_module': 'lvlshort',
        'synth:chain_params': JSON.stringify([
            { key: 'env_amount', name: 'Env Amount', short_name: 'EnvAm', type: 'float', min: 0, max: 1 },
        ]),
        'synth:ui_hierarchy': JSON.stringify({
            levels: { root: { knobs: ['env_amount'],
                              params: [{ key: 'env_amount', short_name: 'Amt' }] } },
        }),
        'synth:env_amount': '0.5',
    };
    const m = bootModel(preset);
    for (let i = 0; i < 4; i++) m.tick();
    eq('the level’s short_name wins on its page',
       m.getViewModel().rows[0][0].shortName, 'AMT');
}

_log('\nTest: a short_name too wide for the cell is fitted, not overflowed');
{
    /* "It is still a label" — a declaration is not a way to smuggle six
     * characters into five. The abbreviation table only gets a say here. */
    const wide = 'Resonance Amount Wide';
    const out = dedupShortNames([{ label: 'Filter Resonance', shortLabel: wide }], LABEL_BUDGET);
    eq('the drawn label fits the cell', fontWidth(out[0]) <= LABEL_BUDGET, true);
    eq('and it is not the raw declaration', out[0] !== wide.toUpperCase(), true);

    const fitting = dedupShortNames([{ label: 'Noise Level', shortLabel: 'Noise' }], LABEL_BUDGET);
    eq('one that fits is drawn exactly as typed', fitting[0], 'NOISE');
}

/* ── focus_param — what movy writes into it ─────────────────────────────── */

_log('\nTest: a declared focus_param is written a LEVEL NAME, not a pad number');
{
    const { effectiveDrumConfig } = await import('../../dist/esm/model/drum-declared.js');
    const declared = {
        layout: 'drums',
        focusParam: 'ui_voice',
        voices: [
            { note: 36, name: 'Bass Drum', level: 'bass_drum' },
            { note: 38, name: 'Snare',     level: 'snare' },
        ],
    };
    const cfg = effectiveDrumConfig(declared, null);
    eq('the focus param is adopted', cfg.currentPadParam, 'ui_voice');
    /* The WHOLE array, not two indexes: a missing field would make `[0]` throw
     * and abort the suite before any failure line is printed, which reads as a
     * pass to anything grepping the output. */
    eq('each pad focuses its own level',
       JSON.stringify(cfg.padFocusValues), '["bass_drum","snare"]');

    /* A hand-written config is the template shape: its param takes the instance
     * NUMBER, so it must not gain level names it has none of. */
    const handConfig = {
        padCount: 4, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad',
    };
    const kept = effectiveDrumConfig(null, handConfig);
    eq('a table-only rack keeps its own param', kept.currentPadParam, 'ui_current_pad');
    eq('and gains no level names', kept.padFocusValues, undefined);
}

}
