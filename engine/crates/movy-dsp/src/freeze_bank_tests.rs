//! freeze_bank.rs tests.

use super::*;
use crate::freeze::XFADE;
use seq_core::TICKS_PER_BAR;

const SR: u32 = 44_100;
const BLOCK: usize = 128;

fn map() -> LoopMap {
    LoopMap::new(TICKS_PER_BAR, 12_000, SR).unwrap()
}

fn clip(slot: usize) -> ClipJob {
    ClipJob { slot, map: map(), win: RecWindow { start_ticks: 0, len_ticks: TICKS_PER_BAR } }
}

const FPT: f64 = SR as f64 * 60.0 / (120.0 * seq_core::PPQN as f64);

fn at(frame: f64, slot: usize) -> LoopPos {
    let len = TICKS_PER_BAR as f64;
    LoopPos { slot, pos: (frame / FPT).rem_euclid(len), win_start: 0.0, win_len: len }
}

/// Run blocks of a constant `level` through a freezing track playing `slot`
/// (`None` = stopped) until it reports an outcome.
fn run(bank: &mut FreezeBank, t: usize, slot: Option<usize>, level: i16, limit: usize) -> (Option<Outcome>, usize) {
    let block = vec![level; BLOCK * 2];
    for n in 1..=limit {
        let frame = (n * BLOCK) as f64;
        bank.set_frame(|_| slot.map(|s| at(frame, s)),
                       |_| Some(LoopAt { pos: (frame / FPT).rem_euclid(TICKS_PER_BAR as f64), win_start: 0.0, win_len: TICKS_PER_BAR as f64 }),
                       0, 12_000);
        if let Some(o) = bank.tap(t, Some(&block), BLOCK) {
            return (Some(o), n);
        }
    }
    (None, limit)
}

/// Freeze track `t` with one clip in slot 0, to Frozen.
fn frozen_one(b: &mut FreezeBank, t: usize) {
    b.begin_track(t, Some(0), &[clip(0)]).unwrap();
    assert_eq!(run(b, t, Some(0), 1000, 5_000).0, Some(Outcome::Captured));
}

/// The block a loop plays once any crossfade into it is over.
fn play_slot(b: &mut FreezeBank, t: usize, slot: usize) -> Vec<i16> {
    let mut out = vec![7i16; BLOCK * 2];
    for n in 0..=XFADE / BLOCK + 1 {
        b.set_frame(|_| Some(at(1000.0 + (n * BLOCK) as f64, slot)), |_| None, 0, 12_000);
        assert!(b.play(t, &mut out));
    }
    out
}

#[test]
fn a_capture_freezes_after_two_passes_and_then_plays_the_loop() {
    let mut b = FreezeBank::new(16);
    assert!(b.begin_track(3, Some(0), &[clip(0)]).is_ok());
    assert_eq!(b.begin_track(3, Some(0), &[clip(0)]), Err("busy"), "already freezing");
    assert!(!b.silences_chain(3) && !b.stands_in(3), "the chain stays live while its clip is heard");
    let (o, n) = run(&mut b, 3, Some(0), 1000, 5_000);
    assert_eq!(o, Some(Outcome::Captured));
    assert!((n * BLOCK) as f64 >= 2.0 * 88_200.0);
    assert!(b.frozen(3) && b.silences_chain(3));
    assert_eq!(b.frozen_mask(), 1 << 3);
    assert!(play_slot(&mut b, 3, 0).iter().all(|&s| s == 1000), "plays what was captured");
    let mut out = vec![0i16; BLOCK * 2];
    assert!(!b.play(4, &mut out), "an idle track is not played");
}

#[test]
fn the_heard_clip_is_recorded_first_then_slot_order() {
    let mut b = FreezeBank::new(16);
    b.begin_track(1, Some(4), &[clip(0), clip(2), clip(4)]).unwrap();
    assert_eq!(b.progress(1).map(|p| (p.0, p.1, p.2, p.3)), Some((0, 3, 0, 4)), "the heard clip, slot 4, first");
    assert_eq!(run(&mut b, 1, Some(4), 400, 5_000).0, Some(Outcome::ClipDone { slot: 4, next: 0 }));
    assert_eq!(run(&mut b, 1, Some(0), 100, 5_000).0, Some(Outcome::ClipDone { slot: 0, next: 2 }));
    assert_eq!(b.progress(1).map(|p| (p.0, p.1)), Some((2, 3)));
    assert_eq!(run(&mut b, 1, Some(2), 200, 5_000).0, Some(Outcome::Captured));
    for (slot, level) in [(0, 100), (2, 200), (4, 400)] {
        assert!(play_slot(&mut b, 1, slot).iter().all(|&s| s == level), "slot {slot}");
    }
    assert_eq!(b.frozen_loops(1).iter().map(|l| l.0).collect::<Vec<_>>(), vec![0, 2, 4]);
}

