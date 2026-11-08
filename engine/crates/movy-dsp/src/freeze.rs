//! Freeze: a track's chain output captured into RAM, then played back in the
//! chain's place so the chain can be unloaded and its CPU given back
//! (plans/2026-10-23-stems-freeze-export-wifi.md, F3).
//!
//! **Audio-thread rules.** A capture's buffer is the whole loop, allocated up
//! front OFF the audio thread (freeze_mem.rs, `Capture::with_buf`). `Capture::feed` and `Player::render`
//! only index into that buffer: no allocation, no lock, no log, no I/O.
//!
//! **Positions.** Both sides are driven by the track's position inside its
//! loop, in ticks, INCLUDING the clock's sub-tick fraction, taken at the END of
//! the block (the engine advances the sequencer before the chains render).
//! seq-core's clock is an exact integer accumulator, so that position maps to
//! the same frame every pass: a frozen loop does not drift against the
//! sequencer, at any tempo, fractional ones included.
//!
//! **Cursor.** Positions arrive once per block and convert to a fractional
//! frame; rounding them independently would make consecutive blocks overlap or
//! gap by a sample (a click). So each side keeps its own fractional cursor that
//! free-runs and wraps at the loop's EXACT length, and only jumps to the
//! reported position when the two disagree by more than `RESYNC_FRAMES`
//! (a relaunch, a stop/start, a loop edit).
//!
//! **Tempo.** A frozen loop keeps the tempo it was captured at
//! (`LoopMap::bpm_x100`). Played at another tempo it runs like tape —
//! `rate = now / captured`, faster and higher or slower and lower, always on
//! the grid — with linear interpolation; at rate 1 it copies the captured
//! frames exactly (owner's choice, 2026-10-23: never block a tempo change;
//! a pitch-keeping time-stretch is a later improvement).
//!
//! **Tails.** A capture finishes after TWO full passes since its last resync,
//! so every frame of the loop was last written on the second pass — reverb
//! and delay tails from the end of the loop are already in its start, and the
//! frozen loop repeats seamlessly.

use seq_core::PPQN;
use std::sync::Arc;

/// How far (in frames) the cursor may disagree with the reported position
/// before it jumps. Above per-block rounding (< 1 frame), far below any real
/// discontinuity (a relaunch moves by thousands).
const RESYNC_FRAMES: f64 = 2.0;

/// The playback-rate range a frozen loop accepts (tempo now / captured). Far
/// beyond any musical tempo change; it only keeps a corrupt tempo from
/// reading the buffer at an absurd stride.
const MIN_RATE: f64 = 0.25;
const MAX_RATE: f64 = 4.0;

/// A loop's length in ticks mapped to frames at one tempo and sample rate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoopMap {
    len_ticks: u32,
    sample_rate: u32,
    bpm_x100: u32,
    frames_per_tick: f64,
    /// The loop's exact length in frames (fractional at most tempos).
    exact: f64,
    /// Frames the buffer holds: `ceil(exact)`.
    len: usize,
}

impl LoopMap {
    /// `None` for a zero length, tempo or rate, which cannot be frozen.
    pub fn new(len_ticks: u32, bpm_x100: u32, sample_rate: u32) -> Option<Self> {
        if len_ticks == 0 || bpm_x100 == 0 || sample_rate == 0 {
            return None;
        }
        // seconds per tick = 60 / (bpm * PPQN); bpm = bpm_x100 / 100.
        let frames_per_tick = sample_rate as f64 * 60.0 * 100.0 / (bpm_x100 as f64 * PPQN as f64);
        let exact = len_ticks as f64 * frames_per_tick;
        Some(LoopMap { len_ticks, sample_rate, bpm_x100, frames_per_tick, exact, len: exact.ceil() as usize })
    }

