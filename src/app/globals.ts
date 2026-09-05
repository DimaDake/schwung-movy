/*
 * THE DECLARED-DRUM READER, REGISTERED ONCE AT START-UP.
 *
 * `model/` imports nothing from `renderer/`, so the dependency is pushed the
 * other way: the renderer's reader is handed to the model here, and the model
 * asks through a hook. With the grid switched off `surfaceOf` is the `.off`
 * stand-in and answers "has not said" for everything, so every module falls
 * back to movy's own table exactly as before — the registration costs nothing
 * and needs no flag of its own.
 */
import { setSurfaceReader } from '../model/drum-declared.js';
import { surfaceOf } from '../renderer/schwung-voices.js';
setSurfaceReader(surfaceOf);

import { init } from './init.js';
import { tick } from './tick.js';
import { onMidiMessageInternal } from '../midi/router.js';
import { onResume } from './resume.js';
import { onUnload } from './unload.js';

Object.assign(globalThis, { init, tick, onMidiMessageInternal, onResume, onUnload });
