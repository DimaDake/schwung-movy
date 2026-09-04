#!/usr/bin/env python3
"""Play a control-surface sequence into the shadow-UI MIDI stream, notes included.

inject-ui.py hardcodes 0xB0, so it can only send CONTROL CHANGES. A knob TOUCH on
Move is a note-on, which means every probe built on it turns a knob that no hand
is on -- and on a param page that is a different gesture entirely: no held-param
readout, no peek, and a different branch of the router. A knob-speed
investigation ran on it and measured the wrong thing twice.

Usage: inject-any.py <token> [...]
  b0:d1:d2    control change (jog click 3, jog turn 14, knobs 71-78)
  90:d1:d2    note on   (knob touch: d1 = knob index 0-7, d2 = 127)
  80:d1:d2    note off  (knob release)
  sleep:ms    pause
"""
import sys, mmap, time

def send(status, d1, d2):
    with open('/dev/shm/schwung-ui-midi', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 256)
        for slot in range(0, 256, 4):
            if mm[slot] == 0:
                mm[slot + 1], mm[slot + 2], mm[slot + 3] = status, d1, d2
                mm[slot] = 0x0B
                break
        mm.close()
    with open('/dev/shm/schwung-control', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 72)
        mm[3] = (mm[3] + 1) % 256
        mm.close()
    time.sleep(0.04)

for tok in sys.argv[1:]:
    parts = tok.split(':')
    if parts[0] == 'sleep':
        time.sleep(int(parts[1]) / 1000.0)
    else:
        send(int(parts[0], 16), int(parts[1]), int(parts[2]))
