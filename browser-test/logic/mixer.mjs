/* browser-test/logic/mixer.mjs — the dB ladder, the MIX page and send routing.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {

/* ── The dB ladder, shared by the volume gesture and the MIX page ────────── */

_log('\nTest: mixer dB ladder');

{
    const { ampToIdx, idxToAmp, volumeFrac, VOL_MAX, VOL_STEPS } =
        await import('../../dist/esm/mixer/db-ladder.js');

    /* One detent is one dB anywhere in the range. A fixed LINEAR step made the
     * quiet half of the fader five detents wide and the last one drop straight
     * to silence — reported from the field as "adjustable to about -8.5 dB,
     * then it completely cuts off the sound". */
    const unity = ampToIdx(1);
    eq('unity is an exact ladder position', idxToAmp(unity), 1);
    ok('one detent below unity is 1 dB down',
       Math.abs(20 * Math.log10(idxToAmp(unity - 1)) + 1) < 1e-6);
    eq('index 0 is true silence', idxToAmp(0), 0);
    eq('the top of the ladder is the fader maximum', idxToAmp(VOL_STEPS), VOL_MAX);
    eq('the ladder round-trips', ampToIdx(idxToAmp(30)), 30);
    ok('unity sits inside the travel', volumeFrac(1) > 0 && volumeFrac(1) < 1);
    eq('silence is the bottom of the travel', volumeFrac(0), 0);
}

/* ── The MIX chain slot ──────────────────────────────────────────────────── */

_log('\nTest: the MIX chain slot');

{
    const { CHAIN_SLOTS, LFO_CHAIN_INDEX, MIX_CHAIN_INDEX, isLfoSlot, isMixSlot, isVirtualSlot } =
        await import('../../dist/esm/chain/config.js');
    const { persistableComponents } = await import('../../dist/esm/track/chain-persist.js');

    eq('MIX is the last slot', MIX_CHAIN_INDEX, CHAIN_SLOTS.length - 1);
    ok('MIX comes after LFO', MIX_CHAIN_INDEX > LFO_CHAIN_INDEX);
    /* LFO_CHAIN_INDEX used to be `length - 1`. Appending a slot after it
     * silently retargeted every isLfoSlot() caller at MIX — including the two
     * that decide which slots hold a module at all. */
    eq('LFO is still LFO', CHAIN_SLOTS[LFO_CHAIN_INDEX].label, 'LFO');
    ok('isLfoSlot does not claim MIX', !isLfoSlot(MIX_CHAIN_INDEX));
    ok('isMixSlot does not claim LFO', !isMixSlot(LFO_CHAIN_INDEX));
    ok('MIX holds no module of its own', isVirtualSlot(CHAIN_SLOTS[MIX_CHAIN_INDEX]));

    /* A virtual slot in the persist list means every save asks the engine for a
     * module that cannot exist, and every restore tries to load "". */
    const comps = persistableComponents();
    ok('MIX is not persisted as a component', !comps.includes('mix'));
    ok('LFO is not persisted as a component', !comps.includes('lfo'));
    eq('only the four real components are', comps.length, 4);
}

/* ── The MIX page ────────────────────────────────────────────────────────── */

_log('\nTest: MIX page values and ranges');

