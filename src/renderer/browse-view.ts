import { fontPrint, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { W, HEADER_H } from './layout.js';

export function renderBrowseView(modules: { name: string }[], browseIndex: number, title = 'Module'): void {
    clear_screen();
    drawHeader(title, null, true);

    const FOOTER_Y = 57;
    const LIST_TOP = HEADER_H + 2;
    const LIST_BOT = FOOTER_Y - 2;
    const rowH     = FONT_HEIGHT + 2;

    if (modules.length === 0) {
        fontPrint(2, LIST_TOP, 'No modules found', 1);
    } else {
        const visible  = Math.floor((LIST_BOT - LIST_TOP) / rowH);
        const halfVis  = Math.floor(visible / 2);
        const startIdx = Math.max(0, Math.min(browseIndex - halfVis, modules.length - visible));
        for (let i = 0; i < visible; i++) {
            const idx = startIdx + i;
            if (idx >= modules.length) break;
            const y = LIST_TOP + i * rowH;
            if (idx === browseIndex) {
                fill_rect(0, y - 1, W, rowH, 1);
                fontPrint(2, y, modules[idx].name, 0);
            } else {
                fontPrint(2, y, modules[idx].name, 1);
            }
        }
    }

    fill_rect(0, FOOTER_Y, W, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, 'Back:cancel  Click:load', 0);
}
