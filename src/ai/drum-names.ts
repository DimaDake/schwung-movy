/* Fallback drum voice names for a kit that declares none. Ableton's Drum Rack
 * and Move's kits follow the General MIDI drum map from 36 = kick (bottom-left
 * pad), so a GM name is the best guess; the prompt marks it as a guess. */

const GM: Record<number, string> = {
    35: 'KICK 2', 36: 'KICK', 37: 'RIM', 38: 'SNARE', 39: 'CLAP', 40: 'SNARE 2',
    41: 'LOW TOM', 42: 'CLOSED HAT', 43: 'LOW TOM 2', 44: 'PEDAL HAT', 45: 'MID TOM',
    46: 'OPEN HAT', 47: 'MID TOM 2', 48: 'HIGH TOM', 49: 'CRASH', 50: 'HIGH TOM 2',
    51: 'RIDE', 52: 'CHINA', 53: 'RIDE BELL', 54: 'TAMBOURINE', 55: 'SPLASH',
    56: 'COWBELL', 57: 'CRASH 2', 59: 'RIDE 2', 60: 'HIGH BONGO', 61: 'LOW BONGO',
    62: 'HIGH CONGA', 63: 'OPEN CONGA', 64: 'LOW CONGA', 69: 'CABASA', 70: 'MARACAS',
    75: 'CLAVES', 76: 'HIGH BLOCK', 77: 'LOW BLOCK',
};

/** `36:BD`, `42:CLOSED HAT (guessed)` or `71:pad (guessed)`. */
export function drumLabel(pitch: number, declared: Record<number, string> | null): string {
    const name = declared?.[pitch];
    if (name) return `${pitch}:${name}`;
    return `${pitch}:${GM[pitch] ?? 'pad'} (guessed)`;
}
