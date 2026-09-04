/* Builds the Main Params page ViewModel. Row 0 is TEMPO / SWING / LINK / QUANT, row 1
 * ROOT / KEY / MODE / LAYOUT. Big-font 'preset' cells for tempo/swing/root; key,
 * mode and layout are enums that open the scrollable overlay. Mirrors
 * step-page-vm's cell/toast conventions. */

import type { ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from './param-vm.js';
import { mainPageState, overlayOptions } from './main-page.js';
import { seqState } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { SCALE_NAMES } from './scales.js';
import { midiNoteName } from '../keyboard/notes.js';
import { QUANT_LABELS, quantIndexForPct } from './quant.js';

/* Tonic name without the octave suffix — midiNoteName(0) is 'C-1'. */
function rootName(): string {
    return midiNoteName(keyboardState.rootPc).replace(/-?\d+$/, '');
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function buildMainPageVM(): ViewModel {
    const bpm   = Math.round(seqState.bpmX100 / 100);
    const swing = seqState.swingPct;
    const scale = keyboardState.scale;

    // normalizedValue drives the under-knob LED brightness: tempo over 20-300,
    // swing over 50-80, root over its 12 pitch classes, the enums over their
    // option lists.
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
    // Knob 2: bidirectional Move transport link (Play/Stop propagation). OFF by
    // default; clock-follow (EXT) works regardless. Drawn as the on/off switch —
    // this page builds its cells by hand, so it has to name the style that
    // model/toggle.ts infers for every module boolean.
    const linkOn = seqState.linkEnabled;
    const link = cell({
        shortName: 'LINK', fullName: 'Play Link', renderStyle: 'switch',
        displayValue: linkOn ? 'ON' : 'OFF', normalizedValue: linkOn ? 1 : 0,
    });
    // Knob 3: the quantization new clips are born with. Same enum-square
    // treatment as the step page's PROB cell.
    const dq = seqState.defaultQuant;
    const quant = cell({
        shortName: 'QUANT', fullName: 'Default Quantize', type: 'enum',
        options: QUANT_LABELS, enumIndex: quantIndexForPct(dq),
        displayValue: dq + '%', normalizedValue: clamp01(dq / 100),
    });
    const root = cell({
        shortName: 'ROOT', fullName: 'Root', renderStyle: 'preset',
        displayValue: rootName(), normalizedValue: keyboardState.rootPc / 11,
    });
    const key = cell({
        shortName: 'KEY', fullName: 'Key', type: 'enum',
        options: SCALE_NAMES, isLongEnum: true,
        enumIndex: scale, displayValue: SCALE_NAMES[scale],
        normalizedValue: SCALE_NAMES.length > 1 ? scale / (SCALE_NAMES.length - 1) : 0,
    });
    const mode = cell({
        shortName: 'MODE', fullName: 'Note Mode', type: 'enum',
        options: MODE_NAMES, isLongEnum: true,
        enumIndex: keyboardState.mode, displayValue: MODE_NAMES[keyboardState.mode],
        normalizedValue: keyboardState.mode / (MODE_NAMES.length - 1),
    });
    const lNames = layoutNames(keyboardState.mode);
    const li = Math.min(keyboardState.layout, lNames.length - 1);
    const layout = cell({
        shortName: 'LAYOUT', fullName: 'Pad Layout', type: 'enum',
        options: lNames, isLongEnum: true,
        enumIndex: li, displayValue: lNames[li],
        normalizedValue: lNames.length > 1 ? li / (lNames.length - 1) : 0,
    });

    // Knob-indexed, not cell-order-indexed, so the toast always names the knob
    // that was touched rather than a neighbour.
    const cells = [tempo, sw, link, quant, root, key, mode, layout];
    const tk = mainPageState.touchedKnob;
    const touched = tk >= 0 && tk < cells.length ? cells[tk] : null;
    let toast = null;
    if (touched) {
        touched.touched = true;
        // Tempo's toast carries the unit; the others mirror the cell value.
        toast = {
            fullName: touched.fullName,
            value: tk === 0 ? bpm + ' bpm' : touched.displayValue,
            browseHint: false,
        };
    }

    const overlay = mainPageState.overlayKnob >= 0
        ? {
            slot: mainPageState.overlayKnob,
            options: overlayOptions(mainPageState.overlayKnob),
            selected: mainPageState.overlaySel,
            shapeIds: null,   // key/mode/layout lists, never waveforms
        }
        : null;

    return {
        moduleName: 'SET PARAMETERS', headerOverride: 'SET PARAMETERS',
        bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[tempo, sw, link, quant], [root, key, mode, layout]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadScoped: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
