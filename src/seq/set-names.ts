/* Names a renamed Set is offered when it still carries its dated default.
 *
 * Whole PAIRS, never an adjective list crossed with a noun list: a cross
 * product mints "Velvet Thunder" and "Hollow Lullaby" alongside the good ones,
 * and a name you have to reject is worse than the date it replaces. Every
 * entry here was chosen to read as one phrase, and to stay short enough to
 * fit a Sets row beside its clip count. */

import type { LibRow } from './sets-lib.js';

export const SET_NAME_PAIRS: readonly string[] = [
    'Velvet Echo', 'Midnight Chorus', 'Silver Cadence', 'Amber Drift', 'Paper Moon',
    'Hollow Reed', 'Golden Hour', 'Quiet Storm', 'Neon Rain', 'Glass Harmonica',
    'Distant Thunder', 'Slow Bloom', 'Low Tide', 'Morning Raga', 'Copper Bells',
    'Static Bloom', 'Winter Hymn', 'Ember Glow', 'Lunar Tide', 'Soft Static',
    'Blue Hour', 'Dust Choir', 'Night Shift', 'Silent Pulse', 'Iron Lullaby',
    'Willow Song', 'Salt Wind', 'First Light', 'Last Waltz', 'Open Fifths',
    'Broken Chord', 'Minor Key', 'Grace Note', 'Ghost Note', 'Blue Note',
    'Tape Hiss', 'Vinyl Crackle', 'Warm Fuzz', 'Deep Bass', 'Long Delay',
    'Spring Reverb', 'Analog Dream', 'Pocket Groove', 'Back Beat', 'Off Beat',
    'Half Time', 'Double Time', 'Swing Shift', 'Dark Matter', 'Star Dust',
    'Moon Dance', 'Sun Ritual', 'Rain Dance', 'Wave Form', 'Echo Chamber',
    'Night Train', 'Ghost Town', 'Paper Planes', 'Glass Garden', 'Crystal Cave',
    'Cloud Atlas', 'Fever Dream', 'Day Dream', 'Lucid Dream', 'Waking Life',
    'Northern Lights', 'Southern Cross', 'Eastern Wind', 'Western Sky', 'Polar Night',
    'Desert Rose', 'Ocean Floor', 'River Bend', 'Mountain Air', 'Forest Floor',
    'Autumn Leaves', 'Summer Haze', 'Winter Light', 'Spring Thaw', 'Harvest Moon',
    'Blood Orange', 'Indigo Child', 'Violet Hour', 'Emerald City',
    'Velvet Night', 'Silk Road', 'Cotton Clouds', 'Linen Sky',
    'Heart Beat', 'Slow Motion', 'Free Fall', 'Zero Gravity', 'High Tide',
    'Rising Sun', 'Falling Star', 'Shooting Star', 'Morning Star', 'Evening Star',
    'Dawn Chorus', 'Dusk Song', 'Twilight Zone', 'Night Owl', 'Early Bird',
    'Black Swan', 'White Noise', 'Pink Noise', 'Brown Noise', 'Red Shift',
    'Gold Rush', 'Silver Lining', 'Bronze Age', 'Stone Circle',
    'Tidal Wave', 'Sound Wave', 'Heat Wave', 'New Wave',
    'Cold Front', 'Warm Front', 'Still Life', 'Night Life', 'Wild Life',
    'Secret Garden', 'Hidden Track', 'Lost Chord', 'Found Sound', 'Field Recording',
    'Room Tone', 'Drone Field', 'Sub Harmonic', 'Over Tone', 'Under Current',
    'Cross Fade', 'Slow Fade', 'Hard Cut', 'Soft Focus', 'Sharp Edge',
    'Gentle Rain', 'Heavy Rain', 'Purple Rain', 'Summer Rain',
    'Snow Blind', 'Sun Drunk', 'Moon Struck', 'Star Crossed', 'Love Struck',
    'Paper Heart', 'Glass Heart', 'Stone Heart', 'Wild Heart', 'Open Heart',
    'Hollow Bones', 'Silver Bones', 'Glass Bones', 'Velvet Bones', 'Old Bones',
    'Sacred Geometry', 'Golden Ratio', 'Perfect Fourth', 'Tritone Blues', 'Major Seventh',
    'Modal Drift', 'Dorian Mood', 'Lydian Dream', 'Phrygian Night', 'Mixolydian Sun',
    'Pentatonic Rain', 'Chromatic Dust', 'Whole Tone', 'Blue Scale', 'Diminished Light',
    'Pulse Width', 'Sine Wave', 'Saw Tooth', 'Triangle Moon',
    'Filter Sweep', 'Low Pass', 'High Pass', 'Band Pass', 'Phase Shift',
    'Ring Mod', 'Bit Crush', 'Wave Fold', 'Soft Clip', 'Hard Sync',
    'Arp Dream', 'Step Dance', 'Loop Garden', 'Clip Show', 'Scene Change',
    'Tape Loop', 'Tape Echo', 'Tape Memory', 'Dub Siren', 'Dub Plate',
    'Bass Line', 'Drum Circle', 'Kick Drum', 'Snare Roll',
    'Organ Grinder', 'Music Box', 'Toy Piano', 'Steel Drum', 'Tin Whistle',
    'Wind Chime', 'Rain Stick', 'Thumb Piano', 'Singing Bowl', 'Tuning Fork',
    'Cello Suite', 'Piano Roll', 'Violin Ghost', 'Brass Section', 'String Theory',
    'Choir Loft', 'Bell Tower', 'Church Organ', 'Opera House', 'Concert Hall',
    'Basement Show', 'Attic Tapes', 'Garage Band', 'Bedroom Pop',
    'Late Night', 'Small Hours', 'Witching Hour', 'Happy Hour',
    'Spring Break', 'Heart Break', 'Day Break',
    'Ivory Tower', 'Lighthouse Keeper', 'Night Watch', 'Lantern Light', 'Candle Wax',
    'Smoke Signal', 'Morse Code', 'Radio Silence', 'Short Wave', 'Long Wave',
    'Signal Fire', 'Pilot Light', 'Neon Sign', 'Street Light', 'City Lights',
    'Electric Dreams', 'Magnetic Field', 'Static Charge', 'Solar Wind', 'Cosmic Ray',
    'Orbit Song', 'Comet Tail', 'Nebula Drift', 'Gravity Well', 'Event Horizon',
    'Feather Light', 'Iron Will', 'Paper Tiger', 'Velvet Glove', 'Golden Thread',
];

