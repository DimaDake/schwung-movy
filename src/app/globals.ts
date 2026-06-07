import { init } from './init.js';
import { tick } from './tick.js';
import { onMidiMessageInternal } from '../midi/router.js';

Object.assign(globalThis, { init, tick, onMidiMessageInternal });
