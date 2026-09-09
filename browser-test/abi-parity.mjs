#!/usr/bin/env node
/* browser-test/abi-parity.mjs — the Rust ABI mirror has not drifted.
 *
 * movy-dsp hand-mirrors schwung's C structs in engine/crates/movy-dsp/src/ffi.rs
 * so it can be called as a plugin and (Stage 3) call the chain host back. Those
 * mirrors are a COPY of a header movy does not own.
 *
 * If schwung reorders or inserts a field, nothing fails to compile: Rust happily
 * reads the wrong offset, movy calls a function pointer that is not the function
 * it thinks, and the crash lands inside MoveOriginal — taking the device's whole
 * audio stack with it. There is no runtime check that can catch this after the
 * fact, so it is caught here, at test time, by comparing the two field lists.
 *
 * `api_version` is asserted at runtime as a second line of defence, but it only
 * catches a version bump — not a silent reorder within the same version.
 *
 * Run: node browser-test/abi-parity.mjs
 */

import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
const _log = (s) => process.stdout.write(s + '\n');
function ok(label, cond) {
    if (cond) _log(`  \x1b[32m✓\x1b[0m ${label}`);
    else { _log(`  \x1b[31m✗\x1b[0m ${label}`); failures++; }
}

/* The reference repo is a sibling checkout, not a dependency — so this used to
 * print a loud SKIPPED and exit 0, which made `npm test` green while the check
 * had not run. That was survivable while the mirror was only READ from. It is
 * not any more: `chain_host.rs` hands the chain host a copy of the mirrored
 * struct, so a mirror that has silently fallen behind the header is a wild
 * function pointer called on the audio thread. A guard that can switch itself
 * off protects exactly nothing, so a missing checkout is now a failure. */
const HEADER = '/Users/dake/git/cld/schwung/src/host/plugin_api_v1.h';
if (!existsSync(HEADER)) {
    _log('\x1b[31m\x1b[1mCANNOT RUN — schwung checkout not found at ' + HEADER + '\x1b[0m');
    _log('\x1b[31mThe Rust mirror in ffi.rs is COPIED into the chain host, so it must be');
    _log('checked against the real header. Clone schwung there, then re-run.\x1b[0m');
    process.exit(1);
}

/* Commit the mirror was last verified against, so a failure says what to diff. */
const VERIFIED_AT = '583cc175';

const header = readFileSync(HEADER, 'utf8');
const rust = readFileSync('engine/crates/movy-dsp/src/ffi.rs', 'utf8');

/* Field names of a C struct, in declaration order. Handles plain fields,
 * function pointers (`ret (*name)(args);`) and array members (`void *n[8];`).
 *
 * The array case is not decoration. `host_api_v1_t` ends in `void *reserved[8]`
 * and the plain-field pattern below anchors on a trailing identifier, so a
 * member ending in `]` matched NEITHER branch: the header had 18 members, this
 * counted 17, ffi.rs had 17, and "field count matches (17) ✓" was printed over
 * a mirror that was one member short of the struct it is copied into. */
function cFields(src, structName) {
    const m = src.match(new RegExp(`typedef struct ${structName}\\s*\\{([\\s\\S]*?)\\}`, 'm'));
    if (!m) return null;
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const out = [];
    for (const line of body.split(';')) {
        const fn = line.match(/\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\(/);
        if (fn) { out.push(fn[1]); continue; }
        const arr = line.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)+$/);
        if (arr) { out.push(arr[1]); continue; }
        const plain = line.match(/([A-Za-z_]\w*)\s*$/);
        if (plain && line.trim()) out.push(plain[1]);
    }
    return out;
}

