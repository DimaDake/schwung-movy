import { invalidateLedCachesOnResume } from './tick.js';
import { claimLedOwnership } from './led-ownership.js';
import { mlog } from '../log.js';

/* Called by the host once each time movy returns from background (parked →
 * resumed). init() is NOT re-run. Our on-change LED/screen caches went stale
 * while the sequencer advanced under Move's native UI, so force a full repaint
 * — and re-claim LED ownership, which the framework dropped when we parked. */
export function onResume(): void {
    mlog('resume from background');
    claimLedOwnership();
    invalidateLedCachesOnResume();
}
