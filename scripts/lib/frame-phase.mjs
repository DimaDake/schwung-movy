#!/usr/bin/env node
// frame-phase.mjs — where does every thread run INSIDE the audio frame?
//
// Input: a raw ftrace `sched_switch` capture (see measure-frame-phase.sh).
// Output: per-core occupancy binned by phase offset from the moment the
// `Audio Main/SPI` thread returns from the SPI ioctl.
//
// Why that reference point: schwung's callback is
// pre_transfer -> ioctl(blocks) -> post_transfer, and movy's render_block runs
// inside post_transfer. So the SPI thread's switch-IN is the ioctl returning,
// which is the start of movy's render window. Phase 0 in every table below is
// "movy starts rendering"; the question the tables answer is how many cores are
// actually free at that instant and for how long.
//
// Usage: node frame-phase.mjs <trace-file> [--buckets us] [--span us]

import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const BUCKET = opt('buckets', 50); // us per phase bucket
const SPAN = opt('span', 3000); // us of frame to chart
const NCPU = 4;

// comm may contain spaces ("Audio Main/SPI", "irq/28-DMA IRQ"), so both comm
// captures are non-greedy up to the following fixed key.
const RE =
  /\[(\d+)\]\s+\S+\s+(\d+\.\d+): sched_switch: prev_comm=(.*?) prev_pid=(\d+) prev_prio=(\d+) prev_state=(\S+) ==> next_comm=(.*?) next_pid=(\d+) next_prio=(\d+)/;

const lines = fs.readFileSync(file, 'utf8').split('\n');
const cur = new Array(NCPU).fill(null); // {pid, comm, prio, start}
const spans = []; // {cpu, pid, comm, prio, t0, t1}
const spiIn = []; // ioctl-return timestamps
let t0 = null;
let tEnd = null;
let events = 0;
// The SPI thread blocks TWICE per frame, and the two blocks mean different
// things. Read off the trace, one frame looks like:
//
//   t+0      switch IN                       <- audio callback starts
//   t+21     switch OUT prev_state=D         <- submitted the SPI transfer, DMA wait
//   t+421    switch IN                       <- ioctl returned: POST begins (movy renders here)
//   t+1136   switch OUT prev_state=S         <- callback done, sleeps to the next tick
//   t+2896   switch IN                       <- next frame
//
// So phase 0 for this tool is the wake after the *D* block, not after S: that
// is the instant movy's render_block starts. Treating both wakes as frame
// starts reported 705 Hz against a true 345 Hz; treating every switch-in as one
// reported 1873 Hz, because the thread is also preempted mid-callback.
const spiEv = []; // {t, dir:'in'|'out', state, cpu}

for (const ln of lines) {
  const m = RE.exec(ln);
  if (!m) continue;
  events++;
  const cpu = +m[1];
  const t = parseFloat(m[2]) * 1e6; // us
  const prevComm = m[3];
  const prevPid = +m[4];
  const prevState = m[6];
  const nextComm = m[7];
  const nextPid = +m[8];
  const nextPrio = +m[9];
  if (t0 === null) t0 = t;
  tEnd = t;
  if (cpu >= NCPU) continue;

  const open = cur[cpu];
  // Close the interval the outgoing task was running. prev_pid disagreeing with
  // what we think is on the CPU means we joined mid-stream; drop it rather than
  // inventing a span.
  if (open && open.pid === prevPid) {
    spans.push({ cpu, pid: open.pid, comm: open.comm, prio: open.prio, t0: open.start, t1: t });
  }
  cur[cpu] = { pid: nextPid, comm: nextComm, prio: nextPrio, start: t };

  if (prevComm === 'Audio Main/SPI') spiEv.push({ t, dir: 'out', state: prevState[0], cpu });
  if (nextComm === 'Audio Main/SPI') spiEv.push({ t, dir: 'in', state: '', cpu });
}

