/* browser-test/logic/platform-caps.mjs — movy-host is the only host (WP9).
 *
 * What is left of the old caps suite: the menus that used to depend on Move
 * beside movy, and the platform reaching the host through the global names
 * movy-host registers (the suites swap those globals per test, so a platform
 * that captured one at load would test nothing).
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    _log('\n── Platform: movy-host is the only host ──');
    const { leaveModalLabels, openLeaveModal, openPowerModal, closeLeaveModal, leaveModalTitle } =
        await import('../../dist/esm/app/leave-modal.js');
    const { standalonePlatform } = await import('../../dist/esm/platform/standalone.js');

    openLeaveModal();
    eq('the leave menu offers only Close Movy', leaveModalLabels().join('|'), 'Close Movy');
    closeLeaveModal();
    openPowerModal();
    eq('the power button opens the shutdown dialog', leaveModalTitle() + ' ' + leaveModalLabels().join('|'),
       'Power off? Power off|Cancel');
    closeLeaveModal();

    const saved = { exit: globalThis.host_exit_module, off: globalThis.host_power_off,
                    led: globalThis.move_midi_internal_send };
    const hit = [];
    globalThis.host_exit_module = () => hit.push('exit');
    globalThis.host_power_off = () => hit.push('off');
    globalThis.move_midi_internal_send = (d) => hit.push('led:' + d.join(','));
    try {
        standalonePlatform.exit();
        standalonePlatform.powerOff();
        standalonePlatform.surfaceSend([0x09, 0x90, 68, 5]);
        eq('each call reaches the global it names, read at call time', hit.join(' '), 'exit off led:9,144,68,5');
    } finally {
        globalThis.host_exit_module = saved.exit;
        globalThis.host_power_off = saved.off;
        globalThis.move_midi_internal_send = saved.led;
    }
    ok('there is no Move-only call left on the platform',
       !['suspend', 'claimLeds', 'injectToMove', 'lendSurfaceToMove'].some((k) => k in standalonePlatform));
}
