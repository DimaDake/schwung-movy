/* Debounced Link tempo override (schwung desired-tempo protocol): Move's
 * firmware follows movy's tempo knob via the Link sidecar, which applies the
 * file only while Move is the sole Link peer — with Live connected the
 * session owns tempo, which is correct. Debounce keeps a knob sweep from
 * spamming the file (the sidecar polls its mtime at ~100 Hz). */
const PATH = '/data/UserData/schwung/desired-tempo';
const DEBOUNCE_TICKS = 60;   // ~0.3 s at the ~205 Hz device tick

let pending = 0;             // bpmX100 awaiting write; 0 = idle
let countdown = 0;

export function scheduleTempoOverride(bpmX100: number): void {
    pending = bpmX100;
    countdown = DEBOUNCE_TICKS;
}

export function tempoOverrideTick(): void {
    if (!pending) return;
    if (--countdown > 0) return;
    if (typeof host_write_file === 'function') {
        host_write_file(PATH, (pending / 100).toFixed(4) + '\n');
    }
    pending = 0;
}
