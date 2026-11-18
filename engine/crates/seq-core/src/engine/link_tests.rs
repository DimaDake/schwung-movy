//! Engine-level Link follow: tempo, phase, Start/Stop Sync, precedence.

use super::Engine;
use crate::link_follow::{wrap_phase, LinkSnapshot, PLAY_TIMEOUT_US};

const RATE: u32 = 44100;
const FRAMES: u32 = 128;
const BLOCK_US: f64 = FRAMES as f64 * 1e6 / RATE as f64;

fn session(tempo: f64, playing: bool) -> LinkSnapshot {
    LinkSnapshot { enabled: true, peers: 1, tempo, beat_anchor: 0.0, time_anchor_us: 1_000_000,
                   is_playing: playing, play_change_us: 0, ..Default::default() }
}

struct Sim { e: Engine, out: Vec<crate::engine::OutEvent>, k: u64, t0: u64 }

impl Sim {
    fn new(bpm_x100: u32) -> Self {
        Sim { e: Engine::new(RATE, bpm_x100), out: Vec::new(), k: 0, t0: 1_000_000 }
    }
    fn now(&self) -> u64 { self.t0 + (self.k as f64 * BLOCK_US) as u64 }
    fn block(&mut self, s: &LinkSnapshot) {
        let t = self.now();
        self.e.link_block(s, t, FRAMES, &mut self.out);
        self.e.advance_block(FRAMES, &mut self.out);
        self.k += 1;
        self.out.clear();
    }
    fn run(&mut self, s: &LinkSnapshot, n: u64) { for _ in 0..n { self.block(s); } }
    fn err(&self, s: &LinkSnapshot) -> f64 {
        wrap_phase(s.beat_at(self.now()) - self.e.beat_position().unwrap_or(0.0))
    }
}

#[test]
fn join_adopts_session_tempo() {
    let mut m = Sim::new(9000);
    m.run(&session(133.0, false), 2);
    assert_eq!(m.e.clock.bpm_x100(), 13300);
}

#[test]
fn own_tempo_request_not_overwritten_until_ack() {
    let mut m = Sim::new(12000);
    let mut s = session(120.0, false);
    m.run(&s, 1);
    m.e.tempo_requested(14000);
    assert_eq!(m.e.link.requests().tempo_bpm_x100, 14000);
    m.run(&s, 3);
    assert_eq!(m.e.clock.bpm_x100(), 14000, "the stale session tempo must not win");
    s.tempo = 140.0;
    s.tempo_ack_seq = m.e.link.requests().tempo_seq;
    m.run(&s, 1);
    assert_eq!(m.e.clock.bpm_x100(), 14000);
}

#[test]
fn remote_start_aligns_bar0_to_quantum() {
    let mut m = Sim::new(12000);
    let mut s = session(120.0, false);
    m.run(&s, 10);
    // The session starts at 1.3 beats: movy waits for beat 4.
    s.is_playing = true;
    s.play_change_us = 1_000_000 + 650_000;
    while !m.e.playing && m.k < 5000 { m.block(&s); }
    assert!(m.e.playing, "started");
    let started_at = s.beat_at(m.now() - BLOCK_US as u64);
    assert!((started_at - 4.0).abs() < 0.01, "bar 0 on session beat 4, got {started_at}");
}

#[test]
fn small_error_trims_and_converges() {
    let mut m = Sim::new(12000);
    let mut s = session(120.0, true);
    s.play_change_us = 2_000_000; // after join
    m.run(&session(120.0, false), 1);
    while !m.e.playing { m.block(&s); }
    // Knock movy 0.03 beat off the grid, then let it pull back in.
    s.beat_anchor += 0.03;
    m.run(&s, 6000);
    assert!(m.err(&s).abs() < 0.002, "error {}", m.err(&s));
    assert_eq!(m.e.clock.bpm_x100(), 12000, "trim never reaches the stored tempo");
    assert!(m.e.clock.trim_ppm().abs() < 5000);
}

#[test]
fn large_error_reanchors_on_next_bar() {
    let mut m = Sim::new(12000);
    let mut s = session(120.0, true);
    s.play_change_us = 2_000_000;
    m.run(&session(120.0, false), 1);
    while !m.e.playing { m.block(&s); }
    m.run(&s, 100);
    s.beat_anchor += 1.0; // a whole beat off: no trim can fix that musically
    m.run(&s, 2000);
    assert!(m.err(&s).abs() < 0.01, "re-anchored, error {}", m.err(&s));
}

