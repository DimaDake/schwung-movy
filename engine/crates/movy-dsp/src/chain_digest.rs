//! A checksum of what each chain actually rendered — the equivalence oracle.
//!
//! Parallel render is only allowed to make a block *shorter*, never different.
//! Nothing verified that: every measurement so far asserted that chains were
//! *audible*, which a race that swaps, drops or doubles a sample passes
//! trivially. This is the observation that turns "it is fast" into "it is the
//! same".
//!
//! **Why a hash and not captured audio.** The two arms are minutes apart, and
//! the device has neither room to buffer twelve chains of PCM nor a fast path
//! off it. A 64-bit digest per chain fits in a log line and names the guilty
//! chain, where a mix-bus comparison could only say "something differs".
//!
//! **Why the bar is bit-identical rather than a tolerance.** Each chain renders
//! into its own buffer, every worker sets the same FPCR flush-to-zero flag, and
//! the mix stays serial in slot order after the join — so the parallel arm does
//! the same arithmetic in the same order. Equality is therefore achievable, and
//! that is worth a great deal: there is no threshold to argue about, and one
//! differing sample is a defect rather than a judgement call.
//!
//! **Why the stimulus is generated here.** The obvious harness — hold a chord
//! over the wire, digest both arms — cannot work. `measure-parallel-render.sh`
//! strikes its chord with 48 separate socket writes, so the notes land seconds
//! apart and never on the same block twice. Any difference that produced would
//! be indistinguishable from a threading bug. Striking from inside the render
//! makes both arms identical by construction: same block, same order, no clock
//! and no network in the path.

/// FNV-1a, over samples rather than bytes.
///
/// Both steps are invertible — xor, then multiply by an odd constant — so two
/// equal-length sample streams that differ anywhere can agree only by a 2^-64
/// collision. That is what lets "the digests match" be a claim about the audio
/// instead of a claim about the hash.
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Struck on every loaded chain when the window opens. Two low notes and two
/// high ones because the set mixes drum modules (which only answer around
/// 36-48) with melodic ones — the run is not music, it just has to make every
/// chain produce something to compare.
pub const STIMULUS: [u8; 4] = [36, 48, 60, 72];

/// Default window. ~1.7 s of audio at 128 frames a block: long enough for a
/// rare race to land in it, short enough that most of it is not decay.
pub const DEFAULT_BLOCKS: u32 = 512;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    /// Not measuring — the only state production ever sees.
    Off,
    /// Armed, waiting for the next block boundary to strike.
    Armed,
    Running,
    /// Frozen, so the report reads the same however long after the run the
    /// reader gets to it. Reading over ssh is seconds behind the device.
    Done,
}

pub struct ChainDigest {
    hash: Vec<u64>,
    /// Blocks in which this chain rendered something other than silence.
    ///
    /// A digest over a silent chain matches trivially, so without this "all
    /// twelve agreed" could mean twelve chains that never made a sound. The
    /// oracle has to report its own coverage.
    voiced: Vec<u32>,
    phase: Phase,
    remaining: u32,
    window: u32,
}

impl ChainDigest {
    pub fn new(chains: usize) -> Self {
        Self {
            hash: vec![FNV_OFFSET; chains],
            voiced: vec![0; chains],
            phase: Phase::Off,
            remaining: 0,
            window: 0,
        }
    }

    /// Arm a run of `blocks` blocks. Takes effect at the next block boundary.
    pub fn arm(&mut self, blocks: u32) {
        for h in self.hash.iter_mut() {
            *h = FNV_OFFSET;
        }
        for v in self.voiced.iter_mut() {
            *v = 0;
        }
        self.window = blocks.max(1);
        self.remaining = self.window;
        self.phase = Phase::Armed;
    }

    /// Called at the top of every render. `true` means strike the stimulus into
    /// every loaded chain *before* rendering this block, so the window's first
    /// block is the note-on's own block in both arms.
    pub fn open_block(&mut self) -> bool {
        if self.phase != Phase::Armed {
            return false;
        }
        self.phase = Phase::Running;
        true
    }

    /// Called at the bottom of every render. `true` means the window just
    /// closed and the stimulus must be released — the run cleans up after
    /// itself so a device is never left holding 48 notes.
    pub fn close_block(&mut self) -> bool {
        if self.phase != Phase::Running {
            return false;
        }
        self.remaining -= 1;
        if self.remaining > 0 {
            return false;
        }
        self.phase = Phase::Done;
        true
    }

    /// Whether a block should be folded at all — one bool check per block when
    /// off, which is what keeps this permanently compiled in.
    pub fn running(&self) -> bool {
        self.phase == Phase::Running
    }

    /// Fold one chain's rendered block. `peak` is the abs-max the caller has
    /// already computed for its own purposes, so coverage costs nothing extra.
    pub fn fold(&mut self, chain: usize, samples: &[i16], peak: i32) {
        let Some(h) = self.hash.get_mut(chain) else { return };
        let mut acc = *h;
        for &s in samples {
            acc = (acc ^ (s as u16 as u64)).wrapping_mul(FNV_PRIME);
        }
        *h = acc;
        if peak > 0 {
            self.voiced[chain] += 1;
        }
    }

