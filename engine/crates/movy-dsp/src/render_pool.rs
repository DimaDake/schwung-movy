//! Persistent helper threads that render chains alongside the audio thread.
//!
//! `plans/2026-08-22-join-cost-prototype.md` measured this mechanism standalone:
//! waking N helpers and joining them costs ~21 us, essentially all of it
//! scheduler wake latency, and it does not grow with the workload. This is that
//! mechanism wired to the real chains.
//!
//! Three constraints shape every decision here:
//!
//! - **Threads are created once.** A spawn is tens of microseconds against a
//!   2902 us frame, and `render` runs inside schwung's `ioctl` hook.
//! - **Nothing allocates on the audio thread.** Task lists are preallocated to
//!   `MOVY_CHAINS` and only ever cleared and refilled within that capacity.
//! - **Helpers must never sit at or above Move's own audio threads, and must
//!   never touch core 3.** Both are schwung's rules, stated in
//!   `docs/REALTIME_SAFETY.md` and enforced there by commits that removed
//!   exactly this mistake (`8592be5c`, `25b72907`).

use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::host;

/// One chain's `render_block`, as the pool sees it. Deliberately the raw v2 FFI
/// pair rather than a `ChainInstance`: the pool then has no view of chain state
/// at all, which is what makes its safety argument checkable in one place.
#[derive(Clone, Copy)]
pub struct Task {
    /// What puts audio in `buf` before `process_fx` sees it.
    pub pre: Pre,
    /// Send buses this task's output is summed into, by the lane that produced
    /// it rather than by the audio thread after the join.
    ///
    /// This is what lets a bus render on a chain lane: the tap and the bus's own
    /// FX pass are then two entries in ONE lane's ordered task list, so the sum
    /// is complete before the FX reads it without any synchronisation at all.
    /// A tap is only ever built for a bus co-located on this same lane — see
    /// `chain_colo`; every other bus is still summed on the audio thread.
    pub taps: [Option<Tap>; MAX_TAPS],
    /// `None` when the FX is asleep, or when the chain is not being split at
    /// all and `render` already did the FX itself.
    pub process_fx: Option<unsafe extern "C" fn(*mut c_void, *mut i16, i32)>,
    pub inst: *mut c_void,
    pub buf: *mut i16,
    pub frames: i32,
    pub chain: usize,
}

/// The most send buses one chain can be tapped into by its own lane. Sized to
/// `send_bus::SEND_BUSES`, kept as a separate constant so this module stays free
/// of the mixer's types; `taps_cover_every_bus` pins them together.
pub const MAX_TAPS: usize = 4;

/// A task that taps nothing — every chain on the serial path, and every chain
/// whose buses are not co-located with it.
pub const NO_TAPS: [Option<Tap>; MAX_TAPS] = [None; MAX_TAPS];

/// One bus a lane sums a rendered block into, at that track's send gains.
#[derive(Clone, Copy)]
pub struct Tap {
    pub buf: *mut i16,
    pub gl: f32,
    pub gr: f32,
}

/// Where a task's input comes from.
///
/// The distinction between the last two is the whole reason this is an enum
/// rather than an `Option`: both mean "no synth ran", and they want OPPOSITE
/// things done to the buffer. Getting them confused is silent — a stuck buzz in
/// one direction, a send bus that never sounds in the other.
#[derive(Clone, Copy)]
pub enum Pre {
    /// The chain's synth renders into `buf`.
    Render(unsafe extern "C" fn(*mut c_void, *mut i16, i32)),
    /// The synth is asleep, so the lane zeroes `buf`: `process_fx` must decay a
    /// tail into silence, not into whatever the last block left behind.
    Silence,
    /// `buf` already holds this task's input and must be left alone — a send
    /// bus, whose buffer is the sum every track fed it before the join. Zeroing
    /// it would delete exactly the audio the FX exists to process.
    Keep,
}

struct Lane {
    /// Written by the audio thread only while every helper is idle (`pending ==
    /// 0`), published by the release on `generation`, and read by exactly one
    /// helper after its acquire. That pair is the whole synchronisation.
    tasks: UnsafeCell<Vec<Task>>,
}

