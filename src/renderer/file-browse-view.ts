import type { FileBrowserState } from '../app/state.js';
import { fontPrint, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { W, HEADER_H } from './layout.js';

export function renderFileBrowseView(state: FileBrowserState): void {
    clear_screen();

    const dir = state.currentDir;
    const dirLabel = dir.length > 18 ? '...' + dir.slice(-15) : dir;
    drawHeader(dirLabel, null, true);

    const LIST_TOP = HEADER_H + 2;
    const LIST_BOT = 64;
    const rowH     = FONT_HEIGHT + 2;

    const { items, selectedIndex } = state;
    if (items.length === 0) {
        fontPrint(2, LIST_TOP, 'No files', 1);
        return;
    }

    const visible  = Math.floor((LIST_BOT - LIST_TOP) / rowH);
    const halfVis  = Math.floor(visible / 2);
    const startIdx = Math.max(0, Math.min(selectedIndex - halfVis, items.length - visible));

    for (let i = 0; i < visible; i++) {
        const idx = startIdx + i;
        if (idx >= items.length) break;
        const item  = items[idx];
        const label = item.isDir ? '>' + item.name : item.name;
        const y     = LIST_TOP + i * rowH;
        if (idx === selectedIndex) {
            fill_rect(0, y - 1, W, rowH, 1);
            fontPrint(2, y, label, 0);
        } else {
            fontPrint(2, y, label, 1);
        }
    }
}
