/* browser-test/logic/tracks-refs.mjs — 16 tracks: refs, ports, state addressing, group focus and navigation
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    readFileSync, readdirSync, portFor, trackRef, TRACK_COUNT, appState,
    eq, _log,
} from './harness.mjs';

export async function run() {
/* ── 16 tracks: refs, ports and state addressing ────────────────────────── */

{
  _log('\ntrack refs — index arithmetic:');
  const { trackRef, trackGroup, trackIndexInGroup, trackKind, chainInstance, HOST_TRACKS } =
    await import('../../dist/esm/track/ref.js');

  eq('track 0 is host', trackKind(0), 'host');
  eq('track 3 is host', trackKind(3), 'host');
  /* Stage 1 ships with TRACK_COUNT=4, but the predicate is what Stage 2 turns
   * on — so it is specified now and tested now. */
  eq('track 4 is movy', trackKind(4), 'movy');
  eq('track 15 is movy', trackKind(15), 'movy');

  eq('group of track 0', trackGroup(0), 0);
  eq('group of track 3', trackGroup(3), 0);
  eq('group of track 4', trackGroup(4), 1);
  eq('group of track 15', trackGroup(15), 3);

  eq('index-in-group of 0', trackIndexInGroup(0), 0);
  eq('index-in-group of 5', trackIndexInGroup(5), 1);
  eq('index-in-group of 15', trackIndexInGroup(15), 3);

  /* Chain instances are movy-side only and 0-based: track 4 is the FIRST movy
   * chain, not the fifth. Getting this offset wrong would address the wrong
   * synth on every movy track. */
  eq('chain instance of track 4', chainInstance(4), 0);
  eq('chain instance of track 15', chainInstance(15), 11);
  eq('host tracks have no chain instance', chainInstance(3), -1);

  const r = trackRef(6);
  eq('trackRef carries index', r.index, 6);
  eq('trackRef carries kind', r.kind, 'movy');
  eq('HOST_TRACKS is 4', HOST_TRACKS, 4);
}

{
  _log('\ntrack ports — host port wraps the shadow API:');
  const { portFor, resetPorts } = await import('../../dist/esm/track/registry.js');

  const gets = [], sets = [], midi = [];
  const origGet = globalThis.shadow_get_param;
  const origSet = globalThis.shadow_set_param;
  const origMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_get_param = (slot, key) => { gets.push([slot, key]); return 'v:' + key; };
  globalThis.shadow_set_param = (slot, key, val) => { sets.push([slot, key, val]); return true; };
  globalThis.shadow_send_midi_to_dsp = (m) => { midi.push(m.slice()); };

  resetPorts();
  const p2 = portFor(2);

  eq('port knows its track', p2.track.index, 2);
  eq('port knows its kind', p2.track.kind, 'host');

  eq('getParam returns the value', p2.getParam('synth:cutoff'), 'v:synth:cutoff');
  eq('getParam addressed the right slot', gets[0][0], 2);
  eq('getParam passed the key through', gets[0][1], 'synth:cutoff');

  p2.setParam('synth:cutoff', '0.5');
  eq('setParam addressed the right slot', sets[0][0], 2);
  eq('setParam passed key/value', sets[0][1] + '=' + sets[0][2], 'synth:cutoff=0.5');

  /* getMany is one call per key for a host track — the batching only pays off
   * for movy chains. What matters here is that the ORDER of results matches the
   * order of keys, because callers index into it positionally. */
  gets.length = 0;
  const many = p2.getMany(['a', 'b', 'c']);
  eq('getMany returns one result per key', many.length, 3);
  eq('getMany preserves order', many.join(','), 'v:a,v:b,v:c');
  eq('getMany issued one get per key', gets.length, 3);

  /* The channel is the port's job: a caller passes the TYPE nibble only. */
  p2.sendMidi(0x90, 60, 100);
  eq('sendMidi ORs in the track channel', midi[0][0], 0x92);
  eq('sendMidi passes pitch', midi[0][1], 60);
  eq('sendMidi passes velocity', midi[0][2], 100);

  /* Ports are cached: rebuilding one per call would allocate on every param
   * read, and reads happen per tick. */
  eq('portFor caches', portFor(2) === p2, true);

  globalThis.shadow_get_param = origGet;
  globalThis.shadow_set_param = origSet;
  globalThis.shadow_send_midi_to_dsp = origMidi;
  resetPorts();
}