    /// The loop's length in ticks, and the rate it was captured at: with the
    /// tempo, what rebuilds this map from a saved freeze (freeze_files.rs).
    pub fn len_ticks(&self) -> u32 {
        self.len_ticks
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// The tempo the loop was captured at (hundredths of a BPM).
    pub fn bpm_x100(&self) -> u32 {
        self.bpm_x100
    }

    /// Frames in the loop buffer.
    pub fn frames(&self) -> usize {
        self.len
    }

    /// The loop's length in seconds of audio.
    pub fn seconds(&self) -> f64 {
        self.exact / self.sample_rate as f64
    }

    /// What a stereo i16 buffer for this loop costs in RAM.
    pub fn bytes(&self) -> usize {
        self.len * 2 * std::mem::size_of::<i16>()
    }
}

/// Where a loop plays from, for one block: the END-of-block position and
/// the playable window, all in CLOCK ticks from the recorded start (seq-core
/// `LoopPos` without its slot). A Loop-mode cut on a frozen clip narrows the
/// window; the recording stays whole.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoopAt {
    pub pos: f64,
    pub win_start: f64,
    pub win_len: f64,
}

impl LoopAt {
    /// The whole recording as the window.
    pub fn whole(pos: f64, map: &LoopMap) -> Self {
        LoopAt { pos, win_start: 0.0, win_len: map.len_ticks as f64 }
    }
}

/// A playable window in FRAMES of the loop buffer.
#[derive(Clone, Copy, Debug)]
struct Win {
    start: f64,
    len: f64,
}

impl Win {
    fn whole(map: &LoopMap) -> Self {
        Win { start: 0.0, len: map.exact }
    }

    /// `at`'s window in frames, kept inside the buffer (a stale or foreign
    /// window must not index past it).
    fn of(map: &LoopMap, at: &LoopAt) -> Self {
        let start = (at.win_start * map.frames_per_tick).clamp(0.0, map.exact);
        let len = (at.win_len * map.frames_per_tick).min(map.exact - start);
        if len < 1.0 { Win::whole(map) } else { Win { start, len } }
    }

    fn wrap(&self, x: f64) -> f64 {
        self.start + (x - self.start).rem_euclid(self.len)
    }
}

/// A fractional frame position inside the loop that free-runs between
/// resyncs (see the module docs).
#[derive(Clone, Copy, Debug, Default)]
struct Cursor {
    pos: Option<f64>,
}

impl Cursor {
    /// Line the cursor up for a block that ENDS at `end_ticks` and spans
    /// `span` frames of the loop (the block's frames x the playback rate).
    /// Returns true when it had to jump (or had no position yet).
    fn sync(&mut self, map: &LoopMap, win: &Win, end_ticks: f64, span: f64) -> bool {
        let expected = win.wrap(end_ticks * map.frames_per_tick - span);
        if let Some(p) = self.pos {
            let d = (p - expected).rem_euclid(win.len);
            if d.min(win.len - d) <= RESYNC_FRAMES {
                return false;
            }
        }
        self.pos = Some(expected);
        true
    }

    /// Calls `f(k, buffer_index)` for each of the block's `frames` frames.
    /// One float add and one compare per frame — no per-frame modulo, since
    /// this runs for every frozen track on the audio thread. A block shorter
    /// than the loop (always, in practice: a loop is >= one step, thousands of
    /// frames) wraps at most once; the `while` covers the degenerate rest.
    #[inline]
    fn for_each_index(&self, map: &LoopMap, win: &Win, frames: usize, mut f: impl FnMut(usize, usize)) {
        let mut x = self.pos.unwrap_or(win.start);
        let last = map.len - 1;
        let end = win.start + win.len;
        for k in 0..frames {
            while x >= end {
                x -= win.len;
            }
            f(k, (x as usize).min(last));
            x += 1.0;
        }
    }

    fn advance(&mut self, win: &Win, span: f64) {
        if let Some(p) = self.pos {
            self.pos = Some(win.wrap(p + span));
        }
    }
}

/// A loop being recorded from a track's chain output.
pub struct Capture {
    map: LoopMap,
    buf: Vec<i16>,
    cur: Cursor,
    /// Frames written since the last resync; done at two passes.
    since_sync: usize,
}

impl Capture {
    /// Allocates the whole loop. OFF the audio thread (tests).
    #[cfg(test)]
    pub fn new(map: LoopMap) -> Self {
        Capture { map, buf: vec![0; map.len * 2], cur: Cursor::default(), since_sync: 0 }
    }

