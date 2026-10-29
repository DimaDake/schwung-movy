/* Loop Mode set a length while a New Clip preview is open: every option is
 * made again at it from its own knobs and the preview stays open (the user
 * sizes the clip without leaving the generator). */

import { mlog } from '../log.js';
import { prepare } from '../gen/engine.js';
import { setLoopLengthHook } from '../seq/loop-hook.js';
import { knobsCtx, knobsRemake } from './preview-knobs.js';
import { previewInputOpen, previewRemade } from './preview.js';

/** true = the length was taken here. */
export function previewRelength(len: number): boolean {
    const p = previewInputOpen();
    const c = knobsCtx();
    if (!p || p.task !== 'create' || !c) return false;
    if (len === p.len) return true;
    const ctx = prepare({ ...c.input, len });
    const options = knobsRemake(ctx);
    if (p.gen) p.gen.ctx = ctx;
    mlog(`ai: preview remade at ${len} steps`);
    previewRemade(len, options);
    return true;
}
setLoopLengthHook(previewRelength);
