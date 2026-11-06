/* The Set's key moved (ROOT or KEY on the main page, or their undo) under New
 * Clip sessions still open or parked. A part made from nothing took its key
 * from the Set, so it follows; parts made beside each other in one scene
 * follow together and stay in tune. A session that hears a clip no live New
 * Clip made took its key from that clip's notes, and stays. Each note keeps
 * its scale degree (gen/theory/pc.ts retune): the options as edited, and the
 * session's undo steps, so a step back does not land in the old key. A parked
 * session's knobs catch up when it resumes (preview-refresh.ts). */

import { appState, trackIsDrum } from '../app/state.js';
import { mlog } from '../log.js';
import { keyboardState } from '../keyboard/state.js';
import { seqState } from '../seq/state.js';
import { prepare } from '../gen/engine.js';
import { keyHint } from '../gen/theory/key.js';
import { retune, stepsOf } from '../gen/theory/pc.js';
import type { GenInput, Key, Note } from '../gen/types.js';
import { knobsCtx, knobsRecontext } from './preview-knobs.js';
import { keyOf, type Open, S, writeNotes } from './preview-state.js';
import { sessionFlush } from './preview-undo.js';
import { clipKey, parkedSessions } from './sessions.js';
import { setHeader } from './set-input.js';

let last = '';
let from: Key | null = null;

const keyOfSet = (): Key | null => {
    const h = setHeader(), k = keyHint(h.root, h.mode);
    return k ? { ...k, score: 0 } : null;
};

const inputOf = (o: Open): GenInput | null => (o === S.cur ? knobsCtx()?.input : o.knobs?.ctx?.input) ?? null;

/* Every melodic clip in its scene is another live New Clip's, or was empty
 * when it ran; one made since is not known to be empty, so it counts. */
function follows(o: Open, input: GenInput, live: Set<string>): boolean {
    return seqState.session.every((st, t) => {
        if (t === o.p.track || trackIsDrum(t) || !(st.exist & (1 << o.p.slot)) || live.has(clipKey(t, o.p.slot))) return true;
        const was = input.tracks.find((x) => x.index === t)?.clips.find((c) => c.slot === o.p.slot);
        return !!was && !was.notes.length;
    });
}

function retuneSession(o: Open, input: GenInput, move: (ns: Note[]) => Note[]): void {
    if (o === S.cur) sessionFlush(o);   // a turn or edit still open is in the old key: it moves too
    o.p.options = o.p.options.map(move);
    o.steps.map((s) => ({ ...s, options: s.options.map(move) }));
    /* The stash holds the old notes: every option is written fresh from here. */
    o.visited = o.visited.map((_, i) => i === 0);
    if (o.index > 0) writeNotes(o, o.index);
    if (o !== S.cur) return;
    const h = setHeader();
    const tracks = input.tracks.map((t) => (t.drum ? t
        : { ...t, clips: t.clips.map((c) => (c.slot === o.p.slot ? { ...c, notes: move(c.notes) } : c)) }));
    knobsRecontext(prepare({ ...input, tracks, root: h.root, mode: h.mode }));
}

/** Per tick, a session open or not: a change of key is acted on once. */
export function retuneTick(): void {
    const now = keyboardState.rootPc + ':' + keyboardState.scale;
    if (now === last) return;
    const was = from;
    last = now;
    from = keyOfSet();
    const to = from;
    /* Major to its pentatonic, say: every note stays where it is. */
    if (!was || !to || (was.tonic === to.tonic && stepsOf(was).join() === stepsOf(to).join())) return;
    const all = [S.cur, ...parkedSessions<Open>()].filter((o): o is Open => !!o && o.p.task === 'create');
    const live = new Set(all.map(keyOf));
    const move = (ns: Note[]): Note[] => ns.map((n) => {
        let p = retune(n.pitch, was, to);
        while (p > 127) p -= 12;
        while (p < 0) p += 12;
        return { ...n, pitch: p };
    });
    for (const o of all) {
        const input = inputOf(o);
        if (!input || input.drum || !follows(o, input, live)) continue;
        retuneSession(o, input, move);
        mlog(`ai: t${o.p.track} s${o.p.slot} retuned to the Set's key`);
    }
    appState.dirty = true;
}
