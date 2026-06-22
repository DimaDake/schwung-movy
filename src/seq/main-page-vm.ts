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

export function buildMainPageVM(): ViewModel {
    const bpm   = Math.round(seqState.bpmX100 / 100);
    const swing = seqState.swingPct;
    const scale = keyboardState.scale;

    const tempo = cell({
        shortName: 'TEMPO', fullName: 'Tempo', renderStyle: 'preset',
        displayValue: String(bpm),
    });
    const sw = cell({
        shortName: 'SWING', fullName: 'Swing', renderStyle: 'preset',
        displayValue: swing + '%',
    });
    const root = cell({
        shortName: 'ROOT', fullName: 'Root', renderStyle: 'preset',
        displayValue: rootName(),
    });
    const key = cell({
        shortName: 'KEY', fullName: 'Key', type: 'enum',
        options: SCALE_NAMES, isLongEnum: true,
        enumIndex: scale, displayValue: SCALE_NAMES[scale],
    });

    const cells = [tempo, sw, root, key];
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
        moduleName: 'MAIN', bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[tempo, sw, root, key], [null, null, null, null]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
