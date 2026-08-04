//! Wire protocol: the UI batches ops into one `set_param("cmd", "op;op;…")`
//! per UI tick (the param channel coalesces — only the last write per audio
//! buffer survives — so ops must travel together). Each op is a short verb
//! plus space-separated integer args. Unknown ops are ignored so old engines
//! tolerate newer UIs.

use crate::engine::{Engine, OutEvent};
use crate::track::NUM_TRACKS;

/// Apply one batched command string. MIDI side effects (e.g. note-offs from
/// a stop) are pushed into `out`.
pub fn apply_batch(engine: &mut Engine, batch: &str, out: &mut Vec<OutEvent>) {
    for op in batch.split(';') {
        let op = op.trim();
        if !op.is_empty() {
            let verb = op.split(' ').next().unwrap_or("");
            apply_op(engine, op, out);
            /* A UI command may have changed saved state — except the undo ring
             * ops, which only read it. Marking dirty for `usnap` would make
             * every knob touch schedule an autosave that then finds nothing to
             * write. `uswap` sets the flag itself, via undo_restore. */
            if !is_undo_ring_verb(verb) {
                engine.dirty = true;
            }
        }
    }
}

/// Concert pitch (as played on a pad / entered on a step) → stored pitch,
/// undoing the active clip's transpose so playback — which re-adds it at emit —
/// reproduces exactly what was played. Keeps step entry consistent with live
/// recording (live_note_off does the same).
fn untranspose(engine: &Engine, track: usize, pitch: u8) -> u8 {
    if track >= NUM_TRACKS {
        return pitch;
    }
    (pitch as i32 - engine.active_clip_transpose(track)).clamp(0, 127) as u8
}

/// Verbs after which buffered capture input is stale.
///
/// Capture keeps what you played while you were *just playing*. The moment you
/// start building the clip deliberately — arming, entering or editing steps,
/// launching clips, changing the loop — that free playing belongs to the take
/// you have moved on from, and letting it survive means the next Capture drops
/// old notes into a clip you have since edited by hand.
///
/// Listed here rather than sprinkled through the arms below so the rule can be
/// read (and tested) in one place; the next edit verb someone adds shows up as
/// an omission here instead of a silent bug. `non`/`nof` are the input itself
/// and `watch` clears on its own (it also retargets), so neither appears.
/// Nor does anything the UI sends as bookkeeping rather than as a gesture —
/// `hold` (a step-length query, also sent by input-reset and by the step-record
/// head) and the automation base syncs. The rule is user intent, not traffic.
fn clears_capture(verb: &str) -> bool {
    matches!(
        verb,
        // arming / recording
        "rec"
        // step entry and note editing
        | "tog" | "addp" | "del" | "evel" | "elen" | "enudge" | "etrn" | "slen"
        | "eprob" | "econd" | "einv" | "quant"
        // clip shape and clip-level edits
        | "clen" | "cscl" | "ctr" | "dbl" | "loop" | "ltog"
        | "cpy" | "cpyclr" | "pst"
        // whole-clip and session gestures
        | "clipcopy" | "clipdel" | "clipdelat" | "clipdup" | "clippaste"
        | "clipsel" | "launch" | "stoptrk"
        // automation edits — but NOT `abase`/`abaseq`, which are internal base
        // syncs the UI emits on lane allocation and on any knob read. Those
        // arrive while you are simply playing, and clearing on them wiped the
        // buffer mid-phrase every time a lane warm strided past.
        | "aset" | "asetr" | "aclr" | "aclrs" | "aclrstep"
    )
}

/// The undo ring's own ops. They read state, never change it, so they must not
/// set the engine's dirty flag (`uswap` sets it itself, via `undo_restore`).
fn is_undo_ring_verb(verb: &str) -> bool {
    matches!(verb, "usnap" | "uswap" | "ucommit" | "udrop" | "uclr")
}

/// Verbs that are a **user edit** — the unit undo restores.
///
/// Sibling of `clears_capture` above, and kept to the same discipline: listed
/// here in one readable place so the next edit verb someone adds shows up as an
/// omission (`every_match_verb_is_classified` fails) instead of as a silent
/// hole in undo. The rule is again user intent, not traffic.
///
/// Differs from `clears_capture` in both directions, deliberately:
///   * `clipsel` / `launch` / `stoptrk` clear the capture buffer but are
///     selection and transport — excluded from undo by design §1.
///   * `mute` / `bpm` / `swing` are set-level settings nobody would call a
///     take-invalidating gesture, but they are edits and must be undoable.
/// `abase`/`abaseq` stay out of both: they are internal base syncs the UI emits
/// on lane allocation and on any knob read, not gestures.
pub fn is_undoable_edit(verb: &str) -> bool {
    matches!(
        verb,
        // step entry and note editing
        "tog" | "addp" | "del" | "evel" | "elen" | "enudge" | "etrn" | "slen"
        | "eprob" | "econd" | "einv" | "quant"
        // clip shape and clip-level edits
        | "clen" | "cscl" | "ctr" | "dbl" | "loop" | "ltog" | "pst"
        // whole-clip gestures
        | "clipdel" | "clipdelat" | "clipdup" | "clippaste"
        // automation edits
        | "aset" | "asetr" | "aclr" | "aclrs" | "aclrstep"
        // set-level settings
        | "mute" | "bpm" | "swing"
        // retroactive capture: `cap` writes the buffered phrase into the clip
        // and `capsel` rewrites it at another tempo. `capclr`/`capdone` only
        // touch the input buffer and the overlay, so they stay control.
        | "cap" | "capsel"
    )
}

