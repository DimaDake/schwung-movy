#!/usr/bin/env python3
"""Play a control-surface sequence into the shadow-UI MIDI stream, notes included.

inject-ui.py hardcodes 0xB0, so it can only send CONTROL CHANGES. A knob TOUCH on
Move is a note-on, which means every probe built on it turns a knob that no hand
is on -- and on a param page that is a different gesture entirely: no held-param
readout, no peek, and a different branch of the router. A knob-speed
investigation ran on it and measured the wrong thing twice.

CABLE 0 IS CORRECT, AND IT REACHES MOVY WHILE MOVY IS OVERTAKING. Measured on
device 2026-09-13 with framebuffer hashes, movy on the Settings page, the same
jog turn (CC 14, +1) injected twice with the screen confirmed static beforehand:
head 0x2B (cable 2) left the framebuffer byte-identical, head 0x0B (cable 0)
moved the selection. A deleted scratch script (inject-movy.py) claimed the
opposite in its docstring and sent cable 2; it is gone, and this note is here so
the claim cannot come back a third time.

Usage: inject-any.py <token> [...]
  b0:d1:d2    control change (jog click 3, jog turn 14, knobs 71-78)
  90:d1:d2    note on   (knob touch: d1 = knob index 0-7, d2 = 127)
  80:d1:d2    note off  (knob release)
  sleep:ms    pause
"""
import sys, mmap, time

# The head byte is (cable << 4) | CIN, and the CIN must match the STATUS. This
# used to be a hardcoded 0x0B for every message, so a note-on -- the whole
# reason this script exists over inject-ui.py -- went out labelled as a control
# change. Both are three-byte messages, so it survived on length alone.
CIN = {0xB0: 0x0B, 0x90: 0x09, 0x80: 0x08}

def send(status, d1, d2):
    placed = False
    with open('/dev/shm/schwung-ui-midi', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 256)
        for slot in range(0, 256, 4):
            if mm[slot] == 0:
                mm[slot + 1], mm[slot + 2], mm[slot + 3] = status, d1, d2
                mm[slot] = CIN[status]          # cable 0
                placed = True
                break
        mm.close()
    if not placed:
        # A full ring means the reader stopped draining. Saying so beats
        # returning success and letting the caller measure a gesture that was
        # never delivered.
        print('inject-any: ring full, nothing sent', file=sys.stderr)
        sys.exit(1)
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
