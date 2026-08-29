/* What "switch to track N" actually means, in one place.
 *
 * A track switch is nine coordinated moves, not one assignment: close the
 * global pages, drop live notes, move the focus, retarget the step view AND the
 * engine's watch target, reset the bar offset, adopt the new clip's loop window,
 * restore that track's remembered view, and repaint. The track buttons did all
 * nine inline in midi/router.ts while the Session step selector did one
 * (`selectTrack`), so selecting a track from the step row moved the screen and
 * the pads but left `watchTrack` — and therefore every step edit — on the track
 * you came from. The engine re-pins `watchTrack` from `trk=` on every status
 * poll, so it never caught up on its own.
 *
 * Both callers go through here now, which is the only way the two can't drift
 * apart again. The watch retarget itself lives in seq/watch.ts, because the
 * Session grid and the tool's own open retarget it without switching tracks. */

import { appState, VIEW_BROWSE } from '../app/state.js';
import { jogHintTouch } from '../app/jog-hint.js';
import { mlog } from '../log.js';
import { releaseAllLive } from '../keyboard/release.js';
import { closeParamPage, paramPageActive } from '../seq/param-page.js';
import { seqState } from '../seq/state.js';
import { setWatchTrack } from '../seq/watch.js';
import { selectTrack } from './focus.js';
import { chainInstance, trackKind } from './ref.js';

/** Everything a momentary track peek has to put back on release. */
export interface TrackSnapshot {
    track: number;
    view: number;
    session: boolean;
    loop: boolean;
}

/* Snapshot the state a peek reverts to. Closes the Main/Clip Params pages
 * first: they are global pages, not per-track views, so capturing the view
 * before closing them would save one into `trackView[]` and re-show it when the
 * track comes back. */
export function beginTrackSwitch(): TrackSnapshot {
    if (paramPageActive()) appState.currentView = closeParamPage();
    return {
        track: appState.activeTrack.index,
        view: appState.currentView === VIEW_BROWSE ? appState.browseOrigin : appState.currentView,
        session: seqState.sessionMode,
        loop: seqState.loopMode,
    };
}

/* Logged because a device measurement has no other way to prove WHICH track it
 * measured. The pad-latency run silently compared a host track against itself:
 * the gesture that was meant to select a movy track left the UI in Session mode
 * instead, both rows read identical, and nothing in the log contradicted them. */
function logSwitch(track: number): void {
    mlog('track: active=' + track + ' kind=' + trackKind(track)
        + (trackKind(track) === 'movy' ? ' chain=' + chainInstance(track) : ''));
}

function repaint(): void {
    appState.initLedsDone = false;
    appState.initLedIndex = 0;
    appState.dirty = true;
}

/** Commit a switch to `track`. `prev` comes from `beginTrackSwitch()`. */
export function switchToTrack(track: number, prev: TrackSnapshot): void {
    appState.trackView[prev.track] = prev.view;
    seqState.sessionMode = false;
    seqState.loopMode = false;
    appState.masterDetail = false;
    releaseAllLive();   // no live note outlives the track it was played on
    selectTrack(track);
    appState.currentView = appState.trackView[track];
    setWatchTrack(track);
    jogHintTouch(false);
    logSwitch(track);
    repaint();
}

/** Undo a switch — the restore closure of a momentary track peek. */
export function restoreTrackState(prev: TrackSnapshot): void {
    releaseAllLive();   // the peeked track's notes must not survive the revert
    seqState.sessionMode = prev.session;
    seqState.loopMode = prev.loop;
    selectTrack(prev.track);
    appState.currentView = prev.view;
    setWatchTrack(prev.track);
    logSwitch(prev.track);
    repaint();
}