#[test]
fn a_finished_heard_loop_stands_in_while_the_rest_record() {
    let mut b = FreezeBank::new(16);
    b.begin_track(2, Some(1), &[clip(1), clip(3)]).unwrap();
    run(&mut b, 2, Some(1), 500, 5_000);
    assert!(b.stands_in(2) && !b.silences_chain(2), "the chain renders the rest; the loop is heard");
    assert_eq!(b.heard(2), Some(1));
    // The playhead is on slot 3 now (lent); what is heard is slot 1's loop.
    run(&mut b, 2, Some(3), 9, 10);
    let mut out = vec![0i16; BLOCK * 2];
    assert!(b.play(2, &mut out));
    assert!(out.iter().all(|&s| s == 500), "the heard loop, not the clip being recorded");
}

#[test]
fn stopped_records_with_no_heard_clip() {
    let mut b = FreezeBank::new(16);
    b.begin_track(0, None, &[clip(0), clip(1)]).unwrap();
    run(&mut b, 0, Some(0), 1, 5_000);
    assert!(!b.stands_in(0), "nothing heard while stopped");
}

#[test]
fn stopping_cancels_a_capture() {
    let mut b = FreezeBank::new(16);
    b.begin_track(0, Some(0), &[clip(0)]).unwrap();
    run(&mut b, 0, Some(0), 1, 100);
    let (o, _) = run(&mut b, 0, None, 1, 1);
    assert_eq!(o, Some(Outcome::Cancelled(Cancel::Stopped)));
    assert!(!b.capturing(0) && !b.silences_chain(0));
}

#[test]
fn cancel_frees_every_loop_of_the_job() {
    let mut b = FreezeBank::new(16);
    b.begin_track(5, Some(0), &[clip(0), clip(1), clip(2)]).unwrap();
    run(&mut b, 5, Some(0), 1, 5_000);
    run(&mut b, 5, Some(1), 1, 5_000);
    assert!(b.bytes() > 0);
    assert!(b.cancel(5));
    assert_eq!(b.bytes(), 0, "two loops and the job's reserve, all given back");
    assert!(!b.stands_in(5) && b.windows(5).is_none());
}

#[test]
fn an_empty_slot_plays_silence() {
    let mut b = FreezeBank::new(16);
    frozen_one(&mut b, 3);
    assert!(play_slot(&mut b, 3, 6).iter().all(|&s| s == 0));
}

#[test]
fn a_silent_block_is_captured_as_silence() {
    let mut b = FreezeBank::new(16);
    b.begin_track(1, Some(0), &[clip(0)]).unwrap();
    let mut n = 0;
    loop {
        n += 1;
        let frame = (n * BLOCK) as f64;
        b.set_frame(|_| Some(at(frame, 0)), |_| None, 0, 12_000);
        if b.tap(1, None, BLOCK).is_some() {
            break;
        }
    }
    assert!(play_slot(&mut b, 1, 0).iter().all(|&s| s == 0));
}

#[test]
fn thaw_keeps_the_loop_until_the_chain_is_back() {
    let mut b = FreezeBank::new(16);
    frozen_one(&mut b, 2);
    b.set_snapshot(2, vec![("synth:state".into(), "blob".into())]);
    assert_eq!(b.snapshot_get(2, "synth:state").as_deref(), Some("blob"));
    assert!(b.thaw(2));
    assert!(!b.thaw(2), "already thawing");
    assert!(b.silences_chain(2), "still the loop while the chain reloads");
    assert!(b.windows(2).is_some(), "still locked while the chain reloads");
    play_slot(&mut b, 2, 0);
    b.thawed(2);
    assert!(!b.silences_chain(2) && b.snapshot(2).is_empty());
    assert_eq!(b.snapshot_get(2, "synth:state"), None);
    assert!(b.windows(2).is_none());
}

