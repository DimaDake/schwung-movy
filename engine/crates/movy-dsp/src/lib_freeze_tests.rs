//! lib.rs's half of freeze: what `frz` refuses, and the UI's chain document
//! held while an open is in flight.

use super::*;
use core::ffi::{c_int, c_void};

/// Render until the open the saver is working on is in the engine.
fn settle(inst: &mut Instance, audio: &mut [i16]) {
    for _ in 0..200 {
        inst.saver.as_ref().unwrap().drain_for_test();
        inst.render(audio);
        if !inst.open_pending {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    panic!("the open never landed");
}

fn frze(inst: &mut Instance) -> String {
    let st = inst.get_param("status").unwrap();
    st.split(' ').find_map(|kv| kv.strip_prefix("frze=")).unwrap_or("").to_string()
}

#[test]
fn frz_refuses_a_muted_track_and_one_that_is_recording() {
    let mut inst = Instance::new();
    inst.set_param("cmd", "tog 3 0 60 100;mute 3 1");
    inst.set_param("frz", "3");
    assert!(frze(&mut inst).ends_with(":3:muted"), "{}", frze(&mut inst));
    assert!(!inst.engine.freeze_lock.locked(3), "a refusal locks nothing");
    inst.set_param("cmd", "mute 3 0;rec 3");
    inst.set_param("frz", "3");
    assert!(frze(&mut inst).ends_with(":3:rec"), "{}", frze(&mut inst));
}

#[test]
fn frz_on_an_empty_slot_is_noclip() {
    let mut inst = Instance::new();
    inst.set_param("frz", "5");
    assert!(frze(&mut inst).ends_with(":5:noclip"));
}

/// Reviewed: the UI sends the Set's chains right after `set open`, before the
/// engine's own restore, so a frozen track's synth loaded (0.3-0.5 s on the
/// audio thread) only to be retired again by `freeze_install`. Held until the
/// open lands — and, found on device (automation p3, page-lifecycle L4), never
/// reported as "nothing pending" meanwhile: the UI delivers the chains' saved
/// state once `chpend` drains, so a 0 while held lost every preset.
#[test]
fn the_uis_chains_wait_for_the_open_and_count_as_pending() {
    let doc = chain_state::pack(&["2".into(), "synth".into(), "obxd".into(),
                                  String::new(), String::new(), String::new()]);
    let dir = super::tests_support::saver_tmp("held-chains");
    crate::set_store::SetStore::new(&dir).write("s1", "movy1\n", 3, &doc).unwrap();
    std::fs::create_dir_all(format!("{dir}/bad")).unwrap();
    std::fs::write(format!("{dir}/bad/seq-state.json"), "movy1\ngen 4\ntorn").unwrap();
    let mut inst = Instance::new();
    inst.set_param("setsdir", &dir);
    let mut audio = [0i16; 256];

    inst.set_param("set", "open s1");
    inst.set_param("chains", &chain_state::pack(&["2".into(), "synth".into(), "obxd".into()]));
    assert!(inst.held_chains.is_some(), "held while the open is in flight");
    assert!(!inst.get_param("status").unwrap().contains(" chpend=0"),
            "a held document is a pending load: the UI must not deliver the saved state yet");
    settle(&mut inst, &mut audio);
    assert!(inst.held_chains.is_none(), "applied when the open landed");
    assert!(inst.chains.loaded_report().contains("2:synth=obxd"), "{}", inst.chains.loaded_report());

    // What the UI sends: `slot, component, module` triples (chain-persist.ts).
    let other = chain_state::pack(&["4".into(), "synth".into(), "plaits".into()]);
    /* An open that fails leaves the engine pending (no Set to autosave
     * over): the UI's document is then all there is. */
    inst.set_param("set", "open bad");
    inst.set_param("chains", &other);
    for _ in 0..200 {
        inst.saver.as_ref().unwrap().drain_for_test();
        inst.render(&mut audio);
        if inst.held_chains.is_none() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    assert!(inst.held_chains.is_none(), "held forever after a failed open");
    assert!(inst.chains.loaded_report().contains("4:synth=plaits"), "a failed open takes the UI's: {}",
            inst.chains.loaded_report());
}

/* A fake synth for the freeze: it sounds the last note-on it was sent as a
 * constant level of pitch x 100, so what a track plays (its heard loop, or
 * the clip being recorded) can be told apart by level. */
std::thread_local! {
    static LAST_PITCH: core::cell::Cell<i16> = const { core::cell::Cell::new(0) };
}

unsafe extern "C" fn fake_note(_i: *mut c_void, msg: *const u8, len: c_int, _src: c_int) {
    let m = unsafe { std::slice::from_raw_parts(msg, len.max(0) as usize) };
    if m.len() == 3 && m[0] & 0xF0 == 0x90 && m[2] > 0 {
        LAST_PITCH.with(|p| p.set(m[1] as i16));
    }
}

unsafe extern "C" fn fake_render(_i: *mut c_void, out: *mut i16, frames: c_int) {
    let level = LAST_PITCH.with(|p| p.get()) * 100;
    unsafe { std::slice::from_raw_parts_mut(out, frames.max(0) as usize * 2) }.fill(level);
}

/// Track 2 with clips in slots 0, 1, 2 (pitches 10, 20, 30 at step 0, held
/// a whole bar so the level stays), the fake synth on it, and a Set to save to.
fn three_clips() -> Instance {
    let api: &'static ffi::plugin_api_v2_t = Box::leak(Box::new(ffi::plugin_api_v2_t {
        api_version: 0, create_instance: None, destroy_instance: None, on_midi: Some(fake_note),
        set_param: None, get_param: None, get_error: None, render_block: Some(fake_render),
    }));
    LAST_PITCH.with(|p| p.set(0));
    let mut inst = Instance::new();
    inst.chains.fake_chain_for_test(2, chain_host::ChainInstance::for_test(api), "fake");
    inst.set_param("cmd", "tog 2 0 10 100;clipsel 2 1;tog 2 0 20 100;clipsel 2 2;tog 2 0 30 100;clipsel 2 0");
    inst
}

