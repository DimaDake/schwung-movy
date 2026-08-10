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
    ["REAL ENVELOPES. NOT FOUR KNOBS.", "Turn knob 2 — the envelope redraws. PiP: env_dual."],
    ["FILTER CURVES YOU CAN SEE", "Turn a filter knob. PiP: filter_lp_reso, curve moving."],
    ["PER-STEP PROBABILITY", "Hold a step. PiP: step_page_knobs."],
    ["LFOS ON ANY PARAMETER", "PiP: lfo_lfo1, waveform animating."],
    ["IT'S FREE. IT'S OPEN SOURCE.", "Hands off. Loop plays."],
    ["LET'S BUILD THIS BEAT", "Hands lift away from the device."],
    ["FROM AN EMPTY SET", "Switch to the empty set. PiP: four empty slots."],
    ["IN TEN MINUTES", "Empty chain view. Silence."],
  ]},
  { name: 'What is this', start: 46, every: 3.9, hold: 3.4, cards: [
    ["FIRST — WHAT IS THIS?", "Empty chain view held. Hands rest."],
    ["MOVE RUNS ITS OWN FIRMWARE", "PiP: Move's stock screen."],
    ["SCHWUNG RUNS CUSTOM SYNTHS ON IT", "PiP: Schwung web UI, module store list."],
    ["FREE. COMMUNITY BUILT.", "PiP: store list scrolling."],
    ["MOVY IS A TOOL FOR SCHWUNG", "PiP: Movy's entry in the store."],
    ["EVERY SYNTH GETS ELEKTRON-STYLE PAGES", "PiP: a Movy knob page — env_dual (still)."],
    ["AND ADDS A 4-TRACK SEQUENCER", "PiP: session clip grid (still)."],
    ["INSTALL SCHWUNG FIRST", "PiP: Schwung install page."],
    ["THEN GET MOVY FROM ITS STORE", "PiP: store, Install pressed on Movy."],
    ["NO TERMINAL. NO BUILDING.", "PiP: install completes."],
    ["LINKS IN THE DESCRIPTION", "PiP: Schwung Tools menu, Movy listed."],
    ["NOW — THE BEAT", "Hands return to the device. PiP: empty chain view."],
  ]},
  { name: 'Track 1 — Mr Drums + loading a kit', start: 93.5, every: 4.0, hold: 3.5, cards: [
    ["TRACK 1: DRUMS", "Press track button 1. PiP: chain view, slot 1 empty."],
    ["JOG-CLICK AN EMPTY SLOT", "Click the jog. PiP: module browser opens."],
    ["THE MODULE BROWSER OPENS", "Turn the jog; the list scrolls."],
    ["LOADING MR DRUMS", "Stop on Mr Drums, click the jog."],
    ["PADS BECOME A 4×4 RACK", "Pads light as a 4×4 grid. PiP: drum-mrdrums-global."],
    ["BUT IT LOADS EMPTY", "Hit several pads. No sound."],
    ["IT NEEDS A KIT", "Hit the pads again. Still silent."],
    ["JOG TO PAGE 4: PRESET", "Turn the jog to page 4. PiP: Preset page, one PRSET cell."],
    ["HOLD THE KNOB — CLICK THE JOG", "Hold knob 1, then click the jog."],
    ["A FILE BROWSER OPENS", "PiP: file browser listing .ablpreset kits."],
    ["THESE ARE MOVE DRUM RACKS", "Turn the jog; the kit list scrolls."],
    ["YOUR OWN KITS. UNCHANGED.", "Keep scrolling past the stock kits."],
    ["THIS ONE CAME FROM MASCHINE", "Land on the converted kit."],
    ["CLICK TO LOAD", "Click the jog. PiP: kit name fills the PRSET cell."],
    ["NOW THE PADS PLAY", "Play the pads — kick, clap and hat all sound."],
    ["PRESS A PAD TO EDIT THAT VOICE", "Press the kick pad. PiP: per-pad page, pad icon in the header."],
    ["THE KNOBS FOLLOW THE PAD", "Press a different pad; knob values change. PiP: header icon follows."],
    ["SAME GESTURE SWAPS ITS SAMPLE", "Jog back to page 1. PiP: SAMPL cell."],
    ["TUNING THE KICK", "Press the kick pad, turn TUNE. PiP: value moving."],
    ["NOW RECORD IT", "Hand moves to Rec."],
    ["REC = ONE BAR COUNT-IN", "Tap Rec. Count-in bar; step LEDs pulse."],
    ["SHIFT + STEP 6 = METRONOME", "Shift + Step 6. Metronome clicks."],
    ["PLAY THE KICK, THEN THE CLAP", "Play kick on the downbeats, clap on 2 and 4."],
  ]},
  { name: 'Track 2 — Weird Dreams / step recording', start: 186, every: 3.9, hold: 3.4, cards: [
    ["TRACK 2: WEIRD DREAMS", "Press track 2, jog-click, load Weird Dreams from the browser."],
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
    ["MOVE CAN'T DO THIS", "Pattern loops. Hands off."],
  ]},
  { name: 'Beyond Move ① — step parameters', start: 241, every: 4.2, hold: 3.6, cards: [
    ["BUT IT REPEATS EVERY BAR", "Loop plays unchanged for a bar. Hands off."],
    ["HOLD ANY STEP", "Hold a step that has a note."],
    ["THIS IS THE STEP PAGE", "PiP: step_page_knobs, five cells."],
    ["ELEKTRON CALLS THESE P-LOCKS", "Held step stays lit."],
    ["VELOCITY. LENGTH.", "Turn knob 1, then knob 2. PiP: VEL and LEN move."],
    ["PROBABILITY —", "Hand moves to knob 3."],
    ["60% = FIRES 6 TIMES IN 10", "Turn knob 3 to 60. PiP: PROB 60%."],
    ["CONDITION 2:3 —", "Hand moves to knob 4."],
    ["FIRES ONCE EVERY 3 BARS", "Turn knob 4 to 2:3. PiP: COND cell."],
    ["INVERT FLIPS IT", "Turn knob 5. PiP: INV toggles."],
    ["NOW LISTEN", "Release the step."],
    ["SAME CLIP. NEVER THE SAME BAR.", "Hands off. Four bars play; the pattern varies."],
    ["ONE HELD STEP DID THAT", "Hands stay off. Loop continues."],
    ["THIS ONE ALONE IS WORTH IT", "Loop continues."],
  ]},
  { name: 'Track 3 — OB-Xd', start: 300.5, every: 4.0, hold: 3.5, cards: [
    ["TRACK 3: OB-XD", "Press track 3, jog-click, load OB-Xd."],
    ["A CLASSIC ANALOG POLY", "Play a few pads — poly chords sound."],
    ["SHIFT + STEP 5 = SET PAGE", "Shift + Step 5. PiP: main-default."],
    ["SET MODE TO IN KEY", "Turn knob 7 to In Key. PiP: main-mode-overlay."],
    ["NOW EVERY PAD IS IN KEY", "Turn ROOT and LAYOUT. PiP: main-layout-overlay. Pads relight."],
    ["A WRONG NOTE IS IMPOSSIBLE", "Run a hand across the pads — every note fits."],
    ["REC. COUNT-IN. PLAY.", "Tap Rec. Count-in bar."],
    ["PLAYING THE BASS LINE", "Play the bass line, deliberately a little behind the beat."],
    ["MY TIMING IS HUMAN. THAT'S FINE.", "Finish the take. Tap Rec to stop."],
    ["MOVE WOULD QUANTIZE IT AWAY", "Loop plays back; the timing is audibly loose."],
    ["MOVY DOESN'T. WATCH.", "Loop continues. Hands off."],
  ]},
  { name: 'Beyond Move ② — clip page', start: 345.5, every: 4.0, hold: 3.5, cards: [
    ["SHIFT + STEP 3 = CLIP PAGE", "Shift + Step 3. PiP: clip-default."],
    ["QUANT IS A VALUE, NOT A BUTTON", "Hand moves to knob 4."],
    ["0% — EXACTLY AS PLAYED", "Turn knob 4 to 0. PiP: QUANT 0%."],
    ["100% — DEAD ON THE GRID", "Turn knob 4 to 100. The bass snaps to the grid."],
    ["ANYWHERE IN BETWEEN", "Turn to about 40. PiP: clip-quant."],
    ["AND BACK. NOTHING WAS LOST.", "Turn back to 0 — the original feel returns."],
    ["SAME PAGE: SCALE", "Hand moves to knob 1."],
    ["PER CLIP. NOT PER SET.", "PiP: SCALE cell."],
    ["MINOR → PHRYGIAN", "Turn knob 1 to Phrygian. Bass and lead re-map."],
    ["THE NOTES I RECORDED RE-MAP", "Loop plays in the new scale."],
    ["ONE KNOB. NEW MOOD.", "Hands off. Loop continues."],
  ]},
  { name: 'Track 4 — Helm', start: 390.5, every: 4.2, hold: 3.6, cards: [
    ["TRACK 4: HELM", "Press track 4, jog-click, load Helm."],
    ["A FULL SOFT SYNTH. ON MOVE.", "Play a lead line on the pads."],
    ["30 PAGES OF PARAMETERS", "PiP: Helm page 1."],
    ["TURN THE JOG TO WALK THEM", "Turn the jog; pages advance. PiP: deep_page."],
    ["SHIFT + JOG SKIPS BY SECTION", "Shift + jog; section headers jump."],
    ["MOVY READS THE SYNTH ITSELF", "Keep turning. PiP: pages scrolling past."],
    ["NOBODY DREW THIS BY HAND", "Jog stops."],
    ["IT FOUND THE ADSR —", "PiP: env_dual, envelope drawn."],
    ["AND DREW THE ENVELOPE", "Turn a knob; the envelope shape changes on screen."],
    ["FOUND THE FILTER —", "Jog to a filter page. PiP: filter_lp_reso."],
    ["AND DREW THE CURVE", "Turn cutoff and resonance; the curve moves."],
    ["LONG LISTS SCROLL", "Turn an enum knob. PiP: enum_overlay scrolling."],
    ["HELM HAS ITS OWN LFOS TOO", "Jog to Helm's LFO page. PiP: lfo_helm_pyramid."],
    ["MOVY LAYS THOSE OUT AS WELL", "Turn its rate; the waveform animates."],
  ]},
  { name: 'LFO — hold to assign', start: 450.5, every: 4.0, hold: 3.5, cards: [
    ["BUT EVERY TRACK GETS TWO MORE", "Back to chain view. PiP: LFO slot at the end of the chain."],
    ["BACK TO THE BASS", "Press track 3. PiP: OB-Xd filter page."],
    ["HOLD A KNOB FOR A SECOND", "Hold the cutoff knob. PiP: lfo_assign_toast."],
    ["PICK LFO 1. CLICK.", "Turn the jog to LFO1, click."],
    ["ASSIGNED.", "PiP: lfo_lfo1 page."],
    ["SHAPE AND PHASE DRAW LIVE", "Turn SHAPE, then PHASE; the waveform morphs and slides."],
    ["TURN ON SYNC", "Turn SYNC on. PiP: rate shows a musical division."],
    ["IT LOCKS TO THE BAR", "Set DEPTH. Loop plays; the LFO cycles with the bar."],
    ["AND NEVER DRIFTS", "Bars pass; the LFO stays aligned."],
    ["A ~ MARKS THE MODULATED KNOB", "Back to the module page. PiP: ~ beside the label."],
    ["THE BASS BREATHES NOW", "Loop plays, bass filter moving. Hands off."],
  ]},
  { name: 'Automation and undo', start: 495.5, every: 4.0, hold: 3.5, cards: [
    ["ONE MORE: AUTOMATION", "Press track 4. PiP: Helm filter page."],
    ["RECORD, THEN TURN A KNOB", "Tap Rec. Count-in bar."],
    ["SWEEPING HELM'S FILTER", "Sweep the cutoff knob across two bars."],
    ["IT'S IN THE CLIP NOW", "Tap Rec to stop. The loop replays the sweep."],
    ["THE ARC FOLLOWS PLAYBACK", "Hands off; the on-screen arc moves by itself. PiP: auto_live."],
    ["TOO MUCH? UNDO.", "Press Undo."],
    ["IT NAMES WHAT IT UNDID", "PiP: undo_toast naming the change."],
    ["ONE GESTURE = ONE UNDO", "Loop plays without the sweep."],
    ["SHIFT + UNDO REDOES IT", "Shift + Undo. PiP: redo_toast."],
    ["NOTES, CLIPS, KNOBS, MODULES", "The sweep returns."],
    ["ALL OF IT", "Loop plays. Hands off."],
  ]},
  { name: 'Session view + flashes', start: 540.5, every: 3.9, hold: 3.4, cards: [
    ["SESSION VIEW: PADS LAUNCH CLIPS", "Press Note/Session. Pads become the clip grid."],
    ["PLUS A MASTER FX CHAIN", "Launch clips on two tracks. PiP: session grid, then master FX slot."],
    ["MOVY CAN RUN BEHIND MOVE'S SCREENS", "Back at the root. PiP: leave_modal → Background. Move's own screen appears; the loop keeps playing."],
    ["AND SHARE ONE TRANSPORT WITH IT", "Shift + Step 5, turn LINK on. PiP: main-link-on. Press Play — Move's sequencer starts too."],
    ["THE MANUAL IS LINKED BELOW", "Return to Movy. Full loop playing."],
  ]},
  { name: 'Outro', start: 561, every: 4.4, hold: 3.9, cards: [
    ["THAT'S THE BEAT", "All four tracks playing. Hands perform."],
    ["FOUR TRACKS. ONE MOVE.", "Mute and unmute track 2."],
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
