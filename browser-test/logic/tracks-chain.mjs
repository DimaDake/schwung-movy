/* browser-test/logic/tracks-chain.mjs — movy chain tracks: the bulk codec, the chain port, persistence, pad routing
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    portFor, appState, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── 16 tracks: the movy chain port ─────────────────────────────────────── */

{
  _log('\nbulk param codec:');
  const { encodeBulk, decodeBulk } = await import('../../dist/esm/track/bulk.js');

  /* Wire format: <count>\n then <len>\n<bytes> per item (schwung_shim.c:3440). */
  /* No delimiter after the bytes — the length IS the framing. */
  eq('encodes count then length-prefixed items',
     encodeBulk(['ab', 'cde']), '2\n2\nab3\ncde');
  eq('encodes an empty list', encodeBulk([]), '0\n');

  eq('round-trips', decodeBulk(encodeBulk(['a', 'bb', 'ccc'])).join(','), 'a,bb,ccc');
  eq('decodes empty values', decodeBulk('2\n0\n1\nx').join('|'), '|x');
  /* Number('') is 0, so a missing length must be rejected explicitly or every
   * item after it is read from the wrong offset. */
  eq('empty length field rejected', decodeBulk('1\n\nx'), null);

  /* Values containing a newline must survive: lengths are the framing, not
   * delimiters. A split-on-newline decoder would corrupt everything after. */
  eq('a value containing a newline survives',
     decodeBulk(encodeBulk(['{"a":1,\n"b":2}']))[0], '{"a":1,\n"b":2}');

  /* A malformed response must be REJECTED, not read as empty values — empties
   * would paint a whole page of zeroed knobs over the real ones. */
  eq('null payload rejected', decodeBulk(null), null);
  eq('missing header rejected', decodeBulk('garbage'), null);
  eq('truncated item rejected', decodeBulk('2\n1\na'), null);
  eq('negative length rejected', decodeBulk('1\n-1\nx'), null);
}

{
  _log('\nmovy chain port:');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');

  const gets = [], sets = [], bulk = [];
  const oG = globalThis.host_module_get_param, oS = globalThis.host_module_set_param_blocking;
  const oBG = globalThis.shadow_get_params, oBS = globalThis.shadow_set_params;
  globalThis.host_module_get_param = (k) => { gets.push(k); return 'v'; };
  globalThis.host_module_set_param_blocking = (k, v) => { sets.push([k, v]); return true; };

  resetPorts();
  const p = portFor(7);              // track 7 = movy chain 3
  eq('movy track gets a chain port', p.track.kind, 'movy');

  /* The namespace mapping is the routing: get it wrong and edits land on
   * another track's synth. */
  p.getParam('synth:cutoff');
  eq('reads are namespaced by chain index', gets[0], 'ch3:synth:cutoff');
  p.setParam('synth:cutoff', '0.5');
  eq('writes are namespaced by chain index', sets[0][0], 'ch3:synth:cutoff');
  eq('writes pass the value', sets[0][1], '0.5');

  /* getMany must be ONE round trip — that is the entire reason the bulk
   * channel is used for movy tracks. */
  globalThis.shadow_get_params = (slot, marker, payload) => {
    bulk.push([slot, marker, payload]);
    return '2\n2\n.72\n.3';   // <count>\n then <len>\n<bytes> each, no separator
  };
  gets.length = 0;
  const many = p.getMany(['synth:a', 'synth:b']);
  eq('getMany issued exactly one bulk call', bulk.length, 1);
  eq('getMany issued no individual gets', gets.length, 0);
  eq('getMany routes to the overtake DSP', bulk[0][1], 'overtake_dsp:');
  eq('getMany namespaces every key', bulk[0][2], '2\n11\nch3:synth:a11\nch3:synth:b');
  eq('getMany returns values in order', many.join(','), '.7,.3');

  /* A short/garbled response must NOT read as empty values — falling back to
   * individual reads keeps the knobs showing real numbers. */
  globalThis.shadow_get_params = () => '1\n2\n.7';
  gets.length = 0;
  const fallback = p.getMany(['synth:a', 'synth:b']);
  eq('a short bulk response falls back to individual reads', gets.length, 2);
  eq('fallback still returns a value per key', fallback.length, 2);

  globalThis.host_module_get_param = oG; globalThis.host_module_set_param_blocking = oS;
  globalThis.shadow_get_params = oBG; globalThis.shadow_set_params = oBS;
  resetPorts();
}

