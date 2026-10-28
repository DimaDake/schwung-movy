//! A playing clip whose loop grows (Double Loop, a Smart Double option)
//! keeps its playhead, so after the change it plays its first half against
//! whatever bar the scene is in: a 1-bar clip doubled while a 2-bar
//! neighbour is in its second bar stays a bar out for good. It rejoins the
//! scene in phase with the longest playing loop its new length divides.

use super::Engine;

impl Engine {
    /// Re-phase track `t` after its clip in `slot` changed from `old_len`
    /// ticks; nothing to do unless that clip plays and its length changed.
    pub fn align_after_resize(&mut self, t: usize, slot: usize, old_len: u32) {
        let me = &self.tracks[t];
        if me.playing_slot != Some(slot) || me.clips[slot].length_ticks() == old_len {
            return;
        }
        if let Some(pos) = self.phase_from_scene(t) {
            self.tracks[t].pos_tick = pos;
        }
    }

    /* Lengths compare in master time: a clip tick lasts den/num master ticks,
     * so both sides are scaled by the other's num to stay in integers. */
    fn phase_from_scene(&self, t: usize) -> Option<u32> {
        let me = self.tracks[t].playing()?;
        let (mn, md) = (me.scale_num.max(1) as u64, me.scale_den.max(1) as u64);
        let mlen = me.length_ticks() as u64;
        if mlen == 0 {
            return None;
        }
        let mut best: Option<(u64, u64, u64)> = None; // (ref master len, phase, its unit)
        for (i, tr) in self.tracks.iter().enumerate() {
            let Some(c) = tr.playing().filter(|_| i != t) else { continue };
            let (rn, rd) = (c.scale_num.max(1) as u64, c.scale_den.max(1) as u64);
            let (rlen, mine) = (c.length_ticks() as u64 * rd * mn, mlen * md * rn);
            if rlen == 0 || rlen % mine != 0 || best.is_some_and(|b| b.0 * rn >= rlen * b.2) {
                continue;
            }
            let phase = tr.pos_tick.saturating_sub(c.loop_start_ticks()) as u64 * rd * mn % mine;
            best = Some((rlen, phase / (md * rn), rn));
        }
        best.map(|(_, p, _)| me.loop_start_ticks() + p as u32)
    }
}

#[cfg(test)]
mod tests {
    use crate::command::apply_batch;
    use crate::engine::Engine;
    use crate::{TICKS_PER_BAR, TICKS_PER_STEP};

    fn cmd(e: &mut Engine, s: &str) {
        apply_batch(e, s, &mut Vec::new());
    }

    fn run(e: &mut Engine, ticks: u32) {
        let (mut out, end) = (Vec::new(), e.clock.tick + ticks as u64);
        while e.clock.tick < end {
            e.advance_block(128, &mut out);
            out.clear();
        }
    }

    /// Track 0 plays a bar, track 1 two bars; both start together.
    fn scene() -> Engine {
        let mut e = Engine::new(44100, 12000);
        cmd(&mut e, "aiclip 0 0 16 1 1 0 0.24.60.100");
        cmd(&mut e, "aiclip 1 0 32 1 1 0 0.24.48.100");
        e.play();
        e
    }

    #[test]
    fn a_double_joins_the_longer_loop_in_its_second_bar() {
        let mut e = scene();
        run(&mut e, TICKS_PER_BAR + 5 * TICKS_PER_STEP);
        assert!(e.tracks[1].pos_tick >= TICKS_PER_BAR, "the neighbour is in its second bar");
        cmd(&mut e, "dbl 0");
        assert_eq!(e.tracks[0].pos_tick, e.tracks[1].pos_tick);
    }

    #[test]
    fn a_smart_double_write_joins_it_too() {
        let mut e = scene();
        run(&mut e, TICKS_PER_BAR + 3 * TICKS_PER_STEP);
        cmd(&mut e, "aiclip 0 0 32 1 1 0 0.24.60.100");
        assert_eq!(e.tracks[0].pos_tick, e.tracks[1].pos_tick);
    }

    #[test]
    fn a_double_in_the_first_bar_stays_where_it_is() {
        let mut e = scene();
        run(&mut e, 7 * TICKS_PER_STEP);
        let at = e.tracks[0].pos_tick;
        cmd(&mut e, "dbl 0");
        assert_eq!(e.tracks[0].pos_tick, at);
    }

    #[test]
    fn a_longer_loop_counts_bars_modulo_the_new_length() {
        let mut e = scene();
        cmd(&mut e, "aiclip 1 0 64 1 1 0 0.24.48.100"); // four bars
        run(&mut e, 3 * TICKS_PER_BAR + TICKS_PER_STEP);
        cmd(&mut e, "dbl 0");
        assert_eq!(e.tracks[0].pos_tick, e.tracks[1].pos_tick - 2 * TICKS_PER_BAR);
    }

    #[test]
    fn half_speed_neighbour_compares_in_master_time() {
        let mut e = scene();
        cmd(&mut e, "aiclip 1 0 16 1 2 0 0.24.48.100"); // one bar at half speed = two bars
        run(&mut e, 3 * TICKS_PER_BAR / 2 + 2 * TICKS_PER_STEP);
        cmd(&mut e, "dbl 0");
        assert_eq!(e.tracks[0].pos_tick, 2 * e.tracks[1].pos_tick % (2 * TICKS_PER_BAR));
    }

    #[test]
    fn no_loop_to_join_keeps_the_playhead() {
        let mut e = scene();
        cmd(&mut e, "aiclip 1 0 24 1 1 0 0.24.48.100"); // 1.5 bars: no multiple of two
        run(&mut e, TICKS_PER_BAR + 4 * TICKS_PER_STEP);
        let at = e.tracks[0].pos_tick;
        cmd(&mut e, "dbl 0");
        assert_eq!(e.tracks[0].pos_tick, at);
    }
}
