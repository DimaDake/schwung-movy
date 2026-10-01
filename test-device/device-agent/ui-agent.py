#!/usr/bin/env python3
"""movy device test agent — UI MIDI injection and control-flag writes.

Why this exists: schwung-testd's INJECT_MIDI writes /schwung-midi-inject, the
shim's ring into Move's MIDI_IN. An overtake module's UI is driven from a
DIFFERENT ring, /dev/shm/schwung-ui-midi, which shadow_ui.c drains into
onMidiMessageInternal. Injected packets on the shim's ring never reach movy —
measured on device 2026-09-11. So the framework needs its own writer for the UI
ring, and this is it.

One persistent TCP connection replaces one ssh per gesture (~500 ms each), which
is the whole reason the bash suites were slow.

Protocol (line-based ASCII, mirroring schwung-testd so the client is uniform):
  PING             -> OK movy-ui-agent 1
  UI <8 hex>       -> OK          one USB-MIDI packet into the UI ring
  FLAG <n>         -> OK          shadow_control_t byte 7 |= n (UI flags)
  QUIT             -> OK bye
"""
import socket
import mmap
import sys
import time

UI_MIDI = '/dev/shm/schwung-ui-midi'
CONTROL = '/dev/shm/schwung-control'
# shadow_constants.h: SHADOW_UI_MIDI_BYTES. Slots are 4 bytes each.
UI_MIDI_BYTES = 1024
OFF_MIDI_READY = 3      # shmconfig.go: offMidiReady
OFF_UI_FLAGS = 7        # shmconfig.go: offUIFlags


# The ring's producer cursor. Since schwung 1dfd31f5 (v1.5.0, src/host/
# ui_midi_ring.h) shadow_ui reads the segment as a RING from its own cursor, not
# lowest-index-first, so a producer must write CONTIGUOUSLY from a cursor of its
# own. Filling the lowest free slot, as this agent used to, put a gesture's
# first packets ahead of the reader and the rest behind it whenever shadow_ui
# was a few packets late (a ~230 ms param claim wedge is enough): it read
# "pad off, Right, pad on" and only then, one lap later, "Rec on" — a Rec hold
# that never landed, at random, on every multi-press seq gesture.
wr = 0
# How long to wait for the reader to free the slot at the cursor. Never skip
# ahead instead: a packet written past an unread one is read before it.
FULL_WAIT_S = 1.0


def inject(mm_midi, mm_ctl, pkt):
    """Publish at the cursor. head is written LAST: shadow_ui treats a non-zero
    head as 'slot ready', so writing it first would let the reader see the
    previous occupant's status/d1/d2."""
    global wr
    deadline = time.monotonic() + FULL_WAIT_S
    while mm_midi[wr] != 0:
        if time.monotonic() > deadline:
            return 'ERR ui ring full at the cursor (shadow_ui not draining?)'
        time.sleep(0.001)
    mm_midi[wr + 1] = pkt[1]
    mm_midi[wr + 2] = pkt[2]
    mm_midi[wr + 3] = pkt[3]
    mm_midi[wr] = pkt[0]
    wr = (wr + 4) % UI_MIDI_BYTES
    # midi_ready is a counter, not a boolean: the shim notices the change.
    mm_ctl[OFF_MIDI_READY] = (mm_ctl[OFF_MIDI_READY] + 1) % 256
    return 'OK'


def handle(line, mm_midi, mm_ctl):
    parts = line.split()
    if not parts:
        return 'ERR empty'
    cmd = parts[0].upper()
    if cmd == 'PING':
        return 'OK movy-ui-agent 1'
    if cmd == 'UI':
        if len(parts) != 2 or len(parts[1]) != 8:
            return 'ERR UI expects 8 hex chars'
        try:
            pkt = bytes.fromhex(parts[1])
        except ValueError:
            return 'ERR UI bad hex'
        return inject(mm_midi, mm_ctl, pkt)
    if cmd == 'FLAG':
        if len(parts) != 2:
            return 'ERR FLAG expects <n>'
        try:
            n = int(parts[1], 0) & 0xFF
        except ValueError:
            return 'ERR FLAG bad number'
        mm_ctl[OFF_UI_FLAGS] = mm_ctl[OFF_UI_FLAGS] | n
        return 'OK'
    if cmd == 'QUIT':
        return 'OK bye'
    return 'ERR unknown command'


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 47778
    fm = open(UI_MIDI, 'r+b')
    fc = open(CONTROL, 'r+b')
    mm_midi = mmap.mmap(fm.fileno(), UI_MIDI_BYTES)
    # Size 0 = map what is there. The segment is smaller than the declared
    # struct cap, and an explicit oversized length raises ValueError.
    mm_ctl = mmap.mmap(fc.fileno(), 0)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('0.0.0.0', port))
    srv.listen(1)
    sys.stdout.write('movy-ui-agent 1 listening on 0.0.0.0:%d\n' % port)
    sys.stdout.flush()

    while True:
        conn, _ = srv.accept()
        buf = b''
        try:
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while b'\n' in buf:
                    raw, buf = buf.split(b'\n', 1)
                    line = raw.decode('ascii', 'replace').strip()
                    reply = handle(line, mm_midi, mm_ctl)
                    conn.sendall((reply + '\n').encode('ascii'))
                    if reply == 'OK bye':
                        raise StopIteration
        except StopIteration:
            pass
        except Exception as e:
            sys.stderr.write('agent: %s\n' % e)
        finally:
            conn.close()


if __name__ == '__main__':
    main()