fn frz_mask(inst: &mut Instance) -> u32 {
    let st = inst.get_param("status").unwrap();
    u32::from_str_radix(st.split(' ').find_map(|kv| kv.strip_prefix("frz=")).unwrap_or("0"), 16).unwrap_or(0)
}

fn frzc(inst: &mut Instance) -> String {
    let st = inst.get_param("status").unwrap();
    st.split(' ').find_map(|kv| kv.strip_prefix("frzc=")).unwrap_or("").to_string()
}

#[test]
fn freezing_three_clips_while_playing_ends_frozen_with_three_loops() {
    let mut inst = three_clips();
    let mut audio = [0i16; 256];
    inst.set_param("cmd", "play");
    for _ in 0..50 {
        inst.render(&mut audio);
    }
    inst.set_param("frz", "2");
    let mut blocks = 0;
    let mut heard_after_first = Vec::new();
    while frz_mask(&mut inst) & (1 << 2) == 0 {
        inst.render(&mut audio);
        blocks += 1;
        if frzc(&mut inst).starts_with("2:1/") || frzc(&mut inst).starts_with("2:2/") {
            heard_after_first.push(inst.chains.peak_for_test(2));
        }
        assert!(blocks < 20_000, "never froze: {}", frzc(&mut inst));
    }
    assert!(!heard_after_first.is_empty());
    assert!(heard_after_first.iter().skip(2).all(|&p| p == 1000),
            "slot 0's loop is what is heard while 1 and 2 record: {:?}", &heard_after_first[..20.min(heard_after_first.len())]);
    assert_eq!(inst.engine.tracks[2].playing_slot, Some(0), "the playhead is back on the heard clip");
    assert!(!inst.engine.freeze_lock.swapped(2));
    for _ in 0..10 {
        inst.render(&mut audio);
    }
    assert_eq!(inst.chains.peak_for_test(2), 1000);
    // A launch elsewhere plays that clip's own loop.
    inst.set_param("cmd", "launch 2 2");
    for _ in 0..800 {
        inst.render(&mut audio);
    }
    assert_eq!(inst.engine.tracks[2].playing_slot, Some(2));
    assert_eq!(inst.chains.peak_for_test(2), 3000, "slot 2's loop");
}