    /// Over a zeroed buffer allocated elsewhere (freeze_mem.rs). `Err` gives
    /// the buffer back when it does not hold the loop exactly.
    pub fn with_buf(map: LoopMap, buf: Vec<i16>) -> Result<Self, Vec<i16>> {
        if buf.len() != map.len * 2 {
            return Err(buf);
        }
        Ok(Capture { map, buf, cur: Cursor::default(), since_sync: 0 })
    }

    /// The buffer back, for freeing off the audio thread.
    pub fn into_buf(self) -> Vec<i16> {
        self.buf
    }

    pub fn map(&self) -> &LoopMap {
        &self.map
    }

    /// Record one interleaved stereo block that ends at loop position
    /// `end_ticks`. Audio thread.
    pub fn feed(&mut self, block: &[i16], end_ticks: f64) {
        let frames = block.len() / 2;
        if frames == 0 {
            return;
        }
        // Always rate 1: a capture runs at the tempo its map was built for
        // (the engine restarts it with a new map if the tempo moves).
        let win = Win::whole(&self.map);
        if self.cur.sync(&self.map, &win, end_ticks, frames as f64) {
            // A jump: whatever was recorded no longer lines up with a full
            // pass behind it. Start counting again.
            self.since_sync = 0;
        }
        let buf = &mut self.buf;
        self.cur.for_each_index(&self.map, &win, frames, |k, i| {
            buf[i * 2] = block[k * 2];
            buf[i * 2 + 1] = block[k * 2 + 1];
        });
        self.cur.advance(&win, frames as f64);
        self.since_sync = self.since_sync.saturating_add(frames);
    }

    /// A block whose chain did not render (idle-gated: silent). Recorded as
    /// silence at its position — the chain's scratch holds a stale block then,
    /// and capturing that would freeze audio that was never heard. Audio thread.
    pub fn feed_silence(&mut self, frames: usize, end_ticks: f64) {
        if frames == 0 {
            return;
        }
        let win = Win::whole(&self.map);
        if self.cur.sync(&self.map, &win, end_ticks, frames as f64) {
            self.since_sync = 0;
        }
        let buf = &mut self.buf;
        self.cur.for_each_index(&self.map, &win, frames, |_, i| {
            buf[i * 2] = 0;
            buf[i * 2 + 1] = 0;
        });
        self.cur.advance(&win, frames as f64);
        self.since_sync = self.since_sync.saturating_add(frames);
    }

    /// 0.0 ..= 1.0 of the two passes a capture needs.
    pub fn progress(&self) -> f32 {
        (self.since_sync as f64 / (2.0 * self.map.exact)).min(1.0) as f32
    }

    pub fn done(&self) -> bool {
        self.since_sync as f64 >= 2.0 * self.map.exact
    }

    /// The finished loop, or the capture back if it is not done yet.
    pub fn finish(self) -> Result<Frozen, Capture> {
        if self.done() {
            Ok(Frozen { map: self.map, buf: Arc::new(self.buf) })
        } else {
            Err(self)
        }
    }
}

/// A finished loop: what a frozen track plays, and what gets written to disk.
///
/// The samples are shared (`Arc`), so the saver thread can write the WAV from
/// the very buffer the audio thread plays — handing it over is a refcount, not
/// a multi-megabyte copy inside an audio callback.
pub struct Frozen {
    map: LoopMap,
    buf: Arc<Vec<i16>>,
}

impl Frozen {
    /// From a loop read back from disk. `None` if the samples do not fill the
    /// map exactly (a truncated or foreign file must not play garbage).
    pub fn from_samples(map: LoopMap, buf: Vec<i16>) -> Option<Self> {
        (buf.len() == map.len * 2).then(|| Frozen { map, buf: Arc::new(buf) })
    }

    pub fn map(&self) -> &LoopMap {
        &self.map
    }

    /// Interleaved stereo, `map().frames()` frames.
    #[cfg(test)]
    pub fn samples(&self) -> &[i16] {
        &self.buf
    }

