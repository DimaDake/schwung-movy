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
    const { SEND_BUSES } = await import('../../dist/esm/chain/config.js');

    const off = () => new Array(SEND_BUSES).fill(0);
    const names = (cells) => cells.map((c) => (c ? c.shortName : '-')).join(' ');

    const movy = buildMixCells({ gain: 1, pan: 0, muted: false, send: off() }, 'movy');
    eq('a cell per field, the rest blank', movy.filter((c) => c !== null).length, 2 + SEND_BUSES);

    /* The layout itself, both rows, as one string. VOL and PAN sit alone on
     * line 1 and every send is together on line 2 under encoders 5-7: the sends
     * are a group and read as one, where splitting them put SND1 beside PAN and
     * invited reading it as part of the fader. */
    eq('line 1 is the fader, line 2 is the sends',
       names(movy), 'VOL PAN - - SND1 SND2 SND3 -');

    eq('unity reads 0.0 dB', movy[0].displayValue, '0.0 dB');
    eq('centre pan reads C', movy[1].displayValue, 'C');
    eq('a send at zero reads OFF', movy[4].displayValue, 'OFF');
    ok('every drawn cell is automatable on a movy chain',
       movy.filter((c) => c !== null).every((c) => c.automatable));

    const panned = buildMixCells({ gain: 0.5, pan: -1, muted: false, send: [1, 0.5, 0.25] }, 'movy');
    eq('hard left reads L100', panned[1].displayValue, 'L100');
    eq('a full send reads 0.0 dB', panned[4].displayValue, '0.0 dB');
    eq('a half send reads its level in dB', panned[5].displayValue, '-6.0 dB');
    eq('the third send is its own level', panned[6].displayValue, '-12.0 dB');
    eq('a fader at half reads -6.0 dB', panned[0].displayValue, '-6.0 dB');
    ok('centre is halfway along the pan arc',
       buildMixCells({ gain: 1, pan: 0, muted: false, send: off() }, 'movy')[1].normalizedValue === 0.5);

    /* A schwung-hosted track renders inside the shim: movy never sees its audio
     * and schwung has no slot:pan, so everything but the fader is unreachable —
     * not unimplemented. Drawing live knobs there invites a gesture that cannot
     * do anything. */
    const host = buildMixCells({ gain: 1, pan: 0, muted: false, send: off() }, 'host');
    eq('a host track keeps its fader, alone', names(host), 'VOL - - - - - - -');
    ok('and its fader is not automatable either', !host[0].automatable);

    /* Mute is the engine's own per-track mute, so the fader still shows the
     * level it will return to. */
    const muted = buildMixCells({ gain: 0.5, pan: 0, muted: true, send: off() }, 'movy');
    eq('mute does not zero the displayed level', muted[0].displayValue, '-6.0 dB');

    eq('silence reads -INF',
       buildMixCells({ gain: 0, pan: 0, muted: false, send: off() }, 'movy')[0].displayValue, '-INF');
}

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
    const { SEND_BUSES } = await import('../../dist/esm/chain/config.js');

    /* On the wire a send rides the same slot-generic chain-set document, above
     * every track — the engine expects a bus at MOVY_CHAINS + n. */
    eq('bus 0 is the slot above every chain', sendDocSlot(0), MOVY_CHAINS);
    eq('and bus 1 the one after', sendDocSlot(1), MOVY_CHAINS + 1);
    eq('a track slot is not a bus', busOfDocSlot(7), -1);
    eq('a bus slot is', busOfDocSlot(MOVY_CHAINS + 1), 1);
    eq('and one past the last bus is not', busOfDocSlot(MOVY_CHAINS + SEND_BUSES), -1);

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

/* ── Editing and undo ────────────────────────────────────────────────────── */

_log('\nTest: MIX page edits are undoable');