// Walk the SPI thread's own timeline to recover the three phases of each frame.
const preDur = [];
const ioctlWait = [];
const postWall = [];
const postCpu = [];
{
  let lastOut = null; // state of the most recent switch-out
  let preStart = null;
  let ioctlStart = null;
  let postStart = null;
  let onCpu = null;
  let cpuSum = 0;
  for (const e of spiEv) {
    if (e.dir === 'in') {
      onCpu = e.t;
      if (lastOut === 'S' || lastOut === null) preStart = e.t;
      else if (lastOut === 'D' && ioctlStart !== null) {
        postStart = e.t;
        cpuSum = 0;
        ioctlWait.push(e.t - ioctlStart);
        spiIn.push(e.t); // phase 0 = ioctl return
      }
    } else {
      if (onCpu !== null) cpuSum += e.t - onCpu;
      onCpu = null;
      if (e.state === 'D' && preStart !== null) {
        preDur.push(e.t - preStart);
        ioctlStart = e.t;
        preStart = null;
      } else if (e.state === 'S' && postStart !== null) {
        postWall.push(e.t - postStart);
        postCpu.push(cpuSum);
        postStart = null;
      }
      lastOut = e.state;
    }
  }
}

if (spiIn.length < 10) {
  console.error(`only ${spiIn.length} Audio Main/SPI switch-ins — is MoveOriginal running?`);
  process.exit(1);
}

const dur = (tEnd - t0) / 1e6;
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// Frame k = [spiIn[k], spiIn[k+1]). Drop the tail frame (no closing bound).
const periods = [];
for (let i = 1; i < spiIn.length; i++) periods.push(spiIn[i] - spiIn[i - 1]);
const medPeriod = pct(periods, 50);
// A frame the capture only half-saw, or one where the SPI thread was preempted
// and re-scheduled (two switch-ins inside one frame), would skew every bucket.
// Keep frames within 25% of the median period.
const frames = [];
for (let i = 0; i + 1 < spiIn.length; i++) {
  const p = spiIn[i + 1] - spiIn[i];
  if (p > medPeriod * 0.75 && p < medPeriod * 1.25) frames.push(spiIn[i]);
}

const isIdle = (c) => c.startsWith('swapper/');
const nBuckets = Math.ceil(SPAN / BUCKET);
// busy[cpu][bucket] = us of non-idle occupancy summed over frames
const mk = () => Array.from({ length: NCPU }, () => new Float64Array(nBuckets));
const busyAny = mk();
const busyWorker = mk(); // Ableton's own "Audio Worker" pool
const busyRt = mk(); // any SCHED_FIFO/RR task (kernel prio < 100)

// Accumulate one span into the phase histogram of every frame it overlaps.
// Spans are wall-clock intervals; a span crossing a frame boundary contributes
// to both frames, which is correct — each frame really did see that core busy.
const byStart = [...spans].sort((a, b) => a.t0 - b.t0);

let cursor = 0;
for (const f of frames) {
  const fEnd = f + SPAN;
  // advance a window over spans overlapping [f, fEnd)
  while (cursor > 0 && byStart[cursor - 1].t1 > f) cursor--;
  while (cursor < byStart.length && byStart[cursor].t1 <= f) cursor++;
  for (let i = cursor; i < byStart.length && byStart[i].t0 < fEnd; i++) {
    const s = byStart[i];
    if (isIdle(s.comm)) continue;
    const a = Math.max(s.t0, f);
    const b = Math.min(s.t1, fEnd);
    if (b <= a) continue;
    const b0 = Math.floor((a - f) / BUCKET);
    const b1 = Math.min(nBuckets - 1, Math.floor((b - f - 1e-9) / BUCKET));
    for (let k = b0; k <= b1; k++) {
      const lo = Math.max(a, f + k * BUCKET);
      const hi = Math.min(b, f + (k + 1) * BUCKET);
      const d = hi - lo;
      if (d <= 0) continue;
      busyAny[s.cpu][k] += d;
      if (s.comm === 'Audio Worker') busyWorker[s.cpu][k] += d;
      if (s.prio < 100) busyRt[s.cpu][k] += d;
    }
  }
}


const B = '\x1b[1m';
const R = '\x1b[0m';
const Y = '\x1b[1;33m';
console.log(`${B}=== frame phase ===${R}`);
console.log(
  `capture ${dur.toFixed(2)}s  ${events} switches  ${frames.length} clean frames ` +
    `(of ${spiIn.length} SPI wakes)`
);
console.log(
  `frame period  p50=${medPeriod.toFixed(0)}us  p95=${pct(periods, 95).toFixed(0)}us  ` +
    `=> ${(1e6 / medPeriod).toFixed(1)} Hz`
);
const ln = (name, arr, note) =>
  console.log(
    `${name.padEnd(13)}p50=${pct(arr, 50).toFixed(0).padStart(5)}us  ` +
      `p95=${pct(arr, 95).toFixed(0).padStart(5)}us  max=${(arr.length ? Math.max(...arr) : 0).toFixed(0).padStart(5)}us   ${note}`
  );
