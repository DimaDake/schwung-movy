/* The audition page (plans/2026-11-07-gen-audition-design.md, "Pick, not
 * grade"): every case is a choice between options heard one after another,
 * an option set's or an A/B against a real part. Logic lives in core.mjs. */
import { caseMidi, cycleAt, earVsBench, markAt, nextIndex, pickDoc, REASONS, schedule, scheduleCycle, segOf, TRACKS, tracksFor } from './core.mjs';
import { mixer } from './mixer.mjs';
import { makePlayer } from './player.mjs';
import { makeRoll } from './roll.mjs';
import { makeStore } from './store.mjs';
import { makeSynth } from './synth.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, props) => Object.assign(document.createElement(tag), props);
const st = { manifest: null, queue: [], loaded: 0, idx: 0, opt: 0, base: 0, cycle: true, marks: [], muted: new Set(), solo: null, bpm: 120, reasons: new Set() };
let store, downloads = null;

const roll = makeRoll($('roll'));
const player = makePlayer(makeSynth, onFrame);
const cur = () => st.queue[st.idx];
const isAB = (c) => c.kind === 'ab';
const label = (c, o) => (isAB(c) ? 'AB'[o] : String(o + 1));
const answer = () => (cur() ? store.answerOf(cur()) : null);
const isDone = (c) => store.done.has(c.id) || !!store.answerOf(c);
const undone = { has: (id) => isDone(st.queue.find((x) => x.id === id)) };

async function loadMore() {
    if (st.loaded >= st.manifest.files.length) return false;
    st.queue.push(...await (await fetch(st.manifest.files[st.loaded++])).json());
    return true;
}

function playState() {
    const c = cur(), base = st.base;
    const plan = st.cycle ? (f, t, s) => scheduleCycle(c, base, f, t, s.bpm, s.muted, s.solo)
        : (f, t, s) => schedule(tracksFor(c, base), c.scene.len, f, t, s.bpm, s.muted, s.solo);
    return { plan, bpm: st.bpm, muted: st.muted, solo: st.solo, target: c.target };
}
function play() { player.start(playState()); $('play').textContent = 'Stop'; }
function restart() { if (player.playing) play(); }
function drawRoll() { const c = cur(); roll.draw({ tracks: tracksFor(c, st.opt), len: c.scene.len, target: c.target, marks: st.marks, muted: st.muted }); }

/* While cycling, the lit option follows the music; the playhead wraps at the segment. */
function onFrame(beat) {
    const c = cur();
    if (beat === null || !c) return roll.frame(null);
    if (st.cycle) {
        const seg = segOf(c.scene.len), o = cycleAt(beat, seg, c.options.length, st.base);
        if (o !== st.opt) { st.opt = o; showOptions(); drawRoll(); }
        return roll.frame(beat % seg);
    }
    roll.frame(beat);
}

async function showCase() {
    /* Skipping fast can pass the cases loaded so far: fetch on until one is there. */
    while (!cur() && await loadMore());
    const c = cur();
    if (!c) { player.stop(); $('ask').textContent = 'All cases answered. Thank you.'; $('answers').replaceChildren(); return; }
    const a = answer();
    st.opt = a?.option ?? 0; st.cycle = !a; st.base = st.opt;
    st.marks = a?.marks ? [...a.marks] : []; st.reasons = new Set(a?.reasons ?? []);
    st.muted = new Set(); st.solo = null; st.bpm = c.scene.bpm || 120;
    $('tempo').value = st.bpm; $('bpm').textContent = `${st.bpm} BPM`;
    $('kind').textContent = isAB(c) ? 'A/B' : c.generator.replace(':', ' · ');
    $('pair').hidden = !c.pair; $('pair').textContent = 'After fix';
    $('info').textContent = `${c.scene.key} · ${c.scene.len / 4} bars · case ${st.idx + 1}`;
    $('ask').replaceChildren('Which ', el('b', { textContent: c.target }), isAB(c) ? ' would you keep in this song?' : ' would you keep?');
    $('chips').replaceChildren(...TRACKS.map((t) => {
        const b = el('button', { className: 'chip' + (t === c.target ? ' target' : ''), textContent: t });
        b.setAttribute('aria-pressed', 'false');
        b.onclick = () => { st.muted.has(t) ? st.muted.delete(t) : st.muted.add(t); b.setAttribute('aria-pressed', String(st.muted.has(t))); player.set({ muted: st.muted }); drawRoll(); };
        return b;
    }));
    showOptions(); showAnswer(); progress(); drawRoll();
    if (st.queue.length - st.idx < 10) loadMore();
}

