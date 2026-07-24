#!/usr/bin/env python3
"""inject-seq.py — inject a timed sequence of MIDI events into the shadow UI.

Runs ON the device (scp'd there by the test scripts). Unlike
schwung-midi-inject-ui.py — one event per SSH round trip, so a "press" is
always >500 ms and every button read as a HOLD — this takes a whole gesture
script and honours millisecond delays, which is the only way to inject a
short tap (track switch, Shift+key) or a realistic pad hit.

Usage:  python3 inject-seq.py '<json>'
        json = [{"type":"cc|note_on|note_off","d1":N,"d2":N,"wait":ms}, ...]
        "wait" is the delay AFTER the event (default 50 ms).
"""
import json
import mmap
import sys
import time

MIDI_BUFFER_SIZE = 256
# status byte + the "head" marker byte the shadow UI polls for (message-type
# nibble; a non-zero head is what makes the slot readable).
STATUS = {'cc': (0x0B, 0xB0), 'note_on': (0x09, 0x90), 'note_off': (0x08, 0x80)}


def inject(head, status, d1, d2):
    with open('/dev/shm/schwung-ui-midi', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), MIDI_BUFFER_SIZE)
        for slot in range(0, MIDI_BUFFER_SIZE, 4):
            if mm[slot] == 0:
                mm[slot + 1] = status
                mm[slot + 2] = d1
                mm[slot + 3] = d2
                mm[slot] = head
                break
        else:
            print('ERROR: no free slot in schwung-ui-midi', file=sys.stderr)
        mm.close()
    with open('/dev/shm/schwung-control', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 72)
        mm[3] = (mm[3] + 1) % 256
        mm.close()


def main():
    for ev in json.loads(sys.argv[1]):
        head, status = STATUS[ev['type']]
        inject(head, status, int(ev['d1']), int(ev.get('d2', 0)))
        time.sleep(ev.get('wait', 50) / 1000.0)


if __name__ == '__main__':
    main()