    /// The same samples, for another thread (the WAV writer).
    pub fn shared(&self) -> Arc<Vec<i16>> {
        Arc::clone(&self.buf)
    }
}

/// Tape-style playback at `rate`: one linear interpolation per frame, the
/// loop wrapping without a modulo (see `Cursor::for_each_index`).
#[inline]
fn varispeed(buf: &[i16], map: &LoopMap, win: &Win, start: f64, rate: f64, out: &mut [i16]) {
    let mut x = start;
    let last = map.len - 1;
    let end = win.start + win.len;
    let first = win.start as usize;
    for k in 0..out.len() / 2 {
        while x >= end {
            x -= win.len;
        }
        let i0 = (x as usize).min(last);
        // The frame after the window's last one is its first: a cut loop
        // interpolates across its own seam, not into what was cut away.
        let i1 = if i0 + 1 >= (end.ceil() as usize).min(map.len) { first } else { i0 + 1 };
        let f = (x - i0 as f64) as f32;
        for c in 0..2 {
            let a = buf[i0 * 2 + c] as f32;
            let b = buf[i1 * 2 + c] as f32;
            out[k * 2 + c] = (a + (b - a) * f) as i16;
        }
        x += rate;
    }
}

/// Plays a frozen loop in a track's place.
pub struct Player {
    frozen: Frozen,
    cur: Cursor,
}

impl Player {
    pub fn new(frozen: Frozen) -> Self {
        Player { frozen, cur: Cursor::default() }
    }

    /// Fill `out` (interleaved stereo) for a block ending at `at` (inside its
    /// window), with the transport at `bpm_x100`; `None` (transport
    /// stopped, nothing playing) is silence and forgets the position, so the
    /// next start lines up afresh. Audio thread.
    pub fn render(&mut self, out: &mut [i16], at: Option<LoopAt>, bpm_x100: u32) {
        let frames = out.len() / 2;
        let Some(at) = at else {
            out.fill(0);
            self.cur = Cursor::default();
            return;
        };
        if frames == 0 {
            return;
        }
        let map = self.frozen.map;
        let rate = (bpm_x100 as f64 / map.bpm_x100 as f64).clamp(MIN_RATE, MAX_RATE);
        let span = frames as f64 * rate;
        let win = Win::of(&map, &at);
        self.cur.sync(&map, &win, at.pos, span);
        let buf = &self.frozen.buf;
        if rate == 1.0 {
            // The captured tempo: the captured frames, bit for bit.
            self.cur.for_each_index(&map, &win, frames, |k, i| {
                out[k * 2] = buf[i * 2];
                out[k * 2 + 1] = buf[i * 2 + 1];
            });
        } else {
            varispeed(buf, &map, &win, self.cur.pos.unwrap_or(win.start), rate, out);
        }
        self.cur.advance(&win, span);
    }

    pub fn frozen(&self) -> &Frozen {
        &self.frozen
    }

    /// The samples, for freeing off the audio thread.
    pub fn into_shared(self) -> Arc<Vec<i16>> {
        self.frozen.buf
    }
}

