/* Every generated site figure, by output name. */
import { join } from 'path';
import { panel } from './panel.mjs';
import { padGrid, melodicLayout, drumLayout, stepRow, trackLed, trackDim, movy, T1 } from './grids.mjs';
import { BODY, GREY_LIT, GREY_DIM, UNLIT, ACCENT, led, text, rrect, svgDoc } from './svg.mjs';

export function figures(root) {
    const shot = (n) => join(root, 'browser-test/screenshots/baseline', n + '.png');
    const WHITE = '#ffffff', GREEN = led(movy.C_GREEN), RED = led(movy.C_REC_RED);
    const keyPads = (() => {
        const map = movy.buildPadMap(movy.MODE_CHROMATIC, movy.LAYOUT_FOURTHS, 0, 48), o = {};
        for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
            const p = map[(3 - r) * 8 + c];
            o[`${r}_${c}`] = p % 12 === 0 ? T1 : movy.inScaleFor(p, 0, 0) ? GREY_LIT : UNLIT;
        }
        return o;
    })();
    const sessionPads = (() => {
        const o = {}, filled = [[1, 1, 1, 0, 1, 0, 0, 0], [1, 1, 0, 0, 1, 0, 0, 0], [1, 0, 1, 1, 0, 0, 0, 0], [0, 1, 1, 0, 1, 0, 0, 0]];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) if (filled[r][c]) o[`${r}_${c}`] = trackLed(r);
        o['0_1'] = WHITE; o['1_1'] = WHITE;
        return o;
    })();
    const selector = Object.fromEntries([...Array(16)].map((_, i) => [i + 1, trackLed(i)]));
    const lit = { back: '#bbbbbb', session: '#777777', shift: '#777777', play: '#777777', rec: '#777777' };

    const f = {};
    f['panel-hero'] = panel({ title: 'Movy on Ableton Move', screen: shot('page_config_pad'), pads: keyPads,
        steps: { 1: T1, 5: T1, 9: T1, 13: T1, 11: T1, 3: GREEN }, leds: { ...lit, play: GREEN, track1: T1, track2: trackLed(1), track3: trackLed(2), track4: trackLed(3) } });
    f['gesture-sets'] = panel({ title: 'Shift + Step 1 opens Sets', screen: shot('sets_list'), held: ['shift', 'step1'],
        leds: { ...lit, shift: WHITE, capture: '#777777', copy: '#777777', delete: '#777777' }, steps: { 1: WHITE, 2: '#777777', 3: '#777777', 5: '#777777', 6: '#777777' } });
    f['gesture-plock'] = panel({ title: 'Hold a step and turn a knob to lock a value', screen: shot('page_held_lock'), pads: keyPads,
        held: ['step13', 'knob3'], steps: { 1: T1, 5: T1, 9: T1, 13: WHITE }, leds: lit });
    f['gesture-session'] = panel({ title: 'Session view: pads launch clips, steps pick tracks', screen: shot('page_master_chain'),
        pads: sessionPads, steps: selector, leds: { ...lit, session: WHITE, track1: T1, track2: trackLed(1), track3: trackLed(2), track4: trackLed(3) } });
    f['gesture-scenes'] = panel({ title: 'Hold Loop in Session view: odd steps launch scenes', screen: shot('song_band'),
        pads: sessionPads, held: ['loop', 'step3'], leds: { ...lit, session: WHITE, loop: WHITE },
        steps: Object.fromEntries([1, 3, 5, 7, 9, 11, 13, 15].map((s) => [s, s <= 5 ? WHITE : GREY_LIT])) });
    f['gesture-generator'] = panel({ title: 'Shift + hold Step 16 runs Smart Quantize', screen: shot('ai_hold_progress_50'), pads: keyPads,
        held: ['shift', 'step16'], leds: { ...lit, shift: WHITE }, steps: { ...Object.fromEntries([1, 2, 3, 5, 6, 7, 9, 10, 12, 14, 15].map((n) => [n, '#777777'])), 16: WHITE } });
    f['gesture-track-volume'] = panel({ title: 'Hold a track button and turn the volume knob', screen: shot('track_volume_unity'), pads: keyPads,
        held: ['track2', 'volume'], leds: { ...lit, track1: T1, track2: trackLed(1), track3: trackLed(2), track4: trackLed(3) } });
    f['gesture-record'] = panel({ title: 'Rec arms recording, Play starts the transport', screen: shot('page_body'), pads: keyPads,
        held: ['rec'], leds: { ...lit, rec: RED, play: GREEN }, steps: { 1: T1, 3: GREEN, 5: T1, 9: T1, 13: T1 } });

    f['session-grid'] = (() => {
        const filled = [[1, 1, 1, 0, 1, 0, 0, 0], [1, 1, 0, 0, 1, 0, 0, 0], [1, 0, 1, 1, 0, 0, 0, 0], [0, 1, 1, 0, 1, 0, 0, 0]];
        const cells = filled.map((row, r) => row.map((x, c) => (c === 1 && r < 2 ? { fill: WHITE, label: '▶' }
            : x ? { fill: trackLed(r), label: '' } : { fill: UNLIT, label: '' })));
        return padGrid(cells, 'Session view clip grid', [[trackLed(0), 'Clip (track colour)'], [WHITE, 'Playing (pulses)'], [UNLIT, 'Empty slot']],
            { rowLabels: ['T1', 'T2', 'T3', 'T4'], colLabels: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'slot ' + n) });
    })();
    f['pads-chromatic-4th'] = melodicLayout(movy.MODE_CHROMATIC, movy.LAYOUT_FOURTHS, 'Chromatic, 4th layout (C major)');
    f['pads-chromatic-piano'] = melodicLayout(movy.MODE_CHROMATIC, movy.LAYOUT_PIANO, 'Chromatic, Piano layout (C major)');
    f['pads-inkey-4th'] = melodicLayout(movy.MODE_IN_KEY, movy.LAYOUT_FOURTHS, 'In Key, 4th layout (C major)');
    f['pads-inkey-inline'] = melodicLayout(movy.MODE_IN_KEY, movy.LAYOUT_INLINE, 'In Key, Inline layout (C major)');
    f['pads-drums-16'] = drumLayout(16, 'A 16-voice drum rack');
    f['pads-drums-32'] = drumLayout(32, 'A 32-voice drum rack');

    const SC = { 1: 'Sets', 2: 'Settings', 3: 'Clip', 5: 'Set', 6: 'Metro-\nnome', 7: 'Set', 9: 'Set', 10: 'Full\nvelocity',
        12: 'CPU', 14: 'Variation\n(hold)', 15: 'Double\n(hold:\nSmart)', 16: 'Quantize\n(hold:\nSmart)' };
    f['steps-shortcuts'] = stepRow([...Array(16)].map((_, i) => SC[i + 1] ? { top: SC[i + 1], fill: '#777777' } : {}),
        'Shift + Step shortcuts', { caption: 'Hold Shift, then press a step' });
    f['steps-mute-map'] = stepRow([...Array(16)].map((_, i) => ({ fill: [2, 6].includes(i) ? trackDim(i) : trackLed(i),
        bottom: [2, 6].includes(i) ? 'muted' : 'T' + (i + 1), bottomFill: [2, 6].includes(i) ? '#888' : '#ddd' })),
        'Mute map', { caption: 'Hold Mute: one step per track, dim = silenced', groups: true });
    f['steps-track-selector'] = stepRow([...Array(16)].map((_, i) => ({ fill: trackLed(i), ring: i >= 4 && i < 8 ? '#ffffff' : null,
        bottom: 'T' + (i + 1) })), 'Track selector', { caption: 'Session view: each step opens a track; the focused group pulses', groups: true });
    f['steps-scenes'] = stepRow([...Array(16)].map((_, i) => (i % 2 ? {} : { fill: GREY_LIT, top: 'Scene\n' + (i / 2 + 1) })),
        'Scene launcher', { caption: 'Session view, Loop held: the odd steps are scenes 1-8' });
    const BAR = (i) => (i === 3 ? [GREEN, 'playing'] : i === 4 ? [WHITE, 'selected'] : i >= 2 && i <= 5 ? [T1, 'loop'] : i < 8 ? [GREY_DIM, ''] : [null, '']);
    f['steps-loop-bars'] = stepRow([...Array(16)].map((_, i) => ({ fill: BAR(i)[0], bottom: BAR(i)[1] })),
        'Loop view bar selector', { caption: 'Loop view: one step per bar; an 8-bar clip looping bars 3-6' });

    f['signal-flow'] = signalFlow();
    return f;
}