{
    const { createMixModel } = await import('../../dist/esm/mixer/mix-model.js');
    const { resetPorts } = await import('../../dist/esm/track/registry.js');
    const { takeUndoViolation } = await import('../../dist/esm/undo/record.js');
    const { FIELD_AT } = await import('../../dist/esm/mixer/mix-io.js');
    const { undoDepth, resetUndoState } = await import('../../dist/esm/undo/state.js');

    const writes = [];
    const oG = globalThis.host_module_get_param;
    const oS = globalThis.host_module_set_param_blocking;
    globalThis.host_module_get_param = (k) =>
        k === 'ch6:mix' ? '1.0000,0.0000,0,0.0000,0.0000' : (oG ? oG(k) : null);
    globalThis.host_module_set_param_blocking = (k, v) => { writes.push([k, v]); return true; };
    resetPorts();
    resetUndoState(); takeUndoViolation();

    const m = createMixModel(6);
    m.tick();

    /* `recordParamOp` logs a violation and DROPS the entry when no undo group
     * is open, so an edit with no gesture is both un-undoable and noisy. */
    /* Knob 5 is SND1 — the first encoder of line 2, per FIELD_AT. Written as
     * the lookup rather than the number so this follows the layout instead of
     * silently turning into a test of whatever knob 5 becomes next. */
    const snd1 = FIELD_AT.indexOf('send1');
    m.handleKnobTouch(snd1);
    m.handleKnobDelta(snd1, 1);
    eq('a send turn writes the mixer', writes.length > 0, true);
    eq('and writes the whole value', (writes[0][1].match(/,/g) || []).length, 4);
    eq('with no ungrouped-write violation', takeUndoViolation(), '');

    /* One gesture, one undo entry, however many detents it took. */
    m.handleKnobDelta(snd1, 1);
    m.handleKnobDelta(snd1, 1);
    m.handleKnobRelease(snd1);
    eq('a whole turn is one undo entry', undoDepth(), 1);

    globalThis.host_module_get_param = oG;
    globalThis.host_module_set_param_blocking = oS;
    resetPorts();
}

/* ── The page shows what the automation is doing ─────────────────────────── */

_log('\nTest: MIX page automation feedback');

