#!/usr/bin/env node
/* Generates SHOOTING-SCRIPT.md + subtitles.srt from one card list, so the
 * on-screen action can never drift out of sync with the subtitle it belongs to,
 * and a segment can be retimed by changing one number instead of hand-editing
 * every card after it.
 *
 * Each segment declares when it starts and how often a card lands; in/out times
 * are derived. Each card is [subtitle, what happens on screen]. The checks at
 * the bottom are the readability rules — the script refuses to emit cards that
 * can't be read in the time they're shown. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// { name, start (s), every (s between card starts), hold (s on screen), cards }
// cards: [ subtitle, on-screen action ]
const segments = [
  { name: 'Cold open', start: 0.5, every: 3.4, hold: 3.0, cards: [
    ["THIS IS AN ABLETON MOVE", "Finished loop playing. Hands over the pads. PiP: chain view."],
    ["RUNNING SOMETHING ELSE", "Hands ride the Helm filter knob."],
    ["FOUR TRACKS. NEW SYNTHS.", "Tap each of the four track buttons in turn. PiP: slot highlight moves."],
    ["A SEQUENCER THAT FEELS LIKE MOVE", "Hands off. Playhead sweeps the step row."],
    ["AND KNOBS THAT SHOW YOU THIS", "Hand rests on knob 1. PiP: env_dual."],
    ["REAL ENVELOPES ON SCREEN", "Turn knob 2 — the envelope redraws. PiP: env_dual."],
    ["FILTER CURVES THAT MOVE", "Turn a filter knob. PiP: filter_lp_reso, curve moving."],
    ["PER-STEP PROBABILITY", "Hold a step. PiP: step_page_knobs."],
    ["LFOS ON ANY KNOB", "PiP: lfo_lfo1, waveform animating."],
    ["IT'S FREE. IT'S OPEN SOURCE.", "Hands off. Loop plays."],
    ["LET'S BUILD THIS BEAT", "Hands lift away from the device."],
    ["FROM AN EMPTY SET", "Switch to the empty set. PiP: four empty slots."],
    ["IN TEN MINUTES", "Empty chain view. Silence."],
  ]},
  { name: 'What is this', start: 46, every: 3.9, hold: 3.4, cards: [
    ["FIRST — WHAT IS THIS?", "Empty chain view held. Hands rest."],
    ["MOVE ONLY PLAYS ITS OWN SOUNDS", "PiP: Move's stock screen."],
    ["SCHWUNG ADDS NEW ONES", "PiP: Schwung web UI, module store list."],
    ["FREE. COMMUNITY BUILT.", "PiP: store list scrolling."],
    ["MOVY IS A TOOL FOR SCHWUNG", "PiP: Movy's entry in the store."],
    ["EVERY SYNTH GETS ELEKTRON-STYLE PAGES", "PiP: a Movy knob page — env_dual (still)."],
    ["SYNTHS, DRUMS AND EFFECTS ALIKE", "PiP: quick cycle — a synth page, a drum page, an FX page."],
    ["EVERYTHING IN THE SCHWUNG STORE", "PiP: store list scrolling past many modules."],
    ["AND A 4-TRACK SEQUENCER", "PiP: session clip grid (still)."],
    ["INSTALL SCHWUNG FIRST", "PiP: Schwung install page."],
    ["THEN GET MOVY FROM ITS STORE", "PiP: store, Install pressed on Movy."],
    ["NO TERMINAL. NO BUILDING.", "PiP: install completes."],
    ["LINKS IN THE DESCRIPTION", "PiP: Schwung Tools menu, Movy listed."],
    ["NOW — THE BEAT", "Hands return to the device. PiP: empty chain view."],
  ]},
  { name: 'Track 1 — OB-Xd', start: 101.5, every: 4.0, hold: 3.5, cards: [
    ["TRACK 1: A SYNTH", "Press track button 1. PiP: chain view, slot 1 empty."],
    ["JOG-CLICK AN EMPTY SLOT", "Click the jog. PiP: module browser opens."],
    ["PICK A SYNTH FROM THE LIST", "Turn the jog; the list scrolls."],
    ["THIS IS OB-XD", "Stop on OB-Xd, click the jog."],
    ["A CLASSIC ANALOG POLY", "Play a chord on the pads."],
    ["IT PLAYS STRAIGHT AWAY", "Play a few more chords."],
    ["NOW LOOK AT THE SCREEN", "Hands off. PiP: OB-Xd Main page."],
    ["THE WHOLE SYNTH ON EIGHT KNOBS", "PiP: Main page held."],
    ["THERE'S THE ENVELOPE", "PiP: envelope graphic on the Main page."],
    ["SHORTER DECAY, LONGER RELEASE", "Turn DECAY, then RELEASE; the envelope reshapes live."],
    ["AND THERE'S THE FILTER", "PiP: filter curve on the same page."],
    ["OPENING THE CUTOFF", "Turn CUTOFF; the curve slides. PiP: filter_lp."],
    ["ADDING RESONANCE", "Turn RESONANCE; the peak grows. PiP: filter_lp_reso."],
    ["THAT'S OUR BASS SOUND", "Play a chord — the new sound."],
    ["NOW THE PADS", "Hand moves to Shift."],
    ["SHIFT + STEP 5 = SET PAGE", "Shift + Step 5. PiP: main-default."],
    ["MOVE HAS SCALES TOO", "PiP: Set page held."],
    ["BUT NOT A PIANO LAYOUT", "Turn knob 8 LAYOUT to Piano. PiP: main-layout-overlay."],
    ["WHITE KEYS AND BLACK KEYS", "Pads relight as two octaves of piano. Run a hand up them."],
    ["NO ARMING. NO COUNT-IN.", "Transport running. Hands over the pads."],
    ["JUST PLAY", "Play the bass line by hand, a little behind the beat."],
    ["LIKED IT? PRESS CAPTURE.", "Press Capture."],
    ["IT KEEPS WHAT YOU JUST PLAYED", "The bass line appears in the clip and loops."],
    ["MY TIMING IS HUMAN. THAT'S FINE.", "Bass loops on its own, audibly loose."],
    ["NOW HOLD ONE STEP", "Hold a single step on the bass track."],
    ["AND TURN THE FILTER", "Still holding, turn CUTOFF. PiP: auto_live."],
    ["THAT STEP KEEPS ITS OWN SOUND", "Release. Loop plays; one note is brighter than the rest."],
  ]},
  { name: 'Track 2 — Mr Drums', start: 210, every: 4.0, hold: 3.5, cards: [
    ["TRACK 2: DRUMS", "Press track 2, jog-click. PiP: module browser."],
    ["LOADING MR DRUMS", "Stop on Mr Drums, click the jog."],
    ["PADS BECOME A 4×4 RACK", "Pads light as a 4×4 grid. PiP: drum-mrdrums-global."],
    ["BUT IT LOADS EMPTY", "Hit several pads. No sound."],
    ["A SAMPLER NEEDS A KIT", "Hit the pads again. Still silent."],
    ["JOG TO PAGE 4: PRESET", "Turn the jog to page 4. PiP: Preset page, one PRSET cell."],
    ["HOLD THE KNOB — CLICK THE JOG", "Hold knob 1, then click the jog."],
    ["A FILE BROWSER OPENS", "PiP: file browser listing .ablpreset kits."],
    ["THESE ARE MOVE DRUM RACKS", "Turn the jog; the kit list scrolls."],
    ["YOUR OWN KITS. UNCHANGED.", "Keep scrolling past the stock kits."],
    ["THIS ONE CAME FROM MASCHINE", "Land on the converted kit."],
    ["CLICK TO LOAD", "Click the jog. PiP: kit name fills the PRSET cell."],
    ["NOW THE PADS PLAY", "Play the pads over the bass — kick, clap and hat all sound."],
    ["PRESS A PAD TO EDIT THAT VOICE", "Press the kick pad. PiP: per-pad page, pad icon in the header."],
    ["THE KNOBS FOLLOW THE PAD", "Press a different pad; knob values change."],
    ["TURN IT TO SWAP THE SAMPLE", "Jog to page 1, turn the SAMPL knob — samples scroll inline. PiP: file overlay."],
    ["REC = ONE BAR COUNT-IN", "Tap Rec. Count-in bar; step LEDs pulse."],
    ["PLAY THE KICK, THEN THE CLAP", "Play kick on the downbeats, clap on 2 and 4."],
  ]},
  { name: 'Beyond Move ① — clip page', start: 282.5, every: 4.0, hold: 3.5, cards: [
    ["THE BASS IS STILL LOOSE", "Drums and bass loop together. Hands off."],
    ["EASY TO HEAR NOW", "Loop continues; the drift against the kick is audible."],
    ["SHIFT + STEP 3 = CLIP PAGE", "Press track 1, then Shift + Step 3. PiP: clip-default."],
    ["QUANTIZE IS A DIAL, NOT A BUTTON", "Hand moves to knob 4."],
    ["0% — EXACTLY AS PLAYED", "Turn knob 4 to 0. PiP: QUANT 0%."],
    ["100% — DEAD ON THE GRID", "Turn knob 4 to 100. The bass locks to the kick."],
    ["ANYWHERE IN BETWEEN", "Turn to about 40. PiP: clip-quant."],
    ["AND BACK. NOTHING WAS LOST.", "Turn back to 0 — the original feel returns."],
    ["SAME PAGE: SCALE", "Hand moves to knob 1. PiP: SCALE cell."],
    ["EACH CLIP HAS ITS OWN", "PiP: clip page held."],
    ["MINOR → PHRYGIAN", "Turn knob 1 to Phrygian. The bass re-maps."],
    ["ONE KNOB. NEW MOOD.", "Loop plays in the new scale. Hands off."],
  ]},
  { name: 'Track 3 — Weird Dreams / step recording', start: 331, every: 3.9, hold: 3.4, cards: [
    ["TRACK 3: WEIRD DREAMS", "Press track 3, jog-click, load Weird Dreams."],
    ["SYNTH DRUMS. NO SAMPLES.", "Hit pads — they sound immediately."],
    ["NOTHING TO LOAD — IT JUST PLAYS", "Hit a few more pads."],
    ["THIS PART IS TOO FAST TO PLAY", "Transport stopped. Hands hover over the pads."],
    ["SO DON'T PLAY IT", "Hands come off the pads."],
    ["HOLD REC WHILE STOPPED", "Hold Rec. A red head blinks on the step row."],
    ["THAT'S STEP RECORDING", "PiP: step_rec_header."],
    ["EVERY PAD = ONE STEP", "Tap a pad — the head advances one step."],
    ["NO TIMING. NO PRESSURE.", "Tap pads quickly; several steps fill."],
    ["RIGHT ARROW LEAVES A REST", "Press Right. Head advances, no note."],
    ["LEFT ARROW STEPS BACK", "Press Left. The previous note plays, its pad lights."],
    ["AN EMPTY CLIP GROWS TO FIT", "Keep tapping; the step row grows."],
    ["RELEASE REC. DONE.", "Release Rec. Press Play."],
    ["MOVE CAN'T DO THIS", "Pattern loops with the rest. Hands off."],
  ]},
  { name: 'Beyond Move ② — step parameters', start: 386, every: 4.2, hold: 3.6, cards: [
    ["BUT IT REPEATS EVERY BAR", "Loop plays unchanged for a bar. Hands off."],
    ["HOLD ANY STEP", "Hold a step that has a note."],
    ["THIS IS THE STEP PAGE", "PiP: step_page_knobs, five cells."],
    ["ELEKTRON CALLS THESE P-LOCKS", "Held step stays lit."],
    ["VELOCITY. LENGTH.", "Turn knob 1, then knob 2. PiP: VEL and LEN move."],
    ["PROBABILITY —", "Hand moves to knob 3."],
    ["60% = FIRES 6 TIMES IN 10", "Turn knob 3 to 60. PiP: PROB 60%."],
    ["OR ONLY ON CERTAIN BARS", "Hand moves to knob 4."],
    ["FIRES ONCE EVERY 3 BARS", "Turn knob 4 to 2:3. PiP: COND cell."],
    ["INVERT FLIPS IT", "Turn knob 5. PiP: INV toggles."],
    ["NOW LISTEN", "Release the step."],
    ["SAME CLIP. NEVER THE SAME BAR.", "Hands off. Four bars play; the pattern varies."],
    ["ONE HELD STEP DID THAT", "Hands stay off. Loop continues."],
    ["THIS ONE ALONE IS WORTH IT", "Loop continues."],
  ]},
  { name: 'Track 4 — Helm', start: 445, every: 4.2, hold: 3.6, cards: [
    ["TRACK 4: HELM", "Press track 4, jog-click, load Helm."],
    ["A FULL SOFT SYNTH. ON MOVE.", "Play a lead line on the pads."],
    ["OB-XD HAD 16 PAGES", "PiP: Helm page 1."],
    ["HELM HAS 34", "Turn the jog; pages advance. PiP: deep_page."],
    ["THREE ENVELOPES. TWO LFOS.", "Jog to an envelope page. PiP: env_dual."],
    ["A STEP SEQUENCER. AN ARP.", "Jog past the step sequencer pages."],
    ["ALL OF IT ON THE KNOBS", "Keep turning; page headers stream past."],
    ["LONG LISTS SCROLL", "Turn an enum knob. PiP: enum_overlay scrolling."],
    ["HELM'S OWN LFOS, LAID OUT", "Jog to Helm's LFO page. PiP: lfo_helm_pyramid."],
    ["EVERY MODULE WORKS LIKE THIS", "Keep jogging. PiP: page headers streaming past."],
    ["NOW THE LEAD", "Turn back to a filter page."],
    ["PLAYING IT OVER THE LOOP", "Play the lead line over the running loop."],
    ["THAT'S ALL FOUR TRACKS", "Loop plays with everything. Hands off."],
  ]},
  { name: 'LFO — hold to assign', start: 500, every: 4.0, hold: 3.5, cards: [
    ["EVERY TRACK GETS TWO MORE", "Back to chain view. PiP: LFO slot at the end of the chain."],
    ["ON ANY KNOB YOU LIKE", "Press track 1. PiP: OB-Xd filter page."],
    ["HOLD A KNOB FOR A SECOND", "Hold the cutoff knob. PiP: lfo_assign_toast."],
    ["PICK LFO 1. CLICK.", "Turn the jog to LFO1, click. PiP: lfo_lfo1 page."],
    ["SHAPE AND PHASE DRAW LIVE", "Turn SHAPE, then PHASE; the waveform morphs and slides."],
    ["TURN ON SYNC", "Turn SYNC on. PiP: rate shows a musical division."],
    ["IT LOCKS TO THE BAR", "Set DEPTH. Loop plays; the LFO cycles with the bar."],
    ["AND NEVER DRIFTS", "Bars pass; the LFO stays aligned."],
    ["A ~ SHOWS WHAT'S MOVING", "Back to the module page. PiP: ~ beside the label."],
    ["THE BASS BREATHES NOW", "Loop plays, bass filter moving. Hands off."],
  ]},
  { name: 'Automation and undo', start: 540.5, every: 4.0, hold: 3.5, cards: [
    ["LAST ONE: AUTOMATION", "Press track 4. PiP: Helm filter page."],
    ["RECORD, THEN TURN A KNOB", "Tap Rec. Count-in bar."],
    ["SWEEPING HELM'S FILTER", "Sweep the cutoff knob across two bars."],
    ["IT'S IN THE CLIP NOW", "Tap Rec to stop. The loop replays the sweep."],
    ["THE KNOB MOVES BY ITSELF", "Hands off; the on-screen arc follows playback. PiP: auto_live."],
    ["TOO MUCH? UNDO.", "Press Undo."],
    ["IT NAMES WHAT IT UNDID", "PiP: undo_toast naming the change."],
    ["ONE GESTURE = ONE UNDO", "Loop plays without the sweep."],
    ["SHIFT + UNDO REDOES IT", "Shift + Undo. PiP: redo_toast. The sweep returns."],
    ["NOTES, CLIPS, KNOBS, MODULES", "Loop plays. Hands off."],
  ]},
  { name: 'Session view + flashes', start: 581, every: 3.9, hold: 3.4, cards: [
    ["SESSION VIEW: PADS LAUNCH CLIPS", "Press Note/Session. Pads become the clip grid."],
    ["PLUS A MASTER FX CHAIN", "Launch clips on two tracks. PiP: session grid, then master FX slot."],
    ["MOVY CAN RUN BEHIND MOVE'S SCREENS", "Back at the root. PiP: leave_modal → Background. Move's own screen appears; the loop keeps playing."],
    ["AND SHARE ONE TRANSPORT WITH IT", "Shift + Step 5, turn LINK on. PiP: main-link-on. Press Play — Move's sequencer starts too."],
    ["THE MANUAL IS LINKED BELOW", "Return to Movy. Full loop playing."],
  ]},
  { name: 'Outro', start: 601, every: 4.0, hold: 3.5, cards: [
    ["THAT'S THE BEAT", "All four tracks playing. Hands perform."],
    ["FOUR TRACKS. ONE MOVE.", "Mute and unmute track 3."],
    ["NO COMPUTER IN THE CHAIN", "Ride the Helm filter."],
    ["MOVY IS AN EARLY PROTOTYPE", "Launch a different clip."],
    ["EXPECT ROUGH EDGES. IT'S FREE.", "Hands keep moving over the loop."],
    ["EVERYTHING HERE WAS BUILT WITH AI", "Loop plays. Hands slow."],
    ["THE CODE. THIS VIDEO'S SCRIPT.", "Loop plays."],
    ["EVERY IDEA CAME FROM A HUMAN", "Hands lift away."],
    ["JOIN #MOVY IN THE SCHWUNG DISCORD", "Loop plays, hands off."],
    ["LINKS BELOW. GO MAKE SOMETHING.", "Loop plays out and stops."],
  ]},
];

const timed = segments.map((s) => ({
  ...s,
  timed: s.cards.map(([text, action], i) => {
    const a = s.start + i * s.every;
    return { a, b: a + s.hold, text, action };
  }),
}));

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:` +
         `${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let prev = null, n = 0, end = 0;
const bad = [];
for (const seg of timed) {
  for (const { a, b, text, action } of seg.timed) {
    n++;
    if (b - a < 2.4) bad.push(`#${n} too short to read (${(b - a).toFixed(1)}s): ${text}`);
    if (prev !== null && a < prev) bad.push(`#${n} overlaps previous card: ${text}`);
    if (text.split(/\s+/).length > 7) bad.push(`#${n} too many words: ${text}`);
    if (!action) bad.push(`#${n} has no on-screen action: ${text}`);
    prev = b;
    end = Math.max(end, b);
  }
}
if (bad.length) { console.error('FAILED:\n' + bad.join('\n')); process.exit(1); }

const out = dirname(fileURLToPath(import.meta.url));
let srt = '', i = 0;
for (const seg of timed)
  for (const { a, b, text } of seg.timed)
    srt += `${++i}\n${srtTime(a)} --> ${srtTime(b)}\n${text}\n\n`;
writeFileSync(`${out}/subtitles.srt`, srt);

let md = `# Movy video — shooting script

${n} cards, ending at ${mmss(end)}. Every subtitle with the action it belongs to.
No voice-over: the cards carry the whole video.

Import [\`subtitles.srt\`](subtitles.srt) into the editor for the burnt-in titles.
Both files are generated by [\`gen-subtitles.mjs\`](gen-subtitles.mjs) — edit the
card list there and re-run it rather than editing either file by hand. Retiming a
segment means changing its \`start\` or \`every\`; every card after it follows.

The reasoning behind these choices — why each module, page and cut — is in
[\`SCENARIO.md\`](SCENARIO.md), deliberately kept out of this document.

## Subtitle style

- **Bold, all caps, one or two lines**, centred low in the frame, over a scrim.
- **Never more than 7 words.** Most cards are 3–5.
- **Minimum 2.4 s on screen.** The generator refuses anything shorter.
- Gesture names match the hardware exactly: **REC**, **SHIFT + STEP 3**, **JOG**.
- "PiP" is the composited inset of the device display, recorded separately with
  \`scripts/capture-screen.mjs\`.

`;
i = 0;
for (const seg of timed) {
  md += `## ${seg.name}\n\n${mmss(seg.start)} – ${mmss(seg.timed.at(-1).b)}\n\n`;
  md += `| # | In | Out | Subtitle | On screen |\n| --- | --- | --- | --- | --- |\n`;
  for (const { a, b, text, action } of seg.timed)
    md += `| ${++i} | ${mmss(a)} | ${mmss(b)} | **${text}** | ${action} |\n`;
  md += '\n';
}
writeFileSync(`${out}/SHOOTING-SCRIPT.md`, md);
console.log(`OK — ${n} cards, ends ${mmss(end)}`);
