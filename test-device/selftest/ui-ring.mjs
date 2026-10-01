/* Host-only: the ui-agent's writes, drained the way shadow_ui drains them.
 *
 * The consumer below is schwung's `ui_midi_ring_next` (src/host/ui_midi_ring.h)
 * transcribed, run against the agent's REAL `inject` over a plain bytearray.
 * The case that matters is a reader that has fallen behind mid-gesture: it is
 * what reordered "Rec on, pad, Right, pad" into "pad off, Right, …, Rec on" on
 * the device, and only a producer that writes from its own cursor survives it. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const agent = join(dirname(fileURLToPath(import.meta.url)), '..', 'device-agent', 'ui-agent.py');

let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const py = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('agent', sys.argv[1])
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
N = a.UI_MIDI_BYTES
ring, ctl = bytearray(N), bytearray(16)
rd = 0

def nxt():
    global rd
    if ring[rd]: return rd
    for k in range(4, N, 4):
        i = (rd + k) % N
        if ring[i]:
            if ring[rd]: return rd
            rd = i
            return i
    return -1

def drain():
    global rd
    out = []
    while True:
        i = nxt()
        if i < 0: return out
        out.append(ring[i + 2]); ring[i] = 0; rd = (rd + 4) % N

def put(d1):
    r = a.inject(ring, ctl, bytes([0x09, 0x90, d1, 127]))
    assert r == 'OK', r

res = {}
# A reader that keeps up: one packet, one drain.
for d1 in (1, 2): put(d1)
res['warm'] = drain()
# A reader that falls behind mid-gesture: two packets drained, then a burst.
put(10); put(11)
first = drain()
for d1 in (20, 21, 22, 23, 24): put(d1)
res['behind'] = first + drain()
print(json.dumps(res))
`;

const res = JSON.parse(execFileSync('python3', ['-c', py, agent], { encoding: 'utf8' }));
ok('a reader that keeps up sees the packets in order',
    JSON.stringify(res.warm) === '[1,2]', JSON.stringify(res.warm));
ok('a reader that fell behind still sees the gesture in the order it was sent',
    JSON.stringify(res.behind) === '[10,11,20,21,22,23,24]', JSON.stringify(res.behind));

if (fails) { console.log(`\n${fails} ui-ring check(s) failed`); process.exit(1); }
console.log('\nui-ring: all checks passed');