{
  _log('\nmodel state — reads go through the port:');
  const { createModelState } = await import('../../dist/esm/model/state.js');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');

  const gets = [];
  const origGet = globalThis.shadow_get_param;
  globalThis.shadow_get_param = (slot, key) => { gets.push([slot, key]); return '0.25'; };

  resetPorts();
  const s = createModelState(portFor(1), 'synth');
  eq('state carries the port', s.port.track.index, 1);
  /* activeSlot is gone: an alias would have let half the codebase keep the
   * slot assumption alive straight through Stage 2. */
  eq('state has no activeSlot', 'activeSlot' in s, false);

  /* The point of the refactor: a read names a key, not a slot. */
  eq('port read reaches the right slot', s.port.getParam('synth:cutoff'), '0.25');
  eq('the slot came from the port', gets[0][0], 1);

  globalThis.shadow_get_param = origGet;
  resetPorts();
}

{
  _log('\nparam reads — nothing addresses a slot directly:');
  /* Guard, not a behaviour test. A direct shadow_get_param(slot, ...) reads
   * schwung's slot N, which for a MOVY track is a completely different track's
   * chain — it compiles, passes on tracks 1-4, and silently returns the wrong
   * synth's values on tracks 5-16. That is the bug this abstraction exists to
   * prevent, and it is far cheaper to catch here than on device.
   *
   * Originally scoped to src/model/, which let 25 reads survive in browser/,
   * undo/, lfo/, mixer/ and app/ until they were found by hand. Now the whole
   * tree is checked. */
  const walkTs = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = dir + '/' + e.name;
    return e.isDirectory() ? walkTs(full) : (full.endsWith('.ts') ? [full] : []);
  });
  const READ_ALLOWED = {
    'src/types/schwung.d.ts':  'the ambient declaration',
    'src/track/host-port.ts':  'the host-track door — the one place that reads a slot',
  };
  const offenders = walkTs('src')
    .filter((f) => !(f in READ_ALLOWED))
    .filter((f) => readFileSync(f, 'utf8').includes('shadow_get_param('));
  eq('no file reads params by slot: ' + offenders.join(','), offenders.length, 0);
  const staleReads = Object.keys(READ_ALLOWED)
    .filter((f) => !readFileSync(f, 'utf8').includes('shadow_get_param('));
  eq('no stale read-allowlist entries: ' + staleReads.join(','), staleReads.length, 0);
}

{
  _log('\nchain writes — the chokepoint takes a port:');
  const { setChainParam } = await import('../../dist/esm/chain/set-param.js');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');

  const sets = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (slot, key, val) => { sets.push([slot, key, val]); return true; };

  resetPorts();
  setChainParam(portFor(3), 'synth:cutoff', '0.8', '0.2');
  eq('write reached the port\'s slot', sets[0][0], 3);
  eq('write passed key', sets[0][1], 'synth:cutoff');
  eq('write passed value', sets[0][2], '0.8');

  globalThis.shadow_set_param = origSet;
  resetPorts();
}

{
  _log('\nlive MIDI — sent through the port, channel from the ledger:');
  /* The ledger rule is what this guard protects: if a call site goes back to
   * building its own status byte, it is one step from deriving the track at
   * release time, which strands notes. */
  const offenders = ['src/keyboard', 'src/seq']
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => d + '/' + f))
    .filter((f) => readFileSync(f, 'utf8').includes('shadow_send_midi_to_dsp('));
  eq('no file sends DSP MIDI directly: ' + offenders.join(','), offenders.length, 0);
}

{
  _log('\napp state — the active track is a TrackRef:');
  const { appState } = await import('../../dist/esm/app/state.js');
  eq('activeTrack exists', typeof appState.activeTrack, 'object');
  eq('activeTrack has an index', appState.activeTrack.index, 0);
  eq('activeTrack has a kind', appState.activeTrack.kind, 'host');
  /* The old field must be GONE, not aliased. */
  eq('activeSlot is removed', 'activeSlot' in appState, false);
}

