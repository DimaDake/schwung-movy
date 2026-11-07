/* Look-ahead playback: a 25 ms timer schedules the next 120 ms of notes on
 * the audio clock, so a busy phone main thread never makes the loop late.
 * Beats count up for ever; core.schedule folds them into the loop. */
import { schedule } from './core.mjs';

const AHEAD = 0.12, TICK = 25;

export function makePlayer(makeSynth, onFrame) {
    let synth = null, timer = null, raf = 0, t0 = 0, ahead = 0, st = null;
    const beatAt = (time) => ((time - t0) * st.bpm) / 60;

    function pump() {
        const to = beatAt(synth.ctx.currentTime + AHEAD);
        if (to <= ahead) return;
        for (const ev of schedule(st.tracks, st.len, ahead, to, st.bpm, st.muted, st.solo)) {
            synth.play(ev, t0 + (ahead * 60) / st.bpm + ev.t, ev.track === st.target);
        }
        ahead = to;
    }
    function frame() { onFrame(beatAt(synth.ctx.currentTime)); raf = requestAnimationFrame(frame); }

    const player = {
        playing: false,
        /** Must first run inside a tap: iOS only unlocks audio there (Review Focus 2). */
        unlock() { synth ??= makeSynth(); return synth.ctx.resume(); },
        start(state) {
            player.unlock();
            player.stop();
            st = { ...state };
            t0 = synth.ctx.currentTime + 0.06;
            ahead = 0;
            timer = setInterval(pump, TICK);
            pump();
            raf = requestAnimationFrame(frame);
            player.playing = true;
        },
        stop() {
            clearInterval(timer); cancelAnimationFrame(raf);
            timer = null; player.playing = false;
            onFrame(null);
        },
        /** Mute, solo or tempo while playing; a tempo change keeps the beat where it is. */
        set(patch) {
            if (!st) return;
            if (patch.bpm && synth && player.playing) {
                const now = synth.ctx.currentTime, b = beatAt(now);
                /* `ahead` stays: what is queued up to it already sounds at the old tempo. */
                t0 = now - (b * 60) / patch.bpm;
            }
            Object.assign(st, patch);
        },
    };
    return player;
}
