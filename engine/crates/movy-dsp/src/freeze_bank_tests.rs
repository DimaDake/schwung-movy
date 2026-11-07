//! freeze_bank.rs tests.


use super::*;
use seq_core::TICKS_PER_BAR;

const SR: u32 = 44_100;
const BLOCK: usize = 128;

fn map() -> LoopMap {
    LoopMap::new(TICKS_PER_BAR, 12_000, SR).unwrap()
}

/// Run blocks of a constant signal through a capturing track until it
/// reports an outcome; returns it and how many blocks it took.
fn run(bank: &mut FreezeBank, t: usize, playing: bool, limit: usize) -> (Option<Outcome>, usize) {
    let block = vec![1000i16; BLOCK * 2];
    let fpt = SR as f64 * 60.0 / (120.0 * seq_core::PPQN as f64);
    for n in 1..=limit {
        let frame = (n * BLOCK) as f64;
        bank.set_frame(|_| playing.then(|| (frame / fpt).rem_euclid(TICKS_PER_BAR as f64)), 0, 12_000);
        if let Some(o) = bank.tap(t, Some(&block), BLOCK) {
            return (Some(o), n);
        }
    }
    (None, limit)
}

#[test]
fn a_capture_freezes_after_two_passes_and_then_plays_the_loop() {
    let mut b = FreezeBank::new(16);
    assert!(b.begin(3, map(), 0).is_ok());
    assert_eq!(b.begin(3, map(), 0), Err("busy"), "already capturing");
    assert!(!b.silences_chain(3), "the chain stays live while it is captured");
    let (o, n) = run(&mut b, 3, true, 5_000);
    assert_eq!(o, Some(Outcome::Captured));
    assert!((n * BLOCK) as f64 >= 2.0 * 88_200.0);
    assert!(b.frozen(3) && b.silences_chain(3));
    assert_eq!(b.frozen_mask(), 1 << 3);
    let mut out = vec![0i16; BLOCK * 2];
    assert!(b.play(3, &mut out));
    assert!(out.iter().all(|&s| s == 1000), "plays what was captured");
    assert!(!b.play(4, &mut out), "an idle track is not played");
}

#[test]
fn stopping_cancels_a_capture() {
    let mut b = FreezeBank::new(16);
    b.begin(0, map(), 0).unwrap();
    run(&mut b, 0, true, 100);
    let (o, _) = run(&mut b, 0, false, 1);
    assert_eq!(o, Some(Outcome::Cancelled(Cancel::Stopped)));
    assert!(!b.capturing(0) && !b.silences_chain(0));
}

#[test]
fn a_silent_block_is_captured_as_silence() {
    // An idle-gated chain did not render: its scratch is stale, so the
    // capture must record zeros, not whatever the buffer last held.
    let mut b = FreezeBank::new(16);
    b.begin(1, map(), 0).unwrap();
    let fpt = SR as f64 * 60.0 / (120.0 * seq_core::PPQN as f64);
    let mut n = 0;
    loop {
        n += 1;
        let frame = (n * BLOCK) as f64;
        b.set_frame(|_| Some((frame / fpt).rem_euclid(TICKS_PER_BAR as f64)), 0, 12_000);
        if b.tap(1, None, BLOCK).is_some() {
            break;
        }
    }
    let mut out = vec![7i16; BLOCK * 2];
    b.play(1, &mut out);
    assert!(out.iter().all(|&s| s == 0));
}

#[test]
fn thaw_keeps_the_loop_until_the_chain_is_back() {
    let mut b = FreezeBank::new(16);
    b.begin(2, map(), 0).unwrap();
    run(&mut b, 2, true, 5_000);
    b.set_snapshot(2, vec![("synth:state".into(), "blob".into())]);
    assert_eq!(b.snapshot_get(2, "synth:state").as_deref(), Some("blob"));
    assert!(b.thaw(2));
    assert!(!b.thaw(2), "already thawing");
    assert!(b.silences_chain(2), "still the loop while the chain reloads");
    let mut out = vec![0i16; BLOCK * 2];
    assert!(b.play(2, &mut out));
    b.thawed(2);
    assert!(!b.silences_chain(2) && b.snapshot(2).is_empty());
    assert_eq!(b.snapshot_get(2, "synth:state"), None);
}

