#!/usr/bin/env python3
# Runs ON the device (scripts/measure-link-cost.mjs copies it to /tmp): samples
# for N seconds what Link Audio costs and prints one JSON line.
#   cpu: per core busy %; movy: movy-host threads % of one core; link:
#   movy-link % of one core; net_kthreads: network IRQ threads + ksoftirqd;
#   ifaces: bytes/s out per interface; glitch: new glitch-log lines.
import json, os, sys, time

TCK = os.sysconf("SC_CLK_TCK")
GLITCH = "/data/UserData/schwung/movy-glitch.log"

def ticks(path):
    r = open(path).read()
    r = r[r.rfind(")") + 2:].split()
    return int(r[11]) + int(r[12])

def procs():
    out = {}
    for p in os.listdir("/proc"):
        if not p.isdigit():
            continue
        try:
            c = open(f"/proc/{p}/comm").read().strip()
            if c == "movy-host":
                for t in os.listdir(f"/proc/{p}/task"):
                    tc = open(f"/proc/{p}/task/{t}/comm").read().strip()
                    out[f"movy:{tc}#{t}"] = ticks(f"/proc/{p}/task/{t}/stat")
            elif c == "movy-link":
                out["link"] = out.get("link", 0) + ticks(f"/proc/{p}/stat")
                for t in os.listdir(f"/proc/{p}/task"):
                    tc = open(f"/proc/{p}/task/{t}/comm").read().strip()
                    out[f"lt:{tc}#{t}"] = ticks(f"/proc/{p}/task/{t}/stat")
            elif c.startswith("irq/") and any(k in c for k in ("iwlwif", "fe980000", "dwc2", "eth0")) or c.startswith("ksoftirqd"):
                out[f"net:{c}#{p}"] = ticks(f"/proc/{p}/stat")
        except OSError:
            pass
    return out

def cpus():
    out = {}
    for l in open("/proc/stat"):
        if l.startswith("cpu") and l[3].isdigit():
            v = list(map(int, l.split()[1:8]))
            out[l.split()[0]] = v
    return out

def ifaces():
    out = {}
    for l in open("/proc/net/dev").readlines()[2:]:
        name, rest = l.split(":", 1)
        out[name.strip()] = int(rest.split()[8])  # tx bytes
    return out

def glitches():
    try:
        d = open(GLITCH, "rb").read()
        return d.count(b"glitch frame"), d.count(b"late transfer")
    except OSError:
        return 0, 0

def snap():
    return time.monotonic(), procs(), cpus(), ifaces(), glitches()

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 30
t0, p0, c0, n0, g0 = snap()
time.sleep(secs)
t1, p1, c1, n1, g1 = snap()
dt = t1 - t0
pct = lambda k: 100.0 * (p1.get(k, 0) - p0.get(k, 0)) / TCK / dt
movy = {}
for k in p1:
    if k.startswith("movy:"):
        name = k[5:].split("#")[0]
        movy[name] = round(movy.get(name, 0) + pct(k), 2)
lt = {}
for k in p1:
    if k.startswith("lt:"):
        name = k[3:].split("#")[0]
        lt[name] = round(lt.get(name, 0) + pct(k), 2)
res = {
    "link_threads": lt,
    "secs": round(dt, 1),
    "link": round(pct("link"), 2),
    "net_kthreads": round(sum(pct(k) for k in p1 if k.startswith("net:")), 2),
    "movy": movy,
    "cpu": {c: round(100 * (1 - (c1[c][3] - c0[c][3] + c1[c][4] - c0[c][4]) / max(1, sum(c1[c]) - sum(c0[c]))), 1) for c in c1},
    "ifaces_kBps": {i: round((n1[i] - n0.get(i, 0)) / dt / 1024, 1) for i in n1 if n1[i] - n0.get(i, 0) > 1024},
    "glitch_frames": g1[0] - g0[0],
    "late_transfers": g1[1] - g0[1],
}
print(json.dumps(res))