#[test]
fn back_mid_way_restores_the_heard_clip_in_phase_and_frees_every_loop() {
    let mut inst = three_clips();
    let mut reference = three_clips();
    let mut audio = [0i16; 256];
    inst.set_param("cmd", "play");
    reference.set_param("cmd", "play");
    let both = |a: &mut Instance, b: &mut Instance, n: usize, audio: &mut [i16]| for _ in 0..n {
        a.render(audio);
        b.render(audio);
    };
    both(&mut inst, &mut reference, 37, &mut audio);
    inst.set_param("frz", "2");
    while !frzc(&mut inst).starts_with("2:1/") {
        both(&mut inst, &mut reference, 1, &mut audio);
    }
    both(&mut inst, &mut reference, 333, &mut audio);
    assert_eq!(inst.engine.tracks[2].playing_slot, Some(1), "slot 1 is being recorded");
    inst.set_param("frzx", "2");
    both(&mut inst, &mut reference, 1, &mut audio);
    assert_eq!(frzc(&mut inst), "-");
    assert_eq!(frz_mask(&mut inst), 0);
    assert!(!inst.engine.freeze_lock.locked(2) && !inst.engine.freeze_lock.swapped(2));
    let (a, b) = (&inst.engine.tracks[2], &reference.engine.tracks[2]);
    assert_eq!((a.playing_slot, a.pos_tick, a.scale_acc), (b.playing_slot, b.pos_tick, b.scale_acc), "in phase");
}

#[test]
fn stopped_records_every_clip_silently_and_stops_again() {
    let mut inst = three_clips();
    let mut audio = [0i16; 256];
    inst.set_param("frz", "2");
    let mut blocks = 0;
    while frz_mask(&mut inst) & (1 << 2) == 0 {
        inst.render(&mut audio);
        assert!(audio.iter().all(|&s| s == 0), "a stopped freeze is silent");
        blocks += 1;
        assert!(blocks < 20_000, "never froze: {}", frzc(&mut inst));
    }
    for _ in 0..3 {
        inst.render(&mut audio);
    }
    assert!(!inst.engine.playing, "stopped again");
    let st = inst.get_param("status").unwrap();
    assert!(st.contains(":2:frozen"), "{st}");
}

#[test]
fn frzpk_answers_the_recorded_window_and_peaks_from_the_saver() {
    let dir = super::tests_support::saver_tmp("frzpk");
    crate::set_store::SetStore::new(&dir).write("s1", "movy1\n", 3, "").unwrap();
    let mut inst = three_clips();
    inst.set_param("setsdir", &dir);
    let mut audio = [0i16; 256];
    inst.set_param("set", "open s1");
    settle(&mut inst, &mut audio);
    // The open replaced the sequencer: the clips again.
    inst.set_param("cmd", "tog 2 0 10 100;clipsel 2 1;tog 2 0 20 100;clipsel 2 0");
    assert_eq!(inst.get_param("frzpk_2_0"), None, "nothing frozen");
    inst.set_param("frz", "2");
    while frz_mask(&mut inst) & (1 << 2) == 0 {
        inst.render(&mut audio);
    }
    let seq0 = inst.get_param("status").unwrap().split(' ').find_map(|kv| kv.strip_prefix("frzp=").map(str::to_string));
    for _ in 0..50 {
        inst.render(&mut audio);
        inst.saver.as_ref().unwrap().drain_for_test();
    }
    let seq1 = inst.get_param("status").unwrap().split(' ').find_map(|kv| kv.strip_prefix("frzp=").map(str::to_string));
    assert_ne!(seq0, seq1, "frzp moved when the peaks arrived");
    let pk = inst.get_param("frzpk_2_1").expect("slot 1's peaks");
    let f: Vec<&str> = pk.split(' ').collect();
    assert_eq!((f[0], f[1], f[2].len()), ("0", "16", crate::freeze_files::PEAK_COLS * 2));
    let level = u8::from_str_radix(&f[2][100..102], 16).unwrap();
    assert_eq!(level as u32, 2000 * 255 / 32_767, "slot 1's level");
}