/* `YYYY-MM-DD_NN` — sets-lib.ts:defaultSetName's output and nothing else. A
 * Set someone named stays theirs; only the placeholder is worth replacing. */
const DATED = /^\d{4}-\d\d-\d\d_\d+$/;

export function isDatedName(name: string): boolean { return DATED.test(name.trim()); }

/** A pair no Set in `rows` already uses (case-insensitive), picked at random.
 *  With every pair taken, the first free numbered one: still unique, and the
 *  list is long enough that nobody gets there by accident. */
export function generateSetName(rows: LibRow[], rand: () => number = Math.random): string {
    const used = new Set(rows.map((r) => r.name.trim().toLowerCase()));
    const n = SET_NAME_PAIRS.length;
    const start = Math.floor(rand() * n) % n;
    for (let i = 0; i < n; i++) {
        const name = SET_NAME_PAIRS[(start + i) % n];
        if (!used.has(name.toLowerCase())) return name;
    }
    for (let k = 2; ; k++) {
        const name = SET_NAME_PAIRS[start] + ' ' + k;
        if (!used.has(name.toLowerCase())) return name;
    }
}

/** What the rename keyboard opens on: the Set's own name, unless that is still
 *  the dated placeholder. */
export function renameInitialText(row: LibRow, rows: LibRow[], rand?: () => number): string {
    return isDatedName(row.name) ? generateSetName(rows, rand) : row.name;
}