ln('pre', preDur, 'callback start -> SPI transfer submitted');
ln('ioctl wait', ioctlWait, 'DMA; the thread is OFF-cpu here');
ln('post wall', postWall, 'ioctl return -> callback end. MOVY RENDERS HERE');
ln('post on-cpu', postCpu, 'same stretch, preemption removed');

const nf = frames.length;
const bar = (frac) => {
  const n = Math.round(frac * 8);
  return '#'.repeat(Math.max(0, Math.min(8, n))).padEnd(8, '.');
};

console.log(`\n${B}per-core occupancy by phase (0 = ioctl returns = movy render starts)${R}`);
console.log(`${'phase(us)'.padEnd(12)}${['cpu0', 'cpu1', 'cpu2', 'cpu3'].map((c) => c.padEnd(11)).join('')}  free`);
for (let k = 0; k < nBuckets; k++) {
  const cells = [];
  let free = 0;
  for (let c = 0; c < NCPU; c++) {
    const frac = busyAny[c][k] / (nf * BUCKET);
    free += 1 - frac;
    cells.push(`${bar(frac)}${(frac * 100).toFixed(0).padStart(3)}`);
  }
  const lbl = `${k * BUCKET}-${(k + 1) * BUCKET}`;
  console.log(`${lbl.padEnd(12)}${cells.join('')}  ${free.toFixed(2)}`);
}

// The deciding number: how much genuinely free core time exists in the window
// where movy renders, and how much of the contention is RT (i.e. would preempt
// a SCHED_OTHER worker) versus normal priority (which a worker could outrun).
console.log(`\n${B}cumulative free core-us from phase 0${R}`);
console.log(`${'through(us)'.padEnd(12)}${'free core-us'.padEnd(14)}${'of which RT-blocked'.padEnd(20)}worker-blocked`);
let cumFree = 0;
let cumRt = 0;
let cumW = 0;
for (let k = 0; k < nBuckets; k++) {
  for (let c = 0; c < NCPU; c++) {
    cumFree += BUCKET - busyAny[c][k] / nf;
    cumRt += busyRt[c][k] / nf;
    cumW += busyWorker[c][k] / nf;
  }
  const through = (k + 1) * BUCKET;
  if (through % 250 === 0 || k === nBuckets - 1) {
    console.log(
      `${String(through).padEnd(12)}${cumFree.toFixed(0).padEnd(14)}${cumRt.toFixed(0).padEnd(20)}${cumW.toFixed(0)}`
    );
  }
}

// Ableton's worker pool: when does it start and stop, relative to phase 0?
const wStart = [];
const wEnd = [];
for (const f of frames) {
  let s = Infinity;
  let e = -Infinity;
  for (const sp of spans) {
    if (sp.comm !== 'Audio Worker') continue;
    if (sp.t1 <= f || sp.t0 >= f + SPAN) continue;
    s = Math.min(s, sp.t0 - f);
    e = Math.max(e, sp.t1 - f);
  }
  if (Number.isFinite(s)) {
    wStart.push(s);
    wEnd.push(e);
  }
}
if (wStart.length) {
  console.log(`\n${B}Ableton "Audio Worker" pool, relative to phase 0${R}`);
  console.log(
    `  first start  p50=${pct(wStart, 50).toFixed(0)}us   last end  p50=${pct(wEnd, 50).toFixed(0)}us  ` +
      `p95=${pct(wEnd, 95).toFixed(0)}us`
  );
  console.log(`  seen in ${wStart.length}/${nf} frames`);
}

console.log(
  `\n${Y}Read the "free" column at the phases where movy actually renders. RT-blocked` +
    `\ntime is the part a SCHED_OTHER worker cannot take by outrunning anyone —` +
    `\nit is occupied by SCHED_FIFO threads that preempt unconditionally.${R}`
);
