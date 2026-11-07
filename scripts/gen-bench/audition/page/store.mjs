/* Where ratings go: the Artifact database when this view has one, and
 * always a copy on the phone first, so a refused or offline write is sent
 * on the next rating instead of being lost (Review Focus 4). */
import { drop, enqueue } from './core.mjs';

const OUTBOX = 'audition.outbox', DONE = 'audition.done';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: in memory only */ } };

export function makeStore(build, onStatus) {
    let db = null, outbox = load(OUTBOX, []), busy = false;
    const done = new Set(load(DONE, []));
    const ratings = new Map(outbox.map((d) => [d.id, d.data]));
    const status = (state) => onStatus({ state, waiting: outbox.length });

    async function flush() {
        if (!db) return status(outbox.length ? 'offline' : 'local');
        if (busy) return;
        busy = true;
        try {
            for (const d of [...outbox]) {
                await db.collection('ratings').doc(d.id).set(d.data);
                outbox = drop(outbox, d.id);
                keep(OUTBOX, outbox);
            }
            status('saved');
        } catch {
            status('refused');
        } finally { busy = false; }
    }

    const ready = (async () => {
        status('connecting');
        try { db = (await window.claude?.use?.('db')) ?? null; } catch { db = null; }
        if (db) {
            try {
                const snap = await db.collection('ratings').where('build', '==', build).limit(1000).get();
                for (const s of snap.docs) if (!ratings.has(s.id)) ratings.set(s.id, s.data());
                for (const r of ratings.values()) if (r.verdict || r.kind !== 'set') done.add(r.caseId);
            } catch { /* read refused: the phone's copy still resumes */ }
        }
        await flush();
    })();

    return {
        ready,
        rate(doc) { ratings.set(doc.id, doc.data); outbox = enqueue(outbox, doc); keep(OUTBOX, outbox); flush(); },
        finish(caseId) { done.add(caseId); keep(DONE, [...done]); },
        done,
        answerOf: (c) => ratings.get(`${c.id}~pick`) ?? null,
        count: () => ratings.size,
    };
}