{
  _log('\nmovy chain persistence:');
  const { captureChains, restoreChains } = await import('../../dist/esm/track/chain-persist.js');
  const { lfoStateKeys, restoreLfoState } = await import('../../dist/esm/track/lfo-persist.js');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');

  const reads = [], writes = [];
  const oG = globalThis.host_module_get_param, oS = globalThis.host_module_set_param_blocking;
  const oBG = globalThis.shadow_get_params;
  globalThis.host_module_set_param_blocking = (k, v) => { writes.push([k, v]); return true; };
  globalThis.shadow_get_params = undefined;   // force the per-key path for clarity

  /* Only chain 0 (track 4) holds a module; every other movy track is empty. */
  globalThis.host_module_get_param = (k) => {
    reads.push(k);
    if (k === 'ch0:synth_module') return 'plaits';
    if (k === 'ch0:synth:state') return 'BLOB42';
    return null;
  };
  resetPorts();
  const snap = captureChains();
  eq('only loaded tracks are captured', snap.length, 1);
  eq('captured the right track', snap[0].t, 4);
  eq('captured the module', snap[0].comp[0].m, 'plaits');
  eq('captured the state blob', snap[0].comp[0].s, 'BLOB42');
  /* An empty track must not cost a blob read per component. */
  eq('no state read for empty components',
     reads.filter((k) => k.endsWith(':state')).length, 1);

  writes.length = 0;
  const n = restoreChains(snap);
  eq('restored one component', n, 1);
  eq('module written first', writes[0][0], 'ch0:synth:module');
  eq('state written second', writes[1][0], 'ch0:synth:state');
  eq('state value round-tripped', writes[1][1], 'BLOB42');

  /* Tolerance: older blobs have no `chains` key, and a corrupt one must not
   * throw during set load. */
  eq('missing chains key is a no-op', restoreChains(undefined), 0);
  eq('non-array is a no-op', restoreChains('nope'), 0);
  eq('out-of-range track skipped', restoreChains([{ t: 99, comp: [{ c: 'synth', m: 'x' }] }]), 0);
  eq('host track index skipped', restoreChains([{ t: 0, comp: [{ c: 'synth', m: 'x' }] }]), 0);
  eq('unknown component skipped', restoreChains([{ t: 4, comp: [{ c: 'bogus', m: 'x' }] }]), 0);

  /* ── the chain's LFOs ride the same snapshot ──────────────────────────────
   * They live in the chain instance, not in any component's :state blob, so
   * without this a movy-track LFO assignment survived exactly until the tool
   * closed. */
  const lfoAssigned = { 'ch0:synth_module': 'plaits', 'ch0:lfo1:target': 'synth',
    'ch0:lfo1:target_param': 'cutoff', 'ch0:lfo1:enabled': '1', 'ch0:lfo1:depth': '0.5000' };
  reads.length = 0;
  globalThis.host_module_get_param = (k) => { reads.push(k); return lfoAssigned[k] ?? null; };
  resetPorts();
  const withLfo = captureChains();
  eq('LFO state captured', Array.isArray(withLfo[0].lfo), true);
  eq('LFO capture costs no extra round trip',
     reads.filter((k) => k.includes(':lfo')).length, lfoStateKeys().length);

  writes.length = 0;
  restoreChains(withLfo);
  const wroteLfo = Object.fromEntries(writes.filter(([k]) => k.includes('lfo')));
  eq('LFO target restored',       wroteLfo['ch0:lfo1:target'], 'synth');
  eq('LFO target_param restored', wroteLfo['ch0:lfo1:target_param'], 'cutoff');
  eq('LFO enabled restored',      wroteLfo['ch0:lfo1:enabled'], '1');
  eq('LFO depth restored',        wroteLfo['ch0:lfo1:depth'], '0.5000');
  /* A target binds to a param on a module, so the module must be requested
   * first — otherwise the restore lands on an empty chain and is dropped. */
  const firstLfoWrite = writes.findIndex(([k]) => k.includes(':lfo'));
  const moduleWrite   = writes.findIndex(([k]) => k === 'ch0:synth:module');
  eq('modules are written before the LFO', moduleWrite < firstLfoWrite, true);

  /* A track that never touched an LFO writes nothing into the set file. */
  globalThis.host_module_get_param = (k) => (k === 'ch0:synth_module' ? 'plaits' : null);
  resetPorts();
  eq('idle LFOs are not persisted', captureChains()[0].lfo, undefined);

  eq('a malformed LFO snapshot is refused whole',
     restoreLfoState(portFor(4), ['too', 'short']), false);

  /* A set with no movy instruments must not pay for the LFO keys at all — the
   * whole reason they ride the loaded-tracks batch rather than the first one. */
  reads.length = 0;
  globalThis.host_module_get_param = (k) => { reads.push(k); return null; };
  resetPorts();
  captureChains();
  eq('an empty set reads no LFO keys', reads.filter((k) => k.includes(':lfo')).length, 0);

  globalThis.host_module_get_param = oG; globalThis.host_module_set_param_blocking = oS;
  globalThis.shadow_get_params = oBG;
  resetPorts();
}

