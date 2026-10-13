//! Where the engine's own threads may run.
//!
//! movy-host calls `set_param` on its audio thread, which it pins to core 3
//! (`host/audio.c`). A thread spawned from there inherits that pin, and its
//! name: the set saver ran its file I/O on the audio core as a second
//! "movy-audio" (seen in `/proc`, WP11). Every engine thread therefore says
//! where it belongs instead of inheriting it.

/// The cores off the audio thread's. The UI and the log writer float over all
/// four; the audio core is the only one an engine thread must never take.
#[cfg(target_os = "linux")]
pub const OFF_AUDIO_CORES: u64 = 0x7;

/// Keep the calling thread off the audio core. Returns the `sched_setaffinity`
/// result: a refusal degrades placement, never correctness.
pub fn leave_audio_core() -> i32 {
    #[cfg(target_os = "linux")]
    {
        let mask = OFF_AUDIO_CORES;
        unsafe { sched_setaffinity(0, core::mem::size_of::<u64>(), &mask) }
    }
    #[cfg(not(target_os = "linux"))]
    0
}

/// The calling thread's mask, read raw (the first 64 cores) for the test.
#[cfg(all(test, target_os = "linux"))]
fn current_mask() -> u64 {
    let mut mask: u64 = 0;
    unsafe { sched_getaffinity(0, core::mem::size_of::<u64>(), &mut mask) };
    mask
}

#[cfg(target_os = "linux")]
extern "C" {
    fn sched_setaffinity(pid: i32, len: usize, mask: *const u64) -> i32;
    #[cfg(test)]
    fn sched_getaffinity(pid: i32, len: usize, mask: *mut u64) -> i32;
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn a_thread_that_leaves_the_audio_core_is_off_it() {
        std::thread::spawn(|| {
            assert_eq!(leave_audio_core(), 0);
            assert_eq!(current_mask() & !OFF_AUDIO_CORES, 0);
        })
        .join()
        .unwrap();
    }
}
