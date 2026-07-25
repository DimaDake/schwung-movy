#!/usr/bin/env python3
"""Inject USB-MIDI packets into Move firmware's MIDI_IN (runs ON the device).

Mirrors shadow_midi_inject_push() from schwung's shadow_midi_inject_writer.h:
a Vyukov bounded MPSC ring at /dev/shm/schwung-midi-inject —

    offset 0   uint32 enqueue_pos      producer claim cursor (monotonic)
    offset 4   uint32 read_pos         consumer cursor
    offset 8   slots[64]               { uint32 seq; uint8 pkt[4] }  (8 bytes each)

A slot is claimable when its seq equals the claim position; publishing stores
seq = pos + 1. Python has no CAS, so this assumes it is the only userspace
producer at the moment it runs — fine for a test harness, not for the shim.

Usage: inject-to-move.py <cin> <status> <d1> <d2> [...]
   e.g. inject-to-move.py 11 176 79 5     # CC 79, +5 detents, cable 0
"""
import sys, mmap, struct

SLOTS, MASK, SLOT_SZ, SLOTS_OFF = 64, 63, 8, 8

def push(mm, pkt):
    pos = struct.unpack_from('<I', mm, 0)[0]
    off = SLOTS_OFF + (pos & MASK) * SLOT_SZ
    seq = struct.unpack_from('<I', mm, off)[0]
    if seq != pos:
        return False                      # slot not free — ring full or contended
    struct.pack_into('<I', mm, 0, (pos + 1) & 0xFFFFFFFF)
    mm[off + 4:off + 8] = bytes(pkt)
    struct.pack_into('<I', mm, off, (pos + 1) & 0xFFFFFFFF)
    return True

def main():
    vals = [int(x) for x in sys.argv[1:]]
    with open('/dev/shm/schwung-midi-inject', 'r+b') as f:
        mm = mmap.mmap(f.fileno(), 0)
        sent = sum(1 for i in range(0, len(vals), 4) if push(mm, vals[i:i + 4]))
        mm.close()
    print('injected %d packet(s)' % sent)

main()