{
  _log('\nseq state — 16 tracks:');
  const { seqState, resetSeqState, muteFromStr, sessionFromStr, activeFromStr, activeHasNote } =
    await import('../../dist/esm/seq/state.js');
  const { TRACK_COUNT } = await import('../../dist/esm/track/ref.js');
  resetSeqState();

  eq('TRACK_COUNT is 16', TRACK_COUNT, 16);
  eq('mute mirror sized per track', seqState.muted.length, 16);
  eq('session mirror sized per track', seqState.session.length, 16);
  eq('lastPitch sized per track', seqState.lastPitch.length, 16);

  muteFromStr('0000000000000001');
  eq('mute parses the last track', seqState.muted[15], true);
  eq('mute leaves track 0 alone', seqState.muted[0], false);

  /* 16 comma groups; only the last one carries a clip, so a parser that stops
   * at 4 silently reports an empty grid for three quarters of the song. */
  sessionFromStr(new Array(15).fill('0.-.-.0').join(',') + ',ff.2.-.3');
  eq('session parses the last track exist bitmap', seqState.session[15].exist, 0xff);
  eq('session parses the last track playing slot', seqState.session[15].playing, 2);
  eq('session parses the last track selected slot', seqState.session[15].selected, 3);

  activeFromStr(new Array(15).fill('').join(',') + ',60.64');
  eq('active notes parse on the last track', activeHasNote(15, 60), true);
  eq('active notes bounded by track', activeHasNote(14, 60), false);
  resetSeqState();
}

{
  _log('\nunbacked port — movy tracks before Stage 3:');
  const { resetPorts } = await import('../../dist/esm/track/registry.js');
  resetPorts();
  const p = portFor(7);
  eq('movy track gets a port', p.track.kind, 'movy');
  eq('reads answer empty', p.getParam('synth:cutoff'), null);
  eq('batch reads answer empty', p.getMany(['a', 'b']).join(','), ',');
  eq('writes are refused, not thrown', p.setParam('synth:cutoff', '1'), false);
  /* Must not throw: the tick loop sends note-offs to every track on teardown. */
  p.sendMidi(0x80, 60, 0);
  eq('host tracks still get a real port', portFor(0).track.kind, 'host');
  resetPorts();
}

{
  _log('\ngroup focus:');
  const { appState } = await import('../../dist/esm/app/state.js');
  const { selectTrack, focusedTrack } = await import('../../dist/esm/track/focus.js');

  selectTrack(0);
  eq('selecting track 0 focuses group 0', appState.focusGroup, 0);

  /* Selecting a track must refocus the group, or the four track buttons would
   * keep addressing a different quartet than the one on screen. */
  selectTrack(9);
  eq('selecting track 9 sets it active', appState.activeTrack.index, 9);
  eq('selecting track 9 refocuses group 2', appState.focusGroup, 2);

  eq('button 0 in group 2 is track 8', focusedTrack(0), 8);
  eq('button 3 in group 2 is track 11', focusedTrack(3), 11);

  eq('out-of-range selection ignored', (selectTrack(99), appState.activeTrack.index), 9);
  selectTrack(0);
}

