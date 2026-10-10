/* browser-test/logic/platform-caps.mjs — the features that need Move beside
 * movy switch off on a host whose caps say Move is not there.
 *
 * The standalone host (plan WP6) only has to flip `caps`; nothing else in movy
 * learns there are two hosts. So every Move-only path is asserted SILENT under
 * a platform with `coexistsWithMove: false`, and — the control that gives the
 * silence its meaning — LOUD under the same spy platform with it true.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    _log('\n── Platform caps: Move-only features follow coexistsWithMove ──');
    const { platform, setPlatformForTest } = await import('../../dist/esm/platform/index.js');
    const { leaveModalLabels } = await import('../../dist/esm/app/leave-modal.js');
    const { claimLedOwnership } = await import('../../dist/esm/app/led-ownership.js');
    const { setCommitTick, setCommitIdle, resetSetCommit } = await import('../../dist/esm/seq/set-commit.js');
    const { volumeTrackDown, volumeTrackUp, resetTrackVolume } = await import('../../dist/esm/mixer/track-volume.js');

    const real = platform;
    const spyPlatform = (coexists) => {
        const calls = [];
        const spy = (name, ret) => (...args) => { calls.push(name); return ret; };
        const p = {
            ...real,
            caps: { coexistsWithMove: coexists, canSuspend: coexists, ownsMasterVolume: !coexists },
            claimLeds: spy('claimLeds', true),
            lendSurfaceToMove: spy('lendSurfaceToMove', true),
            excludeMoveFromVolume: spy('excludeMoveFromVolume', true),
            canExcludeMoveFromVolume: () => false,   // the inject path: the one that writes to Move
            canInjectToMove: () => true,
            injectToMove: spy('injectToMove'),
            engineInjectReachesMove: spy('engineInjectReachesMove', true),
        };
        return { p, calls };
    };

    /* Everything a Move-only feature can touch, exercised once. */
    function exercise() {
        const labels = leaveModalLabels();
        claimLedOwnership();
        resetSetCommit();
        setCommitTick('__pending-3-7', true);
        const armed = !setCommitIdle();
        resetSetCommit();
        resetTrackVolume();
        volumeTrackDown(0);
        volumeTrackUp(0);
        resetTrackVolume();
        return { labels, armed };
    }

    try {
        const loud = spyPlatform(true);
        setPlatformForTest(loud.p);
        const withMove = exercise();
        eq('beside Move: the leave menu offers Background', withMove.labels.join('|'), 'Background|Close Movy');
        ok('beside Move: the LED claim reaches the host', loud.calls.includes('claimLeds'));
        ok('beside Move: an uncommitted Set arms the commit press', withMove.armed);
        ok('beside Move: the volume divert injects the track hold', loud.calls.includes('injectToMove'));

        const quiet = spyPlatform(false);
        setPlatformForTest(quiet.p);
        const alone = exercise();
        eq('alone: the leave menu offers only Close Movy', alone.labels.join('|'), 'Close Movy');
        ok('alone: an uncommitted Set does not arm a press to Move', !alone.armed);
        eq('alone: nothing reaches a Move that is not there', quiet.calls.join(','), '');
    } finally {
        setPlatformForTest(real);
        resetSetCommit();
        resetTrackVolume();
    }

    await standaloneHost();
}

/* The REAL standalone platform (movy-host, WP6), not a spy: picked only when
 * movy-host has announced itself, and its Move-only calls never reach a
 * global even when one is present (movy-host registers them as stubs). */
async function standaloneHost() {
    _log('\n── Platform: the standalone host ──');
    const { standalonePlatform, isStandaloneHost } = await import('../../dist/esm/platform/standalone.js');
    ok('shadow_ui (no movy_host global) is not the standalone host', !isStandaloneHost());
    globalThis.movy_host = { flavour: 'standalone', version: 't', schwung: 't', movy: 't' };
    try {
        ok('movy-host announces itself through movy_host', isStandaloneHost());
    } finally {
        delete globalThis.movy_host;
    }
    eq('standalone caps', JSON.stringify(standalonePlatform.caps),
       JSON.stringify({ coexistsWithMove: false, canSuspend: false, ownsMasterVolume: true }));

    const names = ['host_suspend_overtake', 'shadow_set_overtake_suppress_sysex', 'shadow_set_overtake_mode',
                   'shadow_set_overtake_suppress_master_volume', 'move_midi_inject_to_move',
                   'shadow_overtake_move_inject_active'];
    const saved = names.map((n) => globalThis[n]);
    const hit = [];
    for (const n of names) globalThis[n] = () => { hit.push(n); return 1; };
    try {
        standalonePlatform.suspend();
        const answers = [standalonePlatform.claimLeds(), standalonePlatform.lendSurfaceToMove(true),
                         standalonePlatform.excludeMoveFromVolume(true), standalonePlatform.canExcludeMoveFromVolume(),
                         standalonePlatform.canInjectToMove(), standalonePlatform.engineInjectReachesMove()];
        standalonePlatform.injectToMove([0x0b, 0xb0, 85, 127]);
        eq('standalone: every Move-only call answers "cannot"', answers.join(','), 'false,false,false,false,false,false');
        eq('standalone: no Move-only global is reached even when present', hit.join(','), '');
    } finally {
        names.forEach((n, i) => { if (saved[i] === undefined) delete globalThis[n]; else globalThis[n] = saved[i]; });
    }
}
