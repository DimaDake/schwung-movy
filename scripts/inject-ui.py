#!/usr/bin/env python3
"""Play a control-surface sequence into the shadow-UI MIDI stream (runs ON the
device, so events land milliseconds apart — two SSH calls would be ~300 ms
apart, which is longer than some gesture windows).

Usage: inject-ui.py <token> [...]
  cc:val      control change (e.g. 88:127)
  sleep:ms    pause between events
"""
import sys, mmap, time

def send(d1, d2):
    with open('/dev/shm/schwung-ui-midi', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 256)
        for slot in range(0, 256, 4):
            if mm[slot] == 0:
                mm[slot + 1], mm[slot + 2], mm[slot + 3] = 0xB0, d1, d2
                mm[slot] = 0x0B
                break
        mm.close()
    with open('/dev/shm/schwung-control', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 72)
        mm[3] = (mm[3] + 1) % 256
        mm.close()
    time.sleep(0.08)

for tok in sys.argv[1:]:
    a, b = tok.split(':')
    if a == 'sleep': time.sleep(int(b) / 1000.0)
    else: send(int(a), int(b))
