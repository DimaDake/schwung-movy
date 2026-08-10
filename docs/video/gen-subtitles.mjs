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
  { name: 'Cold open', start: 0.5, every: 3.5, hold: 3.0, cards: [
    ["THIS IS AN ABLETON MOVE", "Finished loop playing. Hands over the pads. PiP: chain view."],
    ["RUNNING SOMETHING ELSE", "Hands ride the Helm filter knob."],
    ["THREE THINGS IT NOW DOES", "Hands off. Playhead sweeps the step row."],
    ["QUANTIZE IS A DIAL, NOT A BUTTON", "Turn knob 4 on the clip page; the bass tightens. PiP: clip-quant."],
    ["RIDE IT BACK. NOTHING IS LOST.", "Turn it back down; the loose feel returns."],
    ["EVERY STEP CAN ROLL DICE", "Hold a step. PiP: step_page_knobs, PROB cell."],
    ["THE LOOP NEVER REPEATS ITSELF", "Hands off. Two bars play, audibly different."],
    ["AN LFO ON ANY KNOB", "PiP: lfo_lfo1, waveform animating."],
    ["HOLD THE KNOB. THAT'S IT.", "Hold a knob. PiP: lfo_assign_toast."],
    ["PLUS ENVELOPES YOU CAN SEE", "PiP: env_dual."],
    ["AND FILTER CURVES THAT MOVE", "Turn a filter knob. PiP: filter_lp_reso, curve moving."],
    ["IT'S FREE. IT'S A PROTOTYPE.", "Hands off. Loop plays."],
    ["AND YOUR MOVE STAYS YOUR MOVE", "Loop plays."],
    ["LET'S BUILD A BEAT", "Hands lift away. Switch to the empty set. PiP: four empty slots."],
  ]},
  { name: 'What is this', start: 50, every: 3.7, hold: 3.2, cards: [
    ["QUICKLY — WHAT IS THIS?", "Empty chain view. Hands rest."],
    ["SCHWUNG RUNS NEW SYNTHS ON MOVE", "PiP: Schwung web UI, module store list."],
    ["FREE. AND MOVE STILL WORKS.", "PiP: Move's own screen, then back to Schwung."],
    ["MOVY IS THE PART YOU PLAY", "PiP: a Movy knob page — env_dual (still)."],
    ["INSTALL SCHWUNG, THEN MOVY", "PiP: store, Install pressed on Movy."],
    ["LINKS BELOW. NOW — THE BEAT.", "Hands return to the device. PiP: empty chain view."],
  ]},
  { name: 'Track 1 — OB-Xd', start: 73, every: 4.0, hold: 3.5, cards: [
    ["TRACK 1: A SYNTH", "Press track button 1. PiP: chain view, slot 1 empty."],
    ["PRESS THE WHEEL TO ADD ONE", "Click the wheel. PiP: module browser opens."],
    ["PICK FROM THE LIST", "Turn the wheel slowly; the list scrolls."],
    ["SYNTHS, DRUMS, EFFECTS —", "Keep scrolling; the list runs past many modules."],
    ["EVERYTHING IN THE SCHWUNG STORE", "Still scrolling. PiP: browser, long list."],
    ["THIS IS OB-XD", "Stop on OB-Xd, click the wheel."],
    ["A CLASSIC ANALOG POLY", "Play a chord on the pads."],
    ["IT PLAYS STRAIGHT AWAY", "Play a few more chords."],
    ["NOW LOOK AT THE SCREEN", "Hands off. PiP: OB-Xd Main page."],
    ["ELEKTRON-STYLE PAGES, BUILT FOR IT", "PiP: Main page held."],
    ["THERE'S THE ENVELOPE", "PiP: envelope graphic on the Main page."],
    ["SHORTER DECAY, LONGER RELEASE", "Turn DECAY, then RELEASE; the envelope reshapes live."],
    ["AND THERE'S THE FILTER", "PiP: filter curve on the same page."],
    ["OPENING THE CUTOFF", "Turn CUTOFF; the curve slides. PiP: filter_lp."],
    ["ADDING RESONANCE", "Turn RESONANCE; the peak grows. PiP: filter_lp_reso."],
    ["THAT'S OUR BASS SOUND", "Play a chord — the new sound."],
    ["NOW THE PADS", "Shift + Step 5. PiP: main-default."],
    ["MOVE HAS SCALES. NOT A PIANO.", "Turn knob 8 LAYOUT to Piano. PiP: main-layout-overlay."],
    ["WHITE KEYS AND BLACK KEYS", "Pads relight as two octaves of piano. Run a hand up them."],
    ["PLAY IT, THEN PRESS CAPTURE", "Transport running. Play the bass line by hand, then press Capture."],
    ["MY TIMING IS HUMAN. THAT'S FINE.", "The take lands in the clip and loops, audibly loose."],
    ["NOW HOLD ONE STEP", "Hold a single step on the bass track."],
    ["AND TURN ANY KNOB YOU LIKE", "Still holding, turn CUTOFF. PiP: auto_live."],
    ["THAT STEP KEEPS ITS OWN SOUND", "Release. Loop plays; one note is brighter than the rest."],
  ]},
  { name: 'Track 2 — Mr Drums', start: 170, every: 4.0, hold: 3.5, cards: [
    ["TRACK 2: DRUMS", "Press track 2, click the wheel, load Mr Drums."],
    ["PADS BECOME A 4×4 RACK", "Pads light as a 4×4 grid. PiP: drum-mrdrums-global."],
    ["A SAMPLER NEEDS A KIT", "Hit pads — silent. Jog to page 4. PiP: Preset page."],
    ["HOLD THE KNOB, PRESS THE WHEEL", "Hold knob 1, click the wheel. PiP: file browser of kits."],
    ["THESE ARE MOVE DRUM RACKS", "Turn the wheel; the kit list scrolls."],
    ["YOUR OWN KITS. UNCHANGED.", "Keep scrolling past the stock kits."],
    ["THIS ONE CAME FROM MASCHINE", "Land on the converted kit."],
    ["CONVERTED, AND IT JUST LOADS", "Click to load. PiP: kit name fills the PRSET cell."],
    ["NOW THE PADS PLAY", "Play the pads over the bass — kick, clap and hat all sound."],
    ["PRESS A PAD TO EDIT THAT VOICE", "Press the kick pad. PiP: per-pad page, pad icon in the header."],
    ["THE KNOBS FOLLOW THE PAD", "Press a different pad; knob values change."],
    ["TURN IT TO SWAP THE SAMPLE", "Jog to page 1, turn the SAMPL knob — samples scroll inline."],
    ["REC, COUNT-IN, PLAY", "Tap Rec. Count-in bar; step LEDs pulse."],
    ["KICK, THEN CLAP", "Play kick on the downbeats, clap on 2 and 4."],
    ["NOW IT'S A BEAT", "Drums and bass loop together. Hands off."],
  ]},
  { name: 'Beyond Move ① — clip page', start: 232, every: 4.0, hold: 3.5, cards: [
    ["THE BASS IS STILL LOOSE", "Loop plays; the drift against the kick is audible."],
    ["EASY TO HEAR NOW", "Loop continues. Hands off."],
    ["SHIFT + STEP 3 = CLIP PAGE", "Press track 1, then Shift + Step 3. PiP: clip-default."],
    ["QUANTIZE IS A DIAL, NOT A BUTTON", "Hand moves to knob 4."],
    ["0% — EXACTLY AS PLAYED", "Turn knob 4 to 0. PiP: QUANT 0%."],
    ["100% — DEAD ON THE GRID", "Turn knob 4 to 100. The bass locks to the kick."],
    ["ANYWHERE IN BETWEEN", "Turn to about 40. PiP: clip-quant."],
    ["AND BACK. NOTHING WAS LOST.", "Turn back to 0 — the original feel returns."],
    ["MOVE'S QUANTIZE IS ONE-WAY", "Loop plays at the chosen amount."],
    ["SAME PAGE: SCALE", "Hand moves to knob 1. PiP: SCALE cell."],
    ["EACH CLIP HAS ITS OWN", "PiP: clip page held."],
    ["ONE KNOB. NEW MOOD.", "Turn knob 1 to Phrygian. The bass re-maps. Hands off."],
  ]},
  { name: 'Track 3 — Weird Dreams / step recording', start: 282, every: 4.0, hold: 3.5, cards: [
    ["TRACK 3: WEIRD DREAMS", "Press track 3, click the wheel, load Weird Dreams."],
    ["SYNTH DRUMS. NO SAMPLES.", "Hit pads — they sound immediately."],
    ["THIS PART IS TOO FAST TO PLAY", "Transport stopped. Hands hover over the pads."],
    ["HOLD REC WHILE STOPPED", "Hold Rec. A red head blinks on the step row."],
    ["THAT'S STEP RECORDING", "PiP: step_rec_header."],
    ["TAP PADS — THE STEP MOVES ON", "Tap pads; the head advances by itself."],
    ["NO PICKING STEPS ONE BY ONE", "Keep tapping; steps fill quickly."],
    ["RIGHT ARROW LEAVES A REST", "Press Right. Head advances, no note."],
    ["LEFT ARROW STEPS BACK", "Press Left. The previous note plays, its pad lights."],
    ["THE CLIP GROWS TO FIT", "Keep tapping; the step row grows."],
    ["RELEASE REC. DONE.", "Release Rec. Press Play."],
    ["FASTER THAN YOU COULD PLAY IT", "Pattern loops with the rest. Hands off."],
  ]},
  { name: 'Beyond Move ② — step parameters', start: 332, every: 4.2, hold: 3.6, cards: [
    ["BUT IT REPEATS EVERY BAR", "Loop plays unchanged for a bar. Hands off."],
    ["HOLD ANY STEP", "Hold a step that has a note."],
    ["THIS IS THE STEP PAGE", "PiP: step_page_knobs, five cells."],
    ["ELEKTRON OWNERS WILL RECOGNISE IT", "Held step stays lit."],
    ["VELOCITY. LENGTH.", "Turn knob 1, then knob 2. PiP: VEL and LEN move."],
    ["PROBABILITY —", "Hand moves to knob 3."],
    ["60% MEANS IT SKIPS SOMETIMES", "Turn knob 3 to 60. PiP: PROB 60%."],
    ["OR ONLY ON CERTAIN BARS", "Turn knob 4 to 2:3. PiP: COND cell."],
    ["INVERT FLIPS THAT ROUND", "Turn knob 5. PiP: INV toggles."],
    ["MOVE HAS NONE OF THIS", "Release the step."],
  ]},
  /* Deliberately sparse: the pattern varying is the whole point here, and a card
   * every four seconds would make the viewer read instead of listen. */
  { name: 'Listen', start: 377, every: 8.0, hold: 3.6, cards: [
    ["NOW LISTEN", "Hands off. Loop runs."],
    ["SAME CLIP. NEVER THE SAME BAR.", "Four bars play; the pattern varies each time. No text for eight seconds either side."],
    ["ONE HELD STEP DID THAT", "Loop continues. Hands still off."],
  ]},
  { name: 'Track 4 — Helm', start: 399, every: 4.2, hold: 3.6, cards: [
    ["TRACK 4: HELM", "Press track 4, click the wheel, load Helm."],
    ["A FULL SOFT SYNTH. ON MOVE.", "Play a lead line on the pads."],
    ["THREE ENVELOPES. TWO LFOS. AN ARP.", "Turn the wheel; a few pages go past. PiP: env_dual."],
    ["ALL OF IT ON THE KNOBS", "PiP: deep_page."],
    ["EVERY SYNTH WORKS LIKE THIS", "PiP: page headers streaming past."],
    ["NOW THE LEAD", "Turn back to a filter page. Play the lead over the loop."],
    ["THAT'S ALL FOUR TRACKS", "Full loop playing. Hands off."],
  ]},
  { name: 'LFO — hold to assign', start: 431, every: 4.0, hold: 3.5, cards: [
    ["TWO LFOS ON EVERY TRACK", "Back to chain view. PiP: LFO slot at the end of the chain."],
    ["ON ANY KNOB YOU LIKE", "Press track 1. PiP: OB-Xd filter page."],
    ["HOLD A KNOB FOR A SECOND", "Hold the cutoff knob. PiP: lfo_assign_toast."],
    ["PICK LFO 1. CLICK.", "Turn the wheel to LFO1, click. PiP: lfo_lfo1 page."],
    ["SHAPE AND PHASE, DRAWN LIVE", "Turn SHAPE, then PHASE; the waveform morphs and slides."],
    ["LOCK IT TO THE BAR", "Turn SYNC on, set DEPTH. The LFO cycles with the bar."],
    ["THE BASS BREATHES NOW", "Loop plays, bass filter moving. Hands off."],
    ["MOVE HAS NOTHING LIKE THIS", "Loop continues."],
  ]},
  { name: 'Automation and undo', start: 466, every: 4.0, hold: 3.5, cards: [
    ["RECORD, THEN TURN A KNOB", "Press track 4. Tap Rec, count-in. PiP: Helm filter page."],
    ["SWEEPING HELM'S FILTER", "Sweep the cutoff knob across two bars."],
    ["IT'S IN THE CLIP NOW", "Tap Rec to stop. The loop replays the sweep."],
    ["THE KNOB MOVES BY ITSELF", "Hands off; the on-screen arc follows playback. PiP: auto_live."],
    ["TOO MUCH? UNDO.", "Press Undo."],
    ["AND IT TELLS YOU WHAT IT UNDID", "PiP: undo_toast naming the change."],
    ["ONE GESTURE = ONE UNDO", "Loop plays without the sweep."],
    ["NOTES, CLIPS, KNOBS, SYNTHS", "Shift + Undo; the sweep returns. Hands off."],
  ]},
  { name: 'Session, master FX, background', start: 500, every: 3.9, hold: 3.4, cards: [
    ["SESSION VIEW: PADS LAUNCH CLIPS", "Press Note/Session. Pads become the clip grid."],
    ["A MASTER FX CHAIN, TOO", "Launch clips on two tracks. PiP: session grid, then master FX slot."],
    ["MOVE HAS NO MASTER BUS", "PiP: master FX chain."],
    ["REVERB ACROSS THE WHOLE KIT", "Turn a reverb knob; the whole loop washes out."],
    ["AND MOVY CAN RUN IN THE BACKGROUND", "Back at the root. PiP: leave_modal → Background."],
    ["MOVE'S OWN SCREENS COME BACK", "Move's native UI appears on the device."],
    ["THE SEQUENCER KEEPS PLAYING", "Loop continues underneath, untouched."],
    ["ONE TRANSPORT, BOTH SEQUENCERS", "Shift + Step 5, LINK on. Press Play — both start. PiP: main-link-on."],
  ]},
  { name: 'Outro', start: 533, every: 4.2, hold: 3.7, cards: [
    ["THAT'S THE BEAT", "All four tracks playing. Hands perform."],
    ["FOUR TRACKS. ONE MOVE.", "Mute and unmute track 3."],
    ["NO COMPUTER IN THE CHAIN", "Ride the Helm filter."],
    ["IT'S FREE AND OPEN SOURCE", "Launch a different clip."],
    ["AND AN EARLY PROTOTYPE", "Hands keep moving over the loop."],
    ["EXPECT ROUGH EDGES", "Loop plays. Hands slow."],
    ["EVERYTHING HERE WAS BUILT WITH AI", "Loop plays."],
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