struct Shared {
    generation: AtomicU32,
    pending: AtomicU32,
    stop: AtomicBool,
    /// Helpers that have taken their first `generation` snapshot.
    ///
    /// Without this handshake a helper that is still starting up when the first
    /// round is published snapshots the ALREADY-BUMPED generation, concludes it
    /// has nothing to do, and parks — permanently, since it will never see that
    /// round's bump again. `pending` then never reaches zero and the pool
    /// poisons itself on its very first block. Startup is the only moment this
    /// can happen, and waiting for it once is the whole fix.
    ready: AtomicU32,
    lanes: Vec<Lane>,
    cost_ns: Vec<AtomicU64>,
    /// The synth stage alone. Measured before the peak scan, so movy's own
    /// bookkeeping is not attributed to the module.
    synth_ns: Vec<AtomicU64>,
    /// Each chain's output peak after its synth stage and BEFORE its FX. Taken
    /// on the lane, because the audio thread only ever sees the buffer once
    /// both stages have run — and by then an FX that never settles would be
    /// holding a silent synth awake.
    synth_peak: Vec<AtomicI32>,
}

/* `Task` holds raw pointers, so `Shared` is not automatically shareable. It is
 * sound here because the audio thread hands each chain instance and each output
 * buffer to exactly ONE lane per round (`render_plan::plan` returns a partition,
 * asserted by `every_chain_lands_in_exactly_one_lane`), and the
 * release/acquire on `generation` plus the release/acquire on `pending` give
 * happens-before in both directions. No two threads ever hold the same
 * `inst` or `buf`. */
unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

/// How long the audio thread will wait for a wedged helper before giving up on
/// the pool entirely. Far past the point where the frame is lost — the choice is
/// only between a glitch and hanging MoveOriginal, and a hang needs a reboot.
const JOIN_BAIL: Duration = Duration::from_millis(250);

pub struct RenderPool {
    shared: Arc<Shared>,
    handles: Vec<JoinHandle<()>>,
    threads: Vec<thread::Thread>,
    /// Set after a bail-out. The pool is never used again — a helper that missed
    /// its deadline may still be writing into a buffer we no longer wait for.
    poisoned: AtomicBool,
    joins_yielded: AtomicU32,
}

impl RenderPool {
    /// `helpers` threads beside the audio thread, so `helpers + 1` lanes.
    pub fn new(helpers: usize, chains: usize) -> Self {
        let shared = Arc::new(Shared {
            generation: AtomicU32::new(0),
            pending: AtomicU32::new(0),
            stop: AtomicBool::new(false),
            ready: AtomicU32::new(0),
            lanes: (0..helpers)
                .map(|_| Lane { tasks: UnsafeCell::new(Vec::with_capacity(chains)) })
                .collect(),
            cost_ns: (0..chains).map(|_| AtomicU64::new(0)).collect(),
            synth_ns: (0..chains).map(|_| AtomicU64::new(0)).collect(),
            synth_peak: (0..chains).map(|_| AtomicI32::new(0)).collect(),
        });

        let mut handles = Vec::with_capacity(helpers);
        let mut threads = Vec::with_capacity(helpers);
        for lane in 0..helpers {
            let s = Arc::clone(&shared);
            let h = thread::Builder::new()
                .name(format!("movy-render{lane}"))
                .stack_size(512 * 1024)
                .spawn(move || worker(s, lane))
                .expect("render worker");
            threads.push(h.thread().clone());
            handles.push(h);
        }
        // Block until every helper is armed. This is a one-time cost paid where
        // the caller asked for the pool — never on a render — and it is what
        // makes the first block as safe as the thousandth.
        while shared.ready.load(Ordering::Acquire) < helpers as u32 {
            thread::yield_now();
        }
        host::log(&format!("render pool: {helpers} helper(s)"));
        Self { shared, handles, threads, poisoned: AtomicBool::new(false), joins_yielded: AtomicU32::new(0) }
    }

    pub fn helpers(&self) -> usize {
        self.handles.len()
    }

    pub fn is_poisoned(&self) -> bool {
        self.poisoned.load(Ordering::Relaxed)
    }

