import { init } from './init.js';
import { tick } from './tick.js';
import { onMidiMessageInternal } from '../midi/router.js';
import { onResume } from './resume.js';
import { onUnload } from './unload.js';

Object.assign(globalThis, { init, tick, onMidiMessageInternal, onResume, onUnload });
