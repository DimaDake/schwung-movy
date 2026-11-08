//! lib.rs's half of freeze: what `frz` refuses, and the UI's chain document
//! held while an open is in flight.

use super::*;

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