{
    const { parseMixValue, packMixValue, isMixValue, FIELD_RANGE, FIELD_AT } =
        await import('../../dist/esm/mixer/mix-io.js');

    /* Legacy sets carry three fields. Reading one must not invent send levels. */
    const legacy = parseMixValue('0.5,-0.25,0');
    eq('a legacy triple parses', legacy.gain, 0.5);
    eq('and sends nothing', legacy.send.join(','), '0,0,0');

    /* The width every set written before send 3 existed carries. Both levels
     * must restore and the added bus must stay at zero — this is the half of
     * the compatibility that faces backwards. */
    const five = parseMixValue('0.5,-0.25,1,0.25,0.75');
    eq('a two-send value restores both', five.send.join(','), '0.25,0.75,0');
    ok('and the mute', five.muted);

    const six = parseMixValue('0.5,-0.25,1,0.25,0.75,0.5');
    eq('a full-width value carries every send', six.send.join(','), '0.25,0.75,0.5');

    eq('a malformed value is the default', parseMixValue('nonsense').gain, 1);
    /* A truncated value, never a shape movy wrote: the send block has only ever
     * grown as a unit. */
    eq('a partial send block is refused whole', parseMixValue('1,0,0,0.5').send.join(','), '0,0,0');
    ok('and a value wider than this build has buses is refused',
       !isMixValue('1,0,0,0.5,0.5,0.5,0.5'));

    /* THE downgrade rule. This string is what lands in the set file, so its
     * width decides whether a build with only two sends can still open the set
     * — and such a build refuses a value it cannot parse WHOLE, which would
     * bring the track back unmuted, at unity, at a level nobody chose. */
    eq('a set that never touched send 3 stays two-send wide',
       packMixValue(five), '0.5000,-0.2500,1,0.2500,0.7500');
    eq('and widens only once send 3 is turned up',
       packMixValue(six), '0.5000,-0.2500,1,0.2500,0.7500,0.5000');
    eq('never narrower than the two-send form',
       packMixValue(parseMixValue('0.5,-0.25,0')), '0.5000,-0.2500,0,0.0000,0.0000');

    /* These three ranges are the engine's too (MixField::denorm). A lane that
     * scaled differently from the knob would make an automated value jump the
     * moment the knob was released. */
    eq('gain spans the whole fader', FIELD_RANGE.gain.min + '..' + FIELD_RANGE.gain.max, '0..4');
    eq('pan spans left to right', FIELD_RANGE.pan.min + '..' + FIELD_RANGE.pan.max, '-1..1');
    eq('a send spans off to unity', FIELD_RANGE.send1.min + '..' + FIELD_RANGE.send1.max, '0..1');
    /* The holes are load-bearing: a knob with no field must not open an undo
     * group or claim an automation lane. */
    eq('knob order matches the cells',
       FIELD_AT.map((f) => f ?? '-').join(' '), 'gain pan - - send1 send2 send3');
}

/* ── Automating a mix param ──────────────────────────────────────────────── */

_log('\nTest: automating a mix param');

{
    const { mappingFor, bindLane, bindLanes, laneBindSpec, isMixTarget } =
        await import('../../dist/esm/seq/lane-mapping.js');

    /* A lane is bound in the engine (`ch<N>:lane`) with everything it needs to
     * write: a mix param binds to movy's own mixer, a module param to its key
     * with its range. Assert the WRITE, not that a callback ran: a bind issued
     * in the wrong form works perfectly, on nothing. */
    const writes = [];
    const w = (k, v) => { writes.push(k + '=' + v); return true; };
    const info = { target: 'mix', ioKey: 'send1', min: 0, max: 1, value: 0,
                   type: 'float', automatable: true, gi: 2, key: 'send1' };
    mappingFor(info, w)(3);
    eq('a mix param binds a mix lane', writes.join('|'), 'lane=3|m|send1');

    writes.length = 0;
    mappingFor({ ...info, target: 'synth', ioKey: 'cutoff', min: 20, max: 20000 }, w)(3);
    eq('a module param binds its key and range — one write, no CC mapping',
       writes.join('|'), 'lane=3|f|20|20000|synth:cutoff');

    /* The restore path goes through the same writer, so it cannot bind a mix
     * lane as a chain param that silently does nothing. */
    writes.length = 0;
    bindLane(w, 0, { targetParam: 'mix:gain', min: 0, max: 1, type: 'float' });
    eq('a restored mix lane is re-bound to the mixer', writes.join('|'), 'lane=0|m|gain');

    /* D14's forms: ints round, an enum by index needs only its count, an enum
     * the module reads by name carries its names. */
    const spec = (e) => laneBindSpec(31, { targetParam: 'synth:k', min: 0, max: 3, type: 'float', ...e });
    eq('int', spec({ type: 'int' }), '31|i|0|3|synth:k');
    eq('bool is a 0..1 int', spec({ type: 'bool', max: 1 }), '31|i|0|1|synth:k');
    eq('enum by index', spec({ type: 'enum', options: ['a', 'b', 'c'] }), '31|e|3|synth:k');
    eq('enum by name', spec({ type: 'enum', options: ['a', 'b, c'], wiresNames: true }), '31|n|synth:k|a|b, c');
    eq('an option holding the separator cannot bind', spec({ type: 'enum', options: ['a|b'], wiresNames: true }), null);
    eq('a key with no component cannot bind', laneBindSpec(0, { targetParam: 'cutoff', min: 0, max: 1, type: 'float' }), null);
    writes.length = 0;
    eq('a refused bind writes nothing', bindLane(w, 0, { targetParam: 'cutoff', min: 0, max: 1, type: 'float' }), false);
    eq('nothing written', writes.length, 0);

    /* A label sync binds a track's lanes in ONE write — each write is a
     * blocking round trip — and a refused lane costs only itself. */
    writes.length = 0;
    const refused = bindLanes(w, [
        { lane: 0, e: { targetParam: 'mix:gain', min: 0, max: 1, type: 'float' } },
        { lane: 1, e: { targetParam: 'nokey', min: 0, max: 1, type: 'float' } },
        { lane: 31, e: { targetParam: 'synth:x', min: 0, max: 9, type: 'int' } },
    ]);
    eq('one write for the whole track', writes.length, 1);
    eq('carrying every bindable lane', writes[0], 'lanes=0|m|gain\n31|i|0|9|synth:x');
    /* An enum lane assigned from a knob binds in the form its module reads. */
    writes.length = 0;
    mappingFor({ ...info, target: 'synth', ioKey: 'wave', type: 'enum', min: 0, max: 2,
                 options: ['Saw', 'Square', 'Tri'], wiresNames: true }, w)(5);
    eq('a name-wired enum binds its names', writes.join('|'), 'lane=5|n|synth:wave|Saw|Square|Tri');
    writes.length = 0;
    mappingFor({ ...info, target: 'synth', ioKey: 'wave', type: 'enum', min: 0, max: 2,
                 options: ['Saw', 'Square', 'Tri'], wiresNames: false }, w)(5);
    eq('an index-wired enum binds its count', writes.join('|'), 'lane=5|e|3|synth:wave');
    eq('and counting the refused one', refused, 1);
    writes.length = 0;
    bindLanes(w, []);
    eq('no lanes, no write', writes.length, 0);

    ok('a mix target is recognised from its label', isMixTarget('mix:pan'));
    ok('and a chain one is not', !isMixTarget('synth:pan'));
}