{
    const { buildMixVM } = await import('../../dist/esm/mixer/mix-cells.js');
    const { FIELD_AT } = await import('../../dist/esm/mixer/mix-io.js');
    const { SEND_BUSES } = await import('../../dist/esm/chain/config.js');

    /* By FIELD then, not by row and column: which encoder SND1 sits under is
     * the layout's business, and these assertions are about the automation
     * decoration. Addressed positionally they would silently start testing PAN
     * the next time the page is rearranged. */
    const cellFor = (vm, field) => {
        const k = FIELD_AT.indexOf(field);
        return vm.rows[Math.floor(k / 4)][k % 4];
    };

    const vals = { gain: 1, pan: 0, muted: false, send: new Array(SEND_BUSES).fill(0) };
    const auto = (over = {}) => ({
        assignedLanes: 0, activeLanes: 0, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map(),
        laneForKey: (k) => (k === 'send1' ? 3 : -1),
        ...over,
    });

    /* Without this the page says nothing about a send you have automated: no
     * lane marker, no locked value on a held step, no arc following a take. */
    const assigned = buildMixVM({ vals, kind: 'movy', touched: [], auto: auto() });
    ok('an assigned param is marked', cellFor(assigned, 'send1').assigned);
    ok('an unassigned one is not', !cellFor(assigned, 'pan').assigned);
    ok('and it is not "automated" until a lock exists', !cellFor(assigned, 'send1').automated);

    const active = buildMixVM({ vals, kind: 'movy', touched: [],
                               auto: auto({ activeLanes: 1 << 3 }) });
    ok('a lane with locks reads as automated', cellFor(active, 'send1').automated);

    /* A held step shows THAT STEP's value. What arrives here is what
     * `buildAutomationView` produces — the lane value already denormalized on
     * the lane's own range, which for a mix lane is the control's POSITION,
     * 0..1. This test used to hand it 127, and passing a 0-127 value through a
     * second denormalization is exactly the bug that pinned every automated
     * mix knob near the bottom of its travel. */
    const held = buildMixVM({ vals, kind: 'movy', touched: [],
        auto: auto({ held: true, heldValues: new Map([[3, 1]]) }) });
    eq('a held step at the top of the lane is the top of the control',
       cellFor(held, 'send1').displayValue, '0.0 dB');
    eq('and it fills the arc', cellFor(held, 'send1').normalizedValue, 1);
    ok('and inverts the cell, like a knob touch', cellFor(held, 'send1').touched);
    ok('the page reports the hold', held.automationHeld);

    /* Half the lane is half the DECIBELS — the curve the knob walks. Read
     * linearly over the send's 0..1 amplitude this said -6.0 dB. */
    const halfway = buildMixVM({ vals, kind: 'movy', touched: [],
        auto: auto({ held: true, heldValues: new Map([[3, 0.5]]) }) });
    eq('halfway up the lane is halfway down the fader',
       cellFor(halfway, 'send1').displayValue, '-24.0 dB');

    const live = buildMixVM({ vals, kind: 'movy', touched: [],
        auto: auto({ liveValues: new Map([[3, 0.5]]) }) });
    ok('a live take moves the arc', cellFor(live, 'send1').normalizedValue > 0);

    const full = buildMixVM({ vals, kind: 'movy', touched: [], auto: auto({ poolFull: true }) });
    ok('and a full lane pool is reported', full.automationPoolFull);

    /* Two hands on the page is two readouts. Only the header toast is
     * singular; before this, the second knob's cell showed its NAME while the
     * first showed a value, which reads as one of them not responding. */
    const two = buildMixVM({ vals, kind: 'movy', touched: [FIELD_AT.indexOf('gain'),
                                                          FIELD_AT.indexOf('send1')] });
    ok('the first held knob shows its value', cellFor(two, 'gain').touched);
    ok('and so does the second', cellFor(two, 'send1').touched);
    eq('the toast follows the one touched last', two.toast.fullName, 'Send 1');
    ok('an untouched cell is unchanged', !cellFor(two, 'pan').touched);

    /* A page built without one must still render — the screenshot scenes and
     * every test above build it that way. */
    const bare = buildMixVM({ vals, kind: 'movy', touched: [] });
    ok('no automation view is not a crash', cellFor(bare, 'send1') !== null);
    ok('and nothing claims to be assigned', !cellFor(bare, 'send1').assigned);
}

/* ── Knob feel: the page travels like the pages either side of it ────────── */

_log('\nTest: MIX knob travel matches a module knob');

