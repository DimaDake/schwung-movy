/* Host-only: the fixture's cold detection, with no device and no chain.
 *
 * The rule this pins used to be "EVERY slot reads empty", and that is false for
 * the shape a device actually comes up in after a reboot onto an unsaved set:
 * measured `[0 plaits 1 - 2 - 3 -]` against a fixture wanting mrdrums in slot
 * 1. Slot 0 being occupied masked slot 1 being empty, the boot seed was
 * skipped, and the fixture then spent its whole retry budget on a route that
 * cannot activate an empty slot — so the tier never ran a scenario at all.
 *
 * The interesting inputs are therefore the PARTIAL ones. A chain that is half
 * seeded must take the boot-seed path, and a WARM one must not: that path
 * restarts the stack, and a warm chain taking it would restart the stack on
 * every scenario of every run, which is a worse bug than the one this fixes.
 */
import { chainIsColdFor } from '../dist/fixture.js';

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

/* The shipped fixture: modules wanted in slots 0 and 1, 2 and 3 left empty. */
const WANT = [
    { slot: '0', mod: 'plaits' },
    { slot: '1', mod: 'mrdrums' },
    { slot: '2', mod: 'none' },
    { slot: '3', mod: 'none' },
];
const read = (...lines) => lines;

/* THE ONE THE BUG WAS: slot 0 occupied must not mask slot 1 empty. */
ok('a partially cold chain is cold',
   chainIsColdFor(WANT, read('0 plaits', '1 -', '2 -', '3 -')));
ok('a fully cold chain is still cold',
   chainIsColdFor(WANT, read('0 -', '1 -', '2 -', '3 -')));

/* The warm side, and the reason it matters: a false cold here restarts the
 * stack on every fixture establishment of every scenario. */
ok('a warm chain is not cold',
   !chainIsColdFor(WANT, read('0 plaits', '1 mrdrums', '2 -', '3 -')));
/* A wrong module in a wanted slot is NOT cold: the slot is active, and
 * load_file acts on an existing chain instance, so the ordinary apply can
 * replace it. Only an EMPTY slot is unreachable by that route. */
ok('a wrong module in a wanted slot is not cold',
   !chainIsColdFor(WANT, read('0 plaits', '1 noisemaker', '2 -', '3 -')));

/* Only the slots the fixture names are consulted: a slot the fixture leaves
 * empty reads empty by design and must not pull the chain in. */
ok('empty slots the fixture does not want do not count',
   !chainIsColdFor([{ slot: '0', mod: 'plaits' }, { slot: '1', mod: 'none' }],
                   read('0 plaits', '1 -', '2 -', '3 -')));
ok('and a fixture wanting nothing is never cold',
   !chainIsColdFor([{ slot: '0', mod: 'none' }], read('0 -', '1 -', '2 -', '3 -')));

/* Silence is unknown, not empty — the guard that must survive this change. */
ok('a wanted slot that never answered is unknown, not cold',
   !chainIsColdFor(WANT, read('0 plaits', '2 -', '3 -')));
ok('and an empty read is not cold',
   !chainIsColdFor(WANT, read()));

/* The reader sorts its lines, so the rule matches by the slot index in the
 * line rather than by position. Belt and braces, because a positional rule
 * would pass every check above and still break on a reordered read. */
ok('the order the slots were read in does not matter',
   chainIsColdFor(WANT, read('1 -', '3 -', '0 plaits', '2 -')));

console.log(fails === 0 ? 'FIXTURE SELFTEST PASSED' : `${fails} FIXTURE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