/* ── The SEND slots on the master page ────────────────────────────────────── */

_log('\nTest: master send FX slots');

{
    const { MASTER_FX_SLOTS, MASTER_LFO_INDEX, SEND_BUSES, isMasterComponent,
            isSendComponent, sendBusOf, moduleReadKey } =
        await import('../../dist/esm/chain/config.js');

    eq('master reads SEND x3, MFX x4, LFO',
       MASTER_FX_SLOTS.map((s) => s.label).join(' '),
       'SEND 1 SEND 2 SEND 3 MFX 1 MFX 2 MFX 3 MFX 4 LFO');
    /* Left of the master FX because they are left of them in the SIGNAL PATH:
     * a send's output joins movy's stereo out, which the master FX then
     * process. A bus appended after them would draw in the wrong order. */
    eq('every send is left of MFX',
       MASTER_FX_SLOTS.slice(0, SEND_BUSES).map((s) => s.componentKey).join(' '),
       'snd0 snd1 snd2');
    eq('MASTER_LFO_INDEX still points at the LFO',
       MASTER_FX_SLOTS[MASTER_LFO_INDEX].label, 'LFO');

    /* A send is movy's own, not schwung's master bus: routing one to a shadow
     * slot would write master_fx keys for a chain schwung does not host. */
    ok('a send is not a master component', !isMasterComponent('snd0'));
    ok('every bus is a send',
       Array.from({ length: SEND_BUSES }, (_, n) => isSendComponent('snd' + n)).every(Boolean));
    eq('and knows its bus', sendBusOf('snd2'), 2);
    eq('a track component is not a send', sendBusOf('fx1'), -1);
    /* `componentPort` routes on this: a key that answers a bus it does not have
     * would take a master FX slot's edits into movy's engine and drop them. */
    eq('one past the last bus is not a send', sendBusOf('snd' + SEND_BUSES), -1);
    eq('and neither is the bare prefix', sendBusOf('snd'), -1);

    /* The chain host publishes a loaded module under an underscore alias, not
     * the colon key it was set with; the engine does that translation for a
     * send, so the UI only ever says the bus. */
    eq('a send reads back through its bus key', moduleReadKey('snd0'), 'snd0:module');
    eq('a track component still uses the underscore alias', moduleReadKey('fx1'), 'fx1_module');
    eq('a master component still uses the colon key',
       moduleReadKey('mfx:fx1'), 'mfx:fx1:module');
}