{
    const { createMixModel } = await import('../../dist/esm/mixer/mix-model.js');
    const { resetPorts } = await import('../../dist/esm/track/registry.js');
    const { FIELD_AT, parseMixValue } = await import('../../dist/esm/mixer/mix-io.js');
    const { CONTINUOUS_TICK_FRAC } = await import('../../dist/esm/model/constants.js');

    let mix = '1.0000,0.0000,0,0.0000,0.0000,0.0000';
    const oG = globalThis.host_module_get_param;
    const oS = globalThis.host_module_set_param_blocking;
    globalThis.host_module_get_param = (k) => (k === 'ch6:mix' ? mix : (oG ? oG(k) : null));
    globalThis.host_module_set_param_blocking = (k, v) => {
        if (k === 'ch6:mix') mix = v;
        return true;
    };
    resetPorts();

    const m = createMixModel(6);
    const reset = (v) => { mix = v; m.reloadNow(); m.tick(); };
    /* CC units spent before the value stops changing, and whether any one of
     * them was WASTED — a tick that writes nothing is the stair-step this page
     * used to have, where a small turn did nothing and then leapt a whole dB. */
    const sweep = (knob, dir) => {
        let ticks = 0, dead = 0, last = mix;
        for (let i = 0; i < 2000; i++) {
            m.handleKnobDelta(knob, dir);
            m.reloadNow(); m.tick();
            if (mix === last) { dead++; if (dead > 2) break; continue; }
            dead = 0; last = mix; ticks = i + 1;
        }
        return ticks;
    };

    /* The target: a module knob moves CONTINUOUS_TICK_FRAC of its range per CC
     * unit, so a full sweep is 1/that. Asserted against the constant rather
     * than against 200, so the two cannot drift apart silently. */
    const FULL = Math.round(1 / CONTINUOUS_TICK_FRAC);
    const near = (n, want, tol) => Math.abs(n - want) <= tol;

    const vol = FIELD_AT.indexOf('gain');
    reset('1.0000,0.0000,0,0,0,0');
    const volUp = sweep(vol, +1);
    reset('1.0000,0.0000,0,0,0,0');
    const volDown = sweep(vol, -1);
    /* The fader's travel is one range: 48 dB below unity plus 12 above. */
    ok('the fader crosses its whole travel in a module knob\'s sweep',
       near(volUp + volDown, FULL, 6), volUp + volDown + ' ticks, want ~' + FULL);

    reset('1.0000,0.0000,0,0,0,0');
    const panRight = sweep(FIELD_AT.indexOf('pan'), +1);
    ok('pan crosses half its travel in half a sweep',
       near(panRight * 2, FULL, 4), panRight * 2 + ' ticks, want ~' + FULL);

    reset('1.0000,0.0000,0,0,0,0');
    const send = sweep(FIELD_AT.indexOf('send1'), +1);
    ok('a send crosses its whole travel in a sweep',
       near(send, FULL, 4), send + ' ticks, want ~' + FULL);

    /* Every CC unit moves the value. With the old whole-detent step, seven of
     * every eight wrote nothing at all. */
    reset('1.0000,0.0000,0,0,0,0');
    let moved = 0;
    for (let i = 0; i < 20; i++) {
        const before = mix;
        m.handleKnobDelta(vol, -1);
        m.reloadNow(); m.tick();
        if (mix !== before) moved++;
    }
    eq('no CC unit is swallowed', moved, 20);

    /* The landmarks have to be reachable from wherever a set file or an
     * automation write left the value — the reason the step is snapped to the
     * grid rather than added to whatever offset it found. */
    const trajectory = (knob, dir, n) => {
        const seen = [];
        for (let i = 0; i < n; i++) {
            m.handleKnobDelta(knob, dir);
            m.reloadNow(); m.tick();
            seen.push(parseMixValue(mix));
        }
        return seen;
    };

    const pan = FIELD_AT.indexOf('pan');
    reset('1.0000,0.0730,0,0,0,0');
    ok('pan lands on exactly centre from an off-grid value',
       trajectory(pan, -1, 12).some((v) => v.pan === 0));

    reset('0.9310,0.0000,0,0,0,0');
    ok('and the fader on exactly unity',
       trajectory(FIELD_AT.indexOf('gain'), +1, 12).some((v) => v.gain === 1));

    globalThis.host_module_get_param = oG;
    globalThis.host_module_set_param_blocking = oS;
    resetPorts();
}

_log('\nTest: a send arc ends at 0 dB');

{
    const { sendFrac, volumeFrac } = await import('../../dist/esm/mixer/db-ladder.js');
    const { SEND_MAX } = await import('../../dist/esm/mixer/mix-io.js');

    /* Normalized against the FADER's travel — which runs 12 dB past unity — a
     * send at its maximum drew four fifths of an arc and read as a control that
     * had stopped early. */
    eq('a send at its maximum is a full arc', sendFrac(SEND_MAX), 1);
    eq('and off is an empty one', sendFrac(0), 0);
    ok('the fader keeps its headroom above unity', volumeFrac(1) < 1);
    ok('a send is louder than the fader at the same position',
       sendFrac(0.5) > volumeFrac(0.5));
}

}