    /// Render one block. `lanes[0]` runs on the calling (audio) thread;
    /// `lanes[1..]` go to the helpers. Returns when every task is complete.
    ///
    /// Callers must not read any task's `buf` before this returns.
    pub fn render_block(&self, lanes: &[Vec<Task>]) {
        let helpers = self.handles.len();
        // Nothing for a helper to do: run what there is inline and skip the
        // rendezvous. The unpark/join pair is pure scheduler wake, so paying it
        // for zero tasks is the whole cost of the pool and none of the benefit —
        // which is exactly a set that `chidle` has put to sleep. Identical
        // output either way: `run` is the same call on the same tasks, and lane
        // 0 already runs first.
        if self.is_poisoned() || lanes.is_empty() || lanes[1..].iter().all(|l| l.is_empty()) {
            for l in lanes {
                run(l, &self.shared);
            }
            return;
        }

        for i in 0..helpers {
            let src: &[Task] = lanes.get(i + 1).map(|v| v.as_slice()).unwrap_or(&[]);
            // Safe: every helper is idle — `pending` is 0 on entry, because the
            // previous round's join is what let this call happen.
            let dst = unsafe { &mut *self.shared.lanes[i].tasks.get() };
            dst.clear();
            dst.extend_from_slice(src);
        }
        self.shared.pending.store(helpers as u32, Ordering::Relaxed);
        // Release: publishes the task lists and `pending` to every acquiring helper.
        self.shared.generation.fetch_add(1, Ordering::Release);
        for t in &self.threads {
            t.unpark();
        }

        // Lane 0 plus anything the pool has no helper for. A plan is built for a
        // lane count the pool may not have (the helper count is fixed at first
        // enable), and dropping the surplus would silence chains rather than
        // slow them down.
        run(&lanes[0], &self.shared);
        for l in lanes.iter().skip(helpers + 1) {
            run(l, &self.shared);
        }
        self.join();
    }

    fn join(&self) {
        // Measured join latency is 0.3 us at p50: by the time the audio thread
        // finishes its own lane the helpers are usually already done, so a short
        // spin beats a futex round trip. Yield after that rather than burn a core
        // one of them may need.
        let mut spins = 0u32;
        let start = Instant::now();
        while self.shared.pending.load(Ordering::Acquire) != 0 {
            spins += 1;
            if spins < 4096 {
                std::hint::spin_loop();
            } else {
                if start.elapsed() > JOIN_BAIL {
                    self.poisoned.store(true, Ordering::Relaxed);
                    host::log("render pool: helper missed its deadline — serial from here");
                    return;
                }
                thread::yield_now();
            }
        }
        if spins >= 4096 {
            self.joins_yielded.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// What each chain's `render_block` cost in the last block, nanoseconds.
    /// The chain's output peak after the synth stage and before the FX.
    pub fn synth_peak(&self, chain: usize) -> i32 {
        self.shared.synth_peak.get(chain).map_or(0, |p| p.load(Ordering::Relaxed))
    }

    pub fn cost_ns(&self, chain: usize) -> u64 {
        self.shared.cost_ns.get(chain).map_or(0, |c| c.load(Ordering::Relaxed))
    }

    /// What the chain's synth stage cost in the last block it ran, nanoseconds.
    pub fn synth_ns(&self, chain: usize) -> u64 {
        self.shared.synth_ns.get(chain).map_or(0, |s| s.load(Ordering::Relaxed))
    }

    /// Blocks where the join needed more than a spin.
    ///
    /// NOT a fault count. The audio thread reaching the join first is the normal
    /// outcome of an uneven partition — its own lane simply finished early. What
    /// the number is good for is separating the two ways parallel render loses
    /// time: a count near zero with a poor speedup means the partition is
    /// unbalanced, a high count with a good speedup means fan-out latency.
    pub fn joins_yielded_blocks(&self) -> u32 {
        self.joins_yielded.load(Ordering::Relaxed)
    }
}

impl Drop for RenderPool {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::Release);
        for t in &self.threads {
            t.unpark();
        }
        for h in self.handles.drain(..) {
            let _ = h.join();
        }
    }
}

