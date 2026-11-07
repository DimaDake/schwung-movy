/* The audition page (plans/2026-11-07-gen-audition-design.md, The page):
 * the queue, the controls and the rating flow. Logic lives in core.mjs. */
import { caseMidi, earVsBench, markAt, nextIndex, ratingDoc, REASONS, TRACKS, tracksFor } from './core.mjs';
import { makePlayer } from './player.mjs';
import { makeRoll } from './roll.mjs';
import { makeStore } from './store.mjs';
import { makeSynth } from './synth.mjs';

const $ = (id) => document.getElementById(id);
const KIND = { set: 'Six options', flagged: 'Bench flagged', blind: 'Blind' };
const st = { manifest: null, queue: [], loaded: 0, idx: 0, opt: null, marks: [], muted: new Set(), solo: null, bpm: 120, reasons: new Set(), best: false };
let store, downloads = null;

const roll = makeRoll($('roll'));
const player = makePlayer(makeSynth, (beat) => roll.frame(beat));
const cur = () => st.queue[st.idx];
const rating = () => (cur() ? store.ratingOf(cur(), st.opt) : null);
const isDone = (c) => store.done.has(c.id) || (c.options && c.options.every((_, o) => store.ratingOf(c, o)));

async function loadMore() {
    if (st.loaded >= st.manifest.files.length) return false;
    const cs = await (await fetch(st.manifest.files[st.loaded++])).json();
    st.queue.push(...cs);
    return true;
}

function playState() {
    const c = cur();
    return { tracks: tracksFor(c, st.opt), len: c.scene.len, bpm: st.bpm, muted: st.muted, solo: st.solo, target: c.target };
}
function restart() { if (player.playing) player.start(playState()); }
function drawRoll() { const c = cur(); roll.draw({ tracks: tracksFor(c, st.opt), len: c.scene.len, target: c.target, marks: st.marks, muted: st.muted }); }

async function showCase() {
    /* Skipping fast can pass the cases loaded so far: fetch on until one is there. */
    while (!cur() && await loadMore());
    const c = cur();
    if (!c) { player.stop(); $('ask').textContent = 'All cases rated. Thank you.'; return; }
    st.opt = c.options ? Math.max(0, c.options.findIndex((_, o) => !store.ratingOf(c, o))) : null;
    st.muted = new Set(); st.solo = null; st.bpm = c.scene.bpm || 120;
    $('tempo').value = st.bpm;
    showOption();
    if (st.queue.length - st.idx < 10) loadMore();
}

function showOption() {
    const c = cur(), r = rating();
    st.marks = r?.marks ? [...r.marks] : [];
    st.reasons = new Set(r?.reasons?.filter((x) => x !== 'best') ?? []);
    st.best = r?.reasons?.includes('best') ?? false;
    $('kind').textContent = KIND[c.kind];
    $('pair').hidden = !c.pair;
    $('pair').textContent = c.pair === 'before' ? 'Before fix' : 'After fix';
    $('info').textContent = `${c.scene.key} · ${c.scene.len / 4} bars · case ${st.idx + 1}`;
    $('ask').innerHTML = '';
    $('ask').append('Rate the ', Object.assign(document.createElement('b'), { textContent: c.target }));
    $('bpm').textContent = `${st.bpm} BPM`;
    const opts = $('options');
    opts.hidden = !c.options;
    opts.replaceChildren(...(c.options ?? []).map((_, o) => {
        const b = Object.assign(document.createElement('button'), { className: 'opt', textContent: String(o + 1) });
        b.setAttribute('aria-current', String(o === st.opt));
        const or = store.ratingOf(c, o);
        if (or) b.dataset.r = or.rating;
        b.onclick = () => { st.opt = o; showOption(); restart(); };
        return b;
    }));
    $('chips').replaceChildren(...TRACKS.map((t) => {
        const b = Object.assign(document.createElement('button'), { className: 'chip' + (t === c.target ? ' target' : ''), textContent: t });
        b.setAttribute('aria-pressed', String(st.muted.has(t)));
        b.onclick = () => { st.muted.has(t) ? st.muted.delete(t) : st.muted.add(t); b.setAttribute('aria-pressed', String(st.muted.has(t))); player.set({ muted: st.muted }); drawRoll(); };
        return b;
    }));
    $('best').hidden = !c.options;
    $('best').textContent = st.best ? '★ Best of the six' : '☆ Best of the six';
    $('reasons').hidden = true;
    for (const k of ['keep', 'meh', 'bad']) $(k).setAttribute('aria-pressed', String(r?.rating === k));
    $('next').hidden = !r;
    $('next').textContent = c.options && c.options.some((_, o) => !store.ratingOf(c, o)) ? 'Next option' : 'Next case';
    showReveal(r);
    progress();
    drawRoll();
}

