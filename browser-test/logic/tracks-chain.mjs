/* browser-test/logic/tracks-chain.mjs — movy chain tracks: the bulk codec, the chain port, persistence, pad routing
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    portFor, appState, eq, _log, loadPerSetFlags, resetPorts,
    undoOnce, resetUndoState, resetUndoGroups, resetUndoRecord,
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
  const p = portFor(7);              // track 7 -> chain 7
  eq('movy track gets a chain port', p.track.kind, 'movy');

  /* The namespace mapping is the routing: get it wrong and edits land on
   * another track's synth. */
  p.getParam('synth:cutoff');
  eq('reads are namespaced by chain index', gets[0], 'ch7:synth:cutoff');
  p.setParam('synth:cutoff', '0.5');
  eq('writes are namespaced by chain index', sets[0][0], 'ch7:synth:cutoff');
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
  eq('getMany namespaces every key', bulk[0][2], '2\n11\nch7:synth:a11\nch7:synth:b');
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
  const { deliverChainPayloads, chainPayloadsPending, resetChainPayloads } =
    await import('../../dist/esm/track/chain-payload.js');
  const { lfoStateKeys, lfoPairs } = await import('../../dist/esm/track/lfo-persist.js');
  const { encodeBulk, decodeBulk } = await import('../../dist/esm/track/bulk.js');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');

  /* The engine, as far as this suite is concerned: one chain-set document plus
   * whatever per-chain params have been written. The document is the point —
   * the set used to be inferred by probing each component for a module id, and
   * anything the probe could not see was deleted from the set file. */
  const reads = [], writes = [], bulkGets = [], bulkSets = [];
  let engineSet = encodeBulk(['4', 'synth', 'plaits']);
  let engineVals = { 'ch4:synth:state': 'BLOB42' };

  const oG = globalThis.host_module_get_param, oS = globalThis.host_module_set_param_blocking;
  const oBG = globalThis.shadow_get_params, oBS = globalThis.shadow_set_params;

  globalThis.host_module_get_param = (k) => {
    reads.push(k);
    if (k === 'chains') return engineSet;
    return engineVals[k] ?? null;
  };
  globalThis.host_module_set_param_blocking = (k, v) => {
    writes.push([k, v]);
    if (k === 'chains') engineSet = v;
    return true;
  };
  globalThis.shadow_get_params = (slot, marker, payload) => {
    bulkGets.push(payload);
    return encodeBulk(decodeBulk(payload).map((k) => engineVals[k] ?? ''));
  };
  globalThis.shadow_set_params = (slot, marker, payload) => {
    bulkSets.push(payload);
    const flat = decodeBulk(payload);
    for (let i = 0; i + 1 < flat.length; i += 2) engineVals[flat[i]] = flat[i + 1];
    return true;
  };

  resetPorts();
  reads.length = 0; bulkGets.length = 0;
  const snap = captureChains();
  eq('the set is read from the engine, not inferred', snap.length, 1);
  eq('captured the right track', snap[0].t, 4);
  eq('captured the module', snap[0].comp[0].m, 'plaits');
  eq('captured the state blob', snap[0].comp[0].s, 'BLOB42');
  eq('the whole set costs ONE read', reads.filter((k) => k === 'chains').length, 1);
  /* Probing each component for a module id is exactly what could not see a
   * module whose load request never arrived. */
  eq('no component is probed for a module id',
     reads.filter((k) => k.endsWith('_module')).length, 0);
  eq('one loaded track costs one bulk read for its blobs', bulkGets.length, 1);

  writes.length = 0; bulkSets.length = 0;
  const n = restoreChains(snap);
  eq('restored one component', n, 1);
  eq('the whole set is ONE acknowledged write',
     writes.filter(([k]) => k === 'chains').length, 1);
  eq('and the document names the component',
     decodeBulk(writes[0][1]).join('|'), '4|synth|plaits');
  /* ── the payload is DEFERRED, and that is the fix ────────────────────────
   * The document above is what queues the module loads, and the shim services
   * the bulk channel on the same audio thread a cold `dlopen` holds — measured
   * at 428 ms for obxd. A payload written here waits out its hardcoded 100 ms
   * (shadow_ui.c, no retry), times out, and the module comes up at its shipped
   * defaults. See plans/2026-08-29-chain-payload-delivery.md. */
  eq('the payload is NOT written while the loads are draining', bulkSets.length, 0);
  eq('it is armed instead', chainPayloadsPending(), true);
  eq('and delivering it lands', deliverChainPayloads(), true);
  eq('in one bulk write per track', bulkSets.length, 1);
  eq('with nothing left outstanding', chainPayloadsPending(), false);
  {
    const flat = decodeBulk(bulkSets[0]);
    eq('the blob rides it', flat[flat.indexOf('ch4:synth:state') + 1], 'BLOB42');
  }

  /* ── the data loss, which is worse than the silent restore ───────────────
   * `lastBlob` covers a read that FAILS. It does not cover one that succeeds
   * and returns the module's defaults, which is exactly what an undelivered
   * chain answers — so the next forced save (a set switch, a teardown) wrote
   * those defaults over the user's patch. A capture taken before delivery must
   * hand back what is already on disk. */
  {
    restoreChains(snap);
    engineVals['ch4:synth:state'] = 'FACTORY-DEFAULTS';
    const mid = captureChains();
    eq('a capture before delivery does not read the live chain',
       mid[0].comp[0].s, 'BLOB42');
    deliverChainPayloads();
    eq('and the delivery put the saved blob back',
       engineVals['ch4:synth:state'], 'BLOB42');
    eq('after which the live chain is what is captured',
       captureChains()[0].comp[0].s, 'BLOB42');
  }

  /* A delivery the shim refuses is retried on the next tick rather than
   * logged and dropped — the whole defect was a caller that never looked. */
  {
    let refuse = true;
    const ok = globalThis.shadow_set_params;
    globalThis.shadow_set_params = (slot, marker, payload) =>
      refuse ? null : ok(slot, marker, payload);

    restoreChains(snap);
    engineVals['ch4:synth:state'] = 'FACTORY-DEFAULTS';
    eq('a refused delivery does not release the Set', deliverChainPayloads(), false);
    eq('and stays armed', chainPayloadsPending(), true);
    eq('so the capture is still guarded', captureChains()[0].comp[0].s, 'BLOB42');
    refuse = false;
    eq('the retry lands', deliverChainPayloads(), true);
    eq('restoring the blob', engineVals['ch4:synth:state'], 'BLOB42');

    /* A payload that will never land must not hold the splash open forever —
     * but the guard stays armed, because the set file is still the only copy
     * of the patch. */
    refuse = true;
    restoreChains(snap);
    engineVals['ch4:synth:state'] = 'FACTORY-DEFAULTS';
    let n = 0;
    while (!deliverChainPayloads()) { n++; if (n > 100) break; }
    eq('the attempts are bounded', n < 100, true);
    eq('but the capture guard survives the give-up',
       captureChains()[0].comp[0].s, 'BLOB42');

    globalThis.shadow_set_params = ok;
    resetChainPayloads();
    engineVals['ch4:synth:state'] = 'BLOB42';
  }

  /* ── the mixer level ─────────────────────────────────────────────────────
   * A movy track's volume is movy's own `mix` triple. Nothing else in the set
   * file carries it, so it was lost on every reopen — and, never being cleared,
   * the level set in one Set went on attenuating whatever the next Set loaded
   * into that chain. */
  {
    eq('a track at unity writes no mix into the set file', snap[0].mix, undefined);
    engineVals['ch4:mix'] = '1.0000,0.0000,0';
    eq('nor does an explicit unity triple', captureChains()[0].mix, undefined);

    engineVals['ch4:mix'] = '0.3162,0.0000,0';
    bulkGets.length = 0;
    const withMix = captureChains();
    eq('a moved fader is captured', withMix[0].mix, '0.3162,0.0000,0');
    eq('and rides the batch that was already being issued', bulkGets.length, 1);

    /* The restore is the half that was missing entirely: this is the chain
     * arriving in a Set that has just been opened at unity. */
    engineVals['ch4:mix'] = '1.0000,0.0000,0';
    restoreChains(withMix);
    deliverChainPayloads();
    eq('the level comes back with the chain', engineVals['ch4:mix'], '0.3162,0.0000,0');

    /* Refused whole rather than half-applied: the engine drops a malformed
     * triple, which would leave the chain at a level nothing wrote. */
    engineVals['ch4:mix'] = '1.0000,0.0000,0';
    restoreChains([{ ...withMix[0], mix: 'nonsense' }]);
    deliverChainPayloads();
    eq('a malformed mix is not written', engineVals['ch4:mix'], '1.0000,0.0000,0');

    delete engineVals['ch4:mix'];
  }

  /* ── the bug this design exists for ──────────────────────────────────────
   * A blocking write is refused when the shim cannot service it — which is
   * routine during a set open, because the shim services param writes on the
   * audio thread and a cold `dlopen` holds it for 78-276 ms. The old code threw
   * the boolean away, counted the write as restored, and the next autosave
   * wrote the shrunken set to disk. See plans/2026-08-29-chain-set-document.md. */
  {
    let refuse = 0;
    globalThis.host_module_set_param_blocking = (k, v) => {
      writes.push([k, v]);
      if (k === 'chains' && refuse > 0) { refuse--; return false; }
      if (k === 'chains') engineSet = v;
      return true;
    };

    refuse = 1;
    writes.length = 0;
    eq('a refused document is retried, not lost', restoreChains(snap), 1);
    eq('which took a second write', writes.filter(([k]) => k === 'chains').length, 2);

    refuse = 99;
    writes.length = 0;
    eq('a document that never lands reports failure', restoreChains(snap), 0);
    eq('and does not retry forever', writes.filter(([k]) => k === 'chains').length, 2);
  }
  globalThis.host_module_set_param_blocking = (k, v) => {
    writes.push([k, v]);
    if (k === 'chains') engineSet = v;
    return true;
  };

  /* A capture must never write a worse copy than it already holds: a module
   * with no preset is a track that lost its sound, and the set file is the only
   * place that blob exists. */
  {
    const keep = engineVals['ch4:synth:state'];
    delete engineVals['ch4:synth:state'];
    const again = captureChains();
    eq('a failed blob read keeps the blob we already had', again[0].comp[0].s, 'BLOB42');
    engineVals['ch4:synth:state'] = keep;
  }

  /* Unloading is the same one message: schwung clears every slot on a set
   * change before loading the new set's, and movy does it by sending the set it
   * wants, which is empty. */
  writes.length = 0;
  eq('a set with no chains restores nothing', restoreChains(null), 0);
  eq('but still sends the empty document', writes.filter(([k]) => k === 'chains').length, 1);
  eq('and the empty document is empty', writes[0][1], '0\n');
  eq('so the engine now reports an empty set', captureChains().length, 0);

  engineSet = encodeBulk(['4', 'synth', 'plaits']);

  {
    const { resetUiState } = await import('../../dist/esm/seq/ui-state.js');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    installMockFs();
    writes.length = 0;
    resetUiState();
    eq('resetUiState unloads the previous set\'s modules',
       writes.filter((w) => w[0] === 'chains' && w[1] === '0\n').length, 1);
    uninstallMockFs();
  }

  /* `resetUiState()` above modelled a Set movy had never seen, which puts
   * tracks 1-4 on movy chains. These are about a track that is NOT one, so put
   * track 0 back on its schwung slot first. */
  loadPerSetFlags({});
  resetPorts();

  /* Tolerance: older blobs have no `chains` key, and a corrupt one must not
   * throw during set load. All of these still mean "this set wants no chains". */
  eq('missing chains key restores nothing', restoreChains(undefined), 0);
  eq('non-array restores nothing', restoreChains('nope'), 0);
  eq('out-of-range track skipped', restoreChains([{ t: 99, comp: [{ c: 'synth', m: 'x' }] }]), 0);
  eq('host track index skipped', restoreChains([{ t: 0, comp: [{ c: 'synth', m: 'x' }] }]), 0);
  eq('unknown component skipped', restoreChains([{ t: 4, comp: [{ c: 'bogus', m: 'x' }] }]), 0);

  /* A malformed document from the engine must not read as "no chains" — that
   * would hand an empty set to the autosave and delete the user's work. */
  engineSet = 'garbage';
  eq('a malformed engine document captures nothing rather than guessing',
     captureChains().length, 0);
  engineSet = encodeBulk(['4', 'synth', 'plaits']);

  /* With `chtracks` on, tracks 0-3 are movy chains and their modules exist
   * ONLY inside movy's engine — schwung's set file no longer carries them. */
  {
    const { setFlag, resetFlags } = await import('../../dist/esm/seq/flags.js');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    installMockFs();
    resetFlags();
    setFlag('chtracks', 1);
    resetPorts();

    engineSet = encodeBulk(['0', 'synth', 'dexed']);
    const t1 = captureChains();
    eq('track 1 is captured once it is a movy chain', t1.length, 1);
    eq('and recorded under its TRACK index, not its chain', t1[0].t, 0);
    eq('with the module read from chain 0', t1[0].comp[0].m, 'dexed');

    writes.length = 0;
    eq('and it restores', restoreChains(t1), 1);
    eq('to chain 0', decodeBulk(writes[0][1]).join('|'), '0|synth|dexed');

    /* Off again, the same saved entry is inert rather than misdirected — a
     * track with no chain must not write to one. */
    setFlag('chtracks', 0);
    resetPorts();
    writes.length = 0;
    eq('a saved movy-track-1 chain is skipped when the flag is off',
       restoreChains(t1), 0);
    eq('and the document it sends is empty', writes[0][1], '0\n');
    /* Symmetrically: a chain the engine still holds for a track that is no
     * longer movy's is not captured into this set. */
    eq('nor is it captured', captureChains().length, 0);

    resetFlags();
    resetPorts();
    uninstallMockFs();
  }

  /* ── the chain's LFOs ride the same snapshot ──────────────────────────────
   * They live in the chain instance, not in any component's :state blob, so
   * without this a movy-track LFO assignment survived exactly until the tool
   * closed. */
  engineSet = encodeBulk(['4', 'synth', 'plaits']);
  engineVals = { 'ch4:synth:state': 'BLOB42', 'ch4:lfo1:target': 'synth',
    'ch4:lfo1:target_param': 'cutoff', 'ch4:lfo1:enabled': '1', 'ch4:lfo1:depth': '0.5000' };
  resetPorts();
  bulkGets.length = 0;
  const withLfo = captureChains();
  eq('LFO state captured', Array.isArray(withLfo[0].lfo), true);
  eq('LFO capture costs no extra round trip', bulkGets.length, 1);

  bulkSets.length = 0;
  writes.length = 0;
  restoreChains(withLfo);
  deliverChainPayloads();
  {
    const flat = decodeBulk(bulkSets[0]);
    const wrote = {};
    for (let i = 0; i + 1 < flat.length; i += 2) wrote[flat[i]] = flat[i + 1];
    eq('LFO target restored',       wrote['ch4:lfo1:target'], 'synth');
    eq('LFO target_param restored', wrote['ch4:lfo1:target_param'], 'cutoff');
    eq('LFO enabled restored',      wrote['ch4:lfo1:enabled'], '1');
    eq('LFO depth restored',        wrote['ch4:lfo1:depth'], '0.5000');
    eq('and the blob rides the same write',
       flat[flat.indexOf('ch4:synth:state') + 1], 'BLOB42');
  }
  /* A target binds to a param on a module, so the module has to be requested
   * before the LFO — the document goes first, and it is a separate write. */
  eq('the set document is written before the LFO', writes[0][0], 'chains');

  /* A track that never touched an LFO writes nothing into the set file. */
  engineVals = { 'ch4:synth:state': 'BLOB42' };
  resetPorts();
  eq('idle LFOs are not persisted', captureChains()[0].lfo, undefined);

  eq('a malformed LFO snapshot is refused whole', lfoPairs(['too', 'short']), null);
  eq('a well-formed one becomes one pair per key',
     lfoPairs(lfoStateKeys().map(() => '0')).length, lfoStateKeys().length);

  /* A set with no movy instruments must not pay for the LFO keys at all. */
  engineSet = '0\n';
  bulkGets.length = 0;
  resetPorts();
  captureChains();
  eq('an empty set reads no per-chain params', bulkGets.length, 0);

  globalThis.host_module_get_param = oG; globalThis.host_module_set_param_blocking = oS;
  globalThis.shadow_get_params = oBG; globalThis.shadow_set_params = oBS;
  resetPorts();
}

