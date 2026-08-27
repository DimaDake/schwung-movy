/* browser-test/logic/notes-release.mjs — the live-note ledger, release routing, teardown, and LED ownership
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    drumPadOn, drumPadOff, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    init, eq, _log, env,
} from './harness.mjs';

export async function run() {
/* ── live-note ledger ────────────────────────────────────────────────────── */

_log('\nTest: held-notes ledger');

{
  const L = await import('../../dist/esm/keyboard/held-notes.js');

  L.drainAll();
  eq('ledger starts empty', L.soundingCount(), 0);

  L.noteSounded(68, 1, 60);
  eq('records pitch', L.noteReleased(68)?.pitch, 60);
  eq('release removes it', L.soundingCount(), 0);
  eq('second release is undefined', L.noteReleased(68), undefined);

  // The owner track is what a later release must use, even if the UI has since
  // moved to another track.
  L.noteSounded(68, 1, 60);
  eq('records owner track', L.soundingTrack(68), 1);
  eq('isSounding true', L.isSounding(68), true);
  eq('isSounding false for other pad', L.isSounding(69), false);
  eq('released note carries owner track', L.noteReleased(68)?.track, 1);

  // drainAll empties everything and hands back the owners.
  L.noteSounded(68, 0, 60);
  L.noteSounded(69, 2, 64);
  const all = L.drainAll();
  eq('drainAll returns both', all.length, 2);
  eq('drainAll empties', L.soundingCount(), 0);
  eq('drainAll entry has padNote', all.find(n => n.pitch === 64)?.padNote, 69);

  // drainTrack takes only that track, leaving the rest sounding.
  L.noteSounded(68, 0, 60);
  L.noteSounded(69, 1, 64);
  L.noteSounded(70, 0, 67);
  const t0 = L.drainTrack(0);
  eq('drainTrack returns that track only', t0.length, 2);
  eq('drainTrack leaves others', L.soundingCount(), 1);
  eq('survivor is track 1', L.soundingTrack(69), 1);
  L.drainAll();
}

/* ── release routing: the ledger owns the channel ────────────────────────── */

_log('\nTest: note-off channel follows the ledger, not the active track');

