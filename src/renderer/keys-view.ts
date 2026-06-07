import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { W, HEADER_H } from './layout.js';

export function renderKeysView(moduleName: string, rootNote: number, midiNoteName: (n: number) => string): void {
    clear_screen();

    let abbrev = moduleName;
    const prefixW = fontWidth('Movy ');
    while (abbrev.length > 1 && prefixW + fontWidth('[' + abbrev + ']') > W - 4) {
        abbrev = abbrev.slice(0, -1);
    }
    if (abbrev !== moduleName) abbrev += '~';

    drawHeader('Movy', '[' + abbrev + ']', true);

    const rootName = midiNoteName(rootNote);
    const topName  = midiNoteName(rootNote + 24);
    fontPrint(2,                          HEADER_H + 5, rootName, 1);
    fontPrint(W - fontWidth(topName) - 2, HEADER_H + 5, topName,  1);

    const FOOTER_Y = 57;
    fill_rect(0, FOOTER_Y, W, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, 'L/R:oct  U/D:semi  S+L:mod', 0);
}
