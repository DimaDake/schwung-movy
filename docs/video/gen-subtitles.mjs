#!/usr/bin/env node
/* Generates SUBTITLES.md + subtitles.srt from one card list so timecodes can
 * never drift between the two, and so a segment can be retimed by changing one
 * number instead of hand-editing every card after it.
 *
 * Each segment declares when it starts and how often a card lands; in/out times
 * are derived. The checks at the bottom are the actual readability rules — the
 * script refuses to emit cards that can't be read in the time they're shown. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// { name, start (s), every (s between card starts), hold (s on screen), cards }
const segments = [
  { name: 'Cold open', start: 0.5, every: 3.4, hold: 3.0, cards: [
    "THIS IS AN ABLETON MOVE",
    "RUNNING SOMETHING ELSE",
    "FOUR TRACKS. NEW SYNTHS.",
    "A SEQUENCER THAT FEELS LIKE MOVE",
    "AND KNOBS THAT SHOW YOU THIS",
    "REAL ENVELOPES. NOT FOUR KNOBS.",
    "FILTER CURVES YOU CAN SEE",
    "PER-STEP PROBABILITY",
    "LFOS ON ANY PARAMETER",
    "IT'S FREE. IT'S OPEN SOURCE.",
    "LET'S BUILD THIS BEAT",
    "FROM AN EMPTY SET",
    "IN TEN MINUTES",
  ]},
  { name: 'What is this', start: 46, every: 3.9, hold: 3.4, cards: [
    "FIRST — WHAT IS THIS?",
    "MOVE RUNS ITS OWN FIRMWARE",
    "SCHWUNG RUNS CUSTOM SYNTHS ON IT",
    "FREE. COMMUNITY BUILT.",
    "MOVY IS A TOOL FOR SCHWUNG",
    "IT GIVES EVERY SYNTH A KNOB UI",
    "AND ADDS A 4-TRACK SEQUENCER",
    "INSTALL SCHWUNG FIRST",
    "THEN GET MOVY FROM ITS STORE",
    "NO TERMINAL. NO BUILDING.",
    "LINKS IN THE DESCRIPTION",
    "NOW — THE BEAT",
  ]},
  { name: 'Track 1 — Mr Drums + loading a kit', start: 93.5, every: 4.0, hold: 3.5, cards: [
    "TRACK 1: DRUMS",
    "JOG-CLICK AN EMPTY SLOT",
    "THE MODULE BROWSER OPENS",
    "LOADING MR DRUMS",
    "PADS BECOME A 4×4 RACK",
    "BUT IT LOADS EMPTY",
    "IT NEEDS A KIT",
    "JOG TO PAGE 4: PRESET",
    "HOLD THE KNOB — CLICK THE JOG",
    "A FILE BROWSER OPENS",
    "THESE ARE MOVE DRUM RACKS",
    "YOUR OWN KITS. UNCHANGED.",
    "THIS ONE CAME FROM MASCHINE",
    "CLICK TO LOAD",
    "NOW THE PADS PLAY",
    "PRESS A PAD TO EDIT THAT VOICE",
    "THE KNOBS FOLLOW THE PAD",
    "SAME GESTURE SWAPS ITS SAMPLE",
    "TUNING THE KICK",
    "NOW RECORD IT",
    "REC = ONE BAR COUNT-IN",
    "SHIFT + STEP 6 = METRONOME",
    "PLAY THE KICK, THEN THE CLAP",
  ]},
  { name: 'Track 2 — Weird Dreams / step recording', start: 186, every: 3.9, hold: 3.4, cards: [
    "TRACK 2: WEIRD DREAMS",
    "SYNTH DRUMS. NO SAMPLES.",
    "NOTHING TO LOAD — IT JUST PLAYS",
    "THIS PART IS TOO FAST TO PLAY",
    "SO DON'T PLAY IT",
    "HOLD REC WHILE STOPPED",
    "THAT'S STEP RECORDING",
    "EVERY PAD = ONE STEP",
    "NO TIMING. NO PRESSURE.",
    "RIGHT ARROW LEAVES A REST",
    "LEFT ARROW STEPS BACK",
    "AN EMPTY CLIP GROWS TO FIT",
    "RELEASE REC. DONE.",
    "MOVE CAN'T DO THIS",
  ]},
  { name: 'Beyond Move ① — step parameters', start: 241, every: 4.2, hold: 3.6, cards: [
    "BUT IT REPEATS EVERY BAR",
    "HOLD ANY STEP",
    "THIS IS THE STEP PAGE",
    "ELEKTRON CALLS THESE P-LOCKS",
    "VELOCITY. LENGTH.",
    "PROBABILITY —",
    "60% = FIRES 6 TIMES IN 10",
    "CONDITION 2:3 —",
    "FIRES ONCE EVERY 3 BARS",
    "INVERT FLIPS IT",
    "NOW LISTEN",
    "SAME CLIP. NEVER THE SAME BAR.",
    "ONE HELD STEP DID THAT",
    "THIS ONE ALONE IS WORTH IT",
  ]},
  { name: 'Track 3 — OB-Xd', start: 300.5, every: 4.0, hold: 3.5, cards: [
    "TRACK 3: OB-XD",
    "A CLASSIC ANALOG POLY",
    "SHIFT + STEP 5 = SET PAGE",
    "SET MODE TO IN KEY",
    "NOW EVERY PAD IS IN KEY",
    "A WRONG NOTE IS IMPOSSIBLE",
    "REC. COUNT-IN. PLAY.",
    "PLAYING THE BASS LINE",
    "MY TIMING IS HUMAN. THAT'S FINE.",
    "MOVE WOULD QUANTIZE IT AWAY",
    "MOVY DOESN'T. WATCH.",
  ]},
  { name: 'Beyond Move ② — clip page', start: 345.5, every: 4.0, hold: 3.5, cards: [
    "SHIFT + STEP 3 = CLIP PAGE",
    "QUANT IS A VALUE, NOT A BUTTON",
    "0% — EXACTLY AS PLAYED",
    "100% — DEAD ON THE GRID",
    "ANYWHERE IN BETWEEN",
    "AND BACK. NOTHING WAS LOST.",
    "SAME PAGE: SCALE",
    "PER CLIP. NOT PER SET.",
    "MINOR → PHRYGIAN",
    "THE NOTES I RECORDED RE-MAP",
    "ONE KNOB. NEW MOOD.",
  ]},
  { name: 'Track 4 — Helm', start: 390.5, every: 4.2, hold: 3.6, cards: [
    "TRACK 4: HELM",
    "A FULL SOFT SYNTH. ON MOVE.",
    "30 PAGES OF PARAMETERS",
    "TURN THE JOG TO WALK THEM",
    "SHIFT + JOG SKIPS BY SECTION",
    "MOVY READS THE SYNTH ITSELF",
    "NOBODY DREW THIS BY HAND",
    "IT FOUND THE ADSR —",
    "AND DREW THE ENVELOPE",
    "FOUND THE FILTER —",
    "AND DREW THE CURVE",
    "LONG LISTS SCROLL",
    "HELM HAS ITS OWN LFOS TOO",
    "MOVY LAYS THOSE OUT AS WELL",
  ]},
  { name: 'LFO — hold to assign', start: 450.5, every: 4.0, hold: 3.5, cards: [
    "BUT EVERY TRACK GETS TWO MORE",
    "BACK TO THE BASS",
    "HOLD A KNOB FOR A SECOND",
    "PICK LFO 1. CLICK.",
    "ASSIGNED.",
    "SHAPE AND PHASE DRAW LIVE",
    "TURN ON SYNC",
    "IT LOCKS TO THE BAR",
    "AND NEVER DRIFTS",
    "A ~ MARKS THE MODULATED KNOB",
    "THE BASS BREATHES NOW",
  ]},
  { name: 'Automation and undo', start: 495.5, every: 4.0, hold: 3.5, cards: [
    "ONE MORE: AUTOMATION",
    "RECORD, THEN TURN A KNOB",
    "SWEEPING HELM'S FILTER",
    "IT'S IN THE CLIP NOW",
    "THE ARC FOLLOWS PLAYBACK",
    "TOO MUCH? UNDO.",
    "IT NAMES WHAT IT UNDID",
    "ONE GESTURE = ONE UNDO",
    "SHIFT + UNDO REDOES IT",
    "NOTES, CLIPS, KNOBS, MODULES",
    "ALL OF IT",
  ]},
  { name: 'Session view + flashes', start: 540.5, every: 3.9, hold: 3.4, cards: [
    "SESSION VIEW: PADS LAUNCH CLIPS",
    "PLUS A MASTER FX CHAIN",
    "MOVY CAN RUN BEHIND MOVE'S UI",
    "AND SHARE ONE TRANSPORT WITH IT",
    "THE MANUAL IS LINKED BELOW",
  ]},
  { name: 'Outro', start: 561, every: 4.4, hold: 3.9, cards: [
    "THAT'S THE BEAT",
    "FOUR TRACKS. ONE MOVE.",
    "NO COMPUTER IN THE CHAIN",
    "MOVY IS AN EARLY PROTOTYPE",
    "EXPECT ROUGH EDGES. IT'S FREE.",
    "EVERYTHING HERE WAS BUILT WITH AI",
    "THE CODE. THIS VIDEO'S SCRIPT.",
    "EVERY IDEA CAME FROM A HUMAN",
    "JOIN #MOVY IN THE SCHWUNG DISCORD",
    "LINKS BELOW. GO MAKE SOMETHING.",
  ]},
];

const timed = segments.map((s) => ({
  ...s,
  timed: s.cards.map((text, i) => {
    const a = s.start + i * s.every;
    return { a, b: a + s.hold, text };
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
  for (const { a, b, text } of seg.timed) {
    n++;
    if (b - a < 2.4) bad.push(`#${n} too short to read (${(b - a).toFixed(1)}s): ${text}`);
    if (prev !== null && a < prev) bad.push(`#${n} overlaps previous card: ${text}`);
    if (text.split(/\s+/).length > 7) bad.push(`#${n} too many words: ${text}`);
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

let md = `# Movy video — subtitle script

${n} cards, ending at ${mmss(end)}. No voice-over: these carry the whole video.

Import [\`subtitles.srt\`](subtitles.srt) straight into any editor. Both files are
generated by [\`gen-subtitles.mjs\`](gen-subtitles.mjs) — edit the card list there
and re-run it rather than editing either file by hand, so the timings stay in
step. Retiming a segment means changing its \`start\` or \`every\`; every card after
it follows automatically.

## Style

- **Bold, all caps, one or two lines**, centred low in the frame, over a scrim so
  it stays readable against the desk and the Move's white body.
- **Never more than 7 words.** Most cards are 3–5.
- **Minimum 2.4 s on screen.** The generator refuses to emit anything shorter.
- **Gaps are deliberate.** Where cards thin out (after the step-parameter edits,
  during the outro loop) the viewer is meant to be listening, not reading.
- Gesture names match the hardware exactly: **REC**, **SHIFT + STEP 3**, **JOG**.

## Cards

`;
i = 0;
for (const seg of timed) {
  md += `### ${seg.name} — from ${mmss(seg.start)}\n\n`;
  md += `| # | In | Out | Card |\n| --- | --- | --- | --- |\n`;
  for (const { a, b, text } of seg.timed)
    md += `| ${++i} | ${mmss(a)} | ${mmss(b)} | **${text}** |\n`;
  md += '\n';
}
writeFileSync(`${out}/SUBTITLES.md`, md);
console.log(`OK — ${n} cards, ends ${mmss(end)}`);