/// Verbs that are explicitly **not** edits: transport, view/selection,
/// bookkeeping, live input, and the undo machinery itself. Exists so
/// `every_match_verb_is_classified` can prove the two lists are exhaustive —
/// a new verb belongs to one of them by conscious choice, never by omission.
pub fn is_control_verb(verb: &str) -> bool {
    matches!(
        verb,
        // transport and recording mode
        "play" | "stop" | "rec" | "metro" | "link" | "launch" | "stoptrk"
        // view / selection
        | "watch" | "wlane" | "clipsel" | "hold" | "tdrum"
        // clipboard fills — they change no musical state; only the paste does
        | "cpy" | "cpyclr" | "clipcopy"
        // live input
        | "non" | "nof"
        // automation bookkeeping (not gestures — see is_undoable_edit)
        | "abase" | "abaseq" | "alabel"
        // retroactive capture bookkeeping (the edits are in is_undoable_edit)
        | "capclr" | "capdone"
        // undo machinery
        | "usnap" | "uswap" | "ucommit" | "udrop" | "uclr"
        // batch container (never reaches apply_op as a verb)
        | "cmd"
    )
}

fn apply_op(engine: &mut Engine, op: &str, out: &mut Vec<OutEvent>) {
    let mut it = op.split_whitespace();
    let verb = it.next().unwrap_or("");
    let mut next = || it.next().and_then(|s| s.parse::<i64>().ok());

    if clears_capture(verb) {
        engine.capture_clear();
    }

    match verb {
        // Transport buttons route through the always-on Move link (design §7
        // Phase 4); other play()/stop() callers (session auto-start, record)
        // stay un-propagated.
        "play" => engine.request_play(out),
        "stop" => engine.request_stop(out),
        // link <0|1> — enable/disable the bidirectional Move transport link
        // (Set-page LINK toggle; persisted per set).
        "link" => {
            if let Some(v) = next() {
                engine.link_enabled = v != 0;
            }
        }
        "bpm" => {
            if let Some(v) = next() {
                engine.clock.set_bpm_x100(v.clamp(0, u32::MAX as i64) as u32);
            }
        }
        "swing" => {
            if let Some(v) = next() {
                engine.swing_pct = v.clamp(50, 80) as u32;
            }
        }
        "watch" => {
            if let Some(t) = next() {
                if (t as usize) < NUM_TRACKS {
                    engine.watch_track = t as usize;
                    // Move clears buffered capture input on a track button, so
                    // what you played on the old track can't land on the new one.
                    engine.capture_clear();
                }
            }
        }
        // wlane <pitch|-1> — set the watched step-LED lane (-1 = melodic).
        "wlane" => {
            if let Some(p) = next() {
                engine.watch_lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
            }
        }
        // tdrum <track> <0|1> — the track's slot holds a drum module, so clip
        // transpose stops applying to it (pitches are pad addresses). The UI
        // owns module identity, so it re-sends this on load and after a swap.
        "tdrum" => {
            if let (Some(t), Some(d)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    engine.set_track_drum(t as usize, d != 0);
                }
            }
        }
        "mute" => {
            if let (Some(t), Some(m)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    let muting = m != 0;
                    engine.tracks[t as usize].muted = muting;
                    // Mute is immediate: gate countdown runs even for muted
                    // tracks (step_tick decrements before the !muted guard), so
                    // without this the note keeps ringing until it expires.
                    if muting {
                        engine.flush_track_gates(t as usize, out);
                    }
                }
            }
        }
        // tog <track> <step> <p1> <v1> [<p2> <v2> ...] — melodic step toggle
        // (clear the step if it has notes, else place the chord).
        "tog" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                let mut chord: Vec<(u8, u8)> = Vec::new();
                while let (Some(p), Some(v)) = (next(), next()) {
                    if (0..128).contains(&p) {
                        chord.push((untranspose(engine, t as usize, p as u8), v.clamp(1, 127) as u8));
                    }
                }
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize]
                        .active_mut()
                        .toggle_step(s.clamp(0, 255) as u16, &chord);
                    engine.ensure_selected_playing(t as usize);
                }
            }
        }
        // Note-edit gestures over an inclusive step range [s0,s1] (single
        // step: s0==s1; whole bar: 16-step range). p = lane pitch or -1 (all).
        // evel/elen/enudge <t> <s0> <s1> <p> <delta>; etrn <t> <s0> <s1> <p> <semitones>
        "evel" | "elen" | "enudge" | "etrn" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(d)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    let (a, b) = (s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
                    let clip = engine.tracks[t as usize].active_mut();
                    let dv = d as i32;
                    match verb {
                        "evel" => clip.adjust_velocity(a, b, lane, dv),
                        "elen" => clip.adjust_length(a, b, lane, dv),
                        "enudge" => clip.nudge(a, b, lane, dv),
                        _ => clip.transpose(a, b, lane, dv),
                    }
                }
            }
        }
        // hold <track> <step> — set the step-length query (step < 0 clears).
        "hold" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.set_held_query(if s < 0 { None } else { Some((t as usize, s.clamp(0, 255) as u16)) });
            }
        }
        // slen <t> <s0> <s1> <p> <ticks> — set absolute note length.
        "slen" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(tk)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    let (a, b) = (s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
                    engine.tracks[t as usize].active_mut().set_length(a, b, lane, tk.max(1) as u32);
                }
            }
        }
        // clen <track> <steps> — set active clip length in steps (LENGTH knob).
        "clen" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize]
                        .active_mut()
                        .set_clip_length(s.clamp(0, 65535) as u16);
                }
            }
        }
        // cscl <track> <num> <den> — set active clip playback scale (rational).
        "cscl" => {
            if let (Some(t), Some(n), Some(d)) = (next(), next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    let c = engine.tracks[t as usize].active_mut();
                    c.scale_num = n.clamp(1, 255) as u8;
                    c.scale_den = d.clamp(1, 255) as u8;
                }
            }
        }
        // ctr <track> <semitones> — set active clip transpose (non-destructive).
        "ctr" => {
            if let (Some(t), Some(v)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].active_mut().transpose = v.clamp(-36, 36) as i8;
                }
            }
        }
        // eprob <t> <s0> <s1> <p> <pct>; econd <t> <s0> <s1> <p> <a> <b>;
        // einv <t> <s0> <s1> <p> <0|1>. p = lane pitch or -1 (whole step).
        "eprob" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(pct)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    engine.tracks[t as usize].active_mut().set_trig_prob(
                        s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16, lane, pct.clamp(0, 100) as u8);
                }
            }
        }
        "econd" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(a), Some(b)) =
                (next(), next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    engine.tracks[t as usize].active_mut().set_trig_cond(
                        s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16, lane,
                        a.clamp(1, 64) as u8, b.clamp(1, 64) as u8);
                }
            }
        }
        "einv" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(v)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    engine.tracks[t as usize].active_mut().set_trig_invert(
                        s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16, lane, v != 0);
                }
            }
        }
        // rec <t> — toggle recording on track (one-bar count-in).
        "rec" => {
            if let Some(t) = next() {
                engine.toggle_record(t as usize);
            }
        }
        // cap <t> — commit buffered live input into t's active clip.
        "cap" => {
            if let Some(t) = next() {
                if (t as usize) < NUM_TRACKS {
                    engine.capture_commit(t as usize);
                }
            }
        }
        // capclr — drop buffered input (Shift+Capture). Takes the track for
        // symmetry with `cap`; the ring spans every track, so it clears all.
        "capclr" => {
            engine.capture_clear();
        }
        // capsel <i> — apply another tempo candidate from the post-capture
        // selector (jog turn).
        "capsel" => {
            if let Some(i) = next() {
                engine.capture_select(i.max(0) as usize);
            }
        }
        // capdone — dismiss the post-capture overlay, releasing the take.
        "capdone" => engine.capture_done(),
        // metro <0|1> — metronome on/off.
        "metro" => {
            if let Some(v) = next() {
                engine.set_metronome(v != 0);
            }
        }
        // quant <t> — quantize the active clip to the grid.
        "quant" => {
            if let Some(t) = next() {
                engine.quantize_active(t as usize);
            }
        }
        // non/nof <t> <pitch> [vel] — live pad note for recording capture.
        // The UI sounds the note directly; these only record.
        "non" => {
            if let (Some(t), Some(p), Some(v)) = (next(), next(), next()) {
                if (0..128).contains(&p) {
                    engine.live_note_on(t as usize, p as u8, v.clamp(1, 127) as u8);
                }
            }
        }
        "nof" => {
            if let (Some(t), Some(p)) = (next(), next()) {
                if (0..128).contains(&p) {
                    engine.live_note_off(t as usize, p as u8);
                }
            }
        }
        // del <t> <s0> <s1> <pitch|-1> — delete notes in range (step delete,
        // bar delete, or drum-pad delete with a pitch + full 0..255 range).
        "del" => {
            if let (Some(t), Some(s0), Some(s1), Some(p)) = (next(), next(), next(), next()) {
                let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                engine.delete_range(t as usize, s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16, lane);
            }
        }
        "clipdup" => {
            if let Some(t) = next() {
                engine.duplicate_clip(t as usize);
            }
        }
        "clipdel" => {
            if let Some(t) = next() {
                engine.delete_clip(t as usize);
            }
        }
        "clipsel" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.select_clip(t as usize, s.max(0) as usize);
            }
        }
        // launch <t> <slot> — Session launch (or select-empty-stops).
        "launch" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.launch_clip(t as usize, s.max(0) as usize);
            }
        }
        // stoptrk <t> — stop a track's clip (quantized while running).
        "stoptrk" => {
            if let Some(t) = next() {
                engine.stop_track(t as usize);
            }
        }
        // Session clip copy/paste/delete by explicit slot.
        "clipcopy" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.copy_clip(t as usize, s.max(0) as usize);
            }
        }
        "clippaste" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.paste_clip(t as usize, s.max(0) as usize);
            }
        }
        "clipdelat" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.delete_clip_at(t as usize, s.max(0) as usize);
            }
        }
        // cpy <t> <s0> <s1> ; pst <t> <destStep> ; cpyclr
        "cpy" => {
            if let (Some(t), Some(s0), Some(s1)) = (next(), next(), next()) {
                engine.copy_steps(t as usize, s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
            }
        }
        "pst" => {
            if let (Some(t), Some(d)) = (next(), next()) {
                engine.paste_steps(t as usize, d.clamp(0, 255) as u16);
            }
        }
        "cpyclr" => engine.clear_clipboard(),
        // addp <t> <s0> <s1> <pitch> <vel> — add a pitch to every step in the
        // range that lacks it (Loop Mode: hold a bar + press a pad).
        "addp" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(v)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS && (0..128).contains(&p) {
                    let pitch = untranspose(engine, t as usize, p as u8);
                    engine.tracks[t as usize].active_mut().add_pitch_range(
                        s0.clamp(0, 255) as u16,
                        s1.clamp(0, 255) as u16,
                        pitch,
                        v.clamp(1, 127) as u8,
                    );
                }
            }
        }
        // loop <track> <startStep> <lenSteps> — set the loop window.
        "loop" => {
            if let (Some(t), Some(s), Some(l)) = (next(), next(), next()) {
                if (t as usize) < NUM_TRACKS && s >= 0 && l > 0 {
                    engine.tracks[t as usize]
                        .active_mut()
                        .set_loop(s as u16, l as u16);
                }
            }
        }
        // dbl <track> — double the loop (duplicate notes + double length).
        "dbl" => {
            if let Some(t) = next() {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].active_mut().double_loop();
                }
            }
        }
        // ltog <track> <step> <pitch> <vel> — drum-lane per-pitch toggle.
        "ltog" => {
            if let (Some(t), Some(s), Some(p), Some(v)) = (next(), next(), next(), next()) {
                if (t as usize) < NUM_TRACKS && (0..128).contains(&p) {
                    let pitch = untranspose(engine, t as usize, p as u8);
                    engine.tracks[t as usize].active_mut().toggle_step_pitch(
                        s.clamp(0, 255) as u16,
                        pitch,
                        v.clamp(1, 127) as u8,
                    );
                    engine.ensure_selected_playing(t as usize);
                }
            }
        }
        // Parameter automation. lane 0..8, val 0..=127.
        // alabel <t> <lane> <target:param> — assign a lane to a chain param.
        "alabel" => {
            let t = it.next().and_then(|s| s.parse::<i64>().ok());
            let lane = it.next().and_then(|s| s.parse::<i64>().ok());
            let label = it.next().unwrap_or("");
            if let (Some(t), Some(lane)) = (t, lane) {
                engine.auto_label(t as usize, lane as usize, label);
            }
        }
        "abase" => {
            if let (Some(t), Some(lane), Some(v)) = (next(), next(), next()) {
                engine.auto_base(t as usize, lane as usize, v.clamp(0, 127) as u8, out);
            }
        }
        "abaseq" => {
            if let (Some(t), Some(lane), Some(v)) = (next(), next(), next()) {
                engine.auto_base_quiet(t as usize, lane as usize, v.clamp(0, 127) as u8);
            }
        }
        "aset" => {
            if let (Some(t), Some(lane), Some(s), Some(v)) = (next(), next(), next(), next()) {
                engine.auto_set(
                    t as usize,
                    lane as usize,
                    s.clamp(0, 255) as u16,
                    v.clamp(0, 127) as u8,
                    out,
                );
            }
        }
        "aclr" => {
            if let (Some(t), Some(lane)) = (next(), next()) {
                engine.auto_clear(t as usize, lane as usize);
            }
        }
        "aclrs" => {
            if let (Some(t), Some(lane), Some(s)) = (next(), next(), next()) {
                engine.auto_clear_step(t as usize, lane as usize, s.clamp(0, 255) as u16);
            }
        }
        "aclrstep" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.auto_clear_step_all(t as usize, s.clamp(0, 255) as u16);
            }
        }
        // asetr <t> <lane> <s0> <s1> <val> — set a lane's lock over a step range.
        "asetr" => {
            if let (Some(t), Some(lane), Some(s0), Some(s1), Some(v)) =
                (next(), next(), next(), next(), next())
            {
                engine.auto_set_range(
                    t as usize,
                    lane as usize,
                    s0.clamp(0, 255) as u16,
                    s1.clamp(0, 255) as u16,
                    v.clamp(0, 127) as u8,
                    out,
                );
            }
        }
        /* ── Undo ring ────────────────────────────────────────────────────
         * The UI owns the stack and addresses state by id; nothing here ever
         * sends a blob back, which is the whole point (the param SHM is a
         * single slot and a set serializes to kilobytes). */
        // usnap <id> — store the current state under `id`.
        "usnap" => {
            if let Some(id) = next() {
                let blob = engine.undo_snapshot();
                engine.undo.snap(id as u32, blob);
            }
        }
        // uswap <restoreId> <captureId> — capture the current state into
        // `captureId`, then restore `restoreId`. One primitive serves undo and
        // redo, and doing both halves in one op keeps them atomic: a UI tick
        // can never land between them and lose the state it is standing on.
        "uswap" => {
            if let (Some(restore), Some(capture)) = (next(), next()) {
                if let Some(blob) = engine.undo.take(restore as u32) {
                    let cur = engine.undo_snapshot();
                    engine.undo.snap(capture as u32, cur);
                    engine.undo_restore(&blob);
                }
            }
        }
        // ucommit <id> — no-op suppression. An edit whose group changed nothing
        // must not consume an undo press, and only a full compare catches the
        // case that matters: changed and reverted inside one gesture, which an
        // edit counter cannot see.
        "ucommit" => {
            if let Some(id) = next() {
                let id = id as u32;
                if engine.undo.peek(id) == Some(engine.undo_snapshot().as_str()) {
                    engine.undo.drop_id(id);
                    engine.undo.note_noop(id);
                }
            }
        }
        "udrop" => {
            if let Some(id) = next() {
                engine.undo.drop_id(id as u32);
            }
        }
        "uclr" => engine.undo.clear(),
        _ => {} // forward compat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::new(44100, 12000)
    }

    #[test]
    fn trig_property_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
        apply_batch(&mut e, "eprob 0 2 2 -1 40;econd 0 2 2 -1 2 3;einv 0 2 2 -1 1", &mut out);
        let t = e.tracks[0].active().governing_trig(2, 60);
        assert_eq!((t.prob, t.cond_a, t.cond_b, t.invert), (40, 2, 3, true));
    }

    #[test]
    fn batch_applies_in_order() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;watch 1;bpm 14000", &mut out);
        assert_eq!(e.tracks[0].active().notes.len(), 1);
        assert_eq!(e.watch_track, 1);
        assert_eq!(e.clock.bpm_x100(), 14000);
    }

    #[test]
    fn tog_does_not_autostart_transport() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        assert!(!e.playing, "entering a step while stopped must not start playback");
        assert!(e.tracks[0].active().exists(), "the clip is still created");
    }

    #[test]
    fn tog_while_playing_queues_selected_slot_to_next_bar() {
        let mut e = engine();
        let mut out = Vec::new();
        // Transport running, track 0's selected slot empty + never launched.
        // Start directly: this exercises launch-queue mechanics, not the Move
        // link (whose "play" command now waits for Move — covered separately).
        e.play();
        assert_eq!(e.tracks[0].playing_slot, None, "empty selected slot isn't playing yet");
        apply_batch(&mut e, "tog 0 4 60 100", &mut out);
        assert!(e.playing);
        let a = e.tracks[0].active_clip;
        // Bar-quantized launch: queued now, not playing until the next bar.
        assert_eq!(e.tracks[0].queued_slot, Some(a), "queued for a bar-quantized launch");
        assert_eq!(e.tracks[0].playing_slot, None, "does not start mid-bar");
        // Run past the next bar boundary → the queue resolves to playing.
        while e.clock.tick < crate::TICKS_PER_BAR as u64 + 2 {
            e.advance_block(128, &mut out);
        }
        assert_eq!(e.tracks[0].playing_slot, Some(a), "starts on the bar");
        assert_eq!(e.tracks[0].queued_slot, None);
    }

    #[test]
    fn ltog_while_playing_queues_selected_slot() {
        let mut e = engine();
        let mut out = Vec::new();
        e.play(); // launch-queue mechanics; the "play" command's link path is tested separately
        apply_batch(&mut e, "ltog 0 4 36 100", &mut out);
        assert_eq!(e.tracks[0].queued_slot, Some(e.tracks[0].active_clip));
        assert_eq!(e.tracks[0].playing_slot, None);
    }

    #[test]
    fn tog_while_stopped_still_does_not_play() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 4 60 100", &mut out);
        assert!(!e.playing);
        assert_eq!(e.tracks[0].playing_slot, None, "stopped: note entry must not start playback");
        assert_eq!(e.tracks[0].queued_slot, None, "stopped: nothing queued either");
    }

    #[test]
    fn play_stop_commands_route_through_move_link() {
        // The "play"/"stop" command strings dispatch to the always-on Move link
        // (design §7 Phase 4): with Move stopped, "play" arms a pending-start
        // (MovePlay inject) instead of starting immediately, and "stop" cancels.
        let mut e = engine();
        e.link_enabled = true;
        let mut out = Vec::new();
        apply_batch(&mut e, "play", &mut out);
        assert!(!e.playing, "linked: play waits for Move's FA");
        e.advance_block(128, &mut out);
        assert!(out.iter().any(|x| matches!(x, OutEvent::MoveInject { val: 127 })),
                "play command injects MovePlay toward Move");
        apply_batch(&mut e, "stop", &mut out);
        assert!(!e.playing);
    }

    #[test]
    fn mute_per_track() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "mute 2 1", &mut out);
        assert!(e.tracks[2].muted);
        apply_batch(&mut e, "mute 2 0", &mut out);
        assert!(!e.tracks[2].muted);
    }

    #[test]
    fn malformed_and_unknown_ops_ignored() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0;;frobnicate 1 2 3; ;tog 9 0 60 100;tog 0 0 999 100", &mut out);
        assert!(e.tracks[0].active().notes.is_empty());
        assert!(!e.playing);
    }

    #[test]
    fn tog_places_chord() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 2 60 100 64 90 67 80", &mut out);
        let notes = &e.tracks[0].active().notes;
        assert_eq!(notes.len(), 3);
        assert!(notes.iter().all(|n| n.step == 2));
        // Bare re-toggle clears the whole step.
        apply_batch(&mut e, "tog 0 2 72 100", &mut out);
        assert!(e.tracks[0].active().notes.is_empty());
    }

    #[test]
    fn ltog_toggles_one_lane() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "ltog 0 0 36 100;ltog 0 0 38 100", &mut out);
        assert_eq!(e.tracks[0].active().notes.len(), 2);
        apply_batch(&mut e, "ltog 0 0 36 100", &mut out);
        let notes = &e.tracks[0].active().notes;
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].pitch, 38);
    }

    #[test]
    fn note_edit_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        apply_batch(&mut e, "evel 0 0 0 -1 -30", &mut out);
        assert_eq!(e.tracks[0].active().notes[0].vel, 70);
        apply_batch(&mut e, "etrn 0 0 0 -1 12", &mut out);
        assert_eq!(e.tracks[0].active().notes[0].pitch, 72);
        apply_batch(&mut e, "enudge 0 0 0 -1 5", &mut out);
        assert_eq!(e.tracks[0].active().notes[0].tick, 5);
        // Lane-restricted edit ignores other pitches.
        apply_batch(&mut e, "ltog 0 0 38 100", &mut out);
        apply_batch(&mut e, "evel 0 0 0 38 -50", &mut out);
        let snare = e.tracks[0].active().notes.iter().find(|n| n.pitch == 38).unwrap();
        assert_eq!(snare.vel, 50);
        assert_eq!(e.tracks[0].active().notes.iter().find(|n| n.pitch == 72).unwrap().vel, 70);
    }

    #[test]
    fn clip_copy_delete_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        // Place notes, delete one step.
        apply_batch(&mut e, "tog 0 0 60 100;tog 0 4 62 100", &mut out);
        apply_batch(&mut e, "del 0 0 0 -1", &mut out);
        assert!(!e.tracks[0].active().step_has_notes(0));
        assert!(e.tracks[0].active().step_has_notes(4));

        // Duplicate the clip → next slot becomes active with the same notes.
        apply_batch(&mut e, "clipdup 0", &mut out);
        assert_eq!(e.tracks[0].active_clip, 1);
        assert!(e.tracks[0].active().step_has_notes(4));

        // Delete the active clip.
        apply_batch(&mut e, "clipdel 0", &mut out);
        assert!(!e.tracks[0].active().exists());

        // Drum-pad delete (pitch-filtered, whole clip) on a fresh slot.
        apply_batch(&mut e, "clipsel 0 0;clipdel 0", &mut out);
        apply_batch(&mut e, "ltog 0 0 36 100;ltog 0 8 36 100;ltog 0 4 38 100", &mut out);
        apply_batch(&mut e, "del 0 0 255 36", &mut out);
        assert!(e.tracks[0].active().notes.iter().all(|n| n.pitch == 38));
        assert_eq!(e.tracks[0].active().notes.len(), 1);
    }

    #[test]
    fn copy_paste_steps() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;tog 0 2 64 110", &mut out);
        apply_batch(&mut e, "cpy 0 0 3", &mut out);   // copy steps 0-3
        apply_batch(&mut e, "pst 0 8", &mut out);     // paste at step 8
        assert!(e.tracks[0].active().step_has_notes(8));   // 0 → 8
        assert!(e.tracks[0].active().step_has_notes(10));  // 2 → 10
        let pasted = e.tracks[0].active().notes.iter().find(|n| n.step == 10).unwrap();
        assert_eq!(pasted.pitch, 64);
        assert_eq!(pasted.vel, 110);

        // Cross-track paste uses the same clipboard.
        apply_batch(&mut e, "pst 1 0", &mut out);
        assert!(e.tracks[1].active().step_has_notes(0));
        apply_batch(&mut e, "cpyclr;pst 1 4", &mut out); // cleared → no-op
        assert!(!e.tracks[1].active().step_has_notes(4));
    }

    #[test]
    fn loop_and_double_commands() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;loop 0 0 16", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 16);
        apply_batch(&mut e, "dbl 0", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 32);
        assert!(e.tracks[0].active().step_has_notes(16));
        // Set a window starting at bar 1.
        apply_batch(&mut e, "loop 0 16 16", &mut out);
        assert_eq!(e.tracks[0].active().loop_start_steps, 16);
        assert_eq!(e.tracks[0].active().length_steps, 16);
    }

    #[test]
    fn note_within_sub_bar_length_does_not_extend() {
        let mut e = engine();
        e.tracks[0].active_mut().set_clip_length(12); // custom 12-step clip
        let mut out = Vec::new();
        // Placing/recording a note inside the 12 steps must not grow it to a bar.
        apply_batch(&mut e, "tog 0 4 60 100", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 12);
        // A note past the length still grows (bar-aligned), as before.
        apply_batch(&mut e, "tog 0 20 60 100", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 32);
    }

    #[test]
    fn step_entry_untransposes_like_live_record() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().transpose = 5;
        let mut out = Vec::new();
        // Melodic step entry of pad pitch 67 → stored 62 so emit re-adds 5 → 67.
        apply_batch(&mut e, "tog 0 0 67 100", &mut out);
        assert!(e.tracks[0].active().notes.iter().any(|n| n.step == 0 && n.pitch == 62));
        // Drum-lane entry likewise: 38 → 33.
        apply_batch(&mut e, "ltog 0 4 38 100", &mut out);
        assert!(e.tracks[0].active().notes.iter().any(|n| n.step == 4 && n.pitch == 33));
        // Range add (Loop-mode bar + pad) likewise: 60 → 55.
        apply_batch(&mut e, "addp 0 8 8 60 100", &mut out);
        assert!(e.tracks[0].active().notes.iter().any(|n| n.step == 8 && n.pitch == 55));
    }

    #[test]
    fn tdrum_makes_step_entry_store_the_pad_pitch_verbatim() {
        let mut e = engine();
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().transpose = 5;
        let mut out = Vec::new();
        apply_batch(&mut e, "tdrum 0 1", &mut out);
        assert!(e.track_is_drum(0));
        // Nothing is re-added at emit on a drum track, so nothing is subtracted
        // here — the stored pitch stays the pad's own address.
        apply_batch(&mut e, "ltog 0 4 38 100", &mut out);
        assert!(e.tracks[0].active().notes.iter().any(|n| n.step == 4 && n.pitch == 38));
        // …and it reverts when a melodic module replaces the drum one.
        apply_batch(&mut e, "tdrum 0 0", &mut out);
        apply_batch(&mut e, "ltog 0 8 38 100", &mut out);
        assert!(e.tracks[0].active().notes.iter().any(|n| n.step == 8 && n.pitch == 33));
    }

    #[test]
    fn clip_param_commands_set_active_clip() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "loop 0 0 16", &mut out); // make the clip exist
        apply_batch(&mut e, "clen 0 9;cscl 0 3 4;ctr 0 -40", &mut out);
        let c = e.tracks[0].active();
        assert_eq!(c.length_steps, 9);
        assert_eq!((c.scale_num, c.scale_den), (3, 4));
        assert_eq!(c.transpose, -36); // clamped to -36
        // length clamps to [1, MAX_STEPS]
        apply_batch(&mut e, "clen 0 0", &mut out);
        assert_eq!(e.tracks[0].active().length_steps, 1);
    }

    #[test]
    fn slen_sets_note_length() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        apply_batch(&mut e, "slen 0 0 0 -1 96", &mut out); // 96 ticks = 4 steps
        let n = e.tracks[0].active().notes.iter().find(|n| n.tick == 0).unwrap();
        assert_eq!(n.gate, 96);
    }

    #[test]
    fn automation_commands_set_lane_lock_base() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 1 synth:cutoff", &mut out);
        assert!(e.tracks[0].lane_assigned[1]);
        assert_eq!(e.tracks[0].lane_label[1], "synth:cutoff");
        apply_batch(&mut e, "abase 0 1 64", &mut out);
        assert_eq!(e.tracks[0].lane_base[1], 64);
        // abase emits a live CC immediately (audition / stopped apply).
        assert!(out.iter().any(|x| matches!(x, OutEvent::Cc { track: 0, lane: 1, val: 64 })));
        // abaseq updates the base WITHOUT emitting a CC.
        out.clear();
        apply_batch(&mut e, "abaseq 0 1 30", &mut out);
        assert_eq!(e.tracks[0].lane_base[1], 30);
        assert!(out.is_empty());
        apply_batch(&mut e, "aset 0 1 5 90", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(1, 5), Some(90));
        // aclrs removes one step's lock; the lane (and other steps) stay.
        apply_batch(&mut e, "aset 0 1 5 90;aset 0 1 6 80", &mut out);
        apply_batch(&mut e, "aclrs 0 1 5", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(1, 5), None);
        assert_eq!(e.tracks[0].active().lock_at(1, 6), Some(80));
        assert!(e.tracks[0].lane_assigned[1]); // lane still assigned

        apply_batch(&mut e, "aclr 0 1", &mut out);
        assert!(!e.tracks[0].lane_assigned[1]);
        assert_eq!(e.tracks[0].active().lock_at(1, 6), None);

        // aclrstep removes every lane's lock at one step, leaving other steps.
        apply_batch(&mut e, "aset 0 0 3 50;aset 0 2 3 60;aset 0 1 9 70", &mut out);
        apply_batch(&mut e, "aclrstep 0 3", &mut out);
        assert_eq!(e.tracks[0].active().lock_at(0, 3), None);
        assert_eq!(e.tracks[0].active().lock_at(2, 3), None);
        assert_eq!(e.tracks[0].active().lock_at(1, 9), Some(70));

        // asetr sets a lane's lock across a whole bar (range), nothing outside it.
        apply_batch(&mut e, "asetr 0 0 16 31 99", &mut out);
        for s in 16..=31 {
            assert_eq!(e.tracks[0].active().lock_at(0, s), Some(99));
        }
        assert_eq!(e.tracks[0].active().lock_at(0, 15), None);
        assert_eq!(e.tracks[0].active().lock_at(0, 32), None);
    }

    #[test]
    fn lane_freed_when_last_clip_lock_removed() {
        let mut e = engine();
        let mut out = Vec::new();
        // Lane 0 assigned, locked in clip 0 (active) and clip 1.
        apply_batch(&mut e, "alabel 0 0 synth:cutoff", &mut out);
        apply_batch(&mut e, "aset 0 0 4 100", &mut out);
        e.select_clip(0, 1);
        apply_batch(&mut e, "aset 0 0 4 90", &mut out);
        e.select_clip(0, 0);
        // Delete active clip 0 → clip 1 still locks the lane → stays assigned.
        e.delete_clip(0);
        assert!(e.tracks[0].lane_assigned[0], "kept while clip 1 still uses it");
        // Delete clip 1 → no clip locks the lane → freed.
        e.delete_clip_at(0, 1);
        assert!(!e.tracks[0].lane_assigned[0], "freed when no clip uses it");
        assert!(e.tracks[0].lane_label[0].is_empty());
    }

    #[test]
    fn auto_clear_step_frees_lone_lane_but_keeps_one_with_other_locks() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 2 synth:res", &mut out);
        apply_batch(&mut e, "aset 0 2 7 64", &mut out);
        apply_batch(&mut e, "aclrs 0 2 7", &mut out);
        assert!(!e.tracks[0].lane_assigned[2], "lone lock cleared → lane freed");
        // A lane with another locked step survives the clear.
        apply_batch(&mut e, "alabel 0 1 synth:cutoff", &mut out);
        apply_batch(&mut e, "aset 0 1 3 50;aset 0 1 8 60", &mut out);
        apply_batch(&mut e, "aclrs 0 1 3", &mut out);
        assert!(e.tracks[0].lane_assigned[1], "other step still locks → kept");
    }

    #[test]
    fn auto_clear_step_all_frees_step_only_lane() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 0 synth:cutoff", &mut out);
        apply_batch(&mut e, "aset 0 0 5 70", &mut out);
        apply_batch(&mut e, "aclrstep 0 5", &mut out);
        assert!(!e.tracks[0].lane_assigned[0], "step-only lane freed when its step clears");
    }

    #[test]
    fn status_reports_automation_fields() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "alabel 0 0 synth:a;alabel 0 2 synth:b", &mut out);
        e.tracks[0].active_mut().set_lock(2, 4, 50);
        apply_batch(&mut e, "hold 0 4", &mut out);
        let s = e.status();
        assert!(s.contains("alanes=05")); // lanes 0 and 2 assigned
        assert!(s.contains("aauto=04")); // lane 2 has a lock
        let hauto = s.split("hauto=").nth(1).unwrap().split(' ').next().unwrap();
        assert_eq!(hauto, "2:50");
    }

    #[test]
    fn wlane_filters_status_occupancy() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "ltog 0 0 36 100;ltog 0 4 38 100", &mut out);
        apply_batch(&mut e, "wlane 38", &mut out);
        assert_eq!(e.watch_lane, Some(38));
        let occ = e.status().split("occ=").nth(1).unwrap().to_string();
        assert_eq!(&occ[0..2], "08"); // only step 4 (snare lane)
        apply_batch(&mut e, "wlane -1", &mut out);
        assert_eq!(e.watch_lane, None);
        let occ = e.status().split("occ=").nth(1).unwrap().to_string();
        assert_eq!(&occ[0..2], "88"); // both lanes visible
    }

    /* ── Verb classification completeness ─────────────────────────────────
     * The guard that keeps undo from rotting. Adding a command to the match
     * below without deciding whether it is an edit fails this test, so the
     * decision cannot be skipped by forgetting it — which is exactly how undo
     * coverage decays in practice. */

    /// Every `"verb"` literal appearing as a match arm in this file's
    /// `apply_op`, including `|`-joined arms.
    fn dispatched_verbs() -> Vec<String> {
        let src = include_str!("command.rs");
        let body = &src[src.find("fn apply_op(").expect("apply_op must exist")..];
        let body = &body[..body.find("\n#[cfg(test)]").unwrap_or(body.len())];
        let mut verbs = Vec::new();
        for line in body.lines() {
            let t = line.trim();
            // Match arms only: `"a" | "b" => {` / `"a" => expr`.
            if !t.starts_with('"') || !t.contains("=>") {
                continue;
            }
            let head = &t[..t.find("=>").unwrap()];
            for piece in head.split('|') {
                let p = piece.trim().trim_matches(|c| c == '"' || c == ' ');
                if !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase()) {
                    verbs.push(p.to_string());
                }
            }
        }
        verbs
    }

    #[test]
    fn verb_extraction_finds_the_known_commands() {
        // Guards the guard: a parser that silently found nothing would make
        // every_match_verb_is_classified pass vacuously forever.
        let verbs = dispatched_verbs();
        assert!(verbs.len() > 40, "only extracted {} verbs", verbs.len());
        for expect in ["tog", "play", "clipdel", "aset", "uswap"] {
            assert!(verbs.iter().any(|v| v == expect), "missed {expect}");
        }
    }

    #[test]
    fn every_match_verb_is_classified() {
        let unclassified: Vec<String> = dispatched_verbs()
            .into_iter()
            .filter(|v| !is_undoable_edit(v) && !is_control_verb(v))
            .collect();
        assert!(
            unclassified.is_empty(),
            "unclassified command verbs: {unclassified:?} — add each to \
             is_undoable_edit (a user edit undo must restore) or to \
             is_control_verb (transport/view/bookkeeping)"
        );
    }

    #[test]
    fn no_verb_is_classified_twice() {
        let both: Vec<String> = dispatched_verbs()
            .into_iter()
            .filter(|v| is_undoable_edit(v) && is_control_verb(v))
            .collect();
        assert!(both.is_empty(), "verbs in both lists: {both:?}");
    }

    #[test]
    fn is_undoable_edit_excludes_selection_and_transport() {
        for v in ["clipsel", "launch", "stoptrk", "play", "stop", "watch", "hold"] {
            assert!(!is_undoable_edit(v), "{v} must not be undoable");
        }
    }

    #[test]
    fn is_undoable_edit_includes_set_level_settings() {
        for v in ["mute", "bpm", "swing", "tog", "clipdel", "aset"] {
            assert!(is_undoable_edit(v), "{v} must be undoable");
        }
    }

    /* ── Undo ring commands ───────────────────────────────────────────── */

    #[test]
    fn usnap_then_uswap_restores() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100;usnap 1", &mut out);
        let before = e.undo_snapshot();
        apply_batch(&mut e, "tog 0 4 62 100", &mut out);
        assert_ne!(e.undo_snapshot(), before);

        apply_batch(&mut e, "uswap 1 2", &mut out);
        assert_eq!(e.undo_snapshot(), before, "undo did not restore");
        // Redo: the pre-undo state was captured into id 2.
        apply_batch(&mut e, "uswap 2 1", &mut out);
        assert_ne!(e.undo_snapshot(), before, "redo did not re-apply");
    }

    #[test]
    fn ucommit_drops_a_noop_snapshot_and_reports_it() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "usnap 5", &mut out); // nothing changes after this
        apply_batch(&mut e, "ucommit 5", &mut out);
        assert!(e.undo.peek(5).is_none(), "no-op snapshot should be dropped");
        assert_eq!(e.undo.take_noop(), Some(5));
    }

    #[test]
    fn ucommit_keeps_a_real_edit() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "usnap 5;tog 0 0 60 100;ucommit 5", &mut out);
        assert!(e.undo.peek(5).is_some(), "a real edit must be kept");
        assert_eq!(e.undo.take_noop(), None);
    }

    /// Change-and-revert inside one gesture — a knob turned up and back down
    /// before release. This is the case an edit counter cannot see, and the
    /// reason ucommit compares serializations instead of counting.
    #[test]
    fn ucommit_treats_change_then_revert_as_a_noop() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "usnap 5", &mut out);
        apply_batch(&mut e, "bpm 13000", &mut out); // knob up
        apply_batch(&mut e, "bpm 12000", &mut out); // …and back
        apply_batch(&mut e, "ucommit 5", &mut out);
        assert!(e.undo.peek(5).is_none(), "revert within a group is a no-op");
    }

    /// Toggling a step on and off is NOT a revert: the first press creates the
    /// clip and the second only empties it, so the set really does end up
    /// different. Pinned because it looks like a no-op and is not — undo has to
    /// offer the clip's creation back.
    #[test]
    fn ucommit_keeps_a_step_toggled_on_then_off() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "usnap 5", &mut out);
        apply_batch(&mut e, "tog 0 0 60 100;tog 0 0 60 100", &mut out);
        apply_batch(&mut e, "ucommit 5", &mut out);
        assert!(
            e.undo.peek(5).is_some(),
            "the clip the first toggle created is a real change"
        );
    }

    #[test]
    fn undo_ring_ops_do_not_mark_the_engine_dirty() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "usnap 1", &mut out);
        e.dirty = false;
        apply_batch(&mut e, "usnap 2;ucommit 2;udrop 2;uclr", &mut out);
        assert!(!e.dirty, "ring bookkeeping must not schedule an autosave");
    }

    #[test]
    fn uswap_marks_dirty_so_the_undo_is_persisted() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "usnap 1;tog 0 0 60 100", &mut out);
        e.dirty = false;
        apply_batch(&mut e, "uswap 1 2", &mut out);
        assert!(e.dirty, "an undone edit must still reach the autosave");
    }

    #[test]
    fn uswap_with_an_unknown_id_does_nothing() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        let before = e.undo_snapshot();
        apply_batch(&mut e, "uswap 99 1", &mut out);
        assert_eq!(e.undo_snapshot(), before, "a missing id must be inert");
        assert!(e.undo.peek(1).is_none(), "and must not capture either");
    }

    #[test]
    fn swing_command_sets_and_clamps() {
        let mut e = engine();
        let mut out = Vec::new();
        apply_batch(&mut e, "swing 70", &mut out);
        assert_eq!(e.swing_pct, 70);
        apply_batch(&mut e, "swing 90", &mut out); // above max
        assert_eq!(e.swing_pct, 80);
        apply_batch(&mut e, "swing 10", &mut out); // below min
        assert_eq!(e.swing_pct, 50);
    }
}
