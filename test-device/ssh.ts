/* The one set of ssh/scp options every harness call uses.
 *
 * Multiplexed, because a fresh handshake to the device costs ~1.1 s and the
 * fixture alone makes a dozen calls before every scenario — at one handshake
 * each that was most of `fixture.ensure()`'s time. Reusing one connection per
 * user@host takes a call to well under 100 ms (display.ts measured it first:
 * its 1 s jog-hold deadline could not be observed without it).
 *
 * The socket path is short and %C-hashed: anything under the OS temp dir
 * overruns macOS's 104-char sun_path limit. ServerAlive makes a master whose
 * link died (Wi-Fi drop, reboot) exit within ~15 s instead of hanging every
 * client behind it; a client that finds no live master just connects directly. */
export const SSH_OPTS = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPath=/tmp/movy-ssh-%C',
    '-o', 'ControlPersist=60',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=3',
];
