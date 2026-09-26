/* New with SP-58 — the master chain GRID draws Schwung's body, on hardware.
 *
 * Session mode shows the master chain: a slot grid (jog moves slots) and, one
 * click in, a slot's detail page. SP-52 delegated only the detail page, so on
 * the grid a SEND or MFX slot's knob body stayed movy's while its knobs already
 * wrote through Schwung's page — the labels were one page set and the edits
 * another. Reported from the device as "it only works once I drill in".
 *
 * Covered locally by app-loop's SP-58 block against a mock module. What only
 * the device can add is the real path: a real module in a real send bus, the
 * real Session latch, the real jog — and movy's own read-back of whose body
 * the frame drew (`lastParamBody`, through the probe), rather than a picture
 * that would have to re-encode both renderers to be told apart.
 *
 * Covers:
 *   M1  the page arm is on
 *   M2  Session latched onto the master chain grid, SEND 1 focused
 *   M3  the grid draws the send's body through Schwung
 *   M4  movy never drew its own body over a live Schwung page
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/master-chain.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAGE_MODE = 'page';
/* Note/Session. A tap latches Session from Track view and a second tap leaves. */
const SESSION_CC = 50;
/* The same module sends.ts loads: cheap, always installed. SEND 1 is master
 * slot 0 (MASTER_FX_SLOTS puts the sends first). */
const SEND_FX = 'freeverb';
const SEND_SLOT = 0;
const MAX_JOG = 10;

type PageAnswer = { module?: string; renderer?: string; body?: string; trips?: number;
                    last?: string; session?: boolean; masterDetail?: boolean;
                    masterSlot?: number };

scenario('master-chain', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* An ENGINE param write — the path sends.ts loads a bus through. */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };
    const page = async (): Promise<PageAnswer> => {
        try { return await probe.page(); } catch { return {}; }
    };
    /* In device FRAMES (~2.9 ms). Returns the last answer either way — the
     * checks say what is missing. */
    const pageUntil = async (what: string, ok: (p: PageAnswer) => boolean,
                             within = 1500): Promise<PageAnswer> => {
        try { return await until(t.bus, what, page, ok, { within, every: 150 }); }
        catch (e: any) { return (e?.last as PageAnswer) ?? {}; }
    };

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);

    const armed = await probe.setGridMode(PAGE_MODE) as { renderer?: string } | null;
    t.check('arm-page', 'the renderer reports the page arm',
        armed?.renderer === PAGE_MODE,
        { expected: `renderer=${PAGE_MODE}`, actual: `renderer=${armed?.renderer ?? '(none)'}` });

    await ep(`snd${SEND_SLOT}:module`, SEND_FX);

    /* Latch Session only if it is not already up — a tap toggles. */
    if (!(await page()).session) await dev.tap.cc(SESSION_CC);
    let p = await pageUntil('Session latched', (a) => a.session === true);
    for (let i = 0; i < MAX_JOG && p.session && p.masterSlot !== SEND_SLOT; i++) {
        await dev.tap.jogTurn(-1);
        p = await pageUntil('the jog moved a master slot',
            (a) => a.masterSlot !== p.masterSlot || a.masterSlot === SEND_SLOT, 600);
    }
    t.check('session-grid', 'Session is on the master chain grid with SEND 1 focused',
        p.session === true && p.masterDetail === false && p.masterSlot === SEND_SLOT,
        { expected: `session=true masterDetail=false masterSlot=${SEND_SLOT}`,
          actual: `session=${p.session} masterDetail=${p.masterDetail} masterSlot=${p.masterSlot}` });

    /* The body is whose the last param FRAME drew, so the wait is on the
     * send's own frame being the one on screen, not on a frame count. */
    const got = await pageUntil('the send slot drawn through Schwung',
        (a) => (a.module ?? '').toLowerCase().includes(SEND_FX) && a.body === 'schwung', 3000);
    t.note('grid', `module=${got.module} body=${got.body} trips=${got.trips} last=${got.last}`);
    t.check('grid-schwung-body', 'the master grid draws the send\'s body through Schwung',
        (got.module ?? '').toLowerCase().includes(SEND_FX) && got.body === 'schwung',
        { expected: `module~${SEND_FX} body=schwung`,
          actual: `module=${got.module ?? '(none)'} body=${got.body ?? '(none)'}` });
    t.check('no-movy-body', 'movy never drew its own body over a live Schwung page',
        got.trips === 0,
        { expected: 'trips=0', actual: `trips=${got.trips} last=${got.last ?? ''}` });

    /* Leave Session, empty the bus, drop the override — the next suite starts
     * where the fixture expects. */
    if ((await page()).session) await dev.tap.cc(SESSION_CC);
    await pageUntil('Session left', (a) => a.session === false, 700);
    await ep(`snd${SEND_SLOT}:module`, '');
    await probe.setGridMode(null);
});