{
  _log('\ntrack volume routes by track kind:');
  const { volumeTrackDown, volumeKnobDelta } = await import('../../dist/esm/mixer/track-volume.js');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');

  const writes = [];
  const oSet = globalThis.shadow_set_param;
  const oMSet = globalThis.host_module_set_param_blocking;
  const oGet = globalThis.host_module_get_param;
  const oSGet = globalThis.shadow_get_param;
  globalThis.shadow_set_param = (slot, k, v) => { writes.push(['host', slot, k, v]); return true; };
  globalThis.host_module_set_param_blocking = (k, v) => { writes.push(['movy', k, v]); return true; };
  globalThis.shadow_get_param = () => '1';
  globalThis.host_module_get_param = () => '1,0,0';
  resetPorts();

  /* A host track keeps schwung's slot:volume — Move's mixer reads the same
   * param, so writing anything else would desync the two. */
  volumeTrackDown(1);
  volumeKnobDelta(1);
  const hostWrite = writes.find((w) => w[0] === 'host');
  eq('host track writes slot:volume', hostWrite && hostWrite[2], 'slot:volume');

  /* A movy track has no schwung slot and no Move fader, so its level is movy's
   * own and must land on the summing mixer instead. */
  writes.length = 0;
  volumeTrackDown(6);
  volumeKnobDelta(1);
  const movyWrite = writes.find((w) => w[0] === 'movy');
  eq('movy track writes its mixer', movyWrite && movyWrite[1], 'ch2:mix');
  eq('mixer write is the gain,pan,mute triple',
     !!(movyWrite && /^[0-9.]+,0,0$/.test(movyWrite[2])), true);

  globalThis.shadow_set_param = oSet; globalThis.host_module_set_param_blocking = oMSet;
  globalThis.host_module_get_param = oGet; globalThis.shadow_get_param = oSGet;
  resetPorts();
}

{
  _log('\npad routing to the engine:');
  const { syncPadRoute, resetPadRoute, engineOwnsPads } =
    await import('../../dist/esm/track/pad-route.js');
  const { appState } = await import('../../dist/esm/app/state.js');
  const { selectTrack } = await import('../../dist/esm/track/focus.js');
  const { seqState } = await import('../../dist/esm/seq/state.js');

  const sent = [];
  const send = (k, v) => sent.push([k, v]);

  /* A host track keeps its own pad handling: chain -1, and the UI must still
   * send its notes. */
  resetPadRoute();
  selectTrack(0);
  syncPadRoute(send);
  eq('a map is pushed for a host track', sent.length, 1);
  eq('host track pushes chain -1', sent[0][1].split(',')[0], '-1');
  eq('the UI still owns host-track pads', engineOwnsPads(0), false);

  /* A movy track hands pads to the engine. */
  sent.length = 0;
  selectTrack(6);                       // movy chain 2
  syncPadRoute(send);
  eq('a map is pushed for a movy track', sent.length, 1);
  eq('the key is padmap', sent[0][0], 'padmap');
  eq('it names the chain', sent[0][1].split(',')[0], '2');
  eq('it carries 32 pad entries', sent[0][1].split(',').length - 1, 32);
  eq('the engine owns pads for that track', engineOwnsPads(6), true);
  eq('but not for a different chain', engineOwnsPads(7), false);

  /* Pushed by comparison: an unchanged map costs nothing. */
  sent.length = 0;
  syncPadRoute(send);
  syncPadRoute(send);
  eq('an unchanged map is not re-sent', sent.length, 0);

  /* A re-dlopened engine has no map; claiming otherwise leaves pads dead. */
  resetPadRoute();
  eq('after a reset the engine owns nothing', engineOwnsPads(6), false);
  sent.length = 0;
  syncPadRoute(send);
  eq('and the map is pushed again', sent.length, 1);

  /* Session view is the clip grid, not an instrument. The engine answers pads
   * from the audio thread and cannot see a UI mode, so the map has to say so —
   * otherwise launching a clip also sounds the track's synth underneath it. */
  resetPadRoute();
  selectTrack(6);
  sent.length = 0;
  syncPadRoute(send);
  eq('a movy track hands pads to the engine while playing', engineOwnsPads(6), true);
  seqState.sessionMode = true;
  sent.length = 0;
  syncPadRoute(send);
  eq('entering Session re-pushes the map', sent.length, 1);
  eq('Session hands the pads back to the UI', (sent[0]?.[1] ?? '').split(',')[0], '-1');
  eq('so a clip launch cannot sound the synth', engineOwnsPads(6), false);
  seqState.sessionMode = false;
  sent.length = 0;
  syncPadRoute(send);
  eq('leaving Session gives the pads back to the engine', engineOwnsPads(6), true);
  eq('and names the chain again', (sent[0]?.[1] ?? '').split(',')[0], '2');

  resetPadRoute();
  selectTrack(0);
}

}
