#!/usr/bin/env node
// Rasterizes chars from 5x3-font.otf → src/font/glyphs5x3.ts
// Glyph format (same as glyphs.ts): [advance, yOff, w, h, ...rowBytes]  bit0=leftmost
import { loadSync } from 'opentype.js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const font  = loadSync(resolve(__dir, '../5x3-font.otf'));

const CHARS    = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TARGET_H = 5;
const TARGET_W = 3;

function isInsidePath(path, px, py) {
    let inside = false;
    let curX = 0, curY = 0, startX = 0, startY = 0;
    for (const cmd of path.commands) {
        if (cmd.type === 'M') {
            startX = curX = cmd.x; startY = curY = cmd.y;
        } else if (cmd.type === 'L') {
            inside ^= crossesRay(curX, curY, cmd.x, cmd.y, px, py);
            curX = cmd.x; curY = cmd.y;
        } else if (cmd.type === 'Q') {
            inside ^= quadCrossesRay(curX, curY, cmd.x1, cmd.y1, cmd.x, cmd.y, px, py);
            curX = cmd.x; curY = cmd.y;
        } else if (cmd.type === 'C') {
            const mx = (cmd.x1+cmd.x2)/2, my = (cmd.y1+cmd.y2)/2;
            inside ^= quadCrossesRay(curX, curY, cmd.x1, cmd.y1, mx, my, px, py);
            inside ^= quadCrossesRay(mx, my, cmd.x2, cmd.y2, cmd.x, cmd.y, px, py);
            curX = cmd.x; curY = cmd.y;
        } else if (cmd.type === 'Z') {
            inside ^= crossesRay(curX, curY, startX, startY, px, py);
            curX = startX; curY = startY;
        }
    }
    return inside;
}

function crossesRay(x0, y0, x1, y1, px, py) {
    if ((y0 <= py) === (y1 <= py)) return false;
    return x0 + (py - y0) / (y1 - y0) * (x1 - x0) > px;
}

function quadCrossesRay(x0, y0, x1, y1, x2, y2, px, py) {
    const a = y0 - 2*y1 + y2, b = 2*(y1 - y0), c = y0 - py;
    const roots = [];
    if (Math.abs(a) < 1e-10) {
        if (Math.abs(b) > 1e-10) roots.push(-c / b);
    } else {
        const disc = b*b - 4*a*c;
        if (disc >= 0) {
            const sq = Math.sqrt(disc);
            roots.push((-b - sq) / (2*a), (-b + sq) / (2*a));
        }
    }
    let crossings = 0;
    for (const t of roots) {
        if (t >= 0 && t < 1) {
            const bx = (1-t)*(1-t)*x0 + 2*(1-t)*t*x1 + t*t*x2;
            if (bx > px) crossings++;
        }
    }
    return crossings % 2 === 1;
}

function rasterizeChar(char) {
    const g = font.charToGlyph(char);
    if (!g || !g.path || g.path.commands.length === 0) {
        return { entry: [4, 0, 0, 0], preview: '' };
    }
    const bb = g.getBoundingBox();
    const rangeX = bb.x2 - bb.x1 || 1;
    const rangeY = bb.y2 - bb.y1 || 1;
    const scaleX = (TARGET_W - 0.0001) / rangeX;
    const scaleY = (TARGET_H - 0.0001) / rangeY;
    const scale  = Math.min(scaleX, scaleY);

    const rows = [];
    let preview = '';
    for (let row = 0; row < TARGET_H; row++) {
        let bits = 0;
        for (let col = 0; col < TARGET_W; col++) {
            const fx = bb.x1 + (col + 0.5) / scale;
            const fy = bb.y2 - (row + 0.5) / scale;
            if (isInsidePath(g.path, fx, fy)) { bits |= (1 << col); preview += '#'; }
            else preview += '.';
        }
        preview += '\n';
        rows.push(bits);
    }
    const advPx = Math.max(TARGET_W + 1, Math.round(g.advanceWidth * scale));
    return { entry: [advPx, 0, TARGET_W, TARGET_H, ...rows], preview };
}

const entries = [];
for (const ch of CHARS) {
    const { entry, preview } = rasterizeChar(ch);
    entries.push({ ch, entry });
    const label = ch === ' ' ? 'SPC' : ch;
    process.stdout.write(`'${label}' (${ch.charCodeAt(0)}):\n${preview || '(empty)\n'}\n`);
}

const lines = entries.map(({ ch, entry }) =>
    `  ${JSON.stringify(entry)},// '${ch === "'" ? "\\'" : ch}'`
).join('\n');

const out = `// 5×3 pixel font — rasterised from 5x3-font.otf\n// Glyph format: [advance, yOff, w, h, ...rowBytes]  bit0=leftmost pixel\nexport const G5: number[][] = [\n${lines}\n];\n`;

const outPath = resolve(__dir, '../src/font/glyphs5x3.ts');
writeFileSync(outPath, out, 'utf8');
console.log(`\nWrote ${entries.length} glyphs to ${outPath}`);