#[test]
fn a_set_change_clears_everything_and_names_the_cancelled_captures() {
    let mut b = FreezeBank::new(16);
    b.begin(0, map(), 0).unwrap();
    run(&mut b, 0, true, 5_000); // frozen
    b.begin(5, map(), 0).unwrap();           // capturing
    assert_eq!(b.clear_all(), vec![5]);
    assert_eq!(b.frozen_mask(), 0);
    assert!(!b.capturing(5));
}

#[test]
fn cancel_only_touches_a_capture() {
    let mut b = FreezeBank::new(16);
    assert!(!b.cancel(0));
    b.begin(0, map(), 0).unwrap();
    assert!(b.cancel(0));
    assert!(!b.capturing(0));
}

#[test]
fn a_frozen_track_names_its_slot_until_it_is_back() {
    let mut b = FreezeBank::new(16);
    b.begin(4, map(), 2).unwrap();
    assert_eq!(b.locked_slot(4), Some(2), "locked from the moment it is asked for");
    run(&mut b, 4, true, 5_000);
    assert_eq!(b.frozen_loop(4).map(|(_, _, s)| s), Some(2));
    b.thaw(4);
    assert_eq!(b.locked_slot(4), Some(2), "still locked while the chain reloads");
    b.thawed(4);
    assert_eq!(b.locked_slot(4), None);
}

/// Reviewed: a 16-bar clip at 1/8 speed and 40 BPM is ~768 s, 135 MB.
#[test]
fn a_loop_past_the_cap_or_the_budget_is_refused() {
    let mut b = FreezeBank::new(16);
    let long = LoopMap::new(TICKS_PER_BAR * 16 * 8, 4_000, SR).unwrap();
    assert_eq!(b.begin(0, long, 0), Err("long"));
    assert_eq!(b.locked_slot(0), None);
    // 55 s each: two fit in 24 MB, the budget's worth do not.
    let big = LoopMap::new(TICKS_PER_BAR * 55, 24_000, SR).unwrap();
    let fit = MEM_BUDGET / big.bytes();
    for t in 0..fit {
        assert!(b.begin(t, big, 0).is_ok(), "track {t}");
    }
    assert_eq!(b.begin(fit, big, 0), Err("mem"));
    b.cancel(0);
    assert!(b.begin(fit, big, 0).is_ok(), "a cancel gives its memory back");
}

#[test]
fn a_muted_frozen_track_fades_out_and_back_in() {
    let mut b = FreezeBank::new(16);
    b.begin(1, map(), 0).unwrap();
    run(&mut b, 1, true, 5_000);
    let fpt = SR as f64 * 60.0 / (120.0 * seq_core::PPQN as f64);
    let mut out = vec![0i16; BLOCK * 2];
    let mut level = Vec::new();
    for n in 0..200usize {
        let frame = (n * BLOCK) as f64;
        let muted = if n < 120 { 1 << 1 } else { 0 };
        b.set_frame(|_| Some((frame / fpt).rem_euclid(TICKS_PER_BAR as f64)), muted, 12_000);
        b.play(1, &mut out);
        level.push(out[BLOCK * 2 - 2]);
    }
    assert!(level[0] > 900, "the fade starts at full level, not with a cut");
    assert!(level[40] > 0 && level[40] < level[0], "a tail, not a cut");
    assert_eq!(level[100], 0, "silent once the fade is through");
    assert_eq!(level[125], 1000, "back within a few milliseconds of the unmute");
}

#[test]
fn a_buffer_arriving_for_a_cancelled_capture_is_dropped() {
    let mut b = FreezeBank::new(16);
    b.begin(2, map(), 0).unwrap();
    assert!(b.cancel(2), "a pending capture cancels");
    b.set_frame(|_| Some(0.0), 0, 12_000);
    assert!(!b.capturing(2), "the late buffer did not revive it");
    assert_eq!(b.bytes(), 0);
}
