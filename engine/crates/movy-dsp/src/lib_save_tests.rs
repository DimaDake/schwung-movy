//! The autosave reads module states a few per block, and still saves them all.

use super::*;
use crate::tests_support::saver_tmp;
use core::ffi::{c_char, c_int, c_void, CStr};
use std::cell::Cell;

std::thread_local! {
    static READS: Cell<u32> = const { Cell::new(0) };
}

/// A module whose preset blob takes 200 us to produce, like a heavy synth.
unsafe extern "C" fn slow_get(_i: *mut c_void, key: *const c_char, buf: *mut c_char, len: c_int) -> c_int {
    let k = unsafe { CStr::from_ptr(key) }.to_str().unwrap_or("");
    if !k.ends_with(":state") {
        return 0;
    }
    READS.with(|n| n.set(n.get() + 1));
    let t = std::time::Instant::now();
    while t.elapsed() < std::time::Duration::from_micros(200) {}
    let v = b"HEAVY-BLOB";
    if v.len() as c_int >= len {
        return -1;
    }
    unsafe { core::ptr::copy_nonoverlapping(v.as_ptr() as *const c_char, buf, v.len()) };
    v.len() as c_int
}

#[test]
fn the_autosave_reads_module_states_across_blocks() {
    const SET: &str = "movy1\nbpm 12300\ncl 0 0 16 0 0:24:60:100\n";
    let dir = saver_tmp("spread-save");
    crate::set_store::SetStore::new(&dir).write("s1", SET, 1, "0\n").unwrap();
    let mut inst = Instance::new();
    inst.set_param("setsdir", &dir);
    inst.set_param("set", "open s1");
    let mut audio = [0i16; 256];
    inst.render(&mut audio);
    inst.saver.as_ref().unwrap().drain_for_test();   // the open lands
    for _ in 0..4 {
        audio.fill(0);
        inst.render(&mut audio);
    }
    let api: &'static ffi::plugin_api_v2_t = Box::leak(Box::new(ffi::plugin_api_v2_t {
        api_version: 0, create_instance: None, destroy_instance: None, on_midi: None,
        set_param: None, get_param: Some(slow_get), get_error: None, render_block: None,
    }));
    for t in [0, 2, 5, 9] {
        inst.chains.fake_chain_for_test(t, chain_host::ChainInstance::for_test(api), "heavy");
    }
    inst.save_at = 0;
    inst.set_param("cmd", "bpm 13000");   // an edit: the Set is dirty
    let mut worst = 0;
    let mut blocks = 0;
    let chains = format!("{dir}/s1/chains.json");
    let before = std::fs::read_to_string(&chains).unwrap_or_default();
    while blocks < 40 {
        READS.with(|n| n.set(0));
        audio.fill(0);
        inst.render(&mut audio);
        worst = worst.max(READS.with(|n| n.get()));
        blocks += 1;
        if inst.save_job.is_none() && !inst.engine.dirty && blocks > 1 {
            break;
        }
    }
    assert!(worst <= 2, "at most two 200 us reads fit a 300 us budget, got {worst}");
    assert!(blocks >= 2, "four heavy modules take more than one block ({blocks})");
    inst.saver.as_ref().unwrap().drain_for_test();
    let after = std::fs::read_to_string(&chains).unwrap();
    assert_ne!(after, before, "it saved");
    assert_eq!(after.matches("HEAVY-BLOB").count(), 4, "every module's blob is in it: {after}");
}

#[test]
fn every_edit_window_gets_its_own_save() {
    const SET: &str = "movy1\nbpm 12300\ncl 0 0 16 0 0:24:60:100\n";
    let dir = saver_tmp("spread-save-many");
    crate::set_store::SetStore::new(&dir).write("s1", SET, 1, "0\n").unwrap();
    let mut inst = Instance::new();
    inst.set_param("setsdir", &dir);
    inst.set_param("set", "open s1");
    let mut audio = [0i16; 256];
    inst.render(&mut audio);
    inst.saver.as_ref().unwrap().drain_for_test();
    let api: &'static ffi::plugin_api_v2_t = Box::leak(Box::new(ffi::plugin_api_v2_t {
        api_version: 0, create_instance: None, destroy_instance: None, on_midi: None,
        set_param: None, get_param: Some(slow_get), get_error: None, render_block: None,
    }));
    for t in [0, 2, 5, 9] {
        inst.chains.fake_chain_for_test(t, chain_host::ChainInstance::for_test(api), "heavy");
    }
    let g0 = inst.set_gen;
    for i in 0..4 {
        inst.set_param("cmd", &format!("swing {}", 51 + i));
        for _ in 0..(SAVE_BLOCKS + 10) {
            audio.fill(0);
            inst.render(&mut audio);
        }
    }
    assert_eq!(inst.set_gen - g0, 4, "four edits two seconds apart are four saves");
}
