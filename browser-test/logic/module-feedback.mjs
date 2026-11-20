/* browser-test/logic/module-feedback.mjs — a module's pad colours and status
 * text (keyboard/module-feedback.ts).
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, _log } from './harness.mjs';

export async function run() {
    _log('\nmodule feedback (pad_leds / status_text):');
    const m = await import('../../dist/esm/keyboard/module-feedback.js');
    const { feedbackKeysOf, parsePadLeds, padLedColor, parseStatus, feedbackPoll,
            feedbackLeds, feedbackReset, POLL_EVERY, BLINK_TICKS } = m;

    eq('no declaration -> null', feedbackKeysOf({ pad_layout: 'drums' }), null);
    eq('both keys read', JSON.stringify(feedbackKeysOf({ pad_leds_param: 'pad_leds', status_text_param: 'status_text' })),
       '{"ledsKey":"pad_leds","textKey":"status_text","displayKey":null,"deleteKey":null,"stepKey":null,"stepLedsKey":null,"loopKnobKey":null,"captureKey":null,"knobDeltaKey":null,"undoKey":null}');
    eq('one key is enough', JSON.stringify(feedbackKeysOf({ status_text_param: 't' })),
       '{"ledsKey":null,"textKey":"t","displayKey":null,"deleteKey":null,"stepKey":null,"stepLedsKey":null,"loopKnobKey":null,"captureKey":null,"knobDeltaKey":null,"undoKey":null}');
    eq('display and delete keys read', JSON.stringify(feedbackKeysOf({ display_param: 'd', delete_pad_param: 'x' })),
       '{"ledsKey":null,"textKey":null,"displayKey":"d","deleteKey":"x","stepKey":null,"stepLedsKey":null,"loopKnobKey":null,"captureKey":null,"knobDeltaKey":null,"undoKey":null}');

    eq('short string is rejected', parsePadLeds('0102'), null);
    eq('non-hex is rejected', parsePadLeds('zz'.repeat(32)), null);
    const hex = Array.from({ length: 32 }, (_, i) => (i === 3 ? 'FF' : i.toString(16).padStart(2, '0'))).join('');
    const arr = parsePadLeds(hex);
    eq('32 entries parsed', arr.length, 32);
    eq('entry 2 is 2', arr[2], 2);
    eq('entry 3 is 0xFF', arr[3], 255);

    eq('steady colour', padLedColor(0x0B, 0), 11);
    eq('blink on-phase shows the colour', padLedColor(0x80 | 127, 0), 127);
    eq('blink off-phase is black', padLedColor(0x80 | 127, BLINK_TICKS), 0);
    eq('blink returns', padLedColor(0x80 | 127, 2 * BLINK_TICKS), 127);

    eq('status parses', JSON.stringify(parseStatus('12:MUTE 2')), '{"seq":12,"text":"MUTE 2"}');
    eq('status text may hold a colon', parseStatus('3:A:B').text, 'A:B');
    eq('status without seq is rejected', parseStatus('MUTE'), null);

    /* Poller: throttled, first value silent, a new seq toasts once. */
    feedbackReset();
    const keys = { ledsKey: 'pad_leds', textKey: 'status_text' };
    let reads = 0, text = '0:', leds = hex;
    const read = (k) => { reads++; return k === 'pad_leds' ? leds : text; };
    const run = (n) => { let out = []; for (let i = 0; i < n; i++) { const r = feedbackPoll(1, keys, read); if (r) out.push(r); } return out; };
    eq('reads happen once per POLL_EVERY ticks only', (run(POLL_EVERY - 1), reads), 0);
    run(1);
    eq('one poll = two reads', reads, 2);
    eq('first value is remembered, not shown', run(POLL_EVERY * 2).length, 0);
    text = '1:REC 1';
    eq('a new seq toasts once', JSON.stringify(run(POLL_EVERY * 3)), '["REC 1"]');
    text = '2:REC 1';
    eq('the same text with a new seq toasts again', JSON.stringify(run(POLL_EVERY)), '["REC 1"]');
    eq('colours are kept per track', feedbackLeds(1)[3], 255);
    eq('another track has none', feedbackLeds(2), null);
    /* A track first seen with seq > 0 stays silent too. */
    feedbackReset();
    text = '9:STOP 3';
    eq('first sight of a non-zero seq is silent', run(POLL_EVERY).length, 0);

    /* ── display_param: "<seq>|<pos>|<peaks>|<header>" ── */
    const { parseDisplay, feedbackDisplay, displayTakeDirty, displayActivity, displayShowing,
            deletePadWrite, DISPLAY_IDLE_MS } = m;
    const peaks = Array.from({ length: 128 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
    const d1 = parseDisplay('7|42|' + peaks + '|PLAY 1 - 4 BARS');
    eq('display seq', d1.seq, 7);
    eq('display pos', d1.pos, 42);
    eq('display header', d1.header, 'PLAY 1 - 4 BARS');
    eq('display peaks 128', d1.peaks.length, 128);
    eq('display peak 5', d1.peaks[5], 5);
    eq('a header may hold a bar', parseDisplay('1|0||A|B').header, 'A|B');
    eq('empty peaks -> null (nothing to draw)', parseDisplay('1|0||EMPTY 1').peaks, null);
    eq('garbage is rejected', parseDisplay('x|y'), null);
    eq('short peaks are rejected', parseDisplay('1|0|0102|H').peaks, null);
    eq('pos is clamped to the 128 columns', parseDisplay('1|999|' + peaks + '|H').pos, 127);
    const again = parseDisplay('7|50|' + 'zz'.repeat(128) + '|PLAY', d1);
    eq('same seq keeps the parsed peaks (no re-parse)', again.peaks === d1.peaks, true);
    eq('same seq, new pos', again.pos, 50);

    feedbackReset();
    const dkeys = { ledsKey: null, textKey: null, displayKey: 'display', deleteKey: null };
    let dval = '1|10|' + peaks + '|REC 1';
    let dreads = 0;
    const dread = () => { dreads++; return dval; };
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(3, dkeys, dread);
    eq('display read once per poll', dreads, 1);
    eq('track 3 has a display', feedbackDisplay(3).header, 'REC 1');
    eq('first read marks it dirty', displayTakeDirty(), true);
    eq('and only once', displayTakeDirty(), false);
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(3, dkeys, dread);
    eq('an unchanged display does not repaint', displayTakeDirty(), false);
    dval = '1|11|' + peaks + '|REC 1';
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(3, dkeys, dread);
    eq('a moving playhead repaints', displayTakeDirty(), true);

    /* Toggle: shows by default, knob page while a knob/jog is in use, back after the idle time. */
    eq('shows with nothing touched', displayShowing(1e9, dkeys, 3), true);
    eq('not for a track with no display', displayShowing(1e9, dkeys, 4), false);
    eq('not for a module that declares none', displayShowing(1e9, { ...dkeys, displayKey: null }, 3), false);
    displayActivity(1e9);
    eq('a touched knob brings the knob page', displayShowing(1e9 + 10, dkeys, 3), false);
    eq('still the knob page just before the idle time', displayShowing(1e9 + DISPLAY_IDLE_MS - 1, dkeys, 3), false);
    eq('and the display returns after it', displayShowing(1e9 + DISPLAY_IDLE_MS, dkeys, 3), true);
    eq('a throttled poll: 25 Hz at ~196 ticks/s', POLL_EVERY, 8);

    /* Delete + pad forwarding */
    eq('delete write: rack pad 1 -> index 0', JSON.stringify(deletePadWrite({ ...dkeys, deleteKey: 'delete_pad' }, 1)), '["delete_pad","0"]');
    eq('delete write: rack pad 32 -> index 31', deletePadWrite({ ...dkeys, deleteKey: 'delete_pad' }, 32)[1], '31');
    eq('no key, no write', deletePadWrite(dkeys, 3), null);
    eq('pad outside the rack, no write', deletePadWrite({ ...dkeys, deleteKey: 'x' }, -1), null);

    /* ── step_buttons_param / step_leds_param / loop_knob_param, display mark ── */
    const { parseStepLeds, feedbackStepLeds, stepPressWrite, loopKnobWrite } = m;
    const k3 = feedbackKeysOf({ step_buttons_param: 'step', step_leds_param: 'step_leds', loop_knob_param: 'loop_knob' });
    eq('step keys are read from the hierarchy root', k3.stepKey + ',' + k3.stepLedsKey + ',' + k3.loopKnobKey, 'step,step_leds,loop_knob');
    eq('a hierarchy that declares none of them is null', feedbackKeysOf({ levels: {} }), null);
    eq('a module declaring only pad_leds has no step keys', feedbackKeysOf({ pad_leds_param: 'p' }).stepKey, null);
    eq('step press write: button 0', JSON.stringify(stepPressWrite(k3, 0)), '["step","0"]');
    eq('step press write: button 15', stepPressWrite(k3, 15)[1], '15');
    eq('step press write: out of range', stepPressWrite(k3, 16), null);
    eq('no step key, no write', stepPressWrite(feedbackKeysOf({ pad_leds_param: 'p' }), 3), null);
    eq('loop knob write: knob 1 turn +3', JSON.stringify(loopKnobWrite(k3, 0, 3, false)), '["loop_knob","1:3"]');
    eq('loop knob write: negative delta', loopKnobWrite(k3, 5, -2, false)[1], '6:-2');
    eq('loop knob write: Shift = fine', loopKnobWrite(k3, 1, 1, true)[1], '2:1:1');
    eq('loop knob write: a zero turn is nothing', loopKnobWrite(k3, 1, 0, false), null);
    eq('no loop key, no write', loopKnobWrite(feedbackKeysOf({ pad_leds_param: 'p' }), 1, 1, false), null);
    const sl = Array.from({ length: 16 }, (_, i) => (i + 1).toString(16).padStart(2, '0')).join('');
    eq('step leds: 32 hex digits -> 16 bytes', parseStepLeds(sl)[15], 16);
    eq('step leds: short is rejected', parseStepLeds('0102'), null);
    feedbackReset();
    const skeys = { ledsKey: null, textKey: null, displayKey: null, deleteKey: null, stepKey: 'step', stepLedsKey: 'step_leds', loopKnobKey: null };
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(2, skeys, (k) => (k === 'step_leds' ? sl : null));
    eq('step leds are polled per track', feedbackStepLeds(2)[4], 5);
    eq('another track has none', feedbackStepLeds(1), null);
    feedbackReset();
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(2, { ...skeys, stepLedsKey: null }, () => sl);
    eq('without step_leds_param nothing is read', feedbackStepLeds(2), null);

    const dm = parseDisplay('3|40,12|' + peaks + '|START 1 +3/16');
    eq('display pos with a mark: pos', dm.pos, 40);
    eq('display pos with a mark: mark', dm.mark, 12);
    eq('display without a mark: -1', parseDisplay('3|40|' + peaks + '|H').mark, -1);
    eq('display mark is clamped', parseDisplay('3|40,999|' + peaks + '|H').mark, 127);
    eq('display negative mark = none', parseDisplay('3|40,-1|' + peaks + '|H').mark, -1);
    feedbackReset();
    const mkeys = { ledsKey: null, textKey: null, displayKey: 'display', deleteKey: null };
    let mval = '1|10,5|' + peaks + '|H';
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(3, mkeys, () => mval);
    displayTakeDirty();
    mval = '1|10,9|' + peaks + '|H';
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(3, mkeys, () => mval);
    eq('a moving marker repaints', displayTakeDirty(), true);

    /* ── knob_capture_param / knob_delta_param / undo_param, display end marker ── */
    const { feedbackCapture, knobDeltaWrite, undoWrite } = m;
    const ck = feedbackKeysOf({ knob_capture_param: 'cap', knob_delta_param: 'kd', undo_param: 'ud' });
    eq('capture keys are read', ck.captureKey + ',' + ck.knobDeltaKey + ',' + ck.undoKey, 'cap,kd,ud');
    eq('each of them alone declares feedback', feedbackKeysOf({ undo_param: 'ud' }).undoKey, 'ud');
    eq('knob delta write', knobDeltaWrite(ck, 0, 3, false)[1], '1:3');
    eq('knob delta write names the key', knobDeltaWrite(ck, 5, -2, true)[0] + ' ' + knobDeltaWrite(ck, 5, -2, true)[1], 'kd 6:-2:1');
    eq('knob delta: a zero turn is nothing', knobDeltaWrite(ck, 1, 0, false), null);
    eq('knob delta: knob 9 is nothing', knobDeltaWrite(ck, 8, 1, false), null);
    eq('no knob_delta_param, no write', knobDeltaWrite(feedbackKeysOf({ pad_leds_param: 'p' }), 1, 1, false), null);
    eq('undo write', undoWrite(ck, false)[0] + ' ' + undoWrite(ck, false)[1], 'ud undo');
    eq('redo write', undoWrite(ck, true)[1], 'redo');
    eq('no undo_param, no write', undoWrite(feedbackKeysOf({ pad_leds_param: 'p' }), false), null);
    feedbackReset();
    const capKeys = { ledsKey: null, textKey: null, displayKey: null, deleteKey: null, captureKey: 'cap' };
    let capv = '1';
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(4, capKeys, (k) => (k === 'cap' ? capv : null));
    eq('capture is read per track', feedbackCapture(4), true);
    eq('another track is not captured', feedbackCapture(1), false);
    capv = '0';
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(4, capKeys, (k) => (k === 'cap' ? capv : null));
    eq('capture goes back to 0', feedbackCapture(4), false);
    feedbackReset();
    for (let i = 0; i < POLL_EVERY; i++) feedbackPoll(4, { ...capKeys, captureKey: null }, () => '1');
    eq('without knob_capture_param nothing is read', feedbackCapture(4), false);
    const de = parseDisplay('3|40,12,96|' + peaks + '|END 1 12/16');
    eq('display with start and end markers', de.mark + ',' + de.end, '12,96');
    eq('display with an end marker only', parseDisplay('3|40,-1,96|' + peaks + '|H').mark + ',' + parseDisplay('3|40,-1,96|' + peaks + '|H').end, '-1,96');
    eq('display without an end marker: -1', parseDisplay('3|40,12|' + peaks + '|H').end, -1);
    eq('display end is clamped', parseDisplay('3|40,1,999|' + peaks + '|H').end, 127);
    eq('display pos alone has no markers', parseDisplay('3|40|' + peaks + '|H').end, -1);
}