/* Field names of a #[repr(C)] Rust struct, in declaration order. */
function rustFields(src, structName) {
    const m = src.match(new RegExp(`pub struct ${structName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
    if (!m) return null;
    const body = m[1].replace(/\/\/[^\n]*/g, '');
    const out = [];
    for (const fm of body.matchAll(/^\s*pub\s+([A-Za-z_]\w*)\s*:/gm)) out.push(fm[1]);
    return out;
}

function compare(label, cName, rustName, { prefixOnly = false } = {}) {
    _log(`\n${label}:`);
    const c = cFields(header, cName);
    const r = rustFields(rust, rustName);
    ok(`C struct ${cName} found in the header`, Array.isArray(c) && c.length > 0);
    ok(`Rust struct ${rustName} found in ffi.rs`, Array.isArray(r) && r.length > 0);
    if (!c || !r) return;

    const want = prefixOnly ? c.slice(0, r.length) : c;

    if (!prefixOnly) {
        ok(`field count matches (${r.length})${r.length === c.length ? '' : `: C has ${c.length}, Rust has ${r.length}`}`,
            r.length === c.length);
    } else {
        ok(`Rust mirror is a prefix, not longer than the C struct (${r.length} <= ${c.length})`,
            r.length <= c.length);
    }

    let firstBad = -1;
    for (let i = 0; i < Math.min(want.length, r.length); i++) {
        if (want[i] !== r[i]) { firstBad = i; break; }
    }
    ok(firstBad < 0
        ? `field order matches the header`
        : `field order matches the header — DIVERGED at index ${firstBad}: `
          + `header has "${want[firstBad]}", ffi.rs has "${r[firstBad]}" `
          + `(mirror verified at schwung ${VERIFIED_AT}; diff the header and fix ffi.rs)`,
        firstBad < 0);
}

_log('\x1b[1mABI mirror vs schwung/src/host/plugin_api_v1.h\x1b[0m');
compare('plugin_api_v2 — the struct movy calls the chain host through',
        'plugin_api_v2', 'plugin_api_v2_t');
/* Mirrored in FULL, not as a prefix. It used to be a prefix, which was safe
 * while movy only read fields out of schwung's own struct — the offsets of the
 * fields present are unchanged by omitting trailing ones. It stopped being safe
 * when `chain_host.rs` began handing the chain host a COPY of this struct with
 * the two MIDI senders swapped for movy's wrappers (`midi_out`): the chain host
 * reads `slot_recv_channel` (Pre-mode track addressing) and `get_beat_position`
 * (chain LFO lock) off whatever it is given, so a short copy makes it read past
 * the end and call a garbage function pointer on the audio thread. An exact
 * match means schwung appending a field fails HERE, with a diff to apply,
 * instead of on the device. */
compare('host_api_v1 — the struct schwung calls movy through, and copies',
        'host_api_v1', 'host_api_v1_t');

/* The param channel's ceiling is a shared constant, not a movy choice. Schwung
 * REJECTS an over-long contract with a visible message; movy truncates and
 * plans a page set from half a JSON document, so movy is the tree where drift
 * is silent. It has already bitten once at 4 KB (dexed's ~13.5 KB contract) and
 * schwung doubled 64 KB -> 128 KB in 1.3.0, which is what this now pins. */
_log('\nparam contract ceiling matches schwung:');
{
    const CONSTS = '/Users/dake/git/cld/schwung/src/host/shadow_constants.h';
    const cm = existsSync(CONSTS)
        && readFileSync(CONSTS, 'utf8').match(/#define\s+SHADOW_PARAM_VALUE_LEN\s+(\d+)/);
    const rm = readFileSync('engine/crates/movy-dsp/src/chain_host.rs', 'utf8')
        .match(/const PARAM_BUF: usize = (\d+)\s*\*\s*1024;/);
    ok('SHADOW_PARAM_VALUE_LEN found in shadow_constants.h', !!cm);
    ok('PARAM_BUF found in chain_host.rs', !!rm);
    if (cm && rm) {
        const want = Number(cm[1]), got = Number(rm[1]) * 1024;
        ok(want === got
            ? `PARAM_BUF is SHADOW_PARAM_VALUE_LEN (${got})`
            : `PARAM_BUF must equal SHADOW_PARAM_VALUE_LEN — header says ${want}, `
              + `chain_host.rs says ${got}; a module written to the header's ceiling `
              + `is read TRUNCATED into a wrong page layout`,
            want === got);
    }
}

/* api_version must be first in both, because it is the runtime check's anchor:
 * movy reads it before trusting any other field. */
_log('\nruntime version check is anchorable:');
ok('plugin_api_v2 starts with api_version',
    (cFields(header, 'plugin_api_v2') || [])[0] === 'api_version');
ok('the Rust mirror starts with api_version',
    (rustFields(rust, 'plugin_api_v2_t') || [])[0] === 'api_version');

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL ABI-PARITY CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} ABI-PARITY CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