/// A waveform overview: `cols` columns of the loop, each the loudest sample
/// in its stretch (either channel) on 0..=255. Megabytes of reading: NEVER on
/// the audio thread (the saver computes it, freeze_files.rs).
pub fn peaks(samples: &[i16], cols: usize) -> Vec<u8> {
    let frames = samples.len() / 2;
    (0..cols).map(|c| {
        let (a, b) = (c * frames / cols.max(1), ((c + 1) * frames / cols.max(1)).max(c * frames / cols.max(1) + 1).min(frames));
        let m = samples.get(a * 2..b * 2).map_or(0, |s| s.iter().map(|v| v.unsigned_abs().min(32_767) as u32).max().unwrap_or(0));
        (m * 255 / 32_767) as u8
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use seq_core::TICKS_PER_BAR;

    const SR: u32 = 44_100;
    const BLOCK: usize = 128;

    /// A synthetic track: an exact position in frames that advances by one
    /// block at a time, as the engine's integer clock does.
    struct Sim {
        map: LoopMap,
        len_ticks: u32,
        frame: f64,
    }

    impl Sim {
        fn new(map: LoopMap, len_ticks: u32, start_frame: f64) -> Self {
            Sim { map, len_ticks, frame: start_frame }
        }
        /// End-of-block position in ticks, wrapped into the loop, as the
        /// engine reports it — plus `jitter` ticks of reporting error.
        fn step(&mut self, jitter: f64) -> f64 {
            self.frame += BLOCK as f64;
            (self.frame / self.map.frames_per_tick + jitter).rem_euclid(self.len_ticks as f64)
        }
        /// The signal a chain would render: a ramp keyed to the loop frame, so
        /// a capture can be checked frame by frame. Right = -left.
        fn block(&self) -> Vec<i16> {
            let start = self.frame - BLOCK as f64;
            let mut b = vec![0i16; BLOCK * 2];
            for k in 0..BLOCK {
                let idx = ((start + k as f64).rem_euclid(self.map.exact) as usize).min(self.map.len - 1);
                b[k * 2] = (idx % 30_000) as i16;
                b[k * 2 + 1] = -((idx % 30_000) as i16);
            }
            b
        }
    }

    fn bar_120() -> LoopMap {
        LoopMap::new(TICKS_PER_BAR, 12_000, SR).unwrap()
    }

    fn capture_all(map: LoopMap, start: f64, jitter: f64) -> (Frozen, usize) {
        let mut sim = Sim::new(map, TICKS_PER_BAR, start);
        let mut cap = Capture::new(map);
        let mut blocks = 0;
        loop {
            let end = sim.step(jitter);
            cap.feed(&sim.block(), end);
            blocks += 1;
            match cap.finish() {
                Ok(f) => return (f, blocks),
                Err(c) => cap = c,
            }
            assert!(blocks < 10_000, "capture never finished");
        }
    }

    #[test]
    fn one_bar_at_120_is_two_seconds() {
        let m = bar_120();
        assert_eq!(m.frames(), 88_200);
        assert_eq!(m.bytes(), 88_200 * 4);
        assert!(LoopMap::new(0, 12_000, SR).is_none());
        assert!(LoopMap::new(TICKS_PER_BAR, 0, SR).is_none());
    }

    #[test]
    fn capture_takes_two_passes_and_records_every_frame_in_place() {
        let map = bar_120();
        // Start mid-loop, off a block boundary: the capture must not care.
        let (frozen, blocks) = capture_all(map, 31_337.0, 0.0);
        let passes = blocks as f64 * BLOCK as f64 / map.exact;
        assert!((2.0..2.01).contains(&passes), "took {passes} passes");
        for i in 0..map.frames() {
            assert_eq!(frozen.samples()[i * 2], (i % 30_000) as i16, "frame {i}");
            assert_eq!(frozen.samples()[i * 2 + 1], -((i % 30_000) as i16));
        }
    }

    #[test]
    fn reporting_jitter_below_the_threshold_never_resyncs() {
        // Positions that are off by up to ~1 frame must not move the cursor:
        // the capture still finishes in two passes and lands every frame.
        let map = bar_120();
        let one_frame_ticks = 1.0 / map.frames_per_tick;
        let (frozen, blocks) = capture_all(map, 5.0, 0.9 * one_frame_ticks);
        assert!(blocks as f64 * BLOCK as f64 / map.exact < 2.01);
        assert_eq!(frozen.samples()[1000 * 2], 1000);
    }

    #[test]
    fn a_jump_restarts_the_two_passes() {
        let map = bar_120();
        let mut sim = Sim::new(map, TICKS_PER_BAR, 0.0);
        let mut cap = Capture::new(map);
        for _ in 0..800 {
            let end = sim.step(0.0);
            cap.feed(&sim.block(), end);
        }
        let before = cap.progress();
        sim.frame += 20_000.0; // a relaunch somewhere else in the loop
        let end = sim.step(0.0);
        cap.feed(&sim.block(), end);
        assert!(cap.progress() < before / 10.0, "progress {} after jump", cap.progress());
    }

    #[test]
    fn player_reproduces_the_capture_across_blocks_and_wraps() {
        let map = bar_120();
        let (frozen, _) = capture_all(map, 0.0, 0.0);
        let mut p = Player::new(frozen);
        let mut sim = Sim::new(map, TICKS_PER_BAR, 7_777.0);
        let mut out = vec![0i16; BLOCK * 2];
        // Three loops: every block must equal what the chain would have played.
        for _ in 0..(3.0 * map.exact / BLOCK as f64) as usize {
            let end = sim.step(0.0);
            p.render(&mut out, Some(LoopAt::whole(end, &map)), 12_000);
            assert_eq!(out, sim.block());
        }
    }

    #[test]
    fn fractional_tempo_does_not_drift_over_a_thousand_loops() {
        // 133.33 BPM: the loop is not a whole number of frames.
        let map = LoopMap::new(TICKS_PER_BAR, 13_333, SR).unwrap();
        assert!(map.exact.fract() != 0.0);
        let mut c = Cursor::default();
        let mut sim = Sim::new(map, TICKS_PER_BAR, 0.0);
        let mut resyncs = 0;
        for _ in 0..(1000.0 * map.exact / BLOCK as f64) as usize {
            let end = sim.step(0.0);
            if c.sync(&map, &Win::whole(&map), end, BLOCK as f64) {
                resyncs += 1;
            }
            c.advance(&Win::whole(&map), BLOCK as f64);
        }
        assert_eq!(resyncs, 1, "only the first block may sync");
    }

    #[test]
    fn stopped_is_silence_and_the_next_start_lines_up() {
        let map = bar_120();
        let (frozen, _) = capture_all(map, 0.0, 0.0);
        let mut p = Player::new(frozen);
        let mut out = vec![1i16; BLOCK * 2];
        p.render(&mut out, None, 12_000);
        assert!(out.iter().all(|&s| s == 0));
        let mut sim = Sim::new(map, TICKS_PER_BAR, 50_000.0);
        let end = sim.step(0.0);
        p.render(&mut out, Some(LoopAt::whole(end, &map)), 12_000);
        assert_eq!(out, sim.block());
    }

    /// A loop whose frame i holds `f(i)` on the left and `-f(i)` on the right.
    fn ramp(map: LoopMap, f: impl Fn(usize) -> i16) -> Frozen {
        let mut buf = vec![0i16; map.frames() * 2];
        for i in 0..map.frames() {
            buf[i * 2] = f(i);
            buf[i * 2 + 1] = -f(i);
        }
        Frozen::from_samples(map, buf).unwrap()
    }

    /// The left channel a transport running at `bpm_now` hears from a loop
    /// captured at 120: each block covers `BLOCK * rate` captured frames.
    fn play_at(bpm_now: u32, blocks: usize, f: impl Fn(usize) -> i16) -> Vec<i16> {
        let map = bar_120();
        let rate = (bpm_now as f64 / 12_000.0).clamp(MIN_RATE, MAX_RATE);
        let mut p = Player::new(ramp(map, f));
        let mut out = vec![0i16; BLOCK * 2];
        let mut frame = 1_000.0; // the transport, in captured frames
        let mut left = Vec::new();
        for _ in 0..blocks {
            frame += BLOCK as f64 * rate;
            let end = (frame / map.frames_per_tick).rem_euclid(TICKS_PER_BAR as f64);
            p.render(&mut out, Some(LoopAt::whole(end, &map)), bpm_now);
            left.extend(out.iter().step_by(2));
        }
        left
    }

    #[test]
    fn double_tempo_plays_every_other_frame() {
        // i % 30000: two frames per output frame is a step of exactly 2,
        // except where the ramp itself or the loop wraps.
        let l = play_at(24_000, 1_000, |i| (i % 30_000) as i16);
        for w in l.windows(2) {
            if w[0] >= 28_000 {
                continue;
            }
            assert_eq!(w[1] as i32 - w[0] as i32, 2, "{} -> {}", w[0], w[1]);
        }
    }

    #[test]
    fn half_tempo_interpolates_between_frames_and_stays_continuous() {
        // i / 8, continuous across the whole loop (max 11024): at half speed
        // the output may only ever move by 0 or 1 — no resync jumps, no
        // dropped or repeated blocks — except at the loop's own wrap.
        let l = play_at(6_000, 3_000, |i| (i / 8) as i16);
        // At the wrap this test signal jumps 11024 -> 0, so interpolation
        // passes through one midpoint (~5512) on the way down; real audio is
        // continuous there (a capture records two passes).
        let mut drops = 0;
        for w in l.windows(2) {
            let d = w[1] as i32 - w[0] as i32;
            if d < 0 && w[0] >= 5_000 {
                drops += 1;
                continue;
            }
            assert!((0..=1).contains(&d), "{} -> {}", w[0], w[1]);
        }
        let loops = (3_000.0 * BLOCK as f64 * 0.5 / bar_120().exact) as usize;
        assert!(drops >= loops && drops <= 2 * (loops + 1), "{drops} drops for {loops} loops");
    }

    #[test]
    fn a_wild_tempo_is_clamped_not_strided_through() {
        // 50x is clamped to MAX_RATE: steps of four frames, not fifty.
        let l = play_at(12_000 * 50, 8, |i| (i % 30_000) as i16);
        assert_eq!(l[11] - l[10], 4);
    }

    #[test]
    fn a_loaded_loop_must_fill_its_map() {
        let map = bar_120();
        assert!(Frozen::from_samples(map, vec![0; map.frames() * 2]).is_some());
        assert!(Frozen::from_samples(map, vec![0; map.frames() * 2 - 2]).is_none());
    }

    /// Plays `blocks` blocks of a ramp loop through the window [ws, ws+wl)
    /// (ticks) from transport frame `f0`; returns (expected, got) left samples.
    fn play_window(ws: f64, wl: f64, f0: f64, blocks: usize) -> (Vec<i16>, Vec<i16>) {
        let map = bar_120();
        let mut p = Player::new(ramp(map, |i| (i % 30_000) as i16));
        let fpt = map.frames_per_tick;
        let (ws_f, wl_f) = (ws * fpt, wl * fpt);
        let mut out = vec![0i16; BLOCK * 2];
        let (mut want, mut got) = (Vec::new(), Vec::new());
        let mut f = f0;
        for _ in 0..blocks {
            for k in 0..BLOCK {
                let idx = (ws_f + (f + k as f64).rem_euclid(wl_f)) as usize;
                want.push((idx % 30_000) as i16);
            }
            f += BLOCK as f64;
            let at = LoopAt { pos: ws + (f / fpt).rem_euclid(wl), win_start: ws, win_len: wl };
            p.render(&mut out, Some(at), 12_000);
            got.extend(out.iter().step_by(2));
        }
        (want, got)
    }

    #[test]
    fn a_sub_window_plays_the_recorded_frames_bit_for_bit() {
        let tpb = TICKS_PER_BAR as f64;
        // The middle half of the bar, three passes of it.
        let (want, got) = play_window(tpb / 4.0, tpb / 2.0, 0.0, (3.0 * 44_100.0 / BLOCK as f64) as usize);
        assert_eq!(got, want);
    }

    #[test]
    fn a_block_across_the_window_end_wraps_inside_it() {
        let tpb = TICKS_PER_BAR as f64;
        // Starts 50 frames before the window's end: the first block wraps.
        let (want, got) = play_window(tpb / 4.0, tpb / 2.0, 44_100.0 - 50.0, 4);
        assert_eq!(got, want);
        let end = ((22_050 + 44_100) % 30_000) as i16;
        assert!(!got.contains(&end), "a frame past the window played");
    }

    #[test]
    fn peaks_of_a_ramp() {
        let buf: Vec<i16> = (0..1000).flat_map(|i| [(i * 32) as i16, -((i * 32) as i16)]).collect();
        let p = peaks(&buf, 10);
        assert_eq!(p.len(), 10);
        assert!(p.windows(2).all(|w| w[0] < w[1]), "{p:?}");
        assert_eq!(p[9], ((999 * 32) as u32 * 255 / 32_767) as u8);
        assert!(peaks(&[], 4).iter().all(|&v| v == 0));
    }
}
