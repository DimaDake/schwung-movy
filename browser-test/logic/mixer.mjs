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

_log('\nTest: the MIX page');

{
    const { buildMixCells } = await import('../../dist/esm/mixer/mix-cells.js');

    const movy = buildMixCells({ gain: 1, pan: 0, muted: false, send: [0, 0] }, 'movy');
    eq('four cells, four blanks', movy.filter((c) => c !== null).length, 4);
    eq('the order is VOL PAN SND1 SND2',
       movy.slice(0, 4).map((c) => c.shortName).join(' '), 'VOL PAN SND1 SND2');
    eq('unity reads 0.0 dB', movy[0].displayValue, '0.0 dB');
    eq('centre pan reads C', movy[1].displayValue, 'C');
    eq('a send at zero reads OFF', movy[2].displayValue, 'OFF');
    ok('all four are automatable on a movy chain',
       movy.slice(0, 4).every((c) => c.automatable));

    const panned = buildMixCells({ gain: 0.5, pan: -1, muted: false, send: [1, 0.5] }, 'movy');
    eq('hard left reads L100', panned[1].displayValue, 'L100');
    eq('a full send reads 0.0 dB', panned[2].displayValue, '0.0 dB');
    eq('a half send reads its level in dB', panned[3].displayValue, '-6.0 dB');
    eq('a fader at half reads -6.0 dB', panned[0].displayValue, '-6.0 dB');
    ok('centre is halfway along the pan arc',
       buildMixCells({ gain: 1, pan: 0, muted: false, send: [0, 0] }, 'movy')[1].normalizedValue === 0.5);

    /* A schwung-hosted track renders inside the shim: movy never sees its audio
     * and schwung has no slot:pan, so three of the four are unreachable — not
     * unimplemented. Drawing live knobs there invites a gesture that cannot do
     * anything. */
    const host = buildMixCells({ gain: 1, pan: 0, muted: false, send: [0, 0] }, 'host');
    eq('a host track keeps its fader', host[0].shortName, 'VOL');
    ok('a host track has no pan cell', host[1] === null);
    ok('a host track has no send cells', host[2] === null && host[3] === null);
    ok('and its fader is not automatable either', !host[0].automatable);

    /* Mute is the engine's own per-track mute, so the fader still shows the
     * level it will return to. */
    const muted = buildMixCells({ gain: 0.5, pan: 0, muted: true, send: [0, 0] }, 'movy');
    eq('mute does not zero the displayed level', muted[0].displayValue, '-6.0 dB');

    eq('silence reads -INF',
       buildMixCells({ gain: 0, pan: 0, muted: false, send: [0, 0] }, 'movy')[0].displayValue, '-INF');
}

_log('\nTest: MIX page values and ranges');

{
    const { parseMixValue, packMixValue, FIELD_RANGE, FIELD_AT } =
        await import('../../dist/esm/mixer/mix-io.js');

    /* Legacy sets carry three fields. Reading one must not invent send levels. */
    const legacy = parseMixValue('0.5,-0.25,0');
    eq('a legacy triple parses', legacy.gain, 0.5);
    eq('and sends nothing', legacy.send.join(','), '0,0');
    const five = parseMixValue('0.5,-0.25,1,0.25,0.75');
    eq('a five-field value carries both sends', five.send.join(','), '0.25,0.75');
    ok('and the mute', five.muted);
    eq('a malformed value is the default', parseMixValue('nonsense').gain, 1);
    eq('a partial send pair is refused whole', parseMixValue('1,0,0,0.5').send.join(','), '0,0');
    eq('always written as five fields', packMixValue(five), '0.5000,-0.2500,1,0.2500,0.7500');

    /* These three ranges are the engine's too (MixField::denorm). A lane that
     * scaled differently from the knob would make an automated value jump the
     * moment the knob was released. */
    eq('gain spans the whole fader', FIELD_RANGE.gain.min + '..' + FIELD_RANGE.gain.max, '0..4');
    eq('pan spans left to right', FIELD_RANGE.pan.min + '..' + FIELD_RANGE.pan.max, '-1..1');
    eq('a send spans off to unity', FIELD_RANGE.send1.min + '..' + FIELD_RANGE.send1.max, '0..1');
    eq('knob order matches the cells', FIELD_AT.join(' '), 'gain pan send1 send2');
}

