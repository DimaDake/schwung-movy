//! Link Audio taps through a real render: what each channel carries.

use super::*;
use crate::link_shm::*;
use std::alloc::{alloc_zeroed, Layout};
use core::ffi::{c_int, c_void};

unsafe extern "C" fn level_render(_i: *mut c_void, out: *mut i16, frames: c_int) {
    unsafe { std::slice::from_raw_parts_mut(out, frames.max(0) as usize * 2) }.fill(1000);
}

/// Track 0 sounds a constant 1000; every channel is subscribed.
fn instance() -> (Instance, *mut LinkShm) {
    let api: &'static ffi::plugin_api_v2_t = Box::leak(Box::new(ffi::plugin_api_v2_t {
        api_version: 0, create_instance: None, destroy_instance: None, on_midi: None,
        set_param: None, get_param: None, get_error: None, render_block: Some(level_render),
    }));
    let mut inst = Instance::new();
    inst.chains.fake_chain_for_test(0, chain_host::ChainInstance::for_test(api), "fake");
    // Leaked: the bridge keeps the pointer for the instance's life.
    let p = unsafe { alloc_zeroed(Layout::new::<LinkShm>()) } as *mut LinkShm;
    unsafe {
        (*p).magic = LINK_MAGIC;
        (*p).version = LINK_VERSION;
        (*p).enabled = 1;
        (*p).subscribed = (1 << LINK_CHANNELS) - 1;
    }
    inst.chains.link = link_bridge::LinkBridge::from_raw(p);
    (inst, p)
}

fn last_block(p: *mut LinkShm, ch: usize) -> Vec<i16> {
    let r = unsafe { &(*p).ring[ch] };
    assert!(r.write > 0, "channel {ch} got no block");
    r.b[(r.write as usize - 1) % LINK_RING].lr.to_vec()
}

fn drain(p: *mut LinkShm) {
    for ch in 0..LINK_CHANNELS {
        unsafe { (*p).ring[ch].read = (*p).ring[ch].write };
    }
}

#[test]
fn track_tap_is_post_fader_and_master_is_pre_volume() {
    let (mut inst, p) = instance();
    inst.chains.set_mix(0, crate::mixer::TrackMix { gain: 0.5, ..Default::default() });
    inst.chains.master_param("vol", "0.25");
    let mut audio = vec![0i16; 256];
    // movy-host zeroes the buffer every frame: the engine adds into it.
    for _ in 0..8 {
        audio.fill(0);
        inst.render(&mut audio);
        drain(p);
    }
    audio.fill(0);
    inst.render(&mut audio);
    let t0 = last_block(p, 0);
    assert!(t0.iter().all(|&x| x == 500), "track 0 at its fader: {:?}", &t0[..4]);
    let master = last_block(p, CH_MASTER);
    assert!(master.iter().all(|&x| x == 500), "master before the volume knob: {:?}", &master[..4]);
    assert!(audio[0] < 200, "the DAC got the volume: {}", audio[0]);
    let t1 = last_block(p, 1);
    assert!(t1.iter().all(|&x| x == 0), "an empty track streams silence");
    let s0 = last_block(p, CH_SEND0);
    assert!(s0.iter().all(|&x| x == 0), "an unused send streams silence");
}

#[test]
fn muted_track_streams_silence() {
    let (mut inst, p) = instance();
    inst.chains.set_mix(0, crate::mixer::TrackMix { muted: true, ..Default::default() });
    let mut audio = vec![0i16; 256];
    // movy-host zeroes the buffer every frame: the engine adds into it.
    for _ in 0..8 {
        audio.fill(0);
        inst.render(&mut audio);
        drain(p);
    }
    audio.fill(0);
    inst.render(&mut audio);
    assert!(last_block(p, 0).iter().all(|&x| x == 0));
}