#[test]
fn a_set_change_clears_everything_and_names_the_cancelled_captures() {
    let mut b = FreezeBank::new(16);
    frozen_one(&mut b, 0);
    b.begin_track(5, Some(0), &[clip(0)]).unwrap();
    assert_eq!(b.clear_all(), vec![5]);
    assert_eq!(b.frozen_mask(), 0);
    assert!(!b.capturing(5));
}

#[test]
fn a_freezing_track_is_locked_to_every_clip_of_the_job() {
    let mut b = FreezeBank::new(16);
    b.begin_track(4, None, &[clip(2), clip(5)]).unwrap();
    let w = b.windows(4).unwrap();
    assert!(w[2].is_some() && w[5].is_some() && w[0].is_none());
}

/// Reviewed: a 16-bar clip at 1/8 speed and 40 BPM is ~768 s, 135 MB.
#[test]
fn a_loop_past_the_cap_is_refused() {
    let mut b = FreezeBank::new(16);
    let long = LoopMap::new(TICKS_PER_BAR * 16 * 8, 4_000, SR).unwrap();
    let c = ClipJob { map: long, ..clip(0) };
    assert_eq!(b.begin_track(0, None, &[clip(1), c]), Err("long"));
    assert!(b.windows(0).is_none());
}

/// The cap is a ceiling, not a promise: with less RAM actually free, a job
/// must fit in what is, less a reserve for chain loads. Loops already held
/// are in the kernel's figure, so only what a job has yet to allocate counts.
#[test]
fn begin_refuses_a_job_past_the_free_ram() {
    let mut b = FreezeBank::new(16);
    let big = ClipJob { map: LoopMap::new(TICKS_PER_BAR * 55, 24_000, SR).unwrap(), ..clip(0) };
    let eight: Vec<ClipJob> = (0..8).map(|s| ClipJob { slot: s, ..big }).collect();
    let job: usize = eight.iter().map(|c| c.map.bytes()).sum();
    b.mem.fake_avail(MEM_RESERVE + job - 1);
    assert_eq!(b.begin_track(0, None, &eight), Err("mem"), "one byte short");
    b.mem.fake_avail(MEM_RESERVE + job);
    assert!(b.begin_track(0, None, &eight).is_ok());
    b.mem.fake_avail(MEM_RESERVE + 2 * job - 1);
    assert_eq!(b.begin_track(1, None, &eight), Err("mem"), "the first job's unallocated clips are still to come out of it");
}

#[test]
fn begin_refuses_over_200_mb_before_any_buffer() {
    assert_eq!(MEM_BUDGET, 200 << 20);
    let mut b = FreezeBank::new(16);
    // 55 s each (~9.7 MB): a track of eight is ~78 MB; two tracks fit, a third does not.
    let big = ClipJob { map: LoopMap::new(TICKS_PER_BAR * 55, 24_000, SR).unwrap(), ..clip(0) };
    let eight: Vec<ClipJob> = (0..8).map(|s| ClipJob { slot: s, ..big }).collect();
    assert!(b.begin_track(0, None, &eight).is_ok());
    assert!(b.begin_track(1, None, &eight).is_ok());
    assert_eq!(b.begin_track(2, None, &eight), Err("mem"), "the whole job is counted up front");
    assert!(b.windows(2).is_none());
    b.cancel(0);
    assert!(b.begin_track(2, None, &eight).is_ok(), "a cancel gives its memory back");
}