function showReveal(r) {
    const c = cur(), el = $('reveal');
    el.hidden = !r;
    if (!r) return;
    const o = st.opt === null ? null : c.options[st.opt];
    const knobs = (o ?? c).knobs;
    const who = c.kind === 'blind' && c.truth === 'real' ? `Real part, from a ${c.refKind === 'user' ? 'scene of yours' : 'public scene'}`
        : `Generated: ${o ? o.preset : c.generator}${knobs?.length ? ` · knobs ${knobs.join(' ')}` : ''}`;
    const bench = (o ?? c).bench;
    const diff = earVsBench(bench, r.rating);
    const line = (text, cls) => Object.assign(document.createElement('span'), { textContent: text, className: cls ?? '' });
    el.replaceChildren(line(who), line(bench.ok ? 'Bench: usable' : `Bench: not usable (${bench.bad.join(', ')})`, 'data'),
        ...(diff ? [line(diff === 'benchOkUserBad' ? 'Your ear and the bench disagree: the bench passed it.' : 'Your ear and the bench disagree: the bench failed it.', 'disagree')] : []));
}

function progress() {
    $('progress').textContent = `${store.count()} rated · ${st.manifest.counts.queued} cases`;
}

function save(value) {
    const c = cur();
    const reasons = value === 'bad' ? [...st.reasons] : [];
    if (st.best) reasons.push('best');
    store.rate(ratingDoc(c, st.opt, value, reasons, st.marks, value === 'bad' ? $('note').value.trim() : ''));
    $('note').value = '';
    if (!c.options) store.finish(c.id);
    showOption();
}

async function next() {
    const c = cur();
    const open = c.options ? c.options.findIndex((_, o) => !store.ratingOf(c, o)) : -1;
    if (open >= 0) { st.opt = open; showOption(); restart(); return; }
    store.finish(c.id);
    st.idx = nextIndex(st.queue, { has: (id) => isDone(st.queue.find((x) => x.id === id)) }, st.idx + 1);
    await showCase(); restart();
}

function wire() {
    $('play').onclick = () => { if (player.playing) { player.stop(); $('play').textContent = 'Play'; } else { player.start(playState()); $('play').textContent = 'Stop'; } };
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
    $('keep').onclick = () => save('keep');
    $('meh').onclick = () => save('meh');
    $('bad').onclick = () => { $('reasons').hidden = false; $('reasons').scrollIntoView({ block: 'nearest' }); };
    $('reasonChips').replaceChildren(...REASONS.map((r) => {
        const b = Object.assign(document.createElement('button'), { className: 'reason', textContent: r });
        b.onclick = () => { st.reasons.has(r) ? st.reasons.delete(r) : st.reasons.add(r); b.setAttribute('aria-pressed', String(st.reasons.has(r))); };
        return b;
    }));
    $('saveBad').onclick = () => save('bad');
    $('cancelBad').onclick = () => { $('reasons').hidden = true; };
    $('best').onclick = () => { st.best = !st.best; $('best').textContent = st.best ? '★ Best of the six' : '☆ Best of the six'; };
    $('next').onclick = next;
    $('skip').onclick = async () => { st.idx = Math.min(st.queue.length, st.idx + 1); await showCase(); restart(); };
    $('midi').onclick = async () => {
        try { await downloads.save({ filename: `audition-${cur().id}.mid`, data: caseMidi(cur(), st.opt) }); } catch { /* declined */ }
    };
    window.addEventListener('resize', () => cur() && drawRoll());
}

const STATUS = { connecting: 'Connecting…', saved: 'Ratings saved.', local: 'Ratings kept on this phone only (no database here).',
    offline: 'Not saving yet: ratings kept on this phone', refused: 'Saving was refused: ratings kept on this phone' };

async function boot() {
    st.manifest = await (await fetch('manifest.json')).json();
    store = makeStore(st.manifest.build, ({ state, waiting }) => {
        $('status').dataset.s = state;
        $('status').textContent = STATUS[state] + (waiting && state !== 'saved' ? ` (${waiting} waiting).` : state === 'offline' || state === 'refused' ? '.' : '');
    });
    await loadMore();
    await store.ready;
    while (nextIndex(st.queue, { has: (id) => isDone(st.queue.find((x) => x.id === id)) }, 0) >= st.queue.length && await loadMore());
    st.idx = nextIndex(st.queue, { has: (id) => isDone(st.queue.find((x) => x.id === id)) }, 0);
    wire();
    $('loadInfo').textContent = `${st.manifest.counts.queued} cases · ${store.count()} rated so far`;
    $('go').disabled = false;
    $('go').onclick = async () => { player.unlock(); $('start').hidden = true; await showCase(); if (cur()) { player.start(playState()); $('play').textContent = 'Stop'; } };
    downloads = (await window.claude?.use?.('downloads').catch(() => null)) ?? null;
    $('midi').hidden = !downloads;
}

boot().catch((e) => { $('loadInfo').textContent = `Could not load the cases: ${e.message}. Reload the page to try again.`; });