{
  const L        = await import('../../dist/esm/keyboard/held-notes.js');
  const { noteOn, noteOff }        = await import('../../dist/esm/keyboard/handler.js');
  const { drumPadOn, drumPadOff }  = await import('../../dist/esm/keyboard/drum-handler.js');
  const { releaseAllLive, releaseLiveOnTrack } = await import('../../dist/esm/keyboard/release.js');

  let sentMidi = [];
  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  const origSetParam = globalThis.shadow_set_param;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  globalThis.shadow_set_param = () => true;

  const offs = () => sentMidi.filter(m => (m[0] & 0xF0) === 0x80);

  // Sound on track 1, release after the UI has moved on. The off must still go
  // to channel 1 — this is the stuck-note bug.
  L.drainAll(); sentMidi = [];
  noteOn(68, 68, 1, 100);
  eq('note-on goes to track 1', sentMidi[0][0] & 0x0F, 1);
  sentMidi = [];
  noteOff(68, 68);
  eq('one note-off', offs().length, 1);
  eq('note-off channel is the owner track', offs()[0][0] & 0x0F, 1);
  eq('ledger emptied by release', L.soundingCount(), 0);

  // releaseAllLive fans out per-note, each on its own recorded track.
  L.drainAll(); sentMidi = [];
  noteOn(68, 68, 0, 100);
  noteOn(69, 68, 2, 100);
  sentMidi = [];
  releaseAllLive();
  eq('releaseAllLive emits both offs', offs().length, 2);
  eq('offs cover both tracks', offs().map(m => m[0] & 0x0F).sort().join(','), '0,2');
  eq('releaseAllLive empties ledger', L.soundingCount(), 0);

  // releaseLiveOnTrack touches only that track.
  L.drainAll(); sentMidi = [];
  noteOn(68, 68, 0, 100);
  noteOn(69, 68, 1, 100);
  sentMidi = [];
  releaseLiveOnTrack(0);
  eq('releaseLiveOnTrack emits one off', offs().length, 1);
  eq('on the muted track', offs()[0][0] & 0x0F, 0);
  eq('other track still sounding', L.soundingCount(), 1);
  L.drainAll();

  // Drum release uses the RECORDED pitch. Swapping the module between press and
  // release used to recompute a different note (or bail) and strand it.
  const mrdReleaseCfg = { padCount: 16, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad' };
  L.drainAll(); sentMidi = [];
  drumPadOn(76, 68, false, mrdReleaseCfg, 'synth', 3, 100);   // → midiNote 40, track 3
  sentMidi = [];
  drumPadOff(76);                                                 // no config passed at all
  eq('drum off uses recorded pitch', offs()[0][1], 40);
  eq('drum off uses recorded track', offs()[0][0] & 0x0F, 3);
  eq('drum release empties ledger', L.soundingCount(), 0);

  // A shift-select drum pad never sounded, so its release emits nothing.
  L.drainAll(); sentMidi = [];
  drumPadOn(68, 68, true, mrdReleaseCfg, 'synth', 0, 100);
  sentMidi = [];
  drumPadOff(68);
  eq('silent shift-select emits no off', offs().length, 0);

  L.drainAll();
  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  globalThis.shadow_set_param = origSetParam;
}

_log('\nTest: a pad held at teardown is finalized in the engine, not dropped');

{
  const L = await import('../../dist/esm/keyboard/held-notes.js');
  const { onUnload } = await import('../../dist/esm/app/unload.js');
  const { seqNotePadPlayed, resetSeqChord } = await import('../../dist/esm/seq/router.js');
  const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
  const { resetSeqState } = await import('../../dist/esm/seq/state.js');

  const engine = installMockEngine();
  resetSeqEngine(); resetSeqState(); resetSeqChord(); L.drainAll();
  seqEngineTick();                       // boot probe → ready

  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = () => {};

  L.noteSounded(80, 1, 72);              // ledger: pad 80 sounded note 72 on track 1
  seqNotePadPlayed(1, 80, 72, 110);
  seqEngineTick();                       // drain the `non`
  engine.ops.length = 0;

  /* Closing the capture needs the ledger (so it must run before the release
   * drains it) and there is no tick after onUnload to flush the queue, so
   * this fails if either half is reordered away. */
  onUnload();
  eq('the held pad is closed in the engine', engine.ops.includes('nof 1 72'), true);

  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  uninstallMockEngine(); resetSeqEngine(); resetSeqState(); L.drainAll();
}

/* ── release points ──────────────────────────────────────────────────────── */

_log('\nTest: mute releases only that track\'s live notes');

{
  const L = await import('../../dist/esm/keyboard/held-notes.js');
  const { noteOn } = await import('../../dist/esm/keyboard/handler.js');
  const { toggleMute } = await import('../../dist/esm/mixer/track-mutes.js');
  const { seqState } = await import('../../dist/esm/seq/state.js');

  let sentMidi = [];
  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  const offs = () => sentMidi.filter(m => (m[0] & 0xF0) === 0x80);

  L.drainAll();
  seqState.muted = [false, false, false, false];
  noteOn(68, 68, 0, 100);
  noteOn(69, 68, 1, 100);
  sentMidi = [];
  toggleMute(0);
  eq('mute releases the muted track', offs().filter(m => (m[0] & 0x0F) === 0).length, 1);
  eq('mute leaves other tracks sounding', L.soundingCount(), 1);
  eq('survivor is track 1', L.soundingTrack(69), 1);

  // Unmuting must not emit anything — there is nothing to release.
  sentMidi = [];
  toggleMute(0);
  eq('unmute emits no note-off', offs().length, 0);

  L.drainAll();
  seqState.muted = [false, false, false, false];
  globalThis.shadow_send_midi_to_dsp = origSendMidi;
}

/* ── teardown release ────────────────────────────────────────────────────── */

_log('\nTest: onUnload releases live notes and sequencer gates');

{
  const L = await import('../../dist/esm/keyboard/held-notes.js');
  const { noteOn }   = await import('../../dist/esm/keyboard/handler.js');
  const { onUnload } = await import('../../dist/esm/app/unload.js');
  const { seqState } = await import('../../dist/esm/seq/state.js');

  let sentMidi = [];
  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  const offs = () => sentMidi.filter(m => (m[0] & 0xF0) === 0x80);

  L.drainAll();
  seqState.activeNotes.fill(0);
  seqState.activeNotes[0 * 128 + 60] = 1;   // sequencer gate: track 0, pitch 60
  seqState.activeNotes[2 * 128 + 67] = 1;   // sequencer gate: track 2, pitch 67
  noteOn(68, 68, 1, 100);                   // live pad note on track 1
  sentMidi = [];

  onUnload();

  eq('releases three notes', offs().length, 3);
  eq('sequencer gate t0 p60', offs().some(m => (m[0] & 0x0F) === 0 && m[1] === 60), true);
  eq('sequencer gate t2 p67', offs().some(m => (m[0] & 0x0F) === 2 && m[1] === 67), true);
  // Only tracks 0 and 2 hold gates, so a channel-1 off can only be the live note.
  eq('live pad note t1',      offs().some(m => (m[0] & 0x0F) === 1), true);
  eq('ledger emptied', L.soundingCount(), 0);

  seqState.activeNotes.fill(0);
  L.drainAll();
  globalThis.shadow_send_midi_to_dsp = origSendMidi;
}

/* ── LED ownership is re-claimed on resume ────────────────────────────────── */

_log('\nTest: LED ownership claimed on init and on resume');
{
    const { onResume } = await import('../../dist/esm/app/resume.js');

    let claims = 0;
    const origClaim = globalThis.shadow_set_overtake_suppress_sysex;
    globalThis.shadow_set_overtake_suppress_sysex = (flag) => { if (flag === 1) claims++; };

    env.setParams({});
    init();
    eq('init claims LED ownership', claims, 1);

    /* The framework zeroes overtake_suppress_sysex at park and never restores
     * it, and init() is not re-run on resume — so onResume must re-claim. */
    onResume();
    eq('resume re-claims LED ownership', claims, 2);

    globalThis.shadow_set_overtake_suppress_sysex = origClaim;
}

/* ── Knob LEDs are sent on change only ────────────────────────────────────── */

_log('\nTest: knob LEDs diff against a movy-owned cache');
{
    const { ledFrameReset } = await import('../../dist/esm/seq/led-cache.js');
    const { updateKnobLEDs, resetKnobLedCache } =
        await import('../../dist/esm/renderer/knob-leds.js');

    let sends = 0;
    const origSetLED = globalThis.setLED;
    const origSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = () => { sends++; };
    globalThis.setButtonLED = () => { sends++; };

    const cell = (nv) => ({ normalizedValue: nv, trigger: null });
    const vmAt = (nv) => ({ rows: [
        [cell(nv), cell(nv), cell(nv), cell(nv)],
        [cell(nv), cell(nv), cell(nv), cell(nv)],
    ] });

    resetKnobLedCache();

    updateKnobLEDs(vmAt(0.1));
    eq('cold frame writes all 16 knob LEDs', sends, 16);

    sends = 0;
    updateKnobLEDs(vmAt(0.1));
    eq('unchanged frame writes nothing', sends, 0);

    /* 0.1 and 0.9 land in different whiteLevel/amberLevel bands, so every
     * knob's colour actually changes. */
    sends = 0;
    ledFrameReset();
    updateKnobLEDs(vmAt(0.9));
    eq('changed frame writes all 16 again', sends, 16);

    /* Resume invalidation must force a cold frame — the framework's entry
     * LED-clear repaints hardware without going through our cache. */
    sends = 0;
    resetKnobLedCache();
    ledFrameReset();          // one LED frame per app tick; this suite is one frame per call
    updateKnobLEDs(vmAt(0.9));
    eq('reset forces a full repaint', sends, 16);

    globalThis.setLED = origSetLED;
    globalThis.setButtonLED = origSetButtonLED;
}

}
