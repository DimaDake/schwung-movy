import { invalidateLedCachesOnResume } from './tick.js';
import { mlog } from '../log.js';

/* Called by the host once each time movy returns from background (parked →
 * resumed). init() is NOT re-run. Our on-change LED/screen caches went stale
 * while the sequencer advanced under Move's native UI, so force a full repaint. */
export function onResume(): void {
    mlog('resume from background');
    invalidateLedCachesOnResume();
}