function showOptions() {
    const c = cur();
    $('options').replaceChildren(...c.options.map((_, o) => {
        const b = el('button', { className: 'opt', textContent: label(c, o) });
        b.setAttribute('aria-current', String(o === st.opt));
        b.onclick = () => { st.opt = o; st.cycle = false; st.base = o; showOptions(); drawRoll(); restart(); };
        return b;
    }), (() => {
        const b = el('button', { className: 'opt cycle', textContent: st.cycle ? '↻ Cycling' : '↻ Cycle' });
        b.setAttribute('aria-pressed', String(st.cycle));
        b.onclick = () => { st.cycle = true; st.base = st.opt; showOptions(); restart(); };
        return b;
    })());
    const keep = $('answers').querySelector('[data-v="pick"]');
    if (keep && !isAB(c)) keep.textContent = `Keep ${st.opt + 1}`;
}

/* An option set: keep the one lit, none, or all alike. An A/B: A, B, both, neither. */
function showAnswer() {
    const c = cur(), a = answer();
    const btns = isAB(c) ? [['pick', 0, 'A', 'pick'], ['pick', 1, 'B', 'pick'], ['both', null, 'Both fine', 'keep'], ['neither', null, 'Neither', 'bad']]
        : [['pick', -1, `Keep ${st.opt + 1}`, 'keep'], ['alike', null, 'All alike', 'meh'], ['none', null, 'None', 'bad']];
    $('answers').style.gridTemplateColumns = `repeat(${btns.length}, 1fr)`;
    $('answers').replaceChildren(...btns.map(([v, o, text, cls]) => {
        const b = el('button', { className: `pad ${cls}`, textContent: text });
        b.dataset.v = v;
        b.setAttribute('aria-pressed', String(!!a && a.verdict === v && (o === null || o === -1 || a.option === o)));
        b.onclick = () => save(v, o === -1 ? st.opt : o);
        return b;
    }));
    const bad = a && ['none', 'neither'].includes(a.verdict);
    $('why').hidden = !bad;
    $('whyChips').replaceChildren(...(bad ? REASONS : []).map((r) => {
        const b = el('button', { className: 'reason', textContent: r });
        b.setAttribute('aria-pressed', String(st.reasons.has(r)));
        b.onclick = () => { st.reasons.has(r) ? st.reasons.delete(r) : st.reasons.add(r); resave(); showAnswer(); };
        return b;
    }));
    $('next').hidden = !a;
    showReveal(a);
}

function showReveal(a) {
    const c = cur(), box = $('reveal');
    box.hidden = !a;
    if (!a) return;
    const line = (text, cls) => el('span', { textContent: text, className: cls ?? '' });
    const who = (o) => (o.truth === 'real' ? `real, from ${c.refKind === 'user' ? 'a scene of yours' : 'a public scene'}` : `${o.preset}${o.knobs?.length ? ` (knobs ${o.knobs.join(' ')})` : ''}`);
    const rows = c.options.map((o, k) => line(`${label(c, k)}: ${who(o)} · bench ${o.bench.ok ? 'usable' : `not usable (${o.bench.bad.join(', ')})`}`, 'data'));
    const picked = a.verdict === 'pick' ? c.options[a.option] : null;
    const diff = picked ? earVsBench(picked.bench, 'keep') : null;
    const passed = ['none', 'neither'].includes(a.verdict) ? c.options.filter((o) => o.truth !== 'real' && o.bench.ok).length : 0;
    box.replaceChildren(...rows,
        ...(diff ? [line('Your ear and the bench disagree: the bench failed the one you kept.', 'disagree')] : []),
        ...(passed ? [line(`Your ear and the bench disagree: the bench passed ${passed} of these.`, 'disagree')] : []));
}