#[test]
fn a_muted_frozen_track_fades_out_and_back_in() {
    let mut b = FreezeBank::new(16);
    frozen_one(&mut b, 1);
    let mut out = vec![0i16; BLOCK * 2];
    let mut level = Vec::new();
    for n in 0..200usize {
        let frame = (n * BLOCK) as f64;
        let muted = if n < 120 { 1 << 1 } else { 0 };
        b.set_frame(|_| Some(at(frame, 0)), |_| None, muted, 12_000);
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
    b.begin_track(2, Some(0), &[clip(0)]).unwrap();
    assert!(b.cancel(2), "a pending capture cancels");
    b.set_frame(|_| Some(at(0.0, 0)), |_| None, 0, 12_000);
    assert!(!b.capturing(2), "the late buffer did not revive it");
    assert_eq!(b.bytes(), 0);
}

/// Run a freezing track until its next outcome with the real playhead on
/// `slot` and NO heard position (lib.rs only anchors after the event), then
/// play that same block.
fn outcome_block(b: &mut FreezeBank, t: usize, slot: usize, level: i16, heard_at: Option<LoopAt>) -> (Outcome, Vec<i16>) {
    let block = vec![level; BLOCK * 2];
    for n in 1..=5_000usize {
        let frame = (n * BLOCK) as f64;
        b.set_frame(|_| Some(at(frame, slot)), |_| heard_at, 0, 12_000);
        if let Some(o) = b.tap(t, Some(&block), BLOCK) {
            let mut out = vec![7i16; BLOCK * 2];
            b.play(t, &mut out);
            return (o, out);
        }
    }
    panic!("no outcome");
}

/// Reviewed: the block the heard clip's loop is done in had no heard position
/// yet (the anchor is taken after the mix), so it played silence — a dropout
/// at the moment the live clip turns into its loop.
#[test]
fn the_block_the_heard_loop_lands_in_plays_it() {
    let mut b = FreezeBank::new(16);
    b.begin_track(2, Some(1), &[clip(1), clip(3)]).unwrap();
    let (o, out) = outcome_block(&mut b, 2, 1, 500, None);
    assert_eq!(o, Outcome::ClipDone { slot: 1, next: 3 });
    assert!(out.iter().all(|&s| s == 500), "the heard loop, from the real playhead: {:?}", &out[..4]);
}

/// Reviewed: the block the last clip lands in has the playhead still lent to
/// that clip, so it played the LAST clip's loop for one block, not the heard.
#[test]
fn the_block_the_freeze_ends_in_plays_the_heard_loop() {
    let mut b = FreezeBank::new(16);
    b.begin_track(2, Some(1), &[clip(1), clip(3)]).unwrap();
    outcome_block(&mut b, 2, 1, 500, None);
    let heard = Some(LoopAt { pos: 10.0, win_start: 0.0, win_len: TICKS_PER_BAR as f64 });
    let (o, out) = outcome_block(&mut b, 2, 3, 300, heard);
    assert_eq!(o, Outcome::Captured);
    assert!(out.iter().all(|&s| s == 500), "the heard loop until the playhead is back: {:?}", &out[..4]);
}

fn levels(b: &mut FreezeBank, t: usize, slot: Option<usize>, blocks: usize, from: usize) -> Vec<i16> {
    let mut out = vec![0i16; BLOCK * 2];
    let mut l = Vec::new();
    for n in from..from + blocks {
        let frame = (n * BLOCK) as f64;
        b.set_frame(|_| slot.map(|s| at(frame, s)), |_| None, 0, 12_000);
        b.play(t, &mut out);
        l.extend(out.iter().step_by(2));
    }
    l
}

fn max_step(l: &[i16]) -> i32 {
    l.windows(2).map(|w| (w[1] as i32 - w[0] as i32).abs()).max().unwrap_or(0)
}

/// Reviewed on device (clicks): a launch on a frozen track cut from one
/// clip's loop to the other's, and a stop cut the loop off.
#[test]
fn a_clip_change_and_a_stop_crossfade() {
    let mut b = FreezeBank::new(16);
    b.begin_track(1, Some(0), &[clip(0), clip(1)]).unwrap();
    run(&mut b, 1, Some(0), 1000, 5_000);
    run(&mut b, 1, Some(1), 3000, 5_000);
    assert!(b.frozen(1));
    let mut l = levels(&mut b, 1, Some(0), 10, 100);
    l.extend(levels(&mut b, 1, Some(1), 10, 110));
    l.extend(levels(&mut b, 1, None, 4, 120));
    let worst = l[XFADE..].windows(2).enumerate().max_by_key(|(_, w)| (w[1] as i32 - w[0] as i32).abs()).map(|(i, w)| (i + XFADE, w[0], w[1]));
    assert!(max_step(&l[XFADE..]) < 100, "a step of {} at {:?}", max_step(&l[XFADE..]), worst);
    assert_eq!(*l.last().unwrap(), 0, "silent once stopped");
}