fn run(tasks: &[Task], shared: &Shared) {
    for t in tasks {
        let t0 = Instant::now();
        // Anything the module sends from inside this call is parked against
        // `t.chain` and replayed on the audio thread after the join — schwung's
        // MIDI-out senders are single-producer. See `midi_out`.
        let _scope = crate::midi_out::Scope::enter(t.chain);
        let samples = (t.frames as usize) * 2;
        // Safe by the partition argument on `Shared`: this lane owns `inst` and
        // `buf` for the duration of the round.
        unsafe {
            match t.pre {
                Pre::Render(f) => f(t.inst, t.buf, t.frames),
                // A sleeping synth still owes its FX a block of SILENCE. Handing
                // it the previous block is a stuck buzz, not a decaying tail.
                Pre::Silence => core::ptr::write_bytes(t.buf, 0, samples),
                // A send bus's input is already there. See `Pre::Keep`.
                Pre::Keep => {}
            }
        }
        // Split HERE, not after the peak scan: the scan is movy's own
        // bookkeeping, and a module must not be charged for it. A sleeping
        // synth rendered nothing, so it cost nothing — the zero-fill above is
        // ours.
        let rendered = matches!(t.pre, Pre::Render(_));
        let synth_ns = if rendered { t0.elapsed().as_nanos() as u64 } else { 0 };
        if let Some(s) = shared.synth_ns.get(t.chain) {
            s.store(synth_ns, Ordering::Relaxed);
        }
        // Measured HERE, between the two stages: an FX that never settles must
        // not be able to hold a silent synth awake.
        //
        // Only scanned for a synth that ran: `Silence` just zeroed the buffer,
        // and a `Keep` task has no synth stage to gate — scanning either would
        // charge 256 samples of movy's bookkeeping for an answer already known.
        // A `Keep` task is scanned too, and the number means something else for
        // it: the peak of what the lanes SUMMED IN, taken at the only moment it
        // still exists. A co-located bus's FX is about to overwrite this buffer,
        // and the audio thread never sees the input at all — without this,
        // `sndlog in=` would go blind on exactly the path most likely to have a
        // bug in it, and a silent bus would be indistinguishable from one
        // nothing fed. 256 reads against an FX pass that costs hundreds of
        // microseconds.
        if let Some(p) = shared.synth_peak.get(t.chain) {
            let mut peak = 0i32;
            if rendered || matches!(t.pre, Pre::Keep) {
                for k in 0..samples {
                    let s = unsafe { *t.buf.add(k) } as i32;
                    peak = peak.max(s.abs());
                }
            }
            p.store(peak, Ordering::Relaxed);
        }
        if let Some(f) = t.process_fx {
            unsafe { f(t.inst, t.buf, t.frames) };
        }
        /* Tapped AFTER the FX, so a send is post-insert exactly as it is on the
         * audio-thread path — a track's send carries what the track sounds
         * like, not what its synth produced before its own effects.
         *
         * Charged to this task's cost, deliberately: the sum is work the lane
         * did for this chain, and hiding it would make a co-located plan look
         * cheaper than it is to the very planner that decides to build one. */
        for tap in t.taps.iter().flatten() {
            // Safe by the same partition argument as `buf`: a tap is only built
            // for a bus assigned to THIS lane, so no other thread holds it.
            let dst = unsafe { core::slice::from_raw_parts_mut(tap.buf, samples) };
            let src = unsafe { core::slice::from_raw_parts(t.buf, samples) };
            crate::mixer::mix_into_gains(dst, src, tap.gl, tap.gr);
        }
        if let Some(c) = shared.cost_ns.get(t.chain) {
            c.store(t0.elapsed().as_nanos() as u64, Ordering::Relaxed);
        }
    }
}

fn worker(shared: Arc<Shared>, lane: usize) {
    configure_thread(lane);
    let mut last = shared.generation.load(Ordering::Acquire);
    // Release: the snapshot above is taken before anyone can publish a round.
    shared.ready.fetch_add(1, Ordering::Release);
    loop {
        if shared.stop.load(Ordering::Acquire) {
            return;
        }
        // Acquire: pairs with the audio thread's release, so the task list this
        // reads is the one just published.
        let g = shared.generation.load(Ordering::Acquire);
        if g != last {
            last = g;
            let tasks = unsafe { &*shared.lanes[lane].tasks.get() };
            run(tasks, &shared);
            // Release: everything written into `buf` is visible to the joiner.
            shared.pending.fetch_sub(1, Ordering::Release);
        } else {
            // A wake that lands before the park is not lost — `unpark` leaves a
            // token and `park` returns immediately. Spurious returns re-check.
            thread::park();
        }
    }
}