_log('\nTest: send slot params reach the engine, not a shadow slot');

{
    const { componentPort, resetPorts } = await import('../../dist/esm/track/registry.js');

    const writes = [];
    const oSet = globalThis.shadow_set_param;
    const oMSet = globalThis.host_module_set_param;
    globalThis.shadow_set_param = (slot, k, v) => { writes.push(['shadow', k, v]); return true; };
    globalThis.host_module_set_param = (k, v) => { writes.push(['engine', k, v]); return true; };
    resetPorts();

    /* The component key already names the destination, so the port must pass it
     * through UNCHANGED. A prefixing port would ask for `snd0:snd0:module`, and
     * every read would answer nothing — which renders a loaded send as an empty
     * slot. */
    componentPort(0, 'snd0').setParam('snd0:module', 'reverb');
    eq('a send load goes to movy\'s engine', writes[0] && writes[0][0], 'engine');
    eq('under the bus key, not a doubled one', writes[0] && writes[0][1], 'snd0:module');

    writes.length = 0;
    componentPort(0, 'mfx:fx1').setParam('mfx:fx1:module', 'reverb');
    eq('a master FX slot goes to movy\'s engine too', writes[0] && writes[0][0], 'engine');
    eq('under its own key', writes[0] && writes[0][1], 'mfx:fx1:module');

    writes.length = 0;
    componentPort(1, 'snd1').setParam('snd1:chain_params', '[]');
    eq('bus 2 is addressed as snd1', writes[0] && writes[0][1], 'snd1:chain_params');
    eq('and never through a track port', writes[0] && writes[0][0], 'engine');

    globalThis.shadow_set_param = oSet;
    globalThis.host_module_set_param = oMSet;
    resetPorts();
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

_log('\nTest: mixer persistence');

{
    const { mixPair } = await import('../../dist/esm/track/mix-persist.js');

    /* Refused whole rather than half-applied: the engine parses the value as a
     * unit, and a mix it rejects leaves the chain at a level nothing wrote. */
    ok('a legacy triple still restores', mixPair('0.5000,0.0000,0') !== null);
    ok('a five-field value restores', mixPair('0.5000,0.0000,0,0.2500,0.0000') !== null);
    eq('a partial send pair is refused whole', mixPair('0.5000,0.0000,0,0.25'), null);
    eq('and so is a non-numeric one', mixPair('x,0,0,0,0'), null);
}

_log('\nTest: send persistence');

{
    const { sendTriples, sendDocSlot, busOfDocSlot, sendPayloadPairs } =
        await import('../../dist/esm/track/send-persist.js');
    const { MOVY_CHAINS } = await import('../../dist/esm/track/ref.js');
    const { SEND_BUSES } = await import('../../dist/esm/chain/config.js');

    /* On the wire a send rides the same slot-generic chain-set document, above
     * every track — the engine expects a bus at MOVY_CHAINS + n. */
    eq('bus 0 is the slot above every chain', sendDocSlot(0), MOVY_CHAINS);
    eq('and bus 1 the one after', sendDocSlot(1), MOVY_CHAINS + 1);
    eq('a track slot is not a bus', busOfDocSlot(7), -1);
    eq('a bus slot is', busOfDocSlot(MOVY_CHAINS + 1), 1);
    eq('and one past the last bus is not', busOfDocSlot(MOVY_CHAINS + SEND_BUSES), -1);

    eq('a saved send becomes a document triple',
       sendTriples([{ b: 1, m: 'delay' }]).join('|'), String(MOVY_CHAINS + 1) + '|fx1|delay');
    eq('an empty module is dropped', sendTriples([{ b: 0, m: '' }]).length, 0);
    eq('an impossible bus is dropped', sendTriples([{ b: 9, m: 'reverb' }]).length, 0);
    /* Two entries for one bus would queue two loads into one instance and the
     * second would win silently. */
    eq('one module per bus',
       sendTriples([{ b: 0, m: 'reverb' }, { b: 0, m: 'delay' }]).length, 3);

    eq('a blob becomes a per-bus write',
       ((sendPayloadPairs({ b: 1, m: 'delay', s: 'BLOB' }) || [])[0] || []).join('='),
       'snd1:state=BLOB');
    eq('and a send with no blob writes nothing', sendPayloadPairs({ b: 1, m: 'delay' }), null);
}

}
