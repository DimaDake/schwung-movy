/* browser-test/logic/note-view.mjs — Loop mode's folded note view: layout
 * (folding, row cap, aggregation, strip alignment), held recording notes, the
 * fetch-on-digest rule and the knobs going idle.
 *
 * Run by browser-test/logic.mjs.
 */

import { appState, installMockEngine, uninstallMockEngine, eq, ok, _log } from './harness.mjs';

export async function run() {
    const { layoutNotes, columnSpans, NV_BOT } = await import('../../dist/esm/seq/note-layout.js');
    const { parseNoteList, noteViewActive, noteViewTick, resetNoteView } =
        await import('../../dist/esm/seq/note-view.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { stripWindow } = await import('../../dist/esm/seq/render.js');
    const { VIEW_KNOBS, VIEW_MIXER } = await import('../../dist/esm/app/state.js');
    const BAR = 384, STEP = 24;
    const n = (step, steps, pitch) => ({ tick: step * STEP, gate: steps * STEP, pitch });
    const one = { fromBar: 0, bars: 1, segW: 128 };
    const rowsOf = (runs) => [...new Set(runs.map((r) => r.y0))].sort((a, b) => b - a);

/* ── folding + row cap ───────────────────────────────────────────────────── */
{
    _log('\nnote view fold:');
    // Two pitches an octave and a half apart: two rows, no empty rows between.
    const { runs, noteH } = layoutNotes([n(0, 4, 36), n(8, 4, 55)], one);
    eq('two rows only', rowsOf(runs).length, 2);
    eq('row pitch capped at 12 (note 11 + gap)', noteH, 11);
    eq('lowest pitch sits on the bottom row', runs.find((r) => r.x === 0).y0 + noteH - 1, NV_BOT);
    eq('higher pitch one capped row up', runs.find((r) => r.x === 64).y0, NV_BOT - 12 - noteH + 1);
    eq('4 steps of 16 over 128 px = 32 px', runs[0].w, 32);
}

/* ── aggregation: too many pitches share rows ────────────────────────────── */
{
    _log('\nnote view vertical aggregation:');
    const many = [];
    for (let i = 0; i < 60; i++) many.push(n(i % 16, 1, 30 + i));
    const { runs, noteH } = layoutNotes(many, one);
    eq('60 pitches fold to 30 rows', rowsOf(runs).length, 30);
    eq('1 px notes', noteH, 1);
    ok('nothing drawn above the view', runs.every((r) => r.y0 >= 0));
}

/* ── aggregation: dense columns are hatched, every note keeps a pixel ────── */
{
    _log('\nnote view horizontal aggregation:');
    // 16 bars of 16th hats over 128 px: two notes per pixel.
    const hats = [];
    for (let s = 0; s < 256; s++) hats.push(n(s, 1, 42));
    const win16 = { fromBar: 0, bars: 16, segW: 8 };
    const { runs } = layoutNotes(hats, win16);
    eq('one run across the whole view', runs.length, 1);
    ok('...hatched, not solid', runs[0].hatched && runs[0].w === 128);
    // One long note over the same span stays solid.
    const pad = layoutNotes([{ tick: 0, gate: 16 * BAR, pitch: 42 }], win16).runs;
    ok('a long note is solid', pad.length === 1 && !pad[0].hatched);
    // A sub-pixel note still shows.
    const tiny = layoutNotes([{ tick: 5 * BAR, gate: 1, pitch: 60 }], win16).runs;
    eq('a 1-tick note keeps one column', tiny[0]?.w, 1);
    // Two touching quarter notes on one pitch keep a gap between them.
    const two = layoutNotes([n(0, 4, 60), n(4, 4, 60)], one).runs;
    eq('touching notes stay apart', two.map((r) => [r.x, r.w]).join(' '), '0,32 33,31');
}

/* ── the time axis is the strip's ────────────────────────────────────────── */
{
    _log('\nnote view strip alignment:');
    resetSeqState();
    // Loop = bars 1-2, navigated to the "+" bar 3: three segments of 42 px.
    seqState.loopStart = 0; seqState.lenSteps = 32; seqState.barOffset = 2;
    const win = stripWindow();
    eq('window spans the + bar', [win.fromBar, win.bars, win.segW].join(','), '0,3,42');
    const { runs } = layoutNotes([n(16, 16, 60)], win);
    eq('bar 2 starts on its strip segment', runs[0].x, 42);
    eq('...and ends on it', runs[0].w, 42);
    // A mid-clip loop (bars 3-4) starts the axis at bar 3.
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    const mid = layoutNotes([n(32, 1, 60)], stripWindow()).runs;
    eq('mid-clip loop: its first step is x 0', mid[0].x, 0);
    resetSeqState();
}

/* ── wire format + held recording notes ──────────────────────────────────── */
{
    _log('\nnote view wire format:');
    eq('parse', JSON.stringify(parseNoteList('0.24.60,96.0.62')),
        JSON.stringify([{ tick: 0, gate: 24, pitch: 60 }, { tick: 96, gate: 0, pitch: 62 }]));
    eq('empty list', parseNoteList('').length, 0);
    eq('garbage dropped', parseNoteList('x.y.z,1.1.300').length, 0);
}

/* ── fetch only on a digest change, only while the view is up ────────────── */
{
    _log('\nnote view fetch:');
    const eng = installMockEngine();
    const rects = [];
    const savedFill = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, c) => rects.push([x, y, w, h, c]);
    resetSeqState(); resetNoteView();
    seqState.lenSteps = 16; seqState.loopMode = true;
    appState.currentView = VIEW_KNOBS;
    ok('loop mode in a track view owns the screen', noteViewActive());
    eng.notes = '0.96.60,192.0.64';
    seqState.noteHash = 'aa';
    noteViewTick(true, 1000);
    eq('fetched once', eng.notesGets, 1);
    noteViewTick(false, 1020);
    eq('same digest: no refetch', eng.notesGets, 1);
    seqState.noteHash = 'bb';
    noteViewTick(false, 1050);
    eq('a new digest inside 100 ms waits', eng.notesGets, 1);
    noteViewTick(false, 1101);
    eq('...then fetches', eng.notesGets, 2);
    // The held note (gate 0, starts at step 8) grows with the playhead.
    seqState.playing = true; seqState.posTick = 12 * STEP;
    rects.length = 0;
    noteViewTick(false, 2000);
    const held = rects.find((r) => r[0] === 64 && r[4] === 1 && r[2] > 1);
    eq('held note reaches the playhead', held?.[2], 32);
    // A tick with nothing new repaints only the playhead's columns.
    rects.length = 0;
    seqState.posTick = 12 * STEP + 1;
    noteViewTick(false, 2001);
    ok('quiet tick draws nothing', rects.length === 0);
    appState.currentView = VIEW_MIXER;
    ok('the mixer page keeps its screen', !noteViewActive());
    seqState.loopMode = false; appState.currentView = VIEW_KNOBS;
    ok('off without loop mode', !noteViewActive());
    globalThis.fill_rect = savedFill;
    uninstallMockEngine(); resetSeqState(); resetNoteView();
}

/* ── playhead column: inverted, then restored ────────────────────────────── */
{
    _log('\nnote view playhead column:');
    const { runs } = layoutNotes([n(0, 16, 60)], one);
    eq('a solid row is one span per column', columnSpans(runs, 5).length, 1);
    const hatch = layoutNotes(Array.from({ length: 256 }, (_, s) => n(s, 1, 60)),
        { fromBar: 0, bars: 16, segW: 8 }).runs;
    eq('a hatched 11 px row is 6 one-pixel spans', columnSpans(hatch, 5).length, 6);
}
}