{
  _log('\nsession track selector:');
  const { sessionStepLed } = await import('../../dist/esm/seq/track-select.js');
  const { TRACK_COLOR, C_BLACK, C_WHITE, ANIM_NONE, ANIM_PULSE } = await import('../../dist/esm/seq/colors.js');

  /* Every step shows its track colour; the focused group's four PULSE between
   * black and that colour. Motion carries the focus, so it does not depend on
   * one track's accent being lighter than another's. The PULSING QUAD'S
   * POSITION is what identifies the group — colour is the backup cue.
   * Third argument = the selected track; put it out of the way (12) so these
   * cases see only the group layer. */
  eq('focused step pulses from black',  sessionStepLed(4, 1, 12).base,    C_BLACK);
  eq('focused step pulses to its colour', sessionStepLed(4, 1, 12).anim,  TRACK_COLOR[4]);
  eq('focused step uses the pulse channel', sessionStepLed(4, 1, 12).channel, ANIM_PULSE);
  eq('focused group last step pulses', sessionStepLed(7, 1, 12).channel,  ANIM_PULSE);
  eq('unfocused step is solid colour', sessionStepLed(0, 1, 12).base,     TRACK_COLOR[0]);
  eq('unfocused step does not animate', sessionStepLed(0, 1, 12).channel, ANIM_NONE);
  eq('unfocused far step is solid',    sessionStepLed(15, 1, 12).base,    TRACK_COLOR[15]);
  eq('group 0 focused pulses the first quad', sessionStepLed(0, 0, 12).channel, ANIM_PULSE);

  /* The SELECTED track sits SOLID WHITE — a second layer over the group pulse,
   * and the finer answer, so it wins where both apply. Stillness is the cue:
   * everything else in the quad is pulsing, and a pulse here would have to
   * share the one animation channel with the group's, which left the two either
   * in antiphase or indistinguishable. */
  eq('selected step is white',          sessionStepLed(6, 1, 6).base,    C_WHITE);
  eq('selected step does not animate',  sessionStepLed(6, 1, 6).channel, ANIM_NONE);
  eq('selected step anim matches base', sessionStepLed(6, 1, 6).anim,    C_WHITE);

  /* Its neighbours in the same group keep the group pulse, so both cues read at
   * once — which is the whole point of two layers. */
  for (const n of [4, 5, 7]) {
      eq(`step ${n} keeps the group pulse`,    sessionStepLed(n, 1, 6).base, C_BLACK);
      eq(`step ${n} pulses to its own colour`, sessionStepLed(n, 1, 6).anim, TRACK_COLOR[n]);
  }

  /* Focus and selection genuinely come apart: the octave buttons scroll the
   * group without moving the selected track, and the selection must stay
   * visible when it does. */
  eq('selected outside the focused group is still white',
     sessionStepLed(6, 3, 6).base, C_WHITE);
  eq('and is still solid',
     sessionStepLed(6, 3, 6).channel, ANIM_NONE);

  /* selectedTrack = -1 means "do not show it". The caller passes that whenever
   * the Session button is not held, so LATCHED Session view shows only the
   * group pulse — a permanent white step is a read-out you asked for by
   * holding, not something to sit and work next to. Track 6 must then be
   * indistinguishable from its neighbours. */
  eq('no selection shown: the step falls back to the group pulse',
     sessionStepLed(6, 1, -1).base, C_BLACK);
  eq('no selection shown: it pulses to its own colour',
     sessionStepLed(6, 1, -1).anim, TRACK_COLOR[6]);
  eq('no selection shown: nothing in the row is white',
     [...Array(16).keys()].some((i) => sessionStepLed(i, 1, -1).base === C_WHITE), false);

  eq('out-of-range step is black', sessionStepLed(16, 1, 6).base, C_BLACK);
  eq('a negative step is black',   sessionStepLed(-1, 1, 6).base, C_BLACK);
}

{
  _log('\ngroup navigation affordances:');
  const { groupArrowColor } = await import('../../dist/esm/seq/buttons.js');
  const { WHITE_DIM, WHITE_OFF } = await import('../../dist/esm/seq/colors.js');
  const { selectTrack, GROUP_DIR_UP, GROUP_DIR_DOWN } = await import('../../dist/esm/track/focus.js');

  /* Same rule the bar arrows use: dim means pressable, off means travel limit.
   * Up scrolls towards track 1, so it is the dark one at the first group. */
  selectTrack(0);
  eq('at the first group, up is off', groupArrowColor(GROUP_DIR_UP), WHITE_OFF);
  eq('at the first group, down is dim', groupArrowColor(GROUP_DIR_DOWN), WHITE_DIM);
  selectTrack(15);
  eq('at the last group, down is off', groupArrowColor(GROUP_DIR_DOWN), WHITE_OFF);
  eq('at the last group, up is dim', groupArrowColor(GROUP_DIR_UP), WHITE_DIM);
  selectTrack(4);
  eq('mid groups can go both ways', groupArrowColor(GROUP_DIR_UP) === WHITE_DIM && groupArrowColor(GROUP_DIR_DOWN) === WHITE_DIM, true);
  selectTrack(0);
}

}