function signalFlow() {
    const box = (x, y, w, h, label, fill = '#2e2e2e', ink = '#eee', sub = '') =>
        rrect(x, y, w, h, 6, `fill="${fill}" stroke="#555"`) + text(x + w / 2, y + h / 2 - (sub ? 6 : 0), label, { size: 13, weight: 600, fill: ink })
        + (sub ? text(x + w / 2, y + h / 2 + 9, sub, { size: 10, fill: '#aaa' }) : '');
    const arrow = (x1, y1, x2, y2, dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#888" stroke-width="1.6" ${dash} marker-end="url(#a)"/>`;
    const line = (pts, dash = '') => `<polyline points="${pts}" fill="none" stroke="#888" stroke-width="1.6" ${dash}/>`;
    const DASH = 'stroke-dasharray="5 4"';
    const W = 880, H = 372;
    let s = `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#888"/></marker></defs>`;
    s += rrect(0, 0, W, H, 10, `fill="${BODY}"`);
    s += rrect(16, 30, 568, 84, 8, 'fill="none" stroke="#444"');
    s += text(28, 44, 'EACH TRACK (x16)', { size: 11, anchor: 'start', fill: '#999', weight: 700 });
    [['MIDI FX'], ['SYNTH'], ['FX 1'], ['FX 2'], ['MIX', 'vol · pan · sends']].forEach(([l, sub], i) => {
        const x = 32 + i * 110;
        s += box(x, 56, 94, 46, l, i === 4 ? '#3a3320' : '#2e2e2e', '#eee', sub);
        if (i) s += arrow(x - 15, 79, x - 1, 79);
    });
    s += box(16, 124, 420, 26, 'LFO 1 · LFO 2 modulate this track', '#232b33', '#9cc4e4');
    s += text(28, 180, 'SEND FX', { size: 11, anchor: 'start', fill: '#999', weight: 700 });
    s += line('519,102 519,172', DASH) + line('300,172 519,172', DASH);
    for (const x of [300, 410, 519]) s += arrow(x, 172, x, 190, DASH);
    s += text(410, 163, 'sends', { size: 11, fill: '#aaa' });
    ['SEND 1', 'SEND 2', 'SEND 3'].forEach((l, i) => { s += box(250 + i * 110, 192, 100, 36, l, '#2b2638'); });
    for (const x of [300, 410, 519]) s += line(`${x},228 ${x},250`);
    s += line('300,250 640,250 640,96');
    s += arrow(584, 79, 624, 79);
    s += `<circle cx="640" cy="79" r="15" fill="#2e2e2e" stroke="#888" stroke-width="1.6"/>` + text(640, 80, '+', { size: 18, weight: 700 });
    s += arrow(640, 250, 640, 96);
    s += text(700, 20, 'MASTER CHAIN', { size: 11, anchor: 'start', fill: '#999', weight: 700 });
    s += arrow(655, 79, 698, 46);
    const chain = [['MFX 1'], ['MFX 2'], ['MFX 3'], ['MFX 4'], ['MASTER VOLUME', 'volume knob'], ['LIMITER', 'stops clipping'], ['OUTPUT']];
    chain.forEach(([l, sub], i) => {
        const y = 30 + i * 47, last = i === chain.length - 1;
        s += box(700, y, 164, 36, l, last ? '#203a26' : '#2e2e2e', last ? '#bfe8c8' : '#eee', sub);
        if (i) s += arrow(782, y - 11, 782, y - 1);
    });
    s += box(16, 300, 420, 26, 'Master LFO 1 · 2 modulate the master FX', '#232b33', '#9cc4e4');
    return svgDoc(W, H, s, 'Movy signal flow: 16 track chains, three send FX and the master chain');
}

export { ACCENT };
