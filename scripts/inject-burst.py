#!/usr/bin/env python3
"""inject-burst.py — inject a burst of CCs in ONE ssh round-trip.

schwung-midi-inject-ui.py opens a fresh ssh connection per event (~500 ms), so
it cannot produce the sub-100 ms detent spacing that gesture timing depends on
(one-shot trigger latching, wide-range knob acceleration). This runs the whole
burst inside a single remote python process with a real sleep between events.

Usage: inject-burst.py <host> <cc> <val> <count> [gap_ms]
  e.g. inject-burst.py move.local 78 1 6 20    # six +1 detents, 20 ms apart
"""
import sys
import subprocess

def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)
    host, cc, val, count = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    gap_ms = int(sys.argv[5]) if len(sys.argv) > 5 else 20

    script = f"""
import mmap, time

MIDI_BUFFER_SIZE = 256
STATUS, D1, D2, HEAD = 0xB0, {cc}, {val}, 0x0B

midi = open('/dev/shm/schwung-ui-midi', 'r+b')
mmid = mmap.mmap(midi.fileno(), MIDI_BUFFER_SIZE)
ctl = open('/dev/shm/schwung-control', 'r+b')
mmc = mmap.mmap(ctl.fileno(), 72)

sent = 0
for i in range({count}):
    for slot in range(0, MIDI_BUFFER_SIZE, 4):
        if mmid[slot] == 0:
            mmid[slot+1] = STATUS
            mmid[slot+2] = D1
            mmid[slot+3] = D2
            mmid[slot]   = HEAD
            sent += 1
            break
    else:
        print('ERROR: ring full at event ' + str(i))
        break
    mmc[3] = (mmc[3] + 1) % 256
    time.sleep({gap_ms} / 1000.0)

print('injected ' + str(sent) + ' event(s)')
mmid.close(); mmc.close()
"""
    r = subprocess.run(['ssh', f'ableton@{host}', 'python3'],
                       input=script, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print('STDERR:', r.stderr.strip(), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
