//! seq-core: pure sequencer logic for movy. No FFI, no I/O — everything here
//! runs identically on the host (cargo test) and on the device.

pub mod clip;
pub mod clock;
pub mod command;
pub mod engine;
pub mod track;

/// Master clock resolution, pulses per quarter note (davebox-proven).
pub const PPQN: u32 = 96;
/// Fixed 1/16 step grid: ticks per step at 96 PPQN.
pub const TICKS_PER_STEP: u32 = PPQN / 4;
/// Steps per bar (4/4, 1/16 grid).
pub const STEPS_PER_BAR: u32 = 16;
/// Ticks per bar.
pub const TICKS_PER_BAR: u32 = TICKS_PER_STEP * STEPS_PER_BAR;
