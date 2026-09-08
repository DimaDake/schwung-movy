//! Which send buses render on a chain lane instead of in the send phase.
//!
//! A bus is a sum of tracks, so it cannot start until they have rendered — and
//! the send phase's answer is to wait for ALL of them, at a barrier, then run
//! the FX alone on the audio thread with every helper lane idle. Measured on a
//! twelve-chain set that costs the block **274 us** against the same FX
//! inserted on the track feeding it (`plans/2026-09-07-send-bus-colocation.md`
//! §1): the effect was not expensive, its PLACEMENT was.
//!
//! The fix needs no dependency graph and no new synchronisation. **Put the bus
//! on a lane, behind the tracks that feed it.** A lane is one thread running
//! one ordered task list, so by the time the bus's turn comes its feeders have
//! finished and their audio is already summed into its buffer — the same input,
//! at the same point in musical time, that the barrier delivers today.
//! Sample-exact, and nothing is delayed, which is what keeps a chorus or a
//! short slap delay usable on a send.
//!
//! **The trigger fits the problem.** A bus with one to three feeders is a small
//! group that drops onto a lane easily — and that is exactly the range where
//! `2026-09-05-send-fx-and-mix-page-design.md` §3 says a send LOSES to an
//! insert. A bus with many feeders crowds a lane and stops paying, which is
//! also the range where sends already win and nothing needs doing.
//!
//! Free of chain, host and FFI types, as `chain_idle` and `send_bus` are: every
//! rule here is decided by counting costs and gains.

use crate::mixer::TrackMix;
use crate::send_bus::SEND_BUSES;

/// Chains feeding each bus this block, as a bitmask over chain index.
///
/// `working[c]` is whether chain `c` renders at all this block — a sleeping
/// chain (`chain_idle`) sums nothing, so it is not a feeder and must not drag
/// its lane into the group. This is the same predicate `dirty` records after
/// the fact in `SendBuses::accumulate`, read one phase earlier.
pub fn feeders(mixes: &[TrackMix], working: &[bool]) -> [u16; SEND_BUSES] {
    let mut out = [0u16; SEND_BUSES];
    for (c, mix) in mixes.iter().enumerate().take(16) {
        if !working.get(c).copied().unwrap_or(false) {
            continue;
        }
        for (n, f) in out.iter_mut().enumerate() {
            let (gl, gr) = mix.send_gains(n);
            if gl != 0.0 || gr != 0.0 {
                *f |= 1 << c;
            }
        }
    }
    out
}

/// Whether co-locating a bus earns its place, comparing what a block would
/// actually cost each way.
///
/// * `with` — the makespan of a partition that INCLUDES the bus and its
///   feeders as one group. That is the whole block: the bus is inside the
///   parallel phase and there is nothing left to run after the join.
/// * `without` — the makespan of the same partition without them, which is
///   followed by the bus running serially in the send phase, so the block costs
///   `without + bus`.
///
/// Co-locating is therefore a **ratchet**: it is taken only when the predicted
/// block gets shorter, so a bus that would become the critical path is left
/// exactly where it is today rather than making a set slower.
///
/// `bus` of zero refuses. Before a bus has rendered its cost is unmeasured, and
/// a partition built on a guess is how a set commits to a plan nobody priced —
/// the same bootstrap rule `worth_fanning_out` follows.
pub fn worth_colocating(with: u64, without: u64, bus: u64) -> bool {
    bus > 0 && with < without + bus
}

/// Whether a bus may be considered at all, given what its FX and feeders are
/// pinned to.
///
/// **A non-empty pin key anywhere in the group disqualifies it.** Pinning means
/// "these must share a lane", and honouring both constraints at once would mean
/// merging groups transitively — a bus pulls in its feeders, a pinned feeder
/// pulls in its twins, and those pull in their own buses. That is a real
/// scheduling problem for a case that cannot occur in a shipped set: the
/// blacklist ships EMPTY and `chpin` is a test setting, never a default (see
/// `chain_pin`). Declining is correct rather than merely cheap — the bus keeps
/// today's send phase, which is what a pinned set gets now.
pub fn group_is_free(bus_key: &str, feeder_mask: u16, pin_keys: &[String]) -> bool {
    if !bus_key.is_empty() {
        return false;
    }
    for (c, k) in pin_keys.iter().enumerate().take(16) {
        if feeder_mask & (1 << c) != 0 && !k.is_empty() {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mix(sends: [f32; SEND_BUSES]) -> TrackMix {
        let mut m = TrackMix::default();
        m.send = sends;
        m
    }

    #[test]
    fn a_zero_send_is_not_a_feeder() {
        let mixes = vec![mix([0.0; SEND_BUSES])];
        assert_eq!(feeders(&mixes, &[true])[0], 0);
    }

    #[test]
    fn a_fed_bus_names_the_chain_that_feeds_it() {
        let mut s = [0.0; SEND_BUSES];
        s[0] = 0.5;
        let mixes = vec![mix([0.0; SEND_BUSES]), mix(s)];
        assert_eq!(feeders(&mixes, &[true, true])[0], 0b10);
    }

    /// A sleeping chain sums nothing, so it is not a feeder. If it were, its
    /// lane would be dragged into the group to render a silence it never
    /// produced — and `chidle` exists precisely so that lane can do something
    /// else.
    #[test]
    fn a_sleeping_chain_is_not_a_feeder() {
        let mut s = [0.0; SEND_BUSES];
        s[0] = 1.0;
        let mixes = vec![mix(s)];
        assert_eq!(feeders(&mixes, &[false])[0], 0);
    }

    /// The measured case, as arithmetic. Twelve chains at a 500 us makespan and
    /// a 362 us bus: serially the block is 862 us, co-located the partition came
    /// out at 588 us. It is taken because the BLOCK got shorter, even though the
    /// parallel phase itself got longer — which is the whole point and the thing
    /// a naive "does this raise the makespan?" test would get backwards.
    #[test]
    fn the_measured_case_is_taken() {
        assert!(worth_colocating(588, 500, 362));
    }

    /// A bus heavier than everything else cannot hide behind anything: dropping
    /// it on a lane makes that lane the critical path and buys nothing. The
    /// serial send phase is no worse and needs no plan.
    #[test]
    fn a_bus_that_would_become_the_critical_path_is_refused() {
        // 900 us group against a 500 us makespan + a 380 us bus = 880.
        assert!(!worth_colocating(900, 500, 380));
    }

    #[test]
    fn an_unmeasured_bus_is_never_colocated() {
        assert!(!worth_colocating(500, 500, 0));
    }

    /// Equal is refused, not taken. A plan that predicts exactly today's cost
    /// is a partition change for nothing, and it would churn the assignment
    /// every replan for no measurable gain.
    #[test]
    fn a_break_even_bus_is_refused() {
        assert!(!worth_colocating(862, 500, 362));
    }

    #[test]
    fn a_pinned_feeder_disqualifies_the_group() {
        let keys = vec![String::new(), "sg/helm".to_string()];
        assert!(group_is_free("", 0b01, &keys));
        assert!(!group_is_free("", 0b10, &keys), "a pinned feeder must not be co-located");
    }

    #[test]
    fn a_pinned_bus_fx_disqualifies_the_group() {
        assert!(!group_is_free("audio_fx/dragonfly-hall", 0b01, &[String::new()]));
    }
}
