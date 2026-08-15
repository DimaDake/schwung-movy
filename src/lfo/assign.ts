import { portFor } from '../track/registry.js';
import { recordParamOp } from '../undo/record.js';
import { undoableEdit } from '../undo/edit.js';
/* Slot-LFO target read/write helpers. Blocking writes for the multi-field
 * target commit — the overtake param SHM is a single slot, so consecutive
 * non-blocking writes clobber each other and the target never persists. */

function lfoKey(lfoIdx: number, key: string): string { return 'lfo' + (lfoIdx + 1) + ':' + key; }

function readLfo(track: number, key: string): string {
    return portFor(track).getParam(key) ?? '';
}

/* Blocking, and recorded: the three keys below are one gesture, so they belong
 * to one undo entry rather than three. */
function setBlocking(track: number, key: string, val: string): void {
    const old = readLfo(track, key);
    if (old !== val) recordParamOp(track, key, old, val);
    if (typeof shadow_set_param_timeout === 'function') shadow_set_param_timeout(track, key, val, 100);
    else portFor(track).setParam(key, val);
}

export function lfoTargetsParam(track: number, lfoIdx: number, comp: string, param: string): boolean {
    return !!comp
        && portFor(track).getParam( lfoKey(lfoIdx, 'target')) === comp
        && portFor(track).getParam( lfoKey(lfoIdx, 'target_param')) === param;
}

export function assignLfoTarget(track: number, lfoIdx: number, comp: string, param: string): void {
    undoableEdit('ASSIGN LFO', 'T' + (track + 1) + ' LFO ' + (lfoIdx + 1), () => {
        /* Capture the target param's value BEFORE the LFO starts driving it.
         * Clearing target/target_param/enabled alone would strand the knob
         * wherever the LFO happened to park it — a value the user never chose.
         * Recording it here is what lets undo put the knob back. */
        const driven = comp + ':' + param;
        const before = readLfo(track, driven);
        if (before !== '') recordParamOp(track, driven, before, before);
        setBlocking(track, lfoKey(lfoIdx, 'target'), comp);
        setBlocking(track, lfoKey(lfoIdx, 'target_param'), param);
        setBlocking(track, lfoKey(lfoIdx, 'enabled'), '1');
    });
}

export function clearLfoTarget(track: number, lfoIdx: number): void {
    undoableEdit('CLEAR LFO', 'T' + (track + 1) + ' LFO ' + (lfoIdx + 1), () => {
        setBlocking(track, lfoKey(lfoIdx, 'target'), '');
        setBlocking(track, lfoKey(lfoIdx, 'target_param'), '');
        setBlocking(track, lfoKey(lfoIdx, 'enabled'), '0');
    });
}
