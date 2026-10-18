/* The engine's `status`, parsed into the mirror (seq/state.ts).
 *
 * Format: space-separated key=value pairs, e.g. "play=1 tick=4321 bpm=12000
 * trk=0 step=3 len=16 occ=<64 hex>". Unknown keys are ignored so the engine
 * can extend the format freely. Since WP10 the text comes from movy-host's
 * snapshot (seq/engine.ts), published after every render, rather than from a
 * poll. */

import { mlog } from '../log.js';
import { AUTO_LANES } from './constants.js';
import { activeFromStr, adoptLoopWindow, muteFromStr, occFromHex, padMutesFromStr, seqState, sessionFromStr, songFromStr } from './state.js';
import { rationalToIdx } from './clip-scale.js';
import { noteProbeGen } from './probe-bridge.js';
import { markUiStateDirty } from './ui-dirty.js';
import { noteReportedTrack } from './watch.js';
import { requestLabelSync } from './label-sync.js';

/* -1 until the first status: the opening value is not a change, and treating
 * it as one would mark every fresh open dirty and rewrite the set for nothing. */
let lastChainGen = -1;
/* The count of Sets the engine has APPLIED, as of the last status. -1 is
 * "never seen", and unlike `lastChainGen` the first real value IS acted on —
 * see the `sapl` arm. */
let lastSetApplied = -1;
/* The engine reports (via `unop`) that a committed group changed nothing. Held
 * here and drained by the app tick rather than dispatched directly, so this
 * file keeps no import of undo/ — which imports the engine bridge. */
let noopSnapId = -1;
let lastNoop = -1;

export function takeNoopSnapId(): number {
    const id = noopSnapId;
    noopSnapId = -1;
    return id;
}

/* Status format: space-separated key=value pairs, e.g.
 * "play=1 tick=4321 bpm=12000 trk=0 step=3 len=16 occ=<64 hex>". Unknown
 * keys are ignored so the engine can extend the format freely. */

/* Engine-reported play state from the previous poll — kept separately from
 * the mirror (which the UI updates optimistically) so real transport
 * transitions are always logged. */
let lastEnginePlay: boolean | null = null;