function progress() { $('progress').textContent = `${store.count()} answered · ${st.manifest.counts.queued} cases`; }

function save(verdict, option) {
    if (!['none', 'neither'].includes(verdict)) st.reasons.clear();
    store.rate(pickDoc(cur(), verdict, option, [...st.reasons], st.marks));
    store.finish(cur().id);
    showAnswer(); progress();
}
/* Marks and reasons added after the answer ride on the same document. */
function resave() {
    const a = answer();
    if (a && JSON.stringify([a.marks, a.reasons]) !== JSON.stringify([st.marks, [...st.reasons]])) store.rate(pickDoc(cur(), a.verdict, a.option, [...st.reasons], st.marks));
}

async function next() {
    resave();
    st.idx = nextIndex(st.queue, undone, st.idx + 1);
    await showCase(); restart();
}

function wire() {
    mixer($('faders'), player);
    $('play').onclick = () => { if (player.playing) { player.stop(); $('play').textContent = 'Play'; } else play(); };
    const solo = (on) => { st.solo = on ? cur().target : null; $('solo').classList.toggle('on', on); player.set({ solo: st.solo }); };
    $('solo').onpointerdown = (e) => { e.preventDefault(); solo(true); };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('solo').addEventListener(ev, () => solo(false));
    $('tempo').oninput = () => { st.bpm = Number($('tempo').value); $('bpm').textContent = `${st.bpm} BPM`; player.set({ bpm: st.bpm }); };
    $('roll').onclick = (e) => {
        const box = $('roll').getBoundingClientRect(), m = markAt((e.clientX - box.left) / box.width, cur().scene);
        const at = st.marks.findIndex((x) => x.bar === m.bar && x.beat === m.beat);
        if (at >= 0) st.marks.splice(at, 1); else st.marks.push(m);
        drawRoll();
    };
    $('next').onclick = next;
    $('skip').onclick = async () => { st.idx = Math.min(st.queue.length, st.idx + 1); await showCase(); restart(); };
    $('midi').onclick = async () => {
        try { await downloads.save({ filename: `audition-${cur().id}-${label(cur(), st.opt)}.mid`, data: caseMidi(cur(), st.opt) }); } catch { /* declined */ }
    };
    window.addEventListener('resize', () => cur() && drawRoll());
}

const STATUS = { connecting: 'Connecting…', saved: 'Answers saved.', local: 'Answers kept on this phone only (no database here).',
    offline: 'Not saving yet: answers kept on this phone', refused: 'Saving was refused: answers kept on this phone' };

async function boot() {
    st.manifest = await (await fetch('manifest.json')).json();
    store = makeStore(st.manifest.build, ({ state, waiting }) => {
        $('status').dataset.s = state;
        $('status').textContent = STATUS[state] + (waiting && state !== 'saved' ? ` (${waiting} waiting).` : state === 'offline' || state === 'refused' ? '.' : '');
    });
    await loadMore();
    await store.ready;
    while (nextIndex(st.queue, undone, 0) >= st.queue.length && await loadMore());
    st.idx = nextIndex(st.queue, undone, 0);
    wire();
    $('loadInfo').textContent = `${st.manifest.counts.queued} cases · ${store.count()} answered so far`;
    $('go').disabled = false;
    $('go').onclick = async () => { player.unlock(); $('start').hidden = true; await showCase(); if (cur()) play(); };
    downloads = (await window.claude?.use?.('downloads').catch(() => null)) ?? null;
    $('midi').hidden = !downloads;
}

boot().catch((e) => { $('loadInfo').textContent = `Could not load the cases: ${e.message}. Reload the page to try again.`; });
