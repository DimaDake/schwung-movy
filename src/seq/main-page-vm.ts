/* Builds the Main Params page ViewModel. Knob 0 tempo, 1 swing, 2 root, 3 key.
 * Big-font 'preset' cells for tempo/swing/root; key is an enum that opens the
 * scrollable scale overlay. Mirrors step-page-vm's cell/toast conventions. */

import type { ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from './param-vm.js';
import { mainPageState } from './main-page.js';
import { seqState } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALE_NAMES } from './scales.js';
import { midiNoteName } from '../keyboard/notes.js';

/* Root note name without the octave (the layout tonic's pitch class). */
function rootName(): string {
    return midiNoteName(keyboardState.rootNote).replace(/-?\d+$/, '');
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function buildMainPageVM(): ViewModel {
    const bpm   = Math.round(seqState.bpmX100 / 100);
    const swing = seqState.swingPct;
    const scale = keyboardState.scale;
    const rootPc = (((keyboardState.rootNote % 12) + 12) % 12);

    // normalizedValue drives the under-knob LED brightness (knobs 0-3 lit, 4-7
    // off): tempo over 20-300, swing over 50-80, root over its 12 pitch classes,
    // key over the scale list.
    // While following Move's transport the tempo is Move's; mark the cell EXT
    // (the preset cell drops to the small font for the non-numeric value).
    const tempo = cell({
        shortName: 'TEMPO', fullName: 'Tempo', renderStyle: 'preset',
        displayValue: seqState.extSync ? bpm + ' EXT' : String(bpm),
        normalizedValue: clamp01((bpm - 20) / 280),
    });
    const sw = cell({
        shortName: 'SWING', fullName: 'Swing', renderStyle: 'preset',
        displayValue: swing + '%', normalizedValue: clamp01((swing - 50) / 30),
    });
    const root = cell({
        shortName: 'ROOT', fullName: 'Root', renderStyle: 'preset',
        displayValue: rootName(), normalizedValue: rootPc / 11,
    });
    const key = cell({
        shortName: 'KEY', fullName: 'Key', type: 'enum',
        options: SCALE_NAMES, isLongEnum: true,
        enumIndex: scale, displayValue: SCALE_NAMES[scale],
        normalizedValue: SCALE_NAMES.length > 1 ? scale / (SCALE_NAMES.length - 1) : 0,
    });
    // Knob 4: bidirectional Move transport link (Play/Stop propagation). OFF by
    // default; clock-follow (EXT) works regardless. A plain on/off enum.
    const linkOn = seqState.linkEnabled;
    const link = cell({
        shortName: 'LINK', fullName: 'Play Link', type: 'enum',
        options: ['OFF', 'ON'], enumIndex: linkOn ? 1 : 0,
        displayValue: linkOn ? 'ON' : 'OFF', normalizedValue: linkOn ? 1 : 0,
    });

    const cells = [tempo, sw, root, key, link];
    const tk = mainPageState.touchedKnob;
    let toast = null;
    if (tk >= 0 && tk < cells.length) {
        cells[tk].touched = true;
        // Tempo's toast carries the unit; the others mirror the cell value.
        const value = tk === 0 ? bpm + ' bpm' : cells[tk].displayValue;
        toast = { fullName: cells[tk].fullName, value, browseHint: false };
    }

    const overlay = mainPageState.scaleOverlay
        ? { slot: 3, options: SCALE_NAMES, selected: mainPageState.scaleSel }
        : null;

    return {
        moduleName: 'SET PARAMETERS', headerOverride: 'SET PARAMETERS',
        bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[tempo, sw, root, key], [link, null, null, null]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