{
  _log('\ntrack volume routes by track kind:');
  const { volumeTrackDown, volumeTrackUp, volumeKnobDelta } =
    await import('../../dist/esm/mixer/track-volume.js');
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
  eq('movy track writes its mixer', movyWrite && movyWrite[1], 'ch6:mix');
  eq('mixer write is the gain,pan,mute triple',
     !!(movyWrite && /^[0-9.]+,0,0$/.test(movyWrite[2])), true);

  /* The fader has to resume from the level it last set. `ch<N>:mix` had no
   * reader in the engine — `get_param` forwarded it to the chain instance,
   * which has no such key — so every read answered null and the gesture
   * restarted at unity: turning a quiet track down put it back to 0 dB first. */
  {
    const { resetTrackVolume } = await import('../../dist/esm/mixer/track-volume.js');
    resetTrackVolume();
    writes.length = 0;
    globalThis.host_module_get_param = (k) => (k === 'ch6:mix' ? '0.3162,-0.5000,0' : null);
    volumeTrackDown(6);
    volumeKnobDelta(1);                       // one detent up from -10 dB
    const resumed = writes.find((w) => w[0] === 'movy');
    eq('the gesture resumes from the level on the chain', resumed && resumed[2],
       '0.3548,-0.5000,0');

    /* The gain is the only field on this fader, so the other two must survive
     * the write — the triple is saved state now, and zeroing pan on every turn
     * would discard what the set file just restored. */
    eq('and carries the rest of the triple through', resumed[2].endsWith(',-0.5000,0'), true);

    /* Undo writes the inverse back to the same param, so it has to be the same
     * SHAPE: a bare gain is not a triple, `parse_mix` rejects it, and undoing a
     * movy track's volume silently did nothing. */
    resetTrackVolume();
    resetUndoState(); resetUndoGroups(); resetUndoRecord();
    volumeTrackDown(6);
    volumeKnobDelta(1);
    volumeTrackUp(6);
    writes.length = 0;
    undoOnce();
    const undone = writes.find((w) => w[0] === 'movy');
    eq('undo restores the whole triple', undone && undone[2], '0.3162,-0.5000,0');
    resetTrackVolume();
  }

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
  const maps = () => sent.filter((s) => s[0] === 'padmap');
  const vels = () => sent.filter((s) => s[0] === 'padvel');

  /* A host track keeps its own pad handling: chain -1, and the UI must still
   * send its notes. */
  resetPadRoute();
  selectTrack(0);
  syncPadRoute(send);
  eq('a map is pushed for a host track', maps().length, 1);
  eq('host track pushes chain -1', maps()[0][1].split(',')[0], '-1');
  eq('the UI still owns host-track pads', engineOwnsPads(0), false);

  /* A movy track hands pads to the engine. */
  sent.length = 0;
  selectTrack(6);                       // -> chain 6
  syncPadRoute(send);
  eq('a map is pushed for a movy track', maps().length, 1);
  eq('the key is padmap', maps()[0][0], 'padmap');
  eq('it names the chain', maps()[0][1].split(',')[0], '6');
  eq('it carries 32 pad entries', maps()[0][1].split(',').length - 1, 32);
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
  eq('and the map is pushed again', maps().length, 1);

  /* Full Velocity. The engine builds the note for a movy track — the UI sends
   * none — so the toggle has to reach the engine or it changes nothing the
   * player can hear, which is how it shipped. */
  resetPadRoute();
  sent.length = 0;
  seqState.fullVelocity = false;
  syncPadRoute(send);
  eq('the first push states full velocity', vels().length, 1);
  eq('and states it off', vels()[0][1], '0');

  sent.length = 0;
  seqState.fullVelocity = true;
  syncPadRoute(send);
  eq('switching it on reaches the engine', vels().length, 1);
  eq('as padvel 1', vels()[0][1], '1');
  eq('without re-sending the unchanged map', maps().length, 0);

  sent.length = 0;
  syncPadRoute(send);
  syncPadRoute(send);
  eq('and it is not re-sent while unchanged', sent.length, 0);

  sent.length = 0;
  seqState.fullVelocity = false;
  syncPadRoute(send);
  eq('switching it off reaches the engine too', vels()[0]?.[1], '0');

  /* A re-dlopened engine knows nothing about it either. */
  seqState.fullVelocity = true;
  syncPadRoute(send);
  resetPadRoute();
  sent.length = 0;
  syncPadRoute(send);
  eq('a reset re-states full velocity', vels()[0]?.[1], '1');
  seqState.fullVelocity = false;

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
  eq('and names the chain again', (sent[0]?.[1] ?? '').split(',')[0], '6');

  resetPadRoute();
  selectTrack(0);
}

}
