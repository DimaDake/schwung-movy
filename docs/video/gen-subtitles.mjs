#!/usr/bin/env node
/* Generates SUBTITLES.md + subtitles.srt from one card list so timecodes
 * can never drift between the two. Times are seconds. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// [start, end, text] — grouped by segment
const segments = [
  ['Cold open', '0:00', [
    [0.5, 3.5, "THIS IS AN ABLETON MOVE"],
    [3.5, 6.5, "RUNNING SOMETHING ELSE"],
    [7.0, 10.0, "FOUR TRACKS. NEW SYNTHS."],
    [10.0, 13.0, "A SEQUENCER THAT FEELS LIKE MOVE"],
    [13.5, 16.5, "AND KNOBS THAT SHOW YOU THIS"],
    [17.0, 20.0, "REAL ENVELOPES. NOT FOUR KNOBS."],
    [20.5, 23.5, "FILTER CURVES YOU CAN SEE"],
    [24.0, 27.0, "PER-STEP PROBABILITY"],
    [27.5, 30.5, "LFOS ON ANY PARAMETER"],
    [31.0, 34.0, "IT'S FREE. IT'S OPEN SOURCE."],
    [34.5, 37.5, "LET'S BUILD THIS BEAT"],
    [38.0, 41.0, "FROM AN EMPTY SET"],
    [41.5, 44.5, "IN TEN MINUTES"],
  ]],
  ['What is this', '0:45', [
    [46, 49, "FIRST — WHAT IS THIS?"],
    [49.5, 53, "MOVE RUNS ITS OWN FIRMWARE"],
    [53.5, 57, "SCHWUNG RUNS CUSTOM SYNTHS ON IT"],
    [57.5, 61, "FREE. COMMUNITY BUILT."],
    [61.5, 65, "MOVY IS A TOOL FOR SCHWUNG"],
    [65.5, 69, "IT GIVES EVERY SYNTH A KNOB UI"],
    [69.5, 73, "AND ADDS A 4-TRACK SEQUENCER"],
    [73.5, 77, "INSTALL SCHWUNG FIRST"],
    [77.5, 81, "THEN GET MOVY FROM ITS STORE"],
    [81.5, 85, "NO TERMINAL. NO BUILDING."],
    [85.5, 89, "LINKS IN THE DESCRIPTION"],
    [89.5, 92.5, "NOW — THE BEAT"],
  ]],
  ['Track 1 — Mr Drums', '1:30', [
    [93.5, 97, "TRACK 1: DRUMS"],
    [97.5, 101, "JOG-CLICK AN EMPTY SLOT"],
    [101.5, 105, "THE MODULE BROWSER OPENS"],
    [105.5, 109, "LOADING MR DRUMS"],
    [109.5, 113, "PADS BECOME A 4×4 RACK"],
    [113.5, 117, "JUST LIKE A MOVE DRUM KIT"],
    [117.5, 121, "PRESS A PAD TO EDIT THAT VOICE"],
    [121.5, 125, "THE KNOBS FOLLOW THE PAD"],
    [125.5, 129, "TUNING THE KICK"],
    [129.5, 133, "NOW RECORD IT"],
    [133.5, 137, "REC = ONE BAR COUNT-IN"],
    [137.5, 141, "SHIFT + STEP 6 = METRONOME"],
    [141.5, 145, "PLAY THE KICK, THEN THE CLAP"],
    [145.5, 149, "STEPS WORK LIKE MOVE'S"],
    [149.5, 153, "TAP A STEP. TOGGLE A NOTE."],
    [153.5, 157.5, "NOTHING NEW HERE — THAT'S THE POINT"],
  ]],
  ['Track 2 — Weird Dreams / step recording', '2:40', [
    [161, 164.5, "TRACK 2: WEIRD DREAMS"],
    [165, 168.5, "SYNTH DRUMS. NO SAMPLES."],
    [169, 172.5, "THIS PART IS TOO FAST TO PLAY"],
    [173, 176.5, "SO DON'T PLAY IT"],
    [177, 180.5, "HOLD REC WHILE STOPPED"],
    [181, 184.5, "THAT'S STEP RECORDING"],
    [185, 188.5, "EVERY PAD = ONE STEP"],
    [189, 192.5, "NO TIMING. NO PRESSURE."],
    [193, 196.5, "RIGHT ARROW LEAVES A REST"],
    [197, 200.5, "LEFT ARROW STEPS BACK"],
    [201, 204.5, "AN EMPTY CLIP GROWS TO FIT"],
    [205, 208.5, "SEVEN NOTES = SEVEN STEPS"],
    [209, 212.5, "RELEASE REC. DONE."],
    [213, 217.5, "MOVE CAN'T DO THIS"],
  ]],
  ['Beyond Move ① — step parameters', '3:40', [
    [221, 224.5, "BUT IT REPEATS EVERY BAR"],
    [225, 228.5, "HOLD ANY STEP"],
    [229, 232.5, "THIS IS THE STEP PAGE"],
    [233, 236.5, "ELEKTRON CALLS THESE P-LOCKS"],
    [237, 240.5, "VELOCITY. LENGTH."],
    [241, 244.5, "PROBABILITY —"],
    [245, 248.5, "60% = FIRES 6 TIMES IN 10"],
    [249, 252.5, "CONDITION 2:3 —"],
    [253, 256.5, "FIRES ONCE EVERY 3 BARS"],
    [257, 260.5, "INVERT FLIPS IT"],
    [261, 264.5, "NOW LISTEN"],
    [265, 269, "SAME CLIP. NEVER THE SAME BAR."],
    [270, 274, "ONE HELD STEP DID THAT"],
    [274.5, 278.5, "THIS ONE ALONE IS WORTH IT"],
  ]],
  ['Track 3 — OB-Xd', '4:40', [
    [281, 284.5, "TRACK 3: OB-XD"],
    [285, 288.5, "A CLASSIC ANALOG POLY"],
    [289, 292.5, "SHIFT + STEP 5 = SET PAGE"],
    [293, 296.5, "ROOT, KEY, MODE, LAYOUT"],
    [297, 300.5, "SET MODE TO IN KEY"],
    [301, 304.5, "NOW EVERY PAD IS IN KEY"],
    [305, 308.5, "A WRONG NOTE IS IMPOSSIBLE"],
    [309, 312.5, "REC. COUNT-IN. PLAY."],
    [313, 316.5, "PLAYING THE BASS LINE"],
    [317, 321, "MY TIMING IS HUMAN. THAT'S FINE."],
    [322, 325.5, "MOVE WOULD QUANTIZE IT AWAY"],
    [326, 329.5, "MOVY DOESN'T"],
    [330, 333.5, "IT KEEPS WHAT YOU PLAYED"],
    [334, 338, "WATCH"],
  ]],
  ['Beyond Move ② — clip page', '5:40', [
    [341, 344.5, "SHIFT + STEP 3 = CLIP PAGE"],
    [345, 348.5, "QUANT IS A VALUE, NOT A BUTTON"],
    [349, 352.5, "0% — EXACTLY AS PLAYED"],
    [353, 356.5, "100% — DEAD ON THE GRID"],
    [357, 360.5, "ANYWHERE IN BETWEEN"],
    [361, 364.5, "AND BACK. NOTHING WAS LOST."],
    [365, 368.5, "SAME PAGE: SCALE"],
    [369, 372.5, "PER CLIP. NOT PER SET."],
    [373, 376.5, "MINOR → PHRYGIAN"],
    [377, 381, "THE NOTES I RECORDED RE-MAP"],
    [381.5, 384.5, "ONE KNOB. NEW MOOD."],
  ]],
  ['Track 4 — Helm', '6:25', [
    [386, 389.5, "TRACK 4: HELM"],
    [390, 393.5, "A FULL SOFT SYNTH. ON MOVE."],
    [394, 397.5, "30 PAGES OF PARAMETERS"],
    [398, 401.5, "TURN THE JOG TO WALK THEM"],
    [402, 405.5, "SHIFT + JOG SKIPS BY SECTION"],
    [406, 409.5, "MOVY READS THE SYNTH ITSELF"],
    [410, 413.5, "NOBODY DREW THIS BY HAND"],
    [414, 417.5, "IT FOUND THE ADSR —"],
    [418, 421.5, "AND DREW THE ENVELOPE"],
    [422, 425.5, "FOUND THE FILTER —"],
    [426, 429.5, "AND DREW THE CURVE"],
    [430, 433.5, "LONG LISTS SCROLL"],
    [434, 437.5, "HELM HAS ITS OWN LFOS TOO"],
    [438, 443, "MOVY LAYS THOSE OUT AS WELL"],
  ]],
  ['LFO — hold to assign', '7:25', [
    [446, 449.5, "BUT EVERY TRACK GETS TWO MORE"],
    [450, 453.5, "BACK TO THE BASS"],
    [454, 457.5, "HOLD A KNOB FOR A SECOND"],
    [458, 461.5, "PICK LFO 1. CLICK."],
    [462, 465.5, "ASSIGNED."],
    [466, 469.5, "SHAPE AND PHASE DRAW LIVE"],
    [470, 473.5, "TURN ON SYNC"],
    [474, 477.5, "IT LOCKS TO THE BAR"],
    [478, 481.5, "AND NEVER DRIFTS"],
    [482, 485.5, "A ~ MARKS THE MODULATED KNOB"],
    [486, 489, "THE BASS BREATHES NOW"],
  ]],
  ['Automation and undo', '8:10', [
    [491, 494.5, "ONE MORE: AUTOMATION"],
    [495, 498.5, "RECORD, THEN TURN A KNOB"],
    [499, 502.5, "SWEEPING HELM'S FILTER"],
    [503, 506.5, "IT'S IN THE CLIP NOW"],
    [507, 510.5, "THE ARC FOLLOWS PLAYBACK"],
    [511, 514.5, "TOO MUCH? UNDO."],
    [515, 518.5, "IT NAMES WHAT IT UNDID"],
    [519, 522.5, "ONE GESTURE = ONE UNDO"],
    [523, 526.5, "SHIFT + UNDO REDOES IT"],
    [527, 531, "NOTES, CLIPS, KNOBS, MODULES"],
    [531.5, 534.5, "ALL OF IT"],
  ]],
  ['Session view + flashes', '8:55', [
    [536, 539.5, "SESSION VIEW: PADS LAUNCH CLIPS"],
    [540, 543.5, "PLUS A MASTER FX CHAIN"],
    [544, 547.5, "MOVY CAN RUN BEHIND MOVE'S UI"],
    [548, 551.5, "AND SHARE ONE TRANSPORT WITH IT"],
    [552, 555.5, "THERE'S MORE THAN FITS HERE"],
    [556, 559.5, "THE MANUAL IS LINKED BELOW"],
  ]],
  ['Outro', '9:20', [
    [561, 565, "THAT'S THE BEAT"],
    [566, 570, "FOUR TRACKS. ONE MOVE."],
    [571, 575, "NO COMPUTER IN THE CHAIN"],
    [576, 580, "MOVY IS AN EARLY PROTOTYPE"],
    [581, 585, "EXPECT ROUGH EDGES. IT'S FREE."],
    [586, 590, "EVERYTHING HERE WAS BUILT WITH AI"],
    [591, 595, "THE CODE. THIS VIDEO'S SCRIPT."],
    [596, 600, "EVERY IDEA CAME FROM A HUMAN"],
    [601, 605, "JOIN #MOVY IN THE SCHWUNG DISCORD"],
    [606, 610, "LINKS BELOW. GO MAKE SOMETHING."],
  ]],
];

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Sanity: no card may start before the previous one ends.
let prev = null, n = 0, bad = [];
for (const [name, , cards] of segments) {
  for (const [a, b, t] of cards) {
    n++;
    if (b <= a) bad.push(`#${n} zero/negative duration: ${t}`);
    if (prev !== null && a < prev) bad.push(`#${n} overlaps previous (${a} < ${prev}): ${t}`);
    if (b - a < 2.4) bad.push(`#${n} too short to read (${(b - a).toFixed(1)}s): ${t}`);
    if (t.split(/\s+/).length > 7) bad.push(`#${n} too many words: ${t}`);
    prev = b;
  }
}
if (bad.length) { console.error('FAILED:\n' + bad.join('\n')); process.exit(1); }

const out = dirname(fileURLToPath(import.meta.url));
let srt = '', i = 0;
for (const [, , cards] of segments)
  for (const [a, b, t] of cards)
    srt += `${++i}\n${srtTime(a)} --> ${srtTime(b)}\n${t}\n\n`;
writeFileSync(`${out}/subtitles.srt`, srt);

let md = `# Movy video — subtitle script

${i} cards, ending at ${mmss(prev)}. No voice-over: these carry the whole video.

Import [\`subtitles.srt\`](subtitles.srt) straight into any editor — it is
generated from the same source as this table, so the timings match exactly.

## Style

- **Bold, all caps, one or two lines**, centred low in the frame, over a scrim
  so it stays readable against the wooden desk and the Move's white body.
- **Never more than 7 words.** Most cards are 3–5.
- **Minimum 2.4 s on screen**, most 3.5 s. Read it aloud twice at a slow pace —
  if you can't, it's too long.
- **Gaps are deliberate.** Where cards are spaced out (after the step-parameter
  edits, during the outro loop) the viewer is meant to be listening, not reading.
- Gesture names match the hardware exactly: **REC**, **SHIFT + STEP 3**, **JOG**.

## Cards

`;
i = 0;
for (const [name, start, cards] of segments) {
  md += `### ${name} — from ${start}\n\n| # | In | Out | Card |\n| --- | --- | --- | --- |\n`;
  for (const [a, b, t] of cards)
    md += `| ${++i} | ${mmss(a)} | ${mmss(b)} | **${t}** |\n`;
  md += '\n';
}
writeFileSync(`${out}/SUBTITLES.md`, md);
console.log(`OK — ${i} cards, ends ${mmss(prev)}`);
