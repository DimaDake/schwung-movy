import { recordParamOp } from '../undo/record.js';
import { undoableEdit } from '../undo/edit.js';
import { lfoKey, type LfoScope } from './scope.js';
/* Slot-LFO target read/write helpers. Blocking writes for the multi-field
 * target commit — the overtake param SHM is a single slot, so consecutive
 * non-blocking writes clobber each other and the target never persists. */

function readLfo(scope: LfoScope, key: string): string {
    return scope.port.getParam(key) ?? '';
}

/* Blocking, and recorded: the three keys below are one gesture, so they belong
 * to one undo entry rather than three.
 *
 * Through the PORT, never `shadow_set_param_timeout` directly: that API is
 * addressed by schwung slot and refuses anything past slot 3, so on a movy track
 * (5-16, a chain in movy's own engine) it wrote nothing at all and the LFO was
 * never assigned. The port knows which kind of track it is holding. */
function setBlocking(scope: LfoScope, key: string, val: string): void {
    const old = readLfo(scope, key);
    if (old !== val) recordParamOp(scope.slot, key, old, val);
    scope.port.setParamTimeout(key, val, 100);
}

export function lfoTargetsParam(scope: LfoScope, lfoIdx: number, comp: string, param: string): boolean {
    return !!comp
        && scope.port.getParam(lfoKey(scope, lfoIdx, 'target')) === comp
        && scope.port.getParam(lfoKey(scope, lfoIdx, 'target_param')) === param;
}

export function assignLfoTarget(scope: LfoScope, lfoIdx: number, comp: string, param: string): void {
    undoableEdit('ASSIGN LFO', scope.label + ' LFO ' + (lfoIdx + 1), () => {
        /* Capture the target param's value BEFORE the LFO starts driving it.
         * Clearing target/target_param/enabled alone would strand the knob
         * wherever the LFO happened to park it — a value the user never chose.
         * Recording it here is what lets undo put the knob back. */
        const driven = scope.keyPrefix + comp + ':' + param;
        const before = readLfo(scope, driven);
        if (before !== '') recordParamOp(scope.slot, driven, before, before);
        setBlocking(scope, lfoKey(scope, lfoIdx, 'target'), comp);
        setBlocking(scope, lfoKey(scope, lfoIdx, 'target_param'), param);
        setBlocking(scope, lfoKey(scope, lfoIdx, 'enabled'), '1');
    });
}

export function clearLfoTarget(scope: LfoScope, lfoIdx: number): void {
    undoableEdit('CLEAR LFO', scope.label + ' LFO ' + (lfoIdx + 1), () => {
        setBlocking(scope, lfoKey(scope, lfoIdx, 'target'), '');
        setBlocking(scope, lfoKey(scope, lfoIdx, 'target_param'), '');
        setBlocking(scope, lfoKey(scope, lfoIdx, 'enabled'), '0');
    });
}