#[test]
fn edge_before_join_ignored() {
    // Joining a stopped session never stops movy.
    let mut m = Sim::new(12000);
    m.e.play();
    m.run(&LinkSnapshot { enabled: true, peers: 0, ..session(120.0, false) }, 5);
    assert!(m.e.playing);
    m.run(&session(120.0, false), 50);
    assert!(m.e.playing, "a session that was already stopped is history");
}

#[test]
fn remote_stop_stops() {
    let mut m = Sim::new(12000);
    let mut s = session(120.0, false);
    m.run(&s, 1);
    s.is_playing = true;
    s.play_change_us = m.now();
    while !m.e.playing && m.k < 5000 { m.block(&s); }
    s.is_playing = false;
    s.play_change_us = m.now();
    m.run(&s, 1);
    assert!(!m.e.playing);
}

#[test]
fn local_play_waits_for_edge() {
    let mut m = Sim::new(12000);
    let s = session(120.0, false);
    m.run(&s, 1);
    m.e.play_requested();
    let r = *m.e.link.requests();
    assert!(r.playing && r.play_seq == 1);
    m.run(&s, 10);
    assert!(!m.e.playing, "waits for the session to start");
}

#[test]
fn play_request_times_out_to_local_start() {
    let mut m = Sim::new(12000);
    let s = session(120.0, false);
    m.run(&s, 1);
    m.e.play_requested();
    let blocks = (PLAY_TIMEOUT_US as f64 / BLOCK_US) as u64 + 2;
    m.run(&s, blocks);
    assert!(m.e.playing, "movy-link never answered: start anyway");
}

#[test]
fn local_stop_is_immediate_and_requested() {
    let mut m = Sim::new(12000);
    m.run(&session(120.0, false), 1);
    m.e.play();
    m.e.stop_requested(&mut m.out);
    assert!(!m.e.playing);
    let r = *m.e.link.requests();
    assert!(!r.playing && r.play_seq == 1);
}

#[test]
fn alone_play_is_immediate() {
    let mut m = Sim::new(12000);
    m.run(&LinkSnapshot { peers: 0, ..session(120.0, false) }, 1);
    m.e.play_requested();
    assert!(m.e.playing, "no peers: nothing to wait for");
    assert_eq!(m.e.link.requests().play_seq, 1, "but the session still hears it");
}

#[test]
fn midi_clock_ignored_while_link_active() {
    let mut m = Sim::new(12000);
    m.run(&session(120.0, false), 1);
    for _ in 0..30 {
        m.e.on_external_realtime(0xF8, &mut m.out);
        m.e.advance_block(FRAMES, &mut m.out);
    }
    m.e.on_external_realtime(0xFA, &mut m.out);
    assert_eq!(m.e.clock.bpm_x100(), 12000, "MIDI clock tempo ignored");
    assert!(!m.e.playing, "MIDI Start ignored");
}

#[test]
fn disable_while_following_keeps_playing() {
    let mut m = Sim::new(12000);
    let mut s = session(126.0, true);
    s.play_change_us = 2_000_000;
    m.run(&session(126.0, false), 1);
    while !m.e.playing { m.block(&s); }
    s.beat_anchor += 0.05;
    m.run(&s, 10);
    s.enabled = false;
    m.run(&s, 10);
    assert!(m.e.playing);
    assert_eq!(m.e.clock.bpm_x100(), 12600);
    assert_eq!(m.e.clock.trim_ppm(), 0);
}

#[test]
fn play_while_session_runs_joins_next_bar() {
    // Joined a session that was already playing (its start is history).
    let mut m = Sim::new(12000);
    let s = session(120.0, true);
    m.run(&s, 300); // ~0.87 s: session beat ~1.7
    assert!(!m.e.playing);
    m.e.play_requested();
    while !m.e.playing && m.k < 5000 { m.block(&s); }
    let started_at = s.beat_at(m.now() - BLOCK_US as u64);
    assert!((started_at - 4.0).abs() < 0.01, "joined on beat 4, got {started_at}");
}

#[test]
fn halt_stops_movy_but_not_the_session() {
    let mut m = Sim::new(12000);
    m.run(&session(120.0, false), 1);
    m.e.play();
    crate::command::apply_batch(&mut m.e, "halt", &mut m.out);
    assert!(!m.e.playing);
    assert_eq!(m.e.link.requests().play_seq, 0, "Close Movy is not a Stop for the session");
}
