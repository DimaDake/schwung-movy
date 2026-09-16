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

EVERY BYTE IN A TOKEN IS HEX, INCLUDING d1 AND d2. The status byte always was,
and d1/d2 were read as DECIMAL -- so `b0:0e:01` (a jog detent, the token this
script's only caller has always sent) died on int('0e') and the caller saw a
failed inject rather than a wrong note. Measured 2026-09-16: the device copy
refused every token measure-grid-cost.sh sends, which is why its five sections
came back identical and the SP-13 device A/B had never delivered a gesture. A
token whose first field is hex and whose other two are not is a trap, not a
convention; the radix is now uniform and `--dry-run` lets a test prove it
without a device.

`sleep:ms` stays decimal -- it is a duration, not a byte.

Usage: inject-any.py [--dry-run] <token> [...]
  b0:d1:d2    control change (jog click 03, jog turn 0e, knobs 47-4e)
  90:d1:d2    note on   (knob touch: d1 = knob index 00-07, d2 = 7f)
  80:d1:d2    note off  (knob release)
  sleep:ms    pause, in DECIMAL milliseconds
  --dry-run   print the decoded bytes and touch no shared memory
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

ARGS = sys.argv[1:]
# --dry-run exists so the token grammar can be tested off device. Without it the
# only way to find out that a token does not parse is a failed run against real
# shared memory, which is how the radix bug survived: the caller logged "inject
# FAILED" and nobody asked which of ssh, python or the token was at fault.
DRY = bool(ARGS) and ARGS[0] == '--dry-run'
if DRY:
    ARGS = ARGS[1:]

for tok in ARGS:
    parts = tok.split(':')
    if parts[0] == 'sleep':
        if not DRY:
            time.sleep(int(parts[1]) / 1000.0)
    else:
        status, d1, d2 = (int(p, 16) for p in parts[:3])
        if DRY:
            print('%02x %02x %02x' % (status, d1, d2))
        else:
            send(status, d1, d2)