export function parseStatus(s: string): void {
    seqState.engineOk = true;
    /* Cleared each poll rather than only overwritten: an engine that predates
     * the fields sends none of them, and last poll's numbers standing in for
     * this one is exactly the meter lying. */
    seqState.cpuCost = '';
    seqState.mixMeter = '';
    seqState.cpuWall = '';
    seqState.cpuMask = '';
    seqState.cpuSend = '';
    seqState.cpuMaster = '';
    for (const kv of s.split(' ')) {
        const eq = kv.indexOf('=');
        if (eq <= 0) continue;
        const key = kv.slice(0, eq);
        const val = kv.slice(eq + 1);
        if (key === 'play') seqState.playing = val === '1';
        else if (key === 'tick') seqState.engineTick = Number(val) || 0;
        else if (key === 'bpm') seqState.bpmX100 = Number(val) || seqState.bpmX100;
        else if (key === 'ext') seqState.extSync = val === '1';
        else if (key === 'swing') seqState.swingPct = Number(val) || seqState.swingPct;
        else if (key === 'trk') {
            seqState.reportedTrack = Number(val) || 0;
            noteReportedTrack(seqState.reportedTrack);
        }
        else if (key === 'step') seqState.curStep = Number(val) || 0;
        else if (key === 'len') seqState.lenSteps = Number(val) || 0;
        else if (key === 'lstart') seqState.loopStart = Number(val) || 0;
        else if (key === 'csc') {
            const [n, d] = val.split('/').map(Number);
            seqState.clipScaleIdx = rationalToIdx(n || 1, d || 1);
        }
        else if (key === 'ctr') seqState.clipTranspose = Number(val) || 0;
        else if (key === 'quant') seqState.clipQuant = Number(val) || 0;
        else if (key === 'dquant') seqState.defaultQuant = Number(val) || 0;
        /* The engine's count of serviced chain-module changes. A movy chain
         * lives only inside the engine, so the UI cannot know it changed unless
         * the engine says so — and it must be persisted whoever changed it: a
         * browser load, an undo, a restore, or a remote param write the UI never
         * saw. Watching a counter covers all of them; hooking the browser
         * gesture would have covered only the first. */
        else if (key === 'chgen') {
            const g = Number(val) || 0;
            if (lastChainGen >= 0 && g !== lastChainGen) markUiStateDirty();
            lastChainGen = g;
        }
        /* The engine has applied a Set — which is the moment `alabels` starts
         * answering for THAT Set and not the previous one. An open is
         * asynchronous (the UI asks by name; the bytes land on the saver thread
         * hundreds of ms later), and `openSet`'s own `requestLabelSync` is
         * armed at REQUEST time, so its one shot was routinely spent reading
         * the outgoing Set's labels — all dashes on a cold open. The registry
         * then stayed empty for the whole session: no automation dot, no held
         * value, no read-back suppression, and the take still on disk. Asking
         * again here cannot race it, because this counter only moves once the
         * payload is in the engine. */
        else if (key === 'sapl') {
            const a = Number(val) || 0;
            /* The FIRST value counts as a change, unlike `chgen` above: there a
             * change means a write (mark the set dirty), so an opening value
             * must be swallowed, while here it means a read the UI needs anyway
             * — its registry starts empty and the engine may have been holding
             * this Set since before movy launched. Swallowing the first value
             * would leave exactly the cold open this fixes unsynced. */
            if (a !== lastSetApplied) {
                requestLabelSync();
            }
            lastSetApplied = a;
        }
        else if (key === 'prq') noteProbeGen(Number(val) || 0);
        else if (key === 'chpend') seqState.chainPending = Number(val) || 0;
        else if (key === 'sbad') seqState.setBad = val === '-' ? '' : val;
        else if (key === 'chcost') seqState.cpuCost = val;
        else if (key === 'mtr') seqState.mixMeter = val;
        else if (key === 'chwall') seqState.cpuWall = val;
        else if (key === 'chmask') seqState.cpuMask = val;
        else if (key === 'sndcost') seqState.cpuSend = val;
        else if (key === 'mfxcost') seqState.cpuMaster = val;
        else if (key === 'rec') seqState.recording = val === '1';
        else if (key === 'cin') seqState.countingIn = val === '1';
        else if (key === 'cap') {
            const [p, g] = val.split('.');
            seqState.capPending = Number(p) || 0;
            seqState.capGen = Number(g) || 0;
        }
        else if (key === 'metro') seqState.metro = val === '1';
        else if (key === 'dirty') seqState.dirty = val === '1';
        else if (key === 'pos') seqState.posTick = Number(val) || 0;
        else if (key === 'hlen') seqState.holdLen = Number(val) || 0;
        else if (key === 'hnotes') {
            seqState.holdNotes = val
                ? val.split('.').map(Number).filter((n) => n >= 0 && n <= 127)
                : [];
        }
        else if (key === 'hvel') seqState.holdVel = Number(val) || 0;
        else if (key === 'hgate') seqState.holdGate = Number(val) || 0;
        else if (key === 'hgmix') seqState.holdGateMixed = val === '1';
        else if (key === 'hprob') seqState.holdProb = Number(val) || 0;
        else if (key === 'hcond') {
            const [a, b] = val.split(':').map(Number);
            seqState.holdCondA = a || 1;
            seqState.holdCondB = b || 1;
        }
        else if (key === 'hinv') seqState.holdInvert = val === '1';
        else if (key === 'hlmax') seqState.holdMaxGate = Number(val) || 0;
        else if (key === 'act') activeFromStr(val);
        else if (key === 'mute') muteFromStr(val);
        else if (key === 'wpad') padMutesFromStr(val);
        else if (key === 'sess') sessionFromStr(val);
        else if (key === 'song') songFromStr(val);
        else if (key === 'occ') occFromHex(val);
        /* Reported on every status until the next no-op replaces it (the
         * snapshot is read every block, so the engine no longer drains it):
         * acted on once, when it changes. */
        else if (key === 'unop') {
            const id = Number(val);
            if (id !== lastNoop) { lastNoop = id; noopSnapId = id; }
        }
        else if (key === 'alanes') seqState.autoAssigned = parseInt(val, 16) || 0;
        else if (key === 'aauto') seqState.autoActive = parseInt(val, 16) || 0;
        else if (key === 'hauto') {
            seqState.heldLocks.clear();
            if (val) for (const pair of val.split('.')) {
                const [l, v] = pair.split(':').map(Number);
                if (l >= 0 && l < AUTO_LANES) seqState.heldLocks.set(l, v);
            }
        }
    }
    adoptLoopWindow();   // a window the UI has not seen before takes the view with it
    if (lastEnginePlay !== seqState.playing) {
        mlog('seq: play=' + (seqState.playing ? 1 : 0));
        lastEnginePlay = seqState.playing;
    }
}


/* Test hook: drive parseStatus directly. */
export function parseStatusForTest(s: string): void { parseStatus(s); }

/** A fresh engine session: nothing seen yet. */
export function resetEngineStatus(): void {
    lastEnginePlay = null;
    /* A new engine starts its chain generation at 0 again; carrying the old
     * value across would read as a change and dirty the set for nothing. */
    lastChainGen = -1;
    /* And for the same reason: a new engine has applied nothing yet, so its
     * first `sapl` is an opening value rather than a Set that just landed. */
    lastSetApplied = -1;
    noopSnapId = -1;
    lastNoop = -1;
}