/* ── Automating a mix param ──────────────────────────────────────────────── */

_log('\nTest: automating a mix param');

{
    const { mappingFor, applyLaneMapping, isMixTarget } =
        await import('../../dist/esm/seq/lane-mapping.js');

    /* A mix param is not a chain-host param, so the ordinary knob_<N>_set
     * mapping has nowhere to land — the lane has to be declared to movy's own
     * mixer instead. Assert the WRITE, not that a callback ran: a mapping
     * issued to the wrong key works perfectly, on nothing. */
    const writes = [];
    const w = (k, v) => { writes.push(k + '=' + v); return true; };
    const info = { target: 'mix', ioKey: 'send1', min: 0, max: 1, value: 0,
                   type: 'float', automatable: true, gi: 2, key: 'send1' };
    mappingFor(info, w)(3);
    eq('a mix param declares a mix lane', writes.join('|'), 'mixlane=3,send1');

    writes.length = 0;
    mappingFor({ ...info, target: 'synth', ioKey: 'cutoff' }, w)(3);
    ok('a module param still uses the chain mapping',
       writes.includes('knob_4_set=synth:cutoff'));
    /* A lane reassigned from a send to a module param would otherwise keep
     * being swallowed by the mixer, with a lane, a label and a drawn arc all
     * saying the module param should be moving. */
    ok('and releases any mix binding the lane still carried',
       writes.indexOf('mixlane=3,-') === 0);

    /* The restore and verify paths go through the same writer, so they cannot
     * re-apply a mix lane as a chain mapping that silently does nothing. */
    writes.length = 0;
    applyLaneMapping(w, 0, 'mix:gain');
    eq('a restored mix lane is re-declared to the mixer', writes.join('|'), 'mixlane=0,gain');

    ok('a mix target is recognised from its label', isMixTarget('mix:pan'));
    ok('and a chain one is not', !isMixTarget('synth:pan'));
}

/* ── The two SEND slots on the master page ───────────────────────────────── */

_log('\nTest: master send FX slots');

{
    const { MASTER_FX_SLOTS, MASTER_LFO_INDEX, isMasterComponent, isSendComponent,
            sendBusOf, moduleReadKey } = await import('../../dist/esm/chain/config.js');

    eq('master reads SEND SEND MFX x4 LFO',
       MASTER_FX_SLOTS.map((s) => s.label).join(' '),
       'SEND 1 SEND 2 MFX 1 MFX 2 MFX 3 MFX 4 LFO');
    eq('the sends are left of MFX', MASTER_FX_SLOTS[0].componentKey, 'snd0');
    eq('MASTER_LFO_INDEX still points at the LFO',
       MASTER_FX_SLOTS[MASTER_LFO_INDEX].label, 'LFO');

    /* A send is movy's own, not schwung's master bus: routing one to a shadow
     * slot would write master_fx keys for a chain schwung does not host. */
    ok('a send is not a master component', !isMasterComponent('snd0'));
    ok('a send is a send', isSendComponent('snd0') && isSendComponent('snd1'));
    eq('and knows its bus', sendBusOf('snd1'), 1);
    eq('a track component is not a send', sendBusOf('fx1'), -1);

    /* The chain host publishes a loaded module under an underscore alias, not
     * the colon key it was set with; the engine does that translation for a
     * send, so the UI only ever says the bus. */
    eq('a send reads back through its bus key', moduleReadKey('snd0'), 'snd0:module');
    eq('a track component still uses the underscore alias', moduleReadKey('fx1'), 'fx1_module');
    eq('a master component still uses the colon key',
       moduleReadKey('master_fx:fx1'), 'master_fx:fx1:module');
}

_log('\nTest: send slot params reach the engine, not a shadow slot');