fn configure_thread(lane: usize) {
    set_flush_to_zero();
    #[cfg(target_os = "linux")]
    {
        // Cores 0-2. Core 3 belongs to Move's SPI audio thread and schwung's
        // realtime doc forbids putting compute there.
        let mask: u64 = 0x7;
        let aff = unsafe { sched_setaffinity(0, core::mem::size_of::<u64>(), &mask) };
        // Below Move's own FIFO 70 workers, so a helper can never preempt the
        // audio callback. The price is that Move can preempt US, which is what
        // `joins_yielded_blocks` counts.
        let param = SchedParam { sched_priority: 68 };
        let sch = unsafe { sched_setscheduler(0, SCHED_FIFO, &param) };
        if aff != 0 || sch != 0 {
            // Degrade, never fail: SCHED_OTHER helpers still render correctly,
            // they just miss their deadline more often.
            host::log(&format!("render worker {lane}: affinity={aff} sched={sch} (degraded)"));
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = lane;
}

/// Flush-to-zero denormals, exactly as `schwung_shim.c:5013` does for the SPI
/// thread. FPCR is **per-thread**, so a helper starts with FZ off: without this
/// a decaying IIR tail — reverb, filter, released envelope — grinds through
/// gradual-underflow range and a helper can be slower per chain than the serial
/// path it replaced. It also makes serial and parallel output bit-identical,
/// without which the equivalence oracle compares two different computations.
fn set_flush_to_zero() {
    #[cfg(target_arch = "aarch64")]
    unsafe {
        let mut fpcr: u64;
        core::arch::asm!("mrs {0}, fpcr", out(reg) fpcr, options(nomem, nostack));
        fpcr |= 1 << 24; // FZ
        core::arch::asm!("msr fpcr, {0}", in(reg) fpcr, options(nomem, nostack));
    }
}

#[cfg(target_os = "linux")]
const SCHED_FIFO: i32 = 1;

#[cfg(target_os = "linux")]
#[repr(C)]
struct SchedParam {
    sched_priority: i32,
}

#[cfg(target_os = "linux")]
extern "C" {
    fn sched_setaffinity(pid: i32, len: usize, mask: *const u64) -> i32;
    fn sched_setscheduler(pid: i32, policy: i32, param: *const SchedParam) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHAINS: usize = 6;
    const BLOCK: usize = 4;

    /// Stands in for a module's `render_block`: writes a pattern derived from
    /// the instance it was given, so a lane that rendered into the wrong buffer
    /// — or twice into one — shows up in the output rather than being merely
    /// suspected.
    unsafe extern "C" fn fill(inst: *mut c_void, out: *mut i16, frames: i32) {
        let tag = inst as i16;
        for i in 0..frames as usize * 2 {
            *out.add(i) = tag + i as i16;
        }
    }

    /// Stands in for a module that sends MIDI from its render — the case
    /// `midi_out` exists for. The chain it is attributed to is whatever the
    /// pool set, so the parked note NAMES the attribution and a wrong one is
    /// visible rather than merely possible.
    unsafe extern "C" fn sends_midi(inst: *mut c_void, _out: *mut i16, _frames: i32) {
        crate::midi_out::QUEUE.park(&[0x09, 0x90, inst as u8, 100], false);
    }

    /* The safety claim of the whole `midi_out` unit rests on `run` scoping every
     * module call, since under parallel EVERY lane — the audio thread's included
     * — goes through it. Without the scope a helper's send reaches schwung's
     * single-producer ring directly, which is the race, and nothing about the
     * audio would show it. */
    #[test]
    fn a_send_from_inside_a_task_is_attributed_to_that_task_s_chain() {
        let _lock = crate::midi_out::test_guard();
        let pool = RenderPool::new(1, CHAINS);
        let mk = |chain: usize| Task {
            pre: Pre::Render(sends_midi),
            taps: NO_TAPS,
            process_fx: None,
            inst: (0x40 + chain) as *mut c_void,
            buf: core::ptr::null_mut(),
            frames: 0,
            chain,
        };
        pool.render_block(&[vec![mk(2)], vec![mk(5)]]);

        let mut got = Vec::new();
        crate::midi_out::QUEUE.drain(|m, _| got.push(m[2]));
        // Slot order, though chain 5 ran on the helper and 2 on this thread.
        assert_eq!(got, vec![0x42, 0x45]);
    }

    /* `chidle` puts a silent set to sleep, which empties every helper lane while
     * leaving parallel render on — now the default. The rendezvous costs the
     * same whether the helpers have twelve tasks or none, so a sleeping set must
     * not pay it. Asserted on `generation`, the counter that publishes work to
     * the helpers: it is the wake itself, not a proxy for it. */
    #[test]
    fn empty_helper_lanes_do_not_wake_the_helpers() {
        let _lock = crate::midi_out::test_guard();
        let pool = RenderPool::new(2, CHAINS);
        let before = pool.shared.generation.load(Ordering::Acquire);

        let mut buf = vec![0i16; BLOCK * 2];
        pool.render_block(&[
            vec![Task {
                pre: Pre::Render(fill),
                taps: NO_TAPS,
                process_fx: None,
                inst: 7 as *mut c_void,
                buf: buf.as_mut_ptr(),
                frames: BLOCK as i32,
                chain: 0,
            }],
            vec![],
            vec![],
        ]);

        assert_eq!(
            pool.shared.generation.load(Ordering::Acquire),
            before,
            "helpers were woken for two empty lanes"
        );
        // And the work that WAS there still ran — skipping the fan-out must not
        // become skipping the render.
        assert_eq!(buf[0], 7, "lane 0 did not render");
        assert_eq!(buf[BLOCK * 2 - 1], 7 + (BLOCK * 2 - 1) as i16);
    }

    /* And nothing may stay attributed once the call returns: the audio thread
     * goes straight on to the mix and then to movy's own engine sends. */
    #[test]
    fn the_attribution_does_not_outlive_the_task() {
        let _lock = crate::midi_out::test_guard();
        let pool = RenderPool::new(0, CHAINS);
        pool.render_block(&[vec![Task {
            pre: Pre::Render(sends_midi),
            taps: NO_TAPS,
            process_fx: None,
            inst: 0x41 as *mut c_void,
            buf: core::ptr::null_mut(),
            frames: 0,
            chain: 1,
        }]]);
        crate::midi_out::QUEUE.drain(|_, _| {});
        assert!(crate::midi_out::QUEUE.park(&[0x09, 0x90, 60, 100], false).is_none());
    }

    /// Buffers are per-test, not a shared `static mut`: cargo runs tests
    /// concurrently, and a shared buffer makes three honest tests fail on each
    /// other rather than on the pool.
    fn bufs() -> Vec<[i16; BLOCK]> {
        vec![[0; BLOCK]; CHAINS]
    }

    fn tasks(bufs: &mut [[i16; BLOCK]], range: std::ops::Range<usize>) -> Vec<Task> {
        range
            .map(|c| Task {
                pre: Pre::Render(fill),
                taps: NO_TAPS,
                process_fx: None,
                inst: (c + 1) as *mut c_void,
                buf: bufs[c].as_mut_ptr(),
                frames: (BLOCK / 2) as i32,
                chain: c,
            })
            .collect()
    }

    /// A sleeping synth still owes its FX a block of SILENCE. Handing the FX
    /// whatever the previous block left in the buffer is a stuck buzz, not a
    /// decaying tail — and it is the failure mode the whole split invites.
    #[test]
    fn a_task_with_no_render_hands_the_fx_a_zeroed_buffer() {
        unsafe extern "C" fn assert_zero_then_mark(_i: *mut c_void, buf: *mut i16, frames: i32) {
            let n = (frames as usize) * 2;
            for k in 0..n {
                assert_eq!(unsafe { *buf.add(k) }, 0, "FX must see silence, not the last block");
            }
            unsafe { *buf = 99 };
        }
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        b[0] = [7, 7, 7, 7];
        let lanes = vec![vec![Task {
            pre: Pre::Silence,
            taps: NO_TAPS,
            process_fx: Some(assert_zero_then_mark),
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]];
        pool.render_block(&lanes);
        assert_eq!(b[0][0], 99, "the FX ran");
    }

    /* A send bus hands the pool a buffer that ALREADY holds its input: the sum
     * of every track feeding it, accumulated before the chain join. `Silence`
     * is the right pre-stage for a sleeping synth and would delete that sum
     * entirely — the bus would process 128 frames of nothing, every block, and
     * the only symptom is a send that never sounds. */
    #[test]
    fn a_keep_task_gives_its_fx_the_buffer_it_was_handed() {
        unsafe extern "C" fn double_it(_i: *mut c_void, buf: *mut i16, frames: i32) {
            for k in 0..(frames as usize) * 2 {
                unsafe { *buf.add(k) *= 2 };
            }
        }
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        b[0] = [11, 22, 33, 44];
        b[1] = [11, 22, 33, 44];
        let mk = |buf: *mut i16, chain: usize| Task {
            pre: Pre::Keep,
            taps: NO_TAPS,
            process_fx: Some(double_it),
            inst: 1 as *mut c_void,
            buf,
            frames: (BLOCK / 2) as i32,
            chain,
        };
        // Both lanes: a bus is as likely to be planned onto a helper as onto
        // the audio thread, and `run` is the only place either one goes through.
        let lanes = vec![vec![mk(b[0].as_mut_ptr(), 0)], vec![mk(b[1].as_mut_ptr(), 1)]];
        pool.render_block(&lanes);
        assert_eq!(b[0], [22, 44, 66, 88], "lane 0 zeroed a bus that was already fed");
        assert_eq!(b[1], [22, 44, 66, 88], "the helper zeroed a bus that was already fed");
    }

    /// A `Keep` task has no synth stage, so it must not be charged for one — but
    /// it DOES publish a peak, and the peak is of its INPUT.
    ///
    /// That is the only moment the input exists: a co-located bus's FX
    /// overwrites the buffer before the join, and the audio thread never sees
    /// what the lanes summed in. `SendBuses::note_colocated` folds it back as
    /// `in_peak`, which is what tells a silent bus apart from one nothing fed.
    ///
    /// Writing into the same array the idle gate reads is safe because a bus
    /// lives PAST the chains in the shared index space (`send_index`), and
    /// `ChainSlots` only ever copies the chain range out of it.
    #[test]
    fn a_keep_task_publishes_the_peak_of_what_it_was_handed() {
        unsafe extern "C" fn loud(_i: *mut c_void, buf: *mut i16, _f: i32) {
            unsafe { *buf = 30000 };
        }
        let pool = RenderPool::new(0, CHAINS);
        let mut b = bufs();
        b[0] = [9000, 9000, 9000, 9000];
        pool.render_block(&[vec![Task {
            pre: Pre::Keep,
            taps: NO_TAPS,
            process_fx: Some(loud),
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]]);
        assert_eq!(pool.synth_ns(0), 0, "a bus has no synth to charge");
        assert_eq!(
            pool.synth_peak(0),
            9000,
            "the peak must be of the INPUT, taken before the FX overwrote it"
        );
        assert!(pool.cost_ns(0) > 0, "but its FX pass is still timed");
    }

    /// A tap sums this task's OUTPUT into a bus, on the lane that produced it.
    /// This is the whole mechanism co-location rests on: run after `process_fx`,
    /// at the track's send gains, into a buffer only this lane holds.
    #[test]
    fn a_tap_sums_the_rendered_block_into_its_bus() {
        unsafe extern "C" fn synth(_i: *mut c_void, buf: *mut i16, f: i32) {
            for k in 0..(f as usize * 2) {
                unsafe { *buf.add(k) = 1000 };
            }
        }
        let pool = RenderPool::new(0, CHAINS);
        let mut b = bufs();
        let mut bus = [7i16; BLOCK];
        pool.render_block(&[vec![Task {
            pre: Pre::Render(synth),
            taps: [Some(Tap { buf: bus.as_mut_ptr(), gl: 0.5, gr: 0.5 }), None, None, None],
            process_fx: None,
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]]);
        assert_eq!(b[0][0], 1000, "the chain's own output is untouched by the tap");
        assert_eq!(bus[0], 507, "the bus is SUMMED into at the send gain, not replaced");
    }

    /// The tap runs AFTER the FX, so a send carries what the track sounds like
    /// rather than what its synth produced before its own effects. Tapping
    /// first is silent — the send just sounds dry — which is why it is pinned.
    #[test]
    fn a_tap_is_taken_after_the_fx() {
        unsafe extern "C" fn synth(_i: *mut c_void, buf: *mut i16, f: i32) {
            for k in 0..(f as usize * 2) {
                unsafe { *buf.add(k) = 100 };
            }
        }
        unsafe extern "C" fn boost(_i: *mut c_void, buf: *mut i16, f: i32) {
            for k in 0..(f as usize * 2) {
                unsafe { *buf.add(k) = *buf.add(k) * 10 };
            }
        }
        let pool = RenderPool::new(0, CHAINS);
        let mut b = bufs();
        let mut bus = [0i16; BLOCK];
        pool.render_block(&[vec![Task {
            pre: Pre::Render(synth),
            taps: [Some(Tap { buf: bus.as_mut_ptr(), gl: 1.0, gr: 1.0 }), None, None, None],
            process_fx: Some(boost),
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]]);
        assert_eq!(bus[0], 1000, "the tap took the pre-FX block");
    }

    /// `MAX_TAPS` is this module's own constant so it stays free of the mixer's
    /// types, which makes it a number that can drift. A bus that could not be
    /// tapped would simply never sound.
    #[test]
    fn taps_cover_every_bus() {
        assert!(MAX_TAPS >= crate::send_bus::SEND_BUSES);
    }

    /// The synth gate reads the buffer BEFORE the FX touches it, so an FX that
    /// never settles below the silence level cannot hold a silent synth awake.
    #[test]
    fn the_synth_peak_is_measured_before_the_fx_runs() {
        unsafe extern "C" fn quiet_synth(_i: *mut c_void, buf: *mut i16, _f: i32) {
            unsafe { *buf = 3 };
        }
        unsafe extern "C" fn loud_fx(_i: *mut c_void, buf: *mut i16, _f: i32) {
            unsafe { *buf = 30000 };
        }
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        let lanes = vec![vec![Task {
            pre: Pre::Render(quiet_synth),
            taps: NO_TAPS,
            process_fx: Some(loud_fx),
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]];
        pool.render_block(&lanes);
        assert_eq!(pool.synth_peak(0), 3, "a loud FX may not hide a silent synth");
    }

    fn expect(bufs: &[[i16; BLOCK]]) {
        for (c, got) in bufs.iter().enumerate() {
            let tag = (c + 1) as i16;
            assert_eq!(*got, [tag, tag + 1, tag + 2, tag + 3], "chain {c} buffer");
        }
    }

    #[test]
    fn every_task_runs_exactly_once_into_its_own_buffer() {
        let pool = RenderPool::new(2, CHAINS);
        let mut b = bufs();
        let lanes = vec![tasks(&mut b, 0..2), tasks(&mut b, 2..4), tasks(&mut b, 4..6)];
        pool.render_block(&lanes);
        expect(&b);
    }

    /// The join is the correctness claim: `render_block` must not return while a
    /// helper is still writing. Running many rounds back to back is what would
    /// expose a missing acquire, since round N+1 overwrites round N's buffers.
    #[test]
    fn rounds_do_not_overlap() {
        let pool = RenderPool::new(3, CHAINS);
        let mut b = bufs();
        let lanes = vec![
            tasks(&mut b, 0..2),
            tasks(&mut b, 2..3),
            tasks(&mut b, 3..4),
            tasks(&mut b, 4..6),
        ];
        for _ in 0..2000 {
            for buf in b.iter_mut() {
                *buf = [0; BLOCK];
            }
            pool.render_block(&lanes);
            expect(&b);
        }
        assert!(!pool.is_poisoned());
    }

    #[test]
    fn costs_are_reported_per_chain() {
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        pool.render_block(&[tasks(&mut b, 0..3), tasks(&mut b, 3..6)]);
        // A nonzero reading for every chain proves the helper's costs come back,
        // not just the audio thread's own lane.
        for c in 0..CHAINS {
            assert!(pool.cost_ns(c) > 0, "chain {c} reported no cost");
        }
    }

    /// Zero helpers is what the flag turns off into, and an empty lane set is
    /// what an idle movy passes. Neither may hang or panic.
    #[test]
    fn degenerate_lane_sets_are_not_special_cases() {
        let pool = RenderPool::new(0, CHAINS);
        let mut b = bufs();
        pool.render_block(&[tasks(&mut b, 0..1)]);
        assert!(pool.cost_ns(0) > 0);
        pool.render_block(&[]);
        RenderPool::new(2, CHAINS).render_block(&[Vec::new(), Vec::new(), Vec::new()]);
    }

    /// More lanes than the pool has helpers must not drop the surplus silently —
    /// a plan built for three lanes handed to a two-helper pool would lose a
    /// third of the set's audio, and the only symptom would be silent chains.
    #[test]
    fn a_lane_the_pool_cannot_staff_is_not_dropped() {
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        let lanes = vec![tasks(&mut b, 0..2), tasks(&mut b, 2..4), tasks(&mut b, 4..6)];
        pool.render_block(&lanes);
        expect(&b);
    }

    /// The meter draws the two stages a split chain renders in. The pool has to
    /// publish the first one, because the audio thread cannot bracket a call it
    /// did not make — the same reason `cost_ns` exists.
    ///
    /// A sleeping synth (`render: None`) costs nothing: the zero-fill is movy's
    /// own bookkeeping, not the module's.
    #[test]
    fn the_pool_publishes_the_synth_stage_on_its_own() {
        let _lock = crate::midi_out::test_guard();
        let pool = RenderPool::new(1, CHAINS);
        let mut buf = vec![0i16; BLOCK * 2];

        pool.render_block(&[
            vec![Task {
                pre: Pre::Render(fill),
                taps: NO_TAPS,
                process_fx: None,
                inst: 7 as *mut c_void,
                buf: buf.as_mut_ptr(),
                frames: BLOCK as i32,
                chain: 0,
            }],
            vec![],
        ]);
        assert!(pool.synth_ns(0) > 0, "a chain that rendered has a synth cost");
        assert!(
            pool.synth_ns(0) <= pool.cost_ns(0),
            "the synth stage is a part of the block, not more than it"
        );

        pool.render_block(&[
            vec![Task {
                pre: Pre::Silence,
                taps: NO_TAPS,
                process_fx: None,
                inst: 7 as *mut c_void,
                buf: buf.as_mut_ptr(),
                frames: BLOCK as i32,
                chain: 1,
            }],
            vec![],
        ]);
        assert_eq!(pool.synth_ns(1), 0, "a sleeping synth costs nothing");
    }
}