    /// `state=<phase> window=<n> d=<hex>/<voiced>,...`, one pair per chain.
    ///
    /// Deliberately NOT self-resetting, unlike `CostMeter::report`: a digest
    /// read twice must read the same both times, because the comparison between
    /// arms happens off-device and a reader that consumed the value would turn
    /// a retry into a mismatch.
    pub fn report(&self) -> String {
        let mut out = format!(
            "state={} window={} d=",
            match self.phase {
                Phase::Off => "off",
                Phase::Armed => "armed",
                Phase::Running => "running",
                Phase::Done => "done",
            },
            self.window
        );
        for i in 0..self.hash.len() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!("{:016x}/{}", self.hash[i], self.voiced[i]));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut ChainDigest, blocks: u32, mut block: impl FnMut(u32) -> Vec<i16>) {
        d.arm(blocks);
        for b in 0..blocks {
            assert_eq!(d.open_block(), b == 0, "the strike happens once, on block 0");
            let s = block(b);
            let peak = s.iter().fold(0i32, |m, &x| m.max((x as i32).abs()));
            d.fold(0, &s, peak);
            assert_eq!(d.close_block(), b == blocks - 1, "the release happens once, at the end");
        }
    }

    /// The oracle's whole job. If this cannot tell two renders apart it will
    /// report "identical" for a set that is quietly corrupt, which is worse
    /// than having no oracle at all.
    #[test]
    fn one_flipped_bit_in_one_block_out_of_hundreds_is_caught() {
        let clean = |_b: u32| (0..256).map(|i| (i * 37) as i16).collect::<Vec<_>>();
        let mut a = ChainDigest::new(1);
        run(&mut a, 400, clean);

        let mut b = ChainDigest::new(1);
        run(&mut b, 400, |bl| {
            let mut s = clean(bl);
            // One sample, one LSB, in block 200 of 400.
            if bl == 200 {
                s[7] ^= 1;
            }
            s
        });
        assert_ne!(a.report(), b.report(), "a single flipped bit went unnoticed");

        let mut c = ChainDigest::new(1);
        run(&mut c, 400, clean);
        assert_eq!(a.report(), c.report(), "and identical renders must agree");
    }

    /// Sample ORDER has to matter. A race that lets two lanes interleave their
    /// writes produces the same multiset of samples in the wrong places, and a
    /// digest built on addition or xor alone would call that identical.
    #[test]
    fn reordering_the_same_samples_is_a_difference() {
        let mut a = ChainDigest::new(1);
        run(&mut a, 1, |_| vec![7, 9, 11, 13]);
        let mut b = ChainDigest::new(1);
        run(&mut b, 1, |_| vec![7, 11, 9, 13]);
        assert_ne!(a.report(), b.report());
    }

    /// "Every chain matched" is worthless if the chains were silent — silence
    /// hashes identically no matter which lane rendered it. The report has to
    /// carry enough for the reader to throw those chains out.
    #[test]
    fn silence_is_reported_as_uncovered_rather_than_as_agreement() {
        let mut d = ChainDigest::new(2);
        d.arm(4);
        for _ in 0..4 {
            d.open_block();
            d.fold(0, &[0i16; 8], 0);
            d.fold(1, &[5i16; 8], 5);
            d.close_block();
        }
        let r = d.report();
        let pairs: Vec<&str> = r.split("d=").nth(1).unwrap().split(',').collect();
        assert!(pairs[0].ends_with("/0"), "a silent chain has no covered blocks: {r}");
        assert!(pairs[1].ends_with("/4"), "a sounding one has all of them: {r}");
    }

    /// The window has to be a fixed number of BLOCKS, not a duration, or the
    /// two arms fold different amounts of audio and disagree for that reason
    /// alone — parallel render makes blocks shorter, which is the whole point.
    #[test]
    fn the_window_is_a_block_count_and_closes_exactly_once() {
        let mut d = ChainDigest::new(1);
        d.arm(3);
        assert!(d.open_block());
        assert!(!d.open_block(), "a second block must not re-strike");
        assert!(!d.close_block());
        assert!(!d.close_block());
        assert!(d.close_block(), "closes on the third");
        assert!(!d.close_block(), "and never again");
        assert!(!d.running(), "nothing is folded after the window");
        assert!(d.report().starts_with("state=done window=3 "));
    }

    /// The comparison happens off-device over ssh, where a read can be retried.
    #[test]
    fn reading_the_report_does_not_consume_it() {
        let mut d = ChainDigest::new(1);
        run(&mut d, 2, |_| vec![1, 2, 3, 4]);
        assert_eq!(d.report(), d.report());
    }

    #[test]
    fn an_out_of_range_chain_is_ignored_not_panicked_on() {
        let mut d = ChainDigest::new(1);
        d.arm(1);
        d.open_block();
        d.fold(99, &[1, 2, 3], 3);
    }
}
