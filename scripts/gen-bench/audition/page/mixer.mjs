import { TRACKS } from './core.mjs';

const el = (tag, props) => Object.assign(document.createElement(tag), props);

/* The mixer: one level per track for every case, remembered on this phone. */
const MIX = 'audition.mix';
export function mixer(box, player) {
    let mix = {};
    try { mix = JSON.parse(localStorage.getItem(MIX)) ?? {}; } catch { /* private window */ }
    box.replaceChildren(...TRACKS.flatMap((t) => {
        const v = mix[t] ?? 100;
        const input = el('input', { id: `mix-${t}`, type: 'range', min: 0, max: 200, step: 5, value: v });
        const shown = el('span', { className: 'data', textContent: `${v}%` });
        player.level(t, v / 100);
        input.oninput = () => {
            mix[t] = Number(input.value); shown.textContent = `${input.value}%`; player.level(t, mix[t] / 100);
            try { localStorage.setItem(MIX, JSON.stringify(mix)); } catch { /* in memory only */ }
        };
        return [el('label', { htmlFor: `mix-${t}`, textContent: t }), input, shown];
    }));
}
