//! chain_state::SerializeJob: the autosave reads the chain set a few module
//! states per block, never all of them in one.

use super::*;
use crate::chain_state::{serialize, SerializeJob};
use crate::ffi::plugin_api_v2_t;
use core::ffi::{c_char, c_int, c_void, CStr};
use std::cell::Cell;
use std::time::Duration;

std::thread_local! {
    static STATE_READS: Cell<u32> = const { Cell::new(0) };
}

unsafe extern "C" fn counting_get(_i: *mut c_void, key: *const c_char, buf: *mut c_char, len: c_int) -> c_int {
    let k = unsafe { CStr::from_ptr(key) }.to_str().unwrap_or("");
    let v = if k.ends_with(":state") {
        STATE_READS.with(|n| n.set(n.get() + 1));
        "BLOB"
    } else {
        ""
    };
    if v.len() as c_int >= len {
        return -1;
    }
    unsafe { core::ptr::copy_nonoverlapping(v.as_ptr() as *const c_char, buf, v.len()) };
    v.len() as c_int
}

/// Three tracks, each a synth and an FX: six module states to read.
fn three_chains() -> ChainSlots {
    let api: &'static plugin_api_v2_t = Box::leak(Box::new(plugin_api_v2_t {
        api_version: 0, create_instance: None, destroy_instance: None, on_midi: None,
        set_param: None, get_param: Some(counting_get), get_error: None, render_block: None,
    }));
    let mut slots = ChainSlots::new();
    for t in [0, 3, 7] {
        slots.slots[t] = Some(ChainInstance::for_test(api));
        slots.desired[t] = vec![("synth".into(), "obxd".into()), ("fx1".into(), "mverb".into())];
    }
    slots
}

#[test]
fn a_spent_budget_reads_one_module_per_block() {
    let mut slots = three_chains();
    let whole = serialize(&mut slots);
    let mut job = SerializeJob::new(&slots);
    let mut steps = 0;
    let doc = loop {
        STATE_READS.with(|n| n.set(0));
        let r = job.step(&mut slots, Duration::ZERO);
        assert!(STATE_READS.with(|n| n.get()) <= 1, "at most one module state per block");
        steps += 1;
        if let Some(d) = r {
            break d;
        }
        assert!(steps < 20, "it finishes");
    };
    assert_eq!(steps, 6, "one block per component");
    assert_eq!(doc, whole, "and writes exactly what a one-shot serialize would");
}

#[test]
fn a_generous_budget_finishes_in_one_block() {
    let mut slots = three_chains();
    let whole = serialize(&mut slots);
    let mut job = SerializeJob::new(&slots);
    assert_eq!(job.step(&mut slots, Duration::from_secs(1)).as_deref(), Some(whole.as_str()));
}

#[test]
fn a_chain_change_mid_save_starts_the_read_over() {
    let mut slots = three_chains();
    let mut job = SerializeJob::new(&slots);
    assert!(job.step(&mut slots, Duration::ZERO).is_none());
    // A module swapped while the save was being read: half of the document
    // would describe the old chain set.
    slots.desired[3] = vec![("synth".into(), "dexed".into())];
    let doc = loop {
        if let Some(d) = job.step(&mut slots, Duration::from_secs(1)) {
            break d;
        }
    };
    assert_eq!(doc, serialize(&mut slots), "the finished document is the new chain set's");
    assert!(doc.contains("dexed"));
}