{
    const { componentPort, resetPorts } = await import('../../dist/esm/track/registry.js');

    const writes = [];
    const oSet = globalThis.shadow_set_param;
    const oMSet = globalThis.host_module_set_param_blocking;
    globalThis.shadow_set_param = (slot, k, v) => { writes.push(['shadow', k, v]); return true; };
    globalThis.host_module_set_param_blocking = (k, v) => { writes.push(['engine', k, v]); return true; };
    resetPorts();

    /* The component key already names the destination, so the port must pass it
     * through UNCHANGED. A prefixing port would ask for `snd0:snd0:module`, and
     * every read would answer nothing — which renders a loaded send as an empty
     * slot. */
    componentPort(0, 'snd0').setParam('snd0:module', 'reverb');
    eq('a send load goes to movy\'s engine', writes[0] && writes[0][0], 'engine');
    eq('under the bus key, not a doubled one', writes[0] && writes[0][1], 'snd0:module');

    writes.length = 0;
    componentPort(0, 'master_fx:fx1').setParam('module', 'reverb');
    eq('a master FX slot still goes to a shadow slot', writes[0] && writes[0][0], 'shadow');

    writes.length = 0;
    componentPort(1, 'snd1').setParam('snd1:chain_params', '[]');
    eq('bus 2 is addressed as snd1', writes[0] && writes[0][1], 'snd1:chain_params');
    eq('and never through a track port', writes[0] && writes[0][0], 'engine');

    globalThis.shadow_set_param = oSet;
    globalThis.host_module_set_param_blocking = oMSet;
    resetPorts();
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

_log('\nTest: mixer persistence');

{
    const { packMix, mixPair } = await import('../../dist/esm/track/mix-persist.js');

    /* An untouched track must still write nothing, or every set file grows
     * sixteen default values. */
    eq('a default mix is not saved', packMix('1.0000,0.0000,0,0.0000,0.0000'), undefined);
    eq('a legacy default is not saved either', packMix('1.0000,0.0000,0'), undefined);
    eq('a send alone is worth saving',
       packMix('1.0000,0.0000,0,0.5000,0.0000'), '1.0000,0.0000,0,0.5000,0.0000');
    eq('so is a pan', packMix('1.0000,-0.5000,0,0.0000,0.0000'), '1.0000,-0.5000,0,0.0000,0.0000');

    /* Refused whole rather than half-applied: the engine parses the value as a
     * unit, and a mix it rejects leaves the chain at a level nothing wrote. */
    ok('a legacy triple still restores', mixPair('0.5000,0.0000,0') !== null);
    ok('a five-field value restores', mixPair('0.5000,0.0000,0,0.2500,0.0000') !== null);
    eq('a partial send pair is refused whole', mixPair('0.5000,0.0000,0,0.25'), null);
    eq('and so is a non-numeric one', mixPair('x,0,0,0,0'), null);
}

_log('\nTest: send persistence');

{
    const { sendsFromDoc, sendTriples, sendDocSlot, busOfDocSlot, sendPayloadPairs } =
        await import('../../dist/esm/track/send-persist.js');
    const { MOVY_CHAINS } = await import('../../dist/esm/track/ref.js');

    /* On the wire a send rides the same slot-generic chain-set document, above
     * every track — the engine expects a bus at MOVY_CHAINS + n. */
    eq('bus 0 is the slot above every chain', sendDocSlot(0), MOVY_CHAINS);
    eq('and bus 1 the one after', sendDocSlot(1), MOVY_CHAINS + 1);
    eq('a track slot is not a bus', busOfDocSlot(7), -1);
    eq('a bus slot is', busOfDocSlot(MOVY_CHAINS + 1), 1);
    eq('and one past the last bus is not', busOfDocSlot(MOVY_CHAINS + 2), -1);

    const doc = [String(MOVY_CHAINS), 'fx1', 'reverb', '7', 'synth', 'plaits'];
    const sends = sendsFromDoc(doc);
    eq('the sends are picked out of the document', sends.length, 1);
    eq('with their bus and module', sends[0].b + ':' + sends[0].m, '0:reverb');

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
